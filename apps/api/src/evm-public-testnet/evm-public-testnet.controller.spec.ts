import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpStatus,
  NotFoundException,
  RequestMethod,
  UnprocessableEntityException,
  type HttpException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import type { CurrentPrincipal } from '../accounts/auth/current-principal';
import { parseAccountId } from '../accounts/domain/account-profile';
import { loggingContext } from '../infrastructure/logging';
import { EVM_PUBLIC_TESTNET_CHAIN_ID } from './evm-public-testnet.constants';
import { EvmPublicTestnetController } from './evm-public-testnet.controller';
import {
  EvmPublicTestnetEvidenceMismatchError,
  EvmPublicTestnetRpcUnavailableError,
  EvmPublicTestnetTransactionReplacedError,
  EvmPublicTestnetTransactionRevertedError,
} from './evm-public-testnet.rpc';
import {
  EvmPublicTestnetIntentConflictError,
  EvmPublicTestnetIntentExpiredError,
  EvmPublicTestnetIntentNotFoundError,
  type EvmPublicTestnetExecutionService,
  type EvmPublicTestnetIntentResponse,
  type EvmPublicTestnetPositionResponse,
  type EvmPublicTestnetVerificationResponse,
} from './evm-public-testnet.service';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const CORRELATION = Object.freeze({
  correlationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  initiatorActorId: ACCOUNT_ID,
});
const INTENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const HASH = `0x${'ab'.repeat(32)}`;
const PRINCIPAL: CurrentPrincipal = Object.freeze({ accountId: ACCOUNT_ID });
const BODY = Object.freeze({
  portfolioSnapshotId: 'local-demo-portfolio:0123456789abcdef0123456789abcdef',
  selection: Object.freeze({
    kind: 'PRESET' as const,
    presetId: 'BALANCED' as const,
    liquidReserveBasisPoints: 0,
  }),
  chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
  account: ACCOUNT,
});
const POSITION_BODY = Object.freeze({ chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account: ACCOUNT });
const INTENT_RESPONSE = Object.freeze({ intentId: INTENT_ID }) as EvmPublicTestnetIntentResponse;
const POSITION_RESPONSE = Object.freeze({
  use: 'EVM_PUBLIC_TESTNET_READ_ONLY_POSITION',
}) as EvmPublicTestnetPositionResponse;
const VERIFICATION_RESPONSE = Object.freeze({
  intentId: INTENT_ID,
  status: 'PENDING' as const,
  confirmation: 'LATEST_RECEIPT_AND_FINALITY_OBSERVATION' as const,
  transaction: Object.freeze({
    status: 'PENDING' as const,
    transactionHash: HASH,
    blockNumber: null,
    blockHash: null,
  }),
  position: Object.freeze({
    status: 'PENDING' as const,
    aTokenBalanceBeforeAtomic: '0',
    aTokenBalanceAfterAtomic: null,
    increaseAtomic: null,
  }),
  consumed: false,
}) as EvmPublicTestnetVerificationResponse;

function fixture(): {
  readonly controller: EvmPublicTestnetController;
  readonly executions: {
    createIntent: jest.Mock;
    readPosition: jest.Mock;
    verifySubmission: jest.Mock;
  };
  readonly headers: Map<string, string>;
  readonly response: { setHeader(name: string, value: string): void };
} {
  const executions = {
    createIntent: jest.fn(async () => INTENT_RESPONSE),
    readPosition: jest.fn(async () => POSITION_RESPONSE),
    verifySubmission: jest.fn(async () => VERIFICATION_RESPONSE),
  };
  const headers = new Map<string, string>();
  return {
    executions,
    headers,
    response: { setHeader: (name, value) => headers.set(name, value) },
    controller: new EvmPublicTestnetController(
      executions as unknown as EvmPublicTestnetExecutionService,
    ),
  };
}

async function captureRejected(run: () => Promise<unknown>): Promise<HttpException> {
  try {
    await run();
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected rejection');
}

describe('EvmPublicTestnetController', () => {
  it('publishes only isolated EVM POST routes', () => {
    const prototype = EvmPublicTestnetController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, EvmPublicTestnetController)).toBe(
      'public-testnet/evm',
    );
    for (const [method, path, status] of [
      [prototype.createIntent, 'execution-intents', 201],
      [prototype.readPosition, 'positions/query', 200],
      [prototype.verifySubmission, 'execution-intents/:intentId/submissions', 200],
    ] as const) {
      expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(path);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, method)).toBe(status);
    }
  });

  it('passes only authenticated account, active correlation, and exact intent request', async () => {
    const { controller, executions, response } = fixture();
    await expect(
      loggingContext.run(CORRELATION, () => controller.createIntent(PRINCIPAL, BODY, response)),
    ).resolves.toBe(INTENT_RESPONSE);
    expect(executions.createIntent).toHaveBeenCalledWith(ACCOUNT_ID, CORRELATION, BODY);
  });

  it('accepts exact hash evidence and empty read-only recovery', async () => {
    const { controller, executions, response } = fixture();
    await controller.verifySubmission(PRINCIPAL, INTENT_ID, { transactionHash: HASH }, response);
    await controller.verifySubmission(PRINCIPAL, INTENT_ID, {}, response);
    expect(executions.verifySubmission).toHaveBeenNthCalledWith(1, ACCOUNT_ID, INTENT_ID, {
      transactionHash: HASH,
    });
    expect(executions.verifySubmission).toHaveBeenNthCalledWith(2, ACCOUNT_ID, INTENT_ID, {});
  });

  it('rejects caller-authored targets and alternate submission fields', async () => {
    const { controller, executions, response } = fixture();
    await expect(
      loggingContext.run(CORRELATION, () =>
        controller.createIntent(PRINCIPAL, { ...BODY, gateway: ACCOUNT }, response),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.verifySubmission(
        PRINCIPAL,
        INTENT_ID,
        { transactionHash: HASH, retry: true },
        response,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(executions.createIntent).not.toHaveBeenCalled();
    expect(executions.verifySubmission).not.toHaveBeenCalled();
  });

  it.each([
    [new EvmPublicTestnetIntentNotFoundError(), NotFoundException, 404],
    [new EvmPublicTestnetIntentExpiredError(), GoneException, 410],
    [new EvmPublicTestnetIntentConflictError(), ConflictException, 409],
    [new EvmPublicTestnetEvidenceMismatchError(), UnprocessableEntityException, 422],
    [new EvmPublicTestnetTransactionRevertedError(), UnprocessableEntityException, 422],
    [new EvmPublicTestnetTransactionReplacedError(), ConflictException, 409],
  ] as const)('maps terminal and mismatch error %p to %p', async (failure, kind, status) => {
    const { controller, executions, response } = fixture();
    executions.verifySubmission.mockRejectedValueOnce(failure);
    const error = await captureRejected(() =>
      controller.verifySubmission(PRINCIPAL, INTENT_ID, { transactionHash: HASH }, response),
    );
    expect(error).toBeInstanceOf(kind);
    expect(error.getStatus()).toBe(status);
  });

  it('exposes safe-to-retry only for conclusive replacement and reversion', async () => {
    for (const [failure, code] of [
      [new EvmPublicTestnetTransactionReplacedError(), 'EVM_PUBLIC_TESTNET_TRANSACTION_REPLACED'],
      [new EvmPublicTestnetTransactionRevertedError(), 'EVM_PUBLIC_TESTNET_TRANSACTION_REVERTED'],
    ] as const) {
      const { controller, executions, response } = fixture();
      executions.verifySubmission.mockRejectedValueOnce(failure);
      const error = await captureRejected(() =>
        controller.verifySubmission(PRINCIPAL, INTENT_ID, {}, response),
      );
      expect(error.getResponse()).toEqual(expect.objectContaining({ code, safeToRetry: true }));
    }
  });

  it('sets a bounded retry hint for RPC unavailability', async () => {
    const { controller, executions, response, headers } = fixture();
    executions.readPosition.mockRejectedValueOnce(new EvmPublicTestnetRpcUnavailableError());
    const error = await captureRejected(() =>
      controller.readPosition(PRINCIPAL, POSITION_BODY, response),
    );
    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(headers.get('Retry-After')).toBe('1');
  });
});
