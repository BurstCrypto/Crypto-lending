import { installFatalProcessBoundary, LOG_EVENTS, StructuredLogger } from '../logging';
import { runRedisSessionRevocation } from './redis-session-revocation';

const logger = new StructuredLogger({ workload: 'worker' });
installFatalProcessBoundary(logger);

void runRedisSessionRevocation(process.argv.slice(2), process.env)
  .then((result) => {
    if (result.status === 'completed') {
      logger.emit(LOG_EVENTS.workerStopped, 'info', { outcome: 'success' });
    } else {
      logger.emit(LOG_EVENTS.workerStartFailed, 'error', {
        outcome: 'failure',
        errorCode:
          result.code === 'ARGUMENTS_INVALID' || result.code === 'CONFIGURATION_INVALID'
            ? 'CONFIGURATION_ERROR'
            : 'REDIS_ERROR',
      });
    }
    process.exitCode = result.exitCode;
  })
  .catch(() => {
    logger.emit(LOG_EVENTS.workerStartFailed, 'fatal', {
      outcome: 'failure',
      errorCode: 'REDIS_ERROR',
    });
    process.exitCode = 1;
  });
