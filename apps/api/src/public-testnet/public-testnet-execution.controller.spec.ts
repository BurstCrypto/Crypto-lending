jest.mock('rpc-websockets', () => ({ CommonClient: class {}, WebSocket: jest.fn() }));

import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpStatus,
  NotFoundException,
  RequestMethod,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { HttpException } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import type { CurrentPrincipal } from '../accounts/auth/current-principal';
import { parseAccountId } from '../accounts/domain/account-profile';
import { loggingContext } from '../infrastructure/logging';
import { PUBLIC_TESTNET_CHAIN_ID } from './public-testnet-execution.constants';
import { PublicTestnetExecutionController } from './public-testnet-execution.controller';
import {
  PublicTestnetIntentConflictError,
  PublicTestnetIntentExpiredError,
  PublicTestnetIntentNotFoundError,
  type PublicTestnetExecutionService,
  type PublicTestnetIntentResponse,
  type PublicTestnetVerificationResponse,
} from './public-testnet-execution.service';
import {
  PublicTestnetEvidenceMismatchError,
  PublicTestnetRpcUnavailableError,
} from './public-testnet-execution.rpc';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const CORRELATION = Object.freeze({
  correlationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  initiatorActorId: ACCOUNT_ID,
});
const INTENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SIGNATURE = '1'.repeat(64);
const PRINCIPAL: CurrentPrincipal = Object.freeze({ accountId: ACCOUNT_ID });
const BODY = Object.freeze({
  portfolioSnapshotId: 'local-demo-portfolio:0123456789abcdef0123456789abcdef',
  selection: Object.freeze({
    kind: 'PRESET' as const,
    presetId: 'BALANCED' as const,
    liquidReserveBasisPoints: 0,
  }),
  chainId: PUBLIC_TESTNET_CHAIN_ID,
  account: 'GvjoVKNjBvQcFaSKUW1gTE7DxhSpjHbE69umVR5nPuQp',
});
const SUBMISSION = Object.freeze({ signature: SIGNATURE });
const INTENT_RESPONSE = Object.freeze({ intentId: INTENT_ID }) as PublicTestnetIntentResponse;
const VERIFICATION_RESPONSE = Object.freeze({
  intentId: INTENT_ID,
  status: 'PENDING' as const,
  confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION' as const,
  transaction: Object.freeze({
    status: 'PENDING' as const,
    signature: SIGNATURE,
    slot: null,
  }),
  position: Object.freeze({
    status: 'PENDING' as const,
    collateralBalanceBeforeAtomic: '0',
    collateralBalanceAfterAtomic: null,
    increaseAtomic: null,
  }),
  consumed: false,
}) satisfies PublicTestnetVerificationResponse;

function fixture(): {
  controller: PublicTestnetExecutionController;
  executions: { createIntent: jest.Mock; verifySubmission: jest.Mock };
  headers: Map<string, string>;
  response: { setHeader(name: string, value: string): void };
} {
  const executions = {
    createIntent: jest.fn(async () => INTENT_RESPONSE),
    verifySubmission: jest.fn(async () => VERIFICATION_RESPONSE),
  };
  const headers = new Map<string, string>();
  return {
    executions,
    headers,
    response: { setHeader: (name, value) => headers.set(name, value) },
    controller: new PublicTestnetExecutionController(
      executions as unknown as PublicTestnetExecutionService,
    ),
  };
}

async function captureRejected(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected rejection');
}

describe('PublicTestnetExecutionController', () => {
  it('publishes only the intent and signature-submission POST routes', () => {
    const prototype = PublicTestnetExecutionController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, PublicTestnetExecutionController)).toBe(
      'public-testnet',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.createIntent)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, prototype.createIntent)).toBe('execution-intents');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.createIntent)).toBe(201);
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.verifySubmission)).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(PATH_METADATA, prototype.verifySubmission)).toBe(
      'execution-intents/:intentId/submissions',
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.verifySubmission)).toBe(200);
  });

  it('passes only the authenticated account, active correlation, and exact request', async () => {
    const { controller, executions, response } = fixture();
    await expect(
      loggingContext.run(CORRELATION, () => controller.createIntent(PRINCIPAL, BODY, response)),
    ).resolves.toBe(INTENT_RESPONSE);
    expect(executions.createIntent).toHaveBeenCalledWith(ACCOUNT_ID, CORRELATION, BODY);
  });

  it('rejects caller-authored targets and alternate submission fields', async () => {
    const { controller, executions, response } = fixture();
    await expect(
      loggingContext.run(CORRELATION, () =>
        controller.createIntent(PRINCIPAL, { ...BODY, reserve: 'attacker' }, response),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.verifySubmission(
        PRINCIPAL,
        INTENT_ID,
        { signature: SIGNATURE, raw: 'x' },
        response,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(executions.createIntent).not.toHaveBeenCalled();
    expect(executions.verifySubmission).not.toHaveBeenCalled();
  });

  it('binds one canonical signature to the principal-scoped intent', async () => {
    const { controller, executions, response } = fixture();
    await expect(
      controller.verifySubmission(PRINCIPAL, INTENT_ID, SUBMISSION, response),
    ).resolves.toBe(VERIFICATION_RESPONSE);
    expect(executions.verifySubmission).toHaveBeenCalledWith(ACCOUNT_ID, INTENT_ID, SUBMISSION);
  });

  it.each([
    [new PublicTestnetIntentNotFoundError(), NotFoundException, 404],
    [new PublicTestnetIntentExpiredError(), GoneException, 410],
    [new PublicTestnetIntentConflictError(), ConflictException, 409],
    [new PublicTestnetEvidenceMismatchError(), UnprocessableEntityException, 422],
  ] as const)(
    'maps verification failures without leaking internals',
    async (failure, kind, status) => {
      const { controller, executions, response } = fixture();
      executions.verifySubmission.mockRejectedValueOnce(failure);
      const error = await captureRejected(() =>
        controller.verifySubmission(PRINCIPAL, INTENT_ID, SUBMISSION, response),
      );
      expect(error).toBeInstanceOf(kind);
      expect((error as HttpException).getStatus()).toBe(status);
    },
  );

  it('sanitizes RPC failure and supplies a bounded retry hint', async () => {
    const { controller, executions, response, headers } = fixture();
    executions.verifySubmission.mockRejectedValueOnce(new PublicTestnetRpcUnavailableError());
    const error = await captureRejected(() =>
      controller.verifySubmission(PRINCIPAL, INTENT_ID, SUBMISSION, response),
    );
    expect((error as HttpException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(headers.get('Retry-After')).toBe('1');
  });
});
