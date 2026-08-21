import type { JobCorrelationContext, JobEnvelope } from './job-envelope';

export const JOB_PUBLISHER = Symbol('JOB_PUBLISHER');

export type JobDestination = 'jobs';

export interface LedgerOutboxLink {
  readonly commandId: string;
  readonly journalId: string;
}

export interface EnqueueJobRequest<Payload> {
  kind: string;
  payload: Payload;
  id?: string;
  version?: number;
  occurredAt?: string;
  correlation?: JobCorrelationContext;
  destination?: JobDestination;
  messageAttributes?: Readonly<Record<string, string>>;
  ledgerLink?: LedgerOutboxLink;
}

/**
 * Domain-facing publisher port. Enqueue must run inside an active database
 * transaction; network publication is deliberately deferred to the dispatcher.
 */
export interface JobPublisherPort {
  enqueue<Payload>(request: EnqueueJobRequest<Payload>): Promise<JobEnvelope<Payload>>;
}
