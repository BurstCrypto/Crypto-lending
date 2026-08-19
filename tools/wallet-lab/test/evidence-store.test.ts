import { describe, expect, it, vi } from 'vitest';

import {
  clearLabEvidenceSession,
  LAB_EVIDENCE_SESSION_KEY,
  loadLabEvidenceSession,
  saveLabEvidenceSession,
} from '../src/evidence-store';
import { createLabEvidenceEvent, exportLabEvidence } from '../src/evidence';

const LEGACY_V1_SESSION_KEY = 'crypto-lending.wallet-lab.sanitized-evidence.v1';
const LEGACY_V2_SESSION_KEY = 'crypto-lending.wallet-lab.sanitized-evidence.v2';
const binding = {
  candidateCommit: '0123456789abcdef0123456789abcdef01234567',
  lockSha256: 'D723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9',
} as const;

function storage(initial: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, next: string) => {
      values.set(key, next);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

const event = createLabEvidenceEvent({
  eventId: 'evt_00000000-0000-4000-8000-000000000001',
  occurredAt: '2026-08-19T16:00:00.000Z',
  connectionId: 'conn_walletconnect',
  connectorId: 'walletconnect',
  chainId: 'eip155:11155111',
  chainContext: 'observed',
  kind: 'connect',
  outcome: 'accepted',
  accountObserved: true,
});

function legacyV1Envelope() {
  return JSON.stringify({
    schemaVersion: 1,
    exportedAt: '2026-08-19T16:01:00.000Z',
    classification: 'sanitized-testnet-wallet-evidence',
    containsAddresses: false,
    containsSignatures: false,
    containsPairingData: false,
    containsWalletSecrets: false,
    events: [
      {
        schemaVersion: 1,
        eventId: 'evt_00000000-0000-4000-8000-000000000001',
        occurredAt: '2026-08-19T16:00:00.000Z',
        connectorId: 'walletconnect',
        chainId: 'eip155:11155111',
        chainContext: 'observed',
        kind: 'connect',
        outcome: 'accepted',
        accountObserved: true,
        evidenceMode: 'sanitized-real-wallet',
      },
    ],
  });
}

describe('candidate-bound evidence session storage', () => {
  it('round-trips only an envelope bound to the expected candidate and lock', () => {
    const candidate = storage();
    saveLabEvidenceSession(candidate, binding, [event]);

    expect(candidate.setItem).toHaveBeenCalledWith(
      LAB_EVIDENCE_SESSION_KEY,
      expect.stringContaining('candidate-bound-sanitized-testnet-wallet-session-evidence'),
    );
    const serialized = candidate.setItem.mock.calls[0]?.[1] ?? '';
    expect(serialized).toContain(binding.candidateCommit);
    expect(serialized).toContain(binding.lockSha256);
    expect(serialized).not.toContain('0x');
    expect(loadLabEvidenceSession(candidate, binding)).toEqual([event]);
  });

  it('fails closed and clears the current key on candidate or lock mismatch', () => {
    const candidateMismatch = storage();
    saveLabEvidenceSession(candidateMismatch, binding, [event]);
    expect(
      loadLabEvidenceSession(candidateMismatch, {
        ...binding,
        candidateCommit: '1123456789abcdef0123456789abcdef01234567',
      }),
    ).toEqual([]);
    expect(candidateMismatch.removeItem).toHaveBeenCalledWith(LAB_EVIDENCE_SESSION_KEY);

    const lockMismatch = storage();
    saveLabEvidenceSession(lockMismatch, binding, [event]);
    expect(
      loadLabEvidenceSession(lockMismatch, {
        ...binding,
        lockSha256: 'E723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9',
      }),
    ).toEqual([]);
    expect(lockMismatch.removeItem).toHaveBeenCalledWith(LAB_EVIDENCE_SESSION_KEY);
  });

  it('discards unbound v1 and v2 data instead of rebinding it to a candidate', () => {
    const candidate = storage({
      [LEGACY_V1_SESSION_KEY]: legacyV1Envelope(),
      [LEGACY_V2_SESSION_KEY]: exportLabEvidence([event]),
    });

    expect(loadLabEvidenceSession(candidate, binding)).toEqual([]);
    expect(candidate.removeItem).toHaveBeenCalledWith(LEGACY_V1_SESSION_KEY);
    expect(candidate.removeItem).toHaveBeenCalledWith(LEGACY_V2_SESSION_KEY);
    expect(candidate.setItem).not.toHaveBeenCalled();
  });

  it('discards malformed or unexpected bound data', () => {
    const candidate = storage({
      [LAB_EVIDENCE_SESSION_KEY]: '{"address":"0xsecret"}',
    });

    expect(loadLabEvidenceSession(candidate, binding)).toEqual([]);
    expect(candidate.removeItem).toHaveBeenCalledWith(LAB_EVIDENCE_SESSION_KEY);
  });

  it('removes bound and unbound keys when the run is emptied or cleared', () => {
    const candidate = storage({
      [LEGACY_V1_SESSION_KEY]: legacyV1Envelope(),
      [LEGACY_V2_SESSION_KEY]: exportLabEvidence([event]),
    });
    saveLabEvidenceSession(candidate, binding, []);
    clearLabEvidenceSession(candidate);

    expect(candidate.removeItem).toHaveBeenCalledWith(LAB_EVIDENCE_SESSION_KEY);
    expect(candidate.removeItem).toHaveBeenCalledWith(LEGACY_V1_SESSION_KEY);
    expect(candidate.removeItem).toHaveBeenCalledWith(LEGACY_V2_SESSION_KEY);
  });
});
