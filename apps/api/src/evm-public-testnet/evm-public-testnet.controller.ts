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
import { PublicTestnetPrivacyInterceptor } from '../public-testnet/public-testnet-execution.http';
import {
  EVM_PUBLIC_TESTNET_INTENT_BODY_SCHEMA,
  EVM_PUBLIC_TESTNET_INTENT_RESPONSE_SCHEMA,
  EVM_PUBLIC_TESTNET_POSITION_BODY_SCHEMA,
  EVM_PUBLIC_TESTNET_POSITION_RESPONSE_SCHEMA,
  EVM_PUBLIC_TESTNET_SUBMISSION_BODY_SCHEMA,
  EVM_PUBLIC_TESTNET_VERIFICATION_RESPONSE_SCHEMA,
  EvmPublicTestnetBodyError,
  parseEvmPublicTestnetIntentBody,
  parseEvmPublicTestnetIntentId,
  parseEvmPublicTestnetPositionBody,
  parseEvmPublicTestnetSubmissionBody,
} from './evm-public-testnet.http';
import {
  EvmPublicTestnetEvidenceMismatchError,
  EvmPublicTestnetPreflightRejectedError,
  EvmPublicTestnetRpcUnavailableError,
  EvmPublicTestnetTransactionReplacedError,
  EvmPublicTestnetTransactionRevertedError,
} from './evm-public-testnet.rpc';
import {
  EvmPublicTestnetExecutionService,
  EvmPublicTestnetIntentCapacityError,
  EvmPublicTestnetIntentConflictError,
  EvmPublicTestnetIntentExpiredError,
  EvmPublicTestnetIntentNotFoundError,
  type EvmPublicTestnetIntentResponse,
  type EvmPublicTestnetPositionResponse,
  type EvmPublicTestnetVerificationResponse,
} from './evm-public-testnet.service';
import {
  parseEvmPublicTestnetWithdrawalBody,
  parseEvmPublicTestnetWithdrawalIntentId,
  parseEvmPublicTestnetWithdrawalSubmissionBody,
} from './evm-public-testnet-withdrawal.http';
import {
  EvmPublicTestnetWithdrawalEmptyPositionError,
  EvmPublicTestnetWithdrawalIntentCapacityError,
  EvmPublicTestnetWithdrawalIntentConflictError,
  EvmPublicTestnetWithdrawalIntentNotFoundError,
  EvmPublicTestnetWithdrawalService,
  type EvmPublicTestnetWithdrawalIntentResponse,
  type EvmPublicTestnetWithdrawalVerificationResponse,
} from './evm-public-testnet-withdrawal.service';

interface HeaderWriter {
  setHeader(name: string, value: string): void;
}

function badBody(error: unknown): never {
  if (error instanceof EvmPublicTestnetBodyError) {
    throw new BadRequestException('EVM public-testnet request is invalid');
  }
  throw error;
}

function unavailable(response: HeaderWriter): never {
  response.setHeader('Retry-After', '1');
  throw new HttpException(
    {
      error: 'Service Unavailable',
      message: 'EVM public-testnet verification is temporarily unavailable',
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

function evidenceRejected(): never {
  throw new UnprocessableEntityException({
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    error: 'Unprocessable Entity',
    message: 'The Base Sepolia transaction did not match the fixed reviewed intent',
    code: 'EVM_PUBLIC_TESTNET_EVIDENCE_MISMATCH',
    safeToRetry: false,
  });
}

function positionRejected(): never {
  throw new UnprocessableEntityException({
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    error: 'Unprocessable Entity',
    message: 'The fixed Base Sepolia Aave deployment or reserve failed validation',
    code: 'EVM_PUBLIC_TESTNET_POSITION_UNAVAILABLE',
    safeToRetry: false,
  });
}

function transactionReverted(): never {
  throw new UnprocessableEntityException({
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    error: 'Unprocessable Entity',
    message: 'The reviewed Base Sepolia transaction reverted',
    code: 'EVM_PUBLIC_TESTNET_TRANSACTION_REVERTED',
    safeToRetry: true,
  });
}

function transactionReplaced(): never {
  throw new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    error: 'Conflict',
    message: 'The reviewed Base Sepolia nonce was finalized by a different transaction',
    code: 'EVM_PUBLIC_TESTNET_TRANSACTION_REPLACED',
    safeToRetry: true,
  });
}

@ApiTags('public-testnet')
@ApiSecurity('sessionCookie')
@UseGuards(AccountAuthGuard)
@UseInterceptors(PublicTestnetPrivacyInterceptor)
@Controller('public-testnet/evm')
export class EvmPublicTestnetController {
  constructor(
    private readonly executions: EvmPublicTestnetExecutionService,
    private readonly withdrawals?: EvmPublicTestnetWithdrawalService,
  ) {}

  @Post('positions/query')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Read one fixed Aave V3 Base Sepolia position',
    description:
      'Returns the latest read-only aWETH balance and variable base supply APY. It never creates an intent, signs, or broadcasts.',
  })
  @ApiBody({ schema: EVM_PUBLIC_TESTNET_POSITION_BODY_SCHEMA })
  @ApiOkResponse({
    description: 'Latest position plus latest and finalized observation metadata',
    schema: EVM_PUBLIC_TESTNET_POSITION_RESPONSE_SCHEMA,
  })
  @ApiBadRequestResponse({ description: 'Body is malformed or contains unsupported fields' })
  @ApiUnauthorizedResponse({ description: 'Missing session, exact origin, or CSRF proof' })
  @ApiNotFoundResponse({ description: 'The isolated local public-testnet demo is disabled' })
  @ApiResponse({ status: 422, description: 'The fixed deployment or reserve failed closed' })
  @ApiResponse({ status: 503, description: 'The fixed Base Sepolia RPC is unavailable' })
  async readPosition(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): Promise<EvmPublicTestnetPositionResponse> {
    let parsed: ReturnType<typeof parseEvmPublicTestnetPositionBody>;
    try {
      parsed = parseEvmPublicTestnetPositionBody(body);
    } catch (error) {
      return badBody(error);
    }
    try {
      return await this.executions.readPosition(principal.accountId, parsed);
    } catch (error) {
      if (error instanceof EvmPublicTestnetIntentNotFoundError) {
        throw new NotFoundException('Not found');
      }
      if (
        error instanceof EvmPublicTestnetPreflightRejectedError ||
        error instanceof EvmPublicTestnetEvidenceMismatchError
      ) {
        return positionRejected();
      }
      if (error instanceof EvmPublicTestnetRpcUnavailableError) return unavailable(response);
      return unavailable(response);
    }
  }

  @Post('execution-intents')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Prepare a fixed browser-wallet Aave proof on Base Sepolia',
    description:
      'Creates a short-lived account-, nonce-, portfolio-, and selection-bound intent. The API only reads chain state; the browser wallet broadcasts.',
  })
  @ApiBody({ schema: EVM_PUBLIC_TESTNET_INTENT_BODY_SCHEMA })
  @ApiCreatedResponse({
    description: 'One exact EIP-1193 transaction request for the connected EVM wallet',
    schema: EVM_PUBLIC_TESTNET_INTENT_RESPONSE_SCHEMA,
  })
  @ApiBadRequestResponse({ description: 'Body is malformed or contains unsupported fields' })
  @ApiUnauthorizedResponse({ description: 'Missing session, exact origin, or CSRF proof' })
  @ApiNotFoundResponse({ description: 'The isolated local public-testnet demo is disabled' })
  @ApiResponse({ status: 409, description: 'The displayed portfolio snapshot changed' })
  @ApiResponse({ status: 422, description: 'The preview or fixed deployment failed closed' })
  @ApiResponse({ status: 503, description: 'The fixed RPC or EVM intent capacity is unavailable' })
  async createIntent(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): Promise<EvmPublicTestnetIntentResponse> {
    let parsed: ReturnType<typeof parseEvmPublicTestnetIntentBody>;
    try {
      parsed = parseEvmPublicTestnetIntentBody(body);
    } catch (error) {
      return badBody(error);
    }
    const correlation = currentJobCorrelationContext();
    if (correlation === undefined) return unavailable(response);
    try {
      return await this.executions.createIntent(principal.accountId, correlation, parsed);
    } catch (error) {
      if (error instanceof EvmPublicTestnetIntentNotFoundError) {
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
        error instanceof EvmPublicTestnetPreflightRejectedError ||
        error instanceof EvmPublicTestnetEvidenceMismatchError
      ) {
        return evidenceRejected();
      }
      if (
        error instanceof EvmPublicTestnetRpcUnavailableError ||
        error instanceof EvmPublicTestnetIntentCapacityError
      ) {
        return unavailable(response);
      }
      return unavailable(response);
    }
  }

  @Post('execution-intents/:intentId/submissions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify or recover one wallet-broadcast Base Sepolia transaction',
    description:
      'Accepts an exact transaction hash, or an empty object for read-only bounded log and nonce recovery. The API never submits a transaction and absence alone never authorizes a retry.',
  })
  @ApiParam({ name: 'intentId', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ schema: EVM_PUBLIC_TESTNET_SUBMISSION_BODY_SCHEMA })
  @ApiOkResponse({
    description: 'Pending, latest-confirmed, or finalized-and-verified observation',
    schema: EVM_PUBLIC_TESTNET_VERIFICATION_RESPONSE_SCHEMA,
  })
  @ApiBadRequestResponse({ description: 'Intent id or body is malformed' })
  @ApiUnauthorizedResponse({ description: 'Missing session, exact origin, or CSRF proof' })
  @ApiNotFoundResponse({ description: 'Disabled, unknown, or owned by another account' })
  @ApiResponse({ status: 409, description: 'Hash conflict or finalized nonce replacement' })
  @ApiResponse({ status: 410, description: 'Intent expired before a transaction hash was bound' })
  @ApiResponse({ status: 422, description: 'Transaction reverted or evidence mismatched' })
  @ApiResponse({ status: 503, description: 'Fixed Base Sepolia verification is unavailable' })
  async verifySubmission(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('intentId') intentIdValue: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): Promise<EvmPublicTestnetVerificationResponse> {
    let intentId: string;
    let parsed: ReturnType<typeof parseEvmPublicTestnetSubmissionBody>;
    try {
      intentId = parseEvmPublicTestnetIntentId(intentIdValue);
      parsed = parseEvmPublicTestnetSubmissionBody(body);
    } catch (error) {
      return badBody(error);
    }
    try {
      return await this.executions.verifySubmission(principal.accountId, intentId, parsed);
    } catch (error) {
      if (error instanceof EvmPublicTestnetIntentNotFoundError) {
        throw new NotFoundException('Not found');
      }
      if (error instanceof EvmPublicTestnetIntentExpiredError) {
        throw new GoneException('EVM public-testnet intent expired before submission');
      }
      if (error instanceof EvmPublicTestnetIntentConflictError) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'The EVM public-testnet intent is bound to different transaction evidence',
          code: 'EVM_PUBLIC_TESTNET_INTENT_CONFLICT',
          safeToRetry: false,
        });
      }
      if (error instanceof EvmPublicTestnetTransactionReplacedError) {
        return transactionReplaced();
      }
      if (error instanceof EvmPublicTestnetTransactionRevertedError) {
        return transactionReverted();
      }
      if (error instanceof EvmPublicTestnetEvidenceMismatchError) return evidenceRejected();
      if (error instanceof EvmPublicTestnetRpcUnavailableError) return unavailable(response);
      return unavailable(response);
    }
  }

  @Post('withdrawal-intents')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Prepare the next exact full-position Base Sepolia withdrawal step',
    description:
      'Returns either a fixed maximum aWETH approval or, when maximum allowance already exists, one fixed full native-ETH withdrawal. The browser wallet remains the only broadcaster.',
  })
  @ApiCreatedResponse({ description: 'The next exact approval or full-withdrawal transaction' })
  @ApiBadRequestResponse({ description: 'Body is malformed or contains unsupported fields' })
  @ApiUnauthorizedResponse({ description: 'Missing session, exact origin, or CSRF proof' })
  @ApiNotFoundResponse({ description: 'The isolated local public-testnet demo is disabled' })
  @ApiResponse({ status: 409, description: 'No aWETH position is available to withdraw' })
  @ApiResponse({ status: 422, description: 'The fixed deployment or withdrawal simulation failed' })
  @ApiResponse({ status: 503, description: 'The fixed RPC or withdrawal capacity is unavailable' })
  async createWithdrawalIntent(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): Promise<EvmPublicTestnetWithdrawalIntentResponse> {
    let parsed: ReturnType<typeof parseEvmPublicTestnetWithdrawalBody>;
    try {
      parsed = parseEvmPublicTestnetWithdrawalBody(body);
    } catch (error) {
      return badBody(error);
    }
    if (this.withdrawals === undefined) throw new NotFoundException('Not found');
    try {
      return await this.withdrawals.createIntent(principal.accountId, parsed);
    } catch (error) {
      if (error instanceof EvmPublicTestnetWithdrawalIntentNotFoundError) {
        throw new NotFoundException('Not found');
      }
      if (error instanceof EvmPublicTestnetWithdrawalEmptyPositionError) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'No Base Sepolia aWETH position is available to withdraw',
          code: 'EVM_PUBLIC_TESTNET_WITHDRAWAL_EMPTY_POSITION',
          safeToRetry: false,
        });
      }
      if (
        error instanceof EvmPublicTestnetPreflightRejectedError ||
        error instanceof EvmPublicTestnetEvidenceMismatchError
      ) {
        return evidenceRejected();
      }
      if (
        error instanceof EvmPublicTestnetRpcUnavailableError ||
        error instanceof EvmPublicTestnetWithdrawalIntentCapacityError
      ) {
        return unavailable(response);
      }
      return unavailable(response);
    }
  }

  @Post('withdrawal-intents/:intentId/submissions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify or recover one reviewed Base Sepolia withdrawal step',
    description:
      'Accepts one exact wallet hash or an empty object for read-only nonce-and-event recovery. It never signs, broadcasts, or retries a transaction.',
  })
  @ApiParam({ name: 'intentId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ description: 'Pending, latest-confirmed, or finalized-and-verified evidence' })
  async verifyWithdrawalSubmission(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('intentId') intentIdValue: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): Promise<EvmPublicTestnetWithdrawalVerificationResponse> {
    let intentId: string;
    let parsed: ReturnType<typeof parseEvmPublicTestnetWithdrawalSubmissionBody>;
    try {
      intentId = parseEvmPublicTestnetWithdrawalIntentId(intentIdValue);
      parsed = parseEvmPublicTestnetWithdrawalSubmissionBody(body);
    } catch (error) {
      return badBody(error);
    }
    if (this.withdrawals === undefined) throw new NotFoundException('Not found');
    try {
      return await this.withdrawals.verifySubmission(principal.accountId, intentId, parsed);
    } catch (error) {
      if (error instanceof EvmPublicTestnetWithdrawalIntentNotFoundError) {
        throw new NotFoundException('Not found');
      }
      if (error instanceof EvmPublicTestnetWithdrawalIntentConflictError) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'The withdrawal intent is bound to different transaction evidence',
          code: 'EVM_PUBLIC_TESTNET_WITHDRAWAL_INTENT_CONFLICT',
          safeToRetry: false,
        });
      }
      if (error instanceof EvmPublicTestnetTransactionReplacedError) {
        return transactionReplaced();
      }
      if (error instanceof EvmPublicTestnetTransactionRevertedError) {
        return transactionReverted();
      }
      if (error instanceof EvmPublicTestnetEvidenceMismatchError) return evidenceRejected();
      if (error instanceof EvmPublicTestnetRpcUnavailableError) return unavailable(response);
      return unavailable(response);
    }
  }
}
