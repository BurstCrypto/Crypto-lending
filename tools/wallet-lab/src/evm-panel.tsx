import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { verifyMessage } from 'viem';
import {
  useConnect,
  useConnections,
  useDisconnect,
  useReconnect,
  useSignMessage,
  useSwitchChain,
  type Connection,
  type Connector,
} from 'wagmi';

import {
  EVM_TESTNET_CHAIN_IDS,
  inspectWalletConnectSession,
  isApprovedEvmConnector,
  isEvmOwnershipProofReady,
  isEvmTestnetChainId,
  isWalletConnectConnector,
  subscribeWalletConnectSessionLifecycle,
  type EvmRuntime,
  type EvmTestnetChainId,
  type WalletConnectScopeStatus,
  type WalletConnectSessionLifecycleSignal,
} from './evm';
import { connectionIdForConnectorId } from './evidence';
import type {
  LabChainContext,
  LabChainId,
  LabConnectorId,
  LabEventKind,
  LabEventOutcome,
} from './evidence';
import { sanitizeEvmWalletError, shortenWalletAddress } from './presentation';

interface EvidenceInput {
  connectorId: LabConnectorId;
  chainId: LabChainId;
  chainContext: LabChainContext;
  kind: LabEventKind;
  outcome: LabEventOutcome;
  accountObserved?: boolean;
}

interface EvmPanelProps {
  runtime: EvmRuntime;
  onEvidence(input: EvidenceInput): void;
}

interface ObservedEvmConnection {
  readonly account: string | undefined;
  readonly accountCount: number;
  readonly chainId: number;
  readonly connector: Connector;
}

interface WalletConnectPairingDisplay {
  readonly uri: string;
  readonly requestedChainId: Extract<LabChainId, `eip155:${string}`>;
}

type WalletConnectGuardResult = 'accepted' | 'blocked' | 'stale';

interface LocalAuthorizationState {
  readonly authorized: boolean;
  readonly connectorId: LabConnectorId | null;
  readonly revision: number;
}

interface AuthorizationSnapshot {
  readonly identity: string;
  readonly revision: number;
}

interface PendingSwitch {
  readonly account: string;
  readonly initialChainId: number;
  readonly initialRevision: number;
  readonly targetChainId: EvmTestnetChainId;
  observedRevision?: number;
}

const DEFAULT_EVM_FEEDBACK = 'Choose an explicit wallet and testnet.';

const EVM_NETWORKS: readonly {
  chainId: EvmTestnetChainId;
  caipId: Extract<LabChainId, `eip155:${string}`>;
  name: string;
}[] = [
  {
    chainId: EVM_TESTNET_CHAIN_IDS.sepolia,
    caipId: 'eip155:11155111',
    name: 'Sepolia',
  },
  {
    chainId: EVM_TESTNET_CHAIN_IDS.baseSepolia,
    caipId: 'eip155:84532',
    name: 'Base Sepolia',
  },
];

function connectorIdForEvidence(connector: Connector | undefined): LabConnectorId {
  if (!connector || !isApprovedEvmConnector(connector)) return 'unapproved';
  if (isWalletConnectConnector(connector)) return 'walletconnect';
  if (connector.id === 'coinbaseWalletSDK' && connector.type === 'coinbaseWallet') {
    return 'coinbase';
  }
  if (connector.id === 'io.metamask' && connector.type === 'injected') return 'metamask';
  return 'unapproved';
}

function applicationConnectionId(connector: Connector): string {
  return connectionIdForConnectorId(connectorIdForEvidence(connector));
}

function safeConnectorName(connector: Connector): string {
  const normalized = [...connector.name]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized.slice(0, 64) || 'Injected wallet';
}

function networkForChainId(chainId: EvmTestnetChainId) {
  const network = EVM_NETWORKS.find((candidate) => candidate.chainId === chainId);
  if (!network) throw new Error('The selected EVM testnet is not configured.');
  return network;
}

function observedEvmChain(
  chainId: number | undefined,
): Pick<EvidenceInput, 'chainId' | 'chainContext'> {
  if (chainId === EVM_TESTNET_CHAIN_IDS.sepolia) {
    return { chainId: 'eip155:11155111', chainContext: 'observed' };
  }
  if (chainId === EVM_TESTNET_CHAIN_IDS.baseSepolia) {
    return { chainId: 'eip155:84532', chainContext: 'observed' };
  }
  return { chainId: 'evm:unsupported', chainContext: 'observed' };
}

function createEvmProofMessage(address: string, chainId: EvmTestnetChainId): string {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 5 * 60_000);
  return [
    'Crypto Lending restricted wallet lab',
    'Sign this message only to prove control of this disposable testnet wallet.',
    'This does not authorize a transaction, loan, transfer, or production login.',
    `Origin: ${window.location.origin}`,
    `Address: ${address}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${crypto.randomUUID()}`,
    `Issued at: ${issuedAt.toISOString()}`,
    `Expires at: ${expiresAt.toISOString()}`,
  ].join('\n');
}

function onlyConnectionAccount(
  connection: Pick<Connection, 'accounts'> | undefined,
): Connection['accounts'][number] | undefined {
  return connection?.accounts.length === 1 ? connection.accounts[0] : undefined;
}

function connectionFingerprint(connection: ObservedEvmConnection): string {
  return [
    connection.connector.id,
    connection.connector.type,
    connection.accountCount,
    connection.account?.toLowerCase() ?? 'none',
    connection.chainId,
  ].join(':');
}

export function EvmPanel({ runtime, onEvidence }: EvmPanelProps) {
  const connections = useConnections();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const reconnect = useReconnect();
  const signMessage = useSignMessage();
  const switchChain = useSwitchChain();
  const [selectedConnectorUid, setSelectedConnectorUid] = useState('');
  const [targetChainIds, setTargetChainIds] = useState<Readonly<Record<string, EvmTestnetChainId>>>(
    {},
  );
  const [feedbackByConnectorUid, setFeedbackByConnectorUid] = useState<
    Readonly<Record<string, string>>
  >({});
  const [policyFeedback, setPolicyFeedback] = useState<string | null>(null);
  const [deniedConnectorUids, setDeniedConnectorUids] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [authorizedConnectorUids, setAuthorizedConnectorUids] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [restoring, setRestoring] = useState(false);
  const [pairingDisplay, setPairingDisplay] = useState<WalletConnectPairingDisplay | null>(null);
  const [walletConnectScope, setWalletConnectScope] =
    useState<WalletConnectScopeStatus>('not-applicable');
  const [walletConnectCanSwitch, setWalletConnectCanSwitch] = useState(false);
  const [guardedWalletConnectIdentity, setGuardedWalletConnectIdentity] = useState<string | null>(
    null,
  );
  const walletConnectLifecycleUnsubscribe = useRef<(() => void) | null>(null);
  const walletConnectGuardGeneration = useRef(0);
  const walletConnectScopeRef = useRef<WalletConnectScopeStatus>('not-applicable');
  const guardedWalletConnectIdentityRef = useRef<string | null>(null);
  const walletConnectGuardInFlight = useRef<{
    identity: string;
    promise: Promise<WalletConnectGuardResult>;
  } | null>(null);
  const walletConnectRequestedChainId =
    useRef<Extract<LabChainId, `eip155:${string}`>>('eip155:11155111');
  const observedConnections = useRef<ReadonlyMap<string, ObservedEvmConnection>>(new Map());
  const connectionsRef = useRef(connections);
  const localAuthorizationByUid = useRef<Map<string, LocalAuthorizationState>>(new Map());
  const pendingAuthorizationUids = useRef<Set<string>>(new Set());
  const explicitDisconnectUids = useRef<Set<string>>(new Set());
  const pendingSwitches = useRef<Map<string, PendingSwitch>>(new Map());
  const restoringRef = useRef(false);
  connectionsRef.current = connections;

  const connectors = useMemo(() => {
    const byConnectorId = new Map<LabConnectorId, Connector>();
    for (const connection of connections) {
      if (isApprovedEvmConnector(connection.connector)) {
        const connectorId = connectorIdForEvidence(connection.connector);
        if (!byConnectorId.has(connectorId)) {
          byConnectorId.set(connectorId, connection.connector);
        }
      }
    }
    for (const candidate of connect.connectors) {
      if (!isApprovedEvmConnector(candidate)) continue;
      const connectorId = connectorIdForEvidence(candidate);
      if (!byConnectorId.has(connectorId)) byConnectorId.set(connectorId, candidate);
    }
    return [...byConnectorId.values()];
  }, [connect.connectors, connections]);
  const selectedConnector = connectors.find(({ uid }) => uid === selectedConnectorUid);
  const selectedConnection = connections.find(
    ({ connector }) => connector.uid === selectedConnectorUid,
  );
  const approvedConnections = useMemo(() => {
    const seen = new Set<LabConnectorId>();
    return connections.filter(({ connector }) => {
      if (!isApprovedEvmConnector(connector)) return false;
      const connectorId = connectorIdForEvidence(connector);
      if (seen.has(connectorId)) return false;
      seen.add(connectorId);
      return true;
    });
  }, [connections]);
  const authorizedConnections = useMemo(
    () =>
      approvedConnections.filter(
        (connection) =>
          authorizedConnectorUids.has(connection.connector.uid) &&
          isLocallyAuthorized(connection.connector) &&
          !deniedConnectorUids.has(connection.connector.uid) &&
          connection.accounts.length === 1 &&
          isEvmTestnetChainId(connection.chainId),
      ),
    [approvedConnections, authorizedConnectorUids, deniedConnectorUids],
  );
  const selectedAddress = onlyConnectionAccount(selectedConnection);
  const targetChainId = selectedConnector
    ? (targetChainIds[selectedConnector.uid] ?? EVM_TESTNET_CHAIN_IDS.sepolia)
    : EVM_TESTNET_CHAIN_IDS.sepolia;
  const targetNetwork = networkForChainId(targetChainId);
  const selectedFeedback = selectedConnector
    ? (feedbackByConnectorUid[selectedConnector.uid] ?? DEFAULT_EVM_FEEDBACK)
    : DEFAULT_EVM_FEEDBACK;
  const walletConnectConnection = approvedConnections.find(({ connector }) =>
    isWalletConnectConnector(connector),
  );
  const walletConnectAddress = onlyConnectionAccount(walletConnectConnection);
  const currentWalletConnectIdentity =
    walletConnectConnection &&
    walletConnectAddress !== undefined &&
    isEvmTestnetChainId(walletConnectConnection.chainId)
      ? `${walletConnectConnection.connector.uid}:${walletConnectConnection.chainId}:${walletConnectAddress.toLowerCase()}`
      : null;

  useEffect(() => {
    if (selectedConnector && connectors.some(({ uid }) => uid === selectedConnector.uid)) return;
    setSelectedConnectorUid(connectors[0]?.uid ?? '');
  }, [connectors, selectedConnector]);

  useEffect(() => {
    const subscription = runtime.subscribeWalletConnectDisplayUri((uri) => {
      const requestedChainId = walletConnectRequestedChainId.current;
      setPairingDisplay({ uri, requestedChainId });
      onEvidence({
        connectorId: 'walletconnect',
        chainId: requestedChainId,
        chainContext: 'requested',
        kind: 'qr-display',
        outcome: 'accepted',
      });
    });
    if (!subscription.available) return;
    return subscription.unsubscribe;
  }, [onEvidence, runtime]);

  useEffect(() => {
    if (!pairingDisplay) return;
    const timeout = window.setTimeout(() => {
      setPairingDisplay(null);
      onEvidence({
        connectorId: 'walletconnect',
        chainId: pairingDisplay.requestedChainId,
        chainContext: 'requested',
        kind: 'pairing-expire',
        outcome: 'cleared',
      });
    }, 5 * 60_000);
    return () => window.clearTimeout(timeout);
  }, [onEvidence, pairingDisplay]);

  useEffect(
    () => () => {
      clearWalletConnectLifecycleGuard();
    },
    [],
  );

  useEffect(() => {
    const previous = observedConnections.current;
    const next = new Map<string, ObservedEvmConnection>();
    const claimedConnectorIds = new Map<LabConnectorId, string>();

    for (const active of connections) {
      const account = onlyConnectionAccount(active);
      const current: ObservedEvmConnection = {
        account,
        accountCount: active.accounts.length,
        chainId: active.chainId,
        connector: active.connector,
      };
      next.set(active.connector.uid, current);
      const prior = previous.get(active.connector.uid);
      const firstOrChanged =
        prior === undefined || connectionFingerprint(prior) !== connectionFingerprint(current);

      if (!isApprovedEvmConnector(active.connector)) {
        if (firstOrChanged) {
          denyConnector(active.connector);
          setPolicyFeedback('Blocked: an unapproved EVM connector was quarantined.');
          onEvidence({
            connectorId: 'unapproved',
            ...observedEvmChain(active.chainId),
            kind: 'connect',
            outcome: 'blocked',
            accountObserved: active.accounts.length > 0,
          });
          void disconnect.disconnectAsync({ connector: active.connector }).catch(() => undefined);
        }
        continue;
      }

      const connectorId = connectorIdForEvidence(active.connector);
      const claimedUid = claimedConnectorIds.get(connectorId);
      if (claimedUid && claimedUid !== active.connector.uid) {
        if (firstOrChanged) {
          denyConnector(active.connector);
          setPolicyFeedback(
            'Blocked: only one live session is allowed for each approved connector.',
          );
          onEvidence({
            connectorId,
            ...observedEvmChain(active.chainId),
            kind: 'connect',
            outcome: 'blocked',
            accountObserved: active.accounts.length > 0,
          });
          void disconnect.disconnectAsync({ connector: active.connector }).catch(() => undefined);
        }
        continue;
      }
      claimedConnectorIds.set(connectorId, active.connector.uid);

      if (
        !isLocallyAuthorized(active.connector) &&
        !pendingAuthorizationUids.current.has(active.connector.uid)
      ) {
        if (firstOrChanged) {
          denyConnector(active.connector);
          setConnectorFeedback(
            active.connector,
            'Blocked: this session appeared without an explicit Connect or Restore action.',
          );
          onEvidence({
            connectorId,
            ...observedEvmChain(active.chainId),
            kind: 'connect',
            outcome: 'blocked',
            accountObserved: active.accounts.length > 0,
          });
          if (isWalletConnectConnector(active.connector)) {
            clearWalletConnectLifecycleGuard();
            blockWalletConnectScope();
          }
          void disconnect.disconnectAsync({ connector: active.connector }).catch(() => undefined);
        }
        continue;
      }

      if (active.accounts.length !== 1) {
        if (firstOrChanged) {
          denyConnector(active.connector);
          setConnectorFeedback(
            active.connector,
            'Blocked: this session must expose exactly one test account.',
          );
          onEvidence({
            connectorId: connectorIdForEvidence(active.connector),
            ...observedEvmChain(active.chainId),
            kind: 'account-change',
            outcome: 'blocked',
            accountObserved: active.accounts.length > 0,
          });
          if (isWalletConnectConnector(active.connector)) {
            clearWalletConnectLifecycleGuard();
            blockWalletConnectScope();
          }
          void disconnect.disconnectAsync({ connector: active.connector }).catch(() => undefined);
        }
        continue;
      }

      if (prior && prior.account?.toLowerCase() !== account?.toLowerCase()) {
        bumpAuthorizationRevision(active.connector.uid);
        setConnectorFeedback(active.connector, 'The selected wallet account changed.');
        onEvidence({
          connectorId: connectorIdForEvidence(active.connector),
          ...observedEvmChain(active.chainId),
          kind: 'account-change',
          outcome: 'accepted',
          accountObserved: true,
        });
      }
      if (prior && prior.chainId !== active.chainId) {
        const revision = bumpAuthorizationRevision(active.connector.uid);
        const pendingSwitch = pendingSwitches.current.get(active.connector.uid);
        if (
          pendingSwitch &&
          pendingSwitch.account === account?.toLowerCase() &&
          pendingSwitch.targetChainId === active.chainId &&
          revision === pendingSwitch.initialRevision + 1
        ) {
          pendingSwitch.observedRevision = revision;
        }
        const allowed = isEvmTestnetChainId(active.chainId);
        setConnectorFeedback(
          active.connector,
          allowed
            ? `Wallet changed to ${networkForChainId(active.chainId as EvmTestnetChainId).name}.`
            : 'Unsupported chain detected; signing remains disabled for this wallet.',
        );
        onEvidence({
          connectorId: connectorIdForEvidence(active.connector),
          ...observedEvmChain(active.chainId),
          kind: 'chain-change',
          outcome: allowed ? 'accepted' : 'blocked',
          accountObserved: true,
        });
      }
    }

    for (const [uid, prior] of previous) {
      if (next.has(uid)) continue;
      denyConnector(prior.connector);
      if (explicitDisconnectUids.current.delete(uid)) continue;
      onEvidence({
        connectorId: connectorIdForEvidence(prior.connector),
        ...observedEvmChain(prior.chainId),
        kind: 'disconnect',
        outcome: 'cleared',
        accountObserved: false,
      });
    }

    observedConnections.current = next;
  }, [connections, disconnect, onEvidence]);

  const busy =
    connect.isPending ||
    disconnect.isPending ||
    reconnect.isPending ||
    restoring ||
    signMessage.isPending ||
    switchChain.isPending;
  const selectedChainAllowed = isEvmTestnetChainId(selectedConnection?.chainId);
  const selectedConnectorApproved =
    selectedConnection !== undefined && isApprovedEvmConnector(selectedConnection.connector);
  const selectedIsWalletConnect = isWalletConnectConnector(selectedConnection?.connector);
  const selectedLocallyDenied = selectedConnection
    ? deniedConnectorUids.has(selectedConnection.connector.uid) ||
      !authorizedConnectorUids.has(selectedConnection.connector.uid) ||
      !isLocallyAuthorized(selectedConnection.connector)
    : false;
  const selectedWalletConnectIdentity =
    selectedIsWalletConnect && selectedAddress !== undefined && selectedChainAllowed
      ? `${selectedConnection.connector.uid}:${selectedConnection.chainId}:${selectedAddress.toLowerCase()}`
      : null;
  const walletConnectScopeAccepted =
    !selectedIsWalletConnect ||
    (walletConnectScope === 'accepted' &&
      guardedWalletConnectIdentity === selectedWalletConnectIdentity);
  const proofReady = isEvmOwnershipProofReady({
    connected: selectedConnectorApproved && selectedAddress !== undefined && !selectedLocallyDenied,
    currentChainId: selectedConnection?.chainId,
    targetChainId,
    walletConnect: selectedIsWalletConnect,
    walletConnectScope,
    currentWalletConnectIdentity: selectedWalletConnectIdentity,
    guardedWalletConnectIdentity,
  });

  function setConnectorFeedback(connector: Connector | string, message: string) {
    const uid = typeof connector === 'string' ? connector : connector.uid;
    setFeedbackByConnectorUid((current) => ({ ...current, [uid]: message }));
  }

  function setConnectorTarget(connector: Connector, chainId: EvmTestnetChainId) {
    setTargetChainIds((current) => ({ ...current, [connector.uid]: chainId }));
  }

  function bumpAuthorizationRevision(uid: string): number {
    const current = localAuthorizationByUid.current.get(uid) ?? {
      authorized: false,
      connectorId: null,
      revision: 0,
    };
    const revision = current.revision + 1;
    localAuthorizationByUid.current.set(uid, { ...current, revision });
    return revision;
  }

  function denyConnector(connector: Connector) {
    const current = localAuthorizationByUid.current.get(connector.uid) ?? {
      authorized: false,
      connectorId: null,
      revision: 0,
    };
    localAuthorizationByUid.current.set(connector.uid, {
      authorized: false,
      connectorId: current.connectorId,
      revision: current.revision + 1,
    });
    pendingAuthorizationUids.current.delete(connector.uid);
    setAuthorizedConnectorUids((authorized) => {
      if (!authorized.has(connector.uid)) return authorized;
      const next = new Set(authorized);
      next.delete(connector.uid);
      return next;
    });
    setDeniedConnectorUids((current) => {
      if (current.has(connector.uid)) return current;
      return new Set([...current, connector.uid]);
    });
  }

  function allowConnector(connector: Connector) {
    const current = localAuthorizationByUid.current.get(connector.uid) ?? {
      authorized: false,
      connectorId: null,
      revision: 0,
    };
    localAuthorizationByUid.current.set(connector.uid, {
      authorized: true,
      connectorId: connectorIdForEvidence(connector),
      revision: current.revision + 1,
    });
    pendingAuthorizationUids.current.delete(connector.uid);
    explicitDisconnectUids.current.delete(connector.uid);
    setAuthorizedConnectorUids((authorized) => {
      if (authorized.has(connector.uid)) return authorized;
      return new Set([...authorized, connector.uid]);
    });
    setDeniedConnectorUids((current) => {
      if (!current.has(connector.uid)) return current;
      const next = new Set(current);
      next.delete(connector.uid);
      return next;
    });
  }

  function isLocallyAuthorized(connector: Connector): boolean {
    const authorization = localAuthorizationByUid.current.get(connector.uid);
    return (
      authorization?.authorized === true &&
      authorization.connectorId === connectorIdForEvidence(connector)
    );
  }

  function latestConnectionForConnector(
    connector: Connector,
    fallback?: Connection,
  ): Connection | undefined {
    const configured = runtime.providerProps?.config.state.connections.get(connector.uid);
    if (runtime.providerProps?.config) return configured;
    return (
      connectionsRef.current.find((candidate) => candidate.connector.uid === connector.uid) ??
      fallback
    );
  }

  function authorizationIdentity(connection: Connection | undefined): string | null {
    const account = onlyConnectionAccount(connection);
    return connection && account
      ? `${connection.connector.uid}:${connection.chainId}:${account.toLowerCase()}`
      : null;
  }

  function isAuthorizationSnapshotCurrent(
    connector: Connector,
    snapshot: AuthorizationSnapshot,
  ): boolean {
    const authorization = localAuthorizationByUid.current.get(connector.uid);
    if (!isLocallyAuthorized(connector) || authorization?.revision !== snapshot.revision) {
      return false;
    }
    const latest = latestConnectionForConnector(connector);
    if (
      !latest ||
      !isApprovedEvmConnector(latest.connector) ||
      connectorIdForEvidence(latest.connector) !== connectorIdForEvidence(connector)
    ) {
      return false;
    }
    if (authorizationIdentity(latest) !== snapshot.identity) return false;
    if (!isEvmTestnetChainId(latest.chainId)) return false;
    if (!isWalletConnectConnector(connector)) return true;
    return (
      walletConnectScopeRef.current === 'accepted' &&
      guardedWalletConnectIdentityRef.current === snapshot.identity
    );
  }

  function clearWalletConnectLifecycleGuard() {
    walletConnectGuardGeneration.current += 1;
    walletConnectGuardInFlight.current = null;
    const unsubscribe = walletConnectLifecycleUnsubscribe.current;
    walletConnectLifecycleUnsubscribe.current = null;
    try {
      unsubscribe?.();
    } catch {
      // A hostile provider cannot retain authorization by throwing in cleanup.
    }
  }

  function blockWalletConnectScope() {
    walletConnectScopeRef.current = 'blocked';
    guardedWalletConnectIdentityRef.current = null;
    setWalletConnectScope('blocked');
    setWalletConnectCanSwitch(false);
    setGuardedWalletConnectIdentity(null);
    setPairingDisplay(null);
  }

  function pendWalletConnectScope() {
    walletConnectScopeRef.current = 'pending';
    guardedWalletConnectIdentityRef.current = null;
    setWalletConnectScope('pending');
    setWalletConnectCanSwitch(false);
    setGuardedWalletConnectIdentity(null);
  }

  function acceptWalletConnectScope(identity: string, canSwitchChain: boolean) {
    walletConnectScopeRef.current = 'accepted';
    guardedWalletConnectIdentityRef.current = identity;
    setWalletConnectScope('accepted');
    setWalletConnectCanSwitch(canSwitchChain);
    setGuardedWalletConnectIdentity(identity);
    setPairingDisplay(null);
  }

  function resetWalletConnectScope() {
    walletConnectScopeRef.current = 'not-applicable';
    guardedWalletConnectIdentityRef.current = null;
    setWalletConnectScope('not-applicable');
    setWalletConnectCanSwitch(false);
    setGuardedWalletConnectIdentity(null);
  }

  function guardWalletConnectSession(
    connector: Connector,
    chainId: EvmTestnetChainId,
    address: string,
  ): Promise<WalletConnectGuardResult> {
    const identity = `${connector.uid}:${chainId}:${address.toLowerCase()}`;
    const existing = walletConnectGuardInFlight.current;
    if (existing?.identity === identity) return existing.promise;

    clearWalletConnectLifecycleGuard();
    const generation = walletConnectGuardGeneration.current;
    pendWalletConnectScope();

    const promise = (async (): Promise<WalletConnectGuardResult> => {
      let provider: unknown;
      try {
        provider = await connector.getProvider();
      } catch {
        if (generation !== walletConnectGuardGeneration.current) return 'stale';
        blockWalletConnectScope();
        return 'blocked';
      }
      if (generation !== walletConnectGuardGeneration.current) return 'stale';

      const handleSessionUpdate = () => {
        if (generation !== walletConnectGuardGeneration.current) return;
        bumpAuthorizationRevision(connector.uid);
        pendWalletConnectScope();

        const latest = latestConnectionForConnector(connector);
        const latestAddress = onlyConnectionAccount(latest);
        if (
          !latest ||
          !isWalletConnectConnector(latest.connector) ||
          !latestAddress ||
          !isEvmTestnetChainId(latest.chainId)
        ) {
          denyConnector(connector);
          clearWalletConnectLifecycleGuard();
          blockWalletConnectScope();
          setConnectorFeedback(connector, 'WalletConnect session update was blocked.');
          onEvidence({
            connectorId: 'walletconnect',
            ...observedEvmChain(latest?.chainId ?? chainId),
            kind: 'session-update',
            outcome: 'blocked',
            accountObserved: Boolean(latestAddress),
          });
          void disconnect.disconnectAsync({ connector }).catch(() => undefined);
          return;
        }

        const updated = inspectWalletConnectSession(provider, {
          chainId: latest.chainId,
          address: latestAddress,
        });
        if (!updated.accepted) {
          denyConnector(connector);
          clearWalletConnectLifecycleGuard();
          blockWalletConnectScope();
          setConnectorFeedback(
            connector,
            `WalletConnect session update blocked: ${updated.reason}.`,
          );
          onEvidence({
            connectorId: 'walletconnect',
            ...observedEvmChain(latest.chainId),
            kind: 'session-update',
            outcome: 'blocked',
            accountObserved: true,
          });
          void disconnect.disconnectAsync({ connector }).catch(() => undefined);
          return;
        }

        const latestIdentity = `${connector.uid}:${latest.chainId}:${latestAddress.toLowerCase()}`;
        acceptWalletConnectScope(latestIdentity, updated.canSwitchChain);
        onEvidence({
          connectorId: 'walletconnect',
          ...observedEvmChain(latest.chainId),
          kind: 'session-update',
          outcome: 'accepted',
          accountObserved: true,
        });
      };

      const handleSessionLifecycle = (signal: WalletConnectSessionLifecycleSignal) => {
        if (signal === 'session-update') {
          handleSessionUpdate();
          return;
        }
        if (generation !== walletConnectGuardGeneration.current) return;
        const latest = latestConnectionForConnector(connector);
        const latestAddress = onlyConnectionAccount(latest);
        clearWalletConnectLifecycleGuard();
        blockWalletConnectScope();
        denyConnector(connector);
        setPairingDisplay(null);
        setConnectorFeedback(
          connector,
          signal === 'session-delete'
            ? 'WalletConnect session was deleted; signing was revoked.'
            : 'WalletConnect session expired; signing was revoked.',
        );
        onEvidence({
          connectorId: 'walletconnect',
          ...observedEvmChain(latest?.chainId ?? chainId),
          kind: signal,
          outcome: 'cleared',
          accountObserved: Boolean(latestAddress),
        });
        void disconnect.disconnectAsync({ connector }).catch(() => undefined);
      };

      const unsubscribe = subscribeWalletConnectSessionLifecycle(provider, handleSessionLifecycle);
      if (!unsubscribe) {
        if (generation !== walletConnectGuardGeneration.current) return 'stale';
        blockWalletConnectScope();
        return 'blocked';
      }
      if (generation !== walletConnectGuardGeneration.current) {
        unsubscribe();
        return 'stale';
      }
      walletConnectLifecycleUnsubscribe.current = unsubscribe;

      const inspection = inspectWalletConnectSession(provider, { chainId, address });
      if (generation !== walletConnectGuardGeneration.current) {
        unsubscribe();
        return 'stale';
      }
      if (!inspection.accepted) {
        clearWalletConnectLifecycleGuard();
        blockWalletConnectScope();
        return 'blocked';
      }

      acceptWalletConnectScope(identity, inspection.canSwitchChain);
      return 'accepted';
    })();

    walletConnectGuardInFlight.current = { identity, promise };
    void promise.then(() => {
      if (walletConnectGuardInFlight.current?.promise === promise) {
        walletConnectGuardInFlight.current = null;
      }
    });
    return promise;
  }

  useEffect(() => {
    if (!walletConnectConnection) {
      const walletConnectPending = connectors.some(
        (connector) =>
          isWalletConnectConnector(connector) &&
          pendingAuthorizationUids.current.has(connector.uid),
      );
      if (walletConnectPending) return;
      clearWalletConnectLifecycleGuard();
      resetWalletConnectScope();
      return;
    }
    const walletConnectAuthorization = localAuthorizationByUid.current.get(
      walletConnectConnection.connector.uid,
    );
    if (
      (!walletConnectAuthorization?.authorized ||
        walletConnectAuthorization.connectorId !== 'walletconnect') &&
      !pendingAuthorizationUids.current.has(walletConnectConnection.connector.uid)
    ) {
      clearWalletConnectLifecycleGuard();
      blockWalletConnectScope();
      return;
    }
    if (
      !isEvmTestnetChainId(walletConnectConnection.chainId) ||
      walletConnectAddress === undefined
    ) {
      denyConnector(walletConnectConnection.connector);
      clearWalletConnectLifecycleGuard();
      blockWalletConnectScope();
      return;
    }
    if (currentWalletConnectIdentity === guardedWalletConnectIdentity) return;

    void guardWalletConnectSession(
      walletConnectConnection.connector,
      walletConnectConnection.chainId,
      walletConnectAddress,
    ).then((result) => {
      if (result !== 'blocked') return;
      denyConnector(walletConnectConnection.connector);
      setPairingDisplay(null);
      setConnectorFeedback(
        walletConnectConnection.connector,
        'WalletConnect account or chain scope changed and was blocked.',
      );
      void disconnect
        .disconnectAsync({ connector: walletConnectConnection.connector })
        .catch(() => undefined);
    });
  }, [
    currentWalletConnectIdentity,
    connectors,
    guardedWalletConnectIdentity,
    walletConnectAddress,
    walletConnectConnection,
  ]);

  async function connectSelected() {
    if (!selectedConnector || selectedConnection) return;
    const connectorId = connectorIdForEvidence(selectedConnector);
    const selectedConnectorIsWalletConnect = isWalletConnectConnector(selectedConnector);
    pendingAuthorizationUids.current.add(selectedConnector.uid);
    if (selectedConnectorIsWalletConnect) {
      clearWalletConnectLifecycleGuard();
      blockWalletConnectScope();
      pendWalletConnectScope();
      walletConnectRequestedChainId.current = targetNetwork.caipId;
    }
    setConnectorFeedback(selectedConnector, 'Waiting for wallet approval…');

    try {
      const result = await connect.connectAsync({
        connector: selectedConnector,
        chainId: targetChainId,
      });
      const selectedAccount = result.accounts.length === 1 ? result.accounts[0] : undefined;
      if (
        !isEvmTestnetChainId(result.chainId) ||
        result.chainId !== targetChainId ||
        selectedAccount === undefined
      ) {
        denyConnector(selectedConnector);
        await disconnect.disconnectAsync({ connector: selectedConnector }).catch(() => undefined);
        if (selectedConnectorIsWalletConnect) blockWalletConnectScope();
        setConnectorFeedback(
          selectedConnector,
          result.accounts.length !== 1
            ? 'Blocked: authorize exactly one test account instead of relying on account order.'
            : 'Blocked: the wallet did not return the selected testnet and account.',
        );
        onEvidence({
          connectorId,
          ...observedEvmChain(result.chainId),
          kind: 'connect',
          outcome: 'blocked',
          accountObserved: result.accounts.length > 0,
        });
        return;
      }

      if (selectedConnectorIsWalletConnect) {
        const guardResult = await guardWalletConnectSession(
          selectedConnector,
          result.chainId,
          selectedAccount,
        );
        if (guardResult !== 'accepted') {
          denyConnector(selectedConnector);
          blockWalletConnectScope();
          await disconnect.disconnectAsync({ connector: selectedConnector }).catch(() => undefined);
          setConnectorFeedback(
            selectedConnector,
            guardResult === 'stale'
              ? 'WalletConnect validation was superseded; signing remains gated.'
              : 'WalletConnect session scope was blocked and signing remains disabled.',
          );
          onEvidence({
            connectorId,
            ...observedEvmChain(result.chainId),
            kind: 'connect',
            outcome: 'blocked',
            accountObserved: true,
          });
          return;
        }
      }

      const fallback = {
        accounts: result.accounts,
        chainId: result.chainId,
        connector: selectedConnector,
      } as Connection;
      const latest = latestConnectionForConnector(selectedConnector, fallback);
      const latestAccount = onlyConnectionAccount(latest);
      if (
        !latest ||
        !isApprovedEvmConnector(latest.connector) ||
        connectorIdForEvidence(latest.connector) !== connectorId ||
        latestAccount?.toLowerCase() !== selectedAccount.toLowerCase() ||
        latest.chainId !== result.chainId ||
        !isEvmTestnetChainId(latest.chainId) ||
        (selectedConnectorIsWalletConnect &&
          (walletConnectScopeRef.current !== 'accepted' ||
            guardedWalletConnectIdentityRef.current !== authorizationIdentity(latest)))
      ) {
        denyConnector(selectedConnector);
        if (selectedConnectorIsWalletConnect) blockWalletConnectScope();
        await disconnect.disconnectAsync({ connector: selectedConnector }).catch(() => undefined);
        setConnectorFeedback(
          selectedConnector,
          'The wallet changed during validation; this connection was blocked.',
        );
        onEvidence({
          connectorId,
          ...observedEvmChain(latest?.chainId ?? result.chainId),
          kind: 'connect',
          outcome: 'blocked',
          accountObserved: Boolean(latestAccount),
        });
        return;
      }

      allowConnector(selectedConnector);
      setConnectorFeedback(
        selectedConnector,
        `Connected on ${networkForChainId(result.chainId).name}.`,
      );
      onEvidence({
        connectorId,
        ...observedEvmChain(result.chainId),
        kind: 'connect',
        outcome: 'accepted',
        accountObserved: true,
      });
    } catch (error) {
      denyConnector(selectedConnector);
      if (selectedConnectorIsWalletConnect) {
        blockWalletConnectScope();
      }
      const safe = sanitizeEvmWalletError(error);
      setConnectorFeedback(selectedConnector, safe.message);
      onEvidence({
        connectorId,
        chainId: targetNetwork.caipId,
        chainContext: 'requested',
        kind: safe.code === 'user-rejected' ? 'reject' : 'connect',
        outcome: safe.code === 'user-rejected' ? 'rejected' : 'blocked',
      });
    } finally {
      pendingAuthorizationUids.current.delete(selectedConnector.uid);
    }
  }

  async function restoreApprovedSessions() {
    if (connections.length > 0 || connectors.length === 0 || restoringRef.current) return;
    const restoringConnectors = [...connectors];
    restoringRef.current = true;
    setRestoring(true);
    for (const connector of restoringConnectors) {
      pendingAuthorizationUids.current.add(connector.uid);
      setConnectorFeedback(connector, 'Checking this approved wallet session…');
    }
    if (restoringConnectors.some(isWalletConnectConnector)) {
      clearWalletConnectLifecycleGuard();
      blockWalletConnectScope();
    }

    try {
      const restored = await reconnect.reconnectAsync({ connectors: restoringConnectors });
      const restoredUids = new Set<string>();

      for (const item of restored) {
        restoredUids.add(item.connector.uid);
        const connectorId = connectorIdForEvidence(item.connector);
        const requestedConnector = restoringConnectors.find(
          (connector) => connector.uid === item.connector.uid,
        );
        const account = item.accounts.length === 1 ? item.accounts[0] : undefined;
        if (
          !requestedConnector ||
          !isApprovedEvmConnector(item.connector) ||
          connectorIdForEvidence(requestedConnector) !== connectorId ||
          !isEvmTestnetChainId(item.chainId) ||
          account === undefined
        ) {
          denyConnector(item.connector);
          if (isWalletConnectConnector(item.connector)) blockWalletConnectScope();
          await disconnect.disconnectAsync({ connector: item.connector }).catch(() => undefined);
          setConnectorFeedback(item.connector, 'A stored session was blocked by the lab policy.');
          onEvidence({
            connectorId,
            ...observedEvmChain(item.chainId),
            kind: 'restore',
            outcome: 'blocked',
            accountObserved: item.accounts.length > 0,
          });
          continue;
        }

        setConnectorTarget(item.connector, item.chainId);
        if (isWalletConnectConnector(item.connector)) {
          const guardResult = await guardWalletConnectSession(
            item.connector,
            item.chainId,
            account,
          );
          if (guardResult !== 'accepted') {
            denyConnector(item.connector);
            blockWalletConnectScope();
            await disconnect.disconnectAsync({ connector: item.connector }).catch(() => undefined);
            setConnectorFeedback(item.connector, 'Stored WalletConnect scope was blocked.');
            onEvidence({
              connectorId,
              ...observedEvmChain(item.chainId),
              kind: 'restore',
              outcome: 'blocked',
              accountObserved: true,
            });
            continue;
          }
        }

        const latest = latestConnectionForConnector(item.connector, item);
        const latestAccount = onlyConnectionAccount(latest);
        const latestIdentity = authorizationIdentity(latest);
        if (
          !latest ||
          latest.connector.uid !== item.connector.uid ||
          !isApprovedEvmConnector(latest.connector) ||
          connectorIdForEvidence(latest.connector) !== connectorId ||
          latestAccount?.toLowerCase() !== account.toLowerCase() ||
          latest.chainId !== item.chainId ||
          !isEvmTestnetChainId(latest.chainId) ||
          (isWalletConnectConnector(item.connector) &&
            (walletConnectScopeRef.current !== 'accepted' ||
              guardedWalletConnectIdentityRef.current !== latestIdentity))
        ) {
          denyConnector(item.connector);
          if (isWalletConnectConnector(item.connector)) blockWalletConnectScope();
          await disconnect.disconnectAsync({ connector: item.connector }).catch(() => undefined);
          setConnectorFeedback(
            item.connector,
            'The stored session changed during validation and was blocked.',
          );
          onEvidence({
            connectorId,
            ...observedEvmChain(latest?.chainId ?? item.chainId),
            kind: 'restore',
            outcome: 'blocked',
            accountObserved: Boolean(latestAccount),
          });
          continue;
        }

        allowConnector(item.connector);
        setConnectorFeedback(item.connector, 'A previously authorized session was restored.');
        onEvidence({
          connectorId,
          ...observedEvmChain(item.chainId),
          kind: 'restore',
          outcome: 'accepted',
          accountObserved: true,
        });
      }

      for (const connector of restoringConnectors) {
        if (restoredUids.has(connector.uid)) continue;
        const requestedNetwork = networkForChainId(
          targetChainIds[connector.uid] ?? EVM_TESTNET_CHAIN_IDS.sepolia,
        );
        setConnectorFeedback(connector, 'No allowed stored session was restored.');
        onEvidence({
          connectorId: connectorIdForEvidence(connector),
          chainId: requestedNetwork.caipId,
          chainContext: 'requested',
          kind: 'restore',
          outcome: 'cleared',
        });
      }
    } catch (error) {
      const safe = sanitizeEvmWalletError(error);
      for (const connector of restoringConnectors) {
        denyConnector(connector);
        setConnectorFeedback(connector, safe.message);
        if (latestConnectionForConnector(connector)) {
          await disconnect.disconnectAsync({ connector }).catch(() => undefined);
        }
      }
      const connector = selectedConnector ?? restoringConnectors[0];
      if (connector) {
        onEvidence({
          connectorId: connectorIdForEvidence(connector),
          chainId: networkForChainId(targetChainIds[connector.uid] ?? EVM_TESTNET_CHAIN_IDS.sepolia)
            .caipId,
          chainContext: 'requested',
          kind: 'restore',
          outcome: 'blocked',
        });
      }
    } finally {
      for (const connector of restoringConnectors) {
        pendingAuthorizationUids.current.delete(connector.uid);
      }
      restoringRef.current = false;
      setRestoring(false);
    }
  }

  async function switchToTarget() {
    if (
      !selectedConnection ||
      selectedAddress === undefined ||
      selectedLocallyDenied ||
      (selectedIsWalletConnect && (!walletConnectScopeAccepted || !walletConnectCanSwitch))
    ) {
      return;
    }
    const connector = selectedConnection.connector;
    const connectorId = connectorIdForEvidence(connector);
    const authorization = localAuthorizationByUid.current.get(connector.uid);
    if (!authorization?.authorized || !isLocallyAuthorized(connector)) return;
    const pending: PendingSwitch = {
      account: selectedAddress.toLowerCase(),
      initialChainId: selectedConnection.chainId,
      initialRevision: authorization.revision,
      targetChainId,
    };
    pendingSwitches.current.set(connector.uid, pending);
    setConnectorFeedback(connector, `Waiting for ${targetNetwork.name} approval…`);
    try {
      await switchChain.switchChainAsync({ connector, chainId: targetChainId });
      const latest = latestConnectionForConnector(connector);
      const latestAccount = onlyConnectionAccount(latest);
      const currentAuthorization = localAuthorizationByUid.current.get(connector.uid);
      const revisionIsCurrent =
        currentAuthorization?.revision === pending.initialRevision ||
        (pending.observedRevision !== undefined &&
          currentAuthorization?.revision === pending.observedRevision);
      const walletConnectStillAccepted =
        !isWalletConnectConnector(connector) ||
        (walletConnectScopeRef.current === 'accepted' &&
          guardedWalletConnectIdentityRef.current === authorizationIdentity(latest));
      const latestConnectorMatches =
        latest !== undefined &&
        isApprovedEvmConnector(latest.connector) &&
        connectorIdForEvidence(latest.connector) === connectorId;
      if (
        !currentAuthorization?.authorized ||
        !isLocallyAuthorized(connector) ||
        !latestConnectorMatches ||
        !revisionIsCurrent ||
        latestAccount?.toLowerCase() !== pending.account ||
        (latest?.chainId !== pending.initialChainId && latest?.chainId !== pending.targetChainId) ||
        !walletConnectStillAccepted
      ) {
        setConnectorFeedback(
          connector,
          'The wallet changed while switching; the stale switch result was discarded.',
        );
        onEvidence({
          connectorId,
          ...observedEvmChain(latest?.chainId ?? pending.initialChainId),
          kind: 'chain-change',
          outcome: 'blocked',
          accountObserved: Boolean(latestAccount),
        });
        return;
      }
      setConnectorFeedback(
        connector,
        `Switch request approved; waiting to observe ${targetNetwork.name}.`,
      );
    } catch (error) {
      const safe = sanitizeEvmWalletError(error);
      setConnectorFeedback(connector, safe.message);
      onEvidence({
        connectorId,
        chainId: targetNetwork.caipId,
        chainContext: 'requested',
        kind: 'chain-change',
        outcome: safe.code === 'user-rejected' ? 'rejected' : 'blocked',
        accountObserved: true,
      });
    } finally {
      if (pendingSwitches.current.get(connector.uid) === pending) {
        pendingSwitches.current.delete(connector.uid);
      }
    }
  }

  async function signLocalProof() {
    if (!proofReady || !selectedConnection || !selectedAddress) return;
    const connector = selectedConnection.connector;
    const connectorId = connectorIdForEvidence(connector);
    const signingIdentity = `${connector.uid}:${selectedConnection.chainId}:${selectedAddress.toLowerCase()}`;
    const authorization = localAuthorizationByUid.current.get(connector.uid);
    if (!authorization?.authorized || !isLocallyAuthorized(connector)) return;
    const snapshot: AuthorizationSnapshot = {
      identity: signingIdentity,
      revision: authorization.revision,
    };
    const message = createEvmProofMessage(selectedAddress, targetChainId);
    setConnectorFeedback(connector, 'Waiting for a test-message signature…');

    const blockStaleProof = () => {
      const latest = latestConnectionForConnector(connector);
      const latestAddress = onlyConnectionAccount(latest);
      setConnectorFeedback(
        connector,
        'The wallet changed while signing; the stale proof was discarded.',
      );
      onEvidence({
        connectorId,
        ...observedEvmChain(latest?.chainId ?? selectedConnection.chainId),
        kind: 'ownership-proof',
        outcome: 'blocked',
        accountObserved: Boolean(latestAddress),
      });
    };

    try {
      const signature = await signMessage.signMessageAsync({
        account: selectedAddress,
        connector,
        message,
      });
      if (!isAuthorizationSnapshotCurrent(connector, snapshot)) {
        blockStaleProof();
        return;
      }

      const verified = await verifyMessage({
        address: selectedAddress,
        message,
        signature,
      });
      if (!isAuthorizationSnapshotCurrent(connector, snapshot)) {
        blockStaleProof();
        return;
      }
      setConnectorFeedback(
        connector,
        verified
          ? 'Ownership proof verified locally; no login session was created.'
          : 'The returned signature did not verify.',
      );
      onEvidence({
        connectorId,
        chainId: targetNetwork.caipId,
        chainContext: 'observed',
        kind: 'ownership-proof',
        outcome: verified ? 'accepted' : 'blocked',
        accountObserved: true,
      });
    } catch (error) {
      if (!isAuthorizationSnapshotCurrent(connector, snapshot)) {
        blockStaleProof();
        return;
      }
      const safe = sanitizeEvmWalletError(error);
      setConnectorFeedback(connector, safe.message);
      onEvidence({
        connectorId,
        chainId: targetNetwork.caipId,
        chainContext: 'observed',
        kind: safe.code === 'user-rejected' ? 'reject' : 'ownership-proof',
        outcome: safe.code === 'user-rejected' ? 'rejected' : 'blocked',
        accountObserved: true,
      });
    }
  }

  async function disconnectSelected() {
    if (!selectedConnection) return;
    const connector = selectedConnection.connector;
    const connectorId = connectorIdForEvidence(connector);
    explicitDisconnectUids.current.add(connector.uid);
    denyConnector(connector);
    if (isWalletConnectConnector(connector)) {
      clearWalletConnectLifecycleGuard();
      blockWalletConnectScope();
    }
    try {
      await disconnect.disconnectAsync({ connector });
      if (isWalletConnectConnector(connector)) setPairingDisplay(null);
      setConnectorFeedback(
        connector,
        'Disconnected. Vendor pairing state may remain; clear this dedicated browser profile after testing.',
      );
      onEvidence({
        connectorId,
        ...observedEvmChain(selectedConnection.chainId),
        kind: 'disconnect',
        outcome: 'cleared',
      });
    } catch (error) {
      explicitDisconnectUids.current.delete(connector.uid);
      setConnectorFeedback(connector, sanitizeEvmWalletError(error).message);
      onEvidence({
        connectorId,
        ...observedEvmChain(selectedConnection.chainId),
        kind: 'disconnect',
        outcome: 'blocked',
        accountObserved: Boolean(selectedAddress),
      });
    }
  }

  return (
    <section className="lab-card" aria-labelledby="evm-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Real extension / QR sessions</p>
          <h2 id="evm-title">Concurrent EVM testnet wallets</h2>
        </div>
        <span className={selectedConnection && selectedChainAllowed ? 'state-ok' : 'state-blocked'}>
          {selectedConnection ? 'connected' : 'disconnected'}
        </span>
      </div>

      <label>
        Wallet connector
        <select
          value={selectedConnectorUid}
          onChange={(event) => setSelectedConnectorUid(event.target.value)}
          disabled={busy}
        >
          {connectors.map((connector) => (
            <option key={connector.uid} value={connector.uid}>
              {safeConnectorName(connector)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Required testnet for selected wallet
        <select
          value={targetChainId}
          onChange={(event) => {
            if (!selectedConnector) return;
            setConnectorTarget(selectedConnector, Number(event.target.value) as EvmTestnetChainId);
          }}
          disabled={!selectedConnector || busy}
        >
          {EVM_NETWORKS.map((network) => (
            <option key={network.chainId} value={network.chainId}>
              {network.name}
            </option>
          ))}
        </select>
      </label>

      <div aria-label="Active EVM sessions">
        <p>
          Active locally authorized sessions: <strong>{authorizedConnections.length}</strong>
        </p>
        {authorizedConnections.length > 0 ? (
          <div className="button-row">
            {authorizedConnections.map((active) => {
              const account = onlyConnectionAccount(active);
              return (
                <button
                  key={active.connector.uid}
                  type="button"
                  aria-pressed={active.connector.uid === selectedConnectorUid}
                  onClick={() => setSelectedConnectorUid(active.connector.uid)}
                  disabled={busy}
                >
                  Use {safeConnectorName(active.connector)} [
                  {applicationConnectionId(active.connector)}] (
                  {account ? shortenWalletAddress(account) : 'blocked'} / {active.chainId})
                </button>
              );
            })}
          </div>
        ) : (
          <p className="boundary-note">No EVM wallet session is active.</p>
        )}
      </div>

      <dl className="connection-facts">
        <div>
          <dt>Selected connection ID</dt>
          <dd>
            {selectedConnection ? applicationConnectionId(selectedConnection.connector) : 'None'}
          </dd>
        </div>
        <div>
          <dt>Selected account</dt>
          <dd>{selectedAddress ? shortenWalletAddress(selectedAddress) : 'None'}</dd>
        </div>
        <div>
          <dt>Selected chain</dt>
          <dd>{selectedConnection?.chainId ?? 'None'}</dd>
        </div>
      </dl>

      {selectedConnection && selectedConnection.accounts.length !== 1 ? (
        <p className="danger-note" role="alert">
          This session does not expose exactly one account and is being quarantined.
        </p>
      ) : null}
      {selectedLocallyDenied && selectedConnection?.accounts.length === 1 ? (
        <p className="danger-note" role="alert">
          Local authorization for this wallet is revoked. Reconnect it explicitly before signing.
        </p>
      ) : null}
      {!selectedChainAllowed && selectedConnection ? (
        <p className="danger-note" role="alert">
          Unsupported chain detected for the selected wallet. Its signing stays disabled until it
          switches to the selected testnet; other wallet sessions remain isolated.
        </p>
      ) : null}
      {connections.length > 0 ? (
        <p className="boundary-note">
          Stored-session restore is disabled while any wallet is active because Wagmi rebuilds the
          connection registry during restore.
        </p>
      ) : null}
      {!runtime.connectorAvailability.walletConnect.enabled ? (
        <p className="boundary-note">
          WalletConnect is inactive: {runtime.connectorAvailability.walletConnect.reason}. Its
          current Reown terms and a local project ID must both be explicitly enabled.
        </p>
      ) : null}
      {policyFeedback ? (
        <p className="danger-note" role="alert">
          {policyFeedback}
        </p>
      ) : null}

      <div className="button-row">
        <button
          type="button"
          onClick={connectSelected}
          disabled={!selectedConnector || Boolean(selectedConnection) || busy}
        >
          Connect selected
        </button>
        <button
          type="button"
          onClick={restoreApprovedSessions}
          disabled={connectors.length === 0 || connections.length > 0 || busy}
        >
          Restore approved sessions
        </button>
        <button
          type="button"
          onClick={switchToTarget}
          disabled={
            !selectedConnection ||
            selectedAddress === undefined ||
            selectedLocallyDenied ||
            busy ||
            (selectedIsWalletConnect && (!walletConnectScopeAccepted || !walletConnectCanSwitch))
          }
        >
          Switch selected testnet
        </button>
        <button type="button" onClick={signLocalProof} disabled={!proofReady || busy}>
          Sign selected proof
        </button>
        <button type="button" onClick={disconnectSelected} disabled={!selectedConnection || busy}>
          Disconnect selected
        </button>
      </div>

      {pairingDisplay ? (
        <div className="qr-panel" role="status" aria-label="WalletConnect pairing QR code">
          <QRCodeSVG value={pairingDisplay.uri} size={196} level="M" marginSize={2} />
          <p>
            Scan only with a disposable test wallet. The pairing URI is never logged or exported.
          </p>
        </div>
      ) : null}

      <p className="feedback" role="status">
        {selectedFeedback}
      </p>
    </section>
  );
}
