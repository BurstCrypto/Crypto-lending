import { Inject, Injectable } from '@nestjs/common';

import { INFRASTRUCTURE_CONFIG } from '../config/infrastructure-config.module';
import type { InfrastructureConfig } from '../config/infrastructure.config';
import { SqsService } from './sqs.service';
import type { JobEnvelope, JobProcessingResult } from './sqs.types';

export type JobHandler<Payload = unknown> = (job: JobEnvelope<Payload>) => Promise<void>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Job handler failed';
}

@Injectable()
export class SqsJobWorker {
  constructor(
    private readonly sqs: SqsService,
    @Inject(INFRASTRUCTURE_CONFIG)
    private readonly config: InfrastructureConfig,
  ) {}

  /**
   * Processes at most one message. Failed messages are never deleted: SQS's
   * redrive policy moves them to the DLQ after maxReceiveCount deliveries.
   */
  async processOne<Payload>(handler: JobHandler<Payload>): Promise<JobProcessingResult> {
    const [message] = await this.sqs.receive();
    if (!message) {
      return { status: 'idle' };
    }

    let job: JobEnvelope<Payload> | undefined;
    try {
      job = this.sqs.parseEnvelope<Payload>(message.body);
      await handler(job);
      await this.sqs.delete(message);
      return { status: 'completed', messageId: message.messageId, jobId: job.id };
    } catch (error) {
      const exhausted = message.receiveCount >= this.config.sqs.maxReceiveCount;
      const retryDelaySeconds = exhausted
        ? 0
        : Math.min(
            this.config.sqs.retryBaseDelaySeconds * 2 ** (message.receiveCount - 1),
            this.config.sqs.retryMaxDelaySeconds,
          );

      await this.sqs.changeVisibility(message, retryDelaySeconds);
      return {
        status: exhausted ? 'awaiting-dead-letter' : 'retry-scheduled',
        messageId: message.messageId,
        ...(job ? { jobId: job.id } : {}),
        receiveCount: message.receiveCount,
        retryDelaySeconds,
        error: errorMessage(error),
      };
    }
  }
}
