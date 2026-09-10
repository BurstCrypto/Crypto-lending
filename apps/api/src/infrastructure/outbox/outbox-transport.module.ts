import { PostgresOutboxTransportModule } from './postgres-outbox-transport.module';
import { SqsModule } from '../sqs/sqs.module';
import { isRailwayDeployment } from '../config/infrastructure.config';

export function outboxTransportModule(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): typeof SqsModule | typeof PostgresOutboxTransportModule {
  return isRailwayDeployment(environment) ? PostgresOutboxTransportModule : SqsModule;
}

export const OutboxTransportModule = outboxTransportModule();
