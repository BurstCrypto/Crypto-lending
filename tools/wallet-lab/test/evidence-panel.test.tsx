import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EvidencePanel } from '../src/app';
import { createLabEvidenceEvent } from '../src/evidence';

const candidateCommit = '0123456789abcdef0123456789abcdef01234567';

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsText(blob);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('concurrent evidence panel', () => {
  it('exports one attributed roster row per observed connector', async () => {
    const initialEvents = [
      createLabEvidenceEvent({
        eventId: 'evt_00000000-0000-4000-8000-000000000001',
        occurredAt: '2026-08-19T18:00:00.000Z',
        connectionId: 'conn_metamask',
        connectorId: 'metamask',
        chainId: 'eip155:11155111',
        chainContext: 'observed',
        kind: 'connect',
        outcome: 'accepted',
        accountObserved: true,
      }),
      createLabEvidenceEvent({
        eventId: 'evt_00000000-0000-4000-8000-000000000002',
        occurredAt: '2026-08-19T18:01:00.000Z',
        connectionId: 'conn_coinbase',
        connectorId: 'coinbase',
        chainId: 'eip155:84532',
        chainContext: 'observed',
        kind: 'connect',
        outcome: 'accepted',
        accountObserved: true,
      }),
    ];
    const laterMetaMaskBaseEvent = createLabEvidenceEvent({
      eventId: 'evt_00000000-0000-4000-8000-000000000003',
      occurredAt: '2026-08-19T18:01:30.000Z',
      connectionId: 'conn_metamask',
      connectorId: 'metamask',
      chainId: 'eip155:84532',
      chainContext: 'observed',
      kind: 'chain-change',
      outcome: 'accepted',
      accountObserved: true,
    });
    let exportedBlob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (!(blob instanceof Blob)) throw new TypeError('Expected an evidence Blob.');
      exportedBlob = blob;
      return 'blob:concurrent-evidence';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const onClear = vi.fn();
    const view = render(
      <EvidencePanel
        events={initialEvents}
        configuredCandidateCommit={candidateCommit}
        onClear={onClear}
      />,
    );

    fireEvent.change(screen.getByLabelText('Case ID'), { target: { value: 'C18' } });
    fireEvent.change(screen.getByLabelText('Tester'), { target: { value: 'qa.tester' } });
    fireEvent.change(screen.getByLabelText('OS name'), { target: { value: 'Windows' } });
    fireEvent.change(screen.getByLabelText('OS version'), { target: { value: '11 24H2' } });
    fireEvent.change(screen.getByLabelText('Browser name'), { target: { value: 'Chrome' } });
    fireEvent.change(screen.getByLabelText('Browser version'), { target: { value: '140.0' } });
    fireEvent.change(screen.getByLabelText('Overall result'), { target: { value: 'pass' } });
    fireEvent.change(screen.getByLabelText('Vendor terms state'), {
      target: { value: 'accepted' },
    });
    const walletVersions = screen.getAllByLabelText('Wallet version');
    fireEvent.change(walletVersions[0]!, { target: { value: '13.0.0' } });
    fireEvent.change(walletVersions[1]!, { target: { value: '4.0.0' } });

    fireEvent.click(screen.getByRole('button', { name: 'Export v3 JSON' }));
    expect(exportedBlob).toBeUndefined();
    expect(screen.getByRole('status')).toHaveTextContent('Export blocked');

    const walletNames = screen.getAllByLabelText('Wallet name');
    fireEvent.change(walletNames[0]!, { target: { value: 'MetaMask' } });
    fireEvent.change(walletNames[1]!, { target: { value: 'Coinbase Wallet' } });
    view.rerender(
      <EvidencePanel
        events={[...initialEvents, laterMetaMaskBaseEvent]}
        configuredCandidateCommit={candidateCommit}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export v3 JSON' }));

    expect(exportedBlob).toBeDefined();
    const parsed = JSON.parse(await readBlob(exportedBlob!)) as {
      schemaVersion: number;
      connections: Array<{
        connectionId: string;
        connectorId: string;
        networks: string[];
      }>;
    };
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.connections).toEqual([
      {
        connectionId: 'conn_metamask',
        connectorId: 'metamask',
        wallet: { name: 'MetaMask', version: '13.0.0' },
        networks: ['eip155:11155111', 'eip155:84532'],
      },
      {
        connectionId: 'conn_coinbase',
        connectorId: 'coinbase',
        wallet: { name: 'Coinbase Wallet', version: '4.0.0' },
        networks: ['eip155:84532'],
      },
    ]);

    expect(screen.getByLabelText('Full candidate commit')).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Clear run' }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Case ID')).toHaveValue('');
    expect(screen.getByLabelText('Tester')).toHaveValue('');
    expect(screen.getByLabelText('OS name')).toHaveValue('');
    expect(screen.getByLabelText('Overall result')).toHaveValue('blocked');
    expect(screen.getByLabelText('Vendor terms state')).toHaveValue('not-accepted');
    expect(screen.getByLabelText('Full candidate commit')).toHaveValue(candidateCommit);
  });

  it('does not invent an allowed network for an unsupported-chain event', async () => {
    const event = createLabEvidenceEvent({
      eventId: 'evt_00000000-0000-4000-8000-000000000004',
      occurredAt: '2026-08-19T19:00:00.000Z',
      connectionId: 'conn_unapproved',
      connectorId: 'unapproved',
      chainId: 'evm:unsupported',
      chainContext: 'observed',
      kind: 'connect',
      outcome: 'blocked',
    });
    let exportedBlob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (!(blob instanceof Blob)) throw new TypeError('Expected an evidence Blob.');
      exportedBlob = blob;
      return 'blob:unsupported-evidence';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(
      <EvidencePanel
        events={[event]}
        configuredCandidateCommit={candidateCommit}
        onClear={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Case ID'), { target: { value: 'C09' } });
    fireEvent.change(screen.getByLabelText('Tester'), { target: { value: 'qa.tester' } });
    fireEvent.change(screen.getByLabelText('OS name'), { target: { value: 'Windows' } });
    fireEvent.change(screen.getByLabelText('OS version'), { target: { value: '11 24H2' } });
    fireEvent.change(screen.getByLabelText('Browser name'), { target: { value: 'Chrome' } });
    fireEvent.change(screen.getByLabelText('Browser version'), { target: { value: '140.0' } });
    fireEvent.change(screen.getByLabelText('Wallet name'), {
      target: { value: 'Rabby Wallet' },
    });
    fireEvent.change(screen.getByLabelText('Wallet version'), { target: { value: '0.93.0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export v3 JSON' }));

    expect(exportedBlob).toBeDefined();
    const parsed = JSON.parse(await readBlob(exportedBlob!)) as {
      connections: Array<{ networks: string[] }>;
    };
    expect(parsed.connections[0]?.networks).toEqual([]);
    expect(screen.getByText(/none \(unsupported-chain events only\)/u)).toBeInTheDocument();
  });
});
