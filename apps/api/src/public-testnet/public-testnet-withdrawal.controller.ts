import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  GoneException,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
  UnprocessableEntityException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AccountAuthGuard } from '../accounts/auth/account-auth.guard';
import type { CurrentPrincipal as AuthenticatedPrincipal } from '../accounts/auth/current-principal';
import { CurrentPrincipal } from '../accounts/auth/current-principal.decorator';
import {
  PUBLIC_TESTNET_POSITION_BODY_SCHEMA,
  PUBLIC_TESTNET_SUBMISSION_BODY_SCHEMA,
  PublicTestnetBodyError,
  PublicTestnetPrivacyInterceptor,
  parsePublicTestnetIntentId,
  parsePublicTestnetPositionBody,
  parsePublicTestnetSubmissionBody,
} from './public-testnet-execution.http';
import {
  PublicTestnetBroadcastAmbiguousError,
  PublicTestnetBroadcastRejectedError,
  PublicTestnetEvidenceMismatchError,
  PublicTestnetPreflightRejectedError,
  PublicTestnetRpcUnavailableError,
} from './public-testnet-execution.rpc';
import {
  PublicTestnetIntentCapacityError,
  PublicTestnetIntentConflictError,
  PublicTestnetIntentExpiredError,
  PublicTestnetIntentNotFoundError,
} from './public-testnet-execution.service';
import {
  PUBLIC_TESTNET_WITHDRAWAL_INTENT_RESPONSE_SCHEMA,
  PUBLIC_TESTNET_WITHDRAWAL_VERIFICATION_RESPONSE_SCHEMA,
} from './public-testnet-withdrawal.http';
import {
  PublicTestnetWithdrawalService,
  type PublicTestnetWithdrawalIntentResponse,
  type PublicTestnetWithdrawalVerificationResponse,
} from './public-testnet-withdrawal.service';

interface HeaderWriter {
  setHeader(name: string, value: string): void;
}

function badBody(error: unknown): never {
  if (error instanceof PublicTestnetBodyError) {
    throw new BadRequestException('Public-testnet withdrawal request is invalid');
  }
  throw error;
}

function unavailable(response: HeaderWriter): never {
  response.setHeader('Retry-After', '1');
  throw new HttpException(
    {
      error: 'Service Unavailable',
      message: 'Public-testnet withdrawal verification is temporarily unavailable',
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

function evidenceRejected(): never {
  throw new UnprocessableEntityException({
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    error: 'Unprocessable Entity',
    message: 'Withdrawal evidence did not match the fixed Devnet intent',
    code: 'PUBLIC_TESTNET_WITHDRAWAL_EVIDENCE_MISMATCH',
  });
}

@ApiTags('public-testnet')
@ApiSecurity('sessionCookie')
@UseGuards(AccountAuthGuard)
@UseInterceptors(PublicTestnetPrivacyInterceptor)
@Controller('public-testnet')
export class PublicTestnetWithdrawalController {
  constructor(private readonly withdrawals: PublicTestnetWithdrawalService) {}

  @Post('withdrawal-intents')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Prepare a full fixed-position withdrawal on Solana Devnet',
    description:
      'Snapshots the exact finalized cSOL balance and returns one reviewed legacy transaction. This route never signs or broadcasts.',
  })
  @ApiBody({ schema: PUBLIC_TESTNET_POSITION_BODY_SCHEMA })
  @ApiCreatedResponse({
    description: 'One short-lived unsigned full-withdrawal transaction',
    schema: PUBLIC_TESTNET_WITHDRAWAL_INTENT_RESPONSE_SCHEMA,
  })
  @ApiBadRequestResponse({ description: 'Body is malformed or contains unsupported fields' })
  @ApiUnauthorizedResponse({ description: 'Missing session, exact origin, or CSRF proof' })
  @ApiNotFoundResponse({ description: 'The isolated public-testnet demo is disabled' })
  @ApiResponse({ status: 422, description: 'No withdrawable fixed position or invalid deployment' })
  @ApiResponse({ status: 503, description: 'RPC or isolated withdrawal capacity unavailable' })
  async createIntent(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): Promise<PublicTestnetWithdrawalIntentResponse> {
    let parsed: ReturnType<typeof parsePublicTestnetPositionBody>;
    try {
      parsed = parsePublicTestnetPositionBody(body);
    } catch (error) {
      return badBody(error);
    }
    try {
      return await this.withdrawals.createIntent(principal.accountId, parsed);
    } catch (error) {
      if (error instanceof PublicTestnetIntentNotFoundError)
        throw new NotFoundException('Not found');
      if (
        error instanceof PublicTestnetPreflightRejectedError ||
        error instanceof PublicTestnetEvidenceMismatchError
      ) {
        return evidenceRejected();
      }
      if (
        error instanceof PublicTestnetRpcUnavailableError ||
        error instanceof PublicTestnetIntentCapacityError
      ) {
        return unavailable(response);
      }
      return unavailable(response);
    }
  }

  @Post('withdrawal-intents/:intentId/submissions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit or recover one signed Solana Devnet full withdrawal',
    description:
      'The first request binds exact signed bytes and makes one broadcast attempt. Signature-only follow-ups are read-only; the API never resends.',
  })
  @ApiParam({ name: 'intentId', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ schema: PUBLIC_TESTNET_SUBMISSION_BODY_SCHEMA })
  @ApiOkResponse({
    description: 'Pending, finalized withdrawal, finalized partial remainder, or finalized failure',
    schema: PUBLIC_TESTNET_WITHDRAWAL_VERIFICATION_RESPONSE_SCHEMA,
  })
  @ApiBadRequestResponse({ description: 'Intent id or body is malformed' })
  @ApiUnauthorizedResponse({ description: 'Missing session, exact origin, or CSRF proof' })
  @ApiNotFoundResponse({ description: 'Disabled, unknown, or owned by a different account' })
  @ApiResponse({ status: 409, description: 'Intent is bound to a different signature' })
  @ApiResponse({ status: 410, description: 'Unsigned intent expired' })
  @ApiResponse({ status: 422, description: 'Evidence mismatch or rejected broadcast' })
  @ApiResponse({ status: 503, description: 'RPC unavailable or broadcast outcome ambiguous' })
  async verifySubmission(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('intentId') intentIdValue: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): Promise<PublicTestnetWithdrawalVerificationResponse> {
    let intentId: string;
    let parsed: ReturnType<typeof parsePublicTestnetSubmissionBody>;
    try {
      intentId = parsePublicTestnetIntentId(intentIdValue);
      parsed = parsePublicTestnetSubmissionBody(body);
    } catch (error) {
      return badBody(error);
    }
    try {
      return await this.withdrawals.verifySubmission(principal.accountId, intentId, parsed);
    } catch (error) {
      if (error instanceof PublicTestnetIntentNotFoundError)
        throw new NotFoundException('Not found');
      if (error instanceof PublicTestnetIntentExpiredError) {
        throw new GoneException('Public-testnet withdrawal intent expired before submission');
      }
      if (error instanceof PublicTestnetIntentConflictError) {
        throw new ConflictException('Withdrawal intent is already bound or missing signed bytes');
      }
      if (
        error instanceof PublicTestnetBroadcastRejectedError ||
        error instanceof PublicTestnetEvidenceMismatchError
      ) {
        return evidenceRejected();
      }
      if (error instanceof PublicTestnetBroadcastAmbiguousError) {
        throw new HttpException(
          {
            error: 'Service Unavailable',
            message:
              'The broadcast result is inconclusive; recover with signature-only verification',
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            code: 'PUBLIC_TESTNET_WITHDRAWAL_BROADCAST_AMBIGUOUS',
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (error instanceof PublicTestnetRpcUnavailableError) return unavailable(response);
      return unavailable(response);
    }
  }
}
