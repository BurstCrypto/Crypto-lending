import { describe, expect, it } from 'vitest';

import {
  connectionIdForConnectorId,
  createLabEvidenceEvent,
  createLabEvidenceRun,
  exportLabEvidence,
  exportLabEvidenceRun,
  exportLabEvidenceSession,
  restoreLabEvidenceEvents,
  restoreLabEvidenceRun,
  restoreLabEvidenceSession,
} from '../src/evidence';
import type {
  LabConnectorId,
  LabEnvironmentId,
  LabEventKind,
  LabEvidenceRunInput,
  LabEvidenceConnectionInput,
  LabRunResult,
} from '../src/evidence';

type EventInput = Parameters<typeof createLabEvidenceEvent>[0];

const startedAt = '2026-08-18T12:00:00.000Z';
const completedAt = '2026-08-18T12:10:00.000Z';
const candidateBinding = {
  candidateCommit: '0123456789abcdef0123456789abcdef01234567',
  lockSha256: 'D723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9',
} as const;

function eventId(index: number): string {
  return `evt_00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
}

function validConnection(
  overrides: Partial<LabEvidenceConnectionInput> = {},
): LabEvidenceConnectionInput {
  return {
    connectionId: 'conn_walletconnect',
    connectorId: 'walletconnect',
    wallet: { name: 'Rainbow', version: '2.4.1' },
    networks: ['eip155:11155111'],
    ...overrides,
  };
}

function validEvent(overrides: Partial<EventInput> = {}) {
  return createLabEvidenceEvent({
    eventId: eventId(1),
    occurredAt: '2026-08-18T12:01:00.000Z',
    connectionId: 'conn_walletconnect',
    connectorId: 'walletconnect',
    chainId: 'eip155:11155111',
    chainContext: 'observed',
    kind: 'connect',
    outcome: 'accepted',
    accountObserved: true,
    ...overrides,
  });
}

function validRun(overrides: Partial<LabEvidenceRunInput> = {}): LabEvidenceRunInput {
  return {
    runId: 'run_20260818_001',
    caseId: 'WC09',
    result: 'pass',
    tester: 'qa.tester',
    candidateCommit: '0123456789abcdef0123456789abcdef01234567',
    lockSha256: 'D723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9',
    environmentId: 'D3',
    os: { name: 'Windows', version: '11 24H2' },
    browser: { name: 'Chrome', version: '140.0.7339.80' },
    connections: [validConnection()],
    startedAt,
    completedAt,
    termsAcknowledgement: 'accepted',
    auditSnapshot: {
      reference: 'docs/wallets/audit/2026-08-18.json',
      date: '2026-08-18',
    },
    sanitizedEvidenceLinks: [
      'evidence/WC09/run_20260818_001.png',
      'https://evidence.example.test/runs/run_20260818_001?view=sanitized',
    ],
    jiraFollowUps: ['KAN-225', 'KAN-226'],
    events: [validEvent()],
    ...overrides,
  };
}

function legacyEvent() {
  return {
    schemaVersion: 1,
    eventId: eventId(1),
    occurredAt: '2026-08-18T12:01:00.000Z',
    connectorId: 'walletconnect',
    chainId: 'eip155:11155111',
    chainContext: 'observed',
    kind: 'connect',
    outcome: 'accepted',
    accountObserved: true,
    evidenceMode: 'sanitized-real-wallet',
  };
}

function legacyV1Envelope() {
  return {
    schemaVersion: 1,
    exportedAt: '2026-08-18T12:10:00.000Z',
    classification: 'sanitized-testnet-wallet-evidence',
    containsAddresses: false,
    containsSignatures: false,
    containsPairingData: false,
    containsWalletSecrets: false,
    events: [legacyEvent()],
  };
}

function legacyV2Run() {
  return {
    schemaVersion: 2,
    classification: 'sanitized-testnet-wallet-run-evidence',
    containsAddresses: false,
    containsSignatures: false,
    containsPairingData: false,
    containsWalletSecrets: false,
    runId: 'run_20260818_001',
    caseId: 'WC09',
    result: 'pass',
    tester: 'qa.tester',
    candidateCommit: '0123456789abcdef0123456789abcdef01234567',
    lockSha256: 'D723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9',
    environmentId: 'D3',
    os: { name: 'Windows', version: '11 24H2' },
    browser: { name: 'Chrome', version: '140.0.7339.80' },
    wallet: { name: 'Rainbow', version: '2.4.1' },
    network: 'eip155:11155111',
    startedAt,
    completedAt,
    termsAcknowledgement: 'accepted',
    auditSnapshot: {
      reference: 'docs/wallets/audit/2026-08-18.json',
      date: '2026-08-18',
    },
    events: [legacyEvent()],
  };
}

describe('wallet lab evidence', () => {
  it('exports only the sanitized v2 allowlisted shape', () => {
    const event = validEvent();
    const exported = exportLabEvidence([event]);

    expect(exported).toContain('sanitized-testnet-wallet-evidence');
    expect(exported).not.toMatch(/"address"|"signature"|pairingUri|sessionTopic|providerError/i);
    expect(JSON.parse(exported)).toMatchObject({
      schemaVersion: 2,
      containsAddresses: false,
      containsSignatures: false,
      containsPairingData: false,
      containsWalletSecrets: false,
      events: [event],
    });
  });

  it('creates v2 events with deterministic, sanitized connection attribution', () => {
    expect(validEvent()).toMatchObject({
      schemaVersion: 2,
      connectionId: 'conn_walletconnect',
    });
    expect(connectionIdForConnectorId('metamask')).toBe('conn_metamask');
    expect(
      createLabEvidenceEvent({
        eventId: eventId(2),
        occurredAt: '2026-08-18T12:01:00.000Z',
        connectionId: connectionIdForConnectorId('coinbase'),
        connectorId: 'coinbase',
        chainId: 'eip155:84532',
        chainContext: 'observed',
        kind: 'connect',
        outcome: 'accepted',
      }).connectionId,
    ).toBe('conn_coinbase');
    expect(() =>
      createLabEvidenceEvent({
        eventId: eventId(3),
        occurredAt: '2026-08-18T12:01:00.000Z',
        connectorId: 'coinbase',
        chainId: 'eip155:84532',
        chainContext: 'observed',
        kind: 'connect',
        outcome: 'accepted',
      } as EventInput),
    ).toThrow('Evidence connection ID is invalid or unsanitized.');
    expect(() => validEvent({ connectionId: 'raw-provider:uid' })).toThrow(
      'Evidence connection ID is invalid or unsanitized.',
    );
    expect(() => validEvent({ connectionId: 'conn_coinbase' })).toThrow(
      'Evidence connection ID does not match its connector.',
    );
    expect(() => validEvent({ connectionId: `conn_0x${'a'.repeat(40)}` })).toThrow(
      'Evidence connection ID does not match its connector.',
    );
  });

  it('rejects identifiers and chains outside the v2 allowlist', () => {
    for (const invalidId of [
      'contains spaces',
      'evt_default',
      'evt_00000000-0000-1000-8000-000000000001',
      'evt_00000000-0000-4000-7000-000000000001',
      'evt_00000000-0000-4000-8000-00000000000A',
    ]) {
      expect(() => validEvent({ eventId: invalidId })).toThrow('Evidence event ID is invalid.');
    }
    expect(() => validEvent({ chainId: 'eip155:1' as EventInput['chainId'] })).toThrow(
      'Evidence connector or chain is not allowlisted.',
    );
    expect(() =>
      validEvent({
        chainId: 'evm:unsupported',
        chainContext: 'requested',
        outcome: 'blocked',
      }),
    ).toThrow('Unsupported-chain evidence must be an observation.');
  });

  it('records policy-blocked unapproved providers without treating generic injected as approved', () => {
    expect(
      validEvent({
        connectionId: 'conn_unapproved',
        connectorId: 'unapproved',
        kind: 'connect',
        outcome: 'blocked',
        accountObserved: false,
      }).connectorId,
    ).toBe('unapproved');

    expect(() => validEvent({ connectorId: 'injected' as LabConnectorId })).toThrow(
      'Evidence connector or chain is not allowlisted.',
    );
  });

  it('allowlists lifecycle and connectivity event kinds explicitly', () => {
    const additionalKinds = [
      'session-delete',
      'session-expire',
      'pairing-expire',
      'qr-display',
      'mobile-return',
      'offline',
      'online',
    ] as const satisfies readonly LabEventKind[];

    for (const [index, kind] of additionalKinds.entries()) {
      expect(validEvent({ eventId: eventId(index + 10), kind }).kind).toBe(kind);
    }
    expect(() => validEvent({ kind: 'debug-log' as LabEventKind })).toThrow(
      'Evidence kind or outcome is not allowlisted.',
    );
  });

  it('binds connector-specific lifecycle events and approved mobile returns', () => {
    for (const [index, kind] of [
      'session-update',
      'session-delete',
      'session-expire',
      'pairing-expire',
      'qr-display',
    ].entries()) {
      expect(() =>
        validEvent({
          eventId: eventId(index + 50),
          connectionId: 'conn_metamask',
          connectorId: 'metamask',
          kind: kind as LabEventKind,
        }),
      ).toThrow('Evidence event kind is restricted to WalletConnect.');
    }

    expect(
      validEvent({
        eventId: eventId(60),
        connectionId: 'conn_coinbase',
        connectorId: 'coinbase',
        kind: 'mobile-return',
      }).kind,
    ).toBe('mobile-return');
    expect(
      validEvent({
        eventId: eventId(61),
        connectionId: 'conn_phantom',
        connectorId: 'phantom',
        chainId: 'solana:devnet',
        kind: 'mobile-return',
      }).kind,
    ).toBe('mobile-return');
    expect(() =>
      validEvent({
        eventId: eventId(62),
        connectionId: 'conn_unapproved',
        connectorId: 'unapproved',
        kind: 'mobile-return',
        outcome: 'blocked',
      }),
    ).toThrow('Mobile-return evidence requires an approved connector.');
  });

  it('does not permit accepted authorization evidence for an unapproved connector', () => {
    for (const [index, kind] of ['connect', 'restore', 'ownership-proof'].entries()) {
      expect(() =>
        validEvent({
          eventId: eventId(index + 70),
          connectionId: 'conn_unapproved',
          connectorId: 'unapproved',
          kind: kind as LabEventKind,
          outcome: 'accepted',
        }),
      ).toThrow('Unapproved connectors cannot record an accepted authorization event.');
    }
  });

  it('rejects non-boolean account flags at the runtime boundary', () => {
    expect(() => validEvent({ accountObserved: 'true' as unknown as boolean })).toThrow(
      'Evidence account-observed flag must be boolean.',
    );
  });

  it('exports a complete validated v3 run envelope with a connection roster', () => {
    const secondEvent = validEvent({
      eventId: eventId(20),
      occurredAt: '2026-08-18T12:09:00.000Z',
      kind: 'disconnect',
      outcome: 'cleared',
      accountObserved: false,
    });
    const exported = exportLabEvidenceRun(validRun({ events: [validEvent(), secondEvent] }));
    const parsed = JSON.parse(exported) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      schemaVersion: 3,
      classification: 'sanitized-testnet-wallet-run-evidence',
      runId: 'run_20260818_001',
      caseId: 'WC09',
      result: 'pass',
      tester: 'qa.tester',
      candidateCommit: '0123456789abcdef0123456789abcdef01234567',
      lockSha256: 'D723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9',
      environmentId: 'D3',
      os: { name: 'Windows', version: '11 24H2' },
      browser: { name: 'Chrome', version: '140.0.7339.80' },
      connections: [
        {
          connectionId: 'conn_walletconnect',
          connectorId: 'walletconnect',
          wallet: { name: 'Rainbow', version: '2.4.1' },
          networks: ['eip155:11155111'],
        },
      ],
      startedAt,
      completedAt,
      termsAcknowledgement: 'accepted',
      auditSnapshot: {
        reference: 'docs/wallets/audit/2026-08-18.json',
        date: '2026-08-18',
      },
      sanitizedEvidenceLinks: [
        'evidence/WC09/run_20260818_001.png',
        'https://evidence.example.test/runs/run_20260818_001?view=sanitized',
      ],
      jiraFollowUps: ['KAN-225', 'KAN-226'],
      containsAddresses: false,
      containsSignatures: false,
      containsPairingData: false,
      containsWalletSecrets: false,
      events: [validEvent(), secondEvent],
    });
    expect(parsed.exportedAt).toEqual(expect.stringMatching(/Z$/));
    expect(parsed).not.toHaveProperty('wallet');
    expect(parsed).not.toHaveProperty('network');
    expect(exported).not.toMatch(/pairingUri|sessionTopic|providerError|privateKey/i);
  });

  it('attributes concurrent events to separate roster entries and multiple allowed networks', () => {
    const metamaskEvent = validEvent({
      eventId: eventId(21),
      occurredAt: '2026-08-18T12:02:00.000Z',
      connectionId: 'conn_metamask',
      connectorId: 'metamask',
      chainId: 'eip155:84532',
    });
    const walletConnectSwitch = validEvent({
      eventId: eventId(23),
      occurredAt: '2026-08-18T12:03:00.000Z',
      chainId: 'eip155:84532',
      kind: 'chain-change',
    });
    const run = createLabEvidenceRun(
      validRun({
        connections: [
          validConnection({ networks: ['eip155:11155111', 'eip155:84532'] }),
          validConnection({
            connectionId: 'conn_metamask',
            connectorId: 'metamask',
            wallet: { name: 'MetaMask', version: '12.4.0' },
            networks: ['eip155:84532'],
          }),
        ],
        events: [validEvent(), metamaskEvent, walletConnectSwitch],
      }),
    );

    expect(run.connections).toHaveLength(2);
    expect(
      run.events.map(({ connectionId, connectorId }) => ({ connectionId, connectorId })),
    ).toEqual([
      { connectionId: 'conn_walletconnect', connectorId: 'walletconnect' },
      { connectionId: 'conn_metamask', connectorId: 'metamask' },
      { connectionId: 'conn_walletconnect', connectorId: 'walletconnect' },
    ]);
    expect(run.connections[0]?.networks).toEqual(['eip155:11155111', 'eip155:84532']);
    expect(Object.isFrozen(run.connections)).toBe(true);
    expect(Object.isFrozen(run.connections[0]?.networks)).toBe(true);
  });

  it('rejects duplicate connection or connector identities and unreferenced roster rows', () => {
    const metamaskEvent = validEvent({
      eventId: eventId(22),
      occurredAt: '2026-08-18T12:02:00.000Z',
      connectionId: 'conn_metamask',
      connectorId: 'metamask',
    });

    expect(() =>
      createLabEvidenceRun(
        validRun({
          connections: [
            validConnection(),
            validConnection({ connectionId: 'conn_walletconnect', connectorId: 'metamask' }),
          ],
          events: [validEvent(), metamaskEvent],
        }),
      ),
    ).toThrow('Evidence connection IDs must be unique within a run.');

    expect(() =>
      createLabEvidenceRun(
        validRun({
          connections: [
            validConnection(),
            validConnection({ connectionId: 'conn_walletconnect_2' }),
          ],
          events: [validEvent()],
        }),
      ),
    ).toThrow('Evidence connector IDs must be unique within a run.');

    expect(() =>
      createLabEvidenceRun(
        validRun({
          connections: [
            validConnection(),
            validConnection({
              connectionId: 'conn_metamask',
              connectorId: 'metamask',
              wallet: { name: 'MetaMask', version: '12.4.0' },
            }),
          ],
          events: [validEvent()],
        }),
      ),
    ).toThrow('Every evidence roster connection must be referenced by an event.');
  });

  it('rejects missing or wrong event attribution against the roster', () => {
    expect(() =>
      createLabEvidenceRun(
        validRun({
          events: [
            validEvent({
              connectionId: 'conn_coinbase',
              connectorId: 'coinbase',
            }),
          ],
        }),
      ),
    ).toThrow('Evidence event connection is not represented in the run roster.');

    expect(() =>
      createLabEvidenceRun(
        validRun({
          events: [validEvent({ connectorId: 'metamask' })],
        }),
      ),
    ).toThrow('Evidence connection ID does not match its connector.');
  });

  it('requires each event network to be compatible with and represented by its connection', () => {
    expect(() =>
      validEvent({
        connectionId: 'conn_phantom',
        connectorId: 'phantom',
        chainId: 'eip155:11155111',
      }),
    ).toThrow('Evidence chain is incompatible with its connector.');
    expect(() =>
      validEvent({
        connectionId: 'conn_metamask',
        connectorId: 'metamask',
        chainId: 'solana:devnet',
      }),
    ).toThrow('Evidence chain is incompatible with its connector.');

    expect(() =>
      createLabEvidenceRun(
        validRun({
          events: [validEvent({ chainId: 'eip155:84532' })],
        }),
      ),
    ).toThrow('Evidence event network is not represented in the run roster.');
  });

  it('requires each roster network set to be bounded, allowlisted, unique, and exact', () => {
    expect(() =>
      createLabEvidenceRun(
        validRun({ connections: Array.from({ length: 6 }, () => validConnection()) }),
      ),
    ).toThrow('Evidence is limited to 5 connections.');
    expect(() =>
      createLabEvidenceRun(validRun({ connections: [validConnection({ networks: [] })] })),
    ).toThrow('Evidence event network is not represented in the run roster.');
    expect(() =>
      createLabEvidenceRun(
        validRun({
          connections: [
            validConnection({
              networks: ['eip155:11155111', 'eip155:84532', 'solana:devnet', 'eip155:11155111'],
            }),
          ],
        }),
      ),
    ).toThrow('Evidence connection is limited to 3 networks.');
    expect(() =>
      createLabEvidenceRun(
        validRun({
          connections: [validConnection({ networks: ['eip155:11155111', 'eip155:11155111'] })],
        }),
      ),
    ).toThrow('Evidence connection networks must be unique.');
    expect(() =>
      createLabEvidenceRun(
        validRun({
          connections: [
            validConnection({
              networks: ['eip155:1' as LabEvidenceConnectionInput['networks'][number]],
            }),
          ],
        }),
      ),
    ).toThrow('Evidence connection network is not allowlisted.');
    expect(() =>
      createLabEvidenceRun(
        validRun({
          connections: [validConnection({ networks: ['solana:devnet'] })],
        }),
      ),
    ).toThrow('Evidence connection network is incompatible with its connector.');
    expect(() =>
      createLabEvidenceRun(
        validRun({
          connections: [validConnection({ connectionId: 'conn_coinbase' })],
        }),
      ),
    ).toThrow('Evidence connection ID does not match its connector.');
    expect(() =>
      createLabEvidenceRun(
        validRun({
          connections: [validConnection({ networks: ['eip155:11155111', 'eip155:84532'] })],
        }),
      ),
    ).toThrow('Evidence connection networks must exactly match its event networks.');

    const unsupportedRun = createLabEvidenceRun(
      validRun({
        connections: [validConnection({ networks: [] })],
        events: [
          validEvent({
            chainId: 'evm:unsupported',
            kind: 'chain-change',
            outcome: 'blocked',
          }),
        ],
      }),
    );
    expect(unsupportedRun.connections[0]?.networks).toEqual([]);
  });

  it('rejects generic wallet names and versions instead of claiming an exact identity', () => {
    for (const walletName of ['WalletConnect peer', 'Example Wallet', 'Other Wallet']) {
      expect(() =>
        createLabEvidenceRun(
          validRun({
            connections: [validConnection({ wallet: { name: walletName, version: '2.4.1' } })],
          }),
        ),
      ).toThrow('Evidence connection requires an exact wallet software identity.');
    }
    expect(() =>
      createLabEvidenceRun(
        validRun({
          connections: [validConnection({ wallet: { name: 'Rainbow', version: 'unknown' } })],
        }),
      ),
    ).toThrow('Evidence connection requires an exact wallet software identity.');
    for (const connection of [
      validConnection({
        connectionId: 'conn_metamask',
        connectorId: 'metamask',
        wallet: { name: 'Not MetaMask', version: '13.0.0' },
      }),
      validConnection({
        connectionId: 'conn_coinbase',
        connectorId: 'coinbase',
        wallet: { name: 'Base Wallet', version: '4.0.0' },
      }),
      validConnection({
        connectionId: 'conn_phantom',
        connectorId: 'phantom',
        wallet: { name: 'Solana Wallet', version: '25.0.0' },
        networks: ['solana:devnet'],
      }),
    ]) {
      expect(() => createLabEvidenceRun(validRun({ connections: [connection] }))).toThrow(
        'Evidence wallet name does not match its canonical connector identity.',
      );
    }
  });

  it('rejects invalid run and case IDs, hashes, environment IDs, timestamps, and results', () => {
    expect(() => createLabEvidenceRun(validRun({ runId: 'run with spaces' }))).toThrow(
      'Evidence run ID is invalid.',
    );
    expect(() => createLabEvidenceRun(validRun({ caseId: 'wc 09' }))).toThrow(
      'Evidence case ID is invalid.',
    );
    expect(() => createLabEvidenceRun(validRun({ candidateCommit: 'a'.repeat(39) }))).toThrow(
      'Candidate commit must be a 40-character hexadecimal hash.',
    );
    expect(() => createLabEvidenceRun(validRun({ lockSha256: 'g'.repeat(64) }))).toThrow(
      'Package lock SHA-256 must be a 64-character hexadecimal hash.',
    );
    expect(() =>
      createLabEvidenceRun(validRun({ environmentId: 'D4' as LabEnvironmentId })),
    ).toThrow('Evidence environment ID is not allowlisted.');
    expect(() => createLabEvidenceRun(validRun({ startedAt: '2026-08-18T12:00:00Z' }))).toThrow(
      'Evidence run timestamps must be canonical UTC.',
    );
    expect(() => createLabEvidenceRun(validRun({ result: 'passed' as LabRunResult }))).toThrow(
      'Evidence run result is not allowlisted.',
    );
  });

  it('rejects completed run envelopes without both evidence and an attributed connection', () => {
    expect(() => createLabEvidenceRun(validRun({ events: [] }))).toThrow(
      'Completed evidence runs require at least one event.',
    );
    expect(() => createLabEvidenceRun(validRun({ connections: [] }))).toThrow(
      'Completed evidence runs require at least one connection.',
    );
  });

  it('rejects address, private-key, topic, and Solana-address patterns in exported free text', () => {
    const evmAddress = `0x${'a'.repeat(40)}`;
    const hexSecret = 'b'.repeat(64);
    const privateKey = `0x${'c'.repeat(64)}`;
    const encodedPrivateKey = `%30%78${'%63'.repeat(64)}`;
    const solanaAddress = 'A'.repeat(32);

    expect(() => createLabEvidenceRun(validRun({ tester: `qa.${evmAddress}` }))).toThrow(
      'Evidence tester contains a prohibited address or secret pattern.',
    );
    expect(() => createLabEvidenceRun(validRun({ runId: `run_${hexSecret}` }))).toThrow(
      'Evidence run ID contains a prohibited address or secret pattern.',
    );
    expect(() =>
      createLabEvidenceRun(validRun({ os: { name: solanaAddress, version: '1.0.0' } })),
    ).toThrow('OS name contains a prohibited address or secret pattern.');
    expect(() =>
      createLabEvidenceRun(validRun({ sanitizedEvidenceLinks: [`evidence/${privateKey}.json`] })),
    ).toThrow('Sanitized evidence link contains a prohibited address or secret pattern.');
    expect(() =>
      createLabEvidenceRun(
        validRun({
          sanitizedEvidenceLinks: [`https://evidence.example.test/${encodedPrivateKey}.json`],
        }),
      ),
    ).toThrow('Sanitized evidence link contains a prohibited address or secret pattern.');
    expect(() =>
      createLabEvidenceRun(
        validRun({
          auditSnapshot: {
            reference: `docs/wallets/audit/${hexSecret}.json`,
            date: '2026-08-18',
          },
        }),
      ),
    ).toThrow('Audit snapshot reference contains a prohibited address or secret pattern.');

    expect(createLabEvidenceRun(validRun())).toMatchObject(candidateBinding);
  });

  it('rejects a completion before start and events outside or out of order in the run', () => {
    expect(() =>
      createLabEvidenceRun(validRun({ completedAt: '2026-08-18T11:59:59.999Z' })),
    ).toThrow('Evidence run cannot complete before it starts.');

    expect(() =>
      createLabEvidenceRun(
        validRun({
          events: [validEvent({ occurredAt: '2026-08-18T12:10:00.001Z' })],
        }),
      ),
    ).toThrow('Evidence event timestamp is outside the run interval.');

    expect(() =>
      createLabEvidenceRun(
        validRun({
          events: [
            validEvent({ eventId: eventId(30), occurredAt: '2026-08-18T12:09:00.000Z' }),
            validEvent({ eventId: eventId(31), occurredAt: '2026-08-18T12:02:00.000Z' }),
          ],
        }),
      ),
    ).toThrow('Evidence events must be ordered by timestamp.');
  });

  it.each([
    'http://evidence.example.test/run.png',
    'https://user:secret@evidence.example.test/run.png',
    'https://evidence.example.test/run.png#raw',
    '../outside/run.png',
    '/absolute/run.png',
    'evidence\\run.png',
  ])('rejects unsafe sanitized evidence link %s', (link) => {
    expect(() => createLabEvidenceRun(validRun({ sanitizedEvidenceLinks: [link] }))).toThrow(
      'Sanitized evidence link is unsafe.',
    );
  });

  it('applies the safe-link policy to the audit snapshot reference', () => {
    expect(() =>
      createLabEvidenceRun(
        validRun({
          auditSnapshot: {
            reference: 'https://user@example.test/audit.json',
            date: '2026-08-18',
          },
        }),
      ),
    ).toThrow('Audit snapshot reference is unsafe.');

    expect(() =>
      createLabEvidenceRun(
        validRun({
          auditSnapshot: {
            reference: 'docs/wallets/audit.json',
            date: '2026-02-30',
          },
        }),
      ),
    ).toThrow('Audit snapshot date must be a canonical UTC date.');
  });

  it('accepts only bounded, unique KAN Jira follow-ups', () => {
    expect(() => createLabEvidenceRun(validRun({ jiraFollowUps: ['SEC-12'] }))).toThrow(
      'Jira follow-up must be a KAN issue key.',
    );
    expect(() => createLabEvidenceRun(validRun({ jiraFollowUps: ['KAN-0'] }))).toThrow(
      'Jira follow-up must be a KAN issue key.',
    );
    expect(() => createLabEvidenceRun(validRun({ jiraFollowUps: ['KAN-225', 'KAN-225'] }))).toThrow(
      'Jira follow-ups must be unique.',
    );
    expect(() =>
      createLabEvidenceRun(
        validRun({ jiraFollowUps: Array.from({ length: 26 }, (_, index) => `KAN-${index + 1}`) }),
      ),
    ).toThrow('Evidence is limited to 25 Jira follow-ups.');
  });

  it('restores current raw events and v2/v3 exports through validation', () => {
    const event = validEvent();
    expect(restoreLabEvidenceEvents(JSON.stringify([event]))).toEqual([event]);
    expect(restoreLabEvidenceEvents(exportLabEvidence([event]))).toEqual([event]);

    const input = validRun();
    const serializedRun = exportLabEvidenceRun(input);
    const restoredRun = restoreLabEvidenceRun(serializedRun);

    expect(restoredRun).toEqual(createLabEvidenceRun(input));
    expect(restoreLabEvidenceEvents(serializedRun)).toEqual(input.events);
    expect(Object.isFrozen(restoredRun)).toBe(true);
    expect(Object.isFrozen(restoredRun.events)).toBe(true);
  });

  it('exports and restores only candidate-and-lock-bound session evidence', () => {
    const firstEvent = validEvent();
    const serialized = exportLabEvidenceSession({ ...candidateBinding, events: [firstEvent] });
    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      schemaVersion: 3,
      classification: 'candidate-bound-sanitized-testnet-wallet-session-evidence',
      ...candidateBinding,
      events: [firstEvent],
    });
    expect(restoreLabEvidenceSession(serialized, candidateBinding)).toEqual([firstEvent]);
    expect(() =>
      restoreLabEvidenceSession(serialized, {
        ...candidateBinding,
        candidateCommit: '1123456789abcdef0123456789abcdef01234567',
      }),
    ).toThrow('Stored evidence candidate or lock binding does not match.');
    expect(() =>
      restoreLabEvidenceSession(serialized, {
        ...candidateBinding,
        lockSha256: 'E723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9',
      }),
    ).toThrow('Stored evidence candidate or lock binding does not match.');
    expect(() =>
      restoreLabEvidenceSession(exportLabEvidence([firstEvent]), candidateBinding),
    ).toThrow('Serialized evidence contains unknown or missing fields.');
  });

  it('validates bound session event identity, uniqueness, and order', () => {
    const firstEvent = validEvent();
    const laterEvent = validEvent({
      eventId: eventId(81),
      occurredAt: '2026-08-18T12:02:00.000Z',
    });

    expect(() => exportLabEvidenceSession({ ...candidateBinding, events: [] })).toThrow(
      'Bound session evidence requires 1-250 events.',
    );
    expect(() =>
      exportLabEvidenceSession({ ...candidateBinding, events: [firstEvent, firstEvent] }),
    ).toThrow('Bound session evidence event IDs must be unique.');
    expect(() =>
      exportLabEvidenceSession({ ...candidateBinding, events: [laterEvent, firstEvent] }),
    ).toThrow('Bound session evidence events must be ordered by timestamp.');

    const invalidLegacy = { ...legacyEvent(), eventId: 'evt_legacy' };
    expect(() => restoreLabEvidenceEvents(JSON.stringify([invalidLegacy]))).toThrow(
      'Evidence event ID is invalid.',
    );
  });

  it('upgrades legacy v1 events, v1 envelopes, and v2 runs to current schemas', () => {
    const upgradedEvent = validEvent();
    expect(restoreLabEvidenceEvents(JSON.stringify([legacyEvent()]))).toEqual([upgradedEvent]);
    expect(restoreLabEvidenceEvents(JSON.stringify(legacyV1Envelope()))).toEqual([upgradedEvent]);

    const upgradedRun = restoreLabEvidenceRun(JSON.stringify(legacyV2Run()));
    expect(upgradedRun).toMatchObject({
      schemaVersion: 3,
      connections: [
        {
          connectionId: 'conn_walletconnect',
          connectorId: 'walletconnect',
          wallet: { name: 'Rainbow', version: '2.4.1' },
          networks: ['eip155:11155111'],
        },
      ],
      events: [upgradedEvent],
    });
    expect(restoreLabEvidenceEvents(JSON.stringify(legacyV2Run()))).toEqual([upgradedEvent]);
  });

  it('rejects ambiguous multi-connector legacy v2 runs instead of copying one wallet identity', () => {
    const ambiguousRun = legacyV2Run();
    ambiguousRun.events.push({
      ...legacyEvent(),
      eventId: eventId(40),
      connectorId: 'metamask',
    });

    expect(() => restoreLabEvidenceRun(JSON.stringify(ambiguousRun))).toThrow(
      'Legacy v2 run has ambiguous multi-connector attribution.',
    );
  });

  it('rejects ambiguous legacy v2 network attribution and preserves unsupported observations', () => {
    const wrongNetworkRun = legacyV2Run();
    wrongNetworkRun.events[0] = {
      ...legacyEvent(),
      chainId: 'eip155:84532',
    };
    expect(() => restoreLabEvidenceRun(JSON.stringify(wrongNetworkRun))).toThrow(
      'Legacy v2 run has ambiguous network attribution.',
    );

    const multiNetworkRun = legacyV2Run();
    multiNetworkRun.events.push({
      ...legacyEvent(),
      eventId: eventId(82),
      occurredAt: '2026-08-18T12:02:00.000Z',
      chainId: 'eip155:84532',
      kind: 'chain-change',
    });
    expect(() => restoreLabEvidenceRun(JSON.stringify(multiNetworkRun))).toThrow(
      'Legacy v2 run has ambiguous network attribution.',
    );

    const unsupportedRun = legacyV2Run();
    unsupportedRun.events[0] = {
      ...legacyEvent(),
      chainId: 'evm:unsupported',
      kind: 'chain-change',
      outcome: 'blocked',
    };
    expect(restoreLabEvidenceRun(JSON.stringify(unsupportedRun)).connections[0]?.networks).toEqual(
      [],
    );
  });

  it('rejects malformed or non-allowlisted serialized evidence instead of restoring it', () => {
    expect(() => restoreLabEvidenceEvents('{not json')).toThrow(
      'Serialized evidence is not valid JSON.',
    );

    const eventWithSecret = { ...validEvent(), address: '0xsecret' };
    expect(() => restoreLabEvidenceEvents(JSON.stringify([eventWithSecret]))).toThrow(
      'Serialized evidence contains unknown or missing fields.',
    );

    const runWithNotes = {
      ...(JSON.parse(exportLabEvidenceRun(validRun())) as Record<string, unknown>),
      notes: 'arbitrary free text',
    };
    expect(() => restoreLabEvidenceRun(JSON.stringify(runWithNotes))).toThrow(
      'Serialized evidence contains unknown or missing fields.',
    );

    const wronglyAttributedRun = JSON.parse(exportLabEvidenceRun(validRun())) as {
      events: Array<Record<string, unknown>>;
    };
    if (wronglyAttributedRun.events[0]) {
      wronglyAttributedRun.events[0].connectorId = 'metamask';
    }
    expect(() => restoreLabEvidenceRun(JSON.stringify(wronglyAttributedRun))).toThrow(
      'Evidence connection ID does not match its connector.',
    );
  });
});
