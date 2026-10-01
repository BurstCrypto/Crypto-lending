/**
 * Wallet-only submission guard. The host must supply an atomic durable journal
 * (for example, its authenticated database-backed intent store). No in-memory
 * production fallback exists: it would lose duplicate protection on reload.
 */
export interface SourceSubmissionJournal {
  reserve(intentId: string, transactionFingerprint: string): Promise<boolean>;
  recordSubmission(intentId: string, transactionId: string): Promise<void>;
}

/**
 * persist-before-send: a thrown/rejected/ambiguous wallet or persistence result
 * keeps the intent reserved. Recovery polls the existing transaction; it never
 * submits a second source transaction or charges another source fee.
 * The submit callback must be supplied by browser wallet infrastructure.
 */
export async function submitSourceOnce(input: {
  intentId: string;
  transactionFingerprint: string;
  journal: SourceSubmissionJournal;
  assertReady: () => Promise<void>;
  submitFromUserWallet: () => Promise<string>;
}): Promise<string> {
  if (
    !/^0x[0-9a-f]{64}$/u.test(input.intentId) ||
    !/^[0-9a-f]{64}$/u.test(input.transactionFingerprint)
  ) {
    throw new Error('INVALID_SUBMISSION_IDENTITY');
  }
  await input.assertReady();
  if (!(await input.journal.reserve(input.intentId, input.transactionFingerprint)))
    throw new Error('SOURCE_ALREADY_RESERVED');
  await input.assertReady();
  const transactionId = await input.submitFromUserWallet();
  if (typeof transactionId !== 'string' || transactionId.length < 1 || transactionId.length > 192)
    throw new Error('AMBIGUOUS_SOURCE_SUBMISSION');
  await input.journal.recordSubmission(input.intentId, transactionId);
  return transactionId;
}

export type BridgeProgress =
  | 'SOURCE_PENDING'
  | 'SOURCE_FAILED'
  | 'AWAITING_ATTESTATION'
  | 'READY_TO_MINT'
  | 'MINT_PENDING'
  | 'MINT_AND_SUPPLY_PENDING'
  | 'MINTED'
  | 'SUPPLY_PENDING'
  | 'LENT'
  | 'DESTINATION_RECOVERY';

/** External observations must be verified against the source intent before entering this state machine. */
export function advanceBridgeProgress(
  current: BridgeProgress,
  next: BridgeProgress,
): BridgeProgress {
  const transitions: Record<BridgeProgress, readonly BridgeProgress[]> = {
    SOURCE_PENDING: ['SOURCE_FAILED', 'AWAITING_ATTESTATION'],
    SOURCE_FAILED: [],
    AWAITING_ATTESTATION: ['READY_TO_MINT', 'DESTINATION_RECOVERY'],
    READY_TO_MINT: ['MINT_PENDING', 'MINT_AND_SUPPLY_PENDING', 'DESTINATION_RECOVERY'],
    MINT_PENDING: ['MINTED', 'DESTINATION_RECOVERY'],
    MINT_AND_SUPPLY_PENDING: ['LENT', 'DESTINATION_RECOVERY'],
    MINTED: ['SUPPLY_PENDING', 'DESTINATION_RECOVERY'],
    SUPPLY_PENDING: ['LENT', 'DESTINATION_RECOVERY'],
    LENT: [],
    // Recovery can resume only destination work with separately verified current state.
    DESTINATION_RECOVERY: ['READY_TO_MINT', 'MINTED'],
  };
  if (!transitions[current]?.includes(next)) throw new Error('INVALID_BRIDGE_PROGRESS_TRANSITION');
  return next;
}
