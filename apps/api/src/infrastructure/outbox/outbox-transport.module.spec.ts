import { PostgresOutboxTransportModule } from './postgres-outbox-transport.module';
import { outboxTransportModule } from './outbox-transport.module';
import { SqsModule } from '../sqs/sqs.module';

describe('outboxTransportModule', () => {
  it('uses the durable PostgreSQL transport only for the exact Railway target', () => {
    expect(outboxTransportModule({ DEPLOYMENT_TARGET: 'railway' })).toBe(
      PostgresOutboxTransportModule,
    );
    expect(outboxTransportModule({})).toBe(SqsModule);
    expect(() => outboxTransportModule({ DEPLOYMENT_TARGET: 'Railway' })).toThrow(
      'DEPLOYMENT_TARGET must be exactly railway',
    );
  });
});
