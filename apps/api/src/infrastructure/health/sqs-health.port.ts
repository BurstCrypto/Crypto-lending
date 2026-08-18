export const SQS_HEALTH = Symbol('SQS_HEALTH');

export interface SqsHealthPort {
  healthCheck(): Promise<void>;
}
