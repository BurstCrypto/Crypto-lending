/** Shared arithmetic for production recommendations and wallet-reviewed route comparisons.
 * This module supplies no market eligibility, risk approval, or transaction authority.
 * All USD values are bigint mantissas at scale 18.
 */
export interface FeeAwareAllocationCostsUsdMantissa {
  readonly entrySourceNetwork: bigint;
  readonly entrySourceSwap: bigint;
  readonly entryBridge: bigint;
  readonly entryDestinationNetwork: bigint;
  readonly entryDestinationSwap: bigint;
  readonly providerEntry: bigint;
  readonly providerExit: bigint;
  readonly exitDestinationNetwork: bigint;
  readonly exitDestinationSwap: bigint;
  readonly exitBridge: bigint;
  readonly exitSourceNetwork: bigint;
  readonly platformRouting: bigint;
  readonly exitPlatformRouting?: bigint;
  readonly riskBuffer: bigint;
}

export interface FeeAwareCandidateCalculation {
  readonly grossApyBasisPoints: bigint;
  readonly recurringFeeBasisPoints: bigint;
  readonly riskPenaltyBasisPoints: bigint;
  readonly conservativeApyBasisPoints: bigint;
  readonly principalUsdMantissa: bigint;
  readonly deployedPrincipalUsdMantissa: bigint;
  readonly entryCostUsdMantissa: bigint;
  readonly anticipatedExitCostUsdMantissa: bigint;
  readonly totalLifecycleCostUsdMantissa: bigint;
  readonly costsUsdMantissa: FeeAwareAllocationCostsUsdMantissa;
  readonly projectedGrossYieldUsdMantissa: bigint;
  readonly projectedConservativeYieldUsdMantissa: bigint;
  readonly netBenefitUsdMantissa: bigint;
  readonly breakEvenDays: bigint | null;
  readonly improvementOverSameChainUsdMantissa: bigint | null;
}

type ReturnReason = 'NUMERIC_LIMIT_EXCEEDED' | 'TOTAL_COST_EXCEEDS_PRINCIPAL' |
  'NON_POSITIVE_NET_BENEFIT' | 'MINIMUM_NET_BENEFIT_NOT_MET';
const MAX = (1n << 256n) - 1n;

export function calculateFeeAwareReturn(input: {
  principalUsdMantissa: bigint;
  grossApyBasisPoints: bigint;
  recurringFeeBasisPoints: bigint;
  riskPenaltyBasisPoints: bigint;
  holdingPeriodDays: bigint;
  minimumNetBenefitUsdMantissa: bigint;
  costs: FeeAwareAllocationCostsUsdMantissa;
}): { calculation: FeeAwareCandidateCalculation | null; reasons: ReturnReason[] } {
  const { principalUsdMantissa: principal, grossApyBasisPoints: gross,
    recurringFeeBasisPoints: recurring, riskPenaltyBasisPoints: penalty,
    holdingPeriodDays: days, costs } = input;
  const reasons: ReturnReason[] = [];
  const values = [principal, gross, recurring, penalty, days, input.minimumNetBenefitUsdMantissa, ...Object.values(costs)];
  if (values.some((v) => typeof v !== 'bigint' || v < 0n || v > MAX)) {
    return { calculation: null, reasons: ['NUMERIC_LIMIT_EXCEEDED'] };
  }
  const entry = costs.entrySourceNetwork + costs.entrySourceSwap + costs.entryBridge +
    costs.entryDestinationNetwork + costs.entryDestinationSwap + costs.providerEntry + costs.platformRouting + costs.riskBuffer;
  const exit = costs.providerExit + costs.exitDestinationNetwork + costs.exitDestinationSwap + costs.exitBridge + costs.exitSourceNetwork + (costs.exitPlatformRouting ?? 0n);
  const total = entry + exit;
  if (total > MAX) return { calculation: null, reasons: ['NUMERIC_LIMIT_EXCEEDED'] };
  if (total >= principal) reasons.push('TOTAL_COST_EXCEEDS_PRINCIPAL');
  const deployed = entry < principal ? principal - entry : 0n;
  const conservative = gross > recurring + penalty ? gross - recurring - penalty : 0n;
  const grossYield = deployed * gross * days / (10_000n * 365n);
  const yieldAfterDeductions = deployed * conservative * days / (10_000n * 365n);
  if (grossYield > MAX || yieldAfterDeductions > MAX) return { calculation: null, reasons: ['NUMERIC_LIMIT_EXCEEDED'] };
  const net = yieldAfterDeductions - total;
  if (net <= 0n) reasons.push('NON_POSITIVE_NET_BENEFIT');
  if (net < input.minimumNetBenefitUsdMantissa) reasons.push('MINIMUM_NET_BENEFIT_NOT_MET');
  const dailyNumerator = deployed * conservative;
  const breakEvenDays = total === 0n ? 0n : dailyNumerator === 0n ? null :
    (total * 10_000n * 365n + dailyNumerator - 1n) / dailyNumerator;
  return { reasons, calculation: Object.freeze({
    grossApyBasisPoints: gross, recurringFeeBasisPoints: recurring, riskPenaltyBasisPoints: penalty,
    conservativeApyBasisPoints: conservative, principalUsdMantissa: principal,
    deployedPrincipalUsdMantissa: deployed, entryCostUsdMantissa: entry,
    anticipatedExitCostUsdMantissa: exit, totalLifecycleCostUsdMantissa: total,
    costsUsdMantissa: Object.freeze({ ...costs }), projectedGrossYieldUsdMantissa: grossYield,
    projectedConservativeYieldUsdMantissa: yieldAfterDeductions, netBenefitUsdMantissa: net,
    breakEvenDays, improvementOverSameChainUsdMantissa: null,
  }) };
}

export function compareFeeAwareReturns(
  left: { id: string; routeKind: 'SAME_CHAIN' | 'CROSS_CHAIN'; calculation: FeeAwareCandidateCalculation | null },
  right: { id: string; routeKind: 'SAME_CHAIN' | 'CROSS_CHAIN'; calculation: FeeAwareCandidateCalculation | null },
): number {
  const a = left.calculation, b = right.calculation;
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  if (a.netBenefitUsdMantissa !== b.netBenefitUsdMantissa) return a.netBenefitUsdMantissa > b.netBenefitUsdMantissa ? -1 : 1;
  if (left.routeKind !== right.routeKind) return left.routeKind === 'SAME_CHAIN' ? -1 : 1;
  if (a.totalLifecycleCostUsdMantissa !== b.totalLifecycleCostUsdMantissa) return a.totalLifecycleCostUsdMantissa < b.totalLifecycleCostUsdMantissa ? -1 : 1;
  return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
}
