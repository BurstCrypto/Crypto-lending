import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpStatus,
  RequestMethod,
  type HttpException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Keypair } from '@solana/web3.js';

import type { CurrentPrincipal } from '../accounts/auth/current-principal';
import { parseAccountId } from '../accounts/domain/account-profile';
import { PUBLIC_TESTNET_CHAIN_ID } from './public-testnet-execution.constants';
import {
  PublicTestnetBroadcastAmbiguousError,
  PublicTestnetRpcUnavailableError,
} from './public-testnet-execution.rpc';
import {
  PublicTestnetIntentConflictError,
  PublicTestnetIntentExpiredError,
} from './public-testnet-execution.service';
import { PublicTestnetWithdrawalController } from './public-testnet-withdrawal.controller';
import type {
  PublicTestnetWithdrawalIntentResponse,
  PublicTestnetWithdrawalService,
  PublicTestnetWithdrawalVerificationResponse,
} from './public-testnet-withdrawal.service';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const PRINCIPAL: CurrentPrincipal = Object.freeze({ accountId: ACCOUNT_ID });
const ACCOUNT = Keypair.fromSeed(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1),
).publicKey.toBase58();
const INTENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SIGNATURE = '1'.repeat(64);
const INTENT_RESPONSE = Object.freeze({
  intentId: INTENT_ID,
}) as PublicTestnetWithdrawalIntentResponse;
const RESULT = Object.freeze({
  intentId: INTENT_ID,
  status: 'PENDING',
}) as PublicTestnetWithdrawalVerificationResponse;

function fixture(): {
  readonly controller: PublicTestnetWithdrawalController;
  readonly withdrawals: { createIntent: jest.Mock; verifySubmission: jest.Mock };
  readonly headers: Map<string, string>;
  readonly response: { setHeader(name: string, value: string): void };
} {
  const withdrawals = {
    createIntent: jest.fn(async () => INTENT_RESPONSE),
    verifySubmission: jest.fn(async () => RESULT),
  };
  const headers = new Map<string, string>();
  return {
    controller: new PublicTestnetWithdrawalController(
      withdrawals as unknown as PublicTestnetWithdrawalService,
    ),
    withdrawals,
    headers,
    response: { setHeader: (name: string, value: string) => headers.set(name, value) },
  };
}

async function capture(run: () => Promise<unknown>): Promise<HttpException> {
  try {
    await run();
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected rejection');
}

describe('PublicTestnetWithdrawalController', () => {
  it('publishes separate create and submission POST routes', () => {
    const prototype = PublicTestnetWithdrawalController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, PublicTestnetWithdrawalController)).toBe(
      'public-testnet',
    );
    for (const [method, path, status] of [
      [prototype.createIntent, 'withdrawal-intents', 201],
      [prototype.verifySubmission, 'withdrawal-intents/:intentId/submissions', 200],
    ] as const) {
      expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(path);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, method)).toBe(status);
    }
  });

  it('passes only the authenticated account and exact fixed-chain request', async () => {
    const { controller, withdrawals, response } = fixture();
    await expect(
      controller.createIntent(
        PRINCIPAL,
        { chainId: PUBLIC_TESTNET_CHAIN_ID, account: ACCOUNT },
        response,
      ),
    ).resolves.toBe(INTENT_RESPONSE);
    expect(withdrawals.createIntent).toHaveBeenCalledWith(ACCOUNT_ID, {
      chainId: PUBLIC_TESTNET_CHAIN_ID,
      account: ACCOUNT,
    });
  });

  it('accepts exact signed bytes or signature-only read recovery', async () => {
    const { controller, withdrawals, response } = fixture();
    await controller.verifySubmission(
      PRINCIPAL,
      INTENT_ID,
      { signature: SIGNATURE, signedTransactionBase64: 'AQ==' },
      response,
    );
    await controller.verifySubmission(PRINCIPAL, INTENT_ID, { signature: SIGNATURE }, response);
    expect(withdrawals.verifySubmission).toHaveBeenCalledTimes(2);
  });

  it('rejects alternate fields and maps recovery errors without exposing RPC detail', async () => {
    const { controller, withdrawals, response, headers } = fixture();
    await expect(
      controller.createIntent(
        PRINCIPAL,
        { chainId: PUBLIC_TESTNET_CHAIN_ID, account: ACCOUNT, amount: '1' },
        response,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    for (const [failure, kind, status] of [
      [new PublicTestnetIntentExpiredError(), GoneException, 410],
      [new PublicTestnetIntentConflictError(), ConflictException, 409],
    ] as const) {
      withdrawals.verifySubmission.mockRejectedValueOnce(failure);
      const error = await capture(() =>
        controller.verifySubmission(PRINCIPAL, INTENT_ID, { signature: SIGNATURE }, response),
      );
      expect(error).toBeInstanceOf(kind);
      expect(error.getStatus()).toBe(status);
    }
    withdrawals.verifySubmission.mockRejectedValueOnce(new PublicTestnetBroadcastAmbiguousError());
    expect(
      (
        await capture(() =>
          controller.verifySubmission(PRINCIPAL, INTENT_ID, { signature: SIGNATURE }, response),
        )
      ).getStatus(),
    ).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    withdrawals.verifySubmission.mockRejectedValueOnce(new PublicTestnetRpcUnavailableError());
    expect(
      (
        await capture(() =>
          controller.verifySubmission(PRINCIPAL, INTENT_ID, { signature: SIGNATURE }, response),
        )
      ).getStatus(),
    ).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(headers.get('Retry-After')).toBe('1');
  });
});
