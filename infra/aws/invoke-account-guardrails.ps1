<#
.SYNOPSIS
Validates KAN-229 account cost guardrails locally by default and gates cloud actions.

.DESCRIPTION
LocalValidate is the default and performs only offline template checks. CloudValidate,
Plan, and Deploy require an explicit named profile, expected account, the us-east-1
control Region, and AllowAwsApiCalls. Plan creates a named CloudFormation change set
but never executes it. Deploy verifies the exact reviewed change set and requires a
case-sensitive acknowledgement bound to its template, parameters, and tags.

.PARAMETER ControlReplacementAcknowledgement
Separate exact text emitted when a reviewed change set replaces or removes one of
the retained budget or Cost Anomaly Detection controls. It never substitutes for
the BillableAcknowledgement.

.EXAMPLE
powershell -NoProfile -File infra/aws/invoke-account-guardrails.ps1

Runs local validation only. It does not resolve AWS credentials or call AWS APIs.
#>
[CmdletBinding()]
param(
    [ValidateSet('LocalValidate', 'CloudValidate', 'Plan', 'Deploy')]
    [string] $Action = 'LocalValidate',

    [string] $TemplateFile,

    [string] $BillingControlRecordFile,

    [string] $Profile,

    [string] $AccountId,

    [string] $StackName,

    [string] $ChangeSetName,

    [ValidateSet('CREATE', 'UPDATE')]
    [string] $ChangeSetType,

    [string] $ApprovedAccountId,

    [string] $ApplicationRegion,

    [string] $ControlRegion,

    [string] $EnvironmentName,

    [string] $EnvironmentOwner,

    [string] $FinanceOwner,

    [string] $CostCenter,

    [string] $WarningEmail,

    [string] $CriticalEmail,

    [string] $MonthlyBudgetUsd,

    [string] $WarningPercent,

    [string] $CriticalPercent,

    [ValidateSet('Disabled', 'Create', 'Existing')]
    [string] $AnomalyMode,

    [AllowEmptyString()]
    [string] $ExistingAnomalyMonitorArn,

    [string] $AnomalyAbsoluteUsd,

    [string] $AnomalyPercentage,

    [string] $ApprovalRecordId,

    [string] $ControlsAcknowledgement,

    [switch] $AllowAwsApiCalls,

    [string] $BillableAcknowledgement,

    [string] $ControlReplacementAcknowledgement
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptInvocationParameters = $PSBoundParameters
$expectedControlsAcknowledgement = 'I_ACKNOWLEDGE_ACCOUNT_LEVEL_COST_CONTROLS'
$retainedControlLogicalIds = @(
    'MonthlyCostBudget',
    'CostAnomalyMonitor',
    'CostAnomalySubscription'
)

if ([string]::IsNullOrWhiteSpace($TemplateFile)) {
    $TemplateFile = Join-Path $PSScriptRoot 'account-guardrails.yaml'
}
$resolvedTemplate = [System.IO.Path]::GetFullPath($TemplateFile)
$reviewedTemplate = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'account-guardrails.yaml'))
$linterPath = Join-Path $PSScriptRoot 'lint-cloudformation.py'
$accountGuardrailValidatorPath = Join-Path $PSScriptRoot 'validate-account-guardrails.mjs'
$billingControlRecordValidatorPath = Join-Path $PSScriptRoot 'validate-billing-control-record.mjs'
$billingControlRecord = $null
$billingControlRecordSha256 = $null
$controlConfigurationSha256 = $null

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

function Assert-NotPlaceholder {
    param(
        [string] $Name,
        [string] $Value
    )

    $placeholderPattern = '(?i)(^|[^a-z0-9])(todo|tbd|none|null|unset|placeholder|replace[-_ ]?me|change[-_ ]?me|example|sample|unknown|not[-_ ]?(?:set|approved|run)|your[-_ ])([^a-z0-9]|$)'
    if ($Value -match $placeholderPattern) {
        throw "$Name contains a placeholder value. Supply an approved production-like identifier."
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

function Get-CanonicalMapText {
    param([System.Collections.IDictionary] $Map)

    return ($Map.GetEnumerator() | Sort-Object Key | ForEach-Object {
            "$($_.Key)=$($_.Value)"
        }) -join "`n"
}

function Get-ObjectPropertyValue {
    param(
        [AllowNull()]
        [object] $InputObject,
        [string] $Name
    )

    if ($null -eq $InputObject) {
        return $null
    }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function ConvertTo-InvariantDecimal {
    param(
        [string] $Name,
        [string] $Value,
        [decimal] $Minimum,
        [decimal] $Maximum
    )

    if ($Value -notmatch '^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$') {
        throw "$Name must be a canonical non-negative USD value with no more than two decimal places."
    }
    $parsed = 0D
    if (-not [decimal]::TryParse(
            $Value,
            [System.Globalization.NumberStyles]::AllowDecimalPoint,
            [System.Globalization.CultureInfo]::InvariantCulture,
            [ref] $parsed
        )) {
        throw "$Name is not a valid invariant decimal value."
    }
    if ($parsed -lt $Minimum -or $parsed -gt $Maximum) {
        throw "$Name must be between $Minimum and $Maximum."
    }
    return $parsed
}

function Assert-EmailAddress {
    param(
        [string] $Name,
        [string] $Value
    )

    Assert-RequiredValue -Name $Name -Value $Value
    Assert-NotPlaceholder -Name $Name -Value $Value
    if ($Value.Length -gt 254 -or $Value -match '[\r\n,;]') {
        throw "$Name must contain exactly one email address."
    }
    try {
        $address = [System.Net.Mail.MailAddress]::new($Value)
    }
    catch {
        throw "$Name must be a valid email address."
    }
    if ($address.Address -cne $Value) {
        throw "$Name must be a bare email address without a display name or surrounding whitespace."
    }
    $domain = $address.Host.ToLowerInvariant()
    if (
        $domain -in @('example.com', 'example.org', 'example.net', 'localhost') -or
        $domain.EndsWith('.example') -or
        $domain.EndsWith('.invalid') -or
        $domain.EndsWith('.test') -or
        $domain.EndsWith('.localhost')
    ) {
        throw "$Name must use a deliverable, approved domain rather than a reserved placeholder domain."
    }
}

function Assert-FullGuardrailInputs {
    $requiredParameterNames = @(
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
        'ControlsAcknowledgement'
    )
    foreach ($parameterName in $requiredParameterNames) {
        if (-not $scriptInvocationParameters.ContainsKey($parameterName)) {
            throw "$parameterName must be supplied explicitly; Plan and Deploy require the full template parameter set."
        }
    }

    Assert-RequiredValue -Name 'ApprovedAccountId' -Value $ApprovedAccountId
    if ($ApprovedAccountId -notmatch '^\d{12}$' -or $ApprovedAccountId -in @('000000000000', '123456789012')) {
        throw 'ApprovedAccountId must be a real explicit 12-digit AWS account ID, not a sample value.'
    }
    if ($ApprovedAccountId -cne $AccountId) {
        throw "ApprovedAccountId '$ApprovedAccountId' must exactly match expected caller AccountId '$AccountId'."
    }

    Assert-RequiredValue -Name 'ApplicationRegion' -Value $ApplicationRegion
    if ($ApplicationRegion -notmatch '^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]+$') {
        throw 'ApplicationRegion must be an explicit AWS Region such as us-west-2.'
    }
    if ($ControlRegion -cne 'us-east-1') {
        throw 'ControlRegion must be us-east-1 for account billing controls and Cost Explorer resources.'
    }

    Assert-RequiredValue -Name 'EnvironmentName' -Value $EnvironmentName
    if ($EnvironmentName.Length -gt 31 -or $EnvironmentName -notmatch '^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$') {
        throw 'EnvironmentName must use dev|test|qa|sandbox|staging with optional lowercase suffix segments and be at most 31 characters.'
    }

    foreach ($ownerInput in @(
            @{ Name = 'EnvironmentOwner'; Value = $EnvironmentOwner },
            @{ Name = 'FinanceOwner'; Value = $FinanceOwner }
        )) {
        Assert-RequiredValue -Name $ownerInput.Name -Value $ownerInput.Value
        Assert-NotPlaceholder -Name $ownerInput.Name -Value $ownerInput.Value
        if ($ownerInput.Value.Length -gt 64 -or $ownerInput.Value -notmatch '^[a-z][a-z0-9-]{1,62}[a-z0-9]$') {
            throw "$($ownerInput.Name) must be a stable 3-64 character lowercase owner slug."
        }
        if ($ownerInput.Value -match '^(?i:owner|finance|admin|team)$') {
            throw "$($ownerInput.Name) is too generic to establish accountable ownership."
        }
    }

    Assert-RequiredValue -Name 'CostCenter' -Value $CostCenter
    Assert-NotPlaceholder -Name 'CostCenter' -Value $CostCenter
    if ($CostCenter.Length -gt 32 -or $CostCenter -notmatch '^[A-Z][A-Z0-9-]{0,30}[A-Z0-9]$') {
        throw 'CostCenter must be a stable 2-32 character uppercase cost allocation slug.'
    }
    if ($CostCenter -match '^(?i:cost[-_ ]?center|none|n/?a|0+)$') {
        throw 'CostCenter is a placeholder rather than an approved cost allocation identifier.'
    }

    Assert-EmailAddress -Name 'WarningEmail' -Value $WarningEmail
    Assert-EmailAddress -Name 'CriticalEmail' -Value $CriticalEmail
    if ($WarningEmail -ieq $CriticalEmail) {
        throw 'WarningEmail and CriticalEmail must be distinct approved distribution aliases.'
    }

    $null = ConvertTo-InvariantDecimal -Name 'MonthlyBudgetUsd' -Value $MonthlyBudgetUsd -Minimum 1D -Maximum 1000000D
    $null = ConvertTo-InvariantDecimal -Name 'AnomalyAbsoluteUsd' -Value $AnomalyAbsoluteUsd -Minimum 1D -Maximum 1000000D

    if ($WarningPercent -notmatch '^(50|60|70)$') {
        throw 'WarningPercent must be one of the template-approved values: 50, 60, or 70.'
    }
    if ($CriticalPercent -notmatch '^(80|90)$') {
        throw 'CriticalPercent must be one of the template-approved values: 80 or 90.'
    }
    if ([int] $WarningPercent -ge [int] $CriticalPercent) {
        throw 'WarningPercent must be lower than CriticalPercent.'
    }
    if ($AnomalyPercentage -notmatch '^(?:[1-9][0-9]{0,4}|100000)$') {
        throw 'AnomalyPercentage must be a whole percentage from 1 through 100000.'
    }

    Assert-RequiredValue -Name 'AnomalyMode' -Value $AnomalyMode
    switch ($AnomalyMode) {
        'Existing' {
            Assert-RequiredValue -Name 'ExistingAnomalyMonitorArn' -Value $ExistingAnomalyMonitorArn
            $escapedAccountId = [regex]::Escape($ApprovedAccountId)
            if ($ExistingAnomalyMonitorArn -notmatch "^arn:aws:ce::${escapedAccountId}:anomalymonitor/[A-Za-z0-9-]+$") {
                throw 'ExistingAnomalyMonitorArn must be a commercial-partition Cost Explorer anomaly-monitor ARN in ApprovedAccountId.'
            }
        }
        default {
            if (-not [string]::IsNullOrEmpty($ExistingAnomalyMonitorArn)) {
                throw "ExistingAnomalyMonitorArn must be explicitly empty when AnomalyMode is '$AnomalyMode'."
            }
        }
    }

    Assert-RequiredValue -Name 'ApprovalRecordId' -Value $ApprovalRecordId
    Assert-NotPlaceholder -Name 'ApprovalRecordId' -Value $ApprovalRecordId
    if ($ApprovalRecordId -notmatch '^KAN-229[:#-][A-Za-z0-9][A-Za-z0-9._:/-]{2,119}$') {
        throw 'ApprovalRecordId must identify a concrete KAN-229 approval record, for example KAN-229:APPROVED-001.'
    }
    if ($ControlsAcknowledgement -cne $expectedControlsAcknowledgement) {
        throw "ControlsAcknowledgement must exactly equal '$expectedControlsAcknowledgement'."
    }
}

function Get-GuardrailParameterMap {
    return [ordered]@{
        ApprovedAccountId = $ApprovedAccountId
        ApplicationRegion = $ApplicationRegion
        ControlRegion = $ControlRegion
        EnvironmentName = $EnvironmentName
        EnvironmentOwner = $EnvironmentOwner
        FinanceOwner = $FinanceOwner
        CostCenter = $CostCenter
        WarningEmail = $WarningEmail
        CriticalEmail = $CriticalEmail
        MonthlyBudgetUsd = $MonthlyBudgetUsd
        WarningPercent = $WarningPercent
        CriticalPercent = $CriticalPercent
        AnomalyMode = $AnomalyMode
        ExistingAnomalyMonitorArn = $ExistingAnomalyMonitorArn
        AnomalyAbsoluteUsd = $AnomalyAbsoluteUsd
        AnomalyPercentage = $AnomalyPercentage
        ApprovalRecordId = $ApprovalRecordId
        ControlsAcknowledgement = $ControlsAcknowledgement
    }
}

function Get-GuardrailTagMap {
    return [ordered]@{
        application = 'crypto-lending'
        environment = $EnvironmentName
        'control-scope' = 'account-billing'
        owner = $EnvironmentOwner
        'finance-owner' = $FinanceOwner
        'cost-center' = $CostCenter
        'managed-by' = 'cloudformation'
        ticket = 'KAN-229'
        'approval-record' = $ApprovalRecordId
        'control-configuration-sha256' = $controlConfigurationSha256
    }
}

function Assert-ControlRecordMatchesDirectInputs {
    param([object] $Record)

    $comparisons = @(
        @{ RecordPath = 'record.recordId'; Actual = [string] $Record.recordId; Expected = $ApprovalRecordId },
        @{ RecordPath = 'record.aws.accountId'; Actual = [string] $Record.aws.accountId; Expected = $ApprovedAccountId },
        @{ RecordPath = 'record.aws.applicationRegion'; Actual = [string] $Record.aws.applicationRegion; Expected = $ApplicationRegion },
        @{ RecordPath = 'record.aws.controlRegion'; Actual = [string] $Record.aws.controlRegion; Expected = $ControlRegion },
        @{ RecordPath = 'record.environment.name'; Actual = [string] $Record.environment.name; Expected = $EnvironmentName },
        @{ RecordPath = 'record.environment.owner'; Actual = [string] $Record.environment.owner; Expected = $EnvironmentOwner },
        @{ RecordPath = 'record.environment.financeOwner'; Actual = [string] $Record.environment.financeOwner; Expected = $FinanceOwner },
        @{ RecordPath = 'record.environment.costCenter'; Actual = [string] $Record.environment.costCenter; Expected = $CostCenter },
        @{ RecordPath = 'record.budget.monthlyLimitUsd'; Actual = [string] $Record.budget.monthlyLimitUsd; Expected = $MonthlyBudgetUsd },
        @{ RecordPath = 'record.budget.warningPercent'; Actual = [string] $Record.budget.warningPercent; Expected = $WarningPercent },
        @{ RecordPath = 'record.budget.criticalPercent'; Actual = [string] $Record.budget.criticalPercent; Expected = $CriticalPercent },
        @{ RecordPath = 'record.budget.anomalyMode'; Actual = [string] $Record.budget.anomalyMode; Expected = $AnomalyMode },
        @{ RecordPath = 'record.budget.anomalyAbsoluteUsd'; Actual = [string] $Record.budget.anomalyAbsoluteUsd; Expected = $AnomalyAbsoluteUsd },
        @{ RecordPath = 'record.budget.anomalyPercentage'; Actual = [string] $Record.budget.anomalyPercentage; Expected = $AnomalyPercentage },
        @{ RecordPath = 'record.budget.existingAnomalyMonitorArn'; Actual = [string] $Record.budget.existingAnomalyMonitorArn; Expected = $(if ([string]::IsNullOrEmpty($ExistingAnomalyMonitorArn)) { 'NOT_APPLICABLE' } else { $ExistingAnomalyMonitorArn }) }
    )
    foreach ($comparison in $comparisons) {
        if ($comparison.Actual -cne $comparison.Expected) {
            throw "$($comparison.RecordPath) '$($comparison.Actual)' does not match direct guard value '$($comparison.Expected)'."
        }
    }

    $warningAlias = $WarningEmail.Substring(0, $WarningEmail.LastIndexOf('@'))
    $criticalAlias = $CriticalEmail.Substring(0, $CriticalEmail.LastIndexOf('@'))
    if ([string] $Record.budget.warningRecipient -cne $warningAlias) {
        throw "record.budget.warningRecipient must equal the direct WarningEmail distribution-alias local part '$warningAlias'."
    }
    if ([string] $Record.budget.criticalRecipient -cne $criticalAlias) {
        throw "record.budget.criticalRecipient must equal the direct CriticalEmail distribution-alias local part '$criticalAlias'."
    }

    $expectedMechanism = if ($AnomalyMode -eq 'Disabled') {
        'AWS_BUDGETS'
    }
    else {
        'AWS_BUDGETS_AND_COST_ANOMALY_DETECTION'
    }
    if ([string] $Record.budget.mechanism -cne $expectedMechanism) {
        throw "record.budget.mechanism must equal '$expectedMechanism' when direct AnomalyMode is '$AnomalyMode'."
    }
}

function Assert-MapMatchesChangeSet {
    param(
        [string] $MapName,
        [System.Collections.IDictionary] $ExpectedMap,
        [AllowNull()]
        [object[]] $ActualItems,
        [string] $KeyProperty,
        [string] $ValueProperty
    )

    $actualMap = @{}
    foreach ($item in @($ActualItems)) {
        $key = Get-ObjectPropertyValue -InputObject $item -Name $KeyProperty
        $value = Get-ObjectPropertyValue -InputObject $item -Name $ValueProperty
        if ([string]::IsNullOrEmpty([string] $key) -or $null -eq $value) {
            throw "The reviewed change set contains a malformed $MapName entry."
        }
        if ($actualMap.ContainsKey([string] $key)) {
            throw "The reviewed change set contains duplicate $MapName key '$key'."
        }
        $actualMap[[string] $key] = [string] $value
    }
    if ($actualMap.Count -ne $ExpectedMap.Count) {
        throw "The reviewed change set $MapName set is not exact (expected $($ExpectedMap.Count), found $($actualMap.Count))."
    }
    foreach ($entry in $ExpectedMap.GetEnumerator()) {
        if (-not $actualMap.ContainsKey([string] $entry.Key) -or $actualMap[[string] $entry.Key] -cne [string] $entry.Value) {
            throw "The reviewed change set $MapName value for '$($entry.Key)' does not match the locally approved value."
        }
    }
}

function Get-RetainedControlHazards {
    param([AllowNull()][object[]] $Changes)

    $hazards = @()
    foreach ($change in @($Changes)) {
        $resourceChange = Get-ObjectPropertyValue -InputObject $change -Name 'ResourceChange'
        $logicalId = [string] (Get-ObjectPropertyValue -InputObject $resourceChange -Name 'LogicalResourceId')
        if ($retainedControlLogicalIds -cnotcontains $logicalId) {
            continue
        }
        $action = [string] (Get-ObjectPropertyValue -InputObject $resourceChange -Name 'Action')
        $replacement = [string] (Get-ObjectPropertyValue -InputObject $resourceChange -Name 'Replacement')
        if ($action -eq 'Remove' -or $replacement -in @('True', 'Conditional')) {
            if ([string]::IsNullOrEmpty($replacement)) {
                $replacement = 'NotApplicable'
            }
            $hazards += "${logicalId}:${action}:${replacement}"
        }
    }
    return @($hazards | Sort-Object -Unique)
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

if (-not (Test-Path -LiteralPath $resolvedTemplate -PathType Leaf)) {
    throw "Account guardrail template was not found: $resolvedTemplate"
}
if (-not (Test-Path -LiteralPath $reviewedTemplate -PathType Leaf)) {
    throw "Reviewed account guardrail template was not found: $reviewedTemplate"
}
if (-not (Test-Path -LiteralPath $linterPath -PathType Leaf)) {
    throw "Local CloudFormation linter entry point was not found: $linterPath"
}
if (-not (Test-Path -LiteralPath $billingControlRecordValidatorPath -PathType Leaf)) {
    throw "Billing control record validator was not found: $billingControlRecordValidatorPath"
}

$templateInfo = Get-Item -LiteralPath $resolvedTemplate
if ($templateInfo.Length -gt 51200) {
    throw 'Template exceeds the 51,200-byte direct-upload limit. This guard will not stage it in S3.'
}
$reviewedTemplateSha256 = (Get-FileHash -LiteralPath $reviewedTemplate -Algorithm SHA256).Hash.ToLowerInvariant()
$candidateTemplateSha256 = (Get-FileHash -LiteralPath $resolvedTemplate -Algorithm SHA256).Hash.ToLowerInvariant()
if ($candidateTemplateSha256 -cne $reviewedTemplateSha256) {
    throw 'TemplateFile must match the reviewed repository account-guardrails.yaml byte-for-byte. Review and commit template changes before planning them.'
}
$templateText = Get-Content -LiteralPath $resolvedTemplate -Raw
foreach ($retainedResource in @(
        @{ LogicalId = 'MonthlyCostBudget'; Type = 'AWS::Budgets::Budget'; DeletionPolicy = 'Retain' },
        @{ LogicalId = 'CostAnomalyMonitor'; Type = 'AWS::CE::AnomalyMonitor'; DeletionPolicy = 'Delete' },
        @{ LogicalId = 'CostAnomalySubscription'; Type = 'AWS::CE::AnomalySubscription'; DeletionPolicy = 'Delete' }
    )) {
    $logicalIdPattern = [regex]::Escape($retainedResource.LogicalId)
    $typePattern = [regex]::Escape($retainedResource.Type)
    $resourcePattern = "(?ms)^\s{2}${logicalIdPattern}:\s*\r?\n(?<body>.*?)(?=^\s{2}[A-Za-z][A-Za-z0-9]*:\s*\r?$|\z)"
    $resourceMatch = [regex]::Match($templateText, $resourcePattern)
    if (-not $resourceMatch.Success) {
        throw "Local policy validation requires retained control '$($retainedResource.LogicalId)'."
    }
    $resourceBody = $resourceMatch.Groups['body'].Value
    if (
        $resourceBody -notmatch "(?m)^\s+Type:\s+$typePattern\s*$" -or
        $resourceBody -notmatch "(?m)^\s+DeletionPolicy:\s+$($retainedResource.DeletionPolicy)\s*$" -or
        $resourceBody -notmatch '(?m)^\s+UpdateReplacePolicy:\s+Delete\s*$'
    ) {
        throw "Control '$($retainedResource.LogicalId)' must have the expected type, DeletionPolicy $($retainedResource.DeletionPolicy), and explicit UpdateReplacePolicy Delete."
    }
}
foreach ($prohibitedType in @(
        'AWS::Budgets::BudgetsAction',
        'AWS::CloudFormation::CustomResource',
        'AWS::Lambda::Function',
        'AWS::KMS::Key',
        'AWS::CloudWatch::Dashboard'
    )) {
    if ($templateText -match [regex]::Escape("Type: $prohibitedType")) {
        throw "Local policy validation prohibits $prohibitedType in the no/low-additional-charge account guardrail stack."
    }
}
if ($templateText -match '(?m)^\s+Type:\s+Custom::') {
    throw 'Local policy validation prohibits custom resources in the account guardrail stack.'
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
    throw 'Node.js is required for local account-guardrail policy validation.'
}
& $nodeCommand.Source $accountGuardrailValidatorPath --template $resolvedTemplate
if ($LASTEXITCODE -ne 0) {
    throw 'Local account-guardrail policy validation failed. No AWS calls were made.'
}

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($null -eq $pythonCommand) {
    throw 'Python is required for offline CloudFormation linting.'
}
& $pythonCommand.Source $linterPath $resolvedTemplate
if ($LASTEXITCODE -ne 0) {
    throw 'Local CloudFormation linting failed. No AWS calls were made.'
}

$templateSha256 = (Get-FileHash -LiteralPath $resolvedTemplate -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Action -eq 'LocalValidate') {
    Write-Host "Local validation completed for template SHA-256 $templateSha256."
    Write-Host 'No AWS credentials were resolved, no AWS calls were made, and no resources or change sets were created.'
    return
}

Assert-RequiredValue -Name 'Profile' -Value $Profile
Assert-RequiredValue -Name 'AccountId' -Value $AccountId
Assert-RequiredValue -Name 'ControlRegion' -Value $ControlRegion
if ($Profile -match '^(?i:default)$') {
    throw 'The implicit/default AWS profile is prohibited. Supply a named, non-default profile.'
}
Assert-NotPlaceholder -Name 'Profile' -Value $Profile
if ($Profile -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$') {
    throw 'Profile must be an explicit 2-64 character named AWS profile.'
}
if ($AccountId -notmatch '^\d{12}$' -or $AccountId -in @('000000000000', '123456789012')) {
    throw 'AccountId must be a real explicit 12-digit AWS account ID, not a sample value.'
}
if ($ControlRegion -cne 'us-east-1') {
    throw 'ControlRegion must be us-east-1 for these account-level billing controls.'
}

if ($Action -in @('Plan', 'Deploy')) {
    Assert-RequiredValue -Name 'StackName' -Value $StackName
    Assert-RequiredValue -Name 'ChangeSetName' -Value $ChangeSetName
    Assert-RequiredValue -Name 'ChangeSetType' -Value $ChangeSetType
    Assert-NotPlaceholder -Name 'StackName' -Value $StackName
    Assert-NotPlaceholder -Name 'ChangeSetName' -Value $ChangeSetName
    if ($StackName -notmatch '^[A-Za-z][A-Za-z0-9-]{0,127}$') {
        throw 'StackName must be a valid explicit CloudFormation stack name.'
    }
    if ($ChangeSetName -notmatch '^[A-Za-z][A-Za-z0-9-]{0,127}$') {
        throw 'ChangeSetName must be a valid explicit CloudFormation change-set name.'
    }
}

# Every cloud-side action requires the complete explicit template input set so
# the bootstrap approval record can be checked before credential discovery.
Assert-FullGuardrailInputs
Assert-RequiredValue -Name 'BillingControlRecordFile' -Value $BillingControlRecordFile
$resolvedBillingControlRecord = [System.IO.Path]::GetFullPath($BillingControlRecordFile)
if (-not (Test-Path -LiteralPath $resolvedBillingControlRecord -PathType Leaf)) {
    throw "BillingControlRecordFile was not found: $resolvedBillingControlRecord"
}
$recordFileInfo = Get-Item -LiteralPath $resolvedBillingControlRecord
if ($recordFileInfo.Length -gt 1048576) {
    throw 'BillingControlRecordFile exceeds the 1 MiB local safety limit.'
}
$recordFileSha256Before = (Get-FileHash -LiteralPath $resolvedBillingControlRecord -Algorithm SHA256).Hash.ToLowerInvariant()
$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $recordValidationOutput = & $nodeCommand.Source @(
        $billingControlRecordValidatorPath,
        '--record', $resolvedBillingControlRecord,
        '--mode', 'bootstrap',
        '--expected-account', $AccountId,
        '--expected-application-region', $ApplicationRegion,
        '--expected-control-region', $ControlRegion,
        '--expected-environment', $EnvironmentName,
        '--json'
    ) 2>&1
    $recordValidationExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
if ($recordValidationExitCode -ne 0) {
    $recordValidationMessage = ($recordValidationOutput | Out-String).Trim()
    throw "Bootstrap billing control record validation failed before AWS discovery. No AWS calls were made.`n$recordValidationMessage"
}
try {
    $recordValidationResult = (($recordValidationOutput | Out-String) | ConvertFrom-Json)
}
catch {
    throw 'Bootstrap billing control record validator returned malformed JSON. No AWS calls were made.'
}
if (
    (Get-ObjectPropertyValue -InputObject $recordValidationResult -Name 'ok') -ne $true -or
    (Get-ObjectPropertyValue -InputObject $recordValidationResult -Name 'awsCallsMade') -ne 0
) {
    throw 'Bootstrap billing control record validator did not return an offline successful result.'
}
$billingControlRecordSha256 = [string] (Get-ObjectPropertyValue -InputObject $recordValidationResult -Name 'canonicalSha256')
if ($billingControlRecordSha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Bootstrap billing control record validator did not return a canonical SHA-256 value.'
}
$controlConfigurationSha256 = [string] (Get-ObjectPropertyValue -InputObject $recordValidationResult -Name 'controlConfigurationSha256')
if ($controlConfigurationSha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Bootstrap billing control record validator did not return a control configuration SHA-256 value.'
}
$recordFileSha256After = (Get-FileHash -LiteralPath $resolvedBillingControlRecord -Algorithm SHA256).Hash.ToLowerInvariant()
if ($recordFileSha256After -cne $recordFileSha256Before) {
    throw 'BillingControlRecordFile changed during validation. Re-run with a stable reviewed record.'
}
try {
    $billingControlRecord = (Get-Content -LiteralPath $resolvedBillingControlRecord -Raw) | ConvertFrom-Json
}
catch {
    throw 'BillingControlRecordFile could not be parsed after successful validation.'
}
Assert-ControlRecordMatchesDirectInputs -Record $billingControlRecord

$parameterMap = $null
$tagMap = $null
$parameterSha256 = $null
$tagSha256 = $null
$expectedChangeSetDescription = $null
$expectedDeployAcknowledgement = $null
$expectedReplacementAcknowledgement = $null
if ($Action -in @('Plan', 'Deploy')) {
    $parameterMap = Get-GuardrailParameterMap
    $tagMap = Get-GuardrailTagMap
    $parameterSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $parameterMap)
    $tagSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $tagMap)
    $expectedChangeSetDescription = "KAN-229 template-sha256=$templateSha256 parameters-sha256=$parameterSha256 tags-sha256=$tagSha256 control-record-sha256=$billingControlRecordSha256"
    $expectedDeployAcknowledgement = "EXECUTE REVIEWED KAN-229 CHANGE SET $ChangeSetName FOR STACK $StackName; TYPE $ChangeSetType; TEMPLATE SHA256 $templateSha256; PARAMETERS SHA256 $parameterSha256; TAGS SHA256 $tagSha256; RECORD SHA256 $billingControlRecordSha256; ACCOUNT $AccountId; CONTROL REGION $ControlRegion; PROFILE $Profile"
    $expectedReplacementAcknowledgement = "AUTHORIZE REPLACEMENT OR REMOVAL OF RETAINED KAN-229 CONTROLS IN CHANGE SET $ChangeSetName FOR STACK $StackName; TEMPLATE SHA256 $templateSha256; PARAMETERS SHA256 $parameterSha256; TAGS SHA256 $tagSha256; RECORD SHA256 $billingControlRecordSha256; ACCOUNT $AccountId; CONTROL REGION $ControlRegion; PROFILE $Profile"
}

if ($Action -eq 'Deploy' -and $BillableAcknowledgement -cne $expectedDeployAcknowledgement) {
    throw @"
Deploy is blocked before any AWS call. After reviewing the exact change set, supply this case-sensitive acknowledgement:
$expectedDeployAcknowledgement
"@
}

if (-not $AllowAwsApiCalls.IsPresent) {
    throw "Action '$Action' is cloud-side. Re-run with -AllowAwsApiCalls after reviewing the account, profile, control Region, parameters, tags, and expected charges."
}

$awsCommand = Get-Command aws -ErrorAction SilentlyContinue
if ($null -eq $awsCommand) {
    throw 'AWS CLI v2 is required for explicitly opted-in cloud actions.'
}
$script:AwsExecutable = $awsCommand.Source

$identityOutput = & $script:AwsExecutable @(
    'sts',
    'get-caller-identity',
    '--profile', $Profile,
    '--region', $ControlRegion,
    '--output', 'json',
    '--no-cli-pager'
)
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to verify the explicitly named AWS profile.'
}
try {
    $callerIdentity = (($identityOutput | Out-String) | ConvertFrom-Json)
}
catch {
    throw 'AWS STS returned malformed caller identity JSON.'
}
$actualAccountId = [string] (Get-ObjectPropertyValue -InputObject $callerIdentity -Name 'Account')
if ($actualAccountId -cne $AccountId) {
    throw "Named profile '$Profile' resolved to account '$actualAccountId', not approved account '$AccountId'."
}
$callerArn = [string] (Get-ObjectPropertyValue -InputObject $callerIdentity -Name 'Arn')
$approvedRoleArn = [string] $billingControlRecord.aws.approvedRoleArn
$approvedRoleMatch = [regex]::Match($approvedRoleArn, '^arn:(?<partition>aws(?:-us-gov|-cn)?):iam::\d{12}:role/(?:.*/)?(?<roleName>[^/]+)$')
if (-not $approvedRoleMatch.Success) {
    throw 'The validated billing control record contains an unusable approvedRoleArn.'
}
$expectedCallerPrefix = "arn:$($approvedRoleMatch.Groups['partition'].Value):sts::${AccountId}:assumed-role/$($approvedRoleMatch.Groups['roleName'].Value)/"
if (-not $callerArn.StartsWith($expectedCallerPrefix, [System.StringComparison]::Ordinal)) {
    throw "Named profile '$Profile' resolved to caller '$callerArn', not approved role '$approvedRoleArn'."
}

$templateUri = 'file://' + ($resolvedTemplate -replace '\\', '/')
if ($Action -eq 'CloudValidate') {
    Invoke-AwsCommand -Arguments @(
        'cloudformation',
        'validate-template',
        '--template-body', $templateUri,
        '--profile', $Profile,
        '--region', $ControlRegion,
        '--no-cli-pager'
    )
    Write-Host 'AWS validated the template syntax. No stack, change set, budget, monitor, or subscription was created.'
    return
}

if ($Action -eq 'Plan') {
    $parameterPayload = @($parameterMap.GetEnumerator() | ForEach-Object {
            [ordered]@{ ParameterKey = [string] $_.Key; ParameterValue = [string] $_.Value }
        }) | ConvertTo-Json -Compress -Depth 4
    $tagPayload = @($tagMap.GetEnumerator() | ForEach-Object {
            [ordered]@{ Key = [string] $_.Key; Value = [string] $_.Value }
        }) | ConvertTo-Json -Compress -Depth 4

    Invoke-AwsCommand -Arguments @(
        'cloudformation',
        'create-change-set',
        '--template-body', $templateUri,
        '--stack-name', $StackName,
        '--change-set-name', $ChangeSetName,
        '--change-set-type', $ChangeSetType,
        '--description', $expectedChangeSetDescription,
        '--parameters', $parameterPayload,
        '--tags', $tagPayload,
        '--profile', $Profile,
        '--region', $ControlRegion,
        '--no-cli-pager'
    )
    Invoke-AwsCommand -Arguments @(
        'cloudformation',
        'wait',
        'change-set-create-complete',
        '--stack-name', $StackName,
        '--change-set-name', $ChangeSetName,
        '--profile', $Profile,
        '--region', $ControlRegion,
        '--no-cli-pager'
    )
    $planOutput = & $script:AwsExecutable @(
        'cloudformation',
        'describe-change-set',
        '--stack-name', $StackName,
        '--change-set-name', $ChangeSetName,
        '--profile', $Profile,
        '--region', $ControlRegion,
        '--output', 'json',
        '--no-cli-pager'
    )
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect created change set '$ChangeSetName'."
    }
    $plannedChangeSet = ($planOutput | Out-String) | ConvertFrom-Json
    $planStatus = [string] (Get-ObjectPropertyValue -InputObject $plannedChangeSet -Name 'Status')
    $planExecutionStatus = [string] (Get-ObjectPropertyValue -InputObject $plannedChangeSet -Name 'ExecutionStatus')
    if ($planStatus -ne 'CREATE_COMPLETE' -or $planExecutionStatus -ne 'AVAILABLE') {
        throw "Created change set '$ChangeSetName' is not reviewable (Status=$planStatus, ExecutionStatus=$planExecutionStatus)."
    }
    $hazards = @(Get-RetainedControlHazards -Changes (Get-ObjectPropertyValue -InputObject $plannedChangeSet -Name 'Changes'))
    Write-Host "CloudFormation created change set '$ChangeSetName' for review and did not execute it."
    Write-Host "Template SHA-256: $templateSha256"
    Write-Host "Parameter SHA-256: $parameterSha256"
    Write-Host "Tag SHA-256: $tagSha256"
    Write-Host "Billing control record canonical SHA-256: $billingControlRecordSha256"
    if ($hazards.Count -gt 0) {
        Write-Warning "The plan replaces or removes retained controls: $($hazards -join ', ')"
        if ($ControlReplacementAcknowledgement -cne $expectedReplacementAcknowledgement) {
            throw @"
The change set was created for review but is blocked from execution because it replaces or removes a retained cost control.
After reviewing the retained resources and orphan/duplicate-charge implications, supply this separate case-sensitive acknowledgement to Deploy:
$expectedReplacementAcknowledgement
"@
        }
    }
    elseif (-not [string]::IsNullOrEmpty($ControlReplacementAcknowledgement)) {
        throw 'ControlReplacementAcknowledgement was supplied, but this plan has no replacement or removal of a retained control.'
    }
    Write-Host 'No account guardrail resource was created or changed by Plan.'
    return
}

$descriptionOutput = & $script:AwsExecutable @(
    'cloudformation',
    'describe-change-set',
    '--stack-name', $StackName,
    '--change-set-name', $ChangeSetName,
    '--profile', $Profile,
    '--region', $ControlRegion,
    '--output', 'json',
    '--no-cli-pager'
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to describe reviewed change set '$ChangeSetName'."
}
$changeSet = ($descriptionOutput | Out-String) | ConvertFrom-Json
if (
    (Get-ObjectPropertyValue -InputObject $changeSet -Name 'StackName') -cne $StackName -or
    (Get-ObjectPropertyValue -InputObject $changeSet -Name 'ChangeSetName') -cne $ChangeSetName
) {
    throw 'The described change set identity does not match the explicitly requested stack and change-set names.'
}
$changeSetId = [string] (Get-ObjectPropertyValue -InputObject $changeSet -Name 'ChangeSetId')
$expectedChangeSetIdPattern = '^arn:aws:cloudformation:' + [regex]::Escape($ControlRegion) + ':' + [regex]::Escape($AccountId) + ':changeSet/' + [regex]::Escape($ChangeSetName) + '/[A-Za-z0-9-]+$'
if ($changeSetId -notmatch $expectedChangeSetIdPattern) {
    throw 'The reviewed change-set ARN is not bound to the approved account, control Region, and change-set name.'
}
$templateOutput = & $script:AwsExecutable @(
    'cloudformation',
    'get-template',
    '--stack-name', $StackName,
    '--change-set-name', $changeSetId,
    '--template-stage', 'Original',
    '--profile', $Profile,
    '--region', $ControlRegion,
    '--output', 'json',
    '--no-cli-pager'
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to retrieve the original template for immutable change set '$changeSetId'."
}
try {
    $retrievedTemplate = (($templateOutput | Out-String) | ConvertFrom-Json)
}
catch {
    throw 'CloudFormation returned malformed get-template JSON for the reviewed change set.'
}
$submittedTemplateBody = Get-ObjectPropertyValue -InputObject $retrievedTemplate -Name 'TemplateBody'
if ($submittedTemplateBody -isnot [string]) {
    throw 'CloudFormation get-template did not return the original TemplateBody as text.'
}
$submittedTemplateSha256 = Get-TextSha256 -Value $submittedTemplateBody
if ($submittedTemplateSha256 -cne $templateSha256) {
    throw "The reviewed change set contains original template SHA-256 '$submittedTemplateSha256', not local reviewed template SHA-256 '$templateSha256'. Re-plan and review it."
}
if ((Get-ObjectPropertyValue -InputObject $changeSet -Name 'ChangeSetType') -cne $ChangeSetType) {
    throw 'The reviewed change-set type does not match ChangeSetType.'
}
$status = [string] (Get-ObjectPropertyValue -InputObject $changeSet -Name 'Status')
$executionStatus = [string] (Get-ObjectPropertyValue -InputObject $changeSet -Name 'ExecutionStatus')
if ($status -ne 'CREATE_COMPLETE' -or $executionStatus -ne 'AVAILABLE') {
    throw "Change set '$ChangeSetName' is not executable (Status=$status, ExecutionStatus=$executionStatus)."
}
if ((Get-ObjectPropertyValue -InputObject $changeSet -Name 'Description') -cne $expectedChangeSetDescription) {
    throw "Change set '$ChangeSetName' is not bound to the current template, parameter, and tag SHA-256 values. Re-plan and review it."
}

$actualParameters = @(Get-ObjectPropertyValue -InputObject $changeSet -Name 'Parameters')
foreach ($parameter in $actualParameters) {
    if ((Get-ObjectPropertyValue -InputObject $parameter -Name 'UsePreviousValue') -eq $true) {
        throw 'The reviewed change set contains UsePreviousValue and is not a fully explicit KAN-229 plan.'
    }
}
Assert-MapMatchesChangeSet -MapName 'parameter' -ExpectedMap $parameterMap -ActualItems $actualParameters -KeyProperty 'ParameterKey' -ValueProperty 'ParameterValue'
Assert-MapMatchesChangeSet -MapName 'tag' -ExpectedMap $tagMap -ActualItems @(Get-ObjectPropertyValue -InputObject $changeSet -Name 'Tags') -KeyProperty 'Key' -ValueProperty 'Value'

$capabilities = @(Get-ObjectPropertyValue -InputObject $changeSet -Name 'Capabilities')
if ($capabilities.Count -gt 0) {
    throw 'The reviewed account-guardrail change set unexpectedly requests IAM capabilities.'
}

$hazards = @(Get-RetainedControlHazards -Changes (Get-ObjectPropertyValue -InputObject $changeSet -Name 'Changes'))
if ($hazards.Count -gt 0) {
    if ($ControlReplacementAcknowledgement -cne $expectedReplacementAcknowledgement) {
        throw @"
Deploy is blocked because the reviewed change set replaces or removes retained controls: $($hazards -join ', ')
Supply this separate case-sensitive acknowledgement only after reviewing retained-resource and duplicate-charge implications:
$expectedReplacementAcknowledgement
"@
    }
}
elseif (-not [string]::IsNullOrEmpty($ControlReplacementAcknowledgement)) {
    throw 'ControlReplacementAcknowledgement was supplied, but the reviewed change set has no replacement or removal of a retained control.'
}

Write-Host "Verified template SHA-256: $templateSha256"
Write-Host "Verified parameter SHA-256: $parameterSha256"
Write-Host "Verified tag SHA-256: $tagSha256"
Write-Host "Verified billing control record canonical SHA-256: $billingControlRecordSha256"
Write-Warning "Executing reviewed change set '$ChangeSetName' changes account-level cost controls in account $AccountId ($ControlRegion)."
Invoke-AwsCommand -Arguments @(
    'cloudformation',
    'execute-change-set',
    '--stack-name', $StackName,
    '--change-set-name', $changeSetId,
    '--client-request-token', ([guid]::NewGuid().ToString()),
    '--profile', $Profile,
    '--region', $ControlRegion,
    '--no-cli-pager'
)
