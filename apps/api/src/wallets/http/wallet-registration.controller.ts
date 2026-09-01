import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AccountAuthGuard } from '../../accounts/auth/account-auth.guard';
import type { CurrentPrincipal as AuthenticatedPrincipal } from '../../accounts/auth/current-principal';
import { CurrentPrincipal } from '../../accounts/auth/current-principal.decorator';
import { loggingContext } from '../../infrastructure/logging';
import {
  WalletOwnershipConflictError,
  WalletRegistrationRateLimitedError,
  WalletRegistrationRejectedError,
  WalletRegistrationUnavailableError,
} from '../application/wallet-registration.errors';
import { WalletRegistrationService } from '../application/wallet-registration.service';
import {
  ISSUE_WALLET_OWNERSHIP_CHALLENGE_SCHEMA,
  SUBMIT_WALLET_OWNERSHIP_PROOF_SCHEMA,
  WalletRegistrationBodyError,
  parseIssueWalletOwnershipChallengeBody,
  parseSubmitWalletOwnershipProofBody,
} from './wallet-registration-body';
import { WalletRegistrationPrivacyInterceptor } from './wallet-registration-privacy.interceptor';

interface StatusWriter {
  setHeader(name: string, value: string): void;
  status(code: number): this;
}

@ApiTags('wallets')
@ApiSecurity('sessionCookie')
@UseGuards(AccountAuthGuard)
@UseInterceptors(WalletRegistrationPrivacyInterceptor)
@Controller('wallets')
export class WalletRegistrationController {
  constructor(private readonly wallets: WalletRegistrationService) {}

  @Post('ownership-challenges')
  @ApiOperation({ summary: 'Issue a one-use, account-bound wallet ownership challenge' })
  @ApiBody({ schema: ISSUE_WALLET_OWNERSHIP_CHALLENGE_SCHEMA })
  @ApiCreatedResponse({ description: 'Exact server-authored signing challenge' })
  @ApiBadRequestResponse({ description: 'Unsupported or malformed wallet identity' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authenticated session' })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'The account has reached its bounded pending-challenge budget',
  })
  @ApiResponse({ status: 503, description: 'Wallet registration is disabled or unavailable' })
  async issueChallenge(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: StatusWriter,
  ): Promise<unknown> {
    try {
      const parsed = parseIssueWalletOwnershipChallengeBody(body);
      return await this.wallets.issueChallenge({
        accountId: principal.accountId,
        chainId: parsed.chainId,
        address: parsed.address,
        correlationId: loggingContext.requireCurrent().correlationId,
      });
    } catch (error) {
      if (
        error instanceof WalletRegistrationBodyError ||
        error instanceof WalletRegistrationRejectedError
      ) {
        throw new BadRequestException('Wallet challenge request rejected');
      }
      if (error instanceof WalletRegistrationRateLimitedError) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
        throw new HttpException(
          'Wallet challenge request rate limited',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      this.rethrowOperational(error, response);
    }
  }

  @Post('ownership-proofs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Verify and atomically register a wallet ownership proof' })
  @ApiBody({ schema: SUBMIT_WALLET_OWNERSHIP_PROOF_SCHEMA })
  @ApiCreatedResponse({ description: 'Wallet ownership verified and registered' })
  @ApiResponse({ status: 200, description: 'Wallet was already registered to this account' })
  @ApiBadRequestResponse({ description: 'Ownership proof rejected' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authenticated session' })
  @ApiResponse({ status: 409, description: 'Wallet is registered to another account' })
  @ApiResponse({ status: 503, description: 'Wallet registration is unavailable' })
  async submitProof(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: StatusWriter,
  ): Promise<unknown> {
    try {
      const proof = parseSubmitWalletOwnershipProofBody(body);
      const registered = await this.wallets.submitProof({
        accountId: principal.accountId,
        proof,
        correlationId: loggingContext.requireCurrent().correlationId,
      });
      response.status(registered.status === 'registered' ? HttpStatus.CREATED : HttpStatus.OK);
      return registered;
    } catch (error) {
      if (
        error instanceof WalletRegistrationBodyError ||
        error instanceof WalletRegistrationRejectedError
      ) {
        throw new BadRequestException('Wallet ownership proof rejected');
      }
      if (error instanceof WalletOwnershipConflictError) {
        throw new ConflictException('Wallet ownership proof conflicts with an existing wallet');
      }
      this.rethrowOperational(error, response);
    }
  }

  private rethrowOperational(error: unknown, response: StatusWriter): never {
    if (error instanceof WalletRegistrationUnavailableError) {
      response.setHeader('Retry-After', '1');
      throw new HttpException(
        {
          error: 'Service Unavailable',
          message: 'Wallet registration unavailable',
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
        { cause: error },
      );
    }
    throw error;
  }
}
