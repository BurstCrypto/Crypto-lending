import type { AccountId } from '../../../accounts/domain/account-profile';
import type { FeeAwareAllocationRequest } from '../../domain/fee-aware-allocation';

export const FEE_AWARE_ALLOCATION_INPUT_READER = Symbol('FEE_AWARE_ALLOCATION_INPUT_READER');

/**
 * Server-owned inputs for one recommendation. The application service supplies
 * `evaluatedAt` from its trusted clock and fixes the canonical USD scale, so an
 * adapter cannot choose either policy input.
 */
export type FeeAwareAllocationInputs = Omit<FeeAwareAllocationRequest, 'evaluatedAt' | 'usdScale'>;

export interface ReadFeeAwareAllocationInputsRequest {
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly evaluatedAt: string;
}

/**
 * Composition boundary for approved portfolio, opportunity, risk, consent, and
 * route-quote adapters. Implementations must not forward caller-authored
 * financial values.
 */
export interface FeeAwareAllocationInputReader {
  read(request: ReadFeeAwareAllocationInputsRequest): Promise<FeeAwareAllocationInputs>;
}
