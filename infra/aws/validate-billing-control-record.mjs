import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseStrictJsonBytes } from '../shared/parse-strict-json.mjs';
import {
  readSecureLocalFile,
  readSecureLocalFileForTest,
} from '../shared/read-secure-local-file.mjs';

export const MAX_BILLING_CONTROL_RECORD_BYTES = 65_536;
export const BILLING_CONTROL_RECORD_INPUT_ERROR =
  'Billing control record must be a non-empty, stable, single-link regular file of at most 65536 bytes at a canonical local path containing strict UTF-8 JSON without a byte-order mark or duplicate object keys.';

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'status',
  'recordId',
  'approvedAt',
  'expiresAt',
  'aws',
  'environment',
  'budget',
  'authority',
  'independentVerification',
  'evidence',
];

const OBJECT_KEYS = {
  aws: ['accountId', 'accountAlias', 'approvedRoleArn', 'applicationRegion', 'controlRegion'],
  environment: ['name', 'application', 'owner', 'financeOwner', 'costCenter', 'escalationRoute'],
  budget: [
    'currency',
    'expectedMonthlyBaselineUsd',
    'monthlyLimitUsd',
    'warningPercent',
    'criticalPercent',
    'warningRecipient',
    'criticalRecipient',
    'exclusions',
    'pricingAsOf',
    'pricingExpiresAt',
    'mechanism',
    'anomalyMode',
    'existingAnomalyMonitorArn',
    'anomalyAbsoluteUsd',
    'anomalyPercentage',
    'feeDecision',
  ],
  authority: ['planApprovers', 'deployApprovers', 'retentionApprovers', 'deletionApprovers'],
  independentVerification: ['verifier', 'decision', 'verifiedAt'],
  evidence: [
    'accountRegionRole',
    'warningDelivery',
    'criticalDelivery',
    'anomalyDelivery',
    'retainedResourceReview',
  ],
};

const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;
const NON_PRODUCTION_ENVIRONMENT_PATTERN = /^(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/;
const ROLE_ALIAS_PATTERN = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const COST_CENTER_PATTERN = /^[A-Z][A-Z0-9-]{0,30}[A-Z0-9]$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

export function canonicalizeBillingControlRecord(record) {
  return JSON.stringify(sortedJson(record));
}

export function canonicalizeBillingControlConfiguration(record) {
  const configuration = {
    schemaVersion: record?.schemaVersion,
    recordId: record?.recordId,
    aws: {
      accountId: record?.aws?.accountId,
      applicationRegion: record?.aws?.applicationRegion,
      controlRegion: record?.aws?.controlRegion,
    },
    environment: {
      name: record?.environment?.name,
      application: record?.environment?.application,
      owner: record?.environment?.owner,
      financeOwner: record?.environment?.financeOwner,
      costCenter: record?.environment?.costCenter,
    },
    budget: {
      currency: record?.budget?.currency,
      monthlyLimitUsd: record?.budget?.monthlyLimitUsd,
      warningPercent: record?.budget?.warningPercent,
      criticalPercent: record?.budget?.criticalPercent,
      warningRecipient: record?.budget?.warningRecipient,
      criticalRecipient: record?.budget?.criticalRecipient,
      mechanism: record?.budget?.mechanism,
      anomalyMode: record?.budget?.anomalyMode,
      existingAnomalyMonitorArn: record?.budget?.existingAnomalyMonitorArn,
      anomalyAbsoluteUsd: record?.budget?.anomalyAbsoluteUsd,
      anomalyPercentage: record?.budget?.anomalyPercentage,
      feeDecision: record?.budget?.feeDecision,
    },
  };
  return JSON.stringify(sortedJson(configuration));
}

function assertExactKeys(value, expectedKeys, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
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

function assertReference(value, path, errors) {
  if (typeof value !== 'string' || !REFERENCE_PATTERN.test(value)) {
    errors.push(`${path} must be a non-secret role or distribution-alias reference.`);
    return;
  }
  if (value.includes('@') || /NOT_(?:APPROVED|RUN)/i.test(value)) {
    errors.push(`${path} must be an approved reference, not an email address or placeholder.`);
  }
}

function assertRoleAlias(value, path, errors) {
  if (
    typeof value !== 'string' ||
    !ROLE_ALIAS_PATTERN.test(value) ||
    /^(?:tbd|none|unknown|unset|owner|finance|admin|team)$/.test(value)
  ) {
    errors.push(`${path} must be a stable 3-64 character lowercase role alias.`);
  }
}

function assertRoleAliasArray(value, path, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must contain at least one approved role alias.`);
    return;
  }
  value.forEach((entry, index) => assertRoleAlias(entry, `${path}[${index}]`, errors));
  if (new Set(value).size !== value.length) {
    errors.push(`${path} must not contain duplicate role aliases.`);
  }
}

function parseDate(value, pattern, path, errors) {
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
  const expectedComponents = [
    parsedDate.getUTCFullYear(),
    parsedDate.getUTCMonth() + 1,
    parsedDate.getUTCDate(),
  ];
  if (pattern === ISO_INSTANT_PATTERN) {
    expectedComponents.push(
      parsedDate.getUTCHours(),
      parsedDate.getUTCMinutes(),
      parsedDate.getUTCSeconds(),
    );
  }
  if (
    components.length < expectedComponents.length ||
    expectedComponents.some((component, index) => components[index] !== component)
  ) {
    errors.push(`${path} is not a real calendar date.`);
    return undefined;
  }
  return parsed;
}

function parsePositiveDecimal(value, path, errors) {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    errors.push(`${path} must be a positive decimal string with at most two decimal places.`);
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    errors.push(`${path} must be greater than zero.`);
    return undefined;
  }
  return parsed;
}

function allSentinel(value, sentinel) {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every((entry) => allSentinel(entry, sentinel));
  }
  if (isPlainObject(value)) {
    return Object.values(value).every((entry) => allSentinel(entry, sentinel));
  }
  return value === sentinel;
}

function allApprovalSentinels(value) {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(allApprovalSentinels);
  }
  if (isPlainObject(value)) {
    return Object.values(value).every(allApprovalSentinels);
  }
  return value === 'NOT_APPROVED' || value === 'NOT_RUN';
}

export function validateBillingControlRecord(
  record,
  {
    mode = 'approved',
    expectedAccount,
    expectedApplicationRegion,
    expectedControlRegion,
    expectedEnvironment,
    now = new Date(),
  } = {},
) {
  const errors = [];
  assertExactKeys(record, TOP_LEVEL_KEYS, 'record', errors);
  if (!isPlainObject(record)) {
    return { ok: false, errors };
  }

  for (const [key, keys] of Object.entries(OBJECT_KEYS)) {
    assertExactKeys(record[key], keys, `record.${key}`, errors);
  }

  if (record.schemaVersion !== 1) {
    errors.push('record.schemaVersion must equal 1.');
  }
  if (!['approved', 'bootstrap', 'example'].includes(mode)) {
    errors.push("Validation mode must be 'approved', 'bootstrap', or 'example'.");
  }

  if (mode === 'example') {
    if (record.status !== 'NOT_APPROVED') {
      errors.push('The committed example must remain NOT_APPROVED.');
    }
    const approvalFields = {
      ...record,
      schemaVersion: undefined,
      evidence: undefined,
    };
    delete approvalFields.schemaVersion;
    delete approvalFields.evidence;
    if (!allApprovalSentinels(approvalFields)) {
      errors.push('The committed example may contain only NOT_APPROVED or NOT_RUN values.');
    }
    if (!allSentinel(record.evidence, 'NOT_RUN')) {
      errors.push('The committed example evidence must remain NOT_RUN.');
    }
  }

  if (mode === 'approved' || mode === 'bootstrap') {
    if (record.status !== 'APPROVED') {
      errors.push('record.status must equal APPROVED for an authorized cloud action.');
    }
    assertReference(record.recordId, 'record.recordId', errors);

    const nowMs = now.getTime();
    const approvedAt = parseDate(
      record.approvedAt,
      ISO_INSTANT_PATTERN,
      'record.approvedAt',
      errors,
    );
    const expiresAt = parseDate(record.expiresAt, ISO_INSTANT_PATTERN, 'record.expiresAt', errors);
    if (approvedAt !== undefined && approvedAt > nowMs) {
      errors.push('record.approvedAt cannot be in the future.');
    }
    if (expiresAt !== undefined && expiresAt <= nowMs) {
      errors.push('record.expiresAt must be in the future.');
    }
    if (approvedAt !== undefined && expiresAt !== undefined && expiresAt <= approvedAt) {
      errors.push('record.expiresAt must be later than record.approvedAt.');
    }

    if (typeof record.aws?.accountId !== 'string' || !/^\d{12}$/.test(record.aws.accountId)) {
      errors.push('record.aws.accountId must be an explicit 12-digit AWS account ID.');
    }
    if (
      typeof record.aws?.accountAlias !== 'string' ||
      !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(record.aws.accountAlias)
    ) {
      errors.push('record.aws.accountAlias must be a stable 3-63 character AWS account alias.');
    }
    const expectedPartition = record.aws?.applicationRegion?.startsWith('cn-')
      ? 'aws-cn'
      : record.aws?.applicationRegion?.startsWith('us-gov-')
        ? 'aws-us-gov'
        : 'aws';
    const expectedRolePattern = new RegExp(
      `^arn:${expectedPartition}:iam::${record.aws?.accountId}:role/.+$`,
    );
    if (
      typeof record.aws?.approvedRoleArn !== 'string' ||
      !expectedRolePattern.test(record.aws.approvedRoleArn)
    ) {
      errors.push(
        'record.aws.approvedRoleArn must name a role in the approved account and application partition.',
      );
    }
    for (const regionField of ['applicationRegion', 'controlRegion']) {
      if (!REGION_PATTERN.test(record.aws?.[regionField] ?? '')) {
        errors.push(`record.aws.${regionField} must be an explicit AWS Region.`);
      }
    }
    if (record.aws?.controlRegion !== 'us-east-1') {
      errors.push('record.aws.controlRegion must be us-east-1 for the current KAN-229 controls.');
    }

    if (!NON_PRODUCTION_ENVIRONMENT_PATTERN.test(record.environment?.name ?? '')) {
      errors.push('record.environment.name must use the approved non-production pattern.');
    }
    if (record.environment?.application !== 'crypto-lending') {
      errors.push('record.environment.application must equal crypto-lending.');
    }
    for (const field of ['owner', 'financeOwner']) {
      assertRoleAlias(record.environment?.[field], `record.environment.${field}`, errors);
    }
    if (record.environment?.owner === record.environment?.financeOwner) {
      errors.push('record.environment.owner and financeOwner must be distinct role aliases.');
    }
    if (
      !COST_CENTER_PATTERN.test(record.environment?.costCenter ?? '') ||
      /^(?:NONE|TBD|UNKNOWN|UNSET|COST-CENTER|0+)$/.test(record.environment?.costCenter ?? '')
    ) {
      errors.push('record.environment.costCenter must be a stable 2-32 character uppercase slug.');
    }
    assertReference(
      record.environment?.escalationRoute,
      'record.environment.escalationRoute',
      errors,
    );

    if (record.budget?.currency !== 'USD') {
      errors.push('record.budget.currency must equal USD.');
    }
    const baseline = parsePositiveDecimal(
      record.budget?.expectedMonthlyBaselineUsd,
      'record.budget.expectedMonthlyBaselineUsd',
      errors,
    );
    const limit = parsePositiveDecimal(
      record.budget?.monthlyLimitUsd,
      'record.budget.monthlyLimitUsd',
      errors,
    );
    if (baseline !== undefined && limit !== undefined && limit < baseline) {
      errors.push('record.budget.monthlyLimitUsd cannot be below the expected baseline.');
    }
    if (!['50', '60', '70'].includes(record.budget?.warningPercent)) {
      errors.push('record.budget.warningPercent must be one of 50, 60, or 70.');
    }
    if (!['80', '90'].includes(record.budget?.criticalPercent)) {
      errors.push('record.budget.criticalPercent must be 80 or 90.');
    }
    if (Number(record.budget?.warningPercent) >= Number(record.budget?.criticalPercent)) {
      errors.push('The warning threshold must remain below the critical threshold.');
    }
    assertRoleAlias(record.budget?.warningRecipient, 'record.budget.warningRecipient', errors);
    assertRoleAlias(record.budget?.criticalRecipient, 'record.budget.criticalRecipient', errors);
    if (record.budget?.warningRecipient === record.budget?.criticalRecipient) {
      errors.push('record.budget warning and critical recipients must be distinct role aliases.');
    }
    if (!Array.isArray(record.budget?.exclusions) || record.budget.exclusions.length === 0) {
      errors.push('record.budget.exclusions must be a non-empty reviewed list.');
    } else {
      record.budget.exclusions.forEach((entry, index) => {
        if (
          typeof entry !== 'string' ||
          entry.length < 3 ||
          entry.length > 256 ||
          /[\r\n]/.test(entry) ||
          /NOT_(?:APPROVED|RUN)/i.test(entry)
        ) {
          errors.push(`record.budget.exclusions[${index}] must be a reviewed description.`);
        }
      });
    }
    const pricingAsOf = parseDate(
      record.budget?.pricingAsOf,
      ISO_DATE_PATTERN,
      'record.budget.pricingAsOf',
      errors,
    );
    const pricingExpiresAt = parseDate(
      record.budget?.pricingExpiresAt,
      ISO_DATE_PATTERN,
      'record.budget.pricingExpiresAt',
      errors,
    );
    if (pricingAsOf !== undefined && pricingAsOf > nowMs) {
      errors.push('record.budget.pricingAsOf cannot be in the future.');
    }
    if (pricingExpiresAt !== undefined && pricingExpiresAt <= nowMs) {
      errors.push('record.budget.pricingExpiresAt must be in the future.');
    }
    if (
      pricingAsOf !== undefined &&
      pricingExpiresAt !== undefined &&
      pricingExpiresAt <= pricingAsOf
    ) {
      errors.push('record.budget.pricingExpiresAt must be later than pricingAsOf.');
    }
    if (
      !['AWS_BUDGETS', 'AWS_BUDGETS_AND_COST_ANOMALY_DETECTION'].includes(record.budget?.mechanism)
    ) {
      errors.push('record.budget.mechanism must contain an approved mechanism decision.');
    }
    const anomalyAbsolute = parsePositiveDecimal(
      record.budget?.anomalyAbsoluteUsd,
      'record.budget.anomalyAbsoluteUsd',
      errors,
    );
    const anomalyPercentage = /^(?:[1-9][0-9]{0,4}|100000)$/.test(
      record.budget?.anomalyPercentage ?? '',
    )
      ? Number(record.budget.anomalyPercentage)
      : undefined;
    if (anomalyPercentage === undefined) {
      errors.push('record.budget.anomalyPercentage must be a whole number from 1 through 100000.');
    }
    if (anomalyAbsolute !== undefined && anomalyAbsolute > 1_000_000) {
      errors.push('record.budget.anomalyAbsoluteUsd cannot exceed 1000000.');
    }
    if (record.budget?.mechanism === 'AWS_BUDGETS') {
      if (record.budget?.anomalyMode !== 'Disabled') {
        errors.push('record.budget.anomalyMode must equal Disabled for AWS_BUDGETS.');
      }
      if (record.budget?.existingAnomalyMonitorArn !== 'NOT_APPLICABLE') {
        errors.push(
          'record.budget.existingAnomalyMonitorArn must equal NOT_APPLICABLE when anomaly detection is disabled.',
        );
      }
    }
    if (record.budget?.mechanism === 'AWS_BUDGETS_AND_COST_ANOMALY_DETECTION') {
      if (!['Create', 'Existing'].includes(record.budget?.anomalyMode)) {
        errors.push(
          'record.budget.anomalyMode must equal Create or Existing when anomaly detection is enabled.',
        );
      } else if (
        record.budget.anomalyMode === 'Create' &&
        record.budget?.existingAnomalyMonitorArn !== 'NOT_APPLICABLE'
      ) {
        errors.push(
          'record.budget.existingAnomalyMonitorArn must equal NOT_APPLICABLE when creating a monitor.',
        );
      } else if (record.budget.anomalyMode === 'Existing') {
        const monitorPattern = new RegExp(
          `^arn:aws:ce::${record.aws?.accountId}:anomalymonitor/[A-Za-z0-9-]+$`,
        );
        if (!monitorPattern.test(record.budget?.existingAnomalyMonitorArn ?? '')) {
          errors.push(
            'record.budget.existingAnomalyMonitorArn must name a Cost Explorer monitor in the approved account.',
          );
        }
      }
    }
    if (record.budget?.feeDecision !== 'NO_ADDITIONAL_CHARGE_CONFIRMED') {
      errors.push(
        'record.budget.feeDecision must equal NO_ADDITIONAL_CHARGE_CONFIRMED under the current no-paid-services policy.',
      );
    }

    for (const field of OBJECT_KEYS.authority) {
      assertRoleAliasArray(record.authority?.[field], `record.authority.${field}`, errors);
    }
    assertRoleAlias(
      record.independentVerification?.verifier,
      'record.independentVerification.verifier',
      errors,
    );
    if (record.independentVerification?.decision !== 'APPROVED') {
      errors.push('record.independentVerification.decision must equal APPROVED.');
    }
    const implementationAndApprovalRoles = new Set([
      record.environment?.owner,
      record.environment?.financeOwner,
      ...OBJECT_KEYS.authority.flatMap((field) => record.authority?.[field] ?? []),
    ]);
    if (implementationAndApprovalRoles.has(record.independentVerification?.verifier)) {
      errors.push(
        'record.independentVerification.verifier must be distinct from implementation, finance, and approval roles.',
      );
    }
    const verifiedAt = parseDate(
      record.independentVerification?.verifiedAt,
      ISO_INSTANT_PATTERN,
      'record.independentVerification.verifiedAt',
      errors,
    );
    if (verifiedAt !== undefined && verifiedAt > nowMs) {
      errors.push('record.independentVerification.verifiedAt cannot be in the future.');
    }

    if (record.evidence?.accountRegionRole !== 'PASS') {
      errors.push('record.evidence.accountRegionRole must equal PASS.');
    }
    if (mode === 'approved') {
      for (const field of ['warningDelivery', 'criticalDelivery', 'retainedResourceReview']) {
        if (record.evidence?.[field] !== 'PASS') {
          errors.push(`record.evidence.${field} must equal PASS.`);
        }
      }
      if (
        record.budget?.mechanism === 'AWS_BUDGETS' &&
        record.evidence?.anomalyDelivery !== 'NOT_APPLICABLE'
      ) {
        errors.push(
          'record.evidence.anomalyDelivery must equal NOT_APPLICABLE when anomaly detection is disabled.',
        );
      }
      if (
        record.budget?.mechanism === 'AWS_BUDGETS_AND_COST_ANOMALY_DETECTION' &&
        record.evidence?.anomalyDelivery !== 'PASS'
      ) {
        errors.push(
          'record.evidence.anomalyDelivery must equal PASS when anomaly detection is enabled.',
        );
      }
    } else {
      for (const field of ['warningDelivery', 'criticalDelivery', 'retainedResourceReview']) {
        if (!['NOT_RUN', 'PASS'].includes(record.evidence?.[field])) {
          errors.push(`record.evidence.${field} must equal NOT_RUN or PASS during bootstrap.`);
        }
      }
      if (!['NOT_RUN', 'PASS', 'NOT_APPLICABLE'].includes(record.evidence?.anomalyDelivery)) {
        errors.push(
          'record.evidence.anomalyDelivery must equal NOT_RUN, PASS, or NOT_APPLICABLE during bootstrap.',
        );
      }
      if (
        record.budget?.mechanism === 'AWS_BUDGETS' &&
        record.evidence?.anomalyDelivery !== 'NOT_APPLICABLE'
      ) {
        errors.push(
          'record.evidence.anomalyDelivery must equal NOT_APPLICABLE when anomaly detection is disabled.',
        );
      }
      if (
        record.budget?.mechanism === 'AWS_BUDGETS_AND_COST_ANOMALY_DETECTION' &&
        record.evidence?.anomalyDelivery === 'NOT_APPLICABLE'
      ) {
        errors.push(
          'record.evidence.anomalyDelivery cannot be NOT_APPLICABLE when anomaly detection is enabled.',
        );
      }
    }

    const expectedValues = [
      ['account', expectedAccount, record.aws?.accountId],
      ['application Region', expectedApplicationRegion, record.aws?.applicationRegion],
      ['control Region', expectedControlRegion, record.aws?.controlRegion],
      ['environment', expectedEnvironment, record.environment?.name],
    ];
    for (const [label, expected, actual] of expectedValues) {
      if (expected !== undefined && expected !== actual) {
        errors.push(`The approved ${label} '${actual}' does not match '${expected}'.`);
      }
    }
  }

  const canonical = canonicalizeBillingControlRecord(record);
  const controlConfiguration = canonicalizeBillingControlConfiguration(record);
  return {
    ok: errors.length === 0,
    errors,
    canonicalSha256: createHash('sha256').update(canonical, 'utf8').digest('hex'),
    controlConfigurationSha256: createHash('sha256')
      .update(controlConfiguration, 'utf8')
      .digest('hex'),
  };
}

function parseArguments(argv) {
  const options = {
    mode: 'example',
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${argument}.`);
    }
    const names = {
      '--record': 'record',
      '--mode': 'mode',
      '--expected-account': 'expectedAccount',
      '--expected-application-region': 'expectedApplicationRegion',
      '--expected-control-region': 'expectedControlRegion',
      '--expected-environment': 'expectedEnvironment',
    };
    const name = names[argument];
    if (!name) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    options[name] = value;
    index += 1;
  }
  if (!options.record) {
    throw new Error('--record is required.');
  }
  return options;
}

function loadBillingControlRecordFileInternal(recordPath, afterFirstReadForTest) {
  try {
    const bytes =
      afterFirstReadForTest === undefined
        ? readSecureLocalFile(recordPath, MAX_BILLING_CONTROL_RECORD_BYTES)
        : readSecureLocalFileForTest(
            recordPath,
            MAX_BILLING_CONTROL_RECORD_BYTES,
            afterFirstReadForTest,
          );
    return parseStrictJsonBytes(bytes);
  } catch {
    throw new Error(BILLING_CONTROL_RECORD_INPUT_ERROR);
  }
}

export function loadBillingControlRecordFile(recordPath) {
  return loadBillingControlRecordFileInternal(recordPath, undefined);
}

/** Test-only fault seam; production callers use loadBillingControlRecordFile. */
export function loadBillingControlRecordFileForTest(recordPath, afterFirstReadForTest) {
  return loadBillingControlRecordFileInternal(recordPath, afterFirstReadForTest);
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\nAWS API calls made: 0\n`);
    process.exit(2);
  }

  const recordPath = resolve(options.record);
  let record;
  try {
    record = loadBillingControlRecordFile(recordPath);
  } catch {
    process.stderr.write(`${BILLING_CONTROL_RECORD_INPUT_ERROR}\n`);
    process.stderr.write('AWS API calls made: 0\n');
    process.exit(1);
  }

  const result = validateBillingControlRecord(record, options);
  const report = {
    ...result,
    awsCallsMade: 0,
    record: recordPath,
    mode: options.mode,
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok) {
    process.stdout.write(
      `Billing control record validation passed.\nCanonical record SHA-256: ${report.canonicalSha256}\nControl configuration SHA-256: ${report.controlConfigurationSha256}\nAWS API calls made: 0\n`,
    );
  } else {
    process.stderr.write('Billing control record validation failed:\n');
    for (const error of report.errors) {
      process.stderr.write(`- ${error}\n`);
    }
    process.stderr.write('AWS API calls made: 0\n');
  }
  process.exit(report.ok ? 0 : 1);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main();
}
