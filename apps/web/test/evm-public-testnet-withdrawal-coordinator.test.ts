import { describe, expect, it, vi } from 'vitest';

import {
  EVM_PUBLIC_TESTNET_ATOKEN,
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_GATEWAY,
  EVM_PUBLIC_TESTNET_MAX_UINT256,
  EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
  EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX,
} from '../lib/evm-public-testnet/constants';
import { EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY } from '../lib/evm-public-testnet/recovery-journal';
import {
  evmPublicTestnetWithdrawalInput,
  type EvmPublicTestnetWithdrawalIntent,
  type EvmPublicTestnetWithdrawalResult,
  type EvmPublicTestnetWithdrawalStatus,
  type EvmPublicTestnetWithdrawalStep,
} from '../lib/evm-public-testnet/withdrawal';
import type { EvmPublicTestnetWithdrawalApi } from '../lib/evm-public-testnet/withdrawal-client';
import { createEvmPublicTestnetFullWithdrawalController } from '../lib/evm-public-testnet/withdrawal-coordinator';
import {
  EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY,
  type EvmPublicTestnetWithdrawalRecoveryJournalStorage,
} from '../lib/evm-public-testnet/withdrawal-recovery-journal';
import {
  EvmPublicTestnetWalletError,
  type EvmPublicTestnetWithdrawalWalletPort,
} from '../lib/wallets/eip1193/public-testnet-executor';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const HASH_1 = `0x${'11'.repeat(32)}`;
const HASH_2 = `0x${'22'.repeat(32)}`;
const APPROVAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WITHDRAWAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

class MemoryStorage implements EvmPublicTestnetWithdrawalRecoveryJournalStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function intent(step: EvmPublicTestnetWithdrawalStep): EvmPublicTestnetWithdrawalIntent {
  const intentId = step === 'APPROVE_AWETH' ? APPROVAL_ID : WITHDRAWAL_ID;
  const allowanceBefore = step === 'APPROVE_AWETH' ? '0' : EVM_PUBLIC_TESTNET_MAX_UINT256;
  return Object.freeze({
    use: 'EVM_PUBLIC_TESTNET_FULL_POSITION_WITHDRAWAL_ONLY',
    mayAuthorizeMainnetFinancialAction: false,
    intentId,
    expiresAt: '2026-09-01T15:05:00.000Z',
    evidenceExpiresAt: '2026-09-01T16:00:00.000Z',
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: ACCOUNT,
    step,
    position: Object.freeze({
      assetSymbol: 'ETH',
      assetDecimals: 18,
      aTokenBalanceBeforeAtomic: '100',
      fullPosition: true,
    }),
    allowance: Object.freeze({
      token: EVM_PUBLIC_TESTNET_ATOKEN.toLowerCase(),
      spender: EVM_PUBLIC_TESTNET_GATEWAY.toLowerCase(),
      beforeAtomic: allowanceBefore,
      requiredAtomic: EVM_PUBLIC_TESTNET_MAX_UINT256,
    }),
    transaction: Object.freeze({
      from: ACCOUNT,
      to: (step === 'APPROVE_AWETH'
        ? EVM_PUBLIC_TESTNET_ATOKEN
        : EVM_PUBLIC_TESTNET_GATEWAY
      ).toLowerCase(),
      value: EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX,
      input: evmPublicTestnetWithdrawalInput(step, ACCOUNT, intentId),
      nonce: step === 'APPROVE_AWETH' ? ('0x1' as const) : ('0x2' as const),
      chainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
    }),
    liveObservation: Object.freeze({
      confirmation: 'LATEST_WITHDRAWAL_PREFLIGHT_OBSERVATION',
      blockNumber: '10',
      blockHash: `0x${'aa'.repeat(32)}`,
      observedAt: '2026-09-01T15:00:00.000Z',
      nativeBalanceWei: '1000000000000000',
    }),
    providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER',
  });
}

function result(
  step: EvmPublicTestnetWithdrawalStep,
  status: EvmPublicTestnetWithdrawalStatus,
  hashValue: string | null,
): EvmPublicTestnetWithdrawalResult {
  const pending = status === 'PENDING';
  return Object.freeze({
    intentId: step === 'APPROVE_AWETH' ? APPROVAL_ID : WITHDRAWAL_ID,
    step,
    status,
    confirmation: 'LATEST_RECEIPT_AND_FINALITY_OBSERVATION',
    transaction: Object.freeze({
      status,
      transactionHash: hashValue,
      blockNumber: pending ? null : '11',
      blockHash: pending ? null : `0x${'bb'.repeat(32)}`,
    }),
    effect: Object.freeze({
      amountAtomic: pending
        ? null
        : step === 'APPROVE_AWETH'
          ? EVM_PUBLIC_TESTNET_MAX_UINT256
          : '100',
      aTokenBalanceBeforeAtomic: '100',
      aTokenBalanceAfterAtomic: pending ? null : step === 'APPROVE_AWETH' ? '100' : '0',
      allowanceBeforeAtomic: step === 'APPROVE_AWETH' ? '0' : EVM_PUBLIC_TESTNET_MAX_UINT256,
      allowanceAfterAtomic: pending ? null : EVM_PUBLIC_TESTNET_MAX_UINT256,
    }),
    consumed: !pending,
  });
}

function wallet(sendResults: readonly (string | Error)[]): EvmPublicTestnetWithdrawalWalletPort {
  let sendIndex = 0;
  return {
    connect: vi.fn(async () => ACCOUNT),
    readSnapshot: vi.fn(async () => ({
      account: ACCOUNT,
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
      correctNetwork: true as const,
    })),
    sendTransaction: vi.fn(async () => ({ transactionHash: HASH_1 })),
    sendWithdrawalTransaction: vi.fn(async () => {
      const next = sendResults[sendIndex++];
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error('missing wallet fixture');
      return { transactionHash: next };
    }),
    subscribeInvalidation: vi.fn(() => () => undefined),
    dispose: vi.fn(),
  };
}

function api(
  overrides: Partial<EvmPublicTestnetWithdrawalApi> = {},
): EvmPublicTestnetWithdrawalApi {
  return {
    prepare: vi.fn(async () => intent('WITHDRAW_FULL_ETH')),
    submit: vi.fn(async () => result('WITHDRAW_FULL_ETH', 'VERIFIED', HASH_1)),
    query: vi.fn(async () => result('WITHDRAW_FULL_ETH', 'VERIFIED', HASH_1)),
    ...overrides,
  };
}

describe('EVM full-position withdrawal controller', () => {
  it('claims synchronously, polls approval to CONFIRMED, then sends one fresh withdrawal intent', async () => {
    const events: string[] = [];
    const withdrawalApi = api({
      prepare: vi
        .fn<EvmPublicTestnetWithdrawalApi['prepare']>()
        .mockImplementationOnce(async () => {
          events.push('prepare-approval');
          return intent('APPROVE_AWETH');
        })
        .mockImplementationOnce(async () => {
          events.push('prepare-withdrawal');
          return intent('WITHDRAW_FULL_ETH');
        }),
      submit: vi
        .fn<EvmPublicTestnetWithdrawalApi['submit']>()
        .mockImplementationOnce(async () => {
          events.push('submit-approval');
          return result('APPROVE_AWETH', 'PENDING', HASH_1);
        })
        .mockImplementationOnce(async () => {
          events.push('submit-withdrawal');
          return result('WITHDRAW_FULL_ETH', 'VERIFIED', HASH_2);
        }),
      query: vi.fn(async () => {
        events.push('query-approval');
        return result('APPROVE_AWETH', 'CONFIRMED', HASH_1);
      }),
    });
    const withdrawalWallet = wallet([HASH_1, HASH_2]);
    vi.mocked(withdrawalWallet.sendWithdrawalTransaction)
      .mockImplementationOnce(async () => {
        events.push('send-approval');
        return { transactionHash: HASH_1 };
      })
      .mockImplementationOnce(async () => {
        events.push('send-withdrawal');
        return { transactionHash: HASH_2 };
      });
    const storage = new MemoryStorage();
    const controller = createEvmPublicTestnetFullWithdrawalController({
      account: ACCOUNT,
      api: withdrawalApi,
      wallet: withdrawalWallet,
      storage,
      pollIntervalMilliseconds: 0,
      wait: vi.fn(async () => undefined),
    });

    const claim = controller.claim();
    expect(claim).not.toBeNull();
    expect(controller.claim()).toBeNull();
    await expect(controller.start(claim!)).resolves.toMatchObject({ status: 'COMPLETE' });

    expect(events).toEqual([
      'prepare-approval',
      'send-approval',
      'submit-approval',
      'query-approval',
      'prepare-withdrawal',
      'send-withdrawal',
      'submit-withdrawal',
    ]);
    expect(withdrawalWallet.sendWithdrawalTransaction).toHaveBeenCalledTimes(2);
    expect(storage.values.has(EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(
      false,
    );
    expect(controller.getSnapshot()).toMatchObject({ status: 'COMPLETE', locked: false });
  });

  it('skips approval at maximum allowance and retains a CONFIRMED withdrawal until finality', async () => {
    const withdrawalApi = api({
      submit: vi.fn(async () => result('WITHDRAW_FULL_ETH', 'CONFIRMED', HASH_1)),
      query: vi.fn(async () => result('WITHDRAW_FULL_ETH', 'VERIFIED', HASH_1)),
    });
    const withdrawalWallet = wallet([HASH_1]);
    const storage = new MemoryStorage();
    const controller = createEvmPublicTestnetFullWithdrawalController({
      account: ACCOUNT,
      api: withdrawalApi,
      wallet: withdrawalWallet,
      storage,
      withdrawalPollAttempts: 0,
    });

    const claim = controller.claim();
    await expect(controller.start(claim!)).resolves.toMatchObject({
      status: 'RECOVERY_REQUIRED',
    });
    expect(withdrawalWallet.sendWithdrawalTransaction).toHaveBeenCalledTimes(1);
    expect(storage.values.has(EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(
      true,
    );

    await expect(controller.recover()).resolves.toMatchObject({ status: 'COMPLETE' });
    expect(withdrawalWallet.sendWithdrawalTransaction).toHaveBeenCalledTimes(1);
    expect(storage.values.has(EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(
      false,
    );
  });

  it('retains an ambiguous wallet step and recovery never sends automatically', async () => {
    const withdrawalApi = api({
      query: vi.fn(async () => result('WITHDRAW_FULL_ETH', 'PENDING', null)),
    });
    const withdrawalWallet = wallet([new EvmPublicTestnetWalletError('COMMIT_AMBIGUOUS')]);
    const storage = new MemoryStorage();
    const controller = createEvmPublicTestnetFullWithdrawalController({
      account: ACCOUNT,
      api: withdrawalApi,
      wallet: withdrawalWallet,
      storage,
    });

    const claim = controller.claim();
    await expect(controller.start(claim!)).resolves.toMatchObject({
      status: 'RECOVERY_REQUIRED',
    });
    await expect(controller.recover()).resolves.toMatchObject({
      status: 'RECOVERY_REQUIRED',
    });

    expect(withdrawalWallet.sendWithdrawalTransaction).toHaveBeenCalledTimes(1);
    expect(storage.values.has(EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(
      true,
    );
  });

  it('blocks withdrawal claims while the independent deposit recovery journal exists', () => {
    const storage = new MemoryStorage();
    storage.values.set(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY, '{"pending":true}');
    const controller = createEvmPublicTestnetFullWithdrawalController({
      account: ACCOUNT,
      api: api(),
      wallet: wallet([HASH_1]),
      storage,
    });

    expect(controller.canClaim()).toBe(false);
    expect(controller.claim()).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({ locked: true, status: 'RECOVERY_REQUIRED' });
  });
});
