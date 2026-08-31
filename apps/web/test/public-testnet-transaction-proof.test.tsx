import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Wallet } from '@wallet-standard/base';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PublicTestnetTransactionProof,
  type PublicTestnetDiscoveryPort,
  type PublicTestnetProofDependencies,
} from '../components/portfolio/public-testnet-transaction-proof';
import {
  PublicTestnetApiError,
  type PublicTestnetExecutionApi,
} from '../lib/public-testnet/public-testnet-client';
import type { PublicTestnetExecutionIntent } from '../lib/public-testnet/public-testnet-execution';
import {
  PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY,
  startPublicTestnetRecoveryJournal,
  startSignedPublicTestnetRecoveryJournal,
} from '../lib/public-testnet/public-testnet-recovery-journal';
import type { SelectedSolanaWallet, SolanaWalletDescriptor } from '../lib/wallets/solana/discovery';
import {
  SolanaPublicTestnetWalletError,
  type SolanaPublicTestnetWalletPort,
} from '../lib/wallets/solana/public-testnet-executor';
import { expectProviderPrivateDom } from './local-demo-provider-privacy';
import { ZERO_LIQUID_BALANCED_PREVIEW } from './local-demo-yield.fixtures';
import {
  PUBLIC_TESTNET_ACCOUNT,
  PUBLIC_TESTNET_INTENT_ID,
  PUBLIC_TESTNET_NOW,
  PUBLIC_TESTNET_SIGNATURE,
  publicTestnetIntent,
  publicTestnetPosition,
  publicTestnetRequest,
  publicTestnetSubmission,
} from './public-testnet.fixtures';

const DESCRIPTOR: SolanaWalletDescriptor = {
  selectionId: 'phantom:1',
  displayName: 'Phantom',
  supportedTransactionVersions: ['legacy', 0],
};
const SELECTED: SelectedSolanaWallet = {
  descriptor: DESCRIPTOR,
  wallet: {} as Wallet,
};

interface WalletHarness {
  readonly port: SolanaPublicTestnetWalletPort;
  readonly sign: ReturnType<typeof vi.fn>;
  invalidate(): void;
}

interface DependencyHarness {
  readonly value: PublicTestnetProofDependencies;
  readonly api: PublicTestnetExecutionApi & {
    readonly createIntent: ReturnType<typeof vi.fn>;
    readonly submitTransaction: ReturnType<typeof vi.fn>;
    readonly submitSignedTransaction: ReturnType<typeof vi.fn>;
    readonly readPosition: ReturnType<typeof vi.fn>;
  };
}

function discovery(): PublicTestnetDiscoveryPort {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    list: () => [DESCRIPTOR],
    subscribe: () => vi.fn(),
    select: (selectionId) => (selectionId === DESCRIPTOR.selectionId ? SELECTED : null),
  };
}

function wallet(overrides: Partial<SolanaPublicTestnetWalletPort> = {}): WalletHarness {
  let invalidation = (): void => undefined;
  const sign = vi.fn(async () => ({
    signature: PUBLIC_TESTNET_SIGNATURE,
    serializedTransaction: Uint8Array.of(1, 2, 3),
  }));
  const port: SolanaPublicTestnetWalletPort = {
    connect: vi.fn(async () => PUBLIC_TESTNET_ACCOUNT),
    readSnapshot: vi.fn(async () => ({
      account: PUBLIC_TESTNET_ACCOUNT,
      correctNetwork: true as const,
    })),
    signTransaction: sign,
    subscribeInvalidation: vi.fn((listener: () => void) => {
      invalidation = listener;
      return () => {
        invalidation = (): void => undefined;
      };
    }),
    dispose: vi.fn(),
    ...overrides,
  };
  return {
    port,
    sign: port.signTransaction as ReturnType<typeof vi.fn>,
    invalidate: () => invalidation(),
  };
}

function dependencies(
  selectedWallet: SolanaPublicTestnetWalletPort,
  nextIntent: PublicTestnetExecutionIntent = publicTestnetIntent(),
): DependencyHarness {
  const api = {
    createIntent: vi.fn(async () => nextIntent),
    submitTransaction: vi.fn(async () => publicTestnetSubmission()),
    submitSignedTransaction: vi.fn(async () => publicTestnetSubmission()),
    readPosition: vi.fn(async () => publicTestnetPosition('EMPTY')),
  };
  return {
    api,
    value: {
      createApi: () => api,
      createDiscovery: discovery,
      createWallet: () => selectedWallet,
      now: () => PUBLIC_TESTNET_NOW,
    },
  };
}

async function openReadyReview(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Review 0.01 SOL Devnet proof' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Connect Phantom' }));
  await screen.findByRole('button', { name: 'Submit Devnet transaction' });
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('PublicTestnetTransactionProof', () => {
  it('keeps the preview provider-private and discloses the bounded wallet fee prefix', async () => {
    const selectedWallet = wallet();
    const harness = dependencies(selectedWallet.port);
    const rendered = render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Submit Devnet transaction' })).toBeNull();
    expect(screen.getByText(/does not validate its APY/iu)).toBeInTheDocument();
    expectProviderPrivateDom(rendered.container);

    await openReadyReview();
    expect(screen.getByRole('button', { name: 'Submit Devnet transaction' })).toBeDisabled();
    expect(
      screen.getByText(/remains in the public testnet lending position/iu),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not withdraw it automatically/iu)).toBeInTheDocument();
    expect(
      screen.getByText(/SetComputeUnitPrice followed by SetComputeUnitLimit/u),
    ).toBeInTheDocument();
    expect(screen.getByText(/200,000 compute-unit limit/iu)).toBeInTheDocument();
    expect(screen.getByText(/0\.0001 SOL/iu)).toBeInTheDocument();
    expect(screen.getByText(/Inspect Phantom's total fee before approving/iu)).toBeInTheDocument();
    expect(harness.api.createIntent).toHaveBeenCalledWith(
      publicTestnetRequest(),
      expect.any(AbortSignal),
    );
  });

  it('publishes the connected position account without sending a transaction', async () => {
    const selectedWallet = wallet();
    const harness = dependencies(selectedWallet.port);
    const accountChanged = vi.fn();
    const positionRefreshRequested = vi.fn();
    render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
        onPositionAccountChange={accountChanged}
        onPositionRefreshRequested={positionRefreshRequested}
      />,
    );

    await openReadyReview();

    expect(accountChanged).toHaveBeenCalledWith(PUBLIC_TESTNET_ACCOUNT);
    expect(positionRefreshRequested).not.toHaveBeenCalled();
    expect(selectedWallet.sign).not.toHaveBeenCalled();
    expect(harness.api.submitTransaction).not.toHaveBeenCalled();
    expect(harness.api.submitSignedTransaction).not.toHaveBeenCalled();
    expect(harness.api.readPosition).not.toHaveBeenCalled();
  });

  it('sends exactly one wallet transaction and immediately binds its signature', async () => {
    const selectedWallet = wallet();
    const harness = dependencies(selectedWallet.port);
    const activity = vi.fn();
    const rendered = render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
        onWriteActivityChange={activity}
      />,
    );
    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Devnet transaction' }));

    expect(await screen.findByText('Live lending proof verified')).toBeInTheDocument();
    expect(selectedWallet.sign).toHaveBeenCalledTimes(1);
    expect(selectedWallet.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionVersion: 'legacy',
        minContextSlot: 400000000,
        serializedTransaction: expect.any(Uint8Array),
      }),
      PUBLIC_TESTNET_ACCOUNT,
      expect.any(AbortSignal),
    );
    expect(harness.api.submitSignedTransaction).toHaveBeenCalledWith(
      PUBLIC_TESTNET_INTENT_ID,
      PUBLIC_TESTNET_SIGNATURE,
      Uint8Array.of(1, 2, 3),
      expect.any(AbortSignal),
    );
    expect(screen.getByRole('link', { name: /View Devnet transaction/u })).toHaveAttribute(
      'href',
      `https://explorer.solana.com/tx/${PUBLIC_TESTNET_SIGNATURE}?cluster=devnet`,
    );
    expect(rendered.container.textContent).not.toMatch(/Morpho|Aave|Compound|Kamino|Save|Solend/iu);
    await waitFor(() => expect(activity).toHaveBeenLastCalledWith(false));
  });

  it('starts a second independently reviewed deposit after the first one is verified', async () => {
    const selectedWallet = wallet();
    const harness = dependencies(selectedWallet.port);
    render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );
    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Devnet transaction' }));

    const anotherDeposit = await screen.findByRole('button', {
      name: 'Review another 0.01 SOL deposit',
    });
    expect(selectedWallet.sign).toHaveBeenCalledTimes(1);
    expect(harness.api.submitSignedTransaction).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBeNull();

    fireEvent.click(anotherDeposit);
    const secondSubmit = await screen.findByRole('button', {
      name: 'Submit Devnet transaction',
    });
    expect(secondSubmit).toBeDisabled();
    expect(screen.queryByText('Live lending proof verified')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(secondSubmit);

    expect(await screen.findByText('Live lending proof verified')).toBeInTheDocument();
    expect(selectedWallet.port.connect).toHaveBeenCalledTimes(1);
    expect(selectedWallet.sign).toHaveBeenCalledTimes(2);
    expect(harness.api.createIntent).toHaveBeenCalledTimes(4);
    expect(harness.api.submitSignedTransaction).toHaveBeenCalledTimes(2);
    expect(harness.api.submitTransaction).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBeNull();
  });

  it('refreshes the reviewed intent on final submit before opening Phantom', async () => {
    const events: string[] = [];
    const selectedWallet = wallet({
      signTransaction: vi.fn(async () => {
        events.push('sign');
        return {
          signature: PUBLIC_TESTNET_SIGNATURE,
          serializedTransaction: Uint8Array.of(1, 2, 3),
        };
      }),
    });
    const expiringIntent: PublicTestnetExecutionIntent = {
      ...publicTestnetIntent(),
      expiresAt: '2026-08-27T12:00:29.000Z',
    };
    const refreshedIntent: PublicTestnetExecutionIntent = {
      ...publicTestnetIntent(),
      intentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      transaction: {
        ...publicTestnetIntent().transaction,
        minContextSlot: '400000123',
      },
    };
    const harness = dependencies(selectedWallet.port, expiringIntent);
    harness.api.createIntent
      .mockResolvedValueOnce(expiringIntent)
      .mockImplementationOnce(async () => {
        events.push('refresh');
        return refreshedIntent;
      });
    render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );
    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Devnet transaction' }));

    expect(await screen.findByText('Live lending proof verified')).toBeInTheDocument();
    expect(harness.api.createIntent).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['refresh', 'sign']);
    expect(selectedWallet.sign).toHaveBeenCalledWith(
      expect.objectContaining({ minContextSlot: 400000123 }),
      PUBLIC_TESTNET_ACCOUNT,
      expect.any(AbortSignal),
    );
    expect(harness.api.submitSignedTransaction).toHaveBeenCalledWith(
      refreshedIntent.intentId,
      PUBLIC_TESTNET_SIGNATURE,
      Uint8Array.of(1, 2, 3),
      expect.any(AbortSignal),
    );
  });

  it('does not broadcast when Phantom returns a signature inside the final ten seconds', async () => {
    let now = PUBLIC_TESTNET_NOW;
    const selectedWallet = wallet({
      signTransaction: vi.fn(async () => {
        now = new Date(PUBLIC_TESTNET_NOW.getTime() + 51_000);
        return {
          signature: PUBLIC_TESTNET_SIGNATURE,
          serializedTransaction: Uint8Array.of(1, 2, 3),
        };
      }),
    });
    const harness = dependencies(selectedWallet.port);
    render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={{ ...harness.value, now: () => now }}
      />,
    );
    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Devnet transaction' }));

    expect(await screen.findByText(/too close to blockhash expiry/iu)).toBeInTheDocument();
    expect(selectedWallet.sign).toHaveBeenCalledTimes(1);
    expect(harness.api.submitSignedTransaction).not.toHaveBeenCalled();
    expect(harness.api.submitTransaction).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBeNull();
  });

  it('shows only the official faucet and explicitly rechecks Devnet funding', async () => {
    const selectedWallet = wallet();
    const needsFunding = publicTestnetIntent('NEEDS_DEVNET_SOL');
    const ready = publicTestnetIntent('READY');
    const harness = dependencies(selectedWallet.port, needsFunding);
    harness.api.createIntent.mockResolvedValueOnce(needsFunding).mockResolvedValueOnce(ready);
    render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Review 0.01 SOL Devnet proof' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Phantom' }));

    expect(await screen.findByText('Free Devnet SOL is needed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /official Solana faucet/u })).toHaveAttribute(
      'href',
      'https://faucet.solana.com/',
    );
    expect(screen.getByText(/0\.02 Devnet SOL/iu)).toBeInTheDocument();
    expect(screen.getByText(/heuristic, not a fee guarantee/iu)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recheck Devnet SOL' }));
    expect(await screen.findByRole('button', { name: 'Submit Devnet transaction' })).toBeDisabled();
    expect(harness.api.createIntent).toHaveBeenCalledTimes(2);
  });

  it('polls pending server verification with the same signature and never resends', async () => {
    const selectedWallet = wallet();
    const harness = dependencies(selectedWallet.port);
    harness.api.submitSignedTransaction.mockResolvedValueOnce(publicTestnetSubmission('PENDING'));
    harness.api.submitTransaction.mockResolvedValueOnce(publicTestnetSubmission('VERIFIED'));
    const activity = vi.fn();
    render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
        onWriteActivityChange={activity}
      />,
    );
    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Devnet transaction' }));

    const verifyAgain = await screen.findByRole('button', { name: 'Check server verification' });
    expect(
      screen.getByText(/transaction and position evidence are still pending/iu),
    ).toBeInTheDocument();
    expect(selectedWallet.sign).toHaveBeenCalledTimes(1);
    expect(harness.api.submitSignedTransaction).toHaveBeenCalledTimes(1);
    expect(harness.api.submitTransaction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(activity).toHaveBeenLastCalledWith(true);
    const unload = new Event('beforeunload', { cancelable: true });
    expect(globalThis.dispatchEvent(unload)).toBe(false);

    fireEvent.click(verifyAgain);
    expect(await screen.findByText('Live lending proof verified')).toBeInTheDocument();
    expect(selectedWallet.sign).toHaveBeenCalledTimes(1);
    expect(harness.api.submitSignedTransaction).toHaveBeenCalledTimes(1);
    expect(harness.api.submitTransaction).toHaveBeenCalledTimes(1);
    for (const call of harness.api.submitTransaction.mock.calls) {
      expect(call[0]).toBe(PUBLIC_TESTNET_INTENT_ID);
      expect(call[1]).toBe(PUBLIC_TESTNET_SIGNATURE);
      expect(call[2]).toBeInstanceOf(AbortSignal);
    }
  });

  it('requests a read-only position refresh after server rejection without resending', async () => {
    const selectedWallet = wallet();
    const harness = dependencies(selectedWallet.port);
    const positionRefreshRequested = vi.fn();
    harness.api.submitSignedTransaction.mockRejectedValue(new PublicTestnetApiError('REJECTED'));
    render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
        onPositionRefreshRequested={positionRefreshRequested}
      />,
    );
    await openReadyReview();
    const refreshesBeforeSubmission = positionRefreshRequested.mock.calls.length;

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Devnet transaction' }));

    expect(
      await screen.findByText(/signed transaction or its finalized evidence was rejected/iu),
    ).toBeInTheDocument();
    expect(selectedWallet.sign).toHaveBeenCalledTimes(1);
    expect(harness.api.submitSignedTransaction).toHaveBeenCalledTimes(1);
    expect(harness.api.submitTransaction).not.toHaveBeenCalled();
    expect(positionRefreshRequested.mock.calls.length).toBeGreaterThan(refreshesBeforeSubmission);
  });

  it('clears recovery after a definite RPC rejection that did not broadcast', async () => {
    const selectedWallet = wallet();
    const harness = dependencies(selectedWallet.port);
    harness.api.submitSignedTransaction.mockRejectedValue(
      new PublicTestnetApiError('BROADCAST_REJECTED'),
    );
    render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );
    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Devnet transaction' }));

    expect(await screen.findByText(/Nothing was submitted/iu)).toBeInTheDocument();
    expect(selectedWallet.sign).toHaveBeenCalledTimes(1);
    expect(harness.api.submitSignedTransaction).toHaveBeenCalledTimes(1);
    expect(harness.api.submitTransaction).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole('link', { name: /View Devnet transaction/u })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
  });

  it('does not broadcast when wallet invalidation aborts deferred signing', async () => {
    let resolveSignature!: (signature: string) => void;
    const pendingSignature = new Promise<string>((resolve) => {
      resolveSignature = resolve;
    });
    const selectedWallet = wallet({
      signTransaction: vi.fn(async () => ({
        signature: await pendingSignature,
        serializedTransaction: Uint8Array.of(1, 2, 3),
      })),
    });
    const harness = dependencies(selectedWallet.port);
    const activity = vi.fn();
    render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
        onWriteActivityChange={activity}
      />,
    );
    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Devnet transaction' }));
    await waitFor(() => expect(selectedWallet.sign).toHaveBeenCalledTimes(1));

    act(() => selectedWallet.invalidate());
    await act(async () => resolveSignature(PUBLIC_TESTNET_SIGNATURE));

    expect(await screen.findByText(/Phantom account changed/iu)).toBeInTheDocument();
    expect(selectedWallet.sign).toHaveBeenCalledTimes(1);
    expect(harness.api.submitSignedTransaction).not.toHaveBeenCalled();
    expect(harness.api.submitTransaction).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /View Devnet transaction/u })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    expect(window.sessionStorage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBeNull();
    expect(activity).toHaveBeenLastCalledWith(false);
  });

  it('does not leave a lock or broadcast when the tab unmounts during signing', async () => {
    let resolveSignature!: (signature: string) => void;
    const pendingSignature = new Promise<string>((resolve) => {
      resolveSignature = resolve;
    });
    const selectedWallet = wallet({
      signTransaction: vi.fn(async () => ({
        signature: await pendingSignature,
        serializedTransaction: Uint8Array.of(1, 2, 3),
      })),
    });
    const harness = dependencies(selectedWallet.port);
    const rendered = render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );
    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Devnet transaction' }));
    await waitFor(() => expect(selectedWallet.sign).toHaveBeenCalledTimes(1));

    rendered.unmount();
    await act(async () => resolveSignature(PUBLIC_TESTNET_SIGNATURE));

    expect(harness.api.submitSignedTransaction).not.toHaveBeenCalled();
    expect(harness.api.submitTransaction).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBeNull();
  });

  it('does not broadcast a signed transaction when recovery storage is unavailable', async () => {
    const selectedWallet = wallet();
    const harness = dependencies(selectedWallet.port);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );
    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Devnet transaction' }));

    expect(
      await screen.findByText(/signed the transaction.*did not broadcast/iu),
    ).toBeInTheDocument();
    expect(selectedWallet.sign).toHaveBeenCalledTimes(1);
    expect(harness.api.submitTransaction).not.toHaveBeenCalled();
    expect(harness.api.submitSignedTransaction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    expect(window.sessionStorage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBeNull();
  });

  it('restores a known signature after reload and performs only read-only same-signature polling', async () => {
    const selectedWallet = wallet();
    const harness = dependencies(selectedWallet.port);
    harness.api.submitSignedTransaction.mockResolvedValueOnce(publicTestnetSubmission('PENDING'));
    harness.api.submitTransaction.mockResolvedValueOnce(publicTestnetSubmission('VERIFIED'));
    const first = render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );
    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Devnet transaction' }));
    await screen.findByRole('button', { name: 'Check server verification' });
    expect(selectedWallet.sign).toHaveBeenCalledTimes(1);
    first.unmount();

    render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );
    const recoveredPoll = await screen.findByRole('button', {
      name: 'Check server verification',
    });
    expect(screen.getByText(/Recovered a known Devnet signature/iu)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit Devnet transaction' })).toBeNull();
    expect(selectedWallet.sign).toHaveBeenCalledTimes(1);

    fireEvent.click(recoveredPoll);
    expect(await screen.findByText('Live lending proof verified')).toBeInTheDocument();
    expect(selectedWallet.sign).toHaveBeenCalledTimes(1);
    expect(harness.api.submitTransaction).toHaveBeenLastCalledWith(
      PUBLIC_TESTNET_INTENT_ID,
      PUBLIC_TESTNET_SIGNATURE,
      expect.any(AbortSignal),
    );
  });

  it('clears unsigned recovery when the sign-only wallet request fails before broadcast', async () => {
    const selectedWallet = wallet({
      signTransaction: vi.fn(async () => {
        throw new SolanaPublicTestnetWalletError('REQUEST_PENDING');
      }),
    });
    const harness = dependencies(selectedWallet.port);
    const first = render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );
    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Devnet transaction' }));

    expect(await screen.findByText(/did not broadcast anything/iu)).toBeInTheDocument();
    expect(selectedWallet.sign).toHaveBeenCalledTimes(1);
    expect(harness.api.submitTransaction).not.toHaveBeenCalled();
    expect(harness.api.submitSignedTransaction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    expect(window.sessionStorage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY)).toBeNull();
    first.unmount();

    render(
      <PublicTestnetTransactionProof
        preview={ZERO_LIQUID_BALANCED_PREVIEW}
        dependencies={harness.value}
      />,
    );
    expect(
      await screen.findByRole('button', { name: 'Review 0.01 SOL Devnet proof' }),
    ).toBeEnabled();
    expect(selectedWallet.sign).toHaveBeenCalledTimes(1);
  });

  it('automatically expires an unsigned safety lock without enabling a duplicate send', async () => {
    vi.useFakeTimers();
    let rendered: ReturnType<typeof render> | null = null;
    try {
      vi.setSystemTime(PUBLIC_TESTNET_NOW);
      const evidenceExpiresAt = new Date(PUBLIC_TESTNET_NOW.getTime() + 1_000).toISOString();
      startPublicTestnetRecoveryJournal({
        intentId: PUBLIC_TESTNET_INTENT_ID,
        account: PUBLIC_TESTNET_ACCOUNT,
        evidenceExpiresAt,
      });
      const selectedWallet = wallet();
      const harness = dependencies(selectedWallet.port);
      rendered = render(
        <PublicTestnetTransactionProof
          preview={ZERO_LIQUID_BALANCED_PREVIEW}
          dependencies={{ ...harness.value, now: () => new Date(Date.now()) }}
        />,
      );
      await act(async () => {
        vi.runAllTicks();
        await Promise.resolve();
      });

      expect(screen.getByText(/Safety lock ends automatically after/iu)).toHaveTextContent(
        evidenceExpiresAt,
      );
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Submit Devnet transaction' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Check lock status now' }));
      await act(async () => {
        vi.runAllTicks();
        await Promise.resolve();
      });
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();

      act(() => vi.advanceTimersByTime(500));
      act(() => globalThis.dispatchEvent(new Event('focus')));
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
      await act(async () => {
        vi.advanceTimersByTime(500);
        vi.runAllTicks();
        await Promise.resolve();
      });

      expect(screen.getByRole('button', { name: 'Review 0.01 SOL Devnet proof' })).toBeEnabled();
      expect(selectedWallet.sign).not.toHaveBeenCalled();
      expect(harness.api.submitTransaction).not.toHaveBeenCalled();
      expect(harness.api.submitSignedTransaction).not.toHaveBeenCalled();
    } finally {
      rendered?.unmount();
      vi.useRealTimers();
    }
  });

  it('never auto-clears a known-signature lock from an elapsed evidence deadline', async () => {
    vi.useFakeTimers();
    let rendered: ReturnType<typeof render> | null = null;
    try {
      vi.setSystemTime(PUBLIC_TESTNET_NOW);
      const evidenceExpiresAt = new Date(PUBLIC_TESTNET_NOW.getTime() + 1_000).toISOString();
      startSignedPublicTestnetRecoveryJournal({
        intentId: PUBLIC_TESTNET_INTENT_ID,
        account: PUBLIC_TESTNET_ACCOUNT,
        evidenceExpiresAt,
        signature: PUBLIC_TESTNET_SIGNATURE,
      });
      const selectedWallet = wallet();
      const harness = dependencies(selectedWallet.port);
      rendered = render(
        <PublicTestnetTransactionProof
          preview={ZERO_LIQUID_BALANCED_PREVIEW}
          dependencies={{ ...harness.value, now: () => new Date(Date.now()) }}
        />,
      );
      await act(async () => {
        vi.runAllTicks();
        await Promise.resolve();
      });

      expect(screen.getByText(/Recovered a known Devnet signature/iu)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
      await act(async () => {
        vi.advanceTimersByTime(1_000);
        vi.runAllTicks();
        await Promise.resolve();
      });

      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Review 0.01 SOL Devnet proof' })).toBeNull();
      expect(
        window.sessionStorage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY),
      ).not.toBeNull();
      expect(selectedWallet.sign).not.toHaveBeenCalled();
      expect(harness.api.submitTransaction).not.toHaveBeenCalled();
      expect(harness.api.submitSignedTransaction).not.toHaveBeenCalled();

      rendered.unmount();
      rendered = render(
        <PublicTestnetTransactionProof
          preview={ZERO_LIQUID_BALANCED_PREVIEW}
          dependencies={{ ...harness.value, now: () => new Date(Date.now()) }}
        />,
      );
      await act(async () => {
        vi.runAllTicks();
        await Promise.resolve();
      });

      expect(
        screen.getByText(/verification window ended without conclusive evidence/iu),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
      expect(
        window.sessionStorage.getItem(PUBLIC_TESTNET_RECOVERY_JOURNAL_STORAGE_KEY),
      ).not.toBeNull();
    } finally {
      rendered?.unmount();
      vi.useRealTimers();
    }
  });

  it('allows a stale archived preview to launch a mechanics-only proof', async () => {
    const stalePreview = {
      ...ZERO_LIQUID_BALANCED_PREVIEW,
      rateSnapshot: {
        ...ZERO_LIQUID_BALANCED_PREVIEW.rateSnapshot,
        freshness: 'STALE' as const,
      },
    };
    const harness = dependencies(wallet().port);
    render(<PublicTestnetTransactionProof preview={stalePreview} dependencies={harness.value} />);

    expect(screen.getByText(/managed blend above is an archived estimate/iu)).toBeInTheDocument();
    expect(screen.getByText(/proves Devnet mechanics only/iu)).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Review 0.01 SOL Devnet proof' }),
    ).toBeEnabled();
  });
});
