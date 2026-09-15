import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  AuthenticationRateLimitedError,
  AuthenticationRejectedError,
} from '../application/authentication.errors';
import {
  PASSWORDLESS_COOKIE,
  PASSWORDLESS_TTL_SECONDS,
  PasswordlessService,
  type PasswordlessCompletion,
} from '../application/passwordless.service';
import {
  AUTHENTICATION_CONFIG,
  type RuntimeAuthenticationConfig,
} from '../infrastructure/config/authentication-config.provider';
import { AuthenticationClientAddressResolver } from './authentication-client-address';
import {
  AuthenticationCookieError,
  AUTHENTICATION_COOKIE_NAMES,
  clearAuthenticationCookie,
  readUniqueAuthenticationCookie,
  serializeAuthenticationCookie,
} from './authentication-cookies';

interface Request {
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly rawHeaders?: unknown;
  readonly socket?: { readonly remoteAddress?: unknown };
}

interface Response {
  setHeader(name: string, value: string | readonly string[]): void;
  status(code: number): this;
  json(body: unknown): void;
}

const COOKIE_OPTIONS = { httpOnly: true, sameSite: 'Strict' as const };

@ApiTags('authentication')
@Controller('auth')
export class PasswordlessController {
  constructor(
    private readonly passwordless: PasswordlessService,
    private readonly clientAddresses: AuthenticationClientAddressResolver,
    @Inject(AUTHENTICATION_CONFIG) private readonly config: RuntimeAuthenticationConfig,
  ) {}

  @Get('options')
  options(@Res() response: Response): void {
    this.privateResponse(response);
    response.status(200).json(this.passwordless.options());
  }

  @Post('code/request')
  @HttpCode(200)
  async requestCode(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.privateResponse(response);
    try {
      this.assertOrigin(request);
      const data = this.body(body);
      const result = await this.passwordless.start(
        data.identifier,
        this.clientAddresses.resolve(request),
      );
      response.setHeader(
        'Set-Cookie',
        serializeAuthenticationCookie(PASSWORDLESS_COOKIE, result.cookie, {
          ...COOKIE_OPTIONS,
          maxAgeSeconds: PASSWORDLESS_TTL_SECONDS,
        }),
      );
      response.status(200).json({
        status: 'sent',
        channel: result.channel,
        expiresInSeconds: PASSWORDLESS_TTL_SECONDS,
      });
    } catch (error) {
      this.fail(error, response);
    }
  }

  @Post('code/verify')
  @HttpCode(200)
  async verifyCode(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.privateResponse(response);
    try {
      this.assertOrigin(request);
      const data = this.body(body);
      const result = await this.passwordless.verify(
        readUniqueAuthenticationCookie(request.headers?.cookie, PASSWORDLESS_COOKIE),
        data.code,
        this.clientAddresses.resolve(request),
      );
      this.completed(result, response);
    } catch (error) {
      this.fail(error, response);
    }
  }

  @Post('code/complete')
  @HttpCode(200)
  async complete(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.privateResponse(response);
    try {
      this.assertOrigin(request);
      const data = this.body(body);
      const result = await this.passwordless.complete(
        readUniqueAuthenticationCookie(request.headers?.cookie, PASSWORDLESS_COOKIE),
        {
          contactEmail: data.contactEmail,
          declaredResidencyCountryCode: data.declaredResidencyCountryCode,
        },
      );
      this.completed(result, response);
    } catch (error) {
      this.fail(error, response);
    }
  }

  private completed(result: PasswordlessCompletion, response: Response): void {
    if (result.status === 'profile_required') {
      response.status(200).json(result);
      return;
    }
    const maxAgeSeconds = Math.max(
      1,
      Math.floor((result.session.absoluteExpiresAt.getTime() - Date.now()) / 1000),
    );
    response.setHeader('Set-Cookie', [
      clearAuthenticationCookie(PASSWORDLESS_COOKIE, COOKIE_OPTIONS),
      serializeAuthenticationCookie(
        AUTHENTICATION_COOKIE_NAMES.session,
        result.session.sessionCookie,
        { httpOnly: true, sameSite: 'Lax', maxAgeSeconds },
      ),
      serializeAuthenticationCookie(AUTHENTICATION_COOKIE_NAMES.csrf, result.session.csrfToken, {
        httpOnly: false,
        sameSite: 'Strict',
        maxAgeSeconds,
      }),
    ]);
    response.status(200).json({ status: 'authenticated' });
  }

  private assertOrigin(request: Request): void {
    if (
      this.config.mode !== 'passwordless' ||
      request.headers?.origin !== this.config.publicOrigin
    ) {
      throw new AuthenticationRejectedError();
    }
    const contentType = request.headers?.['content-type'];
    if (
      typeof contentType !== 'string' ||
      !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(contentType)
    ) {
      throw new AuthenticationRejectedError();
    }
  }

  private body(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new AuthenticationRejectedError();
    return value as Record<string, unknown>;
  }

  private privateResponse(response: Response): void {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie, Origin');
  }

  private fail(error: unknown, response: Response): never {
    if (error instanceof AuthenticationRateLimitedError) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
      throw new HttpException('Please wait before trying again', 429);
    }
    if (error instanceof AuthenticationRejectedError || error instanceof AuthenticationCookieError)
      throw new HttpException('Sign-in code or account details are invalid or expired', 401);
    throw new HttpException('Sign-in is temporarily unavailable', 503);
  }
}
