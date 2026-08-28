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
import { currentJobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import { LocalDemoPortfolioSnapshotChangedError } from '../local-demo/local-demo-allocation.service';
import { LocalDemoNoMatchingYieldOpportunitiesError } from '../local-demo/local-demo-yield-catalog.service';
import {
  PUBLIC_TESTNET_INTENT_BODY_SCHEMA,
  PUBLIC_TESTNET_INTENT_RESPONSE_SCHEMA,
  PUBLIC_TESTNET_SUBMISSION_BODY_SCHEMA,
  PUBLIC_TESTNET_VERIFICATION_RESPONSE_SCHEMA,
  PublicTestnetBodyError,
  PublicTestnetPrivacyInterceptor,
  parsePublicTestnetIntentBody,
  parsePublicTestnetIntentId,
  parsePublicTestnetSubmissionBody,
} from './public-testnet-execution.http';
import {
  PublicTestnetIntentCapacityError,
  PublicTestnetIntentConflictError,
  PublicTestnetIntentExpiredError,
  PublicTestnetIntentNotFoundError,
  PublicTestnetExecutionService,
  type PublicTestnetIntentResponse,
  type PublicTestnetVerificationResponse,
} from './public-testnet-execution.service';
import {
  PublicTestnetEvidenceMismatchError,
  PublicTestnetPreflightRejectedError,
  PublicTestnetRpcUnavailableError,
} from './public-testnet-execution.rpc';

interface HeaderWriter {
  setHeader(name: string, value: string): void;
}

function badBody(error: unknown): never {
  if (error instanceof PublicTestnetBodyError) {
    throw new BadRequestException('Public-testnet request is invalid');
  }
  throw error;
}

function unavailable(response: HeaderWriter): never {
  response.setHeader('Retry-After', '1');
  throw new HttpException(
    {
      error: 'Service Unavailable',
      message: 'Public-testnet verification is temporarily unavailable',
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

function evidenceRejected(): never {
  throw new UnprocessableEntityException({
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    error: 'Unprocessable Entity',
    message: 'Public-testnet transaction evidence did not match the fixed intent',
    code: 'PUBLIC_TESTNET_EVIDENCE_MISMATCH',
  });
}

@ApiTags('public-testnet')
@ApiSecurity('sessionCookie')
@UseGuards(AccountAuthGuard)
@UseInterceptors(PublicTestnetPrivacyInterceptor)
@Controller('public-testnet')
export class PublicTestnetExecutionController {
  constructor(private readonly executions: PublicTestnetExecutionService) {}

  @Post('execution-intents')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Prepare a fixed browser-wallet lending proof on Solana Devnet',
    description:
      'Creates a short-lived account-, wallet-, portfolio-, and selection-bound intent. The API never signs or broadcasts.',
  })
  @ApiBody({ schema: PUBLIC_TESTNET_INTENT_BODY_SCHEMA })
  @ApiCreatedResponse({
    description: 'One fixed unsigned legacy transaction for the connected Solana wallet',
    schema: PUBLIC_TESTNET_INTENT_RESPONSE_SCHEMA,
  })
  @ApiBadRequestResponse({ description: 'Body is malformed or contains unsupported fields' })
  @ApiUnauthorizedResponse({ description: 'Missing session, exact origin, or CSRF proof' })
  @ApiNotFoundResponse({ description: 'The isolated local public-testnet demo is disabled' })
  @ApiResponse({ status: 409, description: 'The displayed portfolio snapshot changed' })
  @ApiResponse({ status: 422, description: 'The preview or live reserve failed closed' })
  @ApiResponse({
    status: 503,
    description: 'The fixed RPC or local intent capacity is unavailable',
  })
  async createIntent(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): Promise<PublicTestnetIntentResponse> {
    let parsed: ReturnType<typeof parsePublicTestnetIntentBody>;
    try {
      parsed = parsePublicTestnetIntentBody(body);
    } catch (error) {
      return badBody(error);
    }
    const correlation = currentJobCorrelationContext();
    if (correlation === undefined) return unavailable(response);
    try {
      return await this.executions.createIntent(principal.accountId, correlation, parsed);
    } catch (error) {
      if (error instanceof PublicTestnetIntentNotFoundError) {
        throw new NotFoundException('Not found');
      }
      if (error instanceof LocalDemoPortfolioSnapshotChangedError) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'The local demo portfolio changed; refresh and retry',
          code: 'PORTFOLIO_SNAPSHOT_CHANGED',
        });
      }
      if (
        error instanceof LocalDemoNoMatchingYieldOpportunitiesError ||
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

  @Post('execution-intents/:intentId/submissions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify one browser-broadcast Solana signature against one intent',
    description:
      'Polls latest signature status and accepts only a finalized byte-identical transaction with a positive collateral-token delta. The API never signs or broadcasts.',
  })
  @ApiParam({ name: 'intentId', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ schema: PUBLIC_TESTNET_SUBMISSION_BODY_SCHEMA })
  @ApiOkResponse({
    description: 'Pending or strictly finalized transaction observation',
    schema: PUBLIC_TESTNET_VERIFICATION_RESPONSE_SCHEMA,
  })
  @ApiBadRequestResponse({ description: 'Intent id or body is malformed' })
  @ApiUnauthorizedResponse({ description: 'Missing session, exact origin, or CSRF proof' })
  @ApiNotFoundResponse({ description: 'Disabled, unknown, or owned by a different account' })
  @ApiResponse({ status: 409, description: 'Intent was already bound to a different signature' })
  @ApiResponse({ status: 410, description: 'Intent expired before a signature was accepted' })
  @ApiResponse({ status: 422, description: 'Transaction, receipt, event, or position mismatched' })
  @ApiResponse({ status: 503, description: 'The fixed public RPC is unavailable' })
  async verifySubmission(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('intentId') intentIdValue: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): Promise<PublicTestnetVerificationResponse> {
    let intentId: string;
    let parsed: ReturnType<typeof parsePublicTestnetSubmissionBody>;
    try {
      intentId = parsePublicTestnetIntentId(intentIdValue);
      parsed = parsePublicTestnetSubmissionBody(body);
    } catch (error) {
      return badBody(error);
    }
    try {
      return await this.executions.verifySubmission(principal.accountId, intentId, parsed);
    } catch (error) {
      if (error instanceof PublicTestnetIntentNotFoundError) {
        throw new NotFoundException('Not found');
      }
      if (error instanceof PublicTestnetIntentExpiredError) {
        throw new GoneException('Public-testnet intent expired before submission');
      }
      if (error instanceof PublicTestnetIntentConflictError) {
        throw new ConflictException(
          'Public-testnet intent is already bound to a different signature',
        );
      }
      if (error instanceof PublicTestnetEvidenceMismatchError) return evidenceRejected();
      if (error instanceof PublicTestnetRpcUnavailableError) return unavailable(response);
      return unavailable(response);
    }
  }
}
