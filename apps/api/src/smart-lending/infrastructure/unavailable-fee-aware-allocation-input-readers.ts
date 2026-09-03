import { Injectable } from '@nestjs/common';

import { FeeAwareAllocationInputUnavailableError } from '../application/composed-fee-aware-allocation-input.reader';
import type {
  ApprovedLendingOpportunitySnapshot,
  ApprovedLendingOpportunitySnapshotReader,
  ReadApprovedLendingOpportunitySnapshotRequest,
} from '../application/ports/approved-lending-opportunity-snapshot-reader.port';
import type {
  ApprovedSmartLendingPolicyReader,
  ApprovedSmartLendingPolicySnapshot,
  ReadApprovedSmartLendingPolicyRequest,
} from '../application/ports/approved-smart-lending-policy-reader.port';
import type {
  FullLifecycleCostQuoteReader,
  FullLifecycleCostQuoteResult,
  ReadFullLifecycleCostQuoteRequest,
} from '../application/ports/full-lifecycle-cost-quote-reader.port';
import type {
  ReadRoutableCapitalPositionSnapshotRequest,
  RoutableCapitalPositionSnapshot,
  RoutableCapitalPositionSnapshotReader,
} from '../application/ports/routable-capital-position-snapshot-reader.port';

function unavailable<Result>(): Promise<Result> {
  return Promise.reject(new FeeAwareAllocationInputUnavailableError());
}

@Injectable()
export class UnavailableRoutableCapitalPositionSnapshotReader implements RoutableCapitalPositionSnapshotReader {
  readRoutableCapitalPositions(
    request: ReadRoutableCapitalPositionSnapshotRequest,
  ): Promise<RoutableCapitalPositionSnapshot> {
    void request;
    return unavailable();
  }
}

@Injectable()
export class UnavailableApprovedLendingOpportunitySnapshotReader implements ApprovedLendingOpportunitySnapshotReader {
  readApprovedLendingOpportunities(
    request: ReadApprovedLendingOpportunitySnapshotRequest,
  ): Promise<ApprovedLendingOpportunitySnapshot> {
    void request;
    return unavailable();
  }
}

@Injectable()
export class UnavailableApprovedSmartLendingPolicyReader implements ApprovedSmartLendingPolicyReader {
  readApprovedSmartLendingPolicy(
    request: ReadApprovedSmartLendingPolicyRequest,
  ): Promise<ApprovedSmartLendingPolicySnapshot> {
    void request;
    return unavailable();
  }
}

@Injectable()
export class UnavailableFullLifecycleCostQuoteReader implements FullLifecycleCostQuoteReader {
  readFullLifecycleCostQuote(
    request: ReadFullLifecycleCostQuoteRequest,
  ): Promise<FullLifecycleCostQuoteResult> {
    void request;
    return unavailable();
  }
}
