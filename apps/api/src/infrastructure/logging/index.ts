export {
  createFatalProcessHandler,
  installFatalProcessBoundary,
  type FatalProcessExit,
} from './fatal-process-boundary';
export {
  createSafeLogReference,
  createSafeLegacyCorrelationId,
  createRootLogContext,
  isCanonicalUuidV4,
  isSafeCorrelationId,
  isSafeLogReference,
  LoggingContext,
  loggingContext,
  type LogContextExtension,
  type LogCorrelationContext,
} from './logging-context';
export {
  createRequestLoggingMiddleware,
  requestLoggingMiddleware,
  REQUEST_ID_RESPONSE_HEADER,
  type RequestLoggingOptions,
  type RequestLoggingMiddleware,
} from './request-logging.middleware';
export {
  LOG_EVENTS,
  safeErrorCode,
  StructuredLogger,
  structuredLogger,
  type SafeLogFields,
  type StructuredLogEvent,
  type StructuredLoggerOptions,
  type StructuredLogLevel,
  type StructuredLogOutcome,
  type StructuredLogRecord,
  type StructuredLogSink,
} from './structured-logger';
