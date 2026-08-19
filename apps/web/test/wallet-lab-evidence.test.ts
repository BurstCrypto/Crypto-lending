import { describe, expect, it } from 'vitest';

import { buildWalletLabEvidence, exportWalletLabEvidence } from '../lib/wallets/lab/evidence';

describe('wallet lab sanitized evidence', () => {
  it('exports only the bounded allowlisted event contract', () => {
    const event = buildWalletLabEvidence({
      eventId: 'evt_1',
      occurredAt: '2026-08-18T20:00:00.000Z',
      connectorId: 'metamask',
      networkId: 'eip155:11155111',
      kind: 'ownership-proof',
      outcome: 'simulated',
      accountObserved: true,
    });
    const exported = exportWalletLabEvidence([event]);

    expect(JSON.parse(exported)).toMatchObject({
      schemaVersion: 1,
      classification: 'sanitized-test-evidence',
      containsWalletSecrets: false,
      events: [
        {
          connectorId: 'metamask',
          networkId: 'eip155:11155111',
          accountObserved: true,
          evidenceMode: 'sanitized-mock',
        },
      ],
    });
    expect(exported).not.toContain('address');
    expect(exported).not.toContain('signature');
    expect(exported).not.toContain('pairing');
    expect(exported).not.toContain('sessionTopic');
  });

  it('rejects noncanonical timestamps and nonallowlisted values at runtime', () => {
    expect(() =>
      buildWalletLabEvidence({
        eventId: 'evt_1',
        occurredAt: 'not-a-date',
        connectorId: 'metamask',
        networkId: 'eip155:11155111',
        kind: 'connect',
        outcome: 'accepted',
      }),
    ).toThrow('canonical UTC timestamp');

    expect(() =>
      buildWalletLabEvidence({
        eventId: 'evt_1',
        occurredAt: '2026-08-18T20:00:00.000Z',
        connectorId: 'metamask',
        networkId: 'eip155:11155111',
        kind: 'connect',
        outcome: 'accepted',
        accountObserved: '0xfulladdress' as unknown as boolean,
      }),
    ).toThrow('accountObserved must be boolean');
  });
});
