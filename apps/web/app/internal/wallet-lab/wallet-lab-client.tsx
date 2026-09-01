'use client';

import { useMemo, useState } from 'react';

import {
  WALLET_LAB_CONNECTORS,
  WALLET_LAB_NETWORKS,
  connectorSupportsNetwork,
  type WalletLabConnectorId,
  type WalletLabNetworkId,
} from '@/lib/wallets/lab/config';
import {
  buildWalletLabEvidence,
  exportWalletLabEvidence,
  type WalletLabEventKind,
  type WalletLabEventOutcome,
  type WalletLabEvidenceEvent,
} from '@/lib/wallets/lab/evidence';

const CONTROLS: readonly {
  kind: WalletLabEventKind;
  label: string;
  outcome: WalletLabEventOutcome;
  accountObserved?: boolean;
}[] = [
  { kind: 'connect', label: 'Simulate connect', outcome: 'simulated', accountObserved: true },
  { kind: 'reject', label: 'Simulate rejection', outcome: 'rejected' },
  { kind: 'restore', label: 'Simulate restore', outcome: 'simulated', accountObserved: true },
  {
    kind: 'account-change',
    label: 'Simulate account change',
    outcome: 'simulated',
    accountObserved: true,
  },
  { kind: 'chain-change', label: 'Simulate chain change', outcome: 'simulated' },
  {
    kind: 'ownership-proof',
    label: 'Simulate ownership proof',
    outcome: 'simulated',
    accountObserved: true,
  },
  { kind: 'session-update', label: 'Simulate session update', outcome: 'simulated' },
  { kind: 'disconnect', label: 'Simulate disconnect', outcome: 'cleared' },
];

function createMockEvidence(input: {
  connectorId: WalletLabConnectorId;
  networkId: WalletLabNetworkId;
  kind: WalletLabEventKind;
  outcome: WalletLabEventOutcome;
  accountObserved: boolean;
}): WalletLabEvidenceEvent {
  return buildWalletLabEvidence({
    eventId: `evt_${crypto.randomUUID()}`,
    occurredAt: new Date().toISOString(),
    ...input,
  });
}

export function WalletLabClient() {
  const [connectorId, setConnectorId] = useState<WalletLabConnectorId>('metamask');
  const [networkId, setNetworkId] = useState<WalletLabNetworkId>('eip155:11155111');
  const [events, setEvents] = useState<readonly WalletLabEvidenceEvent[]>([]);
  const compatible = connectorSupportsNetwork(connectorId, networkId);
  const selectedConnector = WALLET_LAB_CONNECTORS.find(({ id }) => id === connectorId);
  const evidenceJson = useMemo(() => exportWalletLabEvidence(events), [events]);

  function recordControl(
    kind: WalletLabEventKind,
    outcome: WalletLabEventOutcome,
    accountObserved = false,
  ) {
    if (!compatible) return;
    const event = createMockEvidence({
      connectorId,
      networkId,
      kind,
      outcome,
      accountObserved,
    });
    setEvents((current) => [...current.slice(-248), event]);
  }

  function downloadEvidence() {
    const url = URL.createObjectURL(new Blob([evidenceJson], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'wallet-lab-sanitized-evidence.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="page-shell wallet-lab-shell">
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            LAB
          </span>
          <span>Restricted wallet validation lab</span>
        </div>
        <p className="foundation-label">Testnet-only · Mock-only</p>
      </header>

      <section
        id="main-content"
        className="wallet-lab-warning"
        aria-labelledby="lab-title"
        tabIndex={-1}
      >
        <p className="eyebrow">KAN-224 restricted environment</p>
        <h1 id="lab-title">No real wallet SDK is active.</h1>
        <p className="hero-copy">
          These controls exercise the application boundary and sanitized evidence format only.
          Mainnet, embedded wallets, production keys, signatures, pairing data, and real funds are
          prohibited. MetaMask Connect and WalletConnect remain blocked on KAN-222 clearance.
        </p>
      </section>

      <div className="wallet-lab-grid">
        <section className="status-card" aria-labelledby="configuration-title">
          <h2 id="configuration-title">Test configuration</h2>
          <label>
            Connector
            <select
              value={connectorId}
              onChange={(event) => setConnectorId(event.target.value as WalletLabConnectorId)}
            >
              {WALLET_LAB_CONNECTORS.map((connector) => (
                <option key={connector.id} value={connector.id}>
                  {connector.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Network
            <select
              value={networkId}
              onChange={(event) => setNetworkId(event.target.value as WalletLabNetworkId)}
            >
              {WALLET_LAB_NETWORKS.map((network) => (
                <option key={network.id} value={network.id}>
                  {network.name}
                </option>
              ))}
            </select>
          </label>
          <p className={compatible ? 'lab-result-ok' : 'lab-result-blocked'} role="status">
            {compatible
              ? `Mock boundary ready. Activation gate: ${selectedConnector?.activationGate}.`
              : 'Blocked: the selected connector does not support this chain namespace.'}
          </p>
          <div className="wallet-lab-controls">
            {CONTROLS.map((control) => (
              <button
                key={control.kind}
                type="button"
                disabled={!compatible}
                onClick={() =>
                  recordControl(control.kind, control.outcome, control.accountObserved ?? false)
                }
              >
                {control.label}
              </button>
            ))}
          </div>
        </section>

        <section className="status-card" aria-labelledby="evidence-title">
          <div className="status-heading">
            <div>
              <p className="eyebrow">Sanitized output</p>
              <h2 id="evidence-title">Evidence ({events.length})</h2>
            </div>
            <button type="button" onClick={downloadEvidence} disabled={events.length === 0}>
              Export JSON
            </button>
          </div>
          <p className="lab-evidence-note">
            Evidence records only allowlisted outcomes and whether an account was observed. No
            address, signature, provider, topic, URI, error payload, or wallet secret is accepted.
          </p>
          <ol className="wallet-lab-events">
            {events.map((event) => (
              <li key={event.eventId}>
                <code>{event.occurredAt}</code> · {event.connectorId} · {event.kind} ·{' '}
                {event.outcome}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
