import { createSourceBridgePlan, ETHEREUM, SOLANA, type SourceBridgePlan } from './source-plan.ts';

export function serializeSourcePlan(plan: SourceBridgePlan): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(plan).map(([key, value]) => [
      key,
      typeof value === 'bigint' ? value.toString() : value,
    ]),
  );
}

/** Restore the original immutable intent for destination recovery, even after source expiry. */
export function restoreSourcePlan(
  saved: Record<string, string | number>,
  treasuries: { ethereum: string; solana: string },
): SourceBridgePlan {
  if (saved.sourceNetwork !== ETHEREUM && saved.sourceNetwork !== SOLANA)
    throw new Error('INVALID_STORED_NETWORK');
  if (saved.feeBps !== 20 && saved.feeBps !== 12 && saved.feeBps !== 8)
    throw new Error('INVALID_STORED_FEE');
  const integer = (key: string) => {
    const value = saved[key];
    if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,19})$/.test(value))
      throw new Error('INVALID_STORED_INTEGER');
    return BigInt(value);
  };
  const deadline = integer('deadline');
  const restored = createSourceBridgePlan({
    sourceNetwork: saved.sourceNetwork,
    sourceWallet: String(saved.sourceWallet),
    destinationWallet: String(saved.destinationWallet),
    principal: integer('principal'),
    maxBridgeFee: integer('maxBridgeFee'),
    minimumDestinationAmount: integer('minimumDestinationAmount'),
    treasuries,
    tier: saved.feeBps === 20 ? 'FREE' : saved.feeBps === 12 ? 'INDIVIDUAL' : 'PRO',
    nowSeconds: deadline - 300n,
    deadline,
    intentId: saved.intentId as `0x${string}`,
  });
  const roundtrip = serializeSourcePlan(restored);
  if (
    Object.keys(saved).length !== Object.keys(roundtrip).length ||
    Object.entries(roundtrip).some(([key, value]) => saved[key] !== value)
  )
    throw new Error('STORED_PLAN_MISMATCH');
  return restored;
}

/** Only Circle's nonce, executed-finality, fee, and expiration fields may differ after attestation. */
export function verifyEmittedCctpMessage(emitted: `0x${string}`, attested: `0x${string}`): void {
  if (!/^0x[0-9a-fA-F]{824}$/.test(emitted) || !/^0x[0-9a-fA-F]{824}$/.test(attested))
    throw new Error('INVALID_SOURCE_CCTP_MESSAGE');
  const original = Buffer.from(emitted.slice(2), 'hex');
  const complete = Buffer.from(attested.slice(2), 'hex');
  for (const [start, end] of [
    [0, 12],
    [44, 144],
    [148, 312],
    [376, 412],
  ]) {
    if (!original.subarray(start, end).equals(complete.subarray(start, end)))
      throw new Error('SOURCE_CCTP_MESSAGE_MISMATCH');
  }
}
