import { describe, expect, it } from 'vitest';

import {
  createLabEvidenceEvent,
  createLabEvidenceRun,
  exportLabEvidence,
  exportLabEvidenceRun,
  restoreLabEvidenceEvents,
  restoreLabEvidenceRun,
} from '../src/evidence';
import type {
  LabConnectorId,
  LabEnvironmentId,
  LabEventKind,
  LabEvidenceRunInput,
  LabRunResult,
} from '../src/evidence';

type EventInput = Parameters<typeof createLabEvidenceEvent>[0];

const startedAt = '2026-08-18T12:00:00.000Z';
const completedAt = '2026-08-18T12:10:00.000Z';

function validEvent(overrides: Partial<EventInput> = {}) {
  return createLabEvidenceEvent({
    eventId: 'evt_123',
    occurredAt: '2026-08-18T12:01:00.000Z',
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
    wallet: { name: 'Example Wallet', version: '2.4.1' },
    network: 'eip155:11155111',
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

describe('wallet lab evidence', () => {
  it('exports only the sanitized v1 allowlisted shape', () => {
    const event = validEvent();
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

  it('rejects identifiers and chains outside the v1 allowlist', () => {
    expect(() => validEvent({ eventId: 'contains spaces' })).toThrow(
      'Evidence event ID is invalid.',
    );
    expect(() => validEvent({ chainId: 'eip155:1' as EventInput['chainId'] })).toThrow(
      'Evidence connector or chain is not allowlisted.',
    );
  });

  it('records policy-blocked unapproved providers without treating generic injected as approved', () => {
    expect(
      validEvent({
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

    for (const kind of additionalKinds) {
      expect(validEvent({ eventId: `evt_${kind}`, kind }).kind).toBe(kind);
    }
    expect(() => validEvent({ kind: 'debug-log' as LabEventKind })).toThrow(
      'Evidence kind or outcome is not allowlisted.',
    );
  });

  it('rejects non-boolean account flags at the runtime boundary', () => {
    expect(() => validEvent({ accountObserved: 'true' as unknown as boolean })).toThrow(
      'Evidence account-observed flag must be boolean.',
    );
  });

  it('exports a complete validated v2 run envelope', () => {
    const secondEvent = validEvent({
      eventId: 'evt_disconnect',
      occurredAt: '2026-08-18T12:09:00.000Z',
      kind: 'disconnect',
      outcome: 'cleared',
      accountObserved: false,
    });
    const exported = exportLabEvidenceRun(validRun({ events: [validEvent(), secondEvent] }));
    const parsed = JSON.parse(exported) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      schemaVersion: 2,
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
      wallet: { name: 'Example Wallet', version: '2.4.1' },
      network: 'eip155:11155111',
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
    expect(exported).not.toMatch(/pairingUri|sessionTopic|providerError|privateKey/i);
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
            validEvent({ eventId: 'evt_later', occurredAt: '2026-08-18T12:09:00.000Z' }),
            validEvent({ eventId: 'evt_earlier', occurredAt: '2026-08-18T12:02:00.000Z' }),
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

  it('restores raw events, v1 exports, and complete v2 run exports through validation', () => {
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
  });
});
