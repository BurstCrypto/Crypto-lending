import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EvmPublicTestnetTransactionProof,
  type EvmPublicTestnetDiscoveryPort,
  type EvmPublicTestnetProofDependencies,
} from '../components/portfolio/evm-public-testnet-transaction-proof';
import type { EvmPublicTestnetExecutionApi } from '../lib/evm-public-testnet/client';
import {
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
} from '../lib/evm-public-testnet/constants';
import {
  parseEvmPublicTestnetExecutionIntent,
  parseEvmPublicTestnetPositionSnapshot,
  parseEvmPublicTestnetSubmissionResult,
  type EvmPublicTestnetExecutionIntent,
  type EvmPublicTestnetSubmissionResult,
} from '../lib/evm-public-testnet/execution';
import {
  addEvmPublicTestnetRecoveryTransactionHash,
  EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY,
  startEvmPublicTestnetRecoveryJournal,
} from '../lib/evm-public-testnet/recovery-journal';
import type {
  InjectedProviderDescriptor,
  SelectedEip1193Provider,
} from '../lib/wallets/eip1193/discovery';
import {
  EvmPublicTestnetWalletError,
  type EvmPublicTestnetWalletPort,
} from '../lib/wallets/eip1193/public-testnet-executor';
import { PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY } from '../lib/public-testnet/public-testnet-recovery-journal';
import {
  EVM_PUBLIC_TESTNET_ACCOUNT,
  EVM_PUBLIC_TESTNET_INTENT_ID,
  EVM_PUBLIC_TESTNET_NOW,
  EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
  evmPublicTestnetIntentResponse,
  evmPublicTestnetPositionResponse,
  evmPublicTestnetRequest,
  evmPublicTestnetSubmissionResponse,
} from './evm-public-testnet.fixtures';
import { ZERO_LIQUID_BALANCED_PREVIEW } from './local-demo-yield.fixtures';

const NETWORK = Object.freeze({
  chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
  providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
  displayName: 'Base Sepolia',
  environment: 'TESTNET' as const,
});

const DESCRIPTOR: InjectedProviderDescriptor = Object.freeze({
  selectionId: 'metamask:1',
  connectorId: 'metamask',
  displayName: 'MetaMask',
  supportedNetworks: [NETWORK],
});

const SELECTED: SelectedEip1193Provider = Object.freeze({
  descriptor: DESCRIPTOR,
  provider: {} as SelectedEip1193Provider['provider'],
});

function parsedIntent(funding: 'READY' | 'NEEDS_BASE_SEPOLIA_ETH' = 'READY') {
  const ready = evmPublicTestnetIntentResponse();
  const response: unknown =
    funding === 'NEEDS_BASE_SEPOLIA_ETH'
      ? {
          ...ready,
          fundingReadiness: {
            ...ready.fundingReadiness,
            status: funding,
            nativeBalanceWei: '99999999999999',
          },
        }
      : ready;
  return parseEvmPublicTestnetExecutionIntent(
    response,
    evmPublicTestnetRequest(),
    EVM_PUBLIC_TESTNET_NOW,
  );
}

function parsedSubmission(
  status: 'PENDING' | 'CONFIRMED' | 'VERIFIED',
  transactionHash: string | null = EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
): EvmPublicTestnetSubmissionResult {
  return parseEvmPublicTestnetSubmissionResult(
    evmPublicTestnetSubmissionResponse(status, transactionHash),
    { intentId: EVM_PUBLIC_TESTNET_INTENT_ID, transactionHash },
  );
}

interface WalletHarness {
  readonly port: EvmPublicTestnetWalletPort;
  readonly send: ReturnType<typeof vi.fn>;
}

function wallet(overrides: Partial<EvmPublicTestnetWalletPort> = {}): WalletHarness {
  const send = vi.fn(async () => ({ transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH }));
  const port: EvmPublicTestnetWalletPort = {
    connect: vi.fn(async () => EVM_PUBLIC_TESTNET_ACCOUNT),
    readSnapshot: vi.fn(async () => ({
      account: EVM_PUBLIC_TESTNET_ACCOUNT,
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
      correctNetwork: true as const,
    })),
    sendTransaction: send,
    subscribeInvalidation: vi.fn(() => vi.fn()),
    dispose: vi.fn(),
    ...overrides,
  };
  return { port, send: port.sendTransaction as ReturnType<typeof vi.fn> };
}

function discovery(): EvmPublicTestnetDiscoveryPort {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    list: () => [DESCRIPTOR],
    subscribe: () => vi.fn(),
    select: (selectionId) => (selectionId === DESCRIPTOR.selectionId ? SELECTED : null),
  };
}

interface DependencyHarness {
  readonly value: EvmPublicTestnetProofDependencies;
  readonly prepare: ReturnType<typeof vi.fn>;
  readonly submit: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
}

function dependencies(
  selectedWallet: EvmPublicTestnetWalletPort,
  intent: EvmPublicTestnetExecutionIntent = parsedIntent(),
): DependencyHarness {
  const position = parseEvmPublicTestnetPositionSnapshot(evmPublicTestnetPositionResponse(), {
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: EVM_PUBLIC_TESTNET_ACCOUNT,
  });
  const prepare = vi.fn(async () => intent);
  const submit = vi.fn(async () => parsedSubmission('VERIFIED'));
  const query = vi.fn(async () => parsedSubmission('PENDING', null));
  const api = {
    prepare,
    submit,
    query,
    queryPosition: vi.fn(async () => position),
  } as EvmPublicTestnetExecutionApi;
  return {
    prepare,
    submit,
    query,
    value: {
      createApi: () => api,
      createDiscovery: discovery,
      createWallet: () => selectedWallet,
      now: () => EVM_PUBLIC_TESTNET_NOW,
    },
  };
}

async function connectReview(): Promise<void> {
  fireEvent.click(
    await screen.findByRole('button', { name: 'Review 0.00005 ETH EVM testnet proof' }),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Connect MetaMask' }));
}

async function openReadyReview(): Promise<void> {
  await connectReview();
  await screen.findByRole('button', { name: 'Submit Base Sepolia transaction' });
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('EvmPublicTestnetTransactionProof', () => {
  it('shows exact official faucet instructions before a wallet with insufficient ETH can send', async () => {
    const selectedWallet = wallet();
    const harness = dependencies(selectedWallet.port, parsedIntent('NEEDS_BASE_SEPOLIA_ETH'));
    render(
      <EvmPublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );

    await connectReview();

    const fundingTitle = await screen.findByText('Free Base Sepolia ETH is needed');
    const funding = fundingTitle.closest<HTMLElement>('[role="status"]');
    if (funding === null) throw new Error('Expected the funding status container');
    expect(within(funding).getByText('Free Base Sepolia ETH is needed')).toBeInTheDocument();
    expect(within(funding).getByText(/choose Base Sepolia/iu)).toBeInTheDocument();
    expect(within(funding).getByText(/paste the connected public address/iu)).toBeInTheDocument();
    expect(within(funding).getByText(/0\.0001 test ETH/iu)).toBeInTheDocument();
    expect(
      within(funding).getByText(/0\.00005 ETH deposit plus gas headroom/iu),
    ).toBeInTheDocument();
    expect(
      within(funding).getByRole('link', { name: /Open official Base faucet/u }),
    ).toHaveAttribute('href', 'https://portal.cdp.coinbase.com/products/faucet');
    expect(within(funding).getByRole('button', { name: 'Recheck Base Sepolia ETH' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Submit Base Sepolia transaction' })).toBeNull();
    expect(selectedWallet.send).not.toHaveBeenCalled();
  });

  it('journals before the one wallet send, confirms latest evidence, then verifies finality read-only', async () => {
    const selectedWallet = wallet();
    const harness = dependencies(selectedWallet.port);
    const recordsSeenByWallet: unknown[] = [];
    const recordsSeenByApi: unknown[] = [];
    selectedWallet.send.mockImplementationOnce(async () => {
      const serialized = window.sessionStorage.getItem(
        EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY,
      );
      expect(serialized).not.toBeNull();
      recordsSeenByWallet.push(JSON.parse(serialized!));
      return { transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH };
    });
    harness.submit
      .mockImplementationOnce(async () => {
        const serialized = window.sessionStorage.getItem(
          EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY,
        );
        expect(serialized).not.toBeNull();
        recordsSeenByApi.push(JSON.parse(serialized!));
        return parsedSubmission('CONFIRMED');
      })
      .mockImplementationOnce(async () => parsedSubmission('VERIFIED'));
    render(
      <EvmPublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );

    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Base Sepolia transaction' }));

    expect(await screen.findByText('Base Sepolia lending proof confirmed')).toBeInTheDocument();
    expect(recordsSeenByWallet).toEqual([
      expect.objectContaining({
        intentId: EVM_PUBLIC_TESTNET_INTENT_ID,
        account: EVM_PUBLIC_TESTNET_ACCOUNT,
        nonce: '0x7',
        transactionHash: null,
      }),
    ]);
    expect(recordsSeenByApi).toEqual([
      expect.objectContaining({ transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH }),
    ]);
    expect(
      window.sessionStorage.getItem(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY),
    ).toBeNull();
    expect(selectedWallet.send).toHaveBeenCalledTimes(1);
    expect(harness.submit).toHaveBeenNthCalledWith(
      1,
      EVM_PUBLIC_TESTNET_INTENT_ID,
      EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
      expect.any(AbortSignal),
    );
    expect(screen.getByRole('link', { name: /View Base Sepolia transaction/u })).toHaveAttribute(
      'href',
      `https://sepolia-explorer.base.org/tx/${EVM_PUBLIC_TESTNET_TRANSACTION_HASH}`,
    );
    expect(screen.getAllByText('CONFIRMED')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Check Base finality' }));
    expect(await screen.findByText('Base Sepolia lending proof finalized')).toBeInTheDocument();
    expect(screen.getAllByText('VERIFIED')).toHaveLength(2);
    expect(harness.submit).toHaveBeenCalledTimes(2);
    expect(selectedWallet.send).toHaveBeenCalledTimes(1);
  });

  it('claims the reviewed intent before the first wallet await and ignores a rapid duplicate click', async () => {
    const snapshot = {
      account: EVM_PUBLIC_TESTNET_ACCOUNT,
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
      correctNetwork: true as const,
    };
    let resolveSubmissionSnapshot!: (value: typeof snapshot) => void;
    const pendingSubmissionSnapshot = new Promise<typeof snapshot>((resolve) => {
      resolveSubmissionSnapshot = resolve;
    });
    const readSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot)
      .mockImplementationOnce(async () => pendingSubmissionSnapshot);
    const selectedWallet = wallet({ readSnapshot });
    const harness = dependencies(selectedWallet.port);
    render(
      <EvmPublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );

    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    const submit = screen.getByRole('button', { name: 'Submit Base Sepolia transaction' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(readSnapshot).toHaveBeenCalledTimes(2);
    expect(selectedWallet.send).not.toHaveBeenCalled();
    await act(async () => resolveSubmissionSnapshot(snapshot));
    await waitFor(() => expect(selectedWallet.send).toHaveBeenCalledTimes(1));
    expect(harness.submit).toHaveBeenCalledTimes(1);
  });

  it('prepares and submits a distinct second deposit after the first is confirmed', async () => {
    const secondIntentId = '22222222-2222-4222-8222-222222222222';
    const secondTransactionHash = `0x${'77'.repeat(32)}`;
    const firstIntent = parsedIntent();
    const secondIntent = parseEvmPublicTestnetExecutionIntent(
      evmPublicTestnetIntentResponse(secondIntentId, '0x8'),
      evmPublicTestnetRequest(),
      EVM_PUBLIC_TESTNET_NOW,
    );
    const selectedWallet = wallet();
    selectedWallet.send
      .mockResolvedValueOnce({ transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH })
      .mockResolvedValueOnce({ transactionHash: secondTransactionHash });
    const harness = dependencies(selectedWallet.port);
    harness.prepare.mockResolvedValueOnce(firstIntent).mockResolvedValueOnce(secondIntent);
    harness.submit.mockImplementation(async (intentId: string, transactionHash: string) =>
      parseEvmPublicTestnetSubmissionResult(
        evmPublicTestnetSubmissionResponse('CONFIRMED', transactionHash, intentId),
        { intentId, transactionHash },
      ),
    );
    render(
      <EvmPublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );

    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Base Sepolia transaction' }));
    expect(await screen.findByText('Base Sepolia lending proof confirmed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review another 0.00005 ETH deposit' }));
    const secondSubmit = await screen.findByRole('button', {
      name: 'Submit Base Sepolia transaction',
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(secondSubmit);

    await waitFor(() => expect(selectedWallet.send).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Base Sepolia lending proof confirmed')).toBeInTheDocument();
    expect(harness.prepare).toHaveBeenCalledTimes(2);
    expect(harness.submit).toHaveBeenNthCalledWith(
      2,
      secondIntentId,
      secondTransactionHash,
      expect.any(AbortSignal),
    );
    expect(
      window.sessionStorage.getItem(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY),
    ).toBeNull();
  });

  it('clears only the EVM journal after an explicit user rejection', async () => {
    const selectedWallet = wallet({
      sendTransaction: vi.fn(async () => {
        throw new EvmPublicTestnetWalletError('USER_REJECTED');
      }),
    });
    const harness = dependencies(selectedWallet.port);
    window.sessionStorage.setItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY, 'svm-lock-sentinel');
    render(
      <EvmPublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );

    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Base Sepolia transaction' }));

    expect(
      await screen.findByText(
        'The wallet rejected the request. No Base Sepolia transaction was submitted.',
      ),
    ).toBeInTheDocument();
    expect(
      window.sessionStorage.getItem(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY),
    ).toBeNull();
    expect(window.sessionStorage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(
      'svm-lock-sentinel',
    );
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.query).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  });

  it('retains a hashless EVM lock after an ambiguous send and permits only recovery queries', async () => {
    const selectedWallet = wallet({
      sendTransaction: vi.fn(async () => {
        throw new EvmPublicTestnetWalletError('COMMIT_AMBIGUOUS');
      }),
    });
    const harness = dependencies(selectedWallet.port);
    harness.query.mockImplementation(async () => parsedSubmission('PENDING', null));
    render(
      <EvmPublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );

    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Base Sepolia transaction' }));

    expect(
      await screen.findByText(/safety lock prevents a duplicate deposit/iu),
    ).toBeInTheDocument();
    const storedBeforeRecovery = window.sessionStorage.getItem(
      EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY,
    );
    expect(storedBeforeRecovery).not.toBeNull();
    expect(JSON.parse(storedBeforeRecovery!)).toMatchObject({
      intentId: EVM_PUBLIC_TESTNET_INTENT_ID,
      transactionHash: null,
    });
    expect(harness.submit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Check EVM verification' }));
    await waitFor(() =>
      expect(harness.query).toHaveBeenCalledWith(
        EVM_PUBLIC_TESTNET_INTENT_ID,
        expect.any(AbortSignal),
      ),
    );
    expect(await screen.findByText(/server is checking the prepared nonce/iu)).toBeInTheDocument();
    expect(window.sessionStorage.getItem(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBe(
      storedBeforeRecovery,
    );
    expect(harness.submit).not.toHaveBeenCalled();
    expect(selectedWallet.send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  });

  it('resumes a known-hash journal by verifying that hash instead of scanning hashless logs', async () => {
    const selectedWallet = wallet();
    const harness = dependencies(selectedWallet.port);
    harness.submit.mockImplementation(async () => parsedSubmission('CONFIRMED'));
    const prepared = parsedIntent();
    const hashless = startEvmPublicTestnetRecoveryJournal({
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      intentId: prepared.intentId,
      account: prepared.account,
      nonce: prepared.transaction.nonce,
      evidenceExpiresAt: prepared.evidenceExpiresAt,
    });
    addEvmPublicTestnetRecoveryTransactionHash(hashless, EVM_PUBLIC_TESTNET_TRANSACTION_HASH);

    render(
      <EvmPublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );

    expect(await screen.findByText('Base Sepolia lending proof confirmed')).toBeInTheDocument();
    expect(harness.submit).toHaveBeenCalledWith(
      EVM_PUBLIC_TESTNET_INTENT_ID,
      EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
      expect.any(AbortSignal),
    );
    expect(harness.query).not.toHaveBeenCalled();
    expect(selectedWallet.send).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY),
    ).toBeNull();
  });

  it('persists a returned hash even when wallet invalidation aborts the active UI generation', async () => {
    let invalidate!: () => void;
    let resolveSend!: (result: { transactionHash: string }) => void;
    const pendingSend = new Promise<{ transactionHash: string }>((resolve) => {
      resolveSend = resolve;
    });
    const selectedWallet = wallet({
      sendTransaction: vi.fn(async () => pendingSend),
      subscribeInvalidation: vi.fn((listener: () => void) => {
        invalidate = listener;
        return vi.fn();
      }),
    });
    const harness = dependencies(selectedWallet.port);
    render(
      <EvmPublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );

    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Base Sepolia transaction' }));
    await waitFor(() => expect(selectedWallet.send).toHaveBeenCalledTimes(1));
    act(() => invalidate());
    await act(async () => resolveSend({ transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH }));

    await waitFor(() => {
      const stored = window.sessionStorage.getItem(EVM_PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toMatchObject({
        intentId: EVM_PUBLIC_TESTNET_INTENT_ID,
        transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
      });
    });
    expect(harness.submit).not.toHaveBeenCalled();
  });
});
