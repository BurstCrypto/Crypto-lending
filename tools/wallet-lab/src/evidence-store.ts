import {
  exportLabEvidenceSession,
  restoreLabEvidenceSession,
  type LabEvidenceCandidateBinding,
  type LabEvidenceEvent,
} from './evidence';

export const LAB_EVIDENCE_SESSION_KEY = 'crypto-lending.wallet-lab.sanitized-evidence.v3';
const LEGACY_LAB_EVIDENCE_SESSION_KEYS = [
  'crypto-lending.wallet-lab.sanitized-evidence.v1',
  'crypto-lending.wallet-lab.sanitized-evidence.v2',
] as const;

type EvidenceSessionStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

function discardUnboundLegacyEvidence(storage: EvidenceSessionStorage): void {
  for (const key of LEGACY_LAB_EVIDENCE_SESSION_KEYS) {
    storage.removeItem(key);
  }
}

/**
 * Restores only evidence bound to the exact candidate and package lock under
 * test. Unbound legacy envelopes and mismatched candidate data are discarded.
 */
export function loadLabEvidenceSession(
  storage: EvidenceSessionStorage,
  binding: LabEvidenceCandidateBinding,
): readonly LabEvidenceEvent[] {
  discardUnboundLegacyEvidence(storage);
  const serialized = storage.getItem(LAB_EVIDENCE_SESSION_KEY);
  if (serialized === null) return Object.freeze([]);

  try {
    return restoreLabEvidenceSession(serialized, binding);
  } catch {
    storage.removeItem(LAB_EVIDENCE_SESSION_KEY);
    return Object.freeze([]);
  }
}

/** Stores sanitized, candidate-bound events for same-tab reload recovery. */
export function saveLabEvidenceSession(
  storage: EvidenceSessionStorage,
  binding: LabEvidenceCandidateBinding,
  events: readonly LabEvidenceEvent[],
): void {
  discardUnboundLegacyEvidence(storage);
  if (events.length === 0) {
    storage.removeItem(LAB_EVIDENCE_SESSION_KEY);
    return;
  }

  storage.setItem(LAB_EVIDENCE_SESSION_KEY, exportLabEvidenceSession({ ...binding, events }));
}

export function clearLabEvidenceSession(storage: EvidenceSessionStorage): void {
  storage.removeItem(LAB_EVIDENCE_SESSION_KEY);
  discardUnboundLegacyEvidence(storage);
}
