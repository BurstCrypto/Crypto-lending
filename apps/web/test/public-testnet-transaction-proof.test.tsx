import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Wallet } from '@wallet-standard/base';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PublicTestnetTransactionProof,
  type PublicTestnetDiscoveryPort,
  type PublicTestnetProofDependencies,
} from '../components/portfolio/public-testnet-transaction-proof';
import type { PublicTestnetExecutionApi } from '../lib/public-testnet/public-testnet-client';
import type { PublicTestnetExecutionIntent } from '../lib/public-testnet/public-testnet-execution';
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
  readonly send: ReturnType<typeof vi.fn>;
  invalidate(): void;
}

interface DependencyHarness {
  readonly value: PublicTestnetProofDependencies;
  readonly api: PublicTestnetExecutionApi & {
    readonly createIntent: ReturnType<typeof vi.fn>;
    readonly submitTransaction: ReturnType<typeof vi.fn>;
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
  const send = vi.fn(async () => PUBLIC_TESTNET_SIGNATURE);
  const port: SolanaPublicTestnetWalletPort = {
    connect: vi.fn(async () => PUBLIC_TESTNET_ACCOUNT),
    readSnapshot: vi.fn(async () => ({
      account: PUBLIC_TESTNET_ACCOUNT,
      correctNetwork: true as const,
    })),
    sendTransaction: send,
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
    send: port.sendTransaction as ReturnType<typeof vi.fn>,
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
  it('keeps the preview provider-private and gates one exact Devnet proof behind review', async () => {
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
    expectProviderPrivateDom(rendered.container);
    expect(harness.api.createIntent).toHaveBeenCalledWith(
      publicTestnetRequest(),
      expect.any(AbortSignal),
    );
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
    expect(selectedWallet.send).toHaveBeenCalledTimes(1);
    expect(selectedWallet.send).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionVersion: 'legacy',
        minContextSlot: 400000000,
        serializedTransaction: expect.any(Uint8Array),
      }),
      PUBLIC_TESTNET_ACCOUNT,
      expect.any(AbortSignal),
    );
    expect(harness.api.submitTransaction).toHaveBeenCalledWith(
      PUBLIC_TESTNET_INTENT_ID,
      PUBLIC_TESTNET_SIGNATURE,
      expect.any(AbortSignal),
    );
    expect(screen.getByRole('link', { name: /View Devnet transaction/u })).toHaveAttribute(
      'href',
      `https://explorer.solana.com/tx/${PUBLIC_TESTNET_SIGNATURE}?cluster=devnet`,
    );
    expect(rendered.container.textContent).not.toMatch(/Morpho|Aave|Compound|Kamino|Save|Solend/iu);
    await waitFor(() => expect(activity).toHaveBeenLastCalledWith(false));
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
    harness.api.submitTransaction
      .mockResolvedValueOnce(publicTestnetSubmission('PENDING'))
      .mockResolvedValueOnce(publicTestnetSubmission('VERIFIED'));
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
    expect(selectedWallet.send).toHaveBeenCalledTimes(1);
    expect(harness.api.submitTransaction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(activity).toHaveBeenLastCalledWith(true);
    const unload = new Event('beforeunload', { cancelable: true });
    expect(globalThis.dispatchEvent(unload)).toBe(false);

    fireEvent.click(verifyAgain);
    expect(await screen.findByText('Live lending proof verified')).toBeInTheDocument();
    expect(selectedWallet.send).toHaveBeenCalledTimes(1);
    expect(harness.api.submitTransaction).toHaveBeenCalledTimes(2);
    for (const call of harness.api.submitTransaction.mock.calls) {
      expect(call[0]).toBe(PUBLIC_TESTNET_INTENT_ID);
      expect(call[1]).toBe(PUBLIC_TESTNET_SIGNATURE);
      expect(call[2]).toBeInstanceOf(AbortSignal);
    }
  });

  it('retains a signature when wallet invalidation races a deferred write', async () => {
    let resolveSignature!: (signature: string) => void;
    const pendingSignature = new Promise<string>((resolve) => {
      resolveSignature = resolve;
    });
    const selectedWallet = wallet({
      sendTransaction: vi.fn(async () => pendingSignature),
    });
    const harness = dependencies(selectedWallet.port);
    harness.api.submitTransaction.mockResolvedValue(publicTestnetSubmission('PENDING'));
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
    await waitFor(() => expect(selectedWallet.send).toHaveBeenCalledTimes(1));

    act(() => selectedWallet.invalidate());
    await act(async () => resolveSignature(PUBLIC_TESTNET_SIGNATURE));

    expect(
      await screen.findByRole('link', { name: /View Devnet transaction/u }),
    ).toBeInTheDocument();
    expect(selectedWallet.send).toHaveBeenCalledTimes(1);
    expect(harness.api.submitTransaction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByText(/do not start another proof/iu)).toBeInTheDocument();
    expect(activity).toHaveBeenLastCalledWith(true);
  });

  it('fails closed before calling the wallet when session recovery storage is unavailable', async () => {
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
      await screen.findByText(/recovery storage is unavailable.*not asked to send/iu),
    ).toBeInTheDocument();
    expect(selectedWallet.send).not.toHaveBeenCalled();
    expect(harness.api.submitTransaction).not.toHaveBeenCalled();
  });

  it('restores a known signature after reload and performs only read-only same-signature polling', async () => {
    const selectedWallet = wallet();
    const harness = dependencies(selectedWallet.port);
    harness.api.submitTransaction
      .mockResolvedValueOnce(publicTestnetSubmission('PENDING'))
      .mockResolvedValueOnce(publicTestnetSubmission('VERIFIED'));
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
    expect(selectedWallet.send).toHaveBeenCalledTimes(1);
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
    expect(selectedWallet.send).toHaveBeenCalledTimes(1);

    fireEvent.click(recoveredPoll);
    expect(await screen.findByText('Live lending proof verified')).toBeInTheDocument();
    expect(selectedWallet.send).toHaveBeenCalledTimes(1);
    expect(harness.api.submitTransaction).toHaveBeenLastCalledWith(
      PUBLIC_TESTNET_INTENT_ID,
      PUBLIC_TESTNET_SIGNATURE,
      expect.any(AbortSignal),
    );
  });

  it('never retries an inconclusive wallet write and keeps the review locked', async () => {
    let now = PUBLIC_TESTNET_NOW;
    const selectedWallet = wallet({
      sendTransaction: vi.fn(async () => {
        throw new SolanaPublicTestnetWalletError('COMMIT_AMBIGUOUS');
      }),
    });
    const harness = dependencies(selectedWallet.port);
    const value = { ...harness.value, now: () => now };
    const first = render(
      <PublicTestnetTransactionProof preview={ZERO_LIQUID_BALANCED_PREVIEW} dependencies={value} />,
    );
    await openReadyReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Devnet transaction' }));

    expect(await screen.findByText(/wallet result was inconclusive/iu)).toBeInTheDocument();
    expect(selectedWallet.send).toHaveBeenCalledTimes(1);
    expect(harness.api.submitTransaction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    first.unmount();

    render(
      <PublicTestnetTransactionProof preview={ZERO_LIQUID_BALANCED_PREVIEW} dependencies={value} />,
    );
    expect(
      await screen.findByText(/prior wallet request may have committed/iu),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit Devnet transaction' })).toBeNull();
    expect(selectedWallet.send).toHaveBeenCalledTimes(1);
    const recheck = screen.getByRole('button', { name: 'Recheck recovery deadline' });
    now = new Date(publicTestnetIntent().evidenceExpiresAt);
    fireEvent.click(recheck);
    expect(
      await screen.findByRole('button', { name: 'Review 0.01 SOL Devnet proof' }),
    ).toBeEnabled();
    expect(selectedWallet.send).toHaveBeenCalledTimes(1);
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
