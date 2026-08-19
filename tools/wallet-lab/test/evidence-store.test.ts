import { describe, expect, it, vi } from 'vitest';

import {
  clearLabEvidenceSession,
  LAB_EVIDENCE_SESSION_KEY,
  loadLabEvidenceSession,
  saveLabEvidenceSession,
} from '../src/evidence-store';
import { createLabEvidenceEvent } from '../src/evidence';

function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
    removeItem: vi.fn(() => {
      value = null;
    }),
  };
}

const event = createLabEvidenceEvent({
  eventId: 'evt_session',
  occurredAt: '2026-08-19T16:00:00.000Z',
  connectorId: 'walletconnect',
  chainId: 'eip155:11155111',
  chainContext: 'observed',
  kind: 'connect',
  outcome: 'accepted',
  accountObserved: true,
});

describe('sanitized evidence session storage', () => {
  it('round-trips only validated event envelopes', () => {
    const candidate = storage();
    saveLabEvidenceSession(candidate, [event]);

    expect(candidate.setItem).toHaveBeenCalledWith(
      LAB_EVIDENCE_SESSION_KEY,
      expect.not.stringContaining('0x'),
    );
    expect(loadLabEvidenceSession(candidate)).toEqual([event]);
  });

  it('discards malformed or unexpected stored data', () => {
    const candidate = storage('{"address":"0xsecret"}');

    expect(loadLabEvidenceSession(candidate)).toEqual([]);
    expect(candidate.removeItem).toHaveBeenCalledWith(LAB_EVIDENCE_SESSION_KEY);
  });

  it('removes the dedicated key when a run is cleared', () => {
    const candidate = storage();
    clearLabEvidenceSession(candidate);
    saveLabEvidenceSession(candidate, []);

    expect(candidate.removeItem).toHaveBeenCalledTimes(2);
    expect(candidate.removeItem).toHaveBeenCalledWith(LAB_EVIDENCE_SESSION_KEY);
  });
});
