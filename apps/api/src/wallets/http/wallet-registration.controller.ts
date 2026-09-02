import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
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
  ApiOkResponse,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
  type SchemaObject,
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
import { MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT } from '../application/ports/wallet-registration-repository.port';
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

const ACTIVE_WALLET_ROSTER_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'wallets'],
  properties: {
    version: { type: 'integer', enum: [1] },
    wallets: {
      type: 'array',
      maxItems: MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'walletId',
          'chainId',
          'address',
          'registeredAt',
          'registryEnvironment',
          'registryVersion',
          'registryFingerprintSha256',
        ],
        properties: {
          walletId: { type: 'string', format: 'uuid' },
          chainId: { type: 'string', maxLength: 96 },
          address: { type: 'string', maxLength: 128 },
          registeredAt: { type: 'string', format: 'date-time' },
          registryEnvironment: { type: 'string', enum: ['MAINNET', 'TESTNET'] },
          registryVersion: { type: 'integer', minimum: 1 },
          registryFingerprintSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        },
      },
    },
  },
};

@ApiTags('wallets')
@ApiSecurity('sessionCookie')
@UseGuards(AccountAuthGuard)
@UseInterceptors(WalletRegistrationPrivacyInterceptor)
@Controller('wallets')
export class WalletRegistrationController {
  constructor(private readonly wallets: WalletRegistrationService) {}

  @Get()
  @ApiOperation({ summary: 'List active wallets registered to the current account' })
  @ApiOkResponse({
    description: 'Account-scoped active wallet roster',
    schema: ACTIVE_WALLET_ROSTER_SCHEMA,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authenticated session' })
  @ApiResponse({ status: 503, description: 'Wallet registration is unavailable' })
  async listActiveWallets(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Res({ passthrough: true }) response: StatusWriter,
  ): Promise<unknown> {
    try {
      return await this.wallets.listActiveWallets(principal.accountId);
    } catch (error) {
      this.rethrowOperational(error, response);
    }
  }

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
