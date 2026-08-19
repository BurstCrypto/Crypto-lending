import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { verifyMessage } from 'viem';
import {
  useConnect,
  useConnection,
  useDisconnect,
  useReconnect,
  useSignMessage,
  useSwitchChain,
  type Connector,
} from 'wagmi';

import {
  EVM_TESTNET_CHAIN_IDS,
  inspectWalletConnectSession,
  isEvmOwnershipProofReady,
  isWalletConnectConnector,
  isEvmTestnetChainId,
  subscribeWalletConnectSessionUpdates,
  type WalletConnectScopeStatus,
  type EvmRuntime,
  type EvmTestnetChainId,
} from './evm';
import {
  createLabEvidenceEvent,
  exportLabEvidence,
  type LabChainId,
  type LabChainContext,
  type LabConnectorId,
  type LabEventKind,
  type LabEventOutcome,
  type LabEvidenceEvent,
} from './evidence';
import { sanitizeEvmWalletError, shortenWalletAddress } from './presentation';
import {
  createPhantomSolanaAdapterLifecycle,
  SOLANA_DEVNET_CHAIN,
  SOLANA_WALLET_LAB_DOMAIN,
  SOLANA_WALLET_LAB_ORIGIN,
  verifySolanaOwnership,
  type PhantomSolanaAdapter,
  type PhantomSolanaAdapterState,
} from './solana';

interface EvidenceInput {
  connectorId: LabConnectorId;
  chainId: LabChainId;
  chainContext: LabChainContext;
  kind: LabEventKind;
  outcome: LabEventOutcome;
  accountObserved?: boolean;
}

interface LabPanelProps {
  onEvidence(input: EvidenceInput): void;
}

interface EvmPanelProps extends LabPanelProps {
  runtime: EvmRuntime;
}

type WalletConnectGuardResult = 'accepted' | 'blocked' | 'stale';

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
  if (!connector) return 'injected';
  if (isWalletConnectConnector(connector)) return 'walletconnect';
  if (connector.id === 'coinbaseWalletSDK' && connector.type === 'coinbaseWallet') {
    return 'coinbase';
  }
  // EIP-6963 metadata is self-reported and remains corroboration-only, but an
  // exact pair avoids attributing arbitrary names containing "MetaMask".
  if (connector.id === 'io.metamask' && connector.type === 'injected') return 'metamask';
  return 'injected';
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

export function EvmPanel({ runtime, onEvidence }: EvmPanelProps) {
  const connection = useConnection();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const reconnect = useReconnect();
  const signMessage = useSignMessage();
  const switchChain = useSwitchChain();
  const [targetChainId, setTargetChainId] = useState<EvmTestnetChainId>(
    EVM_TESTNET_CHAIN_IDS.sepolia,
  );
  const [selectedConnectorUid, setSelectedConnectorUid] = useState('');
  const [feedback, setFeedback] = useState('Choose an explicit wallet and testnet.');
  const [displayUri, setDisplayUri] = useState<string | null>(null);
  const [walletConnectScope, setWalletConnectScope] =
    useState<WalletConnectScopeStatus>('not-applicable');
  const [walletConnectCanSwitch, setWalletConnectCanSwitch] = useState(false);
  const [guardedWalletConnectIdentity, setGuardedWalletConnectIdentity] = useState<string | null>(
    null,
  );
  const walletConnectUpdateUnsubscribe = useRef<(() => void) | null>(null);
  const walletConnectGuardGeneration = useRef(0);
  const walletConnectGuardInFlight = useRef<{
    identity: string;
    promise: Promise<WalletConnectGuardResult>;
  } | null>(null);
  const targetNetwork = networkForChainId(targetChainId);
  const connectors = connect.connectors;
  const selectedConnector = connectors.find(({ uid }) => uid === selectedConnectorUid);
  const observed = useRef<{
    address: string | undefined;
    chainId: number | undefined;
    initialized: boolean;
  }>({ address: undefined, chainId: undefined, initialized: false });

  useEffect(() => {
    if (selectedConnector && connectors.some(({ uid }) => uid === selectedConnector.uid)) return;
    setSelectedConnectorUid(connectors[0]?.uid ?? '');
  }, [connectors, selectedConnector]);

  useEffect(() => {
    const subscription = runtime.subscribeWalletConnectDisplayUri((uri) => setDisplayUri(uri));
    if (!subscription.available) return;
    return subscription.unsubscribe;
  }, [runtime]);

  useEffect(() => {
    if (!displayUri) return;
    const timeout = window.setTimeout(() => setDisplayUri(null), 5 * 60_000);
    return () => window.clearTimeout(timeout);
  }, [displayUri]);

  useEffect(
    () => () => {
      walletConnectGuardGeneration.current += 1;
      walletConnectGuardInFlight.current = null;
      const unsubscribe = walletConnectUpdateUnsubscribe.current;
      walletConnectUpdateUnsubscribe.current = null;
      try {
        unsubscribe?.();
      } catch {
        // The component is already invalidated and unmounting.
      }
    },
    [],
  );

  useEffect(() => {
    const previous = observed.current;
    if (!previous.initialized) {
      observed.current = {
        address: connection.address,
        chainId: connection.chainId,
        initialized: true,
      };
      return;
    }

    const connectorId = connectorIdForEvidence(connection.connector);
    if (previous.address !== connection.address) {
      onEvidence({
        connectorId,
        ...observedEvmChain(connection.chainId),
        kind: 'account-change',
        outcome: connection.address ? 'accepted' : 'cleared',
        accountObserved: Boolean(connection.address),
      });
    }
    if (previous.chainId !== connection.chainId && connection.chainId !== undefined) {
      onEvidence({
        connectorId,
        ...observedEvmChain(connection.chainId),
        kind: 'chain-change',
        outcome: isEvmTestnetChainId(connection.chainId) ? 'accepted' : 'blocked',
        accountObserved: Boolean(connection.address),
      });
    }
    observed.current = {
      address: connection.address,
      chainId: connection.chainId,
      initialized: true,
    };
  }, [connection.address, connection.chainId, connection.connector, onEvidence]);

  const busy =
    connect.isPending ||
    disconnect.isPending ||
    reconnect.isPending ||
    signMessage.isPending ||
    switchChain.isPending;
  const currentChainAllowed = isEvmTestnetChainId(connection.chainId);
  const currentWalletConnectIdentity =
    isWalletConnectConnector(connection.connector) &&
    currentChainAllowed &&
    connection.address !== undefined
      ? `${connection.connector.uid}:${connection.chainId}:${connection.address.toLowerCase()}`
      : null;
  const walletConnectScopeAccepted =
    !isWalletConnectConnector(connection.connector) ||
    (walletConnectScope === 'accepted' &&
      guardedWalletConnectIdentity === currentWalletConnectIdentity);
  const proofReady = isEvmOwnershipProofReady({
    connected: connection.isConnected,
    currentChainId: connection.chainId,
    targetChainId,
    walletConnect: isWalletConnectConnector(connection.connector),
    walletConnectScope,
    currentWalletConnectIdentity,
    guardedWalletConnectIdentity,
  });

  function clearWalletConnectUpdateGuard() {
    walletConnectGuardGeneration.current += 1;
    walletConnectGuardInFlight.current = null;
    const unsubscribe = walletConnectUpdateUnsubscribe.current;
    walletConnectUpdateUnsubscribe.current = null;
    try {
      unsubscribe?.();
    } catch {
      // A hostile or corrupted provider cannot keep the signing gate accepted
      // by throwing while its obsolete listener is removed.
    }
  }

  function blockWalletConnectScope() {
    setWalletConnectScope('blocked');
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

    clearWalletConnectUpdateGuard();
    const generation = walletConnectGuardGeneration.current;
    setWalletConnectScope('pending');
    setWalletConnectCanSwitch(false);
    setGuardedWalletConnectIdentity(null);

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
        const updated = inspectWalletConnectSession(provider, { chainId, address });
        if (!updated.accepted) {
          clearWalletConnectUpdateGuard();
          blockWalletConnectScope();
          setFeedback(`WalletConnect session update blocked: ${updated.reason}.`);
          onEvidence({
            connectorId: 'walletconnect',
            ...observedEvmChain(chainId),
            kind: 'session-update',
            outcome: 'blocked',
            accountObserved: true,
          });
          void disconnect.disconnectAsync({ connector }).catch(() => undefined);
          return;
        }
        setWalletConnectScope('accepted');
        setWalletConnectCanSwitch(updated.canSwitchChain);
        setGuardedWalletConnectIdentity(identity);
        onEvidence({
          connectorId: 'walletconnect',
          ...observedEvmChain(chainId),
          kind: 'session-update',
          outcome: 'accepted',
          accountObserved: true,
        });
      };

      // Subscribe before inspecting so a scope expansion cannot land between
      // the initial validation and listener installation.
      const unsubscribe = subscribeWalletConnectSessionUpdates(provider, handleSessionUpdate);
      if (!unsubscribe) {
        if (generation !== walletConnectGuardGeneration.current) return 'stale';
        blockWalletConnectScope();
        return 'blocked';
      }
      if (generation !== walletConnectGuardGeneration.current) {
        unsubscribe();
        return 'stale';
      }
      walletConnectUpdateUnsubscribe.current = unsubscribe;

      const inspection = inspectWalletConnectSession(provider, { chainId, address });
      if (generation !== walletConnectGuardGeneration.current) {
        unsubscribe();
        return 'stale';
      }
      if (!inspection.accepted) {
        clearWalletConnectUpdateGuard();
        blockWalletConnectScope();
        return 'blocked';
      }

      setWalletConnectScope('accepted');
      setWalletConnectCanSwitch(inspection.canSwitchChain);
      setGuardedWalletConnectIdentity(identity);
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
    const activeConnector = connection.connector;
    const activeChainId = connection.chainId;
    const activeAddress = connection.address;
    if (!isWalletConnectConnector(activeConnector)) {
      clearWalletConnectUpdateGuard();
      setWalletConnectScope('not-applicable');
      setWalletConnectCanSwitch(false);
      setGuardedWalletConnectIdentity(null);
      return;
    }
    if (
      !isEvmTestnetChainId(activeChainId) ||
      activeAddress === undefined ||
      currentWalletConnectIdentity === guardedWalletConnectIdentity
    ) {
      return;
    }
    void guardWalletConnectSession(activeConnector, activeChainId, activeAddress).then((result) => {
      if (result !== 'blocked') return;
      setFeedback('WalletConnect account or chain scope changed and was blocked.');
      void disconnect.disconnectAsync({ connector: activeConnector }).catch(() => undefined);
    });
  }, [
    connection.address,
    connection.chainId,
    connection.connector,
    currentChainAllowed,
    currentWalletConnectIdentity,
    guardedWalletConnectIdentity,
  ]);

  async function connectSelected() {
    if (!selectedConnector) return;
    const connectorId = connectorIdForEvidence(selectedConnector);
    const selectedIsWalletConnect = isWalletConnectConnector(selectedConnector);
    clearWalletConnectUpdateGuard();
    if (selectedIsWalletConnect) {
      blockWalletConnectScope();
      setWalletConnectScope('pending');
    } else {
      setWalletConnectScope('not-applicable');
      setWalletConnectCanSwitch(false);
      setGuardedWalletConnectIdentity(null);
    }
    setFeedback('Waiting for wallet approval…');
    try {
      const result = await connect.connectAsync({
        connector: selectedConnector,
        chainId: targetChainId,
      });
      if (!isEvmTestnetChainId(result.chainId)) {
        await disconnect.disconnectAsync({ connector: selectedConnector });
        setFeedback('Blocked: the wallet returned a chain outside the testnet allowlist.');
        onEvidence({
          connectorId,
          ...observedEvmChain(result.chainId),
          kind: 'connect',
          outcome: 'blocked',
        });
        return;
      }
      if (result.chainId !== targetChainId || result.accounts[0] === undefined) {
        await disconnect.disconnectAsync({ connector: selectedConnector });
        setFeedback('Blocked: the wallet did not return the selected testnet and account.');
        onEvidence({
          connectorId,
          ...observedEvmChain(result.chainId),
          kind: 'connect',
          outcome: 'blocked',
        });
        return;
      }
      if (selectedIsWalletConnect) {
        const guardResult = await guardWalletConnectSession(
          selectedConnector,
          targetChainId,
          result.accounts[0],
        );
        if (guardResult === 'stale') {
          setFeedback('WalletConnect validation was superseded; signing remains gated.');
          return;
        }
        if (guardResult === 'blocked') {
          blockWalletConnectScope();
          await disconnect.disconnectAsync({ connector: selectedConnector }).catch(() => undefined);
          setFeedback('WalletConnect session scope was blocked and signing remains disabled.');
          onEvidence({
            connectorId,
            ...observedEvmChain(result.chainId),
            kind: 'connect',
            outcome: 'blocked',
          });
          return;
        }
      }
      setDisplayUri(null);
      setFeedback(`Connected on ${networkForChainId(result.chainId).name}.`);
      onEvidence({
        connectorId,
        ...observedEvmChain(result.chainId),
        kind: 'connect',
        outcome: 'accepted',
        accountObserved: result.accounts.length > 0,
      });
    } catch (error) {
      if (selectedIsWalletConnect) blockWalletConnectScope();
      const safe = sanitizeEvmWalletError(error);
      setDisplayUri(null);
      setFeedback(safe.message);
      onEvidence({
        connectorId,
        chainId: targetNetwork.caipId,
        chainContext: 'requested',
        kind: safe.code === 'user-rejected' ? 'reject' : 'connect',
        outcome: safe.code === 'user-rejected' ? 'rejected' : 'blocked',
      });
    }
  }

  async function restoreSelected() {
    if (!selectedConnector) return;
    const connectorId = connectorIdForEvidence(selectedConnector);
    const selectedIsWalletConnect = isWalletConnectConnector(selectedConnector);
    clearWalletConnectUpdateGuard();
    if (selectedIsWalletConnect) {
      blockWalletConnectScope();
      setWalletConnectScope('pending');
    } else {
      setWalletConnectScope('not-applicable');
    }
    setFeedback('Checking the selected wallet session…');
    try {
      const restored = await reconnect.reconnectAsync({ connectors: [selectedConnector] });
      const invalid = restored.filter(({ chainId }) => !isEvmTestnetChainId(chainId));
      for (const item of invalid) {
        await disconnect.disconnectAsync({ connector: item.connector });
      }
      let accepted = restored.find(
        ({ chainId, accounts }) => isEvmTestnetChainId(chainId) && accounts[0] !== undefined,
      );
      if (accepted && selectedIsWalletConnect) {
        const guardResult = await guardWalletConnectSession(
          accepted.connector,
          accepted.chainId as EvmTestnetChainId,
          accepted.accounts[0] as string,
        );
        if (guardResult !== 'accepted') {
          if (guardResult === 'blocked') {
            blockWalletConnectScope();
            await disconnect
              .disconnectAsync({ connector: accepted.connector })
              .catch(() => undefined);
          }
          accepted = undefined;
        }
      }
      setFeedback(
        accepted
          ? 'A previously authorized testnet session was restored.'
          : 'No allowed session was restored.',
      );
      onEvidence({
        connectorId,
        ...(accepted
          ? observedEvmChain(accepted.chainId)
          : { chainId: targetNetwork.caipId, chainContext: 'requested' as const }),
        kind: 'restore',
        outcome: accepted ? 'accepted' : 'blocked',
        accountObserved: Boolean(accepted?.accounts.length),
      });
    } catch (error) {
      if (selectedIsWalletConnect) blockWalletConnectScope();
      setFeedback(sanitizeEvmWalletError(error).message);
      onEvidence({
        connectorId,
        chainId: targetNetwork.caipId,
        chainContext: 'requested',
        kind: 'restore',
        outcome: 'blocked',
      });
    }
  }

  async function switchToTarget() {
    if (
      !connection.isConnected ||
      (isWalletConnectConnector(connection.connector) &&
        (!walletConnectScopeAccepted || !walletConnectCanSwitch))
    ) {
      return;
    }
    const connectorId = connectorIdForEvidence(connection.connector);
    setFeedback(`Waiting for ${targetNetwork.name} approval…`);
    try {
      await switchChain.switchChainAsync({ chainId: targetChainId });
      setFeedback(`Wallet switched to ${targetNetwork.name}.`);
      onEvidence({
        connectorId,
        chainId: targetNetwork.caipId,
        chainContext: 'observed',
        kind: 'chain-change',
        outcome: 'accepted',
        accountObserved: true,
      });
    } catch (error) {
      setFeedback(sanitizeEvmWalletError(error).message);
      onEvidence({
        connectorId,
        chainId: targetNetwork.caipId,
        chainContext: 'requested',
        kind: 'chain-change',
        outcome: 'rejected',
        accountObserved: true,
      });
    }
  }

  async function signLocalProof() {
    if (!proofReady || !connection.address) return;
    const connectorId = connectorIdForEvidence(connection.connector);
    const message = createEvmProofMessage(connection.address, targetChainId);
    setFeedback('Waiting for a test-message signature…');
    try {
      const signature = await signMessage.signMessageAsync({
        account: connection.address,
        message,
      });
      const verified = await verifyMessage({
        address: connection.address,
        message,
        signature,
      });
      setFeedback(
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
      const safe = sanitizeEvmWalletError(error);
      setFeedback(safe.message);
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

  async function disconnectCurrent() {
    if (!connection.connector) return;
    const connectorId = connectorIdForEvidence(connection.connector);
    clearWalletConnectUpdateGuard();
    if (isWalletConnectConnector(connection.connector)) blockWalletConnectScope();
    await disconnect.disconnectAsync({ connector: connection.connector });
    setDisplayUri(null);
    setFeedback(
      'Disconnected. Vendor pairing state may remain; clear this dedicated browser profile after testing.',
    );
    onEvidence({
      connectorId,
      ...observedEvmChain(connection.chainId),
      kind: 'disconnect',
      outcome: 'cleared',
    });
  }

  return (
    <section className="lab-card" aria-labelledby="evm-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Real extension / QR session</p>
          <h2 id="evm-title">EVM testnet wallets</h2>
        </div>
        <span className={currentChainAllowed ? 'state-ok' : 'state-blocked'}>
          {connection.status}
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
        Required testnet
        <select
          value={targetChainId}
          onChange={(event) => setTargetChainId(Number(event.target.value) as EvmTestnetChainId)}
          disabled={busy}
        >
          {EVM_NETWORKS.map((network) => (
            <option key={network.chainId} value={network.chainId}>
              {network.name}
            </option>
          ))}
        </select>
      </label>

      <dl className="connection-facts">
        <div>
          <dt>Observed account</dt>
          <dd>{connection.address ? shortenWalletAddress(connection.address) : 'None'}</dd>
        </div>
        <div>
          <dt>Observed chain</dt>
          <dd>{connection.chainId ?? 'None'}</dd>
        </div>
      </dl>

      {!currentChainAllowed && connection.chainId !== undefined ? (
        <p className="danger-note" role="alert">
          Unsupported chain detected. Signing stays disabled until the wallet switches to the
          selected testnet.
        </p>
      ) : null}

      {!runtime.connectorAvailability.walletConnect.enabled ? (
        <p className="boundary-note">
          WalletConnect is inactive: {runtime.connectorAvailability.walletConnect.reason}. Its
          current Reown terms and a local project ID must both be explicitly enabled.
        </p>
      ) : null}

      <div className="button-row">
        <button type="button" onClick={connectSelected} disabled={!selectedConnector || busy}>
          Connect
        </button>
        <button type="button" onClick={restoreSelected} disabled={!selectedConnector || busy}>
          Restore selected
        </button>
        <button
          type="button"
          onClick={switchToTarget}
          disabled={
            !connection.isConnected ||
            busy ||
            (isWalletConnectConnector(connection.connector) &&
              (!walletConnectScopeAccepted || !walletConnectCanSwitch))
          }
        >
          Switch testnet
        </button>
        <button type="button" onClick={signLocalProof} disabled={!proofReady || busy}>
          Sign and verify proof
        </button>
        <button type="button" onClick={disconnectCurrent} disabled={!connection.connector || busy}>
          Disconnect
        </button>
      </div>

      {displayUri ? (
        <div className="qr-panel" role="status" aria-label="WalletConnect pairing QR code">
          <QRCodeSVG value={displayUri} size={196} level="M" marginSize={2} />
          <p>
            Scan only with a disposable test wallet. The pairing URI is never logged or exported.
          </p>
        </div>
      ) : null}

      <p className="feedback" role="status">
        {feedback}
      </p>
    </section>
  );
}

function createSolanaProofInput(address: string) {
  const issuedAt = new Date();
  return {
    domain: SOLANA_WALLET_LAB_DOMAIN,
    address,
    statement:
      'Prove control of this disposable devnet wallet. No transaction or login is authorized.',
    uri: SOLANA_WALLET_LAB_ORIGIN,
    version: '1' as const,
    chainId: SOLANA_DEVNET_CHAIN,
    nonce: crypto.randomUUID().replaceAll('-', ''),
    issuedAt: issuedAt.toISOString(),
    expirationTime: new Date(issuedAt.getTime() + 5 * 60_000).toISOString(),
    requestId: crypto.randomUUID(),
  };
}

export function PhantomPanel({ onEvidence }: LabPanelProps) {
  const lifecycle = useMemo(() => createPhantomSolanaAdapterLifecycle(), []);
  const [adapter, setAdapter] = useState<PhantomSolanaAdapter | null>(null);
  const [state, setState] = useState<PhantomSolanaAdapterState>({
    status: 'disconnected',
    chain: SOLANA_DEVNET_CHAIN,
    wallets: [],
    connection: null,
    error: null,
  });
  const [selectedWalletId, setSelectedWalletId] = useState('');
  const [feedback, setFeedback] = useState('Install Phantom and select its Solana devnet account.');
  const previousAddress = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const lease = lifecycle.acquire();
    const activeAdapter = lease.adapter;
    setAdapter(activeAdapter);
    setState(activeAdapter.getState());
    const unsubscribe = activeAdapter.subscribe(setState);
    activeAdapter.discover();
    return () => {
      unsubscribe();
      lease.release();
    };
  }, [lifecycle]);

  useEffect(() => {
    if (!adapter) return;
    setState(adapter.getState());
  }, [adapter]);

  useEffect(() => {
    if (state.wallets.some(({ id }) => id === selectedWalletId)) return;
    setSelectedWalletId(state.wallets[0]?.id ?? '');
  }, [selectedWalletId, state.wallets]);

  useEffect(() => {
    const current = state.connection?.address ?? null;
    if (previousAddress.current === undefined) {
      previousAddress.current = current;
      return;
    }
    if (previousAddress.current !== current) {
      onEvidence({
        connectorId: 'phantom',
        chainId: 'solana:devnet',
        chainContext: 'observed',
        kind: 'account-change',
        outcome: current ? 'accepted' : 'cleared',
        accountObserved: Boolean(current),
      });
    }
    previousAddress.current = current;
  }, [onEvidence, state.connection?.address]);

  const busy = ['connecting', 'disconnecting', 'signing'].includes(state.status);

  async function connectPhantom() {
    if (!adapter || !selectedWalletId) return;
    setFeedback('Waiting for Phantom approval…');
    try {
      const connection = await adapter.connect(selectedWalletId);
      setFeedback('Phantom connected to a Solana devnet account.');
      onEvidence({
        connectorId: 'phantom',
        chainId: 'solana:devnet',
        chainContext: 'observed',
        kind: 'connect',
        outcome: 'accepted',
        accountObserved: Boolean(connection.address),
      });
    } catch {
      const safe = adapter.getState().error;
      setFeedback(safe?.message ?? 'Phantom could not complete the request.');
      onEvidence({
        connectorId: 'phantom',
        chainId: 'solana:devnet',
        chainContext: 'requested',
        kind: safe?.code === 'user_rejected' ? 'reject' : 'connect',
        outcome: safe?.code === 'user_rejected' ? 'rejected' : 'blocked',
      });
    }
  }

  async function signSolanaProof() {
    const connection = state.connection;
    if (!adapter || !connection) return;
    setFeedback('Waiting for a devnet ownership signature…');
    try {
      let verification;
      if (adapter.getOwnershipCapability() === 'solana:signIn') {
        const input = createSolanaProofInput(connection.address);
        const result = await adapter.signIn(input);
        verification = await verifySolanaOwnership({
          method: 'solana:signIn',
          expectedOrigin: SOLANA_WALLET_LAB_ORIGIN,
          input,
          result,
        });
      } else {
        const message = new TextEncoder().encode(
          `Crypto Lending restricted wallet lab\nOrigin: ${SOLANA_WALLET_LAB_ORIGIN}\nAddress: ${connection.address}\nChain: solana:devnet\nNonce: ${crypto.randomUUID()}\nNo transaction or production login is authorized.`,
        );
        const result = await adapter.signMessage(message);
        verification = await verifySolanaOwnership({
          method: 'solana:signMessage',
          expectedAddress: connection.address,
          expectedMessage: message,
          result,
        });
      }
      if (verification.status !== 'locally-verified') {
        setFeedback(`Local ownership verification blocked: ${verification.reason}.`);
        onEvidence({
          connectorId: 'phantom',
          chainId: 'solana:devnet',
          chainContext: 'observed',
          kind: 'ownership-proof',
          outcome: 'blocked',
          accountObserved: true,
        });
        return;
      }
      setFeedback(
        'Phantom ownership proof verified locally. Server authentication was not created.',
      );
      onEvidence({
        connectorId: 'phantom',
        chainId: 'solana:devnet',
        chainContext: 'observed',
        kind: 'ownership-proof',
        outcome: 'accepted',
        accountObserved: true,
      });
    } catch {
      const safe = adapter.getState().error;
      setFeedback(safe?.message ?? 'Phantom could not complete the signing request.');
      onEvidence({
        connectorId: 'phantom',
        chainId: 'solana:devnet',
        chainContext: 'requested',
        kind: safe?.code === 'user_rejected' ? 'reject' : 'ownership-proof',
        outcome: safe?.code === 'user_rejected' ? 'rejected' : 'blocked',
        accountObserved: true,
      });
    }
  }

  async function disconnectPhantom() {
    if (!adapter) return;
    await adapter.disconnect();
    setFeedback('The Phantom connection was cleared from this page.');
    onEvidence({
      connectorId: 'phantom',
      chainId: 'solana:devnet',
      chainContext: 'observed',
      kind: 'disconnect',
      outcome: 'cleared',
    });
  }

  return (
    <section className="lab-card" aria-labelledby="solana-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Wallet Standard extension</p>
          <h2 id="solana-title">Phantom on Solana devnet</h2>
        </div>
        <span className={state.connection ? 'state-ok' : 'state-neutral'}>{state.status}</span>
      </div>

      <label>
        Discovered Phantom wallet
        <select
          value={selectedWalletId}
          onChange={(event) => setSelectedWalletId(event.target.value)}
          disabled={busy}
        >
          {state.wallets.length === 0 ? (
            <option value="">No compatible Phantom wallet found</option>
          ) : null}
          {state.wallets.map((wallet) => (
            <option key={wallet.id} value={wallet.id}>
              {wallet.name}
            </option>
          ))}
        </select>
      </label>

      <dl className="connection-facts">
        <div>
          <dt>Observed account</dt>
          <dd>{state.connection ? shortenWalletAddress(state.connection.address) : 'None'}</dd>
        </div>
        <div>
          <dt>Ownership capability</dt>
          <dd>{state.connection?.capabilities.ownership ?? 'Not available'}</dd>
        </div>
      </dl>

      <div className="button-row">
        <button type="button" onClick={() => adapter?.discover()} disabled={!adapter || busy}>
          Refresh discovery
        </button>
        <button
          type="button"
          onClick={connectPhantom}
          disabled={!adapter || !selectedWalletId || busy || Boolean(state.connection)}
        >
          Connect
        </button>
        <button
          type="button"
          onClick={signSolanaProof}
          disabled={!adapter || !state.connection?.capabilities.ownership || busy}
        >
          Sign proof
        </button>
        <button
          type="button"
          onClick={disconnectPhantom}
          disabled={!adapter || !state.connection || busy}
        >
          Disconnect
        </button>
      </div>

      <p className="feedback" role="status">
        {feedback}
      </p>
    </section>
  );
}

function EvidencePanel({ events }: { events: readonly LabEvidenceEvent[] }) {
  function downloadEvidence() {
    const blob = new Blob([exportLabEvidence(events)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'wallet-lab-sanitized-evidence.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="lab-card evidence-card" aria-labelledby="evidence-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">No addresses, signatures, or pairing topics</p>
          <h2 id="evidence-title">Sanitized evidence ({events.length})</h2>
        </div>
        <button type="button" onClick={downloadEvidence} disabled={events.length === 0}>
          Export JSON
        </button>
      </div>
      <ol className="evidence-list">
        {events.map((event) => (
          <li key={event.eventId}>
            <time>{event.occurredAt}</time>
            <span>{event.connectorId}</span>
            <span>{event.kind}</span>
            <strong>{event.outcome}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function WalletLabApp({ runtime }: { runtime: EvmRuntime }) {
  const [events, setEvents] = useState<readonly LabEvidenceEvent[]>([]);

  const recordEvidence = useMemo(
    () => (input: EvidenceInput) => {
      const event = createLabEvidenceEvent({
        eventId: `evt_${crypto.randomUUID()}`,
        occurredAt: new Date().toISOString(),
        ...input,
      });
      setEvents((current) => [...current.slice(-249), event]);
    },
    [],
  );

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">KAN-224 · restricted evaluation</p>
        <h1>Local testnet wallet lab</h1>
        <p>
          Two authorized evaluators only. Use disposable testnet wallets. Mainnet, real funds,
          customer data, transaction sending, and public hosting are intentionally unsupported.
        </p>
        <div className="boundary-row" aria-label="Lab safety boundary">
          <span>127.0.0.1 only</span>
          <span>Testnets only</span>
          <span>App telemetry minimized</span>
          <span>No transactions</span>
        </div>
        <p className="boundary-note">
          The harness disables its own supported telemetry controls. Browser extensions and wallet
          apps remain third-party software with their own privacy behavior.
        </p>
      </header>

      <div className="lab-grid">
        <EvmPanel runtime={runtime} onEvidence={recordEvidence} />
        <PhantomPanel onEvidence={recordEvidence} />
      </div>
      <EvidencePanel events={events} />

      <footer>
        This harness proves compatibility only. It does not create a production authentication
        session or authorize the lending product for public launch.
      </footer>
    </main>
  );
}
