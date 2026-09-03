import { Inject, Injectable } from '@nestjs/common';

import { parseAccountId, type AccountId } from '../../accounts/domain/account-profile';
import {
  FEE_AWARE_ALLOCATION_USD_SCALE,
  recommendFeeAwareAllocation,
  type FeeAwareAllocationRecommendation,
} from '../domain/fee-aware-allocation';
import {
  FEE_AWARE_ALLOCATION_INPUT_READER,
  type FeeAwareAllocationInputReader,
} from './ports/fee-aware-allocation-input.port';

const CORRELATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const SMART_LENDING_RECOMMENDATION_CLOCK = Symbol('SMART_LENDING_RECOMMENDATION_CLOCK');

export interface SmartLendingRecommendationClock {
  now(): Date;
}

export const SYSTEM_SMART_LENDING_RECOMMENDATION_CLOCK: SmartLendingRecommendationClock =
  Object.freeze({ now: (): Date => new Date() });

export interface ReadSmartLendingRecommendationRequest {
  readonly accountId: AccountId;
  readonly correlationId: string;
}

export class SmartLendingRecommendationUnavailableError extends Error {
  readonly code = 'SMART_LENDING_RECOMMENDATION_UNAVAILABLE' as const;

  constructor() {
    super('Smart lending recommendation is unavailable');
    this.name = 'SmartLendingRecommendationUnavailableError';
  }
}

function unavailable(): never {
  throw new SmartLendingRecommendationUnavailableError();
}

/**
 * Trusted application seam for the pure allocation policy. Its public request
 * contains only account and correlation identity; portfolio values, policy,
 * consent, opportunities, and quotes all come from the server-owned reader.
 */
@Injectable()
export class SmartLendingRecommendationService {
  constructor(
    @Inject(FEE_AWARE_ALLOCATION_INPUT_READER)
    private readonly inputs: FeeAwareAllocationInputReader,
    @Inject(SMART_LENDING_RECOMMENDATION_CLOCK)
    private readonly clock: SmartLendingRecommendationClock,
  ) {}

  async read(
    request: ReadSmartLendingRecommendationRequest,
  ): Promise<FeeAwareAllocationRecommendation> {
    let accountId: AccountId;
    let evaluatedAt: string;
    try {
      accountId = parseAccountId(request.accountId);
      if (!CORRELATION_ID.test(request.correlationId)) return unavailable();
      const now = this.clock.now();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return unavailable();
      evaluatedAt = now.toISOString();
    } catch {
      return unavailable();
    }

    try {
      const input = await this.inputs.read({
        accountId,
        correlationId: request.correlationId,
        evaluatedAt,
      });
      const recommendation = recommendFeeAwareAllocation({
        usdScale: FEE_AWARE_ALLOCATION_USD_SCALE,
        evaluatedAt,
        holdingPeriodDays: input.holdingPeriodDays,
        maximumQuoteAgeSeconds: input.maximumQuoteAgeSeconds,
        maximumOpportunityAgeSeconds: input.maximumOpportunityAgeSeconds,
        minimumNetBenefitUsdMantissa: input.minimumNetBenefitUsdMantissa,
        crossChainPolicy: input.crossChainPolicy,
        exposurePolicy: input.exposurePolicy,
        positions: input.positions,
        opportunities: input.opportunities,
        candidates: input.candidates,
      });
      if (recommendation.status === 'INVALID_INPUT') return unavailable();
      return recommendation;
    } catch (error) {
      if (error instanceof SmartLendingRecommendationUnavailableError) throw error;
      return unavailable();
    }
  }
}
