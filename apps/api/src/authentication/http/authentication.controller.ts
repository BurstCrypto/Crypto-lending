import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  AuthenticationRejectedError,
  AuthenticationRateLimitedError,
  AuthenticationUnavailableError,
  ClaimedAuthenticationRejectedError,
  ClaimedAuthenticationUnavailableError,
} from '../application/authentication.errors';
import {
  AuthenticationService,
  type AuthenticationHttpRequest,
} from '../application/authentication.service';
import {
  AUTHENTICATION_CONFIG,
  type RuntimeAuthenticationConfig,
} from '../infrastructure/config/authentication-config.provider';
import {
  AUTHENTICATION_COOKIE_NAMES,
  clearAuthenticationCookie,
  readUniqueAuthenticationCookie,
  serializeAuthenticationCookie,
} from './authentication-cookies';
import { AuthenticationClientAddressResolver } from './authentication-client-address';
import { parseAuthenticationCallback } from './authentication-callback';
import { canonicalAuthenticationOrigin } from './authentication-origin';
import { StartRegistrationDto } from './dto/start-registration.dto';
import { AuthenticationStartResponseDto } from './dto/authentication-start-response.dto';

interface AuthenticationControllerRequest extends AuthenticationHttpRequest {
  readonly originalUrl?: unknown;
  readonly rawHeaders?: unknown;
  readonly socket?: { readonly remoteAddress?: unknown };
}

interface AuthenticationControllerResponse {
  setHeader(name: string, value: string | readonly string[]): void;
  status(code: number): this;
  json(body: unknown): void;
  end(): void;
}

const TRANSACTION_COOKIE_OPTIONS = Object.freeze({ httpOnly: true, sameSite: 'Lax' as const });
const SESSION_COOKIE_OPTIONS = Object.freeze({ httpOnly: true, sameSite: 'Lax' as const });
const CSRF_COOKIE_OPTIONS = Object.freeze({ httpOnly: false, sameSite: 'Strict' as const });
const GENERIC_AUTHENTICATION_ERROR_PATH = '/login?error=authentication';
const HTTP_QUALITY_VALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u;
export const AUTHENTICATION_PROVIDER_LOGOUT_HEADER = 'X-Authentication-Provider-Logout';
const MAXIMUM_PROVIDER_LOGOUT_URL_LENGTH = 4_096;

function managedProviderLogoutUrl(
  config: Extract<RuntimeAuthenticationConfig, { readonly mode: 'oidc' }>,
): string | undefined {
  if (
    (config.providerKey !== 'cognito' && config.providerKey !== 'auth0') ||
    config.endSessionEndpoint === undefined ||
    config.postLogoutRedirectUri === undefined
  ) {
    return undefined;
  }

  try {
    const authorizationEndpoint = new URL(config.authorizationEndpoint);
    const endSessionEndpoint = new URL(config.endSessionEndpoint);
    const postLogoutRedirectUri = new URL(config.postLogoutRedirectUri);
    const expectedPostLogoutRedirectUri = new URL('/login', config.publicOrigin).href;
    if (
      endSessionEndpoint.protocol !== 'https:' ||
      endSessionEndpoint.username !== '' ||
      endSessionEndpoint.password !== '' ||
      endSessionEndpoint.origin !== authorizationEndpoint.origin ||
      endSessionEndpoint.pathname !== (config.providerKey === 'auth0' ? '/v2/logout' : '/logout') ||
      endSessionEndpoint.search !== '' ||
      endSessionEndpoint.hash !== '' ||
      endSessionEndpoint.href !== config.endSessionEndpoint ||
      postLogoutRedirectUri.href !== expectedPostLogoutRedirectUri ||
      postLogoutRedirectUri.href !== config.postLogoutRedirectUri ||
      !/^[\x21-\x7e]{1,256}$/u.test(config.clientId)
    ) {
      return undefined;
    }

    endSessionEndpoint.searchParams.set('client_id', config.clientId);
    endSessionEndpoint.searchParams.set(
      config.providerKey === 'auth0' ? 'returnTo' : 'logout_uri',
      config.postLogoutRedirectUri,
    );
    const providerLogoutUrl = endSessionEndpoint.href;
    if (
      providerLogoutUrl.length > MAXIMUM_PROVIDER_LOGOUT_URL_LENGTH ||
      !/^[\x21-\x7e]+$/u.test(providerLogoutUrl)
    ) {
      return undefined;
    }
    return providerLogoutUrl;
  } catch {
    return undefined;
  }
}

function secondsUntil(expiry: Date): number {
  return Math.max(1, Math.floor((expiry.getTime() - Date.now()) / 1_000));
}

@ApiTags('authentication')
@Controller('auth')
export class AuthenticationController {
  constructor(
    private readonly authentication: AuthenticationService,
    private readonly clientAddresses: AuthenticationClientAddressResolver,
    @Inject(AUTHENTICATION_CONFIG)
    private readonly config: RuntimeAuthenticationConfig,
  ) {}

  @Get('login')
  @ApiOperation({ summary: 'Start managed OIDC login with PKCE' })
  @ApiQuery({ name: 'returnTo', required: false, example: '/' })
  @ApiResponse({ status: 302, description: 'Redirect to the configured identity provider' })
  @ApiOkResponse({
    type: AuthenticationStartResponseDto,
    description: 'Authorization URL when the request explicitly accepts application/json',
  })
  async login(
    @Query('returnTo') returnTo: string | undefined,
    @Req() request: AuthenticationControllerRequest,
    @Res() response: AuthenticationControllerResponse,
  ): Promise<void> {
    this.privateResponse(response);
    try {
      const started = await this.authentication.start({
        flow: 'login',
        returnPath: returnTo ?? '/',
        sourceAddress: this.clientAddresses.resolve(request),
      });
      response.setHeader(
        'Set-Cookie',
        serializeAuthenticationCookie(
          AUTHENTICATION_COOKIE_NAMES.transaction,
          started.transactionCookie,
          {
            ...TRANSACTION_COOKIE_OPTIONS,
            maxAgeSeconds: this.enabledConfig().preAuthenticationTtlSeconds,
          },
        ),
      );
      if (this.acceptsJson(request)) {
        response
          .status(HttpStatus.OK)
          .json(new AuthenticationStartResponseDto(started.authorizationUrl));
        return;
      }
      this.redirect(response, HttpStatus.FOUND, started.authorizationUrl);
    } catch (error) {
      this.throwHttp(error, response);
    }
  }

  @Post('registration')
  @ApiOperation({ summary: 'Start atomic account registration through managed OIDC' })
  @ApiConsumes('application/json', 'application/x-www-form-urlencoded')
  @ApiBody({ type: StartRegistrationDto })
  @ApiResponse({ status: 303, description: 'Redirect to the configured identity provider' })
  @ApiOkResponse({
    type: AuthenticationStartResponseDto,
    description: 'Authorization URL when the request explicitly accepts application/json',
  })
  async registration(
    @Body() body: StartRegistrationDto,
    @Req() request: AuthenticationControllerRequest,
    @Res() response: AuthenticationControllerResponse,
  ): Promise<void> {
    this.privateResponse(response);
    try {
      this.assertTrustedUnsafeOrigin(request);
      const started = await this.authentication.start({
        flow: 'registration',
        returnPath: body.returnPath ?? '/',
        sourceAddress: this.clientAddresses.resolve(request),
        registration: {
          contactEmail: body.contactEmail,
          contactPhone: body.contactPhone ?? null,
          declaredResidencyCountryCode: body.declaredResidencyCountryCode,
        },
      });
      response.setHeader(
        'Set-Cookie',
        serializeAuthenticationCookie(
          AUTHENTICATION_COOKIE_NAMES.transaction,
          started.transactionCookie,
          {
            ...TRANSACTION_COOKIE_OPTIONS,
            maxAgeSeconds: this.enabledConfig().preAuthenticationTtlSeconds,
          },
        ),
      );
      if (this.acceptsJson(request)) {
        response
          .status(HttpStatus.OK)
          .json(new AuthenticationStartResponseDto(started.authorizationUrl));
        return;
      }
      this.redirect(response, HttpStatus.SEE_OTHER, started.authorizationUrl);
    } catch (error) {
      this.throwHttp(error, response);
    }
  }

  @Get('callback')
  @ApiOperation({ summary: 'Consume a one-use browser-bound OIDC callback' })
  @ApiResponse({
    status: 303,
    description:
      'Redirect locally after issuing a secure session or after a fixed generic browser failure',
  })
  async callback(
    @Req() request: AuthenticationControllerRequest,
    @Res() response: AuthenticationControllerResponse,
  ): Promise<void> {
    this.privateResponse(response);
    try {
      const transactionCookie = readUniqueAuthenticationCookie(
        request.headers?.cookie,
        AUTHENTICATION_COOKIE_NAMES.transaction,
      );
      if (transactionCookie === null) throw new AuthenticationRejectedError();
      const completed = await this.authentication.completeCallback({
        callback: parseAuthenticationCallback(request.originalUrl),
        transactionCookie,
        sourceAddress: this.clientAddresses.resolve(request),
      });
      const maxAgeSeconds = secondsUntil(completed.idleExpiresAt);
      response.setHeader('Set-Cookie', [
        clearAuthenticationCookie(
          AUTHENTICATION_COOKIE_NAMES.transaction,
          TRANSACTION_COOKIE_OPTIONS,
        ),
        serializeAuthenticationCookie(
          AUTHENTICATION_COOKIE_NAMES.session,
          completed.sessionCookie,
          { ...SESSION_COOKIE_OPTIONS, maxAgeSeconds },
        ),
        serializeAuthenticationCookie(AUTHENTICATION_COOKIE_NAMES.csrf, completed.csrfToken, {
          ...CSRF_COOKIE_OPTIONS,
          maxAgeSeconds,
        }),
      ]);
      this.redirect(response, HttpStatus.SEE_OTHER, completed.returnPath);
    } catch (error) {
      if (
        error instanceof ClaimedAuthenticationRejectedError ||
        error instanceof ClaimedAuthenticationUnavailableError ||
        (!(error instanceof AuthenticationRateLimitedError) &&
          !(error instanceof AuthenticationUnavailableError))
      ) {
        response.setHeader(
          'Set-Cookie',
          clearAuthenticationCookie(
            AUTHENTICATION_COOKIE_NAMES.transaction,
            TRANSACTION_COOKIE_OPTIONS,
          ),
        );
      }
      if (this.acceptsHtml(request)) {
        if (error instanceof AuthenticationRateLimitedError) {
          response.setHeader('Retry-After', String(error.retryAfterSeconds));
        } else if (
          error instanceof AuthenticationUnavailableError ||
          error instanceof ClaimedAuthenticationUnavailableError
        ) {
          response.setHeader('Retry-After', '1');
        }
        this.redirect(response, HttpStatus.SEE_OTHER, GENERIC_AUTHENTICATION_ERROR_PATH);
        return;
      }
      this.throwHttp(error, response);
    }
  }

  @Post('session/rotate')
  @ApiOperation({ summary: 'Rotate the current cookie session credential' })
  @ApiNoContentResponse({ description: 'Session credential rotated' })
  async rotate(
    @Req() request: AuthenticationControllerRequest,
    @Res() response: AuthenticationControllerResponse,
  ): Promise<void> {
    this.privateResponse(response);
    let trustedOrigin = false;
    try {
      this.assertTrustedUnsafeOrigin(request);
      trustedOrigin = true;
      const rotated = await this.authentication.rotate(
        request,
        this.clientAddresses.resolve(request),
      );
      const maxAgeSeconds = secondsUntil(rotated.expiresAt);
      response.setHeader('Set-Cookie', [
        serializeAuthenticationCookie(AUTHENTICATION_COOKIE_NAMES.session, rotated.sessionCookie, {
          ...SESSION_COOKIE_OPTIONS,
          maxAgeSeconds,
        }),
        serializeAuthenticationCookie(AUTHENTICATION_COOKIE_NAMES.csrf, rotated.csrfToken, {
          ...CSRF_COOKIE_OPTIONS,
          maxAgeSeconds,
        }),
      ]);
      response.status(HttpStatus.NO_CONTENT).end();
    } catch (error) {
      if (trustedOrigin && error instanceof AuthenticationRejectedError) {
        response.setHeader('Set-Cookie', this.clearSessionCookies());
      }
      this.throwHttp(error, response);
    }
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke the current local session family' })
  @ApiNoContentResponse({
    description: 'Session revoked or already absent',
    headers: {
      [AUTHENTICATION_PROVIDER_LOGOUT_HEADER]: {
        description:
          'Bounded managed-provider logout URL, present only after confirmed local revocation',
        schema: { type: 'string', format: 'uri', maxLength: MAXIMUM_PROVIDER_LOGOUT_URL_LENGTH },
      },
    },
  })
  async logout(
    @Req() request: AuthenticationControllerRequest,
    @Res() response: AuthenticationControllerResponse,
  ): Promise<void> {
    this.privateResponse(response);
    let trustedOrigin = false;
    let localLogoutConfirmed = false;
    try {
      this.assertTrustedUnsafeOrigin(request);
      trustedOrigin = true;
      await this.authentication.logout(request);
      localLogoutConfirmed = true;
    } catch (error) {
      if (
        error instanceof AuthenticationUnavailableError ||
        error instanceof AuthenticationRateLimitedError
      ) {
        this.throwHttp(error, response);
      }
      if (!(error instanceof AuthenticationRejectedError) || !trustedOrigin) {
        this.throwHttp(error, response);
      }
    }
    response.setHeader('Set-Cookie', this.clearSessionCookies());
    if (localLogoutConfirmed) {
      const providerLogoutUrl = managedProviderLogoutUrl(this.enabledConfig());
      if (providerLogoutUrl !== undefined) {
        response.setHeader(AUTHENTICATION_PROVIDER_LOGOUT_HEADER, providerLogoutUrl);
      }
    }
    response.status(HttpStatus.NO_CONTENT).end();
  }

  private clearSessionCookies(): readonly string[] {
    return [
      clearAuthenticationCookie(AUTHENTICATION_COOKIE_NAMES.session, SESSION_COOKIE_OPTIONS),
      clearAuthenticationCookie(AUTHENTICATION_COOKIE_NAMES.csrf, CSRF_COOKIE_OPTIONS),
    ];
  }

  private enabledConfig(): Extract<RuntimeAuthenticationConfig, { readonly mode: 'oidc' }> {
    if (this.config.mode !== 'oidc') throw new AuthenticationUnavailableError();
    return this.config;
  }

  private assertTrustedUnsafeOrigin(request: AuthenticationControllerRequest): void {
    const config = this.enabledConfig();
    const expectedOrigin = canonicalAuthenticationOrigin(config.publicOrigin, {
      localDemo: config.localDemo,
    });
    if (request.headers?.origin !== expectedOrigin) throw new AuthenticationRejectedError();
  }

  private privateResponse(response: AuthenticationControllerResponse): void {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie, Origin, Accept');
  }

  private acceptsJson(request: AuthenticationControllerRequest): boolean {
    return request.headers?.accept === 'application/json';
  }

  private acceptsHtml(request: AuthenticationControllerRequest): boolean {
    const accept = request.headers?.accept;
    if (typeof accept !== 'string' || accept.length > 2_048) return false;
    return accept.split(',').some((entry) => {
      const [mediaType, ...parameters] = entry.split(';');
      if (mediaType?.trim().toLowerCase() !== 'text/html') return false;

      let quality: number | null = null;
      for (const parameter of parameters) {
        const separator = parameter.indexOf('=');
        if (separator < 0 || parameter.slice(0, separator).trim().toLowerCase() !== 'q') continue;
        if (quality !== null) return false;
        const value = parameter.slice(separator + 1).trim();
        if (!HTTP_QUALITY_VALUE.test(value)) return false;
        quality = Number(value);
      }
      return quality === null || quality > 0;
    });
  }

  private redirect(
    response: AuthenticationControllerResponse,
    status: number,
    location: string,
  ): void {
    response.setHeader('Location', location);
    response.status(status).end();
  }

  private throwHttp(error: unknown, response: AuthenticationControllerResponse): never {
    if (error instanceof AuthenticationRateLimitedError) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
      throw new HttpException('Authentication request rejected', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (error instanceof AuthenticationUnavailableError) {
      response.setHeader('Retry-After', '1');
      throw new HttpException('Authentication unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
    throw new HttpException('Authentication request rejected', HttpStatus.UNAUTHORIZED);
  }
}
