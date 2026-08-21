import { LOG_EVENTS, structuredLogger, type StructuredLogger } from './structured-logger';

export type FatalProcessExit = (status: number) => void;

/**
 * Creates a one-shot handler for failures that escape every application
 * boundary. It never serializes the raw reason and always terminates rather
 * than attempting to continue from an unknown process state.
 */
export function createFatalProcessHandler(
  logger: StructuredLogger,
  exit: FatalProcessExit,
): (reason: unknown) => void {
  let handled = false;
  return (reason: unknown): void => {
    if (handled) return;
    handled = true;
    try {
      logger.emitFatal(LOG_EVENTS.processFatal, reason, { outcome: 'failure' });
    } finally {
      exit(1);
    }
  };
}

/** Installs the runtime-only fatal boundary and returns an explicit disposer. */
export function installFatalProcessBoundary(
  logger: StructuredLogger = structuredLogger,
): () => void {
  const handler = createFatalProcessHandler(logger, (status) => process.exit(status));
  process.on('uncaughtException', handler);
  process.on('unhandledRejection', handler);
  return () => {
    process.removeListener('uncaughtException', handler);
    process.removeListener('unhandledRejection', handler);
  };
}
