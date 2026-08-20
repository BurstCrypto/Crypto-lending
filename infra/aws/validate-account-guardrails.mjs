import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateBillingControlRecord } from './validate-billing-control-record.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

function parseArguments(argv) {
  const options = {
    template: join(scriptDirectory, 'account-guardrails.yaml'),
    guard: join(scriptDirectory, 'invoke-account-guardrails.ps1'),
    applicationGuard: join(scriptDirectory, 'invoke-application-baseline.ps1'),
    preflight: join(scriptDirectory, 'invoke-account-readonly-preflight.ps1'),
    record: join(scriptDirectory, 'billing-control-record.example.json'),
    readonlyPolicy: join(scriptDirectory, 'kan-229-readonly-preflight-policy.json'),
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    const names = {
      '--template': 'template',
      '--guard': 'guard',
      '--application-guard': 'applicationGuard',
      '--preflight': 'preflight',
      '--record': 'record',
      '--readonly-policy': 'readonlyPolicy',
    };
    const name = names[argument];
    if (!name) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${argument}.`);
    }
    options[name] = resolve(value);
    index += 1;
  }
  return options;
}

function readRequiredFile(path, label, errors) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    errors.push(`${label} could not be read at ${path}: ${error.message}`);
    return '';
  }
}

function topLevelBlocks(source, sectionName) {
  const lines = source.split(/\r?\n/);
  const blocks = new Map();
  let sectionIndex = lines.findIndex((line) => line === `${sectionName}:`);
  if (sectionIndex < 0) {
    return blocks;
  }
  sectionIndex += 1;
  let currentName;
  let currentLines = [];
  const flush = () => {
    if (currentName) {
      blocks.set(currentName, currentLines.join('\n'));
    }
  };

  for (let index = sectionIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z][A-Za-z0-9]*:$/.test(line)) {
      break;
    }
    const entry = line.match(
      /^  (?:(?:"([A-Za-z][A-Za-z0-9]*)")|(?:'([A-Za-z][A-Za-z0-9]*)')|([A-Za-z][A-Za-z0-9]*))\s*:\s*$/,
    );
    if (entry) {
      flush();
      currentName = entry[1] ?? entry[2] ?? entry[3];
      currentLines = [line];
      continue;
    }
    if (currentName) {
      currentLines.push(line);
    }
  }
  flush();
  return blocks;
}

function requireFragments(source, label, fragments, errors) {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) {
      errors.push(`${label} is missing required safeguard: ${fragment}`);
    }
  }
}

function validateTemplate(source, path, errors) {
  if (!source) {
    return;
  }
  if (statSync(path).size > 51_200) {
    errors.push('Account guardrail template exceeds the 51,200-byte direct-upload limit.');
  }
  if (/^\s*(?:["']?Transform["']?|["']?Fn::Transform["']?)\s*:/m.test(source)) {
    errors.push(
      'Account guardrail template must not use transforms or macros that can expand beyond the exact resource allowlist.',
    );
  }
  if (/^\s*(?:["']?<<["']?)\s*:/m.test(source)) {
    errors.push(
      'Account guardrail template must not use YAML merge keys that can bypass the exact resource allowlist.',
    );
  }

  const parameters = topLevelBlocks(source, 'Parameters');
  const expectedParameters = new Set([
    'ApprovedAccountId',
    'ApplicationRegion',
    'ControlRegion',
    'EnvironmentName',
    'EnvironmentOwner',
    'FinanceOwner',
    'CostCenter',
    'WarningEmail',
    'CriticalEmail',
    'MonthlyBudgetUsd',
    'WarningPercent',
    'CriticalPercent',
    'AnomalyMode',
    'ExistingAnomalyMonitorArn',
    'AnomalyAbsoluteUsd',
    'AnomalyPercentage',
    'ApprovalRecordId',
    'ControlsAcknowledgement',
  ]);
  for (const parameter of parameters.keys()) {
    if (!expectedParameters.has(parameter)) {
      errors.push(`Account guardrail template contains unexpected parameter ${parameter}.`);
    }
  }
  for (const parameter of expectedParameters) {
    if (!parameters.has(parameter)) {
      errors.push(`Account guardrail template is missing parameter ${parameter}.`);
    }
  }

  const resources = topLevelBlocks(source, 'Resources');
  const expectedResources = new Map([
    ['MonthlyCostBudget', 'AWS::Budgets::Budget'],
    ['CostAnomalyMonitor', 'AWS::CE::AnomalyMonitor'],
    ['CostAnomalySubscription', 'AWS::CE::AnomalySubscription'],
  ]);
  for (const [logicalId, block] of resources) {
    const resourceType = block.match(/^\s+Type:\s*(\S+)\s*$/m)?.[1];
    if (!expectedResources.has(logicalId) || expectedResources.get(logicalId) !== resourceType) {
      errors.push(
        `Account guardrail template contains unexpected resource ${logicalId} (${resourceType ?? 'missing type'}).`,
      );
    }
  }
  for (const [logicalId, resourceType] of expectedResources) {
    if (!resources.has(logicalId)) {
      errors.push(`Account guardrail template is missing ${logicalId} (${resourceType}).`);
    }
  }
  if (resources.size !== expectedResources.size) {
    errors.push(
      'Account guardrail template must contain exactly the three approved control resources.',
    );
  }
  const budgetEntries = [...resources.entries()].filter(([, block]) =>
    /Type:\s*AWS::Budgets::Budget\s*$/m.test(block),
  );
  const monitorEntries = [...resources.entries()].filter(([, block]) =>
    /Type:\s*AWS::CE::AnomalyMonitor\s*$/m.test(block),
  );
  const subscriptionEntries = [...resources.entries()].filter(([, block]) =>
    /Type:\s*AWS::CE::AnomalySubscription\s*$/m.test(block),
  );
  if (budgetEntries.length !== 1 || budgetEntries[0]?.[0] !== 'MonthlyCostBudget') {
    errors.push('Template must contain exactly one MonthlyCostBudget resource.');
  }
  if (monitorEntries.length !== 1 || monitorEntries[0]?.[0] !== 'CostAnomalyMonitor') {
    errors.push('Template must contain exactly one conditional CostAnomalyMonitor resource.');
  }
  if (
    subscriptionEntries.length !== 1 ||
    subscriptionEntries[0]?.[0] !== 'CostAnomalySubscription'
  ) {
    errors.push('Template must contain exactly one conditional CostAnomalySubscription resource.');
  }

  const budget = budgetEntries[0]?.[1] ?? '';
  requireFragments(
    budget,
    'MonthlyCostBudget',
    [
      'DeletionPolicy: Retain',
      'UpdateReplacePolicy: Delete',
      'BudgetType: COST',
      'TimeUnit: MONTHLY',
      'Amount: !Ref MonthlyBudgetUsd',
      'SubscriptionType: EMAIL',
      'NotificationType: ACTUAL',
      'NotificationType: FORECASTED',
      'Threshold: !Ref WarningPercent',
      'Threshold: !Ref CriticalPercent',
      'Threshold: 100',
      'ResourceTags:',
    ],
    errors,
  );
  if (/BudgetName:/m.test(budget)) {
    errors.push(
      'MonthlyCostBudget must use a generated name so reviewed replacements can complete.',
    );
  }
  if (/CostFilters:/m.test(budget)) {
    errors.push('The primary monthly budget must remain account-wide and unfiltered.');
  }

  const requiredTagFragments = [
    '- Key: application\n          Value: crypto-lending',
    '- Key: environment\n          Value: !Ref EnvironmentName',
    '- Key: control-scope\n          Value: account-billing',
    '- Key: owner\n          Value: !Ref EnvironmentOwner',
    '- Key: finance-owner\n          Value: !Ref FinanceOwner',
    '- Key: cost-center\n          Value: !Ref CostCenter',
    '- Key: managed-by\n          Value: cloudformation',
    '- Key: ticket\n          Value: KAN-229',
    '- Key: approval-record\n          Value: !Ref ApprovalRecordId',
  ];
  for (const [logicalId, block] of [...budgetEntries, ...monitorEntries, ...subscriptionEntries]) {
    requireFragments(block, logicalId, requiredTagFragments, errors);
  }

  const monitor = monitorEntries[0]?.[1] ?? '';
  requireFragments(
    monitor,
    'CostAnomalyMonitor',
    [
      'Condition: CreateAnomalyMonitor',
      'DeletionPolicy: Delete',
      'UpdateReplacePolicy: Delete',
      'MonitorType: DIMENSIONAL',
      'MonitorDimension: SERVICE',
    ],
    errors,
  );
  const subscription = subscriptionEntries[0]?.[1] ?? '';
  requireFragments(
    subscription,
    'CostAnomalySubscription',
    [
      'Condition: ConfigureAnomalySubscription',
      'DeletionPolicy: Delete',
      'UpdateReplacePolicy: Delete',
      'Frequency: DAILY',
      'Type: EMAIL',
      'ThresholdExpression:',
      'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
      'ANOMALY_TOTAL_IMPACT_PERCENTAGE',
    ],
    errors,
  );

  const forbiddenResourceTypes = [
    'AWS::Budgets::BudgetsAction',
    'AWS::SNS::Topic',
    'AWS::Lambda::Function',
    'AWS::CUR::ReportDefinition',
    'AWS::Config::ConfigurationRecorder',
    'AWS::Events::Rule',
  ];
  for (const resourceType of forbiddenResourceTypes) {
    if (source.includes(`Type: ${resourceType}`)) {
      errors.push(`Account guardrails must not create ${resourceType}.`);
    }
  }
  if (/^\s+Default:\s+[^\r\n]*@/m.test(source)) {
    errors.push('The template must not commit a default notification email address.');
  }
  if (/^\s+Address:\s+(?!\!Ref)[^\r\n]*@/m.test(source)) {
    errors.push('The template must not commit a literal notification email address.');
  }
  if (/^\s+(?:SubscriptionType|Type):\s+SNS\s*$/m.test(source)) {
    errors.push('Account guardrail notifications must use direct EMAIL delivery, never SNS.');
  }

  requireFragments(
    source,
    'Account guardrail template',
    [
      'Default: NOT_AUTHORIZED',
      'I_ACKNOWLEDGE_ACCOUNT_LEVEL_COST_CONTROLS',
      'ApprovedAccountMustMatchTarget:',
      'ControlRegionMustMatchTarget:',
      'GovernanceOwnersMustBeDistinct:',
      'Default: Disabled',
      'AnomalyModeMustHaveOneMonitorSource:',
      'PolicyVersion:',
      'Value: kan-229-v1',
      'NotificationDeliveryEvidence:',
      'Value: NOT_TESTED_BY_CLOUDFORMATION',
    ],
    errors,
  );

  const outputs = topLevelBlocks(source, 'Outputs');
  const expectedOutputs = new Set([
    'PolicyVersion',
    'ApprovedAccountId',
    'ApplicationRegion',
    'ControlRegion',
    'EnvironmentName',
    'EnvironmentOwner',
    'FinanceOwner',
    'CostCenter',
    'ApprovalRecordId',
    'MonthlyBudgetName',
    'MonthlyBudgetUsd',
    'WarningPercent',
    'CriticalPercent',
    'AnomalyMode',
    'CostAnomalyMonitorArn',
    'CostAnomalySubscriptionArn',
    'NotificationDeliveryEvidence',
  ]);
  for (const output of outputs.keys()) {
    if (!expectedOutputs.has(output)) {
      errors.push(`Account guardrail template contains unexpected output ${output}.`);
    }
  }
  for (const output of expectedOutputs) {
    if (!outputs.has(output)) {
      errors.push(`Account guardrail template is missing output ${output}.`);
    }
  }
  for (const forbiddenOutput of ['WarningEmail', 'CriticalEmail']) {
    if (outputs.has(forbiddenOutput)) {
      errors.push(`Template must not output ${forbiddenOutput}.`);
    }
  }
}

function validateStandaloneGuard(source, errors) {
  if (!source) {
    return;
  }
  const localIndex = source.indexOf("if ($Action -eq 'LocalValidate')");
  const policyValidationIndex = source.indexOf(
    '& $nodeCommand.Source $accountGuardrailValidatorPath --template $resolvedTemplate',
  );
  const recordIndex = source.indexOf("'--mode', 'bootstrap'");
  const optInIndex = source.indexOf('if (-not $AllowAwsApiCalls.IsPresent)');
  const awsDiscoveryIndex = source.indexOf('Get-Command aws');
  if (
    policyValidationIndex < 0 ||
    localIndex < policyValidationIndex ||
    recordIndex < localIndex ||
    optInIndex < recordIndex ||
    awsDiscoveryIndex < optInIndex
  ) {
    errors.push(
      'Account guard must enforce the exact-resource policy, return locally, validate the bootstrap record, and require opt-in before AWS discovery.',
    );
  }
  requireFragments(
    source,
    'Account guard',
    [
      "[string] $Action = 'LocalValidate'",
      'BillingControlRecordFile',
      'validate-billing-control-record.mjs',
      'validate-account-guardrails.mjs',
      'canonicalSha256',
      'controlConfigurationSha256',
      "'get-caller-identity'",
      "'create-change-set'",
      "'describe-change-set'",
      "'execute-change-set'",
      'template-sha256=',
      'parameters-sha256=',
      'tags-sha256=',
      'control-record-sha256=',
      "'control-configuration-sha256'",
      'ControlReplacementAcknowledgement',
      'BillableAcknowledgement',
      'UpdateReplacePolicy',
    ],
    errors,
  );
}

function validateApplicationGuard(source, errors) {
  if (!source) {
    return;
  }
  const recordIndex = source.indexOf("'--mode', 'approved'");
  const optInIndex = source.indexOf('if (-not $AllowAwsApiCalls.IsPresent)');
  const awsDiscoveryIndex = source.indexOf('Get-Command aws');
  if (recordIndex < 0 || optInIndex < recordIndex || awsDiscoveryIndex < optInIndex) {
    errors.push(
      'Application guard must validate final billing evidence and opt-in before AWS discovery.',
    );
  }
  requireFragments(
    source,
    'Application guard',
    [
      'BillingControlRecordFile',
      'GuardrailStackName',
      'GuardrailControlRegion',
      'control-record-sha256',
      'controlConfigurationSha256',
      "'control-configuration-sha256'",
      'tags-sha256=',
      "'finance-owner'",
      "'cost-center'",
      "'control-record-sha256'",
      "'describe-stacks'",
      'account-guardrails.yaml',
      "'get-template'",
      "'--template-stage', 'Original'",
      '$deployedGuardrailTemplateSha256 -cne $accountGuardrailTemplateSha256',
      '$actualGuardrailStackTags.Count -ne $expectedGuardrailStackTags.Count',
      '$guardrailParameters.Count -ne 18',
      'existingAnomalyMonitorArn',
      'anomalyAbsoluteUsd',
      'anomalyPercentage',
      '$expectedAssumedRolePrefix',
      "$GuardrailControlRegion -cne 'us-east-1'",
      'kan-229-v1',
      'approvedRoleArn',
      '$changeSetTags.Count -ne $expectedStackTags.Count',
    ],
    errors,
  );
}

function validateReadOnlyPreflightPolicy(source, errors) {
  if (!source) {
    return;
  }
  let policy;
  try {
    policy = JSON.parse(source);
  } catch (error) {
    errors.push(`KAN-229 read-only preflight policy is not valid JSON: ${error.message}`);
    return;
  }

  const expectedPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'ReadAccountAlias',
        Effect: 'Allow',
        Action: 'iam:ListAccountAliases',
        Resource: '*',
      },
      {
        Sid: 'ReadNotificationOnlyBudgets',
        Effect: 'Allow',
        Action: [
          'aws-portal:ViewBilling',
          'budgets:DescribeBudgetActionsForAccount',
          'budgets:ListTagsForResource',
          'budgets:ViewBudget',
        ],
        Resource: '*',
      },
    ],
  };
  if (JSON.stringify(policy) !== JSON.stringify(expectedPolicy)) {
    errors.push(
      'KAN-229 read-only preflight policy must contain only the exact account-alias and notification-only budget read permissions; Cost Explorer and all write actions are forbidden.',
    );
  }
}

function validateReadOnlyPreflight(source, errors) {
  if (!source) {
    return;
  }
  const optInIndex = source.indexOf('if (-not $AllowAwsApiCalls.IsPresent)');
  const awsDiscoveryIndex = source.indexOf('Get-Command aws');
  if (optInIndex < 0 || awsDiscoveryIndex < optInIndex) {
    errors.push('Read-only preflight must require explicit opt-in before AWS discovery.');
  }
  requireFragments(
    source,
    'Read-only preflight',
    [
      "'sts',",
      "'get-caller-identity',",
      "'iam',",
      "'list-account-aliases',",
      "'budgets',",
      "'describe-budgets',",
      "'describe-notifications-for-budget',",
      "'describe-subscribers-for-notification',",
      "'list-tags-for-resource',",
      "'describe-budget-actions-for-account',",
      "anomalyInventory = 'NOT_RUN_COST_UNVERIFIED'",
      'costExplorerCallsMade = 0',
      'mutatingAwsCallsMade = 0',
      'paidServiceActivationsMade = 0',
      "costBoundary = 'NO_DIRECT_SERVICE_API_FEE_IDENTIFIED;INDIRECT_ACCOUNT_LOGGING_COST_NOT_VERIFIED'",
      '$operation -cnotin $script:AllowedAwsOperations',
      'BillingViewArn',
      'recordFileSha256',
      'preflightScriptSha256',
      'readonlyPolicySha256',
      'awsCliInvocationsMade',
      "awsApiRequestCount = 'UNKNOWN_CLI_PAGINATION_AND_RETRIES'",
      'Assert-FullyPaginated',
      "throw 'The AWS account alias does not exactly match the approved control record.'",
    ],
    errors,
  );
  if (/['"]ce['"]|get-anomal|create-|update-|delete-|execute-/i.test(source)) {
    errors.push('Read-only preflight must not contain Cost Explorer or mutating AWS commands.');
  }
  if (/--(?:no-paginate|max-items|starting-token)\b/i.test(source)) {
    errors.push('Read-only preflight must not contain an AWS CLI pagination-truncation option.');
  }
  if ((source.match(/'--page-size',\s*'100'/g) ?? []).length !== 4) {
    errors.push(
      'Read-only preflight must fully paginate each of its four paginated Budgets reads.',
    );
  }

  const expectedCalls = [
    'budgets:describe-budget-actions-for-account',
    'budgets:describe-budgets',
    'budgets:describe-notifications-for-budget',
    'budgets:describe-subscribers-for-notification',
    'budgets:list-tags-for-resource',
    'iam:list-account-aliases',
    'sts:get-caller-identity',
  ];
  const runtimeAllowlist = source.match(/\$script:AllowedAwsOperations\s*=\s*@\(([\s\S]*?)\r?\n\)/);
  const runtimeOperations = runtimeAllowlist
    ? [...runtimeAllowlist[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort()
    : [];
  if (JSON.stringify(runtimeOperations) !== JSON.stringify(expectedCalls)) {
    errors.push(
      'Read-only preflight runtime allowlist must contain exactly the seven approved STS, IAM, and AWS Budgets operations.',
    );
  }
  const actualCalls = [
    ...source.matchAll(/Invoke-AwsJson\s+-Arguments\s+@\(\s*'([^']+)'\s*,\s*'([^']+)'/g),
  ]
    .map((match) => `${match[1]}:${match[2]}`)
    .sort();
  if (JSON.stringify(actualCalls) !== JSON.stringify(expectedCalls)) {
    errors.push(
      'Read-only preflight must contain exactly the seven approved STS, IAM, and AWS Budgets call sites.',
    );
  }
  if ((source.match(/& \$script:AwsExecutable/g) ?? []).length !== 1) {
    errors.push(
      'Read-only preflight must route every AWS call through its single audited wrapper.',
    );
  }
  const invocationOperatorCount = (source.match(/(?<!>)&(?=\s+|\()/g) ?? []).length;
  if (
    invocationOperatorCount !== 2 ||
    !source.includes('$output = & $script:AwsExecutable @Arguments 2>&1') ||
    !source.includes('$validatorOutput = @(& $nodeCommand.Source $validatorPath 2>&1)')
  ) {
    errors.push(
      'Read-only preflight may invoke only the local Node validator and the single allowlisted AWS wrapper.',
    );
  }
  if (/\b(?:Start-Process|Invoke-Expression|iex)\b|System\.Diagnostics\.Process/i.test(source)) {
    errors.push(
      'Read-only preflight must not contain an alternate process or expression launcher.',
    );
  }
  if (/\$Arguments(?:\s*\[[^\]]+\])?\s*=|\$Arguments\.(?:SetValue|Clear)\s*\(/i.test(source)) {
    errors.push('Read-only preflight must not reassign arguments after runtime authorization.');
  }
  if (
    /^\s*aws(?:\.exe)?\s+/im.test(source) ||
    /&\s*\(\s*Get-Command\s+aws\b/i.test(source) ||
    /\b(?:cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh)\b[^\r\n]*\baws\b/i.test(source)
  ) {
    errors.push('Read-only preflight must not contain a direct or indirect AWS CLI bypass path.');
  }
}

export function validateAccountGuardrails({
  template,
  guard,
  applicationGuard,
  preflight,
  record,
  readonlyPolicy,
}) {
  const errors = [];
  const templateSource = readRequiredFile(template, 'Account guardrail template', errors);
  const guardSource = readRequiredFile(guard, 'Account guardrail invocation guard', errors);
  const applicationGuardSource = readRequiredFile(
    applicationGuard,
    'Application invocation guard',
    errors,
  );
  const preflightSource = readRequiredFile(preflight, 'KAN-229 read-only preflight', errors);
  const recordSource = readRequiredFile(record, 'Billing control record example', errors);
  const readonlyPolicySource = readRequiredFile(
    readonlyPolicy,
    'KAN-229 read-only preflight policy',
    errors,
  );

  validateTemplate(templateSource, template, errors);
  validateStandaloneGuard(guardSource, errors);
  validateApplicationGuard(applicationGuardSource, errors);
  validateReadOnlyPreflight(preflightSource, errors);
  validateReadOnlyPreflightPolicy(readonlyPolicySource, errors);
  if (recordSource) {
    try {
      const result = validateBillingControlRecord(JSON.parse(recordSource), { mode: 'example' });
      errors.push(...result.errors.map((error) => `Control record example: ${error}`));
    } catch (error) {
      errors.push(`Billing control record example is not valid JSON: ${error.message}`);
    }
  }

  return { ok: errors.length === 0, errors, awsCallsMade: 0 };
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\nAWS API calls made: 0\n`);
    process.exit(2);
  }
  const report = {
    ...validateAccountGuardrails(options),
    template: options.template,
    guard: options.guard,
    applicationGuard: options.applicationGuard,
    preflight: options.preflight,
    record: options.record,
    readonlyPolicy: options.readonlyPolicy,
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok) {
    process.stdout.write(
      `KAN-229 local account guardrail validation passed.\nAWS API calls made: 0\n`,
    );
  } else {
    process.stderr.write('KAN-229 local account guardrail validation failed:\n');
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
