import { installFatalProcessBoundary } from '../../infrastructure/logging/fatal-process-boundary';
import { LOG_EVENTS, StructuredLogger } from '../../infrastructure/logging/structured-logger';
import { runBalanceSyncConsumerCli } from './balance-sync-consumer.cli-mode';

const logger = new StructuredLogger({ workload: 'balance-consumer' });
installFatalProcessBoundary(logger);

void runBalanceSyncConsumerCli(process.argv.slice(2), process.env)
  .then((result) => {
    if (result.status === 'ready') {
      logger.emit(LOG_EVENTS.workerStopped, 'info', { outcome: 'success' });
    } else {
      logger.emit(LOG_EVENTS.workerStartFailed, 'fatal', {
        outcome: 'failure',
        errorCode: 'BALANCE_CONSUMER_STARTUP_REFUSED',
      });
    }
    process.exitCode = result.exitCode;
  })
  .catch(() => {
    logger.emit(LOG_EVENTS.workerStartFailed, 'fatal', {
      outcome: 'failure',
      errorCode: 'BALANCE_CONSUMER_STARTUP_REFUSED',
    });
    process.exitCode = 1;
  });
