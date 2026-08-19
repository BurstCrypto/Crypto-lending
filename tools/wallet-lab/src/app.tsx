import { useEffect, useMemo, useRef, useState } from 'react';
import type { EvmRuntime } from './evm';
import {
  LAB_ENVIRONMENT_IDS,
  LAB_RUN_RESULTS,
  LAB_TERMS_ACKNOWLEDGEMENT_STATES,
  connectionIdForConnectorId,
  createLabEvidenceEvent,
  exportLabEvidenceRun,
  type LabAllowedNetwork,
  type LabChainId,
  type LabChainContext,
  type LabConnectorId,
  type LabEnvironmentId,
  type LabEventKind,
  type LabEventOutcome,
  type LabEvidenceEvent,
  type LabRunResult,
  type LabTermsAcknowledgementState,
} from './evidence';
import {
  clearLabEvidenceSession,
  loadLabEvidenceSession,
  saveLabEvidenceSession,
} from './evidence-store';
import { EvmPanel } from './evm-panel';
import { shortenWalletAddress } from './presentation';
import {
  createPhantomSolanaAdapterLifecycle,
  SOLANA_DEVNET_CHAIN,
  SOLANA_WALLET_LAB_DOMAIN,
  SOLANA_WALLET_LAB_ORIGIN,
  verifySolanaOwnership,
  type PhantomSolanaAdapter,
  type PhantomSolanaAdapterState,
} from './solana';

export { EvmPanel };

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

interface EvidenceRunFields {
  caseId: string;
  result: LabRunResult;
  tester: string;
  environmentId: LabEnvironmentId;
  osName: string;
  osVersion: string;
  browserName: string;
  browserVersion: string;
  connections: Readonly<Record<string, EvidenceConnectionFields>>;
  termsAcknowledgement: LabTermsAcknowledgementState;
}

interface EvidenceConnectionFields {
  walletName: string;
  walletVersion: string;
}

interface ObservedEvidenceConnection {
  connectionId: string;
  connectorId: LabConnectorId;
  networks: readonly LabAllowedNetwork[];
}

const WALLET_LAB_LOCK_SHA256 = 'D723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9';
const WALLET_LAB_AUDIT_SNAPSHOT = Object.freeze({
  reference: 'docs/wallets/license-review/lock-review-snapshot.json',
  date: '2026-08-19',
});

function defaultWalletName(connectorId: LabConnectorId): string {
  switch (connectorId) {
    case 'metamask':
      return 'MetaMask';
    case 'coinbase':
      return 'Coinbase Wallet';
    case 'walletconnect':
      return 'WalletConnect peer';
    case 'phantom':
      return 'Phantom';
    default:
      return 'Unapproved connector';
  }
}

function allowedNetworkForEvent(event: LabEvidenceEvent): LabAllowedNetwork | undefined {
  if (
    event.chainId === 'eip155:11155111' ||
    event.chainId === 'eip155:84532' ||
    event.chainId === 'solana:devnet'
  ) {
    return event.chainId;
  }
  return undefined;
}

function createInitialEvidenceRunFields(): EvidenceRunFields {
  return {
    caseId: '',
    result: 'blocked',
    tester: '',
    environmentId: 'D1',
    osName: '',
    osVersion: '',
    browserName: '',
    browserVersion: '',
    connections: {},
    termsAcknowledgement: 'not-accepted',
  };
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

export function EvidencePanel({
  events,
  configuredCandidateCommit,
  onClear,
}: {
  events: readonly LabEvidenceEvent[];
  configuredCandidateCommit: string;
  onClear(): void;
}) {
  const [fields, setFields] = useState<EvidenceRunFields>(() => createInitialEvidenceRunFields());
  const [feedback, setFeedback] = useState(
    'Complete the run and connection identities before exporting evidence schema v3.',
  );
  const observedConnections = useMemo<readonly ObservedEvidenceConnection[]>(() => {
    const roster = new Map<
      string,
      { connectionId: string; connectorId: LabConnectorId; networks: Set<LabAllowedNetwork> }
    >();
    for (const event of events) {
      const network = allowedNetworkForEvent(event);
      const existing = roster.get(event.connectionId);
      if (existing) {
        if (network) existing.networks.add(network);
        continue;
      }
      roster.set(event.connectionId, {
        connectionId: event.connectionId,
        connectorId: event.connectorId,
        networks: new Set(network ? [network] : []),
      });
    }
    return [...roster.values()].map((connection) => ({
      ...connection,
      networks: [...connection.networks],
    }));
  }, [events]);

  function downloadEvidence() {
    const firstEvent = events[0];
    const lastEvent = events.at(-1);
    if (!firstEvent || !lastEvent) return;

    try {
      const completedAt = new Date(
        Math.max(Date.now(), new Date(lastEvent.occurredAt).getTime()),
      ).toISOString();
      const runId = `run_${firstEvent.eventId.replace(/^evt_/u, '')}`;
      const serialized = exportLabEvidenceRun({
        runId,
        caseId: fields.caseId.trim(),
        result: fields.result,
        tester: fields.tester.trim(),
        candidateCommit: configuredCandidateCommit.trim(),
        lockSha256: WALLET_LAB_LOCK_SHA256,
        environmentId: fields.environmentId,
        os: { name: fields.osName.trim(), version: fields.osVersion.trim() },
        browser: {
          name: fields.browserName.trim(),
          version: fields.browserVersion.trim(),
        },
        connections: observedConnections.map((connection) => {
          const metadata = fields.connections[connection.connectionId];
          return {
            connectionId: connection.connectionId,
            connectorId: connection.connectorId,
            wallet: {
              name: (metadata?.walletName ?? '').trim(),
              version: (metadata?.walletVersion ?? '').trim(),
            },
            networks: connection.networks,
          };
        }),
        startedAt: firstEvent.occurredAt,
        completedAt,
        termsAcknowledgement: fields.termsAcknowledgement,
        auditSnapshot: WALLET_LAB_AUDIT_SNAPSHOT,
        events,
      });
      const blob = new Blob([serialized], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${fields.caseId.toLowerCase()}-${fields.environmentId.toLowerCase()}-${runId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setFeedback('Sanitized v3 evidence exported. Inspect it before attaching it anywhere.');
    } catch {
      setFeedback(
        'Export blocked. Enter valid case, tester, commit, OS, browser, and every connection identity.',
      );
    }
  }

  function clearRun() {
    onClear();
    setFields(createInitialEvidenceRunFields());
    setFeedback('The sanitized session evidence for this tab was cleared.');
  }

  return (
    <section className="lab-card evidence-card" aria-labelledby="evidence-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">No addresses, signatures, or pairing topics</p>
          <h2 id="evidence-title">Sanitized evidence ({events.length})</h2>
        </div>
        <div className="button-row">
          <button type="button" onClick={downloadEvidence} disabled={events.length === 0}>
            Export v3 JSON
          </button>
          <button type="button" onClick={clearRun} disabled={events.length === 0}>
            Clear run
          </button>
        </div>
      </div>
      <fieldset className="evidence-metadata">
        <legend>Frozen run identity</legend>
        <label>
          Case ID
          <input
            value={fields.caseId}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                caseId: event.target.value.toUpperCase(),
              }))
            }
            placeholder="C01"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          Overall result
          <select
            value={fields.result}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                result: event.target.value as LabRunResult,
              }))
            }
          >
            {LAB_RUN_RESULTS.map((result) => (
              <option key={result} value={result}>
                {result}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tester
          <input
            value={fields.tester}
            onChange={(event) =>
              setFields((current) => ({ ...current, tester: event.target.value }))
            }
            placeholder="Authorized tester"
            autoComplete="off"
          />
        </label>
        <label>
          Full candidate commit
          <input
            value={configuredCandidateCommit}
            placeholder="40 hexadecimal characters"
            autoComplete="off"
            spellCheck={false}
            readOnly
          />
        </label>
        <label>
          Environment
          <select
            value={fields.environmentId}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                environmentId: event.target.value as LabEnvironmentId,
              }))
            }
          >
            {LAB_ENVIRONMENT_IDS.map((environmentId) => (
              <option key={environmentId} value={environmentId}>
                {environmentId}
              </option>
            ))}
          </select>
        </label>
        <label>
          OS name
          <input
            value={fields.osName}
            onChange={(event) =>
              setFields((current) => ({ ...current, osName: event.target.value }))
            }
            placeholder="Windows"
            autoComplete="off"
          />
        </label>
        <label>
          OS version
          <input
            value={fields.osVersion}
            onChange={(event) =>
              setFields((current) => ({ ...current, osVersion: event.target.value }))
            }
            placeholder="11 24H2"
            autoComplete="off"
          />
        </label>
        <label>
          Browser name
          <input
            value={fields.browserName}
            onChange={(event) =>
              setFields((current) => ({ ...current, browserName: event.target.value }))
            }
            placeholder="Chrome"
            autoComplete="off"
          />
        </label>
        <label>
          Browser version
          <input
            value={fields.browserVersion}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                browserVersion: event.target.value,
              }))
            }
            placeholder="151.0.7922.138"
            autoComplete="off"
          />
        </label>
        {observedConnections.map((connection) => {
          const storedMetadata = fields.connections[connection.connectionId];
          const metadata = {
            walletName: storedMetadata?.walletName ?? '',
            walletVersion: storedMetadata?.walletVersion ?? '',
          };
          const updateMetadata = (next: EvidenceConnectionFields) =>
            setFields((current) => ({
              ...current,
              connections: { ...current.connections, [connection.connectionId]: next },
            }));
          return (
            <div className="evidence-connection-metadata" key={connection.connectionId}>
              <p>
                <strong>{connection.connectionId}</strong> · {connection.connectorId}
              </p>
              <label>
                Wallet name
                <input
                  value={metadata.walletName}
                  onChange={(event) =>
                    updateMetadata({ ...metadata, walletName: event.target.value })
                  }
                  placeholder={defaultWalletName(connection.connectorId)}
                  autoComplete="off"
                />
              </label>
              <label>
                Wallet version
                <input
                  value={metadata.walletVersion}
                  onChange={(event) =>
                    updateMetadata({ ...metadata, walletVersion: event.target.value })
                  }
                  placeholder="Exact installed version"
                  autoComplete="off"
                />
              </label>
              <p>
                Exercised networks:{' '}
                {connection.networks.length > 0
                  ? connection.networks.join(', ')
                  : 'none (unsupported-chain events only)'}
              </p>
            </div>
          );
        })}
        <label>
          Vendor terms state
          <select
            value={fields.termsAcknowledgement}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                termsAcknowledgement: event.target.value as LabTermsAcknowledgementState,
              }))
            }
          >
            {LAB_TERMS_ACKNOWLEDGEMENT_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <p className="feedback" role="status">
        {feedback}
      </p>
      <p className="boundary-note">
        Sanitized events persist only in this tab&apos;s session storage for reload recovery. Clear
        the run after export; closing the tab also clears the browser session.
      </p>
      <ol className="evidence-list">
        {events.map((event) => (
          <li key={event.eventId}>
            <time>{event.occurredAt}</time>
            <span>{event.connectionId}</span>
            <span>{event.connectorId}</span>
            <span>{event.kind}</span>
            <strong>{event.outcome}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function WalletLabApp({
  runtime,
  candidateCommit,
}: {
  runtime: EvmRuntime;
  candidateCommit: string;
}) {
  const [frozenCandidateCommit] = useState(candidateCommit);
  const evidenceBinding = useMemo(
    () => ({
      candidateCommit: frozenCandidateCommit,
      lockSha256: WALLET_LAB_LOCK_SHA256,
    }),
    [frozenCandidateCommit],
  );
  const [events, setEvents] = useState<readonly LabEvidenceEvent[]>(() =>
    loadLabEvidenceSession(window.sessionStorage, evidenceBinding),
  );

  useEffect(() => {
    saveLabEvidenceSession(window.sessionStorage, evidenceBinding, events);
  }, [events, evidenceBinding]);

  const recordEvidence = useMemo(
    () => (input: EvidenceInput) => {
      const event = createLabEvidenceEvent({
        eventId: `evt_${crypto.randomUUID()}`,
        occurredAt: new Date().toISOString(),
        connectionId: connectionIdForConnectorId(input.connectorId),
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
      <EvidencePanel
        events={events}
        configuredCandidateCommit={frozenCandidateCommit}
        onClear={() => {
          clearLabEvidenceSession(window.sessionStorage);
          setEvents([]);
        }}
      />

      <footer>
        This harness proves compatibility only. It does not create a production authentication
        session or authorize the lending product for public launch.
      </footer>
    </main>
  );
}
