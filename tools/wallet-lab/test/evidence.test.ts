import { describe, expect, it } from 'vitest';

import { createLabEvidenceEvent, exportLabEvidence } from '../src/evidence';

describe('wallet lab evidence', () => {
  it('exports only the sanitized allowlisted shape', () => {
    const event = createLabEvidenceEvent({
      eventId: 'evt_123',
      occurredAt: '2026-08-18T12:00:00.000Z',
      connectorId: 'walletconnect',
      chainId: 'eip155:11155111',
      chainContext: 'observed',
      kind: 'connect',
      outcome: 'accepted',
      accountObserved: true,
    });

    const exported = exportLabEvidence([event]);

    expect(exported).toContain('sanitized-testnet-wallet-evidence');
    expect(exported).not.toMatch(/"address"|"signature"|pairingUri|sessionTopic|providerError/i);
    expect(JSON.parse(exported)).toMatchObject({
      containsAddresses: false,
      containsSignatures: false,
      containsPairingData: false,
      containsWalletSecrets: false,
      events: [event],
    });
  });

  it('rejects identifiers and chains outside the allowlist', () => {
    expect(() =>
      createLabEvidenceEvent({
        eventId: 'contains spaces',
        occurredAt: '2026-08-18T12:00:00.000Z',
        connectorId: 'metamask',
        chainId: 'eip155:11155111',
        chainContext: 'requested',
        kind: 'connect',
        outcome: 'accepted',
      }),
    ).toThrow('Evidence event ID is invalid.');

    expect(() =>
      createLabEvidenceEvent({
        eventId: 'evt_mainnet',
        occurredAt: '2026-08-18T12:00:00.000Z',
        connectorId: 'metamask',
        chainId: 'eip155:1' as 'eip155:11155111',
        chainContext: 'observed',
        kind: 'connect',
        outcome: 'accepted',
      }),
    ).toThrow('Evidence connector or chain is not allowlisted.');
  });

  it('rejects non-boolean account flags at the runtime boundary', () => {
    expect(() =>
      createLabEvidenceEvent({
        eventId: 'evt_boolean',
        occurredAt: '2026-08-18T12:00:00.000Z',
        connectorId: 'injected',
        chainId: 'eip155:11155111',
        chainContext: 'observed',
        kind: 'connect',
        outcome: 'accepted',
        accountObserved: 'true' as unknown as boolean,
      }),
    ).toThrow('Evidence account-observed flag must be boolean.');
  });
});
