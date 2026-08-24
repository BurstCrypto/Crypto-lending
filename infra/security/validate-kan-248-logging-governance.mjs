#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(moduleDirectory, '..', '..');
export const governancePath = resolve(
  repositoryRoot,
  'docs',
  'security',
  'logging-governance-decision.json',
);
export const governanceFingerprintPath = resolve(
  repositoryRoot,
  'docs',
  'security',
  'logging-governance-decision.sha256',
);
export const loggerContractFingerprintPath = resolve(
  repositoryRoot,
  'docs',
  'security',
  'logging-governance-logger-contract.sha256',
);
export const loggingContextPath = resolve(
  repositoryRoot,
  'apps',
  'api',
  'src',
  'infrastructure',
  'logging',
  'logging-context.ts',
);
export const structuredLoggerPath = resolve(
  repositoryRoot,
  'apps',
  'api',
  'src',
  'infrastructure',
  'logging',
  'structured-logger.ts',
);
export const applicationBaselinePath = resolve(
  repositoryRoot,
  'infra',
  'aws',
  'application-baseline.yaml',
);

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'ticket',
  'policyVersion',
  'localStatus',
  'effectiveStatus',
  'scope',
  'dependencyGate',
  'approvalGate',
  'classificationBasis',
  'actorIdentities',
  'correlationFields',
  'accessControl',
  'retentionAndDeletion',
  'incidentQueryPolicy',
  'ownershipAndReview',
  'localEvidence',
  'unresolvedGates',
]);
const DEPENDENCY_KEYS = new Set(['ticket', 'observedStatus', 'requiredStatus', 'status', 'reason']);
const APPROVAL_GATE_KEYS = new Set([
  'status',
  'selfApprovalForbidden',
  'allowedDecisions',
  'requiredBindings',
  'reviewers',
]);
const REVIEWER_KEYS = new Set([
  'role',
  'status',
  'decisionReference',
  'decidedAt',
  'requiredDecision',
]);
const CLASSIFICATION_BASIS_KEYS = new Set([
  'recordClassification',
  'reason',
  'prohibitedInputs',
  'evidence',
]);
const CORRELATION_KEYS = new Set([
  'name',
  'classification',
  'source',
  'format',
  'runtimeState',
  'emission',
  'allowedUse',
  'authority',
]);
const ACTOR_KEYS = new Set([
  'name',
  'classification',
  'meaning',
  'provenance',
  'authority',
  'restrictions',
]);
const ACCESS_ROW_KEYS = new Set([
  'role',
  'environments',
  'standingAccess',
  'permissions',
  'explicitDenials',
]);
const ACCESS_CONTROL_KEYS = new Set([
  'default',
  'environmentSeparation',
  'matrix',
  'auditRequirements',
  'breakGlass',
]);
const BREAK_GLASS_KEYS = new Set([
  'trigger',
  'authorization',
  'maximumMinutes',
  'scope',
  'controls',
]);
const RETENTION_KEYS = new Set([
  'standardApplicationLogDays',
  'templateAllowedDays',
  'rule',
  'localEvidence',
  'normalDeletion',
  'dataSubjectHandling',
  'legalHold',
  'immutableFinancialRecordBoundary',
]);
const LEGAL_HOLD_KEYS = new Set(['implementationStatus', 'rule', 'release']);
const INCIDENT_POLICY_KEYS = new Set([
  'authorizedUseCases',
  'prohibitedUses',
  'minimumFilters',
  'evidenceHandling',
  'escalation',
]);
const MINIMUM_FILTER_KEYS = new Set([
  'requiredForEveryQuery',
  'initialWindowMinutes',
  'aggregateDiscoveryWindowMinutes',
  'maximumWindowHoursWithoutEscalation',
  'defaultProjection',
  'actorProjectionRule',
  'financialProjectionRule',
]);
const OWNERSHIP_KEYS = new Set(['owners', 'cadence', 'exceptionRequirements', 'reReviewTriggers']);
const OWNER_KEYS = new Set(['control', 'accountable', 'operators']);
const USE_CASE_KEYS = new Set(['id', 'purpose', 'primarySelectors']);
const EXPECTED_REVIEWERS = new Set(['Security', 'Privacy', 'Operations']);
const EXPECTED_BINDINGS = new Set([
  'mergedGitCommitSha',
  'mergedGitTreeSha',
  'packetSha256',
  'loggerContractSha256',
]);
const EXPECTED_CORRELATION_FIELDS = new Set([
  'correlationId',
  'requestId',
  'initiatorActorId',
  'jobId',
  'messageId',
  'intentId',
  'quoteId',
  'transactionId',
  'ledgerEventId',
  'traceId',
  'spanId',
  'parentSpanId',
]);
const EXPECTED_CONTEXT_KEYS = new Set([
  'correlationId',
  'requestId',
  'initiatorActorId',
  'jobId',
  'intentId',
  'quoteId',
  'transactionId',
  'ledgerEventId',
]);
const EXPECTED_SAFE_FIELD_KEYS = new Set([
  'component',
  'method',
  'route',
  'statusCode',
  'durationMs',
  'outcome',
  'errorCode',
  'jobId',
  'jobKind',
  'messageId',
  'receiveCount',
  'retryCount',
  'retryDelayMs',
  'claimed',
  'published',
  'retried',
  'failed',
  'leaseLost',
  'deleted',
  'migrationCommand',
  'migrationId',
  'migrationState',
  'changed',
  'traceId',
  'spanId',
  'parentSpanId',
  'spanName',
  'lifecycleScope',
  'state',
  'reason',
]);
const EXPECTED_LOG_EVENTS = new Map([
  ['applicationStarted', 'application.started'],
  ['applicationStartFailed', 'application.start_failed'],
  ['applicationStopped', 'application.stopped'],
  ['frameworkLifecycle', 'framework.lifecycle'],
  ['frameworkWarning', 'framework.warning'],
  ['frameworkError', 'framework.error'],
  ['httpRequestCompleted', 'http.request.completed'],
  ['httpRequestAborted', 'http.request.aborted'],
  ['httpAnonymousRejectionsSuppressed', 'http.anonymous_rejections.suppressed'],
  ['traceSpanCompleted', 'trace.span.completed'],
  ['ledgerLifecycleTransitioned', 'ledger.lifecycle.transitioned'],
  ['outboxDispatchCompleted', 'outbox.dispatch.completed'],
  ['outboxDispatchFailed', 'outbox.dispatch.failed'],
  ['outboxCleanupCompleted', 'outbox.cleanup.completed'],
  ['outboxCleanupFailed', 'outbox.cleanup.failed'],
  ['jobPublished', 'job.published'],
  ['jobPublishFailed', 'job.publish_failed'],
  ['jobProcessed', 'job.processed'],
  ['jobRetryScheduled', 'job.retry_scheduled'],
  ['jobAwaitingDeadLetter', 'job.awaiting_dead_letter'],
  ['jobOwnershipLost', 'job.ownership_lost'],
  ['workerStarted', 'worker.started'],
  ['workerStartFailed', 'worker.start_failed'],
  ['workerStopped', 'worker.stopped'],
  ['workerHealthFailed', 'worker.health_failed'],
  ['migrationCompleted', 'migration.completed'],
  ['migrationFailed', 'migration.failed'],
  ['openApiGenerated', 'openapi.generated'],
  ['openApiFailed', 'openapi.failed'],
  ['processFatal', 'process.fatal'],
]);
const EXPECTED_EVENT_FIELDS = new Map(
  Object.entries({
    applicationStarted: ['outcome'],
    applicationStartFailed: ['errorCode', 'outcome'],
    applicationStopped: ['outcome'],
    frameworkLifecycle: ['component'],
    frameworkWarning: ['component'],
    frameworkError: ['component', 'errorCode'],
    httpRequestCompleted: ['method', 'route', 'statusCode', 'durationMs', 'outcome'],
    httpRequestAborted: ['method', 'route', 'statusCode', 'durationMs', 'outcome'],
    httpAnonymousRejectionsSuppressed: ['outcome'],
    traceSpanCompleted: [
      'traceId',
      'spanId',
      'parentSpanId',
      'spanName',
      'durationMs',
      'outcome',
      'errorCode',
    ],
    ledgerLifecycleTransitioned: ['lifecycleScope', 'state', 'reason'],
    outboxDispatchCompleted: [
      'claimed',
      'published',
      'retried',
      'failed',
      'leaseLost',
      'durationMs',
      'outcome',
    ],
    outboxDispatchFailed: ['errorCode', 'outcome'],
    outboxCleanupCompleted: ['deleted', 'durationMs', 'outcome'],
    outboxCleanupFailed: ['errorCode', 'outcome'],
    jobPublished: ['jobId', 'jobKind', 'messageId', 'durationMs', 'outcome'],
    jobPublishFailed: ['jobId', 'jobKind', 'retryCount', 'retryDelayMs', 'errorCode', 'outcome'],
    jobProcessed: ['jobId', 'jobKind', 'messageId', 'receiveCount', 'durationMs', 'outcome'],
    jobRetryScheduled: [
      'jobId',
      'jobKind',
      'messageId',
      'receiveCount',
      'retryCount',
      'retryDelayMs',
      'errorCode',
      'outcome',
    ],
    jobAwaitingDeadLetter: [
      'jobId',
      'jobKind',
      'messageId',
      'receiveCount',
      'errorCode',
      'outcome',
    ],
    jobOwnershipLost: ['jobId', 'jobKind', 'messageId', 'receiveCount', 'errorCode', 'outcome'],
    workerStarted: ['outcome'],
    workerStartFailed: ['errorCode', 'outcome'],
    workerStopped: ['outcome'],
    workerHealthFailed: ['errorCode', 'outcome'],
    migrationCompleted: [
      'durationMs',
      'outcome',
      'migrationCommand',
      'migrationId',
      'migrationState',
      'changed',
    ],
    migrationFailed: ['errorCode', 'outcome'],
    openApiGenerated: ['durationMs', 'outcome'],
    openApiFailed: ['errorCode', 'outcome'],
    processFatal: ['errorCode', 'outcome'],
  }),
);
const EXPECTED_ACCESS_ROLES = new Set([
  'application-log-writer',
  'developer',
  'on-call-operator',
  'security-incident-responder',
  'privacy-responder',
  'log-configuration-administrator',
  'records-legal-hold-custodian',
  'access-auditor',
  'break-glass-responder',
]);
const EXPECTED_USE_CASES = new Set([
  'INCIDENT_CAUSAL_TRACE',
  'SECURITY_ACCOUNT_ACTIVITY',
  'FINANCIAL_WORKFLOW_DIAGNOSIS',
  'BOUNDED_SERVICE_TRIAGE',
  'LEGAL_PRIVACY_CASE',
]);
const REQUIRED_QUERY_FILTERS = new Set([
  'caseOrChangeReference',
  'authorizedUseCaseId',
  'environment',
  'exactLogGroups',
  'utcStartInclusive',
  'utcEndExclusive',
  'eventAllowlist',
  'projectedFieldAllowlist',
  'primarySelectorOrApprovedAggregateTemplate',
]);
const EXPECTED_RETENTION_VALUES = [1, 3, 5, 7, 14, 30, 60, 90];
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function rejectUnknownKeys(record, expected, path, errors) {
  if (!isRecord(record)) return;
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) errors.push(`${path}.${key} is not an allowed field.`);
  }
}

function requireString(value, path, errors) {
  if (!nonEmptyString(value)) errors.push(`${path} must be a non-empty string.`);
}

function requireStringArray(value, path, errors, minimum = 1) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.some((entry) => !nonEmptyString(entry))
  ) {
    errors.push(`${path} must contain at least ${minimum} non-empty string(s).`);
    return [];
  }
  return value;
}

function asEntries(value, path, errors, minimum = 1) {
  if (!Array.isArray(value) || value.length < minimum) {
    errors.push(`${path} must contain at least ${minimum} entries.`);
    return [];
  }
  return value;
}

function setEquals(left, right) {
  return left.size === right.size && [...left].every((entry) => right.has(entry));
}

function requireExactStringSet(value, expected, path, errors) {
  const values = requireStringArray(value, path, errors, expected.size);
  const actual = new Set(values);
  if (!setEquals(actual, expected) || actual.size !== values.length) {
    errors.push(`${path} must equal exactly: ${[...expected].join(', ')}.`);
  }
  return actual;
}

function requireContains(value, expected, path, errors) {
  const actual = new Set(requireStringArray(value, path, errors));
  for (const entry of expected) {
    if (!actual.has(entry)) errors.push(`${path} must include ${entry}.`);
  }
}

function inspectUnauthorizedDecisionClaims(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectUnauthorizedDecisionClaims(entry, `${path}[${index}]`, errors),
    );
    return;
  }
  if (!isRecord(value)) {
    if (
      typeof value === 'string' &&
      ['APPROVED', 'CONDITIONAL', 'REJECTED'].includes(value) &&
      !path.startsWith('record.approvalGate.allowedDecisions[')
    ) {
      errors.push(`${path} contains an unauthorized effective decision claim.`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    inspectUnauthorizedDecisionClaims(child, `${path}.${key}`, errors);
  }
}

export function isEvidenceFileWithinRepository(path, root = repositoryRoot) {
  if (
    !nonEmptyString(path) ||
    path === '.' ||
    isAbsolute(path) ||
    path.split(/[\\/]/u).includes('..')
  ) {
    return false;
  }
  try {
    const realRoot = realpathSync(root);
    let candidate = realRoot;
    for (const segment of path.split(/[\\/]/u)) {
      candidate = resolve(candidate, segment);
      if (!existsSync(candidate) || lstatSync(candidate).isSymbolicLink()) return false;
    }
    if (!lstatSync(candidate).isFile()) return false;
    const realCandidate = realpathSync(candidate);
    const inside = relative(realRoot, realCandidate);
    return inside.length > 0 && !isAbsolute(inside) && !inside.split(/[\\/]/u).includes('..');
  } catch {
    return false;
  }
}

function validateEvidence(evidence, path, errors, evidenceExists) {
  for (const [index, entry] of requireStringArray(evidence, path, errors).entries()) {
    if (!evidenceExists(entry)) {
      errors.push(`${path}[${index}] must be a real repository-contained regular file.`);
    }
  }
}

function quotedValues(source) {
  return [...source.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
}

function extractDelimitedValues(source, expression, label, errors) {
  const match = source.match(expression);
  if (!match) {
    errors.push(`Logger source no longer exposes the expected ${label} declaration.`);
    return new Set();
  }
  return new Set(quotedValues(match[1]));
}

function extractLogEvents(source, errors) {
  const match = source.match(
    /export const LOG_EVENTS = Object\.freeze\(\{([\s\S]*?)\}\s+as const\);/u,
  );
  if (!match) {
    errors.push('Logger source no longer exposes the expected LOG_EVENTS declaration.');
    return new Map();
  }
  return new Map(
    [...match[1].matchAll(/^\s*([A-Za-z0-9]+):\s*'([^']+)',?\s*$/gmu)].map((entry) => [
      entry[1],
      entry[2],
    ]),
  );
}

function extractEventFields(source, errors) {
  const match = source.match(
    /const EVENT_FIELD_KEYS[\s\S]*?= \{([\s\S]*?)\n\};\nconst SAFE_EVENTS/u,
  );
  if (!match) {
    errors.push('Logger source no longer exposes the expected EVENT_FIELD_KEYS declaration.');
    return new Map();
  }
  return new Map(
    [...match[1].matchAll(/\[LOG_EVENTS\.([A-Za-z0-9]+)\]: new Set\(\[([\s\S]*?)\]\),/gu)].map(
      (entry) => [entry[1], new Set(quotedValues(entry[2]))],
    ),
  );
}

function compareMapOfStrings(actual, expected, path, errors) {
  if (!setEquals(new Set(actual.keys()), new Set(expected.keys()))) {
    errors.push(`${path} names drifted from the reviewed logger contract.`);
  }
  for (const [name, expectedValue] of expected) {
    if (actual.get(name) !== expectedValue) {
      errors.push(`${path}.${name} drifted from ${expectedValue}.`);
    }
  }
}

function compareMapOfSets(actual, expected, path, errors) {
  if (!setEquals(new Set(actual.keys()), new Set(expected.keys()))) {
    errors.push(`${path} event names drifted from the reviewed logger contract.`);
  }
  for (const [event, expectedFields] of expected) {
    const actualFields = actual.get(event);
    if (!actualFields || !setEquals(actualFields, new Set(expectedFields))) {
      errors.push(`${path}.${event} field allowlist drifted from the reviewed logger contract.`);
    }
  }
}

export function computeLoggerContractFingerprint(loggingContextSource, structuredLoggerSource) {
  const hash = createHash('sha256');
  for (const [path, source] of [
    ['apps/api/src/infrastructure/logging/logging-context.ts', loggingContextSource],
    ['apps/api/src/infrastructure/logging/structured-logger.ts', structuredLoggerSource],
  ]) {
    hash.update(`${path}\0${Buffer.byteLength(source, 'utf8')}\0`, 'utf8');
    hash.update(source, 'utf8');
  }
  return hash.digest('hex');
}

export function validateLoggerContract(loggingContextSource, structuredLoggerSource) {
  const errors = [];
  const contextKeys = extractDelimitedValues(
    loggingContextSource,
    /const CONTEXT_KEYS = \[([\s\S]*?)\] as const;/u,
    'CONTEXT_KEYS',
    errors,
  );
  if (!setEquals(contextKeys, EXPECTED_CONTEXT_KEYS)) {
    errors.push('logging-context.ts CONTEXT_KEYS drifted from the reviewed correlation catalog.');
  }

  const safeFieldKeys = extractDelimitedValues(
    structuredLoggerSource,
    /const SAFE_FIELD_KEYS[\s\S]*?new Set[^\(]*\(\[([\s\S]*?)\]\);/u,
    'SAFE_FIELD_KEYS',
    errors,
  );
  if (!setEquals(safeFieldKeys, EXPECTED_SAFE_FIELD_KEYS)) {
    errors.push('structured-logger.ts SAFE_FIELD_KEYS drifted from the reviewed event allowlist.');
  }

  compareMapOfStrings(
    extractLogEvents(structuredLoggerSource, errors),
    EXPECTED_LOG_EVENTS,
    'LOG_EVENTS',
    errors,
  );
  compareMapOfSets(
    extractEventFields(structuredLoggerSource, errors),
    EXPECTED_EVENT_FIELDS,
    'EVENT_FIELD_KEYS',
    errors,
  );

  for (const field of [
    'correlationId',
    'requestId',
    'initiatorActorId',
    'intentId',
    'quoteId',
    'transactionId',
    'ledgerEventId',
  ]) {
    if (!new RegExp(`readonly ${field}\\?: string;`, 'u').test(structuredLoggerSource)) {
      errors.push(`StructuredLogRecord must retain the reviewed ${field} field.`);
    }
  }
  if (
    !/const traceEvent = event === LOG_EVENTS\.traceSpanCompleted;/u.test(structuredLoggerSource)
  ) {
    errors.push('Logger must retain the explicit trace-event context projection boundary.');
  }
  for (const field of [
    'requestId',
    'initiatorActorId',
    'jobId',
    'intentId',
    'quoteId',
    'transactionId',
    'ledgerEventId',
  ]) {
    const pattern = new RegExp(`context\\?\\.${field} && !traceEvent`, 'u');
    if (!pattern.test(structuredLoggerSource)) {
      errors.push(`${field} must remain excluded from trace.span.completed projection.`);
    }
  }
  return errors;
}

export function validateRetentionTemplate(source) {
  const errors = [];
  const parameter = source.match(
    /\n  LogRetentionDays:\r?\n    Type: Number\r?\n    Default: (\d+)\r?\n    AllowedValues: \[([^\]]+)\]/u,
  );
  if (!parameter) {
    errors.push('application-baseline LogRetentionDays declaration is missing or malformed.');
  } else {
    const values = parameter[2].split(',').map((value) => Number(value.trim()));
    if (Number(parameter[1]) !== 14)
      errors.push('application-baseline log retention default must remain 14 days.');
    if (JSON.stringify(values) !== JSON.stringify(EXPECTED_RETENTION_VALUES)) {
      errors.push(
        'application-baseline log retention allowlist drifted from the governance packet.',
      );
    }
  }
  for (const resource of ['ApiLogGroup', 'WebLogGroup', 'WorkerLogGroup']) {
    const blockPattern = new RegExp(
      `\\n  ${resource}:\\r?\\n([\\s\\S]*?)(?=\\n  [A-Za-z0-9]+:|$)`,
      'u',
    );
    const block = source.match(blockPattern)?.[1];
    if (!block || !/^      RetentionInDays: !Ref LogRetentionDays\r?$/mu.test(block)) {
      errors.push(`${resource} must bind retention exactly to LogRetentionDays.`);
    }
  }
  return errors;
}

export function validateGovernanceRecord(
  record,
  { evidenceExists = isEvidenceFileWithinRepository } = {},
) {
  const errors = [];
  if (!isRecord(record)) return ['record must be a JSON object.'];
  rejectUnknownKeys(record, TOP_LEVEL_KEYS, 'record', errors);
  inspectUnauthorizedDecisionClaims(record, 'record', errors);

  if (record.schemaVersion !== 1) errors.push('schemaVersion must equal 1.');
  if (record.ticket !== 'KAN-248') errors.push('ticket must equal KAN-248.');
  if (record.policyVersion !== '0.1.0-draft') {
    errors.push('policyVersion must remain 0.1.0-draft until independently revised.');
  }
  if (record.localStatus !== 'DRAFT_PENDING_EXTERNAL_APPROVAL') {
    errors.push('localStatus must equal DRAFT_PENDING_EXTERNAL_APPROVAL.');
  }
  if (record.effectiveStatus !== 'NOT_EFFECTIVE') {
    errors.push('effectiveStatus must remain NOT_EFFECTIVE.');
  }
  requireString(record.scope, 'scope', errors);

  if (!isRecord(record.dependencyGate)) {
    errors.push('dependencyGate must be an object.');
  } else {
    rejectUnknownKeys(record.dependencyGate, DEPENDENCY_KEYS, 'dependencyGate', errors);
    if (
      record.dependencyGate.ticket !== 'KAN-220' ||
      record.dependencyGate.observedStatus !== 'TO_DO' ||
      record.dependencyGate.requiredStatus !== 'DONE_WITH_REVIEWED_OUTPUT' ||
      record.dependencyGate.status !== 'BLOCKED'
    ) {
      errors.push(
        'KAN-220 dependency must remain explicitly TO_DO, BLOCKED, and required before effect.',
      );
    }
    requireString(record.dependencyGate.reason, 'dependencyGate.reason', errors);
  }

  if (!isRecord(record.approvalGate)) {
    errors.push('approvalGate must be an object.');
  } else {
    rejectUnknownKeys(record.approvalGate, APPROVAL_GATE_KEYS, 'approvalGate', errors);
    if (record.approvalGate.status !== 'PENDING')
      errors.push('approvalGate.status must remain PENDING.');
    if (record.approvalGate.selfApprovalForbidden !== true) {
      errors.push('approvalGate.selfApprovalForbidden must be true.');
    }
    requireExactStringSet(
      record.approvalGate.allowedDecisions,
      new Set(['APPROVED', 'CONDITIONAL', 'REJECTED']),
      'approvalGate.allowedDecisions',
      errors,
    );
    requireExactStringSet(
      record.approvalGate.requiredBindings,
      EXPECTED_BINDINGS,
      'approvalGate.requiredBindings',
      errors,
    );
    const reviewers = asEntries(record.approvalGate.reviewers, 'approvalGate.reviewers', errors, 3);
    const reviewerRoles = new Set();
    for (const [index, reviewer] of reviewers.entries()) {
      if (!isRecord(reviewer)) {
        errors.push(`approvalGate.reviewers[${index}] must be an object.`);
        continue;
      }
      rejectUnknownKeys(reviewer, REVIEWER_KEYS, `approvalGate.reviewers[${index}]`, errors);
      reviewerRoles.add(reviewer.role);
      if (
        reviewer.status !== 'PENDING' ||
        reviewer.decisionReference !== null ||
        reviewer.decidedAt !== null
      ) {
        errors.push(
          `approvalGate.reviewers[${index}] must retain a PENDING status and null decision evidence.`,
        );
      }
      requireString(
        reviewer.requiredDecision,
        `approvalGate.reviewers[${index}].requiredDecision`,
        errors,
      );
    }
    if (!setEquals(reviewerRoles, EXPECTED_REVIEWERS) || reviewers.length !== 3) {
      errors.push('approvalGate.reviewers must contain exactly Security, Privacy, and Operations.');
    }
  }

  if (!isRecord(record.classificationBasis)) {
    errors.push('classificationBasis must be an object.');
  } else {
    rejectUnknownKeys(
      record.classificationBasis,
      CLASSIFICATION_BASIS_KEYS,
      'classificationBasis',
      errors,
    );
    if (record.classificationBasis.recordClassification !== 'RESTRICTED') {
      errors.push('Every application log record must remain classified RESTRICTED.');
    }
    requireString(record.classificationBasis.reason, 'classificationBasis.reason', errors);
    requireStringArray(
      record.classificationBasis.prohibitedInputs,
      'classificationBasis.prohibitedInputs',
      errors,
      4,
    );
    validateEvidence(
      record.classificationBasis.evidence,
      'classificationBasis.evidence',
      errors,
      evidenceExists,
    );
  }

  const actors = asEntries(record.actorIdentities, 'actorIdentities', errors, 3);
  const actorNames = new Set();
  for (const [index, actor] of actors.entries()) {
    if (!isRecord(actor)) {
      errors.push(`actorIdentities[${index}] must be an object.`);
      continue;
    }
    rejectUnknownKeys(actor, ACTOR_KEYS, `actorIdentities[${index}]`, errors);
    actorNames.add(actor.name);
    for (const field of ['meaning', 'provenance', 'authority', 'restrictions']) {
      requireString(actor[field], `actorIdentities[${index}].${field}`, errors);
    }
  }
  if (
    !setEquals(
      actorNames,
      new Set(['initiatorActorId', 'service-and-workload-executor', 'durableAuditActor']),
    )
  ) {
    errors.push('actorIdentities must retain initiator, executor, and durable-audit distinctions.');
  }
  const initiatingActor = actors.find((actor) => actor?.name === 'initiatorActorId');
  const durableActor = actors.find((actor) => actor?.name === 'durableAuditActor');
  if (
    initiatingActor?.classification !== 'RESTRICTED' ||
    initiatingActor?.authority !== 'DIAGNOSTIC_ONLY'
  ) {
    errors.push('initiatorActorId must remain RESTRICTED and DIAGNOSTIC_ONLY.');
  }
  if (durableActor?.authority !== 'AUTHORITATIVE_RECORD_OUTSIDE_LOGS') {
    errors.push('durableAuditActor must remain authoritative only outside logs.');
  }

  const fields = asEntries(record.correlationFields, 'correlationFields', errors, 12);
  const fieldNames = new Set();
  for (const [index, field] of fields.entries()) {
    if (!isRecord(field)) {
      errors.push(`correlationFields[${index}] must be an object.`);
      continue;
    }
    rejectUnknownKeys(field, CORRELATION_KEYS, `correlationFields[${index}]`, errors);
    if (fieldNames.has(field.name))
      errors.push(`correlationFields contains duplicate ${field.name}.`);
    fieldNames.add(field.name);
    if (field.classification !== 'RESTRICTED') {
      errors.push(`correlationFields[${index}].classification must equal RESTRICTED.`);
    }
    for (const key of ['source', 'format', 'runtimeState', 'emission', 'allowedUse', 'authority']) {
      requireString(field[key], `correlationFields[${index}].${key}`, errors);
    }
  }
  if (!setEquals(fieldNames, EXPECTED_CORRELATION_FIELDS) || fields.length !== 12) {
    errors.push('correlationFields must classify exactly every reviewed logger linkage field.');
  }
  for (const pendingField of ['intentId', 'quoteId']) {
    if (
      fields.find((field) => field?.name === pendingField)?.runtimeState !==
      'ALLOWLISTED_NOT_RUNTIME_PROVEN'
    ) {
      errors.push(`${pendingField} must remain explicitly allowlisted but not runtime-proven.`);
    }
  }
  for (const financialField of ['transactionId', 'ledgerEventId']) {
    if (
      fields.find((field) => field?.name === financialField)?.authority !==
      'DIAGNOSTIC_REFERENCE_TO_IMMUTABLE_RECORD'
    ) {
      errors.push(
        `${financialField} must remain only a diagnostic reference to an immutable record.`,
      );
    }
  }

  if (!isRecord(record.accessControl)) {
    errors.push('accessControl must be an object.');
  } else {
    rejectUnknownKeys(record.accessControl, ACCESS_CONTROL_KEYS, 'accessControl', errors);
    if (record.accessControl.default !== 'DENY')
      errors.push('accessControl.default must equal DENY.');
    requireStringArray(
      record.accessControl.environmentSeparation,
      'accessControl.environmentSeparation',
      errors,
      4,
    );
    const matrix = asEntries(record.accessControl.matrix, 'accessControl.matrix', errors, 9);
    const roles = new Set();
    for (const [index, row] of matrix.entries()) {
      if (!isRecord(row)) {
        errors.push(`accessControl.matrix[${index}] must be an object.`);
        continue;
      }
      rejectUnknownKeys(row, ACCESS_ROW_KEYS, `accessControl.matrix[${index}]`, errors);
      roles.add(row.role);
      requireString(row.standingAccess, `accessControl.matrix[${index}].standingAccess`, errors);
      requireStringArray(row.environments, `accessControl.matrix[${index}].environments`, errors);
      requireStringArray(row.permissions, `accessControl.matrix[${index}].permissions`, errors);
      requireStringArray(
        row.explicitDenials,
        `accessControl.matrix[${index}].explicitDenials`,
        errors,
      );
    }
    if (!setEquals(roles, EXPECTED_ACCESS_ROLES) || matrix.length !== 9) {
      errors.push(
        'accessControl.matrix must retain every separated least-privilege role exactly once.',
      );
    }
    const writer = matrix.find((row) => row?.role === 'application-log-writer');
    requireContains(
      writer?.explicitDenials,
      new Set(['READ', 'QUERY', 'EXPORT', 'RETENTION_ADMIN', 'DELETE', 'LEGAL_HOLD']),
      'application-log-writer.explicitDenials',
      errors,
    );
    const developer = matrix.find((row) => row?.role === 'developer');
    requireContains(
      developer?.explicitDenials,
      new Set(['PRODUCTION_READ', 'CROSS_ENVIRONMENT_QUERY']),
      'developer.explicitDenials',
      errors,
    );
    requireStringArray(
      record.accessControl.auditRequirements,
      'accessControl.auditRequirements',
      errors,
      4,
    );
    if (!isRecord(record.accessControl.breakGlass)) {
      errors.push('accessControl.breakGlass must be an object.');
    } else {
      rejectUnknownKeys(
        record.accessControl.breakGlass,
        BREAK_GLASS_KEYS,
        'accessControl.breakGlass',
        errors,
      );
      if (
        !Number.isInteger(record.accessControl.breakGlass.maximumMinutes) ||
        record.accessControl.breakGlass.maximumMinutes < 1 ||
        record.accessControl.breakGlass.maximumMinutes > 60
      ) {
        errors.push('break-glass maximumMinutes must be between 1 and 60.');
      }
      for (const key of ['trigger', 'authorization', 'scope']) {
        requireString(
          record.accessControl.breakGlass[key],
          `accessControl.breakGlass.${key}`,
          errors,
        );
      }
      requireStringArray(
        record.accessControl.breakGlass.controls,
        'accessControl.breakGlass.controls',
        errors,
        5,
      );
    }
  }

  if (!isRecord(record.retentionAndDeletion)) {
    errors.push('retentionAndDeletion must be an object.');
  } else {
    rejectUnknownKeys(record.retentionAndDeletion, RETENTION_KEYS, 'retentionAndDeletion', errors);
    if (record.retentionAndDeletion.standardApplicationLogDays !== 14) {
      errors.push('standardApplicationLogDays must equal 14.');
    }
    if (
      JSON.stringify(record.retentionAndDeletion.templateAllowedDays) !==
      JSON.stringify(EXPECTED_RETENTION_VALUES)
    ) {
      errors.push('templateAllowedDays must retain the exact deployed-template allowlist.');
    }
    for (const key of ['rule', 'localEvidence', 'normalDeletion', 'dataSubjectHandling']) {
      requireString(record.retentionAndDeletion[key], `retentionAndDeletion.${key}`, errors);
    }
    if (!isRecord(record.retentionAndDeletion.legalHold)) {
      errors.push('retentionAndDeletion.legalHold must be an object.');
    } else {
      rejectUnknownKeys(
        record.retentionAndDeletion.legalHold,
        LEGAL_HOLD_KEYS,
        'retentionAndDeletion.legalHold',
        errors,
      );
    }
    if (
      record.retentionAndDeletion.legalHold?.implementationStatus !==
      'PENDING_APPROVED_EVIDENCE_STORE_AND_PROCEDURE'
    ) {
      errors.push('Legal hold must remain explicitly pending an approved store and procedure.');
    }
    requireString(
      record.retentionAndDeletion.legalHold?.rule,
      'retentionAndDeletion.legalHold.rule',
      errors,
    );
    requireString(
      record.retentionAndDeletion.legalHold?.release,
      'retentionAndDeletion.legalHold.release',
      errors,
    );
    const boundaries = requireStringArray(
      record.retentionAndDeletion.immutableFinancialRecordBoundary,
      'retentionAndDeletion.immutableFinancialRecordBoundary',
      errors,
      4,
    ).join(' ');
    for (const phrase of [
      'never the book of record',
      'only a pivot',
      'must never update',
      'reversal or compensation',
    ]) {
      if (!boundaries.includes(phrase)) {
        errors.push(`immutableFinancialRecordBoundary must preserve the phrase "${phrase}".`);
      }
    }
  }

  if (!isRecord(record.incidentQueryPolicy)) {
    errors.push('incidentQueryPolicy must be an object.');
  } else {
    rejectUnknownKeys(
      record.incidentQueryPolicy,
      INCIDENT_POLICY_KEYS,
      'incidentQueryPolicy',
      errors,
    );
    const useCases = asEntries(
      record.incidentQueryPolicy.authorizedUseCases,
      'incidentQueryPolicy.authorizedUseCases',
      errors,
      5,
    );
    const useCaseIds = new Set();
    for (const [index, useCase] of useCases.entries()) {
      if (!isRecord(useCase)) {
        errors.push(`incidentQueryPolicy.authorizedUseCases[${index}] must be an object.`);
        continue;
      }
      rejectUnknownKeys(
        useCase,
        USE_CASE_KEYS,
        `incidentQueryPolicy.authorizedUseCases[${index}]`,
        errors,
      );
      useCaseIds.add(useCase.id);
      requireString(
        useCase.purpose,
        `incidentQueryPolicy.authorizedUseCases[${index}].purpose`,
        errors,
      );
      for (const selector of requireStringArray(
        useCase.primarySelectors,
        `incidentQueryPolicy.authorizedUseCases[${index}].primarySelectors`,
        errors,
      )) {
        if (
          !EXPECTED_CORRELATION_FIELDS.has(selector) &&
          !['event', 'errorCode', 'service', 'workload'].includes(selector)
        ) {
          errors.push(`Incident selector ${selector} is not a reviewed logger field.`);
        }
      }
    }
    if (!setEquals(useCaseIds, EXPECTED_USE_CASES) || useCases.length !== 5) {
      errors.push('incidentQueryPolicy must retain exactly the five authorized use cases.');
    }
    requireStringArray(
      record.incidentQueryPolicy.prohibitedUses,
      'incidentQueryPolicy.prohibitedUses',
      errors,
      4,
    );
    if (!isRecord(record.incidentQueryPolicy.minimumFilters)) {
      errors.push('incidentQueryPolicy.minimumFilters must be an object.');
    } else {
      rejectUnknownKeys(
        record.incidentQueryPolicy.minimumFilters,
        MINIMUM_FILTER_KEYS,
        'incidentQueryPolicy.minimumFilters',
        errors,
      );
      requireExactStringSet(
        record.incidentQueryPolicy.minimumFilters.requiredForEveryQuery,
        REQUIRED_QUERY_FILTERS,
        'incidentQueryPolicy.minimumFilters.requiredForEveryQuery',
        errors,
      );
      if (
        record.incidentQueryPolicy.minimumFilters.initialWindowMinutes !== 120 ||
        record.incidentQueryPolicy.minimumFilters.aggregateDiscoveryWindowMinutes !== 15 ||
        record.incidentQueryPolicy.minimumFilters.maximumWindowHoursWithoutEscalation !== 24
      ) {
        errors.push(
          'Incident query time bounds must remain 120 minutes, 15 minutes, and 24 hours.',
        );
      }
      requireString(
        record.incidentQueryPolicy.minimumFilters.actorProjectionRule,
        'minimumFilters.actorProjectionRule',
        errors,
      );
      requireString(
        record.incidentQueryPolicy.minimumFilters.financialProjectionRule,
        'minimumFilters.financialProjectionRule',
        errors,
      );
      const defaultProjection = new Set(
        requireStringArray(
          record.incidentQueryPolicy.minimumFilters.defaultProjection,
          'minimumFilters.defaultProjection',
          errors,
        ),
      );
      for (const forbidden of ['initiatorActorId', 'transactionId', 'ledgerEventId']) {
        if (defaultProjection.has(forbidden))
          errors.push(`Default query projection must exclude ${forbidden}.`);
      }
    }
    requireStringArray(
      record.incidentQueryPolicy.evidenceHandling,
      'incidentQueryPolicy.evidenceHandling',
      errors,
      5,
    );
    requireStringArray(
      record.incidentQueryPolicy.escalation,
      'incidentQueryPolicy.escalation',
      errors,
      4,
    );
  }

  if (!isRecord(record.ownershipAndReview)) {
    errors.push('ownershipAndReview must be an object.');
  } else {
    rejectUnknownKeys(record.ownershipAndReview, OWNERSHIP_KEYS, 'ownershipAndReview', errors);
    const owners = asEntries(
      record.ownershipAndReview.owners,
      'ownershipAndReview.owners',
      errors,
      4,
    );
    const accountable = new Set(owners.map((owner) => owner?.accountable));
    if (!setEquals(accountable, new Set(['Security', 'Privacy', 'Operations', 'Records']))) {
      errors.push(
        'ownershipAndReview must retain Security, Privacy, Operations, and Records accountability.',
      );
    }
    for (const [index, owner] of owners.entries()) {
      rejectUnknownKeys(owner, OWNER_KEYS, `ownershipAndReview.owners[${index}]`, errors);
      requireString(owner?.control, `ownershipAndReview.owners[${index}].control`, errors);
      requireStringArray(owner?.operators, `ownershipAndReview.owners[${index}].operators`, errors);
    }
    requireStringArray(record.ownershipAndReview.cadence, 'ownershipAndReview.cadence', errors, 4);
    requireStringArray(
      record.ownershipAndReview.exceptionRequirements,
      'ownershipAndReview.exceptionRequirements',
      errors,
      4,
    );
    requireStringArray(
      record.ownershipAndReview.reReviewTriggers,
      'ownershipAndReview.reReviewTriggers',
      errors,
      6,
    );
  }

  validateEvidence(record.localEvidence, 'localEvidence', errors, evidenceExists);
  const gates = requireStringArray(record.unresolvedGates, 'unresolvedGates', errors, 7).join(' ');
  for (const gate of [
    'KAN-220',
    'Security',
    'Privacy',
    'Operations',
    'Legal',
    'merged-commit',
    'non-production exercise',
  ]) {
    if (!gates.includes(gate)) errors.push(`unresolvedGates must retain the ${gate} gate.`);
  }
  return errors;
}

export function validateCanonicalGovernance() {
  let source;
  let expectedFingerprint;
  let expectedLoggerFingerprint;
  let loggingContextSource;
  let structuredLoggerSource;
  let applicationBaselineSource;
  try {
    source = readFileSync(governancePath, 'utf8');
    expectedFingerprint = readFileSync(governanceFingerprintPath, 'utf8').trim();
    expectedLoggerFingerprint = readFileSync(loggerContractFingerprintPath, 'utf8').trim();
    loggingContextSource = readFileSync(loggingContextPath, 'utf8');
    structuredLoggerSource = readFileSync(structuredLoggerPath, 'utf8');
    applicationBaselineSource = readFileSync(applicationBaselinePath, 'utf8');
  } catch {
    return {
      errors: [
        'Canonical governance packet, fingerprints, logger sources, or retention template are missing.',
      ],
      fingerprint: null,
      loggerFingerprint: null,
    };
  }

  let record;
  try {
    record = JSON.parse(source);
  } catch {
    return {
      errors: ['Canonical governance packet is not valid JSON.'],
      fingerprint: null,
      loggerFingerprint: null,
    };
  }
  const fingerprint = createHash('sha256').update(source, 'utf8').digest('hex');
  const loggerFingerprint = computeLoggerContractFingerprint(
    loggingContextSource,
    structuredLoggerSource,
  );
  const errors = [
    ...validateGovernanceRecord(record),
    ...validateLoggerContract(loggingContextSource, structuredLoggerSource),
    ...validateRetentionTemplate(applicationBaselineSource),
  ];
  if (!SHA256_PATTERN.test(expectedFingerprint) || expectedFingerprint !== fingerprint) {
    errors.push('Governance packet fingerprint is missing, malformed, or stale.');
  }
  if (
    !SHA256_PATTERN.test(expectedLoggerFingerprint) ||
    expectedLoggerFingerprint !== loggerFingerprint
  ) {
    errors.push(
      'Logger contract fingerprint is missing, malformed, or stale; re-review is required.',
    );
  }
  return { errors, fingerprint, loggerFingerprint };
}

function main() {
  const result = validateCanonicalGovernance();
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`KAN-248 validation: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `KAN-248 draft governance packet valid (packet sha256 ${result.fingerprint}; logger contract sha256 ${result.loggerFingerprint}; approvals remain pending).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
