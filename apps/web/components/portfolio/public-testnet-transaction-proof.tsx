'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { isAbortFailure } from '@/lib/authentication/http';
import type { LocalDemoAllocationPreview } from '@/lib/local-demo/local-demo-yield';
import {
  isPublicTestnetUnauthenticated,
  PublicTestnetApiClient,
  PublicTestnetApiError,
  type PublicTestnetExecutionApi,
} from '@/lib/public-testnet/public-testnet-client';
import {
  publicTestnetExplorerTransactionUrl,
  publicTestnetPreviewRequest,
  publicTestnetWalletTransaction,
  type PublicTestnetExecutionIntent,
  type PublicTestnetSubmissionResult,
} from '@/lib/public-testnet/public-testnet-execution';
import {
  addPublicTestnetRecoverySignature,
  clearPublicTestnetRecoveryJournal,
  readPublicTestnetRecoveryJournal,
  startPublicTestnetRecoveryJournal,
  type PublicTestnetRecoveryJournal,
} from '@/lib/public-testnet/public-testnet-recovery-journal';
import {
  PhantomSolanaWalletDiscovery,
  type SelectedSolanaWallet,
  type SolanaWalletDescriptor,
} from '@/lib/wallets/solana/discovery';
import {
  createSolanaPublicTestnetWalletExecutor,
  SolanaPublicTestnetWalletError,
  type SolanaPublicTestnetWalletPort,
} from '@/lib/wallets/solana/public-testnet-executor';

type ProofPhase =
  | 'RECOVERY_CHECK'
  | 'CLOSED'
  | 'SELECT_WALLET'
  | 'CONNECTING'
  | 'PREPARING'
  | 'FUNDING_NEEDED'
  | 'READY'
  | 'SIGN_PROMPT'
  | 'SIGNATURE_KNOWN'
  | 'VERIFYING'
  | 'VERIFICATION_PENDING'
  | 'CONFIRMED'
  | 'USER_REJECTED'
  | 'COMMIT_AMBIGUOUS'
  | 'ERROR';

export interface PublicTestnetDiscoveryPort {
  start(): void;
  stop(): void;
  list(): readonly SolanaWalletDescriptor[];
  subscribe(listener: (wallets: readonly SolanaWalletDescriptor[]) => void): () => void;
  select(selectionId: string): SelectedSolanaWallet | null;
}

export interface PublicTestnetProofDependencies {
  readonly createApi: () => PublicTestnetExecutionApi;
  readonly createDiscovery: () => PublicTestnetDiscoveryPort;
  readonly createWallet: (selection: SelectedSolanaWallet) => SolanaPublicTestnetWalletPort;
  readonly now: () => Date;
}

export interface PublicTestnetTransactionProofProps {
  readonly preview: LocalDemoAllocationPreview;
  readonly onUnauthenticated?: (() => void) | undefined;
  readonly onWriteActivityChange?: ((active: boolean) => void) | undefined;
  readonly dependencies?: PublicTestnetProofDependencies | undefined;
}

const DEFAULT_DEPENDENCIES: PublicTestnetProofDependencies = Object.freeze({
  createApi: () => new PublicTestnetApiClient(),
  createDiscovery: () => new PhantomSolanaWalletDiscovery(),
  createWallet: (selection: SelectedSolanaWallet) =>
    createSolanaPublicTestnetWalletExecutor(selection),
  now: () => new Date(),
});

// Leave time for the Phantom prompt without making a fresh 60-second blockhash intent unusable
// immediately after its API round trip.
const MINIMUM_WRITE_WINDOW_MS = 10_000;
const ACTIVE_OPERATION_PHASES = new Set<ProofPhase>([
  'SIGN_PROMPT',
  'SIGNATURE_KNOWN',
  'VERIFYING',
]);

function intentHasWriteWindow(intent: PublicTestnetExecutionIntent, now: Date): boolean {
  return (
    Number.isFinite(now.getTime()) &&
    Date.parse(intent.expiresAt) - now.getTime() >= MINIMUM_WRITE_WINDOW_MS
  );
}

function phaseStatus(phase: ProofPhase): string {
  switch (phase) {
    case 'CONNECTING':
      return 'Waiting for Phantom to connect a Solana Devnet account.';
    case 'RECOVERY_CHECK':
      return 'Checking this tab for an unresolved Devnet transaction.';
    case 'PREPARING':
      return 'Checking live Devnet funding and preparing a short-lived transaction intent.';
    case 'SIGN_PROMPT':
      return 'Review one exact 0.01 SOL Devnet deposit in Phantom.';
    case 'SIGNATURE_KNOWN':
      return 'The signature is known and is being bound to this execution intent.';
    case 'VERIFYING':
      return 'The server is checking the latest transaction status and resulting position.';
    case 'VERIFICATION_PENDING':
      return 'The signature was submitted; transaction and position evidence are still pending.';
    case 'CONFIRMED':
      return 'The 0.01 SOL public-testnet lending proof is verified.';
    case 'USER_REJECTED':
      return 'The wallet request was rejected. No transaction will be retried automatically.';
    case 'COMMIT_AMBIGUOUS':
      return 'The wallet result was inconclusive. The app will not submit another transaction.';
    case 'ERROR':
      return 'The public-testnet proof could not continue safely.';
    default:
      return '';
  }
}

function failureCopy(error: unknown, signatureKnown: boolean): string {
  if (error instanceof SolanaPublicTestnetWalletError) {
    if (error.code === 'USER_REJECTED') {
      return 'Phantom rejected the request. No Devnet transaction was submitted.';
    }
    if (error.code === 'COMMIT_AMBIGUOUS' || error.code === 'REQUEST_PENDING') {
      return 'Phantom did not return a conclusive signature. Inspect its activity before doing anything else; this app will not retry the write.';
    }
    if (error.code === 'ACCOUNT_CHANGED' || error.code === 'DISCONNECTED') {
      return signatureKnown
        ? 'The Phantom account changed after a signature was returned. Only read-only verification remains available.'
        : 'The Phantom account changed. Close this review and start a fresh one.';
    }
    if (error.code === 'UNSUPPORTED') {
      return 'This Phantom wallet does not expose the required Solana Devnet sign-and-send feature.';
    }
  }
  if (error instanceof PublicTestnetApiError) {
    if (error.code === 'EXPIRED') {
      return signatureKnown
        ? 'The intent expired. The same known signature may still be checked, but no new transaction will be sent.'
        : 'The intent expired before signing. Close this review and create a fresh one.';
    }
    if (error.code === 'REJECTED') {
      return 'The server rejected this signature because the finalized transaction did not match the reviewed intent.';
    }
    if (error.code === 'CONFLICT') {
      return 'The server says this intent was already consumed with different transaction evidence.';
    }
  }
  return signatureKnown
    ? 'The known signature could not yet be verified. No wallet transaction will be retried.'
    : 'The public-testnet proof stopped before a transaction was submitted.';
}

function SignatureLink({ signature }: { readonly signature: string | null }) {
  if (signature === null) return null;
  return (
    <p className="public-testnet-transaction-links" aria-label="Public testnet transaction">
      <a
        href={publicTestnetExplorerTransactionUrl(signature)}
        target="_blank"
        rel="noopener noreferrer"
      >
        View Devnet transaction <span aria-hidden="true">{'\u2197'}</span>
      </a>
    </p>
  );
}

export function PublicTestnetTransactionProof({
  preview,
  onUnauthenticated,
  onWriteActivityChange,
  dependencies = DEFAULT_DEPENDENCIES,
}: PublicTestnetTransactionProofProps) {
  const [phase, setPhase] = useState<ProofPhase>('RECOVERY_CHECK');
  const [wallets, setWallets] = useState<readonly SolanaWalletDescriptor[]>([]);
  const [intent, setIntent] = useState<PublicTestnetExecutionIntent | null>(null);
  const [submission, setSubmission] = useState<PublicTestnetSubmissionResult | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [recoveryJournal, setRecoveryJournal] = useState<PublicTestnetRecoveryJournal | null>(null);
  const [confirmedDisclosure, setConfirmedDisclosure] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const mountedReference = useRef(true);
  const phaseReference = useRef<ProofPhase>('RECOVERY_CHECK');
  const intentReference = useRef<PublicTestnetExecutionIntent | null>(null);
  const signatureReference = useRef<string | null>(null);
  const recoveryReference = useRef<PublicTestnetRecoveryJournal | null>(null);
  const accountReference = useRef<string | null>(null);
  const discoveryReference = useRef<PublicTestnetDiscoveryPort | null>(null);
  const discoveryUnsubscribe = useRef<(() => void) | null>(null);
  const walletReference = useRef<SolanaPublicTestnetWalletPort | null>(null);
  const walletUnsubscribe = useRef<(() => void) | null>(null);
  const apiReference = useRef<PublicTestnetExecutionApi | null>(null);
  const operationReference = useRef<AbortController | null>(null);
  const generationReference = useRef(0);

  function transition(next: ProofPhase): void {
    phaseReference.current = next;
    if (mountedReference.current) setPhase(next);
  }

  function setCurrentIntent(next: PublicTestnetExecutionIntent | null): void {
    intentReference.current = next;
    if (mountedReference.current) setIntent(next);
  }

  function rememberSignature(next: string): void {
    signatureReference.current = next;
    if (mountedReference.current) setSignature(next);
  }

  function setCurrentRecovery(next: PublicTestnetRecoveryJournal | null): void {
    recoveryReference.current = next;
    if (mountedReference.current) setRecoveryJournal(next);
  }

  function abortOperation(): void {
    generationReference.current += 1;
    operationReference.current?.abort();
    operationReference.current = null;
  }

  function beginOperation(): Readonly<{ controller: AbortController; generation: number }> {
    abortOperation();
    const controller = new AbortController();
    operationReference.current = controller;
    return Object.freeze({ controller, generation: generationReference.current });
  }

  function releaseWallet(): void {
    walletUnsubscribe.current?.();
    walletUnsubscribe.current = null;
    walletReference.current?.dispose();
    walletReference.current = null;
  }

  function releaseDiscovery(): void {
    discoveryUnsubscribe.current?.();
    discoveryUnsubscribe.current = null;
    discoveryReference.current?.stop();
    discoveryReference.current = null;
    if (mountedReference.current) setWallets([]);
  }

  function clearExecutionState(): void {
    accountReference.current = null;
    intentReference.current = null;
    signatureReference.current = null;
    recoveryReference.current = null;
    setIntent(null);
    setSubmission(null);
    setSignature(null);
    setRecoveryJournal(null);
    setConfirmedDisclosure(false);
    setFailure(null);
  }

  function ensureApi(): PublicTestnetExecutionApi | null {
    if (apiReference.current !== null) return apiReference.current;
    try {
      apiReference.current = dependencies.createApi();
      return apiReference.current;
    } catch {
      setFailure(
        'Read-only recovery is unavailable in this browser context. No new transaction is allowed.',
      );
      return null;
    }
  }

  function restoreRecoveryJournal(): boolean {
    let recovered: PublicTestnetRecoveryJournal | null;
    try {
      recovered = readPublicTestnetRecoveryJournal(dependencies.now());
    } catch {
      setFailure(
        'Safe transaction recovery storage is unavailable or invalid. No wallet transaction is allowed.',
      );
      transition('COMMIT_AMBIGUOUS');
      return true;
    }
    if (recovered === null) {
      clearExecutionState();
      transition('CLOSED');
      return false;
    }

    abortOperation();
    releaseWallet();
    releaseDiscovery();
    setCurrentRecovery(recovered);
    accountReference.current = recovered.account;
    setCurrentIntent(null);
    setSubmission(null);
    setConfirmedDisclosure(false);
    ensureApi();
    if (recovered.signature === null) {
      signatureReference.current = null;
      setSignature(null);
      setFailure(
        'A prior wallet request may have committed without returning a signature. New sends are blocked until its evidence deadline expires.',
      );
      transition('COMMIT_AMBIGUOUS');
    } else {
      rememberSignature(recovered.signature);
      setFailure(
        'Recovered a known Devnet signature from this tab. Only read-only server verification is available; no wallet transaction will be resent.',
      );
      transition('VERIFICATION_PENDING');
    }
    return true;
  }

  const restoreRecoveryOnMount = useEffectEvent(restoreRecoveryJournal);

  useEffect(() => {
    mountedReference.current = true;
    queueMicrotask(() => {
      if (mountedReference.current) restoreRecoveryOnMount();
    });
    return () => {
      mountedReference.current = false;
      abortOperation();
      releaseWallet();
      releaseDiscovery();
    };
  }, []);

  const unresolvedSignature = signature !== null && phase !== 'CONFIRMED';
  const unresolvedExecution =
    recoveryJournal !== null || unresolvedSignature || phase === 'COMMIT_AMBIGUOUS';
  const writeActive = ACTIVE_OPERATION_PHASES.has(phase) || unresolvedExecution;

  useEffect(() => {
    onWriteActivityChange?.(writeActive);
  }, [onWriteActivityChange, writeActive]);
  useEffect(() => () => onWriteActivityChange?.(false), [onWriteActivityChange]);

  useEffect(() => {
    if (!unresolvedExecution) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    globalThis.addEventListener('beforeunload', warnBeforeUnload);
    return () => globalThis.removeEventListener('beforeunload', warnBeforeUnload);
  }, [unresolvedExecution]);

  function bindWalletInvalidation(wallet: SolanaPublicTestnetWalletPort): void {
    walletUnsubscribe.current?.();
    walletUnsubscribe.current = wallet.subscribeInvalidation(() => {
      abortOperation();
      const known = signatureReference.current !== null;
      setFailure(failureCopy(new SolanaPublicTestnetWalletError('ACCOUNT_CHANGED'), known));
      transition(
        known
          ? 'VERIFICATION_PENDING'
          : recoveryReference.current !== null
            ? 'COMMIT_AMBIGUOUS'
            : 'ERROR',
      );
      walletUnsubscribe.current?.();
      walletUnsubscribe.current = null;
    });
  }

  function openReview(): void {
    if (phaseReference.current !== 'CLOSED') return;
    if (restoreRecoveryJournal()) return;
    clearExecutionState();
    try {
      const discovery = dependencies.createDiscovery();
      discoveryReference.current = discovery;
      apiReference.current = dependencies.createApi();
      discoveryUnsubscribe.current = discovery.subscribe((next) => setWallets(next));
      transition('SELECT_WALLET');
      discovery.start();
      setWallets(discovery.list());
    } catch {
      setFailure('Phantom Wallet Standard discovery is unavailable in this browser context.');
      transition('ERROR');
    }
  }

  function closeReview(): void {
    if (ACTIVE_OPERATION_PHASES.has(phaseReference.current)) return;
    if (
      phaseReference.current === 'COMMIT_AMBIGUOUS' ||
      recoveryReference.current !== null ||
      (signatureReference.current !== null && phaseReference.current !== 'CONFIRMED')
    ) {
      return;
    }
    abortOperation();
    releaseWallet();
    releaseDiscovery();
    clearExecutionState();
    transition('CLOSED');
  }

  async function prepareIntent(
    wallet: SolanaPublicTestnetWalletPort,
    selectedAccount: string,
  ): Promise<void> {
    const api = apiReference.current;
    if (api === null || signatureReference.current !== null) return;
    const { controller, generation } = beginOperation();
    setCurrentIntent(null);
    setSubmission(null);
    setConfirmedDisclosure(false);
    setFailure(null);
    transition('PREPARING');
    try {
      const nextIntent = await api.createIntent(
        publicTestnetPreviewRequest(preview, selectedAccount),
        controller.signal,
      );
      if (controller.signal.aborted || generation !== generationReference.current) return;
      const walletSnapshot = await wallet.readSnapshot(controller.signal);
      if (walletSnapshot.account !== selectedAccount || nextIntent.account !== selectedAccount) {
        throw new SolanaPublicTestnetWalletError('ACCOUNT_CHANGED');
      }
      setCurrentIntent(nextIntent);
      transition(nextIntent.fundingReadiness.status === 'READY' ? 'READY' : 'FUNDING_NEEDED');
    } catch (error) {
      if (isAbortFailure(error, controller.signal)) return;
      if (isPublicTestnetUnauthenticated(error)) {
        onUnauthenticated?.();
        return;
      }
      if (generation === generationReference.current) {
        setFailure(failureCopy(error, false));
        transition('ERROR');
      }
    } finally {
      if (generation === generationReference.current) operationReference.current = null;
    }
  }

  async function connect(selectionId: string): Promise<void> {
    if (phaseReference.current !== 'SELECT_WALLET') return;
    const selected = discoveryReference.current?.select(selectionId) ?? null;
    if (selected === null) {
      setFailure('The selected Phantom announcement is no longer available.');
      transition('ERROR');
      return;
    }
    const { controller, generation } = beginOperation();
    releaseWallet();
    setFailure(null);
    transition('CONNECTING');
    try {
      const wallet = dependencies.createWallet(selected);
      walletReference.current = wallet;
      const selectedAccount = await wallet.connect(controller.signal);
      if (controller.signal.aborted || generation !== generationReference.current) return;
      accountReference.current = selectedAccount;
      bindWalletInvalidation(wallet);
      await prepareIntent(wallet, selectedAccount);
    } catch (error) {
      if (isAbortFailure(error, controller.signal)) return;
      if (generation === generationReference.current) {
        setFailure(failureCopy(error, false));
        transition(
          error instanceof SolanaPublicTestnetWalletError && error.code === 'USER_REJECTED'
            ? 'USER_REJECTED'
            : 'ERROR',
        );
      }
    } finally {
      if (generation === generationReference.current) operationReference.current = null;
    }
  }

  async function verifyKnownSignature(intentId: string, knownSignature: string): Promise<void> {
    let tracked = recoveryReference.current;
    if (tracked === null) {
      setFailure('The durable recovery record is missing. No wallet transaction will be resent.');
      transition('VERIFICATION_PENDING');
      return;
    }
    if (Date.parse(tracked.evidenceExpiresAt) <= dependencies.now().getTime()) {
      restoreRecoveryJournal();
      return;
    }
    if (tracked.signature === null) {
      try {
        tracked = addPublicTestnetRecoverySignature(tracked, knownSignature);
        setCurrentRecovery(tracked);
      } catch {
        setFailure(
          'The signature is known, but it could not be stored durably. Keep this tab open; no wallet transaction will be resent.',
        );
        transition('VERIFICATION_PENDING');
        return;
      }
    } else if (tracked.signature !== knownSignature) {
      setFailure(
        'The durable recovery signature does not match. No wallet transaction is allowed.',
      );
      transition('VERIFICATION_PENDING');
      return;
    }

    const api = ensureApi();
    if (api === null) return;
    const { controller, generation } = beginOperation();
    setFailure(null);
    transition('VERIFYING');
    try {
      const result = await api.submitTransaction(intentId, knownSignature, controller.signal);
      if (controller.signal.aborted || generation !== generationReference.current) return;
      setSubmission(result);
      if (result.status === 'VERIFIED') {
        try {
          clearPublicTestnetRecoveryJournal(tracked);
          setCurrentRecovery(null);
          transition('CONFIRMED');
        } catch {
          setFailure(
            'The transaction is verified, but its recovery marker could not be cleared. New sends remain blocked.',
          );
          transition('VERIFICATION_PENDING');
        }
      } else {
        transition('VERIFICATION_PENDING');
      }
    } catch (error) {
      if (isAbortFailure(error, controller.signal)) return;
      if (isPublicTestnetUnauthenticated(error)) {
        onUnauthenticated?.();
        return;
      }
      if (generation === generationReference.current) {
        setFailure(failureCopy(error, true));
        transition('VERIFICATION_PENDING');
      }
    } finally {
      if (generation === generationReference.current) operationReference.current = null;
    }
  }

  async function submitTransaction(): Promise<void> {
    const wallet = walletReference.current;
    const currentIntent = intentReference.current;
    const selectedAccount = accountReference.current;
    if (
      phaseReference.current !== 'READY' ||
      wallet === null ||
      currentIntent === null ||
      selectedAccount === null ||
      !confirmedDisclosure ||
      signatureReference.current !== null
    ) {
      return;
    }
    if (!intentHasWriteWindow(currentIntent, dependencies.now())) {
      setFailure(
        'The reviewed transaction is too close to expiry. Review the refreshed intent before signing.',
      );
      await prepareIntent(wallet, selectedAccount);
      return;
    }

    const { controller, generation } = beginOperation();
    let writeRequested = false;
    setFailure(null);
    transition('SIGN_PROMPT');
    try {
      const snapshot = await wallet.readSnapshot(controller.signal);
      if (snapshot.account !== selectedAccount) {
        throw new SolanaPublicTestnetWalletError('ACCOUNT_CHANGED');
      }
      const walletTransaction = publicTestnetWalletTransaction(currentIntent);
      let pendingRecovery: PublicTestnetRecoveryJournal;
      try {
        pendingRecovery = startPublicTestnetRecoveryJournal({
          intentId: currentIntent.intentId,
          account: selectedAccount,
          evidenceExpiresAt: currentIntent.evidenceExpiresAt,
        });
        setCurrentRecovery(pendingRecovery);
      } catch {
        setFailure(
          'Safe transaction recovery storage is unavailable. Phantom was not asked to send anything.',
        );
        transition('ERROR');
        return;
      }
      writeRequested = true;
      const nextSignature = await wallet.sendTransaction(
        walletTransaction,
        selectedAccount,
        controller.signal,
      );

      // Retain and durably journal the signature before any server verification.
      rememberSignature(nextSignature);
      try {
        pendingRecovery = addPublicTestnetRecoverySignature(pendingRecovery, nextSignature);
        setCurrentRecovery(pendingRecovery);
      } catch {
        setFailure(
          'The signature is known, but it could not be stored durably. Keep this tab open; no wallet transaction will be resent.',
        );
        transition('VERIFICATION_PENDING');
        return;
      }
      transition('SIGNATURE_KNOWN');
      await verifyKnownSignature(currentIntent.intentId, nextSignature);
    } catch (error) {
      if (signatureReference.current !== null) {
        setFailure(failureCopy(error, true));
        transition('VERIFICATION_PENDING');
        return;
      }
      if (error instanceof SolanaPublicTestnetWalletError && error.code === 'USER_REJECTED') {
        const pendingRecovery = recoveryReference.current;
        if (pendingRecovery !== null) {
          try {
            clearPublicTestnetRecoveryJournal(pendingRecovery);
            setCurrentRecovery(null);
          } catch {
            setFailure(
              'Phantom rejected the request, but the recovery marker could not be cleared. New sends remain blocked.',
            );
            transition('COMMIT_AMBIGUOUS');
            return;
          }
        }
        setFailure(failureCopy(error, false));
        transition('USER_REJECTED');
        return;
      }
      if (
        writeRequested &&
        (controller.signal.aborted ||
          (error instanceof SolanaPublicTestnetWalletError &&
            (error.code === 'COMMIT_AMBIGUOUS' || error.code === 'REQUEST_PENDING')))
      ) {
        setFailure(failureCopy(new SolanaPublicTestnetWalletError('COMMIT_AMBIGUOUS'), false));
        transition('COMMIT_AMBIGUOUS');
        return;
      }
      if (isAbortFailure(error, controller.signal)) return;
      setFailure(failureCopy(error, false));
      transition('ERROR');
    } finally {
      if (generation === generationReference.current) operationReference.current = null;
    }
  }

  const closeDisabled =
    phase === 'RECOVERY_CHECK' || ACTIVE_OPERATION_PHASES.has(phase) || unresolvedExecution;

  return (
    <section className="public-testnet-proof" aria-labelledby="public-testnet-proof-title">
      <div className="public-testnet-proof-heading">
        <div>
          <p className="eyebrow">Live public-testnet proof</p>
          <h4 id="public-testnet-proof-title">Try one real testnet lending position</h4>
        </div>
        <span>Solana Devnet {'\u00b7'} exactly 0.01 SOL</span>
      </div>
      <p>
        This optional proof uses free, no-real-value Devnet SOL. It is separate from the displayed
        managed blend, does not allocate the displayed portfolio, and does not validate its APY.
      </p>
      {preview.rateSnapshot.freshness === 'STALE' ? (
        <p className="public-testnet-archived-note" role="note">
          The managed blend above is an archived estimate. This live transaction proves Devnet
          mechanics only; it does not make the archived rate or APY current.
        </p>
      ) : null}

      {phase === 'CLOSED' ? (
        <button className="public-testnet-review-action" type="button" onClick={openReview}>
          Review 0.01 SOL Devnet proof
        </button>
      ) : (
        <div className="public-testnet-confirmation-panel">
          <div className="public-testnet-confirmation-heading">
            <div>
              <strong>Devnet transaction review</strong>
              <small>This flow cannot authorize a mainnet transaction.</small>
            </div>
            <button type="button" disabled={closeDisabled} onClick={closeReview}>
              Close
            </button>
          </div>

          <div className="public-testnet-disclosure" role="note">
            <strong>Public-chain disclosure</strong>
            <p>
              The managed provider name stays out of the allocation preview, but Phantom and the
              public explorer reveal the lending program, accounts, and transaction data.
            </p>
          </div>

          {phase === 'SELECT_WALLET' ? (
            <div className="public-testnet-wallet-selection">
              <p>Select an explicitly discovered Phantom Devnet wallet.</p>
              {wallets.length === 0 ? (
                <p role="status">No compatible Phantom Wallet Standard announcement was found.</p>
              ) : (
                <div role="group" aria-label="Compatible Solana Devnet wallets">
                  {wallets.map((wallet) => (
                    <button
                      type="button"
                      key={wallet.selectionId}
                      onClick={() => void connect(wallet.selectionId)}
                    >
                      Connect {wallet.displayName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {phase === 'FUNDING_NEEDED' && intent !== null ? (
            <div className="public-testnet-funding" role="status">
              <strong>Free Devnet SOL is needed</strong>
              <p>
                The readiness check requires 0.02 Devnet SOL: 0.01 SOL for the proof plus a
                conservative allowance for transaction fees and token-account rent. It is a
                heuristic, not a fee guarantee. Devnet assets have no real monetary value.
              </p>
              <p>Never buy tokens or enter a seed phrase to complete this proof.</p>
              <div className="public-testnet-faucet-actions">
                <a
                  href={intent.fundingReadiness.faucetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open the official Solana faucet <span aria-hidden="true">{'\u2197'}</span>
                </a>
              </div>
              <button
                className="portfolio-secondary-action"
                type="button"
                onClick={() => {
                  const wallet = walletReference.current;
                  const selectedAccount = accountReference.current;
                  if (wallet !== null && selectedAccount !== null) {
                    void prepareIntent(wallet, selectedAccount);
                  }
                }}
              >
                Recheck Devnet SOL
              </button>
            </div>
          ) : null}

          {phase === 'READY' && intent !== null ? (
            <div className="public-testnet-submit-review">
              <dl>
                <div>
                  <dt>Network</dt>
                  <dd>Solana Devnet</dd>
                </div>
                <div>
                  <dt>Deposit</dt>
                  <dd>0.01 native SOL</dd>
                </div>
                <div>
                  <dt>Wallet confirmations</dt>
                  <dd>1 exact transaction</dd>
                </div>
                <div>
                  <dt>Intent expires</dt>
                  <dd>
                    <time dateTime={intent.expiresAt}>{intent.expiresAt}</time>
                  </dd>
                </div>
                <div>
                  <dt>Recovery evidence deadline</dt>
                  <dd>
                    <time dateTime={intent.evidenceExpiresAt}>{intent.evidenceExpiresAt}</time>
                  </dd>
                </div>
              </dl>
              <p className="public-testnet-position-note" role="note">
                After verification, the 0.01 Devnet SOL remains in the public testnet lending
                position. This demo does not withdraw it automatically.
              </p>
              <label className="public-testnet-confirm-checkbox">
                <input
                  type="checkbox"
                  checked={confirmedDisclosure}
                  onChange={(event) => setConfirmedDisclosure(event.currentTarget.checked)}
                />
                I understand this sends one public Devnet transaction, does not execute the
                displayed blend or validate its APY, and does not automatically withdraw the test
                position.
              </label>
              <button
                className="public-testnet-submit-action"
                type="button"
                disabled={!confirmedDisclosure}
                onClick={() => void submitTransaction()}
              >
                Submit Devnet transaction
              </button>
            </div>
          ) : null}

          {phase !== 'SELECT_WALLET' && phase !== 'FUNDING_NEEDED' && phase !== 'READY' ? (
            <p className="public-testnet-phase-status" role="status" aria-live="polite">
              {phaseStatus(phase)}
            </p>
          ) : null}

          {failure === null ? null : (
            <p className="public-testnet-error" role="alert">
              {failure}
            </p>
          )}

          <SignatureLink signature={signature} />

          {submission === null ? null : (
            <dl
              className="public-testnet-verification-status"
              aria-label="Latest server verification"
            >
              <div>
                <dt>Transaction verification</dt>
                <dd>{submission.transaction.status === 'VERIFIED' ? 'Verified' : 'Pending'}</dd>
              </div>
              <div>
                <dt>Collateral increase</dt>
                <dd>{submission.position.status === 'VERIFIED' ? 'Verified' : 'Pending'}</dd>
              </div>
            </dl>
          )}

          {unresolvedExecution ? (
            <p className="public-testnet-recovery-note" role="note">
              Keep this tab open while possible. After a reload, this tab blocks every new send and
              restores read-only verification when a signature is known. Inspect Phantom and the
              explorer, and do not start another proof that could duplicate the deposit.
            </p>
          ) : null}

          {signature !== null && phase !== 'CONFIRMED' ? (
            <button
              className="portfolio-secondary-action"
              type="button"
              disabled={phase === 'VERIFYING'}
              onClick={() => {
                const tracked = recoveryReference.current;
                if (tracked !== null) {
                  void verifyKnownSignature(tracked.intentId, signature);
                }
              }}
            >
              Check server verification
            </button>
          ) : null}

          {phase === 'COMMIT_AMBIGUOUS' ||
          (recoveryJournal !== null && signature === null && phase !== 'CONFIRMED') ? (
            <button
              className="portfolio-secondary-action"
              type="button"
              onClick={restoreRecoveryJournal}
            >
              Recheck recovery deadline
            </button>
          ) : null}

          {phase === 'CONFIRMED' && submission?.position.status === 'VERIFIED' ? (
            <div className="public-testnet-success" role="status">
              <strong>Live lending proof verified</strong>
              <p>
                The server matched the transaction and confirmed that the Devnet collateral position
                increased.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
