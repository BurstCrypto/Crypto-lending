import { exportLabEvidence, restoreLabEvidenceEvents, type LabEvidenceEvent } from './evidence';

export const LAB_EVIDENCE_SESSION_KEY = 'crypto-lending.wallet-lab.sanitized-evidence.v1';

type EvidenceSessionStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

/**
 * Restores only the lab's sanitized event envelope. Invalid or obsolete data is
 * removed fail-closed so it cannot be mixed into a new validation run.
 */
export function loadLabEvidenceSession(
  storage: EvidenceSessionStorage,
): readonly LabEvidenceEvent[] {
  const serialized = storage.getItem(LAB_EVIDENCE_SESSION_KEY);
  if (serialized === null) return Object.freeze([]);

  try {
    return restoreLabEvidenceEvents(serialized);
  } catch {
    storage.removeItem(LAB_EVIDENCE_SESSION_KEY);
    return Object.freeze([]);
  }
}

/** Stores sanitized events for same-tab reload recovery; no wallet payloads. */
export function saveLabEvidenceSession(
  storage: EvidenceSessionStorage,
  events: readonly LabEvidenceEvent[],
): void {
  if (events.length === 0) {
    storage.removeItem(LAB_EVIDENCE_SESSION_KEY);
    return;
  }

  storage.setItem(LAB_EVIDENCE_SESSION_KEY, exportLabEvidence(events));
}

export function clearLabEvidenceSession(storage: EvidenceSessionStorage): void {
  storage.removeItem(LAB_EVIDENCE_SESSION_KEY);
}
