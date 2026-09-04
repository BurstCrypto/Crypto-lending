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
const INPUT_KEYS = Object.freeze([
  'holdingPeriodDays',
  'maximumQuoteAgeSeconds',
  'maximumOpportunityAgeSeconds',
  'minimumNetBenefitUsdMantissa',
  'crossChainPolicy',
  'exposurePolicy',
  'positions',
  'opportunities',
  'candidates',
] as const);

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

function dataFields(
  value: unknown,
  requiredKeys: readonly string[],
  exact: boolean,
): Readonly<Record<string, unknown>> | null {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const keys = Reflect.ownKeys(descriptors);
    if (
      (exact && keys.length !== requiredKeys.length) ||
      (exact && keys.some((key) => typeof key !== 'string' || !requiredKeys.includes(key)))
    ) {
      return null;
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of requiredKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

function trustedClockTime(clock: SmartLendingRecommendationClock): string {
  try {
    const now = clock.now();
    if (typeof now !== 'object' || now === null || Object.getPrototypeOf(now) !== Date.prototype) {
      return unavailable();
    }
    const milliseconds = Date.prototype.getTime.call(now);
    if (!Number.isFinite(milliseconds)) return unavailable();
    return Date.prototype.toISOString.call(now);
  } catch {
    return unavailable();
  }
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
    let correlationId: string;
    let evaluatedAt: string;
    try {
      const requestFields = dataFields(request, ['accountId', 'correlationId'], false);
      if (requestFields === null) return unavailable();
      accountId = parseAccountId(requestFields.accountId);
      if (
        typeof requestFields.correlationId !== 'string' ||
        !CORRELATION_ID.test(requestFields.correlationId)
      ) {
        return unavailable();
      }
      correlationId = requestFields.correlationId;
      evaluatedAt = trustedClockTime(this.clock);
    } catch {
      return unavailable();
    }

    try {
      const input = dataFields(
        await this.inputs.read({
          accountId,
          correlationId,
          evaluatedAt,
        }),
        INPUT_KEYS,
        true,
      );
      if (input === null) return unavailable();
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
