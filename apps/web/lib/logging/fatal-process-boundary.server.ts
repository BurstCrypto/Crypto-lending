import {
  WEB_LOG_EVENTS,
  webStructuredLogger,
  type WebStructuredLogger,
} from './structured-logger.server';

export type WebFatalProcessExit = (status: number) => void;

/**
 * Creates a one-shot terminal handler. Raw rejection reasons are classified by
 * the logger and are never serialized as messages, causes, stacks, or payloads.
 */
export function createWebFatalProcessHandler(
  logger: WebStructuredLogger,
  exit: WebFatalProcessExit,
): (reason: unknown) => void {
  let handled = false;
  return (reason: unknown): void => {
    if (handled) return;
    handled = true;
    try {
      logger.emitFatal(WEB_LOG_EVENTS.processFatal, reason);
    } finally {
      exit(1);
    }
  };
}

/** Installs the Node.js fatal boundary and returns an explicit disposer. */
export function installWebFatalProcessBoundary(
  logger: WebStructuredLogger = webStructuredLogger,
): () => void {
  const handler = createWebFatalProcessHandler(logger, (status) => process.exit(status));
  process.on('uncaughtException', handler);
  process.on('unhandledRejection', handler);
  return () => {
    process.removeListener('uncaughtException', handler);
    process.removeListener('unhandledRejection', handler);
  };
}
