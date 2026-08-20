<#
.SYNOPSIS
Validates KAN-34 locally by default and guards every optional AWS-side action.

.DESCRIPTION
LocalValidate is the default and performs filesystem-only policy validation.
CloudValidate, Plan, and Deploy require an explicit named profile, account ID,
Region, and AllowAwsApiCalls. Plan creates a named change set without executing
it. Plan and Deploy also require the independently approved KAN-229 billing
control record, deployed guardrail stack, and KAN-230 certificate/DNS prerequisite
record. Deploy verifies and executes that exact template/parameter/tag/control-
record-bound change set only after an exact billable-resource acknowledgement.

.PARAMETER Action
LocalValidate, CloudValidate, Plan, or Deploy. Defaults to LocalValidate.

.PARAMETER ParameterOverride
Non-secret CloudFormation parameters in Key=Value form. Secret-like parameter
names are rejected; application secrets must be generated in Secrets Manager.

.PARAMETER AllowAwsApiCalls
Explicit opt-in required before this script resolves credentials or calls AWS.

.PARAMETER BillingControlRecordFile
Git-ignored local JSON record whose identity, ownership, approval, expiry, and live
notification evidence must pass final KAN-229 validation before Plan or Deploy.

.PARAMETER AcmDnsControlRecordFile
Git-ignored KAN-230 record whose approved hostname and issued ACM certificate
must match the application parameters before Plan or Deploy.

.PARAMETER GuardrailStackName
Existing KAN-229 account-guardrail stack verified before an application change
set is created or executed.

.PARAMETER GuardrailControlRegion
Approved Region containing the KAN-229 account-guardrail stack.

.PARAMETER BillableAcknowledgement
Exact case-sensitive text printed by a blocked Deploy attempt. Supplying it is
an execution authorization, not evidence that the resources are free.

.EXAMPLE
pwsh -NoProfile -File infra/aws/invoke-application-baseline.ps1

Runs only the local validator, makes zero AWS calls, and creates no resources.
#>
[CmdletBinding()]
param(
    [ValidateSet('LocalValidate', 'CloudValidate', 'Plan', 'Deploy')]
    [string] $Action = 'LocalValidate',

    [string] $TemplateFile,

    [string] $Profile,

    [string] $AccountId,

    [string] $Region,

    [string] $StackName,

    [string] $ChangeSetName,

    [ValidateSet('CREATE', 'UPDATE')]
    [string] $ChangeSetType,

    [string] $EnvironmentName,

    [string] $BillingControlRecordFile,

    [string] $AcmDnsControlRecordFile,

    [string] $GuardrailStackName,

    [string] $GuardrailControlRegion,

    [string[]] $ParameterOverride = @(),

    [switch] $AllowAwsApiCalls,

    [string] $BillableAcknowledgement
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($TemplateFile)) {
    $TemplateFile = Join-Path $PSScriptRoot 'application-baseline.yaml'
}

$validatorPath = Join-Path $PSScriptRoot 'validate-application-baseline.mjs'
$billingRecordValidatorPath = Join-Path $PSScriptRoot 'validate-billing-control-record.mjs'
$acmDnsRecordValidatorPath = Join-Path $PSScriptRoot 'validate-acm-dns-control-record.mjs'
$accountGuardrailTemplatePath = Join-Path $PSScriptRoot 'account-guardrails.yaml'
$resolvedTemplate = [System.IO.Path]::GetFullPath($TemplateFile)

function Assert-RequiredValue {
    param(
        [string] $Name,
        [AllowNull()]
        [string] $Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$Name must be supplied explicitly."
    }
}

function Get-TextSha256 {
    param([string] $Value)

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        return ([System.BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}

function Invoke-AwsCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    & $script:AwsExecutable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "AWS CLI command failed with exit code $LASTEXITCODE."
    }
}

function ConvertTo-CanonicalTagText {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary] $Tags
    )

    return ($Tags.GetEnumerator() | Sort-Object Key | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"
}

function ConvertFrom-ChangeSetTags {
    param(
        [AllowNull()]
        [object[]] $Tags
    )

    $result = [ordered]@{}
    foreach ($tag in @($Tags)) {
        if ([string]::IsNullOrWhiteSpace([string] $tag.Key) -or $null -eq $tag.Value) {
            throw 'The reviewed change set contains an incomplete stack tag.'
        }
        if ($result.Contains([string] $tag.Key)) {
            throw "The reviewed change set contains duplicate stack tag '$($tag.Key)'."
        }
        $result[[string] $tag.Key] = [string] $tag.Value
    }
    return $result
}

function Get-StackOutputMap {
    param(
        [Parameter(Mandatory = $true)]
        [object] $Stack
    )

    $result = [ordered]@{}
    foreach ($output in @($Stack.Outputs)) {
        if (-not [string]::IsNullOrWhiteSpace([string] $output.OutputKey)) {
            $result[[string] $output.OutputKey] = [string] $output.OutputValue
        }
    }
    return $result
}

function Get-StackParameterMap {
    param(
        [Parameter(Mandatory = $true)]
        [object] $Stack
    )

    $result = [ordered]@{}
    foreach ($parameter in @($Stack.Parameters)) {
        if ([string]::IsNullOrWhiteSpace([string] $parameter.ParameterKey) -or $null -eq $parameter.ParameterValue) {
            throw 'The guardrail stack contains an incomplete parameter.'
        }
        if ($result.Contains([string] $parameter.ParameterKey)) {
            throw "The guardrail stack contains duplicate parameter '$($parameter.ParameterKey)'."
        }
        $result[[string] $parameter.ParameterKey] = [string] $parameter.ParameterValue
    }
    return $result
}

if (-not (Test-Path -LiteralPath $validatorPath -PathType Leaf)) {
    throw "Local policy validator was not found: $validatorPath"
}
if (-not (Test-Path -LiteralPath $billingRecordValidatorPath -PathType Leaf)) {
    throw "Billing control record validator was not found: $billingRecordValidatorPath"
}
if (-not (Test-Path -LiteralPath $acmDnsRecordValidatorPath -PathType Leaf)) {
    throw "ACM/DNS control record validator was not found: $acmDnsRecordValidatorPath"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
    throw 'Node.js is required for local CloudFormation policy validation.'
}

# Every action starts with offline policy validation. This invocation has no AWS
# imports, credential resolution, subprocesses, or network operations.
& $nodeCommand.Source $validatorPath --template $resolvedTemplate
if ($LASTEXITCODE -ne 0) {
    throw 'Local CloudFormation policy validation failed. No AWS calls were made.'
}

if ($Action -eq 'LocalValidate') {
    Write-Host 'Local validation completed. No AWS calls were made and no resources were created.'
    return
}

Assert-RequiredValue -Name 'Profile' -Value $Profile
Assert-RequiredValue -Name 'AccountId' -Value $AccountId
Assert-RequiredValue -Name 'Region' -Value $Region

if ($AccountId -notmatch '^\d{12}$') {
    throw 'AccountId must be an explicit 12-digit AWS account ID.'
}
if ($Region -notmatch '^[a-z]{2}(?:-gov)?-[a-z]+-\d$') {
    throw 'Region must be an explicit AWS region such as us-east-1.'
}
if ($Profile -match '^default$') {
    throw "The implicit/default AWS profile is prohibited. Supply a named, non-default profile."
}

$controlRecord = $null
$controlRecordSha256 = $null
$controlConfigurationSha256 = $null
$resolvedBillingControlRecord = $null
$acmDnsBinding = $null
$acmDnsRecordSha256 = $null
$acmDnsConfigurationSha256 = $null
$resolvedAcmDnsControlRecord = $null
$expectedGuardrailPolicyVersion = 'kan-229-v1'
if ($Action -in @('Plan', 'Deploy')) {
    Assert-RequiredValue -Name 'EnvironmentName' -Value $EnvironmentName
    Assert-RequiredValue -Name 'BillingControlRecordFile' -Value $BillingControlRecordFile
    Assert-RequiredValue -Name 'AcmDnsControlRecordFile' -Value $AcmDnsControlRecordFile
    Assert-RequiredValue -Name 'GuardrailStackName' -Value $GuardrailStackName
    Assert-RequiredValue -Name 'GuardrailControlRegion' -Value $GuardrailControlRegion

    if ($EnvironmentName.Length -gt 31 -or $EnvironmentName -notmatch '^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$') {
        throw 'EnvironmentName must be at most 31 characters and use the template non-production pattern: dev|test|qa|sandbox|staging with optional lowercase suffix segments.'
    }
    if ($GuardrailStackName -notmatch '^[A-Za-z][A-Za-z0-9-]{0,127}$') {
        throw 'GuardrailStackName must be a valid explicit CloudFormation stack name.'
    }
    if ($GuardrailControlRegion -cne 'us-east-1') {
        throw 'GuardrailControlRegion must be us-east-1 for the current KAN-229 account-control template.'
    }
    if (-not (Test-Path -LiteralPath $accountGuardrailTemplatePath -PathType Leaf)) {
        throw "The reviewed KAN-229 account guardrail template was not found: $accountGuardrailTemplatePath"
    }
    $accountGuardrailTemplateSha256 = (Get-FileHash -LiteralPath $accountGuardrailTemplatePath -Algorithm SHA256).Hash.ToLowerInvariant()

    $resolvedBillingControlRecord = [System.IO.Path]::GetFullPath($BillingControlRecordFile)
    if (-not (Test-Path -LiteralPath $resolvedBillingControlRecord -PathType Leaf)) {
        throw "BillingControlRecordFile was not found: $resolvedBillingControlRecord"
    }
    $recordValidationOutput = & $nodeCommand.Source @(
        $billingRecordValidatorPath,
        '--record', $resolvedBillingControlRecord,
        '--mode', 'approved',
        '--expected-account', $AccountId,
        '--expected-application-region', $Region,
        '--expected-control-region', $GuardrailControlRegion,
        '--expected-environment', $EnvironmentName,
        '--json'
    )
    if ($LASTEXITCODE -ne 0) {
        throw 'The billing control record is not approved, current, identity-matched, and evidence-complete. No AWS calls were made.'
    }
    $recordValidation = ($recordValidationOutput | Out-String) | ConvertFrom-Json
    if (-not $recordValidation.ok -or $recordValidation.awsCallsMade -ne 0) {
        throw 'Billing control record validation did not produce a successful zero-AWS-call result.'
    }
    $controlRecordSha256 = [string] $recordValidation.canonicalSha256
    $controlConfigurationSha256 = [string] $recordValidation.controlConfigurationSha256
    if ($controlRecordSha256 -notmatch '^[a-f0-9]{64}$' -or $controlConfigurationSha256 -notmatch '^[a-f0-9]{64}$') {
        throw 'Billing control record validation did not return valid canonical and configuration SHA-256 bindings.'
    }
    $controlRecord = (Get-Content -LiteralPath $resolvedBillingControlRecord -Raw) | ConvertFrom-Json

    $resolvedAcmDnsControlRecord = [System.IO.Path]::GetFullPath($AcmDnsControlRecordFile)
    if (-not (Test-Path -LiteralPath $resolvedAcmDnsControlRecord -PathType Leaf)) {
        throw "AcmDnsControlRecordFile was not found: $resolvedAcmDnsControlRecord"
    }
    $acmDnsValidationOutput = & $nodeCommand.Source @(
        $acmDnsRecordValidatorPath,
        '--record', $resolvedAcmDnsControlRecord,
        '--mode', 'prerequisite',
        '--expected-account', $AccountId,
        '--expected-region', $Region,
        '--json'
    )
    if ($LASTEXITCODE -ne 0) {
        throw 'The KAN-230 ACM/DNS prerequisite is not approved, current, identity-matched, and certificate-issued. No AWS calls were made.'
    }
    $acmDnsValidation = ($acmDnsValidationOutput | Out-String) | ConvertFrom-Json
    if (
        -not $acmDnsValidation.ok -or
        $acmDnsValidation.externalCallsMade -ne 0 -or
        $acmDnsValidation.awsCallsMade -ne 0 -or
        $acmDnsValidation.dnsQueriesMade -ne 0 -or
        $acmDnsValidation.tlsConnectionsMade -ne 0 -or
        $acmDnsValidation.providerCallsMade -ne 0 -or
        $acmDnsValidation.resourcesCreated -ne 0
    ) {
        throw 'KAN-230 validation did not produce a successful zero-external-call result.'
    }
    $acmDnsRecordSha256 = [string] $acmDnsValidation.canonicalSha256
    $acmDnsConfigurationSha256 = [string] $acmDnsValidation.configurationSha256
    if ($acmDnsRecordSha256 -notmatch '^[a-f0-9]{64}$' -or $acmDnsConfigurationSha256 -notmatch '^[a-f0-9]{64}$') {
        throw 'KAN-230 validation did not return valid record and configuration SHA-256 bindings.'
    }
    $acmDnsBinding = $acmDnsValidation.binding
    if (
        $null -eq $acmDnsBinding -or
        [string] $acmDnsBinding.accountId -cne $AccountId -or
        [string] $acmDnsBinding.region -cne $Region
    ) {
        throw 'KAN-230 validation did not return the expected account and Region binding.'
    }
}

if (-not $AllowAwsApiCalls.IsPresent) {
    throw "Action '$Action' is cloud-side. Re-run with -AllowAwsApiCalls after reviewing the selected account, profile, region, and billing controls."
}

$awsCommand = Get-Command aws -ErrorAction SilentlyContinue
if ($null -eq $awsCommand) {
    throw 'AWS CLI v2 is required for explicitly opted-in cloud actions.'
}
$script:AwsExecutable = $awsCommand.Source

$templateInfo = Get-Item -LiteralPath $resolvedTemplate
if ($templateInfo.Length -gt 51200) {
    throw 'Template exceeds the 51,200-byte direct-upload limit. This guard will not stage templates in a paid S3 service.'
}
$templateSha256 = (Get-FileHash -LiteralPath $resolvedTemplate -Algorithm SHA256).Hash.ToLowerInvariant()

# Verify the named profile before any CloudFormation API call. --profile and
# --region are always supplied; ambient/default credentials are never selected.
$identityOutput = & $script:AwsExecutable @(
    'sts',
    'get-caller-identity',
    '--profile', $Profile,
    '--region', $Region,
    '--output', 'json',
    '--no-cli-pager'
)
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to verify the explicitly named AWS profile.'
}
$callerIdentity = ($identityOutput | Out-String) | ConvertFrom-Json
$actualAccountId = [string] $callerIdentity.Account
if ($actualAccountId -ne $AccountId) {
    throw "Named profile '$Profile' resolved to account '$actualAccountId', not the approved account '$AccountId'."
}
if ($Action -in @('Plan', 'Deploy')) {
    $approvedRoleArn = [string] $controlRecord.aws.approvedRoleArn
    $approvedRoleMatch = [regex]::Match($approvedRoleArn, '^arn:(?<partition>aws(?:-us-gov|-cn)?):iam::\d{12}:role/(?:.*/)?(?<roleName>[^/]+)$')
    if (-not $approvedRoleMatch.Success) {
        throw 'The validated billing control record contains an unusable approvedRoleArn.'
    }
    $expectedAssumedRolePrefix = "arn:$($approvedRoleMatch.Groups['partition'].Value):sts::$AccountId`:assumed-role/$($approvedRoleMatch.Groups['roleName'].Value)/"
    if (-not ([string] $callerIdentity.Arn).StartsWith($expectedAssumedRolePrefix, [System.StringComparison]::Ordinal)) {
        throw "Named profile '$Profile' did not assume the independently approved role '$approvedRoleArn'."
    }
}

$templateUri = 'file://' + ($resolvedTemplate -replace '\\', '/')
if ($Action -eq 'CloudValidate') {
    Invoke-AwsCommand -Arguments @(
        'cloudformation',
        'validate-template',
        '--template-body', $templateUri,
        '--profile', $Profile,
        '--region', $Region,
        '--no-cli-pager'
    )
    Write-Host 'AWS validated the template syntax. No stack or application resources were created.'
    return
}

# Application planning and execution are blocked until the independently
# approved KAN-229 account guardrail stack is healthy and matches the reviewed
# control record. This read occurs only after explicit cloud opt-in and STS
# identity verification.
$guardrailStackOutput = & $script:AwsExecutable @(
    'cloudformation',
    'describe-stacks',
    '--stack-name', $GuardrailStackName,
    '--profile', $Profile,
    '--region', $GuardrailControlRegion,
    '--output', 'json',
    '--no-cli-pager'
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to verify required KAN-229 guardrail stack '$GuardrailStackName'."
}
$guardrailStack = (($guardrailStackOutput | Out-String) | ConvertFrom-Json).Stacks | Select-Object -First 1
if ($null -eq $guardrailStack) {
    throw "Guardrail stack '$GuardrailStackName' was not returned."
}
if ($guardrailStack.StackStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE')) {
    throw "Guardrail stack '$GuardrailStackName' is not in an approved complete state (Status=$($guardrailStack.StackStatus))."
}
$expectedGuardrailStackTags = [ordered]@{
    application = 'crypto-lending'
    environment = $EnvironmentName
    'control-scope' = 'account-billing'
    owner = [string] $controlRecord.environment.owner
    'finance-owner' = [string] $controlRecord.environment.financeOwner
    'cost-center' = [string] $controlRecord.environment.costCenter
    'managed-by' = 'cloudformation'
    ticket = 'KAN-229'
    'approval-record' = [string] $controlRecord.recordId
    'control-configuration-sha256' = $controlConfigurationSha256
}
$actualGuardrailStackTags = ConvertFrom-ChangeSetTags -Tags $guardrailStack.Tags
if ($actualGuardrailStackTags.Count -ne $expectedGuardrailStackTags.Count) {
    throw "Guardrail stack '$GuardrailStackName' does not contain the exact approved KAN-229 tag set."
}
foreach ($expectedTag in $expectedGuardrailStackTags.GetEnumerator()) {
    if (-not $actualGuardrailStackTags.Contains($expectedTag.Key) -or $actualGuardrailStackTags[$expectedTag.Key] -cne $expectedTag.Value) {
        throw "Guardrail stack tag '$($expectedTag.Key)' does not match the final approved billing control record."
    }
}

$guardrailTemplateOutput = & $script:AwsExecutable @(
    'cloudformation',
    'get-template',
    '--stack-name', $GuardrailStackName,
    '--template-stage', 'Original',
    '--profile', $Profile,
    '--region', $GuardrailControlRegion,
    '--output', 'json',
    '--no-cli-pager'
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to retrieve the original template for guardrail stack '$GuardrailStackName'."
}
$guardrailTemplate = ($guardrailTemplateOutput | Out-String) | ConvertFrom-Json
if ($null -eq $guardrailTemplate -or $guardrailTemplate.TemplateBody -isnot [string]) {
    throw "CloudFormation did not return a string Original template body for guardrail stack '$GuardrailStackName'."
}
$deployedGuardrailTemplateSha256 = Get-TextSha256 -Value ([string] $guardrailTemplate.TemplateBody)
if ($deployedGuardrailTemplateSha256 -cne $accountGuardrailTemplateSha256) {
    throw "Guardrail stack '$GuardrailStackName' was not deployed from the reviewed local KAN-229 template."
}
$guardrailParameters = Get-StackParameterMap -Stack $guardrailStack
$expectedGuardrailParameters = [ordered]@{
    ApprovedAccountId = $AccountId
    ApplicationRegion = $Region
    ControlRegion = $GuardrailControlRegion
    EnvironmentName = $EnvironmentName
    EnvironmentOwner = [string] $controlRecord.environment.owner
    FinanceOwner = [string] $controlRecord.environment.financeOwner
    CostCenter = [string] $controlRecord.environment.costCenter
    MonthlyBudgetUsd = [string] $controlRecord.budget.monthlyLimitUsd
    WarningPercent = [string] $controlRecord.budget.warningPercent
    CriticalPercent = [string] $controlRecord.budget.criticalPercent
    AnomalyMode = [string] $controlRecord.budget.anomalyMode
    ExistingAnomalyMonitorArn = $(if ($controlRecord.budget.existingAnomalyMonitorArn -eq 'NOT_APPLICABLE') { '' } else { [string] $controlRecord.budget.existingAnomalyMonitorArn })
    AnomalyAbsoluteUsd = [string] $controlRecord.budget.anomalyAbsoluteUsd
    AnomalyPercentage = [string] $controlRecord.budget.anomalyPercentage
    ApprovalRecordId = [string] $controlRecord.recordId
    ControlsAcknowledgement = 'I_ACKNOWLEDGE_ACCOUNT_LEVEL_COST_CONTROLS'
}
if ($guardrailParameters.Count -ne 18) {
    throw "Guardrail stack '$GuardrailStackName' does not contain the exact 18-parameter KAN-229 configuration."
}
foreach ($expectedParameter in $expectedGuardrailParameters.GetEnumerator()) {
    if (-not $guardrailParameters.Contains($expectedParameter.Key) -or $guardrailParameters[$expectedParameter.Key] -cne $expectedParameter.Value) {
        throw "Guardrail stack parameter '$($expectedParameter.Key)' does not match the final approved billing control record."
    }
}
foreach ($recipientMapping in @(
        @{ Parameter = 'WarningEmail'; RecordValue = [string] $controlRecord.budget.warningRecipient },
        @{ Parameter = 'CriticalEmail'; RecordValue = [string] $controlRecord.budget.criticalRecipient }
    )) {
    if (-not $guardrailParameters.Contains($recipientMapping.Parameter)) {
        throw "Guardrail stack is missing protected recipient parameter '$($recipientMapping.Parameter)'."
    }
    $recipientAddress = [string] $guardrailParameters[$recipientMapping.Parameter]
    $separator = $recipientAddress.LastIndexOf('@')
    if ($separator -le 0 -or $recipientAddress.Substring(0, $separator) -cne $recipientMapping.RecordValue) {
        throw "Guardrail stack recipient '$($recipientMapping.Parameter)' does not match the approved distribution-alias reference."
    }
}
$guardrailOutputs = Get-StackOutputMap -Stack $guardrailStack
$requiredGuardrailOutputs = [ordered]@{
    PolicyVersion = $expectedGuardrailPolicyVersion
    ApprovedAccountId = $AccountId
    ApplicationRegion = $Region
    ControlRegion = $GuardrailControlRegion
    EnvironmentName = $EnvironmentName
    EnvironmentOwner = [string] $controlRecord.environment.owner
    FinanceOwner = [string] $controlRecord.environment.financeOwner
    CostCenter = [string] $controlRecord.environment.costCenter
    ApprovalRecordId = [string] $controlRecord.recordId
    MonthlyBudgetUsd = [string] $controlRecord.budget.monthlyLimitUsd
    WarningPercent = [string] $controlRecord.budget.warningPercent
    CriticalPercent = [string] $controlRecord.budget.criticalPercent
}
foreach ($expectedOutput in $requiredGuardrailOutputs.GetEnumerator()) {
    if (-not $guardrailOutputs.Contains($expectedOutput.Key)) {
        throw "Guardrail stack '$GuardrailStackName' is missing required output '$($expectedOutput.Key)'."
    }
    if ($guardrailOutputs[$expectedOutput.Key] -cne $expectedOutput.Value) {
        throw "Guardrail output '$($expectedOutput.Key)' does not match the approved billing control record."
    }
}
if (-not $guardrailOutputs.Contains('MonthlyBudgetName') -or [string]::IsNullOrWhiteSpace($guardrailOutputs.MonthlyBudgetName)) {
    throw "Guardrail stack '$GuardrailStackName' did not expose its active monthly budget identity."
}
if (-not $guardrailOutputs.Contains('AnomalyMode')) {
    throw "Guardrail stack '$GuardrailStackName' is missing its anomaly-control decision."
}
if ($guardrailOutputs.AnomalyMode -cne [string] $controlRecord.budget.anomalyMode) {
    throw 'The deployed anomaly mode does not match the final approved billing control record.'
}
if (
    $controlRecord.budget.anomalyMode -eq 'Existing' -and
    $guardrailOutputs.CostAnomalyMonitorArn -cne [string] $controlRecord.budget.existingAnomalyMonitorArn
) {
    throw 'The deployed existing anomaly monitor does not match the final approved billing control record.'
}

Assert-RequiredValue -Name 'StackName' -Value $StackName
Assert-RequiredValue -Name 'ChangeSetName' -Value $ChangeSetName

if ($StackName -notmatch '^[A-Za-z][A-Za-z0-9-]{0,127}$') {
    throw 'StackName must be a valid explicit CloudFormation stack name.'
}
if ($ChangeSetName -notmatch '^[A-Za-z][A-Za-z0-9-]{0,127}$') {
    throw 'ChangeSetName must be an explicit CloudFormation-safe name.'
}

$partition = if ($Region -like 'cn-*') {
    'aws-cn'
} elseif ($Region -like 'us-gov-*') {
    'aws-us-gov'
} else {
    'aws'
}

if ($Action -eq 'Plan') {
    Assert-RequiredValue -Name 'ChangeSetType' -Value $ChangeSetType
    Assert-RequiredValue -Name 'EnvironmentName' -Value $EnvironmentName
    if ($EnvironmentName.Length -gt 31 -or $EnvironmentName -notmatch '^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$') {
        throw 'EnvironmentName must be at most 31 characters and use the template non-production pattern: dev|test|qa|sandbox|staging with optional lowercase suffix segments.'
    }

    $parameterMap = [ordered]@{
        EnvironmentName = $EnvironmentName
    }
    $sensitiveParameterName = '(?i)(password|credential|accesskey|secret(?:value|string)?|token)'
    foreach ($item in $ParameterOverride) {
        if ($item -notmatch '^([A-Za-z][A-Za-z0-9]*)=(.+)$') {
            throw "ParameterOverride '$item' must use the exact Key=Value form."
        }

        $key = $Matches[1]
        $value = $Matches[2]
        if ($key -eq 'EnvironmentName') {
            throw 'EnvironmentName is a named argument and must not be repeated in ParameterOverride.'
        }
        if ($key -match $sensitiveParameterName) {
            throw "Secret-bearing override '$key' is prohibited. Generate and resolve secrets through Secrets Manager."
        }
        if ($parameterMap.Contains($key)) {
            throw "ParameterOverride contains duplicate key '$key'."
        }
        $parameterMap[$key] = $value
    }

    $requiredParameters = @(
        'BillingAcknowledgement',
        'ApplicationVersion',
        'ApiImageUri',
        'WebImageUri',
        'WorkerImageUri',
        'S3ManagedPrefixListId',
        'AllowedIngressIpv4Cidr',
        'AlbCertificateArn',
        'ApplicationHostname',
        'PostgresEngineVersion'
    )
    foreach ($requiredParameter in $requiredParameters) {
        if (-not $parameterMap.Contains($requiredParameter)) {
            throw "ParameterOverride must explicitly provide '$requiredParameter'."
        }
    }
    if ($parameterMap.BillingAcknowledgement -cne 'I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES') {
        throw 'BillingAcknowledgement must use the template-defined billable-resource acknowledgement.'
    }

    $parameterDefaults = [ordered]@{
        RdsCaBundlePath = '/etc/ssl/certs/aws-rds-global-bundle.pem'
        ApiDesiredCount = '0'
        WebDesiredCount = '0'
        WorkerDesiredCount = '0'
        VpcCidr = '10.42.0.0/16'
        PublicSubnetACidr = '10.42.0.0/24'
        PublicSubnetBCidr = '10.42.1.0/24'
        PrivateSubnetACidr = '10.42.10.0/24'
        PrivateSubnetBCidr = '10.42.11.0/24'
        PrivateEgressMode = 'VpcEndpoints'
        DatabaseName = 'crypto_lending'
        DatabaseInstanceClass = 'db.t4g.micro'
        DatabaseAllocatedStorageGiB = '20'
        DatabaseDeletionProtection = 'false'
        EnableDatabaseMultiAz = 'false'
        RedisNodeType = 'cache.t4g.micro'
        EnableRedisReplica = 'false'
        StatefulBackupRetentionDays = '1'
        SqsMaxReceiveCount = '3'
        SqsVisibilityTimeoutSeconds = '30'
        LogRetentionDays = '14'
        EnableOperationalAlarms = 'true'
        EnableOperationalDashboard = 'false'
        EnableContainerInsights = 'disabled'
    }
    $allowedParameterNames = @('EnvironmentName') + $requiredParameters + @($parameterDefaults.Keys)
    foreach ($parameterName in $parameterMap.Keys) {
        if ($allowedParameterNames -cnotcontains $parameterName) {
            throw "ParameterOverride contains unknown template parameter '$parameterName'."
        }
    }
    if ($ChangeSetType -eq 'UPDATE') {
        $stackOutput = & $script:AwsExecutable @(
            'cloudformation',
            'describe-stacks',
            '--stack-name', $StackName,
            '--profile', $Profile,
            '--region', $Region,
            '--output', 'json',
            '--no-cli-pager'
        )
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to read current parameters for stack '$StackName'."
        }
        $currentStack = (($stackOutput | Out-String) | ConvertFrom-Json).Stacks | Select-Object -First 1
        if ($null -eq $currentStack) {
            throw "Stack '$StackName' was not returned for UPDATE planning."
        }
        $currentEnvironment = $currentStack.Parameters |
            Where-Object ParameterKey -eq 'EnvironmentName' |
            Select-Object -ExpandProperty ParameterValue -First 1
        if ($currentEnvironment -cne $EnvironmentName) {
            throw "EnvironmentName '$EnvironmentName' does not match the existing stack value '$currentEnvironment'. Create a separate stack for a different environment."
        }
        foreach ($parameter in $currentStack.Parameters) {
            if ($parameterDefaults.Contains($parameter.ParameterKey) -and -not $parameterMap.Contains($parameter.ParameterKey)) {
                $parameterMap[$parameter.ParameterKey] = [string] $parameter.ParameterValue
            }
        }
    }

    foreach ($entry in $parameterDefaults.GetEnumerator()) {
        if (-not $parameterMap.Contains($entry.Key)) {
            $parameterMap[$entry.Key] = $entry.Value
        }
    }

    $cidrParts = $parameterMap.AllowedIngressIpv4Cidr.Split('/')
    $parsedAddress = $null
    $prefixLength = 0
    if (
        $cidrParts.Length -ne 2 -or
        -not [System.Net.IPAddress]::TryParse($cidrParts[0], [ref] $parsedAddress) -or
        $parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
        -not [int]::TryParse($cidrParts[1], [ref] $prefixLength) -or
        $prefixLength -lt 1 -or
        $prefixLength -gt 32
    ) {
        throw 'AllowedIngressIpv4Cidr must be a valid IPv4 CIDR with prefix length 1-32; public /0 ingress is prohibited.'
    }

    if ($ChangeSetType -eq 'CREATE') {
        foreach ($desiredCount in @('ApiDesiredCount', 'WebDesiredCount', 'WorkerDesiredCount')) {
            if ($parameterMap[$desiredCount] -ne '0') {
                throw "$desiredCount must be 0 for a CREATE change set. Start services only in a reviewed UPDATE after endpoints and migrations are ready."
            }
        }
    }

    $ecrDnsSuffix = if ($partition -eq 'aws-cn') { 'amazonaws.com.cn' } else { 'amazonaws.com' }
    $expectedEcrPrefix = "$AccountId.dkr.ecr.$Region.$ecrDnsSuffix/"
    foreach ($imageParameter in @('ApiImageUri', 'WebImageUri', 'WorkerImageUri')) {
        if (-not $parameterMap[$imageParameter].StartsWith($expectedEcrPrefix, [System.StringComparison]::Ordinal)) {
            throw "$imageParameter must reference private ECR in the approved account and region: $expectedEcrPrefix"
        }
    }

    $expectedCertificatePrefix = "arn:${partition}:acm:${Region}:${AccountId}:certificate/"
    if (-not $parameterMap.AlbCertificateArn.StartsWith($expectedCertificatePrefix, [System.StringComparison]::Ordinal)) {
        throw "AlbCertificateArn must reference ACM in the approved account and region: $expectedCertificatePrefix"
    }
    if ($parameterMap.AlbCertificateArn -cne [string] $acmDnsBinding.certificateArn) {
        throw 'AlbCertificateArn does not match the validated KAN-230 certificate.'
    }
    if ($parameterMap.ApplicationHostname -cne [string] $acmDnsBinding.applicationHostname) {
        throw 'ApplicationHostname does not match the validated KAN-230 hostname.'
    }

    $stackTags = [ordered]@{
        application = 'crypto-lending'
        environment = $EnvironmentName
        owner = [string] $controlRecord.environment.owner
        'finance-owner' = [string] $controlRecord.environment.financeOwner
        'cost-center' = [string] $controlRecord.environment.costCenter
        'control-record-sha256' = $controlRecordSha256
        'billing-control-record' = [string] $controlRecord.recordId
        'acm-dns-control-record' = [string] $acmDnsBinding.recordId
        'acm-dns-configuration-sha256' = $acmDnsConfigurationSha256
        'managed-by' = 'cloudformation'
        ticket = 'KAN-34'
    }
    $canonicalTags = ConvertTo-CanonicalTagText -Tags $stackTags
    $tagSha256 = Get-TextSha256 -Value $canonicalTags
    $tagArguments = @()
    foreach ($tag in $stackTags.GetEnumerator()) {
        $tagArguments += "Key=$($tag.Key),Value=$($tag.Value)"
    }

    $parameterArguments = @()
    foreach ($entry in $parameterMap.GetEnumerator()) {
        $parameterArguments += "ParameterKey=$($entry.Key),ParameterValue=$($entry.Value)"
    }
    $canonicalParameters = ($parameterMap.GetEnumerator() | Sort-Object Key | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"
    $parameterSha256 = Get-TextSha256 -Value $canonicalParameters
    $expectedChangeSetDescription = "KAN-34 template-sha256=$templateSha256 parameters-sha256=$parameterSha256 tags-sha256=$tagSha256 control-record-sha256=$controlRecordSha256 acm-dns-record-sha256=$acmDnsRecordSha256 guardrail-policy=$expectedGuardrailPolicyVersion"

    $planArguments = @(
        'cloudformation',
        'create-change-set',
        '--template-body', $templateUri,
        '--stack-name', $StackName,
        '--change-set-name', $ChangeSetName,
        '--change-set-type', $ChangeSetType,
        '--description', $expectedChangeSetDescription,
        '--parameters'
    ) + $parameterArguments + @(
        '--capabilities', 'CAPABILITY_IAM',
        '--tags'
    ) + $tagArguments + @(
        '--profile', $Profile,
        '--region', $Region,
        '--no-cli-pager'
    )

    Invoke-AwsCommand -Arguments $planArguments
    Write-Host "CloudFormation created change set '$ChangeSetName' for review but did not execute it."
    Write-Host 'No application resources were activated by this command.'
    return
}

$descriptionOutput = & $script:AwsExecutable @(
    'cloudformation',
    'describe-change-set',
    '--stack-name', $StackName,
    '--change-set-name', $ChangeSetName,
    '--profile', $Profile,
    '--region', $Region,
    '--output', 'json',
    '--no-cli-pager'
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to describe reviewed change set '$ChangeSetName'."
}
$changeSet = ($descriptionOutput | Out-String) | ConvertFrom-Json
if ($changeSet.StackName -ne $StackName -or $changeSet.ChangeSetName -ne $ChangeSetName) {
    throw 'The described change set identity does not match the explicitly requested stack and change-set names.'
}
if ($changeSet.Status -ne 'CREATE_COMPLETE' -or $changeSet.ExecutionStatus -ne 'AVAILABLE') {
    throw "Change set '$ChangeSetName' is not executable (Status=$($changeSet.Status), ExecutionStatus=$($changeSet.ExecutionStatus))."
}
$changeSetId = [string] $changeSet.ChangeSetId
$expectedChangeSetIdPattern = '^arn:' + [regex]::Escape($partition) + ':cloudformation:' + [regex]::Escape($Region) + ':' + [regex]::Escape($AccountId) + ':changeSet/' + [regex]::Escape($ChangeSetName) + '/[A-Za-z0-9-]+$'
if ($changeSetId -notmatch $expectedChangeSetIdPattern) {
    throw 'The reviewed change set did not return the expected immutable ARN for the approved account and Region.'
}

# The description is not template provenance: a manually created change set can
# copy it. Retrieve the user-submitted body for this immutable change-set ARN and
# hash the actual bytes before execution.
$submittedTemplateOutput = & $script:AwsExecutable @(
    'cloudformation',
    'get-template',
    '--stack-name', $StackName,
    '--change-set-name', $changeSetId,
    '--template-stage', 'Original',
    '--profile', $Profile,
    '--region', $Region,
    '--output', 'json',
    '--no-cli-pager'
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to retrieve the original template for reviewed change set '$ChangeSetName'."
}
$submittedTemplate = ($submittedTemplateOutput | Out-String) | ConvertFrom-Json
if ($null -eq $submittedTemplate -or $submittedTemplate.TemplateBody -isnot [string]) {
    throw "CloudFormation did not return a string Original template body for change set '$ChangeSetName'."
}
$submittedTemplateSha256 = Get-TextSha256 -Value ([string] $submittedTemplate.TemplateBody)
if ($submittedTemplateSha256 -cne $templateSha256) {
    throw "The actual Original template submitted with change set '$ChangeSetName' does not match the reviewed local template. Re-plan and review it."
}
$expectedStackTags = [ordered]@{
    application = 'crypto-lending'
    environment = $EnvironmentName
    owner = [string] $controlRecord.environment.owner
    'finance-owner' = [string] $controlRecord.environment.financeOwner
    'cost-center' = [string] $controlRecord.environment.costCenter
    'control-record-sha256' = $controlRecordSha256
    'billing-control-record' = [string] $controlRecord.recordId
    'acm-dns-control-record' = [string] $acmDnsBinding.recordId
    'acm-dns-configuration-sha256' = $acmDnsConfigurationSha256
    'managed-by' = 'cloudformation'
    ticket = 'KAN-34'
}
$changeSetTags = ConvertFrom-ChangeSetTags -Tags $changeSet.Tags
if ($changeSetTags.Count -ne $expectedStackTags.Count) {
    throw 'The reviewed change set does not contain the exact approved ownership and billing tag set.'
}
foreach ($expectedTag in $expectedStackTags.GetEnumerator()) {
    if (-not $changeSetTags.Contains($expectedTag.Key) -or $changeSetTags[$expectedTag.Key] -cne $expectedTag.Value) {
        throw "The reviewed change set tag '$($expectedTag.Key)' does not match the approved billing control record."
    }
}
$canonicalTags = ConvertTo-CanonicalTagText -Tags $changeSetTags
$tagSha256 = Get-TextSha256 -Value $canonicalTags
$canonicalParameters = ($changeSet.Parameters | Sort-Object ParameterKey | ForEach-Object {
        if ($_.UsePreviousValue -or [string]::IsNullOrEmpty($_.ParameterKey) -or $null -eq $_.ParameterValue) {
            throw 'The reviewed change set contains a non-explicit parameter and cannot be executed by this guard.'
        }
        "$($_.ParameterKey)=$($_.ParameterValue)"
    }) -join "`n"
$parameterSha256 = Get-TextSha256 -Value $canonicalParameters
$changeSetParameterMap = [ordered]@{}
foreach ($parameter in @($changeSet.Parameters)) {
    $changeSetParameterMap[[string] $parameter.ParameterKey] = [string] $parameter.ParameterValue
}
if (
    $changeSetParameterMap.AlbCertificateArn -cne [string] $acmDnsBinding.certificateArn -or
    $changeSetParameterMap.ApplicationHostname -cne [string] $acmDnsBinding.applicationHostname
) {
    throw 'The reviewed change set certificate or hostname does not match the validated KAN-230 record.'
}
$expectedChangeSetDescription = "KAN-34 template-sha256=$templateSha256 parameters-sha256=$parameterSha256 tags-sha256=$tagSha256 control-record-sha256=$controlRecordSha256 acm-dns-record-sha256=$acmDnsRecordSha256 guardrail-policy=$expectedGuardrailPolicyVersion"
if ($changeSet.Description -cne $expectedChangeSetDescription) {
    throw "Change set '$ChangeSetName' is not bound to the current template, parameters, tags, billing record, and guardrail policy. Re-plan and review it."
}
Write-Host "Reviewed template SHA-256: $templateSha256"
Write-Host "Verified submitted template SHA-256: $submittedTemplateSha256"
Write-Host "Reviewed parameter SHA-256: $parameterSha256"
Write-Host "Reviewed tag SHA-256: $tagSha256"
Write-Host "Reviewed billing control record SHA-256: $controlRecordSha256"
Write-Host "Reviewed ACM/DNS control record SHA-256: $acmDnsRecordSha256"

$expectedAcknowledgement = "EXECUTE REVIEWED CHANGE SET $ChangeSetName FOR STACK $StackName USING BILLING CONTROL $controlRecordSha256 AND ACM DNS CONTROL $acmDnsRecordSha256; I ACKNOWLEDGE BILLABLE AWS RESOURCES IN ACCOUNT $AccountId REGION $Region USING PROFILE $Profile"
if ($BillableAcknowledgement -cne $expectedAcknowledgement) {
    throw @"
Deploy can create RDS, ElastiCache, load balancer, networking, logging, KMS, and other billable resources.
After reviewing the change set and budget controls, supply this exact acknowledgement:
$expectedAcknowledgement
"@
}

Write-Warning "Executing reviewed change set '$ChangeSetName' can create billable AWS resources in account $AccountId ($Region)."
Invoke-AwsCommand -Arguments @(
    'cloudformation',
    'execute-change-set',
    '--stack-name', $StackName,
    '--change-set-name', $changeSetId,
    '--client-request-token', ([guid]::NewGuid().ToString()),
    '--profile', $Profile,
    '--region', $Region,
    '--no-cli-pager'
)
