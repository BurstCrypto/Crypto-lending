/** USDC atomic units, rounded half to even, matching the bridge fee policy. */
export const SAME_CHAIN_LENDING_FEE_BPS = 10;
export const BRIDGE_LENDING_FEE_BPS = 20;
export function lendingRoutingFee(principal: bigint, basisPoints = SAME_CHAIN_LENDING_FEE_BPS): bigint {
  if (principal < 0n || !Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) throw new Error('Invalid routing fee input.');
  const numerator = principal * BigInt(basisPoints), whole = numerator / 10_000n, remainder = numerator % 10_000n;
  return whole + (remainder > 5_000n || remainder === 5_000n && whole % 2n === 1n ? 1n : 0n);
}
