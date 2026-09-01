import { describe, expect, it } from 'vitest';

import {
  EVM_PUBLIC_TESTNET_AMOUNT_HEX,
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_GATEWAY,
} from '../lib/evm-public-testnet/constants';
import {
  evmPublicTestnetExplorerTransactionUrl,
  evmPublicTestnetWalletTransaction,
  normalizeEvmPublicTestnetAccount,
  parseEvmPublicTestnetExecutionIntent,
  parseEvmPublicTestnetPositionSnapshot,
  parseEvmPublicTestnetSubmissionResult,
  validateEvmPublicTestnetExecutionRequest,
} from '../lib/evm-public-testnet/execution';
import {
  EVM_PUBLIC_TESTNET_ACCOUNT,
  EVM_PUBLIC_TESTNET_INTENT_ID,
  EVM_PUBLIC_TESTNET_NOW,
  EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
  evmPublicTestnetInput,
  evmPublicTestnetIntentResponse,
  evmPublicTestnetPositionResponse,
  evmPublicTestnetRequest,
  evmPublicTestnetSubmissionResponse,
} from './evm-public-testnet.fixtures';

describe('EVM public-testnet execution boundary', () => {
  it('accepts only the exact Base Sepolia portfolio-bound request', () => {
    const parsed = validateEvmPublicTestnetExecutionRequest(evmPublicTestnetRequest());

    expect(parsed).toEqual(evmPublicTestnetRequest());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.selection)).toBe(true);
    expect(
      normalizeEvmPublicTestnetAccount(
        EVM_PUBLIC_TESTNET_ACCOUNT.toUpperCase().replace('0X', '0x'),
      ),
    ).toBe(EVM_PUBLIC_TESTNET_ACCOUNT);

    expect(() =>
      validateEvmPublicTestnetExecutionRequest({
        ...evmPublicTestnetRequest(),
        chainId: 'eip155:8453' as typeof EVM_PUBLIC_TESTNET_CHAIN_ID,
      }),
    ).toThrow();
    expect(() =>
      validateEvmPublicTestnetExecutionRequest({
        ...evmPublicTestnetRequest(),
        extra: true,
      } as never),
    ).toThrow();
  });

  it('parses one exact marked Aave gateway deposit and derives the wallet request', () => {
    const parsed = parseEvmPublicTestnetExecutionIntent(
      evmPublicTestnetIntentResponse(),
      evmPublicTestnetRequest(),
      EVM_PUBLIC_TESTNET_NOW,
    );

    expect(parsed).toMatchObject({
      use: 'EVM_PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY',
      mayAuthorizeMainnetFinancialAction: false,
      intentId: EVM_PUBLIC_TESTNET_INTENT_ID,
      transaction: {
        from: EVM_PUBLIC_TESTNET_ACCOUNT,
        to: EVM_PUBLIC_TESTNET_GATEWAY.toLowerCase(),
        value: EVM_PUBLIC_TESTNET_AMOUNT_HEX,
        nonce: '0x7',
      },
    });
    expect(evmPublicTestnetWalletTransaction(parsed)).toEqual({
      from: EVM_PUBLIC_TESTNET_ACCOUNT,
      to: EVM_PUBLIC_TESTNET_GATEWAY.toLowerCase(),
      value: EVM_PUBLIC_TESTNET_AMOUNT_HEX,
      data: evmPublicTestnetInput(),
      nonce: '0x7',
    });
  });

  it('rejects a missing, altered, or foreign intent marker and transaction mutation', () => {
    const mutations = [
      () => {
        const value = evmPublicTestnetIntentResponse();
        value.transaction.input = value.transaction.input.slice(0, -64) as `0x${string}`;
        return value;
      },
      () => {
        const value = evmPublicTestnetIntentResponse();
        value.transaction.input = evmPublicTestnetInput(
          EVM_PUBLIC_TESTNET_ACCOUNT,
          '22222222-2222-4222-8222-222222222222',
        );
        return value;
      },
      () => {
        const value = evmPublicTestnetIntentResponse();
        value.transaction.value = '0x1' as typeof value.transaction.value;
        return value;
      },
      () => {
        const value = evmPublicTestnetIntentResponse();
        value.transaction.nonce = '0x07';
        return value;
      },
      () => ({ ...evmPublicTestnetIntentResponse(), secret: 'not accepted' }),
    ];

    for (const mutate of mutations) {
      expect(() =>
        parseEvmPublicTestnetExecutionIntent(
          mutate(),
          evmPublicTestnetRequest(),
          EVM_PUBLIC_TESTNET_NOW,
        ),
      ).toThrow();
    }
  });

  it('accepts only self-consistent pending, confirmed, and verified observations', () => {
    for (const status of ['PENDING', 'CONFIRMED', 'VERIFIED'] as const) {
      const result = parseEvmPublicTestnetSubmissionResult(
        evmPublicTestnetSubmissionResponse(status),
        {
          intentId: EVM_PUBLIC_TESTNET_INTENT_ID,
          transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
        },
      );
      expect(result.status).toBe(status);
      expect(result.transaction.status).toBe(status);
      expect(result.position.status).toBe(status);
    }

    const hashless = parseEvmPublicTestnetSubmissionResult(
      evmPublicTestnetSubmissionResponse('PENDING', null),
      { intentId: EVM_PUBLIC_TESTNET_INTENT_ID, transactionHash: null },
    );
    expect(hashless.transaction.transactionHash).toBeNull();

    const inconsistent = evmPublicTestnetSubmissionResponse('CONFIRMED');
    inconsistent.consumed = false;
    expect(() =>
      parseEvmPublicTestnetSubmissionResult(inconsistent, {
        intentId: EVM_PUBLIC_TESTNET_INTENT_ID,
        transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
      }),
    ).toThrow();

    const replacementHash = `0x${'cd'.repeat(32)}`;
    expect(
      parseEvmPublicTestnetSubmissionResult(
        evmPublicTestnetSubmissionResponse('CONFIRMED', replacementHash),
        {
          intentId: EVM_PUBLIC_TESTNET_INTENT_ID,
          transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
        },
      ).transaction.transactionHash,
    ).toBe(replacementHash);
    expect(() =>
      parseEvmPublicTestnetSubmissionResult(
        evmPublicTestnetSubmissionResponse('PENDING', replacementHash),
        {
          intentId: EVM_PUBLIC_TESTNET_INTENT_ID,
          transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
        },
      ),
    ).toThrow();
  });

  it('parses a pinned Aave position and rejects provider or rate relabeling', () => {
    const parsed = parseEvmPublicTestnetPositionSnapshot(evmPublicTestnetPositionResponse(), {
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      account: EVM_PUBLIC_TESTNET_ACCOUNT,
    });

    expect(parsed).toMatchObject({
      use: 'EVM_PUBLIC_TESTNET_READ_ONLY_POSITION',
      provider: { name: 'Aave V3' },
      position: { status: 'OPEN', aTokenSymbol: 'aBaseSepoliaWETH' },
      rate: { supplyApyBasisPoints: 157, historyAvailable: false },
    });

    const validProvider = evmPublicTestnetPositionResponse();
    const wrongProvider = {
      ...validProvider,
      provider: { ...validProvider.provider, pool: EVM_PUBLIC_TESTNET_ACCOUNT },
    };
    expect(() =>
      parseEvmPublicTestnetPositionSnapshot(wrongProvider, {
        chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
        account: EVM_PUBLIC_TESTNET_ACCOUNT,
      }),
    ).toThrow();
  });

  it('constructs only the pinned Base Sepolia transaction explorer URL', () => {
    expect(evmPublicTestnetExplorerTransactionUrl(EVM_PUBLIC_TESTNET_TRANSACTION_HASH)).toBe(
      `https://sepolia-explorer.base.org/tx/${EVM_PUBLIC_TESTNET_TRANSACTION_HASH}`,
    );
    expect(() => evmPublicTestnetExplorerTransactionUrl('0x1234')).toThrow();
  });
});
