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
  ApiNoContentResponse,
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
import { canonicalHttpsOrigin } from './authentication-origin';
import { StartRegistrationDto } from './dto/start-registration.dto';

interface AuthenticationControllerRequest extends AuthenticationHttpRequest {
  readonly originalUrl?: unknown;
  readonly rawHeaders?: unknown;
  readonly socket?: { readonly remoteAddress?: unknown };
}

interface AuthenticationControllerResponse {
  setHeader(name: string, value: string | readonly string[]): void;
  status(code: number): this;
  end(): void;
}

const TRANSACTION_COOKIE_OPTIONS = Object.freeze({ httpOnly: true, sameSite: 'Lax' as const });
const SESSION_COOKIE_OPTIONS = Object.freeze({ httpOnly: true, sameSite: 'Lax' as const });
const CSRF_COOKIE_OPTIONS = Object.freeze({ httpOnly: false, sameSite: 'Strict' as const });

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
      this.redirect(response, HttpStatus.FOUND, started.authorizationUrl);
    } catch (error) {
      this.throwHttp(error, response);
    }
  }

  @Post('registration')
  @ApiOperation({ summary: 'Start atomic account registration through managed OIDC' })
  @ApiBody({ type: StartRegistrationDto })
  @ApiResponse({ status: 303, description: 'Redirect to the configured identity provider' })
  async registration(
    @Body() body: StartRegistrationDto,
    @Req() request: AuthenticationControllerRequest,
    @Res() response: AuthenticationControllerResponse,
  ): Promise<void> {
    this.privateResponse(response);
    try {
      const expectedOrigin = canonicalHttpsOrigin(this.enabledConfig().publicOrigin);
      if (request.headers?.origin !== expectedOrigin) throw new AuthenticationRejectedError();
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
      this.redirect(response, HttpStatus.SEE_OTHER, started.authorizationUrl);
    } catch (error) {
      this.throwHttp(error, response);
    }
  }

  @Get('callback')
  @ApiOperation({ summary: 'Consume a one-use browser-bound OIDC callback' })
  @ApiResponse({ status: 303, description: 'Issue a secure local session and redirect locally' })
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
    try {
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
      if (error instanceof AuthenticationRejectedError) {
        response.setHeader('Set-Cookie', this.clearSessionCookies());
      }
      this.throwHttp(error, response);
    }
  }

  @Post('logout')
  @ApiOperation({ summary: 'Revoke the current local session family' })
  @ApiNoContentResponse({ description: 'Session revoked or already absent' })
  async logout(
    @Req() request: AuthenticationControllerRequest,
    @Res() response: AuthenticationControllerResponse,
  ): Promise<void> {
    this.privateResponse(response);
    try {
      await this.authentication.logout(request);
    } catch (error) {
      if (
        error instanceof AuthenticationUnavailableError ||
        error instanceof AuthenticationRateLimitedError
      ) {
        this.throwHttp(error, response);
      }
      if (!(error instanceof AuthenticationRejectedError)) this.throwHttp(error, response);
    }
    response.setHeader('Set-Cookie', this.clearSessionCookies());
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

  private privateResponse(response: AuthenticationControllerResponse): void {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie, Origin');
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
