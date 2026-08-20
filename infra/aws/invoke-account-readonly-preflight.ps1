<#
.SYNOPSIS
Runs the KAN-229 constrained account identity and AWS Budgets inventory preflight.

.DESCRIPTION
LocalValidate is the default and makes zero AWS calls. Inventory requires an
explicit non-default profile, a control record outside the repository, and the
AllowAwsApiCalls switch. Inventory invokes only STS GetCallerIdentity, IAM
ListAccountAliases, and AWS Budgets read operations. It never invokes Cost
Explorer or a mutating AWS operation.
#>

[CmdletBinding()]
param(
    [ValidateSet('LocalValidate', 'Inventory')]
    [string] $Action = 'LocalValidate',

    [string] $BillingControlRecordFile,

    [string] $Profile,

    [string] $ApplicationRegion,

    [switch] $AllowAwsApiCalls,

    [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:AwsCallsMade = 0
$script:AllowedAwsOperations = @(
    'sts:get-caller-identity',
    'iam:list-account-aliases',
    'budgets:describe-budgets',
    'budgets:describe-notifications-for-budget',
    'budgets:describe-subscribers-for-notification',
    'budgets:list-tags-for-resource',
    'budgets:describe-budget-actions-for-account'
)

function Get-PropertyValue {
    param(
        [Parameter(Mandatory = $true)]
        [object] $InputObject,

        [Parameter(Mandatory = $true)]
        [string] $Name
    )

    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function Invoke-AwsJson {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    if ($Arguments.Count -lt 2) {
        throw 'Approved read-only AWS calls require an explicit service and operation.'
    }
    $operation = "$($Arguments[0]):$($Arguments[1])"
    if ($operation -cnotin $script:AllowedAwsOperations) {
        throw "AWS operation is not in the constrained read-only allowlist: $operation."
    }

    $script:AwsCallsMade += 1
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & $script:AwsExecutable @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($exitCode -ne 0) {
        throw "Approved read-only AWS call failed: $($Arguments[0..1] -join ' ')."
    }
    try {
        return (($output | Out-String) | ConvertFrom-Json)
    }
    catch {
        throw "Approved read-only AWS call returned malformed JSON: $($Arguments[0..1] -join ' ')."
    }
}

function Test-HasObjectContent {
    param([object] $Value)

    if ($null -eq $Value) {
        return $false
    }
    if ($Value -is [System.Collections.IDictionary]) {
        return $Value.Count -gt 0
    }
    return $Value.PSObject.Properties.Count -gt 0
}

function Get-Sha256Hex {
    param(
        [Parameter(Mandatory = $true)]
        [byte[]] $Bytes
    )

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}

function Assert-FullyPaginated {
    param(
        [Parameter(Mandatory = $true)]
        [object] $Response,

        [Parameter(Mandatory = $true)]
        [string] $Operation
    )

    $nextToken = [string] (Get-PropertyValue -InputObject $Response -Name 'NextToken')
    if (-not [string]::IsNullOrWhiteSpace($nextToken)) {
        throw "$Operation returned an unconsumed pagination token. Inventory is incomplete."
    }
}

$validatorPath = Join-Path $PSScriptRoot 'validate-account-guardrails.mjs'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
    throw 'Node.js is required for the local KAN-229 policy validation.'
}
$validatorOutput = @(& $nodeCommand.Source $validatorPath 2>&1)
if ($LASTEXITCODE -ne 0) {
    throw "KAN-229 repository policy validation failed: $($validatorOutput -join ' ')"
}

if ($Action -eq 'LocalValidate') {
    if ($AllowAwsApiCalls.IsPresent) {
        throw 'AllowAwsApiCalls is not accepted for LocalValidate.'
    }
    Write-Host 'KAN-229 local read-only preflight validation passed.'
    Write-Host 'AWS API calls made: 0'
    return
}

if ([string]::IsNullOrWhiteSpace($BillingControlRecordFile)) {
    throw 'Inventory requires BillingControlRecordFile outside the repository.'
}
if ([string]::IsNullOrWhiteSpace($Profile) -or $Profile -eq 'default') {
    throw 'Inventory requires an explicitly named non-default AWS profile.'
}
if ([string]::IsNullOrWhiteSpace($ApplicationRegion) -or $ApplicationRegion -notmatch '^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]+$') {
    throw 'Inventory requires an explicit application Region such as us-west-2.'
}

$resolvedRecord = (Resolve-Path -LiteralPath $BillingControlRecordFile).Path
$recordBytes = [System.IO.File]::ReadAllBytes($resolvedRecord)
$recordFileSha256 = Get-Sha256Hex -Bytes $recordBytes
$preflightScriptSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $PSCommandPath).Hash.ToLowerInvariant()
$readonlyPolicyPath = Join-Path $PSScriptRoot 'kan-229-readonly-preflight-policy.json'
$readonlyPolicySha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $readonlyPolicyPath).Hash.ToLowerInvariant()
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $PSScriptRoot '..') '..'))
$repositoryPrefix = $repositoryRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
if ($resolvedRecord.StartsWith($repositoryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'BillingControlRecordFile must live outside the repository.'
}
try {
    $record = ([System.Text.Encoding]::UTF8.GetString($recordBytes)) | ConvertFrom-Json
}
catch {
    throw 'BillingControlRecordFile is not valid JSON.'
}

$accountId = [string] (Get-PropertyValue -InputObject $record.aws -Name 'accountId')
$configuredAlias = [string] (Get-PropertyValue -InputObject $record.aws -Name 'accountAlias')
$approvedRoleArn = [string] (Get-PropertyValue -InputObject $record.aws -Name 'approvedRoleArn')
$recordApplicationRegion = [string] (Get-PropertyValue -InputObject $record.aws -Name 'applicationRegion')
$controlRegion = [string] (Get-PropertyValue -InputObject $record.aws -Name 'controlRegion')
$recordId = [string] (Get-PropertyValue -InputObject $record -Name 'recordId')
$environmentName = [string] (Get-PropertyValue -InputObject $record.environment -Name 'name')
$environmentOwner = [string] (Get-PropertyValue -InputObject $record.environment -Name 'owner')
$financeOwner = [string] (Get-PropertyValue -InputObject $record.environment -Name 'financeOwner')
$costCenter = [string] (Get-PropertyValue -InputObject $record.environment -Name 'costCenter')
if ($accountId -notmatch '^\d{12}$') {
    throw 'The control record must contain a 12-digit aws.accountId.'
}
$approvedRoleMatch = [regex]::Match(
    $approvedRoleArn,
    '^arn:(?<partition>aws(?:-us-gov|-cn)?):iam::(?<account>\d{12}):role/(?:.*/)?(?<roleName>[^/]+)$'
)
if (-not $approvedRoleMatch.Success -or $approvedRoleMatch.Groups['account'].Value -cne $accountId) {
    throw 'The control record must contain a same-account IAM role ARN.'
}
if ($controlRegion -cne 'us-east-1') {
    throw 'KAN-229 cost controls require aws.controlRegion to equal us-east-1.'
}
if ($recordApplicationRegion -cne $ApplicationRegion) {
    throw 'The explicit application Region does not match the control record.'
}

if (-not $AllowAwsApiCalls.IsPresent) {
    throw 'Inventory is cloud-side. Re-run with AllowAwsApiCalls only after separate read authorization.'
}

$awsCommand = Get-Command aws -ErrorAction SilentlyContinue
if ($null -eq $awsCommand) {
    throw 'AWS CLI v2 is required for the explicitly opted-in inventory.'
}
$script:AwsExecutable = $awsCommand.Source

$identity = Invoke-AwsJson -Arguments @(
    'sts',
    'get-caller-identity',
    '--profile', $Profile,
    '--region', $controlRegion,
    '--output', 'json',
    '--no-cli-pager'
)
$callerAccount = [string] (Get-PropertyValue -InputObject $identity -Name 'Account')
$callerArn = [string] (Get-PropertyValue -InputObject $identity -Name 'Arn')
$expectedCallerPrefix = "arn:$($approvedRoleMatch.Groups['partition'].Value):sts::${accountId}:assumed-role/$($approvedRoleMatch.Groups['roleName'].Value)/"
$accountMatches = $callerAccount -ceq $accountId
$roleMatches = $callerArn.StartsWith($expectedCallerPrefix, [System.StringComparison]::Ordinal)
if (-not $accountMatches -or -not $roleMatches) {
    throw 'The named profile does not resolve to the approved account and assumed role.'
}

$aliasResponse = Invoke-AwsJson -Arguments @(
    'iam',
    'list-account-aliases',
    '--profile', $Profile,
    '--output', 'json',
    '--no-cli-pager'
)
$aliases = @(Get-PropertyValue -InputObject $aliasResponse -Name 'AccountAliases')
$configuredAliasIsValid = $configuredAlias -match '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$'
$aliasMatches = $configuredAliasIsValid -and $aliases.Count -eq 1 -and ([string] $aliases[0] -ceq $configuredAlias)
if (-not $aliasMatches) {
    throw 'The AWS account alias does not exactly match the approved control record.'
}

$budgetsResponse = Invoke-AwsJson -Arguments @(
    'budgets',
    'describe-budgets',
    '--account-id', $accountId,
    '--show-filter-expression',
    '--page-size', '100',
    '--profile', $Profile,
    '--region', $controlRegion,
    '--output', 'json',
    '--no-cli-pager'
)
Assert-FullyPaginated -Response $budgetsResponse -Operation 'budgets describe-budgets'
$budgets = @(Get-PropertyValue -InputObject $budgetsResponse -Name 'Budgets')
$accountWideMonthlyCostBudgets = @($budgets | Where-Object {
        [string] (Get-PropertyValue -InputObject $_ -Name 'BudgetType') -ceq 'COST' -and
        [string] (Get-PropertyValue -InputObject $_ -Name 'TimeUnit') -ceq 'MONTHLY' -and
        [string]::IsNullOrWhiteSpace([string] (Get-PropertyValue -InputObject $_ -Name 'BillingViewArn')) -and
        -not (Test-HasObjectContent (Get-PropertyValue -InputObject $_ -Name 'FilterExpression')) -and
        -not (Test-HasObjectContent (Get-PropertyValue -InputObject $_ -Name 'CostFilters'))
    })

$notificationCount = 0
$emailSubscriberCount = 0
$snsSubscriberCount = 0
$candidateBudgetsWithRequiredTagKeys = 0
$candidateBudgetsMatchingApprovedTags = 0
$expectedBudgetTags = [ordered]@{
    application = 'crypto-lending'
    environment = $environmentName
    'control-scope' = 'account-billing'
    owner = $environmentOwner
    'finance-owner' = $financeOwner
    'cost-center' = $costCenter
    'managed-by' = 'cloudformation'
    ticket = 'KAN-229'
    'approval-record' = $recordId
}
foreach ($budget in $accountWideMonthlyCostBudgets) {
    $budgetName = [string] (Get-PropertyValue -InputObject $budget -Name 'BudgetName')
    if ([string]::IsNullOrWhiteSpace($budgetName)) {
        throw 'AWS returned an account-wide monthly cost budget without a name.'
    }
    $notificationsResponse = Invoke-AwsJson -Arguments @(
        'budgets',
        'describe-notifications-for-budget',
        '--account-id', $accountId,
        '--budget-name', $budgetName,
        '--page-size', '100',
        '--profile', $Profile,
        '--region', $controlRegion,
        '--output', 'json',
        '--no-cli-pager'
    )
    Assert-FullyPaginated -Response $notificationsResponse -Operation 'budgets describe-notifications-for-budget'
    $notifications = @(Get-PropertyValue -InputObject $notificationsResponse -Name 'Notifications')
    $notificationCount += $notifications.Count
    foreach ($notification in $notifications) {
        $notificationMap = [ordered]@{
            NotificationType = Get-PropertyValue -InputObject $notification -Name 'NotificationType'
            ComparisonOperator = Get-PropertyValue -InputObject $notification -Name 'ComparisonOperator'
            Threshold = Get-PropertyValue -InputObject $notification -Name 'Threshold'
        }
        $thresholdType = [string] (Get-PropertyValue -InputObject $notification -Name 'ThresholdType')
        if (-not [string]::IsNullOrWhiteSpace($thresholdType)) {
            $notificationMap['ThresholdType'] = $thresholdType
        }
        $notificationPayload = $notificationMap | ConvertTo-Json -Compress
        $subscribersResponse = Invoke-AwsJson -Arguments @(
            'budgets',
            'describe-subscribers-for-notification',
            '--account-id', $accountId,
            '--budget-name', $budgetName,
            '--notification', $notificationPayload,
            '--page-size', '100',
            '--profile', $Profile,
            '--region', $controlRegion,
            '--output', 'json',
            '--no-cli-pager'
        )
        Assert-FullyPaginated -Response $subscribersResponse -Operation 'budgets describe-subscribers-for-notification'
        foreach ($subscriber in @(Get-PropertyValue -InputObject $subscribersResponse -Name 'Subscribers')) {
            $subscriptionType = [string] (Get-PropertyValue -InputObject $subscriber -Name 'SubscriptionType')
            if ($subscriptionType -ceq 'EMAIL') {
                $emailSubscriberCount += 1
            }
            elseif ($subscriptionType -ceq 'SNS') {
                $snsSubscriberCount += 1
            }
        }
    }

    $budgetArn = "arn:$($approvedRoleMatch.Groups['partition'].Value):budgets::${accountId}:budget/${budgetName}"
    $tagsResponse = Invoke-AwsJson -Arguments @(
        'budgets',
        'list-tags-for-resource',
        '--resource-arn', $budgetArn,
        '--profile', $Profile,
        '--region', $controlRegion,
        '--output', 'json',
        '--no-cli-pager'
    )
    $actualBudgetTags = @{}
    foreach ($tag in @(Get-PropertyValue -InputObject $tagsResponse -Name 'ResourceTags')) {
        $tagKey = [string] (Get-PropertyValue -InputObject $tag -Name 'Key')
        if (-not [string]::IsNullOrWhiteSpace($tagKey)) {
            $actualBudgetTags[$tagKey] = [string] (Get-PropertyValue -InputObject $tag -Name 'Value')
        }
    }
    if (@($expectedBudgetTags.Keys | Where-Object { $_ -cnotin $actualBudgetTags.Keys }).Count -eq 0) {
        $candidateBudgetsWithRequiredTagKeys += 1
    }
    $tagMismatches = @($expectedBudgetTags.Keys | Where-Object {
            $_ -cnotin $actualBudgetTags.Keys -or $actualBudgetTags[$_] -cne $expectedBudgetTags[$_]
        })
    if ($tagMismatches.Count -eq 0) {
        $candidateBudgetsMatchingApprovedTags += 1
    }
}

$actionsResponse = Invoke-AwsJson -Arguments @(
    'budgets',
    'describe-budget-actions-for-account',
    '--account-id', $accountId,
    '--page-size', '100',
    '--profile', $Profile,
    '--region', $controlRegion,
    '--output', 'json',
    '--no-cli-pager'
)
Assert-FullyPaginated -Response $actionsResponse -Operation 'budgets describe-budget-actions-for-account'
$budgetActionCount = @(Get-PropertyValue -InputObject $actionsResponse -Name 'Actions').Count

if ((Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedRecord).Hash.ToLowerInvariant() -cne $recordFileSha256 -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $PSCommandPath).Hash.ToLowerInvariant() -cne $preflightScriptSha256 -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $readonlyPolicyPath).Hash.ToLowerInvariant() -cne $readonlyPolicySha256) {
    throw 'A locally bound preflight artifact changed during execution; discard the result.'
}

$report = [ordered]@{
    schemaVersion = 1
    executedAtUtc = [DateTime]::UtcNow.ToString('o')
    recordFileSha256 = $recordFileSha256
    preflightScriptSha256 = $preflightScriptSha256
    readonlyPolicySha256 = $readonlyPolicySha256
    accountMatchesApprovedRecord = $accountMatches
    callerIsApprovedAssumedRole = $roleMatches
    applicationRegionMatchesApprovedInput = $true
    accountAliasExists = $aliases.Count -eq 1
    configuredAliasFormatValid = $configuredAliasIsValid
    configuredAliasMatchesAws = $aliasMatches
    budgetCount = $budgets.Count
    accountWideMonthlyCostBudgetCount = $accountWideMonthlyCostBudgets.Count
    candidateBudgetNotificationCount = $notificationCount
    candidateBudgetEmailSubscriberCount = $emailSubscriberCount
    candidateBudgetSnsSubscriberCount = $snsSubscriberCount
    candidateBudgetsWithRequiredTagKeys = $candidateBudgetsWithRequiredTagKeys
    candidateBudgetsMatchingApprovedTags = $candidateBudgetsMatchingApprovedTags
    budgetActionCount = $budgetActionCount
    anomalyInventory = 'NOT_RUN_COST_UNVERIFIED'
    retainedResourceInventory = 'NOT_RUN_COST_UNVERIFIED'
    costExplorerCallsMade = 0
    mutatingAwsCallsMade = 0
    paidServiceActivationsMade = 0
    costBoundary = 'NO_DIRECT_SERVICE_API_FEE_IDENTIFIED;INDIRECT_ACCOUNT_LOGGING_COST_NOT_VERIFIED'
    awsCliInvocationsMade = $script:AwsCallsMade
    awsApiRequestCount = 'UNKNOWN_CLI_PAGINATION_AND_RETRIES'
}
if ($Json.IsPresent) {
    $report | ConvertTo-Json
}
else {
    $report.GetEnumerator() | ForEach-Object { Write-Host "$($_.Key): $($_.Value)" }
}
