import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateBillingControlRecord } from '../aws/validate-billing-control-record.mjs';

const MODULE_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(MODULE_PATH), '..', '..');
const LOCAL_ARTIFACT_PATTERN = /\.(?:egress-policy|egress-evidence|egress-plan)\.local\.json$/i;
const IGNORED_SCAN_DIRECTORIES = new Set([
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'vendor',
]);

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'status',
  'policyId',
  'currentMode',
  'approvedAt',
  'acceptedAt',
  'expiresAt',
  'environment',
  'dependencies',
  'architecture',
  'authority',
  'destinations',
  'evidence',
];

const OBJECT_KEYS = {
  environment: ['application', 'name', 'accountId', 'applicationRegion', 'sourceRevision'],
  dependencies: ['applicationBaseline', 'authenticationSessions', 'rpcIndexing'],
  dependency: ['ticket', 'approvalStatus', 'decisionReference'],
  architecture: [
    'adrStatus',
    'decisionReference',
    'selectedControl',
    'defaultAction',
    'dnsPolicy',
    'ecsBoundary',
    'browserBoundary',
    'killSwitch',
    'estimatedMonthlyFixedCostUsd',
    'estimatedMonthlyVariableCostUsd',
    'monthlyVariableCostCeilingUsd',
    'costDecision',
    'activationAuthorization',
    'financeApprovalReference',
    'billingControlRecordReference',
    'billingControlConfigurationSha256',
    'pricingAsOf',
    'pricingExpiresAt',
  ],
  authority: [
    'architectureApprovers',
    'securityApprovers',
    'privacyApprovers',
    'financeApprovers',
    'independentVerifier',
    'decision',
    'verifiedAt',
    'acceptanceVerifier',
    'acceptanceDecision',
  ],
  evidence: [
    'localPolicyValidation',
    'unlistedDestinationDenied',
    'allowedDestinationReached',
    'providerOutage',
    'dnsFailure',
    'tlsFailure',
    'logsRedacted',
    'killSwitch',
    'observedAtUtc',
    'evidenceIndexReference',
    'policyConfigurationSha256',
  ],
  destination: [
    'id',
    'status',
    'dependencyTicket',
    'dependencyDecisionReference',
    'service',
    'serviceAccess',
    'purpose',
    'approvedApiScope',
    'credentialReference',
    'reviewExpiresAt',
    'endpoint',
    'owners',
    'data',
    'tls',
    'dns',
    'resilience',
    'fallback',
    'logging',
    'monitoring',
    'cost',
    'killSwitch',
  ],
  serviceAccess: [
    'callerService',
    'executionBoundary',
    'identityReference',
    'networkControlReference',
    'serviceBorrowing',
  ],
  endpoint: ['scheme', 'hostname', 'port', 'redirects'],
  redirects: ['mode', 'allowedHostnames', 'forwardCredentials', 'maxHops'],
  owners: ['provider', 'service', 'availability', 'security', 'privacy', 'finance'],
  data: ['requestClassifications', 'responseClassifications', 'credentialTransport'],
  tls: [
    'minimumVersion',
    'certificateValidation',
    'hostnameVerification',
    'sni',
    'allowInvalidCertificates',
  ],
  dns: ['resolution', 'privateAddressResponse', 'failureMode', 'hostnamePinning'],
  resilience: [
    'connectTimeoutMs',
    'requestTimeoutMs',
    'maxAttempts',
    'retryBackoff',
    'retryNonIdempotent',
    'retryOn',
    'circuitBreaker',
  ],
  circuitBreaker: ['failureThreshold', 'openSeconds', 'halfOpenRequests', 'action'],
  fallback: ['behavior', 'alternateDestinationId', 'serviceBorrowing'],
  logging: [
    'allowedMetadata',
    'redactedHeaders',
    'bodyLogging',
    'queryLogging',
    'secretFieldPolicy',
    'retentionDays',
    'alertOwner',
  ],
  monitoring: ['status', 'metricNames', 'alertRules', 'owner', 'cost'],
  monitoringAlertRule: [
    'id',
    'metricName',
    'comparisonOperator',
    'threshold',
    'evaluationPeriods',
    'periodSeconds',
    'missingDataBehavior',
    'alarmReference',
  ],
  cost: [
    'currency',
    'estimatedMonthlyFixedUsd',
    'estimatedMonthlyVariableUsd',
    'monthlyVariableCeilingUsd',
    'costDecision',
    'activationAuthorization',
    'financeApprovalReference',
    'pricingAsOf',
    'pricingExpiresAt',
  ],
  destinationKillSwitch: ['owner', 'action', 'activationReference', 'lastTestedAt', 'evidence'],
};

const ROLE_ALIAS_PATTERN = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/;
const DESTINATION_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const REGION_PATTERN = /^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/;
const ENVIRONMENT_PATTERN = /^(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*$/;
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$/;
const HOSTNAME_PATTERN =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const API_SCOPE_PATTERN = /^[A-Za-z][A-Za-z0-9._:/-]{2,127}$/;

const APPROVER_FIELDS = [
  'architectureApprovers',
  'securityApprovers',
  'privacyApprovers',
  'financeApprovers',
];
const DATA_CLASSIFICATIONS = [
  'NONE',
  'PUBLIC_CHAIN_DATA',
  'WALLET_ADDRESS',
  'PSEUDONYMOUS_ACCOUNT_ID',
  'AUTHENTICATION_ASSERTION',
  'PERSONAL_DATA',
  'PRICING_DATA',
];
const LOG_METADATA = [
  'destinationId',
  'outcome',
  'durationMs',
  'statusClass',
  'retryCount',
  'circuitState',
];
const REQUIRED_REDACTED_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
];
const MONITORING_METRIC_NAMES = [
  'egress_request_total',
  'egress_failure_total',
  'egress_latency_ms',
  'egress_denied_total',
  'circuit_breaker_open',
  'egress_kill_switch_active',
];
const EXECUTION_BOUNDARIES = {
  BROWSER_WEB: 'web-browser',
  ECS_WEB: 'web-server',
  ECS_API: 'api',
  ECS_WORKER: 'outbox-worker',
  ECS_MIGRATION: 'migration-task',
};
const FIXED_SERVICE_DEPENDENCIES = {
  IDENTITY: 'KAN-37',
  RPC: 'KAN-62',
  INDEXING: 'KAN-62',
};
const SERVICE_CATEGORIES = [
  ...Object.keys(FIXED_SERVICE_DEPENDENCIES),
  'ORACLE',
  'PRICING',
  'WALLET_VENDOR',
  'PARTNER_API',
];
const PAID_ECS_CONTROLS = [
  'PRIVATE_ENDPOINTS',
  'EGRESS_PROXY_WITH_NAT',
  'NETWORK_FIREWALL_WITH_NAT',
];
const EVIDENCE_STATUSES = ['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED'];
const EVIDENCE_STATUS_FIELDS = [
  'localPolicyValidation',
  'unlistedDestinationDenied',
  'allowedDestinationReached',
  'providerOutage',
  'dnsFailure',
  'tlsFailure',
  'logsRedacted',
  'killSwitch',
];
const EVIDENCE_INDEX_RECORD_KEYS = [
  'schemaVersion',
  'artifactType',
  'status',
  'policyId',
  'policyConfigurationSha256',
  'evidenceIndexReference',
  'observedAtUtc',
  'protection',
  'integrityModel',
];
const EVIDENCE_INDEX_PROTECTION_KEYS = ['status', 'storageReference', 'immutableVersionReference'];
export const EVIDENCE_INDEX_INTEGRITY_MODEL = 'CROSS_ARTIFACT_BINDING_NOT_CRYPTOGRAPHIC_SIGNATURE';
export const EVIDENCE_INDEX_RECORD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://crypto-lending.invalid/schemas/egress-evidence-index-record.schema.json',
  title: 'KAN-231 protected external-egress evidence-index record',
  description:
    'Strict cross-artifact binding record. This record does not provide a cryptographic signature.',
  type: 'object',
  additionalProperties: false,
  required: EVIDENCE_INDEX_RECORD_KEYS,
  properties: {
    schemaVersion: { const: 1 },
    artifactType: { const: 'KAN_231_EGRESS_EVIDENCE_INDEX' },
    status: { const: 'FINAL' },
    policyId: {
      type: 'string',
      pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$',
    },
    policyConfigurationSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    evidenceIndexReference: {
      type: 'string',
      pattern: '^evidence-index:KAN-231:[a-f0-9]{64}:[A-Za-z0-9][A-Za-z0-9._/-]{2,39}$',
    },
    observedAtUtc: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$',
    },
    protection: { $ref: '#/$defs/protection' },
    integrityModel: { const: EVIDENCE_INDEX_INTEGRITY_MODEL },
  },
  $defs: {
    protection: {
      type: 'object',
      additionalProperties: false,
      required: EVIDENCE_INDEX_PROTECTION_KEYS,
      properties: {
        status: { const: 'PROTECTED' },
        storageReference: {
          type: 'string',
          pattern: '^protected-evidence:[A-Za-z0-9][A-Za-z0-9._:/-]{2,108}$',
        },
        immutableVersionReference: {
          type: 'string',
          pattern: '^protected-version:[A-Za-z0-9][A-Za-z0-9._:/-]{2,109}$',
        },
      },
    },
  },
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWithinDirectory(parent, candidate) {
  const relativePath = relative(resolve(parent), resolve(candidate));
  return (
    relativePath === '' ||
    (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`))
  );
}

function isNetworkOrUriPath(value) {
  return (
    typeof value !== 'string' ||
    value.length === 0 ||
    /^(?:\\\\|\/\/)/.test(value) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)
  );
}

function resolveLocalPath(value, label, errors) {
  if (isNetworkOrUriPath(value)) {
    errors.push(`${label} must be a local filesystem path; UNC, device, and URI paths are denied.`);
    return undefined;
  }
  return resolve(value);
}

export function validateLocalPathInput(value, label = 'Input path') {
  const errors = [];
  const path = resolveLocalPath(value, label, errors);
  return { ok: errors.length === 0, errors, path };
}

function assertRegularLocalFile(filePath, label, errors) {
  try {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      errors.push(`${label} must be a regular non-symlink local file.`);
      return false;
    }
    return true;
  } catch (error) {
    errors.push(`Unable to inspect ${label}: ${error.message}`);
    return false;
  }
}

function findLocalArtifacts(directory, findings = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_SCAN_DIRECTORIES.has(entry.name)) {
        findLocalArtifacts(entryPath, findings);
      }
    } else if (entry.isFile() && LOCAL_ARTIFACT_PATTERN.test(entry.name)) {
      findings.push(entryPath);
    }
  }
  return findings;
}

export function validatePolicyPathHygiene(
  policyPath,
  { mode = 'example', repositoryRoot = REPOSITORY_ROOT } = {},
) {
  const errors = [];
  const absolutePolicyPath = resolveLocalPath(policyPath, 'Policy path', errors);
  const absoluteRepositoryRoot = resolve(repositoryRoot);
  if (absolutePolicyPath === undefined) {
    return { ok: false, errors };
  }
  const committedExample = resolve(
    absoluteRepositoryRoot,
    'infra',
    'egress',
    'egress-policy.example.json',
  );
  if (mode === 'example') {
    if (absolutePolicyPath !== committedExample) {
      errors.push('Example mode may validate only the committed inert example policy.');
    }
  } else if (isWithinDirectory(absoluteRepositoryRoot, absolutePolicyPath)) {
    errors.push('Non-example egress policies must be stored outside the repository.');
  }

  try {
    for (const artifact of findLocalArtifacts(absoluteRepositoryRoot)) {
      errors.push(
        `Local operational egress artifact must not be stored in the repository: ${relative(absoluteRepositoryRoot, artifact)}.`,
      );
    }
  } catch (error) {
    errors.push(`Unable to verify repository egress-artifact hygiene: ${error.message}`);
  }
  return { ok: errors.length === 0, errors };
}

function sortedJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortedJson);
  }
  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, sortedJson(value[key])]),
  );
}

export function canonicalizeEgressPolicy(policy) {
  return JSON.stringify(sortedJson(policy));
}

export function canonicalizeEgressPolicyConfiguration(policy) {
  const authority = policy?.authority ?? {};
  const destinations = Array.isArray(policy?.destinations)
    ? policy.destinations.map((destination) => {
        const { killSwitch = {}, ...configuration } = destination;
        return {
          ...configuration,
          killSwitch: {
            owner: killSwitch.owner,
            action: killSwitch.action,
            activationReference: killSwitch.activationReference,
          },
        };
      })
    : policy?.destinations;
  const configuration = {
    schemaVersion: policy?.schemaVersion,
    policyId: policy?.policyId,
    currentMode: policy?.currentMode,
    approvedAt: policy?.approvedAt,
    expiresAt: policy?.expiresAt,
    environment: policy?.environment,
    dependencies: policy?.dependencies,
    architecture: policy?.architecture,
    authority: {
      architectureApprovers: authority.architectureApprovers,
      securityApprovers: authority.securityApprovers,
      privacyApprovers: authority.privacyApprovers,
      financeApprovers: authority.financeApprovers,
      independentVerifier: authority.independentVerifier,
      decision: authority.decision,
      verifiedAt: authority.verifiedAt,
    },
    destinations,
  };
  return JSON.stringify(sortedJson(configuration));
}

export function validateBillingControlBinding(
  billingRecord,
  policy,
  { expectedEnvironment, expectedAccount, expectedRegion, now = new Date() } = {},
) {
  const validation = validateBillingControlRecord(billingRecord, {
    mode: 'approved',
    expectedEnvironment,
    expectedAccount,
    expectedApplicationRegion: expectedRegion,
    now,
  });
  const errors = validation.errors.map((error) => `KAN-229 billing control: ${error}`);
  const reference = `billing-control:${billingRecord?.recordId ?? 'INVALID'}`;
  if (!referenceContainsTicket(billingRecord?.recordId, 'KAN-229')) {
    errors.push('The validated billing control recordId must contain the exact ticket KAN-229.');
  }
  if (policy?.architecture?.billingControlRecordReference !== reference) {
    errors.push(
      'policy.architecture.billingControlRecordReference must exactly bind the validated KAN-229 recordId.',
    );
  }
  if (
    policy?.architecture?.billingControlConfigurationSha256 !==
    validation.controlConfigurationSha256
  ) {
    errors.push(
      'policy.architecture.billingControlConfigurationSha256 must exactly bind the validated KAN-229 configuration digest.',
    );
  }
  const policyExpiresAt = Date.parse(policy?.expiresAt);
  const billingExpiresAt = Date.parse(billingRecord?.expiresAt);
  if (
    Number.isFinite(policyExpiresAt) &&
    Number.isFinite(billingExpiresAt) &&
    policyExpiresAt > billingExpiresAt
  ) {
    errors.push('policy.expiresAt must not outlive the validated KAN-229 billing control record.');
  }
  return {
    ok: validation.ok && errors.length === 0,
    errors,
    reference,
    controlConfigurationSha256: validation.controlConfigurationSha256,
  };
}

export function validateBillingControlRecordFile(
  recordPath,
  policy,
  {
    expectedEnvironment,
    expectedAccount,
    expectedRegion,
    now = new Date(),
    repositoryRoot = REPOSITORY_ROOT,
  } = {},
) {
  const errors = [];
  const absolutePath = resolveLocalPath(recordPath, 'Billing control record path', errors);
  if (absolutePath === undefined) {
    return { ok: false, errors };
  }
  if (isWithinDirectory(repositoryRoot, absolutePath)) {
    errors.push('The final KAN-229 billing control record must be stored outside the repository.');
    return { ok: false, errors, recordPath: absolutePath };
  }
  if (!assertRegularLocalFile(absolutePath, 'billing control record', errors)) {
    return { ok: false, errors, recordPath: absolutePath };
  }

  let record;
  try {
    record = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    errors.push(`Unable to parse billing control record: ${error.message}`);
    return { ok: false, errors, recordPath: absolutePath };
  }
  const binding = validateBillingControlBinding(record, policy, {
    expectedEnvironment,
    expectedAccount,
    expectedRegion,
    now,
  });
  errors.push(...binding.errors);
  return {
    ok: binding.ok && errors.length === 0,
    errors,
    recordPath: absolutePath,
    reference: binding.reference,
    controlConfigurationSha256: binding.controlConfigurationSha256,
  };
}

export function validateEvidenceIndexBinding(
  record,
  policy,
  { expectedPolicyConfigurationSha256, now = new Date() } = {},
) {
  const errors = [];
  assertExactKeys(record, EVIDENCE_INDEX_RECORD_KEYS, 'evidenceIndexRecord', errors);
  if (!isPlainObject(record)) {
    return {
      ok: false,
      errors,
      integrityModel: EVIDENCE_INDEX_INTEGRITY_MODEL,
    };
  }

  if (record.schemaVersion !== 1) {
    errors.push('evidenceIndexRecord.schemaVersion must equal 1.');
  }
  if (record.artifactType !== 'KAN_231_EGRESS_EVIDENCE_INDEX') {
    errors.push('evidenceIndexRecord.artifactType must equal KAN_231_EGRESS_EVIDENCE_INDEX.');
  }
  if (record.status !== 'FINAL') {
    errors.push('evidenceIndexRecord.status must equal FINAL.');
  }
  assertReference(record.policyId, 'evidenceIndexRecord.policyId', errors);
  if (!referenceContainsTicket(record.policyId, 'KAN-231')) {
    errors.push('evidenceIndexRecord.policyId must contain the exact ticket KAN-231.');
  }
  if (!/^[a-f0-9]{64}$/.test(record.policyConfigurationSha256 ?? '')) {
    errors.push(
      'evidenceIndexRecord.policyConfigurationSha256 must be a lowercase SHA-256 digest.',
    );
  }
  assertReference(
    record.evidenceIndexReference,
    'evidenceIndexRecord.evidenceIndexReference',
    errors,
  );
  if (
    !/^evidence-index:KAN-231:[a-f0-9]{64}:[A-Za-z0-9][A-Za-z0-9._/-]{2,39}$/.test(
      record.evidenceIndexReference ?? '',
    )
  ) {
    errors.push(
      'evidenceIndexRecord.evidenceIndexReference must be an exact versioned KAN-231 evidence-index reference.',
    );
  }
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) {
    errors.push('Evidence-index validation time must be a real Date.');
  }
  const observedAt = parseDate(
    record.observedAtUtc,
    ISO_INSTANT_PATTERN,
    'evidenceIndexRecord.observedAtUtc',
    errors,
  );
  if (observedAt !== undefined && Number.isFinite(nowMs) && observedAt > nowMs) {
    errors.push('evidenceIndexRecord.observedAtUtc cannot be in the future.');
  }

  assertExactKeys(
    record.protection,
    EVIDENCE_INDEX_PROTECTION_KEYS,
    'evidenceIndexRecord.protection',
    errors,
  );
  if (isPlainObject(record.protection)) {
    if (record.protection.status !== 'PROTECTED') {
      errors.push('evidenceIndexRecord.protection.status must equal PROTECTED.');
    }
    for (const [field, prefix] of [
      ['storageReference', 'protected-evidence:'],
      ['immutableVersionReference', 'protected-version:'],
    ]) {
      assertReference(record.protection[field], `evidenceIndexRecord.protection.${field}`, errors);
      if (!String(record.protection[field]).startsWith(prefix)) {
        errors.push(`evidenceIndexRecord.protection.${field} must use a ${prefix} reference.`);
      }
    }
  }
  if (record.integrityModel !== EVIDENCE_INDEX_INTEGRITY_MODEL) {
    errors.push(`evidenceIndexRecord.integrityModel must equal ${EVIDENCE_INDEX_INTEGRITY_MODEL}.`);
  }

  const computedPolicyConfigurationSha256 = createHash('sha256')
    .update(canonicalizeEgressPolicyConfiguration(policy), 'utf8')
    .digest('hex');
  if (!/^[a-f0-9]{64}$/.test(expectedPolicyConfigurationSha256 ?? '')) {
    errors.push(
      'Evidence-index binding requires an independently supplied expected policy configuration SHA-256.',
    );
  } else {
    if (computedPolicyConfigurationSha256 !== expectedPolicyConfigurationSha256) {
      errors.push(
        'The computed policy configuration digest does not match the independently supplied expected digest.',
      );
    }
    if (record.policyConfigurationSha256 !== expectedPolicyConfigurationSha256) {
      errors.push(
        'evidenceIndexRecord.policyConfigurationSha256 does not match the independently supplied expected digest.',
      );
    }
  }
  if (record.policyId !== policy?.policyId) {
    errors.push('evidenceIndexRecord.policyId must exactly match policy.policyId.');
  }
  if (record.policyConfigurationSha256 !== computedPolicyConfigurationSha256) {
    errors.push(
      'evidenceIndexRecord.policyConfigurationSha256 must exactly match the computed policy configuration digest.',
    );
  }
  if (record.policyConfigurationSha256 !== policy?.evidence?.policyConfigurationSha256) {
    errors.push(
      'evidenceIndexRecord.policyConfigurationSha256 must exactly match the policy evidence digest.',
    );
  }
  if (record.evidenceIndexReference !== policy?.evidence?.evidenceIndexReference) {
    errors.push(
      'evidenceIndexRecord.evidenceIndexReference must exactly match the policy evidence reference.',
    );
  }
  if (record.observedAtUtc !== policy?.evidence?.observedAtUtc) {
    errors.push(
      'evidenceIndexRecord.observedAtUtc must exactly match the policy evidence observation timestamp.',
    );
  }

  errors.push(...findSecretMaterial(record, 'evidenceIndexRecord'));
  return {
    ok: errors.length === 0,
    errors,
    integrityModel: EVIDENCE_INDEX_INTEGRITY_MODEL,
    policyConfigurationSha256: computedPolicyConfigurationSha256,
  };
}

export function validateEvidenceIndexRecordFile(
  recordPath,
  policy,
  { expectedPolicyConfigurationSha256, now = new Date(), repositoryRoot = REPOSITORY_ROOT } = {},
) {
  const errors = [];
  const absolutePath = resolveLocalPath(recordPath, 'Evidence-index record path', errors);
  if (absolutePath === undefined) {
    return {
      ok: false,
      errors,
      integrityModel: EVIDENCE_INDEX_INTEGRITY_MODEL,
    };
  }
  if (isWithinDirectory(repositoryRoot, absolutePath)) {
    errors.push('The final evidence-index record must be stored outside the repository.');
    return {
      ok: false,
      errors,
      recordPath: absolutePath,
      integrityModel: EVIDENCE_INDEX_INTEGRITY_MODEL,
    };
  }
  if (!assertRegularLocalFile(absolutePath, 'evidence-index record', errors)) {
    return {
      ok: false,
      errors,
      recordPath: absolutePath,
      integrityModel: EVIDENCE_INDEX_INTEGRITY_MODEL,
    };
  }

  let record;
  try {
    record = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    errors.push(`Unable to parse evidence-index record: ${error.message}`);
    return {
      ok: false,
      errors,
      recordPath: absolutePath,
      integrityModel: EVIDENCE_INDEX_INTEGRITY_MODEL,
    };
  }
  const binding = validateEvidenceIndexBinding(record, policy, {
    expectedPolicyConfigurationSha256,
    now,
  });
  errors.push(...binding.errors);
  return {
    ok: binding.ok && errors.length === 0,
    errors,
    recordPath: absolutePath,
    integrityModel: EVIDENCE_INDEX_INTEGRITY_MODEL,
    policyConfigurationSha256: binding.policyConfigurationSha256,
  };
}

function assertExactKeys(value, expectedKeys, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  const expected = [...expectedKeys].sort();
  const actual = Object.keys(value).sort();
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) {
      errors.push(`${path}.${key} is required.`);
    }
  }
  for (const key of actual) {
    if (!expected.includes(key)) {
      errors.push(`${path}.${key} is not allowed.`);
    }
  }
}

function assertEnum(value, allowed, path, errors) {
  if (!allowed.includes(value)) {
    errors.push(`${path} must equal one of: ${allowed.join(', ')}.`);
  }
}

function assertInteger(value, minimum, maximum, path, errors) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    errors.push(`${path} must be an integer from ${minimum} through ${maximum}.`);
  }
}

function assertRoleAlias(value, path, errors, { allowSentinel = false } = {}) {
  if (allowSentinel && value === 'NOT_APPROVED') {
    return;
  }
  if (
    typeof value !== 'string' ||
    !ROLE_ALIAS_PATTERN.test(value) ||
    /^(?:admin|founder|none|owner|security|finance|privacy|tbd|team|unknown|unset)$/.test(value)
  ) {
    errors.push(`${path} must be a stable non-personal 3-64 character role alias.`);
  }
}

function assertReference(value, path, errors, { allowNotRun = false } = {}) {
  if (allowNotRun && value === 'NOT_RUN') {
    return;
  }
  if (
    typeof value !== 'string' ||
    !REFERENCE_PATTERN.test(value) ||
    value.includes('@') ||
    /^(?:NOT_APPROVED|NOT_RUN|NONE|TBD|UNKNOWN|UNSET)$/i.test(value)
  ) {
    errors.push(`${path} must be a stable non-secret reference.`);
  }
}

function referenceContainsTicket(value, ticket) {
  return (
    typeof value === 'string' &&
    value.split(/[/:._-]+/).some((segment, index, segments) => {
      if (segment !== 'KAN' || index + 1 >= segments.length) {
        return false;
      }
      return `KAN-${segments[index + 1]}` === ticket;
    })
  );
}

function assertRoleAliasArray(value, path, errors, { allowSentinel = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must contain at least one role alias.`);
    return;
  }
  value.forEach((entry, index) =>
    assertRoleAlias(entry, `${path}[${index}]`, errors, { allowSentinel }),
  );
  const normalized = value.map((entry) => String(entry).toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    errors.push(`${path} must not contain duplicate role aliases.`);
  }
}

function parseDate(value, pattern, path, errors, { allowNotRun = false } = {}) {
  if (allowNotRun && value === 'NOT_RUN') {
    return undefined;
  }
  if (typeof value !== 'string' || !pattern.test(value)) {
    errors.push(`${path} must use the required UTC date format.`);
    return undefined;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    errors.push(`${path} is not a valid date.`);
    return undefined;
  }
  const components = value.match(/\d+/g)?.map(Number) ?? [];
  const parsedDate = new Date(parsed);
  const expected = [
    parsedDate.getUTCFullYear(),
    parsedDate.getUTCMonth() + 1,
    parsedDate.getUTCDate(),
  ];
  if (pattern === ISO_INSTANT_PATTERN) {
    expected.push(parsedDate.getUTCHours(), parsedDate.getUTCMinutes(), parsedDate.getUTCSeconds());
  }
  if (
    components.length < expected.length ||
    expected.some((component, index) => component !== components[index])
  ) {
    errors.push(`${path} is not a real calendar date.`);
    return undefined;
  }
  return parsed;
}

function parseMoney(value, path, errors) {
  if (typeof value !== 'string' || !MONEY_PATTERN.test(value)) {
    errors.push(
      `${path} must be a finite nonnegative USD decimal string with at most two decimal places.`,
    );
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    errors.push(`${path} must be finite and nonnegative.`);
    return undefined;
  }
  return parsed;
}

function moneyCents(value) {
  if (typeof value !== 'string' || !MONEY_PATTERN.test(value)) {
    return undefined;
  }
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function pricingExpiryEndOfDay(value) {
  return typeof value === 'string' && ISO_DATE_PATTERN.test(value)
    ? Date.parse(`${value}T23:59:59.999Z`)
    : undefined;
}

function validateCostFields(cost, path, errors) {
  const fixed = parseMoney(
    cost?.estimatedMonthlyFixedUsd,
    `${path}.estimatedMonthlyFixedUsd`,
    errors,
  );
  const variable = parseMoney(
    cost?.estimatedMonthlyVariableUsd,
    `${path}.estimatedMonthlyVariableUsd`,
    errors,
  );
  const ceiling = parseMoney(
    cost?.monthlyVariableCeilingUsd,
    `${path}.monthlyVariableCeilingUsd`,
    errors,
  );
  if (variable !== undefined && ceiling !== undefined && variable > ceiling) {
    errors.push(`${path}.monthlyVariableCeilingUsd cannot be below the variable estimate.`);
  }
  return { fixed, variable, ceiling };
}

function validatePricingWindow(value, path, errors, nowMs, { required }) {
  const allowNotRun = !required;
  const pricingAsOf = parseDate(
    value?.pricingAsOf,
    ISO_DATE_PATTERN,
    `${path}.pricingAsOf`,
    errors,
    {
      allowNotRun,
    },
  );
  const pricingExpiresAt = parseDate(
    value?.pricingExpiresAt,
    ISO_DATE_PATTERN,
    `${path}.pricingExpiresAt`,
    errors,
    { allowNotRun },
  );
  if (pricingAsOf !== undefined && pricingAsOf > nowMs) {
    errors.push(`${path}.pricingAsOf cannot be in the future.`);
  }
  if (pricingExpiresAt !== undefined && pricingExpiresAt <= nowMs) {
    errors.push(`${path}.pricingExpiresAt must be in the future; stale pricing is not allowed.`);
  }
  if (
    pricingAsOf !== undefined &&
    pricingExpiresAt !== undefined &&
    pricingExpiresAt <= pricingAsOf
  ) {
    errors.push(`${path}.pricingExpiresAt must be later than pricingAsOf.`);
  }
}

function validateAggregateCostEnvelope(policy, errors) {
  const aggregateCosts = (policy?.destinations ?? []).reduce(
    (totals, destination) => {
      for (const cost of [destination?.cost, destination?.monitoring?.cost]) {
        totals.fixed += moneyCents(cost?.estimatedMonthlyFixedUsd) ?? 0;
        totals.variable += moneyCents(cost?.estimatedMonthlyVariableUsd) ?? 0;
        totals.ceiling += moneyCents(cost?.monthlyVariableCeilingUsd) ?? 0;
      }
      return totals;
    },
    { fixed: 0, variable: 0, ceiling: 0 },
  );
  const architectureCosts = {
    fixed: moneyCents(policy?.architecture?.estimatedMonthlyFixedCostUsd),
    variable: moneyCents(policy?.architecture?.estimatedMonthlyVariableCostUsd),
    ceiling: moneyCents(policy?.architecture?.monthlyVariableCostCeilingUsd),
  };
  for (const field of ['fixed', 'variable', 'ceiling']) {
    if (
      architectureCosts[field] !== undefined &&
      architectureCosts[field] < aggregateCosts[field]
    ) {
      errors.push(
        `policy.architecture ${field} monthly cost envelope must cover aggregate destination and monitoring costs (${(aggregateCosts[field] / 100).toFixed(2)} USD).`,
      );
    }
  }
}

function validatePolicyExpiryLimits(policy, expiresAt, errors) {
  const expiryLimits = [
    [
      'policy.architecture.pricingExpiresAt',
      pricingExpiryEndOfDay(policy?.architecture?.pricingExpiresAt),
    ],
    ...(policy?.destinations ?? []).flatMap((destination, index) => [
      [`policy.destinations[${index}].reviewExpiresAt`, Date.parse(destination?.reviewExpiresAt)],
      [
        `policy.destinations[${index}].cost.pricingExpiresAt`,
        pricingExpiryEndOfDay(destination?.cost?.pricingExpiresAt),
      ],
      [
        `policy.destinations[${index}].monitoring.cost.pricingExpiresAt`,
        pricingExpiryEndOfDay(destination?.monitoring?.cost?.pricingExpiresAt),
      ],
    ]),
  ];
  if (expiresAt !== undefined) {
    for (const [limitPath, limit] of expiryLimits) {
      if (Number.isFinite(limit) && expiresAt > limit) {
        errors.push(`policy.expiresAt must not outlive ${limitPath}.`);
      }
    }
  }
}

function validateHostname(value, path, errors) {
  if (typeof value !== 'string' || value !== value.toLowerCase() || !HOSTNAME_PATTERN.test(value)) {
    errors.push(`${path} must be an exact lowercase fully qualified hostname.`);
    return;
  }
  if (
    value.includes('*') ||
    value.includes('@') ||
    /[/?#:%]/.test(value) ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) ||
    /(^|\.)(?:localhost|localdomain|internal|home|lan|local|test|invalid)$/.test(value) ||
    value.endsWith('.example')
  ) {
    errors.push(
      `${path} must not contain a wildcard, URL material, IP literal, or private/local hostname.`,
    );
  }
}

function assertUniqueStringArray(value, allowed, path, errors, { minimum = 1 } = {}) {
  if (!Array.isArray(value) || value.length < minimum) {
    errors.push(`${path} must contain at least ${minimum} value${minimum === 1 ? '' : 's'}.`);
    return;
  }
  value.forEach((entry, index) => assertEnum(entry, allowed, `${path}[${index}]`, errors));
  const normalized = value.map((entry) => String(entry).toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    errors.push(`${path} must not contain duplicates.`);
  }
}

function validateDependency(value, expectedTicket, path, errors, mode) {
  assertExactKeys(value, OBJECT_KEYS.dependency, path, errors);
  if (!isPlainObject(value)) {
    return;
  }
  if (value.ticket !== expectedTicket) {
    errors.push(`${path}.ticket must equal ${expectedTicket}.`);
  }
  assertEnum(value.approvalStatus, ['NOT_APPROVED', 'APPROVED'], `${path}.approvalStatus`, errors);
  if (mode === 'example') {
    if (value.approvalStatus !== 'NOT_APPROVED' || value.decisionReference !== 'NOT_RUN') {
      errors.push(`${path} must remain explicitly NOT_APPROVED with no decision in the example.`);
    }
  } else if (value.approvalStatus === 'APPROVED') {
    assertReference(value.decisionReference, `${path}.decisionReference`, errors);
    if (!referenceContainsTicket(value.decisionReference, expectedTicket)) {
      errors.push(`${path}.decisionReference must contain the exact ticket ${expectedTicket}.`);
    }
  } else if (value.decisionReference !== 'NOT_RUN') {
    errors.push(`${path}.decisionReference must be NOT_RUN until the dependency is approved.`);
  }
  if (['approved', 'final'].includes(mode) && value.approvalStatus !== 'APPROVED') {
    errors.push(`${path}.approvalStatus must equal APPROVED for an approved egress policy.`);
  }
}

function validateArchitecture(value, path, errors, mode, nowMs) {
  assertExactKeys(value, OBJECT_KEYS.architecture, path, errors);
  if (!isPlainObject(value)) {
    return;
  }
  assertEnum(
    value.adrStatus,
    ['NOT_APPROVED', 'PROPOSED', 'APPROVED'],
    `${path}.adrStatus`,
    errors,
  );
  assertEnum(
    value.selectedControl,
    [
      'NO_EXTERNAL_EGRESS',
      'BROWSER_APPLICATION_CONTROLS_ONLY',
      'PRIVATE_ENDPOINTS',
      'EGRESS_PROXY_WITH_NAT',
      'NETWORK_FIREWALL_WITH_NAT',
    ],
    `${path}.selectedControl`,
    errors,
  );
  const constants = {
    defaultAction: 'DENY',
    dnsPolicy: 'DENY_UNLISTED_AND_UNAPPROVED_PRIVATE_ADDRESSES',
    ecsBoundary: 'PRIVATE_SUBNETS_NO_PUBLIC_IP_NO_DEFAULT_INTERNET_ROUTE',
    browserBoundary: 'OUTSIDE_VPC_ENFORCE_WITH_CSP_AND_APPLICATION_ALLOWLIST',
    killSwitch: 'DISABLE_ALL_EXTERNAL_EGRESS',
  };
  for (const [key, expected] of Object.entries(constants)) {
    if (value[key] !== expected) {
      errors.push(`${path}.${key} must equal ${expected}.`);
    }
  }

  const fixed = parseMoney(
    value.estimatedMonthlyFixedCostUsd,
    `${path}.estimatedMonthlyFixedCostUsd`,
    errors,
  );
  const variable = parseMoney(
    value.estimatedMonthlyVariableCostUsd,
    `${path}.estimatedMonthlyVariableCostUsd`,
    errors,
  );
  const ceiling = parseMoney(
    value.monthlyVariableCostCeilingUsd,
    `${path}.monthlyVariableCostCeilingUsd`,
    errors,
  );
  if (variable !== undefined && ceiling !== undefined && variable > ceiling) {
    errors.push(`${path}.monthlyVariableCostCeilingUsd cannot be below the variable estimate.`);
  }
  assertEnum(value.costDecision, ['NOT_APPROVED', 'APPROVED'], `${path}.costDecision`, errors);
  assertEnum(
    value.activationAuthorization,
    ['NOT_AUTHORIZED', 'APPROVED'],
    `${path}.activationAuthorization`,
    errors,
  );

  if (mode === 'example') {
    if (
      value.adrStatus !== 'NOT_APPROVED' ||
      value.decisionReference !== 'NOT_RUN' ||
      value.selectedControl !== 'NO_EXTERNAL_EGRESS'
    ) {
      errors.push(`${path} must preserve the unapproved NO_EXTERNAL_EGRESS example state.`);
    }
    if (fixed !== 0 || variable !== 0 || ceiling !== 0) {
      errors.push(`${path} example cost estimates and ceiling must all equal 0.00.`);
    }
    if (
      value.costDecision !== 'NOT_APPROVED' ||
      value.activationAuthorization !== 'NOT_AUTHORIZED' ||
      value.financeApprovalReference !== 'NOT_RUN' ||
      value.billingControlRecordReference !== 'NOT_RUN' ||
      value.billingControlConfigurationSha256 !== 'NOT_RUN' ||
      value.pricingAsOf !== 'NOT_RUN' ||
      value.pricingExpiresAt !== 'NOT_RUN'
    ) {
      errors.push(`${path} example cost and activation fields must remain unapproved/not run.`);
    }
    return;
  }

  if (mode === 'proposed') {
    if (value.adrStatus !== 'PROPOSED') {
      errors.push(`${path}.adrStatus must equal PROPOSED in proposed mode.`);
    }
    assertReference(value.decisionReference, `${path}.decisionReference`, errors);
    if (value.costDecision !== 'NOT_APPROVED') {
      errors.push(`${path}.costDecision must remain NOT_APPROVED in proposed mode.`);
    }
    if (value.activationAuthorization !== 'NOT_AUTHORIZED') {
      errors.push(`${path}.activationAuthorization must remain NOT_AUTHORIZED in proposed mode.`);
    }
    if (value.financeApprovalReference !== 'NOT_RUN') {
      errors.push(`${path}.financeApprovalReference must remain NOT_RUN in proposed mode.`);
    }
    if (
      value.billingControlRecordReference !== 'NOT_RUN' ||
      value.billingControlConfigurationSha256 !== 'NOT_RUN'
    ) {
      errors.push(`${path} billing-control binding must remain NOT_RUN in proposed mode.`);
    }
    validatePricingWindow(value, path, errors, nowMs, { required: true });
    return;
  }

  if (value.adrStatus !== 'APPROVED') {
    errors.push(`${path}.adrStatus must equal APPROVED in approved mode.`);
  }
  assertReference(value.decisionReference, `${path}.decisionReference`, errors);
  if (value.selectedControl === 'NO_EXTERNAL_EGRESS') {
    errors.push(`${path}.selectedControl must select an approved control for active destinations.`);
  }
  if (value.costDecision !== 'APPROVED') {
    errors.push(`${path}.costDecision must equal APPROVED.`);
  }
  if (value.activationAuthorization !== 'APPROVED') {
    errors.push(
      `${path}.activationAuthorization must equal APPROVED separately from cost approval.`,
    );
  }
  assertReference(value.financeApprovalReference, `${path}.financeApprovalReference`, errors);
  assertReference(
    value.billingControlRecordReference,
    `${path}.billingControlRecordReference`,
    errors,
  );
  if (!String(value.billingControlRecordReference).startsWith('billing-control:')) {
    errors.push(`${path}.billingControlRecordReference must use a billing-control: reference.`);
  }
  if (!/^[a-f0-9]{64}$/.test(value.billingControlConfigurationSha256 ?? '')) {
    errors.push(`${path}.billingControlConfigurationSha256 must be a lowercase SHA-256 digest.`);
  }
  validatePricingWindow(value, path, errors, nowMs, { required: true });
}

function validateAuthority(value, path, errors, mode, nowMs) {
  assertExactKeys(value, OBJECT_KEYS.authority, path, errors);
  if (!isPlainObject(value)) {
    return;
  }
  if (mode === 'example') {
    for (const field of APPROVER_FIELDS) {
      if (
        !Array.isArray(value[field]) ||
        value[field].length !== 1 ||
        value[field][0] !== 'NOT_APPROVED'
      ) {
        errors.push(`${path}.${field} must remain ["NOT_APPROVED"] in the example.`);
      }
    }
    if (
      value.independentVerifier !== 'NOT_APPROVED' ||
      value.decision !== 'NOT_APPROVED' ||
      value.verifiedAt !== 'NOT_RUN' ||
      value.acceptanceVerifier !== 'NOT_APPROVED' ||
      value.acceptanceDecision !== 'NOT_RUN'
    ) {
      errors.push(`${path} must remain entirely unapproved/not run in the example.`);
    }
    return;
  }

  for (const field of APPROVER_FIELDS) {
    assertRoleAliasArray(value[field], `${path}.${field}`, errors);
  }
  assertRoleAlias(value.independentVerifier, `${path}.independentVerifier`, errors);
  const approvalRoles = new Set(
    APPROVER_FIELDS.flatMap((field) => value[field] ?? []).map((entry) =>
      String(entry).toLowerCase(),
    ),
  );
  if (approvalRoles.has(String(value.independentVerifier).toLowerCase())) {
    errors.push(`${path}.independentVerifier must be independent from every approval role.`);
  }

  if (mode === 'proposed') {
    if (
      value.decision !== 'PROPOSED' ||
      value.verifiedAt !== 'NOT_RUN' ||
      value.acceptanceVerifier !== 'NOT_APPROVED' ||
      value.acceptanceDecision !== 'NOT_RUN'
    ) {
      errors.push(`${path} must record a PROPOSED decision with verifiedAt NOT_RUN.`);
    }
    return;
  }

  if (value.decision !== 'APPROVED') {
    errors.push(`${path}.decision must equal APPROVED in approved mode.`);
  }
  const verifiedAt = parseDate(value.verifiedAt, ISO_INSTANT_PATTERN, `${path}.verifiedAt`, errors);
  if (verifiedAt !== undefined && verifiedAt > nowMs) {
    errors.push(`${path}.verifiedAt cannot be in the future.`);
  }
  if (mode === 'approved') {
    if (value.acceptanceVerifier !== 'NOT_APPROVED' || value.acceptanceDecision !== 'NOT_RUN') {
      errors.push(
        `${path} post-evidence acceptance fields must remain NOT_APPROVED/NOT_RUN in approved mode.`,
      );
    }
    return;
  }

  assertRoleAlias(value.acceptanceVerifier, `${path}.acceptanceVerifier`, errors);
  if (value.acceptanceDecision !== 'ACCEPTED') {
    errors.push(`${path}.acceptanceDecision must equal ACCEPTED in final mode.`);
  }
  const designRoles = new Set([...approvalRoles, String(value.independentVerifier).toLowerCase()]);
  if (designRoles.has(String(value.acceptanceVerifier).toLowerCase())) {
    errors.push(
      `${path}.acceptanceVerifier must be independent from design approval and verification roles.`,
    );
  }
}

function validateDestinationCost(value, path, errors, mode, nowMs) {
  assertExactKeys(value, OBJECT_KEYS.cost, path, errors);
  if (!isPlainObject(value)) {
    return;
  }
  if (value.currency !== 'USD') {
    errors.push(`${path}.currency must equal USD.`);
  }
  validateCostFields(value, path, errors);
  assertEnum(value.costDecision, ['NOT_APPROVED', 'APPROVED'], `${path}.costDecision`, errors);
  assertEnum(
    value.activationAuthorization,
    ['NOT_AUTHORIZED', 'APPROVED'],
    `${path}.activationAuthorization`,
    errors,
  );
  validatePricingWindow(value, path, errors, nowMs, { required: true });
  if (mode === 'proposed') {
    if (
      value.costDecision !== 'NOT_APPROVED' ||
      value.activationAuthorization !== 'NOT_AUTHORIZED' ||
      value.financeApprovalReference !== 'NOT_RUN'
    ) {
      errors.push(`${path} must remain NOT_APPROVED/NOT_AUTHORIZED in proposed mode.`);
    }
  } else {
    if (value.costDecision !== 'APPROVED') {
      errors.push(`${path}.costDecision must equal APPROVED in approved mode.`);
    }
    if (value.activationAuthorization !== 'APPROVED') {
      errors.push(`${path}.activationAuthorization must equal APPROVED in approved mode.`);
    }
    assertReference(value.financeApprovalReference, `${path}.financeApprovalReference`, errors);
  }
}

function validateMonitoring(value, path, errors, mode, nowMs) {
  assertExactKeys(value, OBJECT_KEYS.monitoring, path, errors);
  if (!isPlainObject(value)) {
    return;
  }
  const activationMode = ['approved', 'final'].includes(mode);
  const expectedStatus = activationMode ? 'APPROVED' : 'PROPOSED';
  if (value.status !== expectedStatus) {
    errors.push(`${path}.status must equal ${expectedStatus}.`);
  }
  assertUniqueStringArray(
    value.metricNames,
    MONITORING_METRIC_NAMES,
    `${path}.metricNames`,
    errors,
  );
  assertRoleAlias(value.owner, `${path}.owner`, errors);

  if (
    !Array.isArray(value.alertRules) ||
    value.alertRules.length === 0 ||
    value.alertRules.length > 12
  ) {
    errors.push(`${path}.alertRules must contain 1-12 explicit alert rules.`);
  } else {
    const ruleIds = [];
    const ruleMetrics = new Set();
    value.alertRules.forEach((rule, index) => {
      const rulePath = `${path}.alertRules[${index}]`;
      assertExactKeys(rule, OBJECT_KEYS.monitoringAlertRule, rulePath, errors);
      if (!isPlainObject(rule)) {
        return;
      }
      if (typeof rule.id !== 'string' || !DESTINATION_ID_PATTERN.test(rule.id)) {
        errors.push(`${rulePath}.id must be a stable lowercase rule ID.`);
      }
      ruleIds.push(String(rule.id).toLowerCase());
      assertEnum(rule.metricName, MONITORING_METRIC_NAMES, `${rulePath}.metricName`, errors);
      if (!value.metricNames?.includes(rule.metricName)) {
        errors.push(`${rulePath}.metricName must be listed in ${path}.metricNames.`);
      }
      ruleMetrics.add(rule.metricName);
      assertEnum(
        rule.comparisonOperator,
        ['GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN'],
        `${rulePath}.comparisonOperator`,
        errors,
      );
      parseMoney(rule.threshold, `${rulePath}.threshold`, errors);
      assertInteger(rule.evaluationPeriods, 1, 10, `${rulePath}.evaluationPeriods`, errors);
      assertEnum(rule.periodSeconds, [60, 300, 900, 3600], `${rulePath}.periodSeconds`, errors);
      assertEnum(
        rule.missingDataBehavior,
        ['BREACHING', 'NOT_BREACHING'],
        `${rulePath}.missingDataBehavior`,
        errors,
      );
      if (activationMode) {
        assertReference(rule.alarmReference, `${rulePath}.alarmReference`, errors);
        if (!String(rule.alarmReference).startsWith('alarm-ref:')) {
          errors.push(`${rulePath}.alarmReference must use an alarm-ref: reference.`);
        }
      } else if (rule.alarmReference !== 'NOT_RUN') {
        errors.push(`${rulePath}.alarmReference must remain NOT_RUN in proposed mode.`);
      }
    });
    if (new Set(ruleIds).size !== ruleIds.length) {
      errors.push(`${path}.alertRules must not contain duplicate rule IDs.`);
    }
    for (const metricName of value.metricNames ?? []) {
      if (!ruleMetrics.has(metricName)) {
        errors.push(`${path}.alertRules must define a threshold for ${metricName}.`);
      }
    }
  }
  validateDestinationCost(value.cost, `${path}.cost`, errors, mode, nowMs);
}

function validateDestination(destination, index, errors, mode, nowMs) {
  const path = `policy.destinations[${index}]`;
  assertExactKeys(destination, OBJECT_KEYS.destination, path, errors);
  if (!isPlainObject(destination)) {
    return;
  }

  if (typeof destination.id !== 'string' || !DESTINATION_ID_PATTERN.test(destination.id)) {
    errors.push(`${path}.id must be a stable lowercase destination ID.`);
  }
  const activationMode = ['approved', 'final'].includes(mode);
  if (
    (activationMode && destination.status !== 'APPROVED') ||
    (mode === 'proposed' && destination.status !== 'PROPOSED')
  ) {
    errors.push(`${path}.status must equal ${activationMode ? 'APPROVED' : 'PROPOSED'}.`);
  }
  assertEnum(destination.service, SERVICE_CATEGORIES, `${path}.service`, errors);
  if (!/^KAN-[1-9]\d*$/.test(destination.dependencyTicket ?? '')) {
    errors.push(`${path}.dependencyTicket must be a concrete Jira ticket such as KAN-62.`);
  }
  const fixedDependency = FIXED_SERVICE_DEPENDENCIES[destination.service];
  if (fixedDependency && fixedDependency !== destination.dependencyTicket) {
    errors.push(
      `${path}.dependencyTicket must equal ${fixedDependency} for ${destination.service}.`,
    );
  }
  if (
    !fixedDependency &&
    ['KAN-34', 'KAN-37', 'KAN-62', 'KAN-231'].includes(destination.dependencyTicket)
  ) {
    errors.push(
      `${path}.dependencyTicket must name a separate downstream provider decision for ${destination.service}.`,
    );
  }
  if (activationMode || destination.status === 'APPROVED') {
    assertReference(
      destination.dependencyDecisionReference,
      `${path}.dependencyDecisionReference`,
      errors,
    );
  } else if (destination.dependencyDecisionReference !== 'NOT_RUN') {
    assertReference(
      destination.dependencyDecisionReference,
      `${path}.dependencyDecisionReference`,
      errors,
    );
  }
  if (
    destination.dependencyDecisionReference !== 'NOT_RUN' &&
    !referenceContainsTicket(destination.dependencyDecisionReference, destination.dependencyTicket)
  ) {
    errors.push(
      `${path}.dependencyDecisionReference must contain the exact ticket ${destination.dependencyTicket}.`,
    );
  }

  assertExactKeys(
    destination.serviceAccess,
    OBJECT_KEYS.serviceAccess,
    `${path}.serviceAccess`,
    errors,
  );
  if (isPlainObject(destination.serviceAccess)) {
    assertEnum(
      destination.serviceAccess.executionBoundary,
      Object.keys(EXECUTION_BOUNDARIES),
      `${path}.serviceAccess.executionBoundary`,
      errors,
    );
    const expectedCaller = EXECUTION_BOUNDARIES[destination.serviceAccess.executionBoundary];
    if (destination.serviceAccess.callerService !== expectedCaller) {
      errors.push(
        `${path}.serviceAccess.callerService must equal ${expectedCaller ?? 'the boundary-specific caller'}; service borrowing is prohibited.`,
      );
    }
    if (destination.serviceAccess.serviceBorrowing !== 'PROHIBITED') {
      errors.push(`${path}.serviceAccess.serviceBorrowing must equal PROHIBITED.`);
    }
    const allowNotRun = mode === 'proposed';
    assertReference(
      destination.serviceAccess.identityReference,
      `${path}.serviceAccess.identityReference`,
      errors,
      { allowNotRun },
    );
    assertReference(
      destination.serviceAccess.networkControlReference,
      `${path}.serviceAccess.networkControlReference`,
      errors,
      { allowNotRun },
    );
    const browser = destination.serviceAccess.executionBoundary === 'BROWSER_WEB';
    const identityReference = destination.serviceAccess.identityReference ?? '';
    const networkReference = destination.serviceAccess.networkControlReference ?? '';
    if (identityReference !== 'NOT_RUN') {
      const expectedPrefix = browser ? 'browser:' : 'iam-role:';
      if (!identityReference.startsWith(expectedPrefix)) {
        errors.push(
          `${path}.serviceAccess.identityReference must use the ${expectedPrefix} boundary-specific prefix.`,
        );
      }
    }
    if (networkReference !== 'NOT_RUN') {
      if (browser && !networkReference.startsWith('csp:')) {
        errors.push(`${path}.serviceAccess.networkControlReference must use a csp: reference.`);
      }
      if (
        !browser &&
        !/^(?:security-group|vpc-endpoint|egress-proxy|network-firewall):/.test(networkReference)
      ) {
        errors.push(
          `${path}.serviceAccess.networkControlReference must name an approved ECS egress control.`,
        );
      }
    }
  }

  if (
    typeof destination.purpose !== 'string' ||
    destination.purpose.length < 8 ||
    destination.purpose.length > 256 ||
    /[\r\n]/.test(destination.purpose)
  ) {
    errors.push(`${path}.purpose must be a reviewed 8-256 character single-line description.`);
  }
  if (!Array.isArray(destination.approvedApiScope) || destination.approvedApiScope.length === 0) {
    errors.push(`${path}.approvedApiScope must list at least one exact API scope.`);
  } else {
    const normalizedScopes = [];
    destination.approvedApiScope.forEach((scope, scopeIndex) => {
      if (
        typeof scope !== 'string' ||
        !API_SCOPE_PATTERN.test(scope) ||
        /[*?&#@]/.test(scope) ||
        scope.includes('..') ||
        scope.includes('://')
      ) {
        errors.push(
          `${path}.approvedApiScope[${scopeIndex}] must be an exact non-wildcard, query-free scope.`,
        );
      }
      normalizedScopes.push(String(scope).toLowerCase());
    });
    if (new Set(normalizedScopes).size !== normalizedScopes.length) {
      errors.push(`${path}.approvedApiScope must not contain duplicates.`);
    }
  }

  const reviewExpiresAt = parseDate(
    destination.reviewExpiresAt,
    ISO_INSTANT_PATTERN,
    `${path}.reviewExpiresAt`,
    errors,
    { allowNotRun: mode === 'proposed' },
  );
  if (reviewExpiresAt !== undefined && reviewExpiresAt <= nowMs) {
    errors.push(`${path}.reviewExpiresAt must be in the future; stale approvals are rejected.`);
  }

  assertExactKeys(destination.endpoint, OBJECT_KEYS.endpoint, `${path}.endpoint`, errors);
  if (isPlainObject(destination.endpoint)) {
    assertEnum(destination.endpoint.scheme, ['https', 'wss'], `${path}.endpoint.scheme`, errors);
    validateHostname(destination.endpoint.hostname, `${path}.endpoint.hostname`, errors);
    if (destination.endpoint.port !== 443) {
      errors.push(`${path}.endpoint.port must equal 443.`);
    }
    assertExactKeys(
      destination.endpoint.redirects,
      OBJECT_KEYS.redirects,
      `${path}.endpoint.redirects`,
      errors,
    );
    const redirects = destination.endpoint.redirects;
    if (isPlainObject(redirects)) {
      assertEnum(
        redirects.mode,
        ['DENY_ALL', 'EXACT_HOST_ALLOWLIST'],
        `${path}.endpoint.redirects.mode`,
        errors,
      );
      if (!Array.isArray(redirects.allowedHostnames)) {
        errors.push(`${path}.endpoint.redirects.allowedHostnames must be an array.`);
      } else {
        const normalized = [];
        redirects.allowedHostnames.forEach((hostname, redirectIndex) => {
          validateHostname(
            hostname,
            `${path}.endpoint.redirects.allowedHostnames[${redirectIndex}]`,
            errors,
          );
          if (hostname === destination.endpoint.hostname) {
            errors.push(`${path}.endpoint.redirects must not repeat the primary hostname.`);
          }
          normalized.push(String(hostname).toLowerCase());
        });
        if (new Set(normalized).size !== normalized.length) {
          errors.push(`${path}.endpoint.redirects.allowedHostnames must not contain duplicates.`);
        }
      }
      if (redirects.forwardCredentials !== 'NEVER') {
        errors.push(`${path}.endpoint.redirects.forwardCredentials must equal NEVER.`);
      }
      assertInteger(redirects.maxHops, 0, 1, `${path}.endpoint.redirects.maxHops`, errors);
      if (
        redirects.mode === 'DENY_ALL' &&
        (redirects.allowedHostnames?.length !== 0 || redirects.maxHops !== 0)
      ) {
        errors.push(`${path}.endpoint.redirects DENY_ALL requires an empty list and zero hops.`);
      }
      if (
        redirects.mode === 'EXACT_HOST_ALLOWLIST' &&
        (redirects.allowedHostnames?.length < 1 ||
          redirects.allowedHostnames?.length > 3 ||
          redirects.maxHops !== 1)
      ) {
        errors.push(`${path}.endpoint.redirects exact allowlist requires 1-3 hosts and one hop.`);
      }
      if (destination.endpoint.scheme === 'wss' && redirects.mode !== 'DENY_ALL') {
        errors.push(`${path}.endpoint.redirects must be DENY_ALL for WebSocket destinations.`);
      }
    }
  }

  assertExactKeys(destination.owners, OBJECT_KEYS.owners, `${path}.owners`, errors);
  if (isPlainObject(destination.owners)) {
    assertReference(destination.owners.provider, `${path}.owners.provider`, errors);
    for (const field of ['service', 'availability', 'security', 'privacy', 'finance']) {
      assertRoleAlias(destination.owners[field], `${path}.owners.${field}`, errors);
    }
  }

  assertExactKeys(destination.data, OBJECT_KEYS.data, `${path}.data`, errors);
  if (isPlainObject(destination.data)) {
    assertUniqueStringArray(
      destination.data.requestClassifications,
      DATA_CLASSIFICATIONS,
      `${path}.data.requestClassifications`,
      errors,
    );
    assertUniqueStringArray(
      destination.data.responseClassifications,
      DATA_CLASSIFICATIONS,
      `${path}.data.responseClassifications`,
      errors,
    );
    for (const field of ['requestClassifications', 'responseClassifications']) {
      const values = destination.data[field];
      if (Array.isArray(values) && values.includes('NONE') && values.length !== 1) {
        errors.push(`${path}.data.${field} cannot combine NONE with another classification.`);
      }
    }
    assertEnum(
      destination.data.credentialTransport,
      ['NONE', 'AUTHORIZATION_HEADER', 'X_API_KEY_HEADER', 'SIGNED_HEADERS', 'MUTUAL_TLS'],
      `${path}.data.credentialTransport`,
      errors,
    );
    if (destination.data.credentialTransport === 'NONE') {
      if (destination.credentialReference !== 'NOT_APPLICABLE') {
        errors.push(`${path}.credentialReference must equal NOT_APPLICABLE without credentials.`);
      }
    } else if (
      ['approved', 'final'].includes(mode) ||
      destination.credentialReference !== 'NOT_RUN'
    ) {
      assertReference(destination.credentialReference, `${path}.credentialReference`, errors);
      if (!String(destination.credentialReference).startsWith('credential-ref:')) {
        errors.push(`${path}.credentialReference must use an opaque credential-ref: reference.`);
      }
    }
  }

  assertExactKeys(destination.tls, OBJECT_KEYS.tls, `${path}.tls`, errors);
  if (isPlainObject(destination.tls)) {
    assertEnum(
      destination.tls.minimumVersion,
      ['TLS1.2', 'TLS1.3'],
      `${path}.tls.minimumVersion`,
      errors,
    );
    const tlsConstants = {
      certificateValidation: 'SYSTEM_TRUST_STRICT',
      hostnameVerification: 'REQUIRED',
      sni: 'REQUIRED',
      allowInvalidCertificates: false,
    };
    for (const [field, expected] of Object.entries(tlsConstants)) {
      if (destination.tls[field] !== expected) {
        errors.push(`${path}.tls.${field} must equal ${String(expected)}.`);
      }
    }
  }

  assertExactKeys(destination.dns, OBJECT_KEYS.dns, `${path}.dns`, errors);
  if (isPlainObject(destination.dns)) {
    const dnsConstants = {
      resolution: 'SYSTEM_DNS',
      failureMode: 'FAIL_CLOSED',
      hostnamePinning: 'DISABLED',
    };
    for (const [field, expected] of Object.entries(dnsConstants)) {
      if (destination.dns[field] !== expected) {
        errors.push(`${path}.dns.${field} must equal ${expected}.`);
      }
    }
    assertEnum(
      destination.dns.privateAddressResponse,
      ['DENY', 'ALLOW_APPROVED_PRIVATE_ENDPOINT_ONLY'],
      `${path}.dns.privateAddressResponse`,
      errors,
    );
  }

  assertExactKeys(destination.resilience, OBJECT_KEYS.resilience, `${path}.resilience`, errors);
  if (isPlainObject(destination.resilience)) {
    assertInteger(
      destination.resilience.connectTimeoutMs,
      100,
      10000,
      `${path}.resilience.connectTimeoutMs`,
      errors,
    );
    assertInteger(
      destination.resilience.requestTimeoutMs,
      100,
      60000,
      `${path}.resilience.requestTimeoutMs`,
      errors,
    );
    if (
      Number.isInteger(destination.resilience.connectTimeoutMs) &&
      Number.isInteger(destination.resilience.requestTimeoutMs) &&
      destination.resilience.requestTimeoutMs < destination.resilience.connectTimeoutMs
    ) {
      errors.push(`${path}.resilience.requestTimeoutMs cannot be below connectTimeoutMs.`);
    }
    assertInteger(
      destination.resilience.maxAttempts,
      1,
      5,
      `${path}.resilience.maxAttempts`,
      errors,
    );
    if (destination.resilience.retryBackoff !== 'EXPONENTIAL_JITTER') {
      errors.push(`${path}.resilience.retryBackoff must equal EXPONENTIAL_JITTER.`);
    }
    if (destination.resilience.retryNonIdempotent !== 'NEVER') {
      errors.push(`${path}.resilience.retryNonIdempotent must equal NEVER.`);
    }
    assertUniqueStringArray(
      destination.resilience.retryOn,
      ['CONNECT_TIMEOUT', 'HTTP_429', 'HTTP_502', 'HTTP_503'],
      `${path}.resilience.retryOn`,
      errors,
    );
    assertExactKeys(
      destination.resilience.circuitBreaker,
      OBJECT_KEYS.circuitBreaker,
      `${path}.resilience.circuitBreaker`,
      errors,
    );
    if (isPlainObject(destination.resilience.circuitBreaker)) {
      const circuitBreaker = destination.resilience.circuitBreaker;
      assertInteger(
        circuitBreaker.failureThreshold,
        2,
        20,
        `${path}.resilience.circuitBreaker.failureThreshold`,
        errors,
      );
      assertInteger(
        circuitBreaker.openSeconds,
        5,
        900,
        `${path}.resilience.circuitBreaker.openSeconds`,
        errors,
      );
      assertInteger(
        circuitBreaker.halfOpenRequests,
        1,
        5,
        `${path}.resilience.circuitBreaker.halfOpenRequests`,
        errors,
      );
      if (circuitBreaker.action !== 'FAIL_CLOSED') {
        errors.push(`${path}.resilience.circuitBreaker.action must equal FAIL_CLOSED.`);
      }
    }
  }

  assertExactKeys(destination.fallback, OBJECT_KEYS.fallback, `${path}.fallback`, errors);
  if (isPlainObject(destination.fallback)) {
    assertEnum(
      destination.fallback.behavior,
      ['FAIL_CLOSED', 'DEGRADE_WITHOUT_EXTERNAL_DATA', 'USE_APPROVED_ALTERNATE'],
      `${path}.fallback.behavior`,
      errors,
    );
    if (destination.fallback.serviceBorrowing !== 'PROHIBITED') {
      errors.push(`${path}.fallback.serviceBorrowing must equal PROHIBITED.`);
    }
    if (
      ['FAIL_CLOSED', 'DEGRADE_WITHOUT_EXTERNAL_DATA'].includes(destination.fallback.behavior) &&
      destination.fallback.alternateDestinationId !== 'NOT_APPLICABLE'
    ) {
      errors.push(`${path}.fallback.alternateDestinationId must equal NOT_APPLICABLE.`);
    }
    if (
      destination.fallback.behavior === 'USE_APPROVED_ALTERNATE' &&
      !DESTINATION_ID_PATTERN.test(destination.fallback.alternateDestinationId ?? '')
    ) {
      errors.push(`${path}.fallback.alternateDestinationId must be an exact destination ID.`);
    }
    if (destination.fallback.alternateDestinationId === destination.id) {
      errors.push(`${path}.fallback cannot refer to its own destination ID.`);
    }
  }

  assertExactKeys(destination.logging, OBJECT_KEYS.logging, `${path}.logging`, errors);
  if (isPlainObject(destination.logging)) {
    assertUniqueStringArray(
      destination.logging.allowedMetadata,
      LOG_METADATA,
      `${path}.logging.allowedMetadata`,
      errors,
    );
    if (!Array.isArray(destination.logging.redactedHeaders)) {
      errors.push(`${path}.logging.redactedHeaders must be an array.`);
    } else {
      const normalized = destination.logging.redactedHeaders.map((entry) =>
        String(entry).toLowerCase(),
      );
      if (new Set(normalized).size !== normalized.length) {
        errors.push(`${path}.logging.redactedHeaders must not contain duplicates.`);
      }
      for (const requiredHeader of REQUIRED_REDACTED_HEADERS) {
        if (!normalized.includes(requiredHeader)) {
          errors.push(`${path}.logging.redactedHeaders must include ${requiredHeader}.`);
        }
      }
      destination.logging.redactedHeaders.forEach((header, headerIndex) => {
        if (
          typeof header !== 'string' ||
          header !== header.toLowerCase() ||
          !/^[a-z][a-z0-9-]{0,62}$/.test(header)
        ) {
          errors.push(`${path}.logging.redactedHeaders[${headerIndex}] must be a header name.`);
        }
      });
    }
    const loggingConstants = {
      bodyLogging: 'DISABLED',
      queryLogging: 'DISABLED',
      secretFieldPolicy: 'DROP_AND_REDACT',
    };
    for (const [field, expected] of Object.entries(loggingConstants)) {
      if (destination.logging[field] !== expected) {
        errors.push(`${path}.logging.${field} must equal ${expected}.`);
      }
    }
    assertInteger(
      destination.logging.retentionDays,
      1,
      90,
      `${path}.logging.retentionDays`,
      errors,
    );
    assertRoleAlias(destination.logging.alertOwner, `${path}.logging.alertOwner`, errors, {
      allowSentinel: mode === 'proposed',
    });
    if (['approved', 'final'].includes(mode) && destination.logging.alertOwner === 'NOT_APPROVED') {
      errors.push(`${path}.logging.alertOwner must be approved.`);
    }
  }

  validateMonitoring(destination.monitoring, `${path}.monitoring`, errors, mode, nowMs);
  validateDestinationCost(destination.cost, `${path}.cost`, errors, mode, nowMs);

  assertExactKeys(
    destination.killSwitch,
    OBJECT_KEYS.destinationKillSwitch,
    `${path}.killSwitch`,
    errors,
  );
  if (isPlainObject(destination.killSwitch)) {
    assertRoleAlias(destination.killSwitch.owner, `${path}.killSwitch.owner`, errors, {
      allowSentinel: mode === 'proposed',
    });
    if (destination.killSwitch.action !== 'DENY_DESTINATION') {
      errors.push(`${path}.killSwitch.action must equal DENY_DESTINATION.`);
    }
    if (mode === 'proposed') {
      if (
        destination.killSwitch.activationReference !== 'NOT_RUN' ||
        destination.killSwitch.lastTestedAt !== 'NOT_RUN' ||
        destination.killSwitch.evidence !== 'NOT_RUN'
      ) {
        errors.push(`${path}.killSwitch evidence must remain NOT_RUN in proposed mode.`);
      }
    } else if (mode === 'approved') {
      assertReference(
        destination.killSwitch.activationReference,
        `${path}.killSwitch.activationReference`,
        errors,
      );
      if (
        destination.killSwitch.lastTestedAt !== 'NOT_RUN' ||
        destination.killSwitch.evidence !== 'NOT_RUN'
      ) {
        errors.push(`${path}.killSwitch runtime evidence must remain NOT_RUN in approved mode.`);
      }
    } else {
      assertReference(
        destination.killSwitch.activationReference,
        `${path}.killSwitch.activationReference`,
        errors,
      );
      const lastTestedAt = parseDate(
        destination.killSwitch.lastTestedAt,
        ISO_INSTANT_PATTERN,
        `${path}.killSwitch.lastTestedAt`,
        errors,
      );
      if (lastTestedAt !== undefined) {
        if (lastTestedAt > nowMs) {
          errors.push(`${path}.killSwitch.lastTestedAt cannot be in the future.`);
        }
        const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
        if (lastTestedAt < nowMs - ninetyDaysMs) {
          errors.push(`${path}.killSwitch.lastTestedAt is stale; retest within 90 days.`);
        }
      }
      if (destination.killSwitch.evidence !== 'PASS') {
        errors.push(`${path}.killSwitch.evidence must equal PASS in final mode.`);
      }
    }
  }
}

function findSecretMaterial(value, path = 'policy', findings = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findSecretMaterial(entry, `${path}[${index}]`, findings));
    return findings;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      findSecretMaterial(entry, `${path}.${key}`, findings);
    }
    return findings;
  }
  if (typeof value !== 'string') {
    return findings;
  }
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value) ||
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/.test(value) ||
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/.test(value) ||
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(value) ||
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/.test(value) ||
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(value) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value) ||
    /\b0x[a-fA-F0-9]{40}\b/.test(value) ||
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i.test(value) ||
    /(?:password|passwd|client[_-]?secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+/i.test(
      value,
    ) ||
    /:\/\/[^/\s]+@/.test(value)
  ) {
    findings.push(`${path} appears to contain credential or secret material.`);
  }
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(value)) {
    findings.push(`${path} appears to contain an SSN.`);
  }
  if (
    /(?:^|[^\dA-Za-z])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?![\dA-Za-z])/.test(
      value,
    ) ||
    /(?:^|[^\dA-Za-z])\+[1-9](?:[\s().-]*\d){7,14}(?![\dA-Za-z])/.test(value) ||
    /(?:^|[^\dA-Za-z])1?[2-9]\d{2}[2-9]\d{6}(?![\dA-Za-z])/.test(value)
  ) {
    findings.push(`${path} appears to contain a phone number.`);
  }
  if (isFreeTextOrReferencePath(path)) {
    if (containsPublicIpAddress(value)) {
      findings.push(
        `${path} appears to contain a public IP address in a free-text or reference field.`,
      );
    }
  }
  return findings;
}

function isFreeTextOrReferencePath(path) {
  const field = path.match(/\.([A-Za-z][A-Za-z0-9]*)(?:\[\d+\])?$/)?.[1];
  return (
    field === 'purpose' ||
    field === 'policyId' ||
    field === 'provider' ||
    field?.endsWith('Reference')
  );
}

function containsPublicIpAddress(value) {
  for (const match of value.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    const octets = match[0].split('.').map(Number);
    if (octets.some((octet) => octet > 255)) {
      continue;
    }
    const [first, second, third] = octets;
    const nonPublic =
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0 && third === 0) ||
      (first === 192 && second === 0 && third === 2) ||
      (first === 192 && second === 88 && third === 99) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224;
    if (!nonPublic) {
      return true;
    }
  }
  for (const match of value.matchAll(/[0-9A-Fa-f:]{2,}/g)) {
    const candidate = match[0];
    if (!candidate.includes(':')) {
      continue;
    }
    const compressedParts = candidate.split('::');
    if (compressedParts.length > 2) {
      continue;
    }
    const left = compressedParts[0] === '' ? [] : compressedParts[0].split(':');
    const right =
      compressedParts.length === 1 || compressedParts[1] === ''
        ? []
        : compressedParts[1].split(':');
    const parts = [...left, ...right];
    if (
      parts.some((part) => !/^[a-f0-9]{1,4}$/i.test(part)) ||
      (compressedParts.length === 1 && parts.length !== 8) ||
      (compressedParts.length === 2 && parts.length >= 8)
    ) {
      continue;
    }
    const omitted = compressedParts.length === 2 ? 8 - parts.length : 0;
    const hextets = [
      ...left.map((part) => Number.parseInt(part, 16)),
      ...Array(omitted).fill(0),
      ...right.map((part) => Number.parseInt(part, 16)),
    ];
    const first = hextets[0];
    const nonPublic =
      hextets.every((part) => part === 0) ||
      (hextets.slice(0, 7).every((part) => part === 0) && hextets[7] === 1) ||
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xff00) === 0xff00 ||
      (first === 0x2001 && hextets[1] === 0x0db8);
    if (!nonPublic) {
      return true;
    }
  }
  return false;
}

export function validateBrowserEgressSource(source) {
  const errors = [];
  if (typeof source !== 'string') {
    return { ok: false, errors: ['Browser egress source must be text.'] };
  }
  const production = source.match(/PRODUCTION_CONNECT_POLICY\s*=\s*(["'])(.*?)\1/)?.[2];
  const development = source.match(/LOCAL_DEVELOPMENT_CONNECT_POLICY\s*=\s*(["'])(.*?)\1/)?.[2];
  const productionScript = source.match(/PRODUCTION_SCRIPT_POLICY\s*=\s*(["'])(.*?)\1/)?.[2];
  const developmentScript = source.match(
    /LOCAL_DEVELOPMENT_SCRIPT_POLICY\s*=\s*(["'])(.*?)\1/,
  )?.[2];
  const resourcePolicy = source.match(/BASE_RESOURCE_POLICY\s*=\s*(["'])(.*?)\1/)?.[2];
  const expectedResourcePolicy =
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; frame-src 'none'; worker-src 'self' blob:; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'";
  if (production !== "connect-src 'self'") {
    errors.push("Production browser connect-src must equal exactly connect-src 'self'.");
  }
  if (production && /(?:https?|wss?):|\*/i.test(production)) {
    errors.push('Production browser connect-src must not allow external schemes or wildcards.');
  }
  if (
    development !== "connect-src 'self' ws://127.0.0.1:* ws://localhost:*" ||
    /(?:0\.0\.0\.0|\[::\])/.test(development ?? '')
  ) {
    errors.push('Development browser connect-src may add only loopback WebSocket endpoints.');
  }
  if (productionScript !== "script-src 'self' 'unsafe-inline'") {
    errors.push('Production browser script-src must remain same-origin only.');
  }
  if (developmentScript !== "script-src 'self' 'unsafe-inline' 'unsafe-eval'") {
    errors.push('Development script-src may add only the local framework evaluation exception.');
  }
  if (resourcePolicy !== expectedResourcePolicy) {
    errors.push(
      'Browser resource policy must deny external scripts, styles, images, fonts, media, frames, workers, manifests, forms, and objects.',
    );
  }
  const localRuntimeSelection =
    /const\s+localRuntime\s*=\s*runtime\s*===\s*['"]development['"]\s*\|\|\s*runtime\s*===\s*['"]test['"]\s*;/.test(
      source,
    );
  const connectSelection =
    /const\s+connectPolicy\s*=\s*localRuntime\s*\?\s*LOCAL_DEVELOPMENT_CONNECT_POLICY\s*:\s*PRODUCTION_CONNECT_POLICY\s*;/.test(
      source,
    );
  const scriptSelection =
    /const\s+scriptPolicy\s*=\s*localRuntime\s*\?\s*LOCAL_DEVELOPMENT_SCRIPT_POLICY\s*:\s*PRODUCTION_SCRIPT_POLICY\s*;/.test(
      source,
    );
  const composedPolicy =
    /return\s+`\$\{connectPolicy\}; \$\{scriptPolicy\}; \$\{BASE_RESOURCE_POLICY\}`\s*;/.test(
      source,
    );
  if (!localRuntimeSelection || !connectSelection || !scriptSelection || !composedPolicy) {
    errors.push('Browser policy selection must fail closed and compose every reviewed directive.');
  }
  return { ok: errors.length === 0, errors };
}

export function validateEgressPolicy(
  policy,
  {
    mode = 'example',
    expectedEnvironment,
    expectedAccount,
    expectedRegion,
    expectedSourceRevision,
    expectedBillingControlReference,
    expectedBillingControlConfigurationSha256,
    expectedPolicyConfigurationSha256,
    now = new Date(),
  } = {},
) {
  const errors = [];
  assertExactKeys(policy, TOP_LEVEL_KEYS, 'policy', errors);
  if (!isPlainObject(policy)) {
    return { ok: false, errors };
  }
  if (!['example', 'proposed', 'approved', 'final'].includes(mode)) {
    errors.push("Validation mode must be 'example', 'proposed', 'approved', or 'final'.");
  }
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) {
    errors.push('Validation time must be a real Date.');
  }
  if (policy.schemaVersion !== 1) {
    errors.push('policy.schemaVersion must equal 1.');
  }

  assertExactKeys(policy.environment, OBJECT_KEYS.environment, 'policy.environment', errors);
  if (isPlainObject(policy.environment)) {
    if (policy.environment.application !== 'crypto-lending') {
      errors.push('policy.environment.application must equal crypto-lending.');
    }
    if (mode === 'example') {
      if (
        policy.environment.name !== 'NOT_APPROVED' ||
        policy.environment.accountId !== 'NOT_APPROVED' ||
        policy.environment.applicationRegion !== 'NOT_APPROVED' ||
        policy.environment.sourceRevision !== 'NOT_RUN'
      ) {
        errors.push('policy.environment example identity fields must remain unapproved/not run.');
      }
    } else {
      if (!ENVIRONMENT_PATTERN.test(policy.environment.name ?? '')) {
        errors.push(
          'policy.environment.name must identify an explicit non-production environment.',
        );
      }
      if (!/^\d{12}$/.test(policy.environment.accountId ?? '')) {
        errors.push('policy.environment.accountId must be an explicit 12-digit AWS account ID.');
      }
      if (!REGION_PATTERN.test(policy.environment.applicationRegion ?? '')) {
        errors.push('policy.environment.applicationRegion must be an explicit AWS Region.');
      }
      if (!SOURCE_REVISION_PATTERN.test(policy.environment.sourceRevision ?? '')) {
        errors.push('policy.environment.sourceRevision must be a full lowercase Git commit SHA.');
      }
      const expectedFormats = [
        ['expectedEnvironment', expectedEnvironment, ENVIRONMENT_PATTERN],
        ['expectedAccount', expectedAccount, /^\d{12}$/],
        ['expectedRegion', expectedRegion, REGION_PATTERN],
        ['expectedSourceRevision', expectedSourceRevision, SOURCE_REVISION_PATTERN],
      ];
      if (
        expectedEnvironment === undefined ||
        expectedAccount === undefined ||
        expectedRegion === undefined ||
        expectedSourceRevision === undefined
      ) {
        errors.push(
          'Non-example validation requires exact expected environment, account, Region, and source revision inputs.',
        );
      }
      for (const [label, expected, pattern] of expectedFormats) {
        if (expected !== undefined && !pattern.test(expected)) {
          errors.push(`${label} has an invalid format.`);
        }
      }
      const expectedValues = [
        ['environment', expectedEnvironment, policy.environment.name],
        ['account', expectedAccount, policy.environment.accountId],
        ['Region', expectedRegion, policy.environment.applicationRegion],
        ['source revision', expectedSourceRevision, policy.environment.sourceRevision],
      ];
      for (const [label, expected, actual] of expectedValues) {
        if (expected !== undefined && expected !== actual) {
          errors.push(`The policy ${label} '${actual}' does not match '${expected}'.`);
        }
      }
    }
  }

  assertExactKeys(policy.dependencies, OBJECT_KEYS.dependencies, 'policy.dependencies', errors);
  if (isPlainObject(policy.dependencies)) {
    validateDependency(
      policy.dependencies.applicationBaseline,
      'KAN-34',
      'policy.dependencies.applicationBaseline',
      errors,
      mode,
    );
    validateDependency(
      policy.dependencies.authenticationSessions,
      'KAN-37',
      'policy.dependencies.authenticationSessions',
      errors,
      mode,
    );
    validateDependency(
      policy.dependencies.rpcIndexing,
      'KAN-62',
      'policy.dependencies.rpcIndexing',
      errors,
      mode,
    );
  }
  validateArchitecture(policy.architecture, 'policy.architecture', errors, mode, nowMs);
  if (['approved', 'final'].includes(mode)) {
    if (
      !/^billing-control:[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/.test(
        expectedBillingControlReference ?? '',
      ) ||
      !referenceContainsTicket(expectedBillingControlReference, 'KAN-229')
    ) {
      errors.push(
        'Approved validation requires the exact reference of a validated KAN-229 billing control record.',
      );
    } else if (
      policy.architecture?.billingControlRecordReference !== expectedBillingControlReference
    ) {
      errors.push(
        'policy.architecture.billingControlRecordReference does not match the validated KAN-229 record.',
      );
    }
    if (!/^[a-f0-9]{64}$/.test(expectedBillingControlConfigurationSha256 ?? '')) {
      errors.push(
        'Approved validation requires the exact configuration digest of a validated KAN-229 billing control record.',
      );
    } else if (
      policy.architecture?.billingControlConfigurationSha256 !==
      expectedBillingControlConfigurationSha256
    ) {
      errors.push(
        'policy.architecture.billingControlConfigurationSha256 does not match the validated KAN-229 record.',
      );
    }
  }
  validateAuthority(policy.authority, 'policy.authority', errors, mode, nowMs);

  const computedPolicyConfigurationSha256 = createHash('sha256')
    .update(canonicalizeEgressPolicyConfiguration(policy), 'utf8')
    .digest('hex');
  if (mode === 'final') {
    if (!/^[a-f0-9]{64}$/.test(expectedPolicyConfigurationSha256 ?? '')) {
      errors.push(
        'Final validation requires an independently supplied expected policy configuration SHA-256.',
      );
    } else if (expectedPolicyConfigurationSha256 !== computedPolicyConfigurationSha256) {
      errors.push(
        'The computed policy configuration digest does not match the independently supplied expected digest.',
      );
    }
  }

  let evidenceObservedAt;
  assertExactKeys(policy.evidence, OBJECT_KEYS.evidence, 'policy.evidence', errors);
  if (isPlainObject(policy.evidence)) {
    for (const field of EVIDENCE_STATUS_FIELDS) {
      assertEnum(policy.evidence[field], EVIDENCE_STATUSES, `policy.evidence.${field}`, errors);
    }
    if (mode === 'example') {
      if (Object.values(policy.evidence).some((value) => value !== 'NOT_RUN')) {
        errors.push('policy.evidence must remain entirely NOT_RUN in the example.');
      }
    } else if (mode === 'proposed') {
      if (!['NOT_RUN', 'PASS'].includes(policy.evidence.localPolicyValidation)) {
        errors.push(
          'policy.evidence.localPolicyValidation must be NOT_RUN or PASS in proposed mode.',
        );
      }
      for (const field of EVIDENCE_STATUS_FIELDS.filter(
        (field) => field !== 'localPolicyValidation',
      )) {
        if (policy.evidence[field] !== 'NOT_RUN') {
          errors.push(`policy.evidence.${field} must remain NOT_RUN in proposed mode.`);
        }
      }
      if (
        policy.evidence.observedAtUtc !== 'NOT_RUN' ||
        policy.evidence.evidenceIndexReference !== 'NOT_RUN' ||
        policy.evidence.policyConfigurationSha256 !== 'NOT_RUN'
      ) {
        errors.push('policy.evidence observation fields must remain NOT_RUN in proposed mode.');
      }
    } else if (mode === 'approved') {
      if (policy.evidence.localPolicyValidation !== 'PASS') {
        errors.push('policy.evidence.localPolicyValidation must equal PASS in approved mode.');
      }
      for (const field of EVIDENCE_STATUS_FIELDS.filter(
        (field) => field !== 'localPolicyValidation',
      )) {
        if (policy.evidence[field] !== 'NOT_RUN') {
          errors.push(`policy.evidence.${field} must remain NOT_RUN in approved mode.`);
        }
      }
      if (
        policy.evidence.observedAtUtc !== 'NOT_RUN' ||
        policy.evidence.evidenceIndexReference !== 'NOT_RUN' ||
        policy.evidence.policyConfigurationSha256 !== 'NOT_RUN'
      ) {
        errors.push('policy.evidence observation fields must remain NOT_RUN in approved mode.');
      }
    } else {
      for (const field of EVIDENCE_STATUS_FIELDS) {
        if (policy.evidence[field] !== 'PASS') {
          errors.push(`policy.evidence.${field} must equal PASS in final mode.`);
        }
      }
      evidenceObservedAt = parseDate(
        policy.evidence.observedAtUtc,
        ISO_INSTANT_PATTERN,
        'policy.evidence.observedAtUtc',
        errors,
      );
      if (evidenceObservedAt !== undefined) {
        if (evidenceObservedAt > nowMs) {
          errors.push('policy.evidence.observedAtUtc cannot be in the future.');
        }
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        if (evidenceObservedAt < nowMs - sevenDaysMs) {
          errors.push('policy.evidence.observedAtUtc must be refreshed within seven days.');
        }
      }
      assertReference(
        policy.evidence.evidenceIndexReference,
        'policy.evidence.evidenceIndexReference',
        errors,
      );
      if (!String(policy.evidence.evidenceIndexReference).startsWith('evidence-index:')) {
        errors.push(
          'policy.evidence.evidenceIndexReference must use a protected evidence-index: reference.',
        );
      }
      if (policy.evidence.policyConfigurationSha256 !== computedPolicyConfigurationSha256) {
        errors.push(
          'policy.evidence.policyConfigurationSha256 must bind final evidence to the exact validated policy configuration.',
        );
      }
      const expectedEvidencePrefix = `evidence-index:KAN-231:${computedPolicyConfigurationSha256}:`;
      if (!String(policy.evidence.evidenceIndexReference).startsWith(expectedEvidencePrefix)) {
        errors.push(
          `policy.evidence.evidenceIndexReference must begin with ${expectedEvidencePrefix}.`,
        );
      }
    }
  }

  if (!Array.isArray(policy.destinations)) {
    errors.push('policy.destinations must be an array.');
  } else {
    if (policy.destinations.length > 64) {
      errors.push('policy.destinations must contain no more than 64 entries.');
    }
    policy.destinations.forEach((destination, index) =>
      validateDestination(destination, index, errors, mode, nowMs),
    );

    const destinationIds = policy.destinations.map((destination) =>
      String(destination?.id).toLowerCase(),
    );
    if (new Set(destinationIds).size !== destinationIds.length) {
      errors.push('policy.destinations must not contain duplicate destination IDs.');
    }
    const endpointKeys = policy.destinations.map((destination) =>
      [
        destination?.serviceAccess?.callerService,
        destination?.endpoint?.scheme,
        destination?.endpoint?.hostname,
        destination?.endpoint?.port,
      ]
        .map((part) => String(part).toLowerCase())
        .join('|'),
    );
    if (new Set(endpointKeys).size !== endpointKeys.length) {
      errors.push('policy.destinations must not duplicate a caller and endpoint tuple.');
    }
    const destinationsById = new Map(
      policy.destinations.map((destination) => [destination?.id, destination]),
    );
    const destinationsByHostname = new Map();
    for (const destination of policy.destinations) {
      const hostname = String(destination?.endpoint?.hostname).toLowerCase();
      const entries = destinationsByHostname.get(hostname) ?? [];
      entries.push(destination);
      destinationsByHostname.set(hostname, entries);
    }
    const comparableConstraints = (destination, alternate) => [
      ['scheme', destination.endpoint?.scheme, alternate.endpoint?.scheme],
      ['port', destination.endpoint?.port, alternate.endpoint?.port],
      [
        'execution identity and network control',
        JSON.stringify(sortedJson(destination.serviceAccess)),
        JSON.stringify(sortedJson(alternate.serviceAccess)),
      ],
      ['service', destination.service, alternate.service],
      ['dependency ticket', destination.dependencyTicket, alternate.dependencyTicket],
      [
        'dependency decision',
        destination.dependencyDecisionReference,
        alternate.dependencyDecisionReference,
      ],
      [
        'data constraints',
        JSON.stringify(sortedJson(destination.data)),
        JSON.stringify(sortedJson(alternate.data)),
      ],
      ['credential reference', destination.credentialReference, alternate.credentialReference],
      [
        'TLS constraints',
        JSON.stringify(sortedJson(destination.tls)),
        JSON.stringify(sortedJson(alternate.tls)),
      ],
      [
        'DNS constraints',
        JSON.stringify(sortedJson(destination.dns)),
        JSON.stringify(sortedJson(alternate.dns)),
      ],
      [
        'API scope',
        JSON.stringify([...new Set(destination.approvedApiScope ?? [])].sort()),
        JSON.stringify([...new Set(alternate.approvedApiScope ?? [])].sort()),
      ],
    ];
    const redirectEdges = new Map();
    policy.destinations.forEach((destination, index) => {
      for (const redirect of destination?.endpoint?.redirects?.allowedHostnames ?? []) {
        const candidates = destinationsByHostname.get(String(redirect).toLowerCase()) ?? [];
        const compatible = candidates.filter(
          (candidate) =>
            candidate.id !== destination.id &&
            candidate.endpoint?.scheme === destination.endpoint?.scheme &&
            comparableConstraints(destination, candidate).every(
              ([, primaryValue, alternateValue]) => primaryValue === alternateValue,
            ),
        );
        if (compatible.length !== 1) {
          errors.push(
            `policy.destinations[${index}] redirect '${redirect}' must match exactly one explicit destination with the same caller/service/decision/data/TLS/API scope.`,
          );
          continue;
        }
        const target = compatible[0];
        if (target.status !== 'APPROVED') {
          errors.push(
            `policy.destinations[${index}] redirect target '${target.id}' must be APPROVED.`,
          );
        }
        const edges = redirectEdges.get(destination.id) ?? [];
        edges.push(target.id);
        redirectEdges.set(destination.id, edges);
      }
    });

    const fallbackEdges = new Map();
    policy.destinations.forEach((destination, index) => {
      const fixedDependency = FIXED_SERVICE_DEPENDENCIES[destination?.service];
      if (fixedDependency) {
        const dependency =
          fixedDependency === 'KAN-37'
            ? policy.dependencies?.authenticationSessions
            : policy.dependencies?.rpcIndexing;
        if (
          (['approved', 'final'].includes(mode) || destination?.status === 'APPROVED') &&
          destination?.dependencyDecisionReference !== dependency?.decisionReference
        ) {
          errors.push(
            `policy.destinations[${index}].dependencyDecisionReference must match the approved ${fixedDependency} decision.`,
          );
        }
      }

      if (destination?.fallback?.behavior !== 'USE_APPROVED_ALTERNATE') {
        return;
      }
      const alternateId = destination.fallback.alternateDestinationId;
      const alternate = destinationsById.get(alternateId);
      if (!alternate) {
        errors.push(
          `policy.destinations[${index}].fallback alternate '${alternateId}' is not listed.`,
        );
        return;
      }
      fallbackEdges.set(destination.id, alternateId);
      if (alternate.status !== 'APPROVED') {
        errors.push(
          `policy.destinations[${index}].fallback alternate '${alternateId}' must be APPROVED.`,
        );
      }
      const exactMatches = comparableConstraints(destination, alternate);
      for (const [label, primaryValue, alternateValue] of exactMatches) {
        if (primaryValue !== alternateValue) {
          errors.push(
            `policy.destinations[${index}].fallback alternate must preserve the ${label}.`,
          );
        }
      }
    });

    const reportedCycles = new Set();
    for (const start of fallbackEdges.keys()) {
      const seen = new Set();
      let cursor = start;
      while (fallbackEdges.has(cursor)) {
        if (seen.has(cursor)) {
          const signature = [...seen].sort().join('|');
          if (!reportedCycles.has(signature)) {
            errors.push('policy.destinations fallback graph must not contain a cycle.');
            reportedCycles.add(signature);
          }
          break;
        }
        seen.add(cursor);
        cursor = fallbackEdges.get(cursor);
      }
    }

    const redirectCycleStarts = new Set();
    const visitRedirect = (destinationId, active = new Set()) => {
      if (active.has(destinationId)) {
        redirectCycleStarts.add(destinationId);
        return;
      }
      const nextActive = new Set(active);
      nextActive.add(destinationId);
      for (const target of redirectEdges.get(destinationId) ?? []) {
        visitRedirect(target, nextActive);
      }
    };
    for (const destinationId of redirectEdges.keys()) {
      visitRedirect(destinationId);
    }
    if (redirectCycleStarts.size > 0) {
      errors.push('policy.destinations redirect graph must not contain a cycle.');
    }

    const combinedEdges = new Map();
    for (const [source, targets] of redirectEdges) {
      combinedEdges.set(source, [...targets]);
    }
    for (const [source, target] of fallbackEdges) {
      const targets = combinedEdges.get(source) ?? [];
      targets.push(target);
      combinedEdges.set(source, targets);
    }
    let combinedCycleFound = false;
    const visitCombined = (destinationId, active = new Set(), complete = new Set()) => {
      if (active.has(destinationId)) {
        combinedCycleFound = true;
        return;
      }
      if (complete.has(destinationId) || combinedCycleFound) {
        return;
      }
      active.add(destinationId);
      for (const target of combinedEdges.get(destinationId) ?? []) {
        visitCombined(target, active, complete);
      }
      active.delete(destinationId);
      complete.add(destinationId);
    };
    const combinedComplete = new Set();
    for (const destinationId of combinedEdges.keys()) {
      visitCombined(destinationId, new Set(), combinedComplete);
    }
    if (combinedCycleFound) {
      errors.push(
        'policy.destinations combined redirect and fallback graph must not contain a cycle.',
      );
    }
  }

  if (mode !== 'example') {
    validateAggregateCostEnvelope(policy, errors);
  }

  if (mode === 'example') {
    if (
      policy.status !== 'NOT_APPROVED' ||
      policy.policyId !== 'NOT_APPROVED' ||
      policy.currentMode !== 'NO_EXTERNAL_EGRESS' ||
      policy.approvedAt !== 'NOT_RUN' ||
      policy.acceptedAt !== 'NOT_RUN' ||
      policy.expiresAt !== 'NOT_RUN' ||
      policy.destinations?.length !== 0
    ) {
      errors.push(
        'The committed example must remain NOT_APPROVED, NO_EXTERNAL_EGRESS, and destination-free.',
      );
    }
  } else if (mode === 'proposed') {
    if (policy.status !== 'PROPOSED') {
      errors.push('policy.status must equal PROPOSED in proposed mode.');
    }
    assertReference(policy.policyId, 'policy.policyId', errors);
    if (policy.currentMode !== 'NO_EXTERNAL_EGRESS') {
      errors.push('policy.currentMode must remain NO_EXTERNAL_EGRESS in proposed mode.');
    }
    if (
      policy.approvedAt !== 'NOT_RUN' ||
      policy.acceptedAt !== 'NOT_RUN' ||
      policy.expiresAt !== 'NOT_RUN'
    ) {
      errors.push('policy approval timestamps must remain NOT_RUN in proposed mode.');
    }
  } else if (['approved', 'final'].includes(mode)) {
    const expectedStatus = mode === 'final' ? 'ACCEPTED' : 'APPROVED';
    if (policy.status !== expectedStatus) {
      errors.push(`policy.status must equal ${expectedStatus} in ${mode} mode.`);
    }
    assertReference(policy.policyId, 'policy.policyId', errors);
    if (policy.currentMode !== 'APPROVED_DESTINATIONS_ONLY') {
      errors.push('policy.currentMode must equal APPROVED_DESTINATIONS_ONLY in approved mode.');
    }
    if (policy.destinations?.length === 0) {
      errors.push('policy.destinations must contain at least one approved destination.');
    }
    const approvedAt = parseDate(
      policy.approvedAt,
      ISO_INSTANT_PATTERN,
      'policy.approvedAt',
      errors,
    );
    const expiresAt = parseDate(policy.expiresAt, ISO_INSTANT_PATTERN, 'policy.expiresAt', errors);
    if (approvedAt !== undefined && approvedAt > nowMs) {
      errors.push('policy.approvedAt cannot be in the future.');
    }
    if (expiresAt !== undefined && expiresAt <= nowMs) {
      errors.push('policy.expiresAt must be in the future; stale approvals are rejected.');
    }
    if (approvedAt !== undefined && expiresAt !== undefined && expiresAt <= approvedAt) {
      errors.push('policy.expiresAt must be later than approvedAt.');
    }
    if (mode === 'approved') {
      if (policy.acceptedAt !== 'NOT_RUN') {
        errors.push('policy.acceptedAt must remain NOT_RUN until final acceptance.');
      }
    } else {
      const acceptedAt = parseDate(
        policy.acceptedAt,
        ISO_INSTANT_PATTERN,
        'policy.acceptedAt',
        errors,
      );
      const verifiedAt = parseDate(
        policy.authority?.verifiedAt,
        ISO_INSTANT_PATTERN,
        'policy.authority.verifiedAt',
        [],
      );
      if (acceptedAt !== undefined && acceptedAt > nowMs) {
        errors.push('policy.acceptedAt cannot be in the future.');
      }
      if (
        evidenceObservedAt !== undefined &&
        approvedAt !== undefined &&
        approvedAt > evidenceObservedAt
      ) {
        errors.push('policy.approvedAt must preserve design approval before final evidence.');
      }
      if (
        evidenceObservedAt !== undefined &&
        verifiedAt !== undefined &&
        verifiedAt > evidenceObservedAt
      ) {
        errors.push(
          'policy.authority.verifiedAt must preserve design verification before final evidence.',
        );
      }
      if (
        evidenceObservedAt !== undefined &&
        acceptedAt !== undefined &&
        acceptedAt <= evidenceObservedAt
      ) {
        errors.push('policy.acceptedAt must be after the final evidence observation.');
      }
      if (approvedAt !== undefined && acceptedAt !== undefined && acceptedAt < approvedAt) {
        errors.push('policy.acceptedAt must be at or after design approval.');
      }
      if (verifiedAt !== undefined && acceptedAt !== undefined && acceptedAt < verifiedAt) {
        errors.push('policy.acceptedAt must be at or after independent design verification.');
      }
    }

    validatePolicyExpiryLimits(policy, expiresAt, errors);

    const hasEcsDestination = policy.destinations?.some(
      (destination) => destination?.serviceAccess?.executionBoundary !== 'BROWSER_WEB',
    );
    if (hasEcsDestination && !PAID_ECS_CONTROLS.includes(policy.architecture?.selectedControl)) {
      errors.push('Approved ECS destinations require an explicitly selected ECS egress control.');
    }
    if (
      policy.architecture?.selectedControl === 'BROWSER_APPLICATION_CONTROLS_ONLY' &&
      hasEcsDestination
    ) {
      errors.push('Browser application controls cannot authorize an ECS destination.');
    }
    const networkControlPrefixes = {
      PRIVATE_ENDPOINTS: 'vpc-endpoint:',
      EGRESS_PROXY_WITH_NAT: 'egress-proxy:',
      NETWORK_FIREWALL_WITH_NAT: 'network-firewall:',
    };
    const expectedNetworkPrefix = networkControlPrefixes[policy.architecture?.selectedControl];
    if (hasEcsDestination && expectedNetworkPrefix) {
      policy.destinations.forEach((destination, index) => {
        if (
          destination?.serviceAccess?.executionBoundary !== 'BROWSER_WEB' &&
          !String(destination?.serviceAccess?.networkControlReference).startsWith(
            expectedNetworkPrefix,
          )
        ) {
          errors.push(
            `policy.destinations[${index}].serviceAccess.networkControlReference must match the selected ${policy.architecture.selectedControl} control.`,
          );
        }
        if (destination?.serviceAccess?.executionBoundary !== 'BROWSER_WEB') {
          const expectedPrivateAddressResponse =
            policy.architecture.selectedControl === 'PRIVATE_ENDPOINTS'
              ? 'ALLOW_APPROVED_PRIVATE_ENDPOINT_ONLY'
              : 'DENY';
          if (destination?.dns?.privateAddressResponse !== expectedPrivateAddressResponse) {
            errors.push(
              `policy.destinations[${index}].dns.privateAddressResponse must equal ${expectedPrivateAddressResponse} for the selected control.`,
            );
          }
        }
      });
    }
    const implementationRoles = new Set(
      (policy.destinations ?? [])
        .flatMap((destination) => [
          destination?.owners?.service,
          destination?.owners?.availability,
          destination?.owners?.security,
          destination?.owners?.privacy,
          destination?.owners?.finance,
          destination?.logging?.alertOwner,
          destination?.monitoring?.owner,
          destination?.killSwitch?.owner,
        ])
        .filter((role) => typeof role === 'string')
        .map((role) => role.toLowerCase()),
    );
    if (implementationRoles.has(String(policy.authority?.independentVerifier).toLowerCase())) {
      errors.push(
        'policy.authority.independentVerifier must be independent from destination owners.',
      );
    }
    if (
      mode === 'final' &&
      implementationRoles.has(String(policy.authority?.acceptanceVerifier).toLowerCase())
    ) {
      errors.push(
        'policy.authority.acceptanceVerifier must be independent from destination implementation roles.',
      );
    }
  }

  errors.push(...findSecretMaterial(policy));

  const canonical = canonicalizeEgressPolicy(policy);
  const configuration = canonicalizeEgressPolicyConfiguration(policy);
  return {
    ok: errors.length === 0,
    errors,
    canonicalSha256: createHash('sha256').update(canonical, 'utf8').digest('hex'),
    policyConfigurationSha256: createHash('sha256').update(configuration, 'utf8').digest('hex'),
  };
}

function parseArguments(argv) {
  const options = { mode: 'example', json: false };
  const names = {
    '--policy': 'policy',
    '--mode': 'mode',
    '--expected-environment': 'expectedEnvironment',
    '--expected-account': 'expectedAccount',
    '--expected-region': 'expectedRegion',
    '--expected-source-revision': 'expectedSourceRevision',
    '--billing-control-record': 'billingControlRecord',
    '--evidence-index-record': 'evidenceIndexRecord',
    '--expected-policy-configuration-sha256': 'expectedPolicyConfigurationSha256',
    '--browser-egress-source': 'browserEgressSource',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    const name = names[argument];
    if (!name) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${argument}.`);
    }
    options[name] = value;
    index += 1;
  }
  if (!options.policy) {
    throw new Error('--policy is required.');
  }
  return options;
}

export function zeroCallMarkers() {
  return {
    networkCallsMade: 0,
    dnsQueriesMade: 0,
    awsCallsMade: 0,
    providerCallsMade: 0,
    subprocessesStarted: 0,
    tlsConnectionsMade: 0,
    cloudResourcesCreated: 0,
    vendorAccountsOrTrialsCreated: 0,
    paidServiceActivations: 0,
  };
}

export function zeroCallReportText() {
  return [
    'Network calls made: 0',
    'DNS queries made: 0',
    'AWS API calls made: 0',
    'Provider calls made: 0',
    'Subprocesses started: 0',
    'TLS connections made: 0',
    'Cloud resources created: 0',
    'Vendor accounts or trials created: 0',
    'Paid service activations: 0',
    '',
  ].join('\n');
}

function writeZeroCallMarkers(stream) {
  stream.write(zeroCallReportText());
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    writeZeroCallMarkers(process.stderr);
    process.exit(2);
  }

  const policyPathErrors = [];
  const policyPath = resolveLocalPath(options.policy, 'Policy path', policyPathErrors);
  if (
    policyPath === undefined ||
    !assertRegularLocalFile(policyPath, 'policy file', policyPathErrors)
  ) {
    for (const error of policyPathErrors) {
      process.stderr.write(`${error}\n`);
    }
    writeZeroCallMarkers(process.stderr);
    process.exit(1);
  }
  let policy;
  try {
    policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  } catch (error) {
    process.stderr.write(`Unable to parse egress policy: ${error.message}\n`);
    writeZeroCallMarkers(process.stderr);
    process.exit(1);
  }

  const semanticOptions = { ...options };
  const preflightErrors = [...policyPathErrors];
  let billingControlRecordPath;
  if (['approved', 'final'].includes(options.mode)) {
    if (!options.billingControlRecord) {
      preflightErrors.push(
        'Approved and final CLI validation requires --billing-control-record pointing to a final outside-repository KAN-229 record.',
      );
    } else {
      const billingValidation = validateBillingControlRecordFile(
        options.billingControlRecord,
        policy,
        {
          expectedEnvironment: options.expectedEnvironment,
          expectedAccount: options.expectedAccount,
          expectedRegion: options.expectedRegion,
        },
      );
      billingControlRecordPath = billingValidation.recordPath;
      preflightErrors.push(...billingValidation.errors);
      semanticOptions.expectedBillingControlReference = billingValidation.reference;
      semanticOptions.expectedBillingControlConfigurationSha256 =
        billingValidation.controlConfigurationSha256;
    }
  } else if (options.billingControlRecord) {
    preflightErrors.push(
      '--billing-control-record is accepted only for approved or final validation.',
    );
  }

  let evidenceIndexRecordPath;
  let evidenceBindingIntegrityModel;
  if (options.mode === 'final') {
    if (!options.evidenceIndexRecord) {
      preflightErrors.push(
        'Final CLI validation requires --evidence-index-record pointing to a protected outside-repository record.',
      );
    }
    if (!/^[a-f0-9]{64}$/.test(options.expectedPolicyConfigurationSha256 ?? '')) {
      preflightErrors.push(
        'Final CLI validation requires --expected-policy-configuration-sha256 as an independent lowercase digest.',
      );
    }
    if (
      options.evidenceIndexRecord &&
      /^[a-f0-9]{64}$/.test(options.expectedPolicyConfigurationSha256 ?? '')
    ) {
      const evidenceIndexValidation = validateEvidenceIndexRecordFile(
        options.evidenceIndexRecord,
        policy,
        {
          expectedPolicyConfigurationSha256: options.expectedPolicyConfigurationSha256,
        },
      );
      evidenceIndexRecordPath = evidenceIndexValidation.recordPath;
      evidenceBindingIntegrityModel = evidenceIndexValidation.integrityModel;
      preflightErrors.push(...evidenceIndexValidation.errors);
    }
  } else if (options.evidenceIndexRecord || options.expectedPolicyConfigurationSha256) {
    preflightErrors.push(
      '--evidence-index-record and --expected-policy-configuration-sha256 are accepted only for final validation.',
    );
  }

  const result = validateEgressPolicy(policy, semanticOptions);
  result.errors.push(...preflightErrors);
  const hygiene = validatePolicyPathHygiene(options.policy, { mode: options.mode });
  result.errors.push(...hygiene.errors);
  result.ok = result.errors.length === 0;
  if (options.browserEgressSource) {
    const browserPathErrors = [];
    const browserSourcePath = resolveLocalPath(
      options.browserEgressSource,
      'Browser egress source path',
      browserPathErrors,
    );
    if (
      browserSourcePath !== undefined &&
      assertRegularLocalFile(browserSourcePath, 'browser egress source', browserPathErrors)
    ) {
      try {
        const browserResult = validateBrowserEgressSource(readFileSync(browserSourcePath, 'utf8'));
        result.errors.push(
          ...browserResult.errors.map((error) => `Browser egress guard: ${error}`),
        );
        result.browserEgressSource = browserSourcePath;
      } catch (error) {
        browserPathErrors.push(`Unable to read browser egress guard: ${error.message}`);
      }
    }
    result.errors.push(...browserPathErrors);
    result.ok = result.errors.length === 0;
  }

  const report = {
    ...result,
    ...zeroCallMarkers(),
    policy: policyPath,
    ...(billingControlRecordPath ? { billingControlRecord: billingControlRecordPath } : {}),
    ...(evidenceIndexRecordPath ? { evidenceIndexRecord: evidenceIndexRecordPath } : {}),
    ...(evidenceBindingIntegrityModel ? { evidenceBindingIntegrityModel } : {}),
    mode: options.mode,
  };
  if (options.json) {
    const stream = report.ok ? process.stdout : process.stderr;
    stream.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok) {
    process.stdout.write('Egress policy validation passed.\n');
    process.stdout.write(`Canonical policy SHA-256: ${report.canonicalSha256}\n`);
    process.stdout.write(`Policy configuration SHA-256: ${report.policyConfigurationSha256}\n`);
    if (report.evidenceBindingIntegrityModel) {
      process.stdout.write(
        'Evidence binding assurance: cross-artifact binding only; not a cryptographic signature.\n',
      );
    }
    writeZeroCallMarkers(process.stdout);
  } else {
    process.stderr.write('Egress policy validation failed:\n');
    for (const error of report.errors) {
      process.stderr.write(`- ${error}\n`);
    }
    writeZeroCallMarkers(process.stderr);
  }
  process.exit(report.ok ? 0 : 1);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main();
}
