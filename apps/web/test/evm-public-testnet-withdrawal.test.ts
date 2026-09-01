import { describe, expect, it, vi } from 'vitest';

import type { AuthenticationFetch } from '../lib/authentication/http';
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
  evmPublicTestnetWithdrawalResultExpectation,
  parseEvmPublicTestnetWithdrawalIntent,
  parseEvmPublicTestnetWithdrawalResult,
  type EvmPublicTestnetWithdrawalStep,
} from '../lib/evm-public-testnet/withdrawal';
import {
  EVM_PUBLIC_TESTNET_WITHDRAWAL_INTENTS_PATH,
  EvmPublicTestnetWithdrawalApiClient,
} from '../lib/evm-public-testnet/withdrawal-client';
import {
  createDefaultEvmPublicTestnetFullWithdrawalController,
  EvmPublicTestnetWithdrawalProviderUnavailableError,
} from '../lib/evm-public-testnet/withdrawal-default-controller';
import {
  addEvmPublicTestnetWithdrawalRecoveryTransactionHash,
  clearEvmPublicTestnetWithdrawalRecoveryJournal,
  EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY,
  EvmPublicTestnetWithdrawalRecoveryJournalError,
  readEvmPublicTestnetWithdrawalRecoveryJournal,
  startEvmPublicTestnetWithdrawalRecoveryJournal,
  type EvmPublicTestnetWithdrawalRecoveryJournalStorage,
} from '../lib/evm-public-testnet/withdrawal-recovery-journal';
import type {
  InjectedProviderDescriptor,
  SelectedEip1193Provider,
} from '../lib/wallets/eip1193/discovery';
import type { Eip1193Provider } from '../lib/wallets/eip1193/provider';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const INTENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HASH = `0x${'11'.repeat(32)}`;
const NOW = new Date('2026-09-01T15:00:00.000Z');
const CSRF = 'c'.repeat(43);

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

function intentResponse(step: EvmPublicTestnetWithdrawalStep = 'APPROVE_AWETH') {
  const allowanceBefore = step === 'APPROVE_AWETH' ? '0' : EVM_PUBLIC_TESTNET_MAX_UINT256;
  return {
    use: 'EVM_PUBLIC_TESTNET_FULL_POSITION_WITHDRAWAL_ONLY',
    mayAuthorizeMainnetFinancialAction: false,
    intentId: INTENT_ID,
    expiresAt: '2026-09-01T15:05:00.000Z',
    evidenceExpiresAt: '2026-09-01T16:00:00.000Z',
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: ACCOUNT,
    step,
    position: {
      assetSymbol: 'ETH',
      assetDecimals: 18,
      aTokenBalanceBeforeAtomic: '100',
      fullPosition: true,
    },
    allowance: {
      token: EVM_PUBLIC_TESTNET_ATOKEN,
      spender: EVM_PUBLIC_TESTNET_GATEWAY,
      beforeAtomic: allowanceBefore,
      requiredAtomic: EVM_PUBLIC_TESTNET_MAX_UINT256,
    },
    transaction: {
      from: ACCOUNT,
      to: step === 'APPROVE_AWETH' ? EVM_PUBLIC_TESTNET_ATOKEN : EVM_PUBLIC_TESTNET_GATEWAY,
      value: EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX,
      input: evmPublicTestnetWithdrawalInput(step, ACCOUNT, INTENT_ID),
      nonce: '0x7',
      chainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
    },
    liveObservation: {
      confirmation: 'LATEST_WITHDRAWAL_PREFLIGHT_OBSERVATION',
      blockNumber: '100',
      blockHash: `0x${'aa'.repeat(32)}`,
      observedAt: NOW.toISOString(),
      nativeBalanceWei: '1000000000000000',
    },
    providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER',
  };
}

function verificationResponse(
  step: EvmPublicTestnetWithdrawalStep,
  status: 'PENDING' | 'CONFIRMED' | 'VERIFIED',
  hash: string | null = HASH,
) {
  const pending = status === 'PENDING';
  return {
    intentId: INTENT_ID,
    step,
    status,
    confirmation: 'LATEST_RECEIPT_AND_FINALITY_OBSERVATION',
    transaction: {
      status,
      transactionHash: hash,
      blockNumber: pending ? null : '101',
      blockHash: pending ? null : `0x${'bb'.repeat(32)}`,
    },
    effect: {
      amountAtomic: pending
        ? null
        : step === 'APPROVE_AWETH'
          ? EVM_PUBLIC_TESTNET_MAX_UINT256
          : '100',
      aTokenBalanceBeforeAtomic: '100',
      aTokenBalanceAfterAtomic: pending ? null : step === 'APPROVE_AWETH' ? '101' : '0',
      allowanceBeforeAtomic: step === 'APPROVE_AWETH' ? '0' : EVM_PUBLIC_TESTNET_MAX_UINT256,
      allowanceAfterAtomic: pending ? null : EVM_PUBLIC_TESTNET_MAX_UINT256,
    },
    consumed: !pending,
  };
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('EVM public-testnet withdrawal browser contract', () => {
  it.each(['APPROVE_AWETH', 'WITHDRAW_FULL_ETH'] as const)(
    'accepts only the exact fixed %s intent',
    (step) => {
      const request = { chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account: ACCOUNT } as const;
      const parsed = parseEvmPublicTestnetWithdrawalIntent(intentResponse(step), request, NOW);
      expect(parsed).toMatchObject({ step, account: ACCOUNT, transaction: { value: '0x0' } });

      expect(() =>
        parseEvmPublicTestnetWithdrawalIntent(
          {
            ...intentResponse(step),
            transaction: { ...intentResponse(step).transaction, to: ACCOUNT },
          },
          request,
          NOW,
        ),
      ).toThrow();
      expect(() =>
        parseEvmPublicTestnetWithdrawalIntent(
          {
            ...intentResponse(step),
            transaction: {
              ...intentResponse(step).transaction,
              input: `${intentResponse(step).transaction.input.slice(0, -1)}${
                intentResponse(step).transaction.input.endsWith('0') ? '1' : '0'
              }`,
            },
          },
          request,
          NOW,
        ),
      ).toThrow();
    },
  );

  it('requires maximum post-approval allowance and zero post-withdrawal aWETH', () => {
    const approval = parseEvmPublicTestnetWithdrawalIntent(
      intentResponse('APPROVE_AWETH'),
      { chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account: ACCOUNT },
      NOW,
    );
    expect(
      parseEvmPublicTestnetWithdrawalResult(
        verificationResponse('APPROVE_AWETH', 'CONFIRMED'),
        evmPublicTestnetWithdrawalResultExpectation(approval),
        HASH,
      ),
    ).toMatchObject({ status: 'CONFIRMED' });
    expect(() =>
      parseEvmPublicTestnetWithdrawalResult(
        {
          ...verificationResponse('APPROVE_AWETH', 'CONFIRMED'),
          effect: {
            ...verificationResponse('APPROVE_AWETH', 'CONFIRMED').effect,
            allowanceAfterAtomic: '1',
          },
        },
        evmPublicTestnetWithdrawalResultExpectation(approval),
        HASH,
      ),
    ).toThrow();

    const withdrawal = parseEvmPublicTestnetWithdrawalIntent(
      intentResponse('WITHDRAW_FULL_ETH'),
      { chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account: ACCOUNT },
      NOW,
    );
    expect(() =>
      parseEvmPublicTestnetWithdrawalResult(
        {
          ...verificationResponse('WITHDRAW_FULL_ETH', 'VERIFIED'),
          effect: {
            ...verificationResponse('WITHDRAW_FULL_ETH', 'VERIFIED').effect,
            aTokenBalanceAfterAtomic: '1',
          },
        },
        evmPublicTestnetWithdrawalResultExpectation(withdrawal),
        HASH,
      ),
    ).toThrow();
  });

  it('uses strict same-origin prepare, submit, and hashless recovery requests', async () => {
    const fetch = vi
      .fn<AuthenticationFetch>()
      .mockResolvedValueOnce(response(201, intentResponse('APPROVE_AWETH')))
      .mockResolvedValueOnce(response(200, verificationResponse('APPROVE_AWETH', 'CONFIRMED')))
      .mockResolvedValueOnce(response(200, verificationResponse('APPROVE_AWETH', 'VERIFIED')));
    const client = new EvmPublicTestnetWithdrawalApiClient({
      fetch,
      cookieHeader: `__Host-cl_csrf=${CSRF}`,
      now: () => NOW,
    });
    const prepared = await client.prepare({
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      account: ACCOUNT,
    });
    const expected = evmPublicTestnetWithdrawalResultExpectation(prepared);

    await expect(client.submit(expected, { transactionHash: HASH })).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
    await expect(client.query(expected)).resolves.toMatchObject({ status: 'VERIFIED' });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      EVM_PUBLIC_TESTNET_WITHDRAWAL_INTENTS_PATH,
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
    const submissionPath = `${EVM_PUBLIC_TESTNET_WITHDRAWAL_INTENTS_PATH}/${INTENT_ID}/submissions`;
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      submissionPath,
      expect.objectContaining({ body: JSON.stringify({ transactionHash: HASH }) }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      submissionPath,
      expect.objectContaining({ body: '{}' }),
    );
  });

  it('atomically persists each withdrawal step and blocks it behind a deposit recovery lock', () => {
    const storage = new MemoryStorage();
    const parsed = parseEvmPublicTestnetWithdrawalIntent(
      intentResponse('APPROVE_AWETH'),
      { chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account: ACCOUNT },
      NOW,
    );
    const start = {
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      step: parsed.step,
      intentId: parsed.intentId,
      account: parsed.account,
      nonce: parsed.transaction.nonce,
      evidenceExpiresAt: parsed.evidenceExpiresAt,
      aTokenBalanceBeforeAtomic: parsed.position.aTokenBalanceBeforeAtomic,
      allowanceBeforeAtomic: parsed.allowance.beforeAtomic,
    } as const;
    const unsigned = startEvmPublicTestnetWithdrawalRecoveryJournal(start, storage);
    const signed = addEvmPublicTestnetWithdrawalRecoveryTransactionHash(unsigned, HASH, storage);
    expect(readEvmPublicTestnetWithdrawalRecoveryJournal(storage)).toEqual(signed);
    clearEvmPublicTestnetWithdrawalRecoveryJournal(signed, storage);
    expect(storage.values.has(EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(
      false,
    );

    storage.values.set(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY, '{"pending":true}');
    expect(() => startEvmPublicTestnetWithdrawalRecoveryJournal(start, storage)).toThrow(
      EvmPublicTestnetWithdrawalRecoveryJournalError,
    );
  });

  it('constructs the default controller from a uniquely matching account without a wallet prompt', async () => {
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }) => {
        if (method === 'eth_accounts') return [ACCOUNT];
        throw new Error(`unexpected prompted method ${method}`);
      }),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const descriptor: InjectedProviderDescriptor = {
      selectionId: 'selection-1',
      connectorId: 'metamask',
      displayName: 'MetaMask',
      supportedNetworks: [
        {
          chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
          providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
          displayName: 'Base Sepolia',
          environment: 'TESTNET',
        },
      ],
    };
    const selection: SelectedEip1193Provider = { descriptor, provider };
    const discovery = {
      start: vi.fn(),
      stop: vi.fn(),
      list: vi.fn(() => [descriptor]),
      select: vi.fn(() => selection),
    };

    const controller = await createDefaultEvmPublicTestnetFullWithdrawalController(ACCOUNT, {
      discovery,
      discoveryWindowMilliseconds: 0,
      accountReadMilliseconds: 10,
      storage: new MemoryStorage(),
    });

    expect(controller.getSnapshot()).toMatchObject({ status: 'IDLE', ready: true });
    expect(provider.request).toHaveBeenCalledTimes(1);
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_accounts' });
    controller.dispose();
  });

  it('fails closed when multiple providers cannot be matched uniquely', async () => {
    const descriptor = (selectionId: string): InjectedProviderDescriptor => ({
      selectionId,
      connectorId: 'metamask',
      displayName: 'MetaMask',
      supportedNetworks: [
        {
          chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
          providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
          displayName: 'Base Sepolia',
          environment: 'TESTNET',
        },
      ],
    });
    const selections = ['one', 'two'].map((id) => ({
      descriptor: descriptor(id),
      provider: {
        request: vi.fn(async () => []),
        on: vi.fn(),
        removeListener: vi.fn(),
      } satisfies Eip1193Provider,
    }));
    const discovery = {
      start: vi.fn(),
      stop: vi.fn(),
      list: vi.fn(() => selections.map(({ descriptor: value }) => value)),
      select: vi.fn(
        (id: string) =>
          selections.find(({ descriptor: value }) => value.selectionId === id) ?? null,
      ),
    };

    await expect(
      createDefaultEvmPublicTestnetFullWithdrawalController(ACCOUNT, {
        discovery,
        discoveryWindowMilliseconds: 0,
        accountReadMilliseconds: 10,
      }),
    ).rejects.toBeInstanceOf(EvmPublicTestnetWithdrawalProviderUnavailableError);
  });
});
