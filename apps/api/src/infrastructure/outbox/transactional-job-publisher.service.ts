import { Injectable } from '@nestjs/common';

import { createJobEnvelope, type JobEnvelope } from './job-envelope';
import { JobOutboxRepository } from './job-outbox.repository';
import type { EnqueueJobRequest, JobPublisherPort } from './job-publisher.port';

@Injectable()
export class TransactionalJobPublisher implements JobPublisherPort {
  constructor(private readonly repository: JobOutboxRepository) {}

  async enqueue<Payload>(request: EnqueueJobRequest<Payload>): Promise<JobEnvelope<Payload>> {
    const ledgerLinkDescriptor = Object.getOwnPropertyDescriptor(request, 'ledgerLink');
    if (ledgerLinkDescriptor && !('value' in ledgerLinkDescriptor)) {
      throw new Error('Invalid ledger outbox link');
    }
    const ledgerLink =
      ledgerLinkDescriptor && 'value' in ledgerLinkDescriptor
        ? ledgerLinkDescriptor.value
        : undefined;
    const envelope = createJobEnvelope(request.kind, request.payload, {
      ...(request.id ? { id: request.id } : {}),
      ...(request.version === undefined ? {} : { version: request.version }),
      ...(request.occurredAt ? { occurredAt: request.occurredAt } : {}),
      ...(request.correlation === undefined ? {} : { correlation: request.correlation }),
    });

    await this.repository.insert({
      destination: request.destination ?? 'jobs',
      envelope,
      messageAttributes: request.messageAttributes ?? {},
      ...(ledgerLink === undefined ? {} : { ledgerLink }),
    });
    return envelope;
  }
}
