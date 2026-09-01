'use client';

import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import { isAbortFailure } from '@/lib/authentication/http';
import type { LocalDemoAllocationPreview } from '@/lib/local-demo/local-demo-yield';
import {
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
} from '@/lib/evm-public-testnet/constants';
import {
  EvmPublicTestnetApiClient,
  EvmPublicTestnetApiError,
  isEvmPublicTestnetUnauthenticated,
  type EvmPublicTestnetExecutionApi,
} from '@/lib/evm-public-testnet/client';
import {
  evmPublicTestnetExplorerTransactionUrl,
  evmPublicTestnetPreviewRequest,
  evmPublicTestnetWalletTransaction,
  type EvmPublicTestnetExecutionIntent,
  type EvmPublicTestnetSubmissionResult,
} from '@/lib/evm-public-testnet/execution';
import { rememberEvmPublicTestnetPositionAccount } from '@/lib/evm-public-testnet/position-account';
import {
  addEvmPublicTestnetRecoveryTransactionHash,
  clearEvmPublicTestnetRecoveryJournal,
  readEvmPublicTestnetRecoveryJournal,
  startEvmPublicTestnetRecoveryJournal,
  type EvmPublicTestnetRecoveryJournal,
} from '@/lib/evm-public-testnet/recovery-journal';
import {
  Eip6963ProviderDiscovery,
  type InjectedProviderDescriptor,
  type SelectedEip1193Provider,
} from '@/lib/wallets/eip1193/discovery';
import {
  createEvmPublicTestnetWalletExecutor,
  EvmPublicTestnetWalletError,
  type EvmPublicTestnetWalletPort,
} from '@/lib/wallets/eip1193/public-testnet-executor';

type ProofPhase =
  | 'RECOVERY_CHECK'
  | 'CLOSED'
  | 'SELECT_WALLET'
  | 'CONNECTING'
  | 'PREPARING'
  | 'FUNDING_NEEDED'
  | 'READY'
  | 'SEND_PROMPT'
  | 'HASH_KNOWN'
  | 'VERIFYING'
  | 'VERIFICATION_PENDING'
  | 'CONFIRMED'
  | 'FINALIZED'
  | 'USER_REJECTED'
  | 'COMMIT_AMBIGUOUS'
  | 'ERROR';

export interface EvmPublicTestnetDiscoveryPort {
  start(): void;
  stop(): void;
  list(): readonly InjectedProviderDescriptor[];
  subscribe(listener: (wallets: readonly InjectedProviderDescriptor[]) => void): () => void;
  select(selectionId: string): SelectedEip1193Provider | null;
}

export interface EvmPublicTestnetProofDependencies {
  readonly createApi: () => EvmPublicTestnetExecutionApi;
  readonly createDiscovery: () => EvmPublicTestnetDiscoveryPort;
  readonly createWallet: (selection: SelectedEip1193Provider) => EvmPublicTestnetWalletPort;
  readonly now: () => Date;
}

export interface EvmPublicTestnetTransactionProofProps {
  readonly preview: LocalDemoAllocationPreview;
  readonly onUnauthenticated?: (() => void) | undefined;
  readonly onWriteActivityChange?: ((active: boolean) => void) | undefined;
  readonly onPositionAccountChange?: ((account: string) => void) | undefined;
  readonly onPositionRefreshRequested?: (() => void) | undefined;
  readonly onSubmitReadinessChange?: ((ready: boolean) => void) | undefined;
  readonly submissionMode?: 'INDIVIDUAL' | 'COMBINED' | undefined;
  readonly dependencies?: EvmPublicTestnetProofDependencies | undefined;
}

export interface EvmPublicTestnetSubmissionController {
  canRequestSubmit(): boolean;
  requestSubmit(): Promise<void> | null;
}

const BASE_SEPOLIA_NETWORK = Object.freeze({
  chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
  providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
  displayName: 'Base Sepolia',
  environment: 'TESTNET' as const,
});

const DEFAULT_DEPENDENCIES: EvmPublicTestnetProofDependencies = Object.freeze({
  createApi: () => new EvmPublicTestnetApiClient(),
  createDiscovery: () =>
    new Eip6963ProviderDiscovery({ supportedNetworks: [BASE_SEPOLIA_NETWORK] }),
  createWallet: (selection: SelectedEip1193Provider) =>
    createEvmPublicTestnetWalletExecutor(selection),
  now: () => new Date(),
});

const ACTIVE_WRITE_PHASES = new Set<ProofPhase>(['SEND_PROMPT', 'HASH_KNOWN', 'VERIFYING']);

function phaseStatus(phase: ProofPhase): string {
  switch (phase) {
    case 'RECOVERY_CHECK':
      return 'Checking this tab for an unresolved Base Sepolia transaction.';
    case 'CONNECTING':
      return 'Waiting for the selected EVM wallet to connect on Base Sepolia.';
    case 'PREPARING':
      return 'Checking Base Sepolia funding and preparing an exact Aave transaction intent.';
    case 'SEND_PROMPT':
      return 'Review the 0.00005 ETH deposit and estimated gas in your wallet.';
    case 'HASH_KNOWN':
      return 'The wallet returned a transaction hash; server verification is starting.';
    case 'VERIFYING':
      return 'The server is matching the receipt, Aave event, nonce, and position increase.';
    case 'VERIFICATION_PENDING':
      return 'The transaction is still pending or its exact evidence is not visible yet.';
    case 'CONFIRMED':
      return 'The exact transaction and position increase are confirmed on Base Sepolia.';
    case 'FINALIZED':
      return 'The exact Base Sepolia transaction is finalized.';
    case 'USER_REJECTED':
      return 'The wallet request was rejected. No transaction will be retried automatically.';
    case 'COMMIT_AMBIGUOUS':
      return 'The wallet result was inconclusive. Only read-only recovery is allowed.';
    case 'ERROR':
      return 'The EVM public-testnet proof could not continue safely.';
    default:
      return '';
  }
}

function apiCode(error: unknown): string | null {
  if (error instanceof EvmPublicTestnetApiError) return error.code;
  return null;
}

function conclusiveRetryFailure(error: unknown): 'REPLACED' | 'REVERTED' | null {
  const code = apiCode(error);
  if (code === 'REPLACED') return 'REPLACED';
  if (code === 'REVERTED') return 'REVERTED';
  return null;
}

function failureCopy(error: unknown, transactionHashKnown: boolean): string {
  if (error instanceof EvmPublicTestnetWalletError) {
    switch (error.code) {
      case 'USER_REJECTED':
        return 'The wallet rejected the request. No Base Sepolia transaction was submitted.';
      case 'COMMIT_AMBIGUOUS':
      case 'REQUEST_PENDING':
        return 'The wallet did not return a conclusive transaction hash. A safety lock prevents a duplicate deposit while the server checks the exact nonce and on-chain evidence.';
      case 'ACCOUNT_CHANGED':
      case 'DISCONNECTED':
        return transactionHashKnown
          ? 'The wallet account changed after submission. Only read-only verification remains available.'
          : 'The wallet account or network changed. Close this review and start again.';
      case 'UNSUPPORTED':
        return 'This wallet cannot safely switch to and submit the required Base Sepolia transaction.';
      default:
        break;
    }
  }
  const code = apiCode(error);
  if (code === 'EVIDENCE_MISMATCH') {
    return 'The observed transaction evidence does not match the reviewed intent. New sends remain blocked for manual inspection.';
  }
  if (code === 'EXPIRED') {
    return transactionHashKnown
      ? 'The preparation window ended, but an EVM transaction can still land. Only read-only recovery is allowed.'
      : 'The intent expired before the wallet request. Close this review and prepare a fresh intent.';
  }
  if (code === 'CONFLICT') {
    return 'The server found conflicting evidence for this one-use intent. New sends remain blocked.';
  }
  return transactionHashKnown
    ? 'The known transaction could not yet be verified. It will not be sent again.'
    : 'The EVM public-testnet proof stopped before a conclusive transaction result.';
}

function TransactionLink({ transactionHash }: { readonly transactionHash: string | null }) {
  if (transactionHash === null) return null;
  return (
    <p className="public-testnet-transaction-links" aria-label="EVM public testnet transaction">
      <a
        href={evmPublicTestnetExplorerTransactionUrl(transactionHash)}
        target="_blank"
        rel="noopener noreferrer"
      >
        View Base Sepolia transaction <span aria-hidden="true">↗</span>
      </a>
    </p>
  );
}

export const EvmPublicTestnetTransactionProof = forwardRef<
  EvmPublicTestnetSubmissionController,
  EvmPublicTestnetTransactionProofProps
>(function EvmPublicTestnetTransactionProof(
  {
    preview,
    onUnauthenticated,
    onWriteActivityChange,
    onPositionAccountChange,
    onPositionRefreshRequested,
    onSubmitReadinessChange,
    submissionMode = 'INDIVIDUAL',
    dependencies = DEFAULT_DEPENDENCIES,
  },
  submissionController,
) {
  const [phase, setPhase] = useState<ProofPhase>('RECOVERY_CHECK');
  const [wallets, setWallets] = useState<readonly InjectedProviderDescriptor[]>([]);
  const [intent, setIntent] = useState<EvmPublicTestnetExecutionIntent | null>(null);
  const [submission, setSubmission] = useState<EvmPublicTestnetSubmissionResult | null>(null);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [recoveryJournal, setRecoveryJournal] = useState<EvmPublicTestnetRecoveryJournal | null>(
    null,
  );
  const [confirmedDisclosure, setConfirmedDisclosure] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const mountedReference = useRef(true);
  const phaseReference = useRef<ProofPhase>('RECOVERY_CHECK');
  const intentReference = useRef<EvmPublicTestnetExecutionIntent | null>(null);
  const hashReference = useRef<string | null>(null);
  const recoveryReference = useRef<EvmPublicTestnetRecoveryJournal | null>(null);
  const accountReference = useRef<string | null>(null);
  const discoveryReference = useRef<EvmPublicTestnetDiscoveryPort | null>(null);
  const discoveryUnsubscribe = useRef<(() => void) | null>(null);
  const walletReference = useRef<EvmPublicTestnetWalletPort | null>(null);
  const walletUnsubscribe = useRef<(() => void) | null>(null);
  const apiReference = useRef<EvmPublicTestnetExecutionApi | null>(null);
  const operationReference = useRef<AbortController | null>(null);
  const generationReference = useRef(0);
  const submissionClaimReference = useRef(false);

  function transition(next: ProofPhase): void {
    phaseReference.current = next;
    if (mountedReference.current) setPhase(next);
  }

  function setCurrentIntent(next: EvmPublicTestnetExecutionIntent | null): void {
    intentReference.current = next;
    if (mountedReference.current) setIntent(next);
  }

  function setCurrentHash(next: string | null): void {
    hashReference.current = next;
    if (mountedReference.current) setTransactionHash(next);
  }

  function setCurrentRecovery(next: EvmPublicTestnetRecoveryJournal | null): void {
    recoveryReference.current = next;
    if (mountedReference.current) setRecoveryJournal(next);
  }

  function currentWriteActivity(): boolean {
    return recoveryReference.current !== null || ACTIVE_WRITE_PHASES.has(phaseReference.current);
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
    setCurrentIntent(null);
    setCurrentHash(null);
    setCurrentRecovery(null);
    setSubmission(null);
    setConfirmedDisclosure(false);
    setFailure(null);
  }

  function rememberDashboardAccount(account: string): void {
    let remembered = account;
    try {
      remembered = rememberEvmPublicTestnetPositionAccount(account);
    } catch {
      // This public address cache is only a convenience for read-only dashboard refreshes.
    }
    onPositionAccountChange?.(remembered);
  }

  function ensureApi(): EvmPublicTestnetExecutionApi | null {
    if (apiReference.current !== null) return apiReference.current;
    try {
      apiReference.current = dependencies.createApi();
      return apiReference.current;
    } catch {
      setFailure('The same-origin EVM verification service is unavailable. No send is allowed.');
      return null;
    }
  }

  function clearConclusiveJournal(
    tracked: EvmPublicTestnetRecoveryJournal,
    nextPhase: 'CONFIRMED' | 'FINALIZED' | 'USER_REJECTED' | 'ERROR',
    nextFailure: string | null = null,
  ): boolean {
    try {
      clearEvmPublicTestnetRecoveryJournal(tracked);
      setCurrentRecovery(null);
      setFailure(nextFailure);
      transition(nextPhase);
      return true;
    } catch {
      setFailure(
        'The server reached a conclusive result, but the durable safety marker could not be cleared. New EVM sends remain blocked.',
      );
      transition('COMMIT_AMBIGUOUS');
      return false;
    }
  }

  function retainRecoveredHash(
    tracked: EvmPublicTestnetRecoveryJournal,
    result: EvmPublicTestnetSubmissionResult,
  ): EvmPublicTestnetRecoveryJournal {
    const recoveredHash = result.transaction.transactionHash;
    if (recoveredHash === null) return tracked;
    setCurrentHash(recoveredHash);
    if (tracked.transactionHash !== null) return tracked;
    const updated = addEvmPublicTestnetRecoveryTransactionHash(tracked, recoveredHash);
    setCurrentRecovery(updated);
    return updated;
  }

  function acceptVerification(
    tracked: EvmPublicTestnetRecoveryJournal,
    result: EvmPublicTestnetSubmissionResult,
  ): void {
    setSubmission(result);
    let current = tracked;
    try {
      current = retainRecoveredHash(tracked, result);
    } catch {
      setFailure(
        'The recovered transaction hash could not be stored durably. Keep this tab open; no EVM transaction will be resent.',
      );
      transition('COMMIT_AMBIGUOUS');
      return;
    }
    onPositionRefreshRequested?.();
    if (result.status === 'CONFIRMED' || result.status === 'VERIFIED') {
      clearConclusiveJournal(current, result.status === 'VERIFIED' ? 'FINALIZED' : 'CONFIRMED');
    } else {
      setFailure(
        current.transactionHash === null
          ? 'No conclusive wallet hash is available yet. The server is checking the prepared nonce and exact Aave event without sending anything.'
          : 'The exact transaction is known but is not confirmed yet. It will not be sent again.',
      );
      transition(current.transactionHash === null ? 'COMMIT_AMBIGUOUS' : 'VERIFICATION_PENDING');
    }
  }

  async function verifyRecovery(tracked: EvmPublicTestnetRecoveryJournal): Promise<void> {
    const api = ensureApi();
    if (api === null) return;
    const { controller, generation } = beginOperation();
    setFailure(null);
    transition('VERIFYING');
    try {
      const result =
        tracked.transactionHash === null
          ? await api.query(tracked.intentId, controller.signal)
          : await api.submit(tracked.intentId, tracked.transactionHash, controller.signal);
      if (controller.signal.aborted || generation !== generationReference.current) return;
      acceptVerification(tracked, result);
    } catch (error) {
      if (isAbortFailure(error, controller.signal)) return;
      if (isEvmPublicTestnetUnauthenticated(error)) {
        onUnauthenticated?.();
        return;
      }
      const conclusive = conclusiveRetryFailure(error);
      if (conclusive !== null) {
        setSubmission(null);
        setCurrentHash(null);
        clearConclusiveJournal(
          tracked,
          'ERROR',
          conclusive === 'REPLACED'
            ? 'The prepared nonce was finalized by a different transaction. The reviewed deposit cannot land later; a fresh attempt is safe.'
            : 'The exact deposit reverted on Base Sepolia. It cannot execute later; a fresh attempt is safe.',
        );
        return;
      }
      setFailure(failureCopy(error, tracked.transactionHash !== null));
      transition(tracked.transactionHash === null ? 'COMMIT_AMBIGUOUS' : 'VERIFICATION_PENDING');
    } finally {
      if (generation === generationReference.current) operationReference.current = null;
    }
  }

  function restoreRecoveryJournal(): boolean {
    let recovered: EvmPublicTestnetRecoveryJournal | null;
    try {
      recovered = readEvmPublicTestnetRecoveryJournal();
    } catch {
      setFailure(
        'Safe EVM recovery storage is unavailable or invalid. No wallet transaction is allowed in this tab.',
      );
      transition('COMMIT_AMBIGUOUS');
      return true;
    }
    if (recovered === null) {
      abortOperation();
      releaseWallet();
      releaseDiscovery();
      clearExecutionState();
      transition('CLOSED');
      return false;
    }
    abortOperation();
    releaseWallet();
    releaseDiscovery();
    setCurrentRecovery(recovered);
    accountReference.current = recovered.account;
    rememberDashboardAccount(recovered.account);
    setCurrentIntent(null);
    setCurrentHash(recovered.transactionHash);
    setSubmission(null);
    setConfirmedDisclosure(false);
    transition('VERIFICATION_PENDING');
    void verifyRecovery(recovered);
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

  const unresolvedExecution = recoveryJournal !== null;
  const writeActive = unresolvedExecution || ACTIVE_WRITE_PHASES.has(phase);

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

  function bindWalletInvalidation(wallet: EvmPublicTestnetWalletPort): void {
    walletUnsubscribe.current?.();
    walletUnsubscribe.current = wallet.subscribeInvalidation(() => {
      abortOperation();
      setFailure(
        failureCopy(
          new EvmPublicTestnetWalletError('ACCOUNT_CHANGED'),
          hashReference.current !== null,
        ),
      );
      transition(recoveryReference.current === null ? 'ERROR' : 'COMMIT_AMBIGUOUS');
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
      setFailure('MetaMask or Coinbase Wallet discovery is unavailable in this browser context.');
      transition('ERROR');
    }
  }

  function closeReview(): void {
    if (ACTIVE_WRITE_PHASES.has(phaseReference.current) || recoveryReference.current !== null)
      return;
    abortOperation();
    releaseWallet();
    releaseDiscovery();
    clearExecutionState();
    transition('CLOSED');
  }

  async function prepareIntent(wallet: EvmPublicTestnetWalletPort, account: string): Promise<void> {
    const api = ensureApi();
    if (api === null || recoveryReference.current !== null) return;
    const { controller, generation } = beginOperation();
    setFailure(null);
    setConfirmedDisclosure(false);
    transition('PREPARING');
    try {
      const snapshot = await wallet.readSnapshot(controller.signal);
      if (snapshot.account !== account) throw new EvmPublicTestnetWalletError('ACCOUNT_CHANGED');
      const next = await api.prepare(
        evmPublicTestnetPreviewRequest(preview, account),
        controller.signal,
      );
      if (controller.signal.aborted || generation !== generationReference.current) return;
      setCurrentIntent(next);
      transition(next.fundingReadiness.status === 'READY' ? 'READY' : 'FUNDING_NEEDED');
    } catch (error) {
      if (isAbortFailure(error, controller.signal)) return;
      if (isEvmPublicTestnetUnauthenticated(error)) {
        onUnauthenticated?.();
        return;
      }
      setFailure(failureCopy(error, false));
      transition('ERROR');
    } finally {
      if (generation === generationReference.current) operationReference.current = null;
    }
  }

  async function connect(selectionId: string): Promise<void> {
    if (phaseReference.current !== 'SELECT_WALLET') return;
    const selected = discoveryReference.current?.select(selectionId);
    if (selected === null || selected === undefined) {
      setFailure('The selected EVM wallet announcement is no longer available.');
      transition('ERROR');
      return;
    }
    const { controller, generation } = beginOperation();
    transition('CONNECTING');
    try {
      const wallet = dependencies.createWallet(selected);
      walletReference.current = wallet;
      bindWalletInvalidation(wallet);
      const account = await wallet.connect(controller.signal);
      if (controller.signal.aborted || generation !== generationReference.current) return;
      accountReference.current = account;
      rememberDashboardAccount(account);
      releaseDiscovery();
      operationReference.current = null;
      await prepareIntent(wallet, account);
    } catch (error) {
      if (isAbortFailure(error, controller.signal)) return;
      setFailure(failureCopy(error, false));
      transition(
        error instanceof EvmPublicTestnetWalletError && error.code === 'USER_REJECTED'
          ? 'USER_REJECTED'
          : 'ERROR',
      );
    } finally {
      if (generation === generationReference.current) operationReference.current = null;
    }
  }

  async function verifyKnownHash(
    tracked: EvmPublicTestnetRecoveryJournal,
    knownHash: string,
  ): Promise<void> {
    const api = ensureApi();
    if (api === null) return;
    const { controller, generation } = beginOperation();
    transition('VERIFYING');
    try {
      const result = await api.submit(tracked.intentId, knownHash, controller.signal);
      if (controller.signal.aborted || generation !== generationReference.current) return;
      acceptVerification(tracked, result);
    } catch (error) {
      if (isAbortFailure(error, controller.signal)) return;
      if (isEvmPublicTestnetUnauthenticated(error)) {
        onUnauthenticated?.();
        return;
      }
      const conclusive = conclusiveRetryFailure(error);
      if (conclusive !== null) {
        setCurrentHash(null);
        clearConclusiveJournal(
          tracked,
          'ERROR',
          conclusive === 'REPLACED'
            ? 'The prepared nonce was finalized by another transaction. A fresh deposit is safe.'
            : 'The exact deposit reverted and cannot execute later. A fresh deposit is safe.',
        );
        return;
      }
      setFailure(failureCopy(error, true));
      transition('VERIFICATION_PENDING');
    } finally {
      if (generation === generationReference.current) {
        onPositionRefreshRequested?.();
        operationReference.current = null;
        onWriteActivityChange?.(currentWriteActivity());
      }
    }
  }

  async function checkKnownFinality(): Promise<void> {
    const currentIntent = intentReference.current;
    const knownHash = hashReference.current;
    const api = ensureApi();
    if (
      phaseReference.current !== 'CONFIRMED' ||
      currentIntent === null ||
      knownHash === null ||
      api === null ||
      recoveryReference.current !== null
    ) {
      return;
    }
    const { controller, generation } = beginOperation();
    setFailure(null);
    try {
      const result = await api.submit(currentIntent.intentId, knownHash, controller.signal);
      if (controller.signal.aborted || generation !== generationReference.current) return;
      setSubmission(result);
      if (result.status === 'VERIFIED') transition('FINALIZED');
      else transition('CONFIRMED');
      onPositionRefreshRequested?.();
    } catch (error) {
      if (isAbortFailure(error, controller.signal)) return;
      if (isEvmPublicTestnetUnauthenticated(error)) {
        onUnauthenticated?.();
        return;
      }
      setFailure(
        'Finality could not be refreshed. The already confirmed deposit is unchanged and will not be resent.',
      );
      transition('CONFIRMED');
    } finally {
      if (generation === generationReference.current) operationReference.current = null;
    }
  }

  async function submitTransaction(): Promise<void> {
    const wallet = walletReference.current;
    const reviewedIntent = intentReference.current;
    const account = accountReference.current;
    if (
      phaseReference.current !== 'READY' ||
      wallet === null ||
      reviewedIntent === null ||
      account === null ||
      !confirmedDisclosure ||
      recoveryReference.current !== null
    ) {
      return;
    }
    if (Date.parse(reviewedIntent.expiresAt) <= dependencies.now().getTime()) {
      setConfirmedDisclosure(false);
      void prepareIntent(wallet, account);
      return;
    }

    const { controller, generation } = beginOperation();
    let writeRequested = false;
    let tracked: EvmPublicTestnetRecoveryJournal | null = null;
    setFailure(null);
    try {
      const snapshot = await wallet.readSnapshot(controller.signal);
      if (snapshot.account !== account) throw new EvmPublicTestnetWalletError('ACCOUNT_CHANGED');
      tracked = startEvmPublicTestnetRecoveryJournal({
        chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
        intentId: reviewedIntent.intentId,
        account,
        nonce: reviewedIntent.transaction.nonce,
        evidenceExpiresAt: reviewedIntent.evidenceExpiresAt,
      });
      setCurrentRecovery(tracked);
      rememberDashboardAccount(account);
      // Freeze shared allocation controls before the provider prompt opens. The
      // phase effect below keeps this state synchronized after React commits,
      // while this direct notification closes the prompt-boundary timing gap.
      onWriteActivityChange?.(true);
      transition('SEND_PROMPT');
      writeRequested = true;
      const result = await wallet.sendTransaction(
        evmPublicTestnetWalletTransaction(reviewedIntent),
        account,
        controller.signal,
      );
      // Once the provider returns a hash, persist it even if an account/network
      // event aborted the UI generation or the component unmounted while the
      // provider prompt was open. The send already crossed its commit boundary.
      try {
        tracked = addEvmPublicTestnetRecoveryTransactionHash(tracked, result.transactionHash);
        setCurrentRecovery(tracked);
        setCurrentHash(result.transactionHash);
      } catch {
        if (mountedReference.current) {
          setFailure(
            'The wallet returned a transaction hash, but it could not be added to durable recovery storage. Keep this tab open; the null-hash recovery lock remains active.',
          );
        }
      }
      if (generation !== generationReference.current || !mountedReference.current) return;
      transition('HASH_KNOWN');
      await verifyKnownHash(tracked, result.transactionHash);
    } catch (error) {
      if (isAbortFailure(error, controller.signal) && !writeRequested) return;
      if (isEvmPublicTestnetUnauthenticated(error)) {
        onUnauthenticated?.();
        return;
      }
      if (
        writeRequested &&
        error instanceof EvmPublicTestnetWalletError &&
        error.code === 'USER_REJECTED' &&
        tracked !== null
      ) {
        clearConclusiveJournal(
          tracked,
          'USER_REJECTED',
          'The wallet rejected the request. No Base Sepolia transaction was submitted.',
        );
        return;
      }
      setFailure(failureCopy(error, hashReference.current !== null));
      transition(writeRequested ? 'COMMIT_AMBIGUOUS' : 'ERROR');
    } finally {
      if (generation === generationReference.current) {
        if (writeRequested) onPositionRefreshRequested?.();
        operationReference.current = null;
        onWriteActivityChange?.(currentWriteActivity());
      }
    }
  }

  function canRequestSubmit(): boolean {
    return (
      !submissionClaimReference.current &&
      phaseReference.current === 'READY' &&
      walletReference.current !== null &&
      intentReference.current !== null &&
      accountReference.current !== null &&
      confirmedDisclosure &&
      recoveryReference.current === null
    );
  }

  function requestSubmit(): Promise<void> | null {
    if (!canRequestSubmit()) return null;
    // Claim this lane before submitTransaction reaches its first provider await.
    // This prevents a rapid combined/individual double entry from opening two
    // EVM wallet requests for the same reviewed intent.
    submissionClaimReference.current = true;
    return submitTransaction().finally(() => {
      submissionClaimReference.current = false;
    });
  }

  function prepareAnotherDeposit(): void {
    if (
      (phaseReference.current !== 'CONFIRMED' && phaseReference.current !== 'FINALIZED') ||
      recoveryReference.current !== null
    ) {
      return;
    }
    const wallet = walletReference.current;
    const account = accountReference.current;
    if (wallet === null || account === null) {
      closeReview();
      return;
    }
    setCurrentIntent(null);
    setCurrentHash(null);
    setSubmission(null);
    setConfirmedDisclosure(false);
    setFailure(null);
    void prepareIntent(wallet, account);
  }

  const submitReady = phase === 'READY' && confirmedDisclosure && recoveryJournal === null;

  useEffect(() => {
    onSubmitReadinessChange?.(submitReady);
    return () => onSubmitReadinessChange?.(false);
  }, [onSubmitReadinessChange, submitReady]);

  useImperativeHandle(submissionController, () => ({ canRequestSubmit, requestSubmit }));

  const closeDisabled =
    phase === 'RECOVERY_CHECK' || ACTIVE_WRITE_PHASES.has(phase) || unresolvedExecution;
  const publicTargetDisclosed = phase !== 'RECOVERY_CHECK' && phase !== 'CLOSED';

  return (
    <section className="public-testnet-proof" aria-labelledby="evm-public-testnet-proof-title">
      <div className="public-testnet-proof-heading">
        <div>
          <p className="eyebrow">Live EVM public-testnet proof</p>
          <h4 id="evm-public-testnet-proof-title">
            {publicTargetDisclosed
              ? 'Try one real Base Sepolia lending position'
              : 'Try one real EVM testnet lending position'}
          </h4>
        </div>
        <span>{publicTargetDisclosed ? 'Base Sepolia' : 'EVM testnet'} · exactly 0.00005 ETH</span>
      </div>
      <p>
        This optional proof supplies free, no-real-value test ETH to one fixed public lending
        market. It is separate from the managed blend and does not validate the displayed APY.
      </p>

      {phase === 'RECOVERY_CHECK' ? (
        <p className="public-testnet-phase-status" role="status">
          Checking this tab for an unresolved EVM testnet transaction.
        </p>
      ) : phase === 'CLOSED' ? (
        <button className="public-testnet-review-action" type="button" onClick={openReview}>
          Review 0.00005 ETH EVM testnet proof
        </button>
      ) : (
        <div className="public-testnet-confirmation-panel">
          <div className="public-testnet-confirmation-heading">
            <div>
              <strong>Base Sepolia transaction review</strong>
              <small>This flow cannot authorize an EVM Mainnet transaction.</small>
            </div>
            <button type="button" disabled={closeDisabled} onClick={closeReview}>
              Close
            </button>
          </div>

          <div className="public-testnet-disclosure" role="note">
            <strong>Public-chain disclosure</strong>
            <p>
              MetaMask or Coinbase Wallet and the public explorer reveal Aave V3, the gateway,
              wallet address, value, calldata, and resulting position. The wallet broadcasts this
              transaction; the application server only prepares and verifies it.
            </p>
          </div>

          {phase === 'SELECT_WALLET' ? (
            <div className="public-testnet-wallet-selection">
              <p>Select an explicitly discovered MetaMask or Coinbase Wallet.</p>
              {wallets.length === 0 ? (
                <p role="status">No compatible EIP-6963 wallet announcement was found.</p>
              ) : (
                <div role="group" aria-label="Compatible Base Sepolia wallets">
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
              <strong>Free Base Sepolia ETH is needed</strong>
              <ol>
                <li>Open the official Coinbase Developer Platform faucet.</li>
                <li>Sign in if requested and choose Base Sepolia.</li>
                <li>Paste the connected public address and request test ETH.</li>
                <li>Return here and recheck the wallet balance.</li>
              </ol>
              <p>
                Readiness requires 0.0001 test ETH for the 0.00005 ETH deposit plus gas headroom.
                Testnet ETH has no monetary value. Never pay for it or enter a seed phrase.
              </p>
              <div className="public-testnet-faucet-actions">
                <a
                  href={intent.fundingReadiness.faucetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open official Base faucet <span aria-hidden="true">↗</span>
                </a>
              </div>
              <button
                className="portfolio-secondary-action"
                type="button"
                onClick={() => {
                  const wallet = walletReference.current;
                  const account = accountReference.current;
                  if (wallet !== null && account !== null) void prepareIntent(wallet, account);
                }}
              >
                Recheck Base Sepolia ETH
              </button>
            </div>
          ) : null}

          {phase === 'READY' && intent !== null ? (
            <div className="public-testnet-submit-review">
              <dl>
                <div>
                  <dt>Network</dt>
                  <dd>Base Sepolia · chain 84532</dd>
                </div>
                <div>
                  <dt>Deposit</dt>
                  <dd>0.00005 native test ETH</dd>
                </div>
                <div>
                  <dt>Wallet confirmations</dt>
                  <dd>1 EVM transaction</dd>
                </div>
                <div>
                  <dt>Nonce</dt>
                  <dd>{intent.transaction.nonce}</dd>
                </div>
                <div>
                  <dt>Aave WETH gateway</dt>
                  <dd>
                    <code>{intent.transaction.to}</code>
                  </dd>
                </div>
                <div>
                  <dt>Intent expires</dt>
                  <dd>
                    <time dateTime={intent.expiresAt}>{intent.expiresAt}</time>
                  </dd>
                </div>
              </dl>
              <p className="public-testnet-position-note" role="note">
                The exact calldata is bound to this one-use intent. Your wallet estimates gas and
                broadcasts the transaction. Inspect the network, target, value, and total gas cost
                before approving.
              </p>
              <p className="public-testnet-position-note" role="note">
                Confirmation usually appears in seconds; Base finality can take roughly 20 minutes
                and is reported separately. The test position remains on-chain until withdrawn
                outside this demo.
              </p>
              <label className="public-testnet-confirm-checkbox">
                <input
                  type="checkbox"
                  checked={confirmedDisclosure}
                  onChange={(event) => setConfirmedDisclosure(event.currentTarget.checked)}
                />
                I understand this sends one public Base Sepolia transaction, is independent from the
                Solana proof and displayed blend, and does not automatically withdraw the test
                position.
              </label>
              {submissionMode === 'INDIVIDUAL' ? (
                <button
                  className="public-testnet-submit-action"
                  type="button"
                  disabled={!confirmedDisclosure}
                  onClick={() => void requestSubmit()}
                >
                  Submit Base Sepolia transaction
                </button>
              ) : (
                <p className="public-testnet-combined-lane-status" role="status">
                  {confirmedDisclosure
                    ? 'EVM review ready for the combined submission.'
                    : 'Confirm the EVM disclosure to enable the combined submission.'}
                </p>
              )}
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

          <TransactionLink transactionHash={transactionHash} />

          {submission === null ? null : (
            <dl className="public-testnet-verification-status" aria-label="Latest EVM verification">
              <div>
                <dt>Transaction</dt>
                <dd>{submission.transaction.status}</dd>
              </div>
              <div>
                <dt>Aave position increase</dt>
                <dd>{submission.position.status}</dd>
              </div>
            </dl>
          )}

          {unresolvedExecution ? (
            <div className="public-testnet-recovery-note" role="note">
              <p>
                Keep this tab open when possible. This EVM lock affects only new EVM sends; the
                Solana proof remains independently available.
              </p>
              <p>
                EVM transactions do not expire like Solana blockhash transactions. The lock clears
                only after exact receipt/position evidence or finalized nonce-replacement evidence,
                never from a timer or missing RPC result alone.
              </p>
              <a href="#evm-public-testnet-lending-dashboard">View EVM lending dashboard</a>
            </div>
          ) : null}

          {recoveryJournal !== null ? (
            <div className="public-testnet-recovery-controls">
              <button
                className="portfolio-secondary-action"
                type="button"
                disabled={phase === 'VERIFYING'}
                onClick={() => void verifyRecovery(recoveryJournal)}
              >
                Check EVM verification
              </button>
              <small>Read-only: this button never sends or replaces a transaction.</small>
            </div>
          ) : null}

          {phase === 'CONFIRMED' || phase === 'FINALIZED' ? (
            <div className="public-testnet-success" role="status">
              <strong>
                {phase === 'FINALIZED'
                  ? 'Base Sepolia lending proof finalized'
                  : 'Base Sepolia lending proof confirmed'}
              </strong>
              <p>
                The server matched the exact transaction, Aave Supply event, and positive aWETH
                position increase. {phase === 'CONFIRMED' ? 'L1 finality is still pending.' : ''}
              </p>
              <a href="#evm-public-testnet-lending-dashboard">View in EVM lending dashboard</a>
              {phase === 'CONFIRMED' ? (
                <button
                  className="portfolio-secondary-action"
                  type="button"
                  onClick={() => void checkKnownFinality()}
                >
                  Check Base finality
                </button>
              ) : null}
              <button
                className="portfolio-secondary-action"
                type="button"
                onClick={prepareAnotherDeposit}
              >
                Review another 0.00005 ETH deposit
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
});
