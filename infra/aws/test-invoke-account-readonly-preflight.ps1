[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$preflightPath = Join-Path $PSScriptRoot 'invoke-account-readonly-preflight.ps1'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("kan229-readonly-test-" + [guid]::NewGuid().ToString('N'))
$fakeAwsDirectory = Join-Path $temporaryRoot 'fake-aws'
$markerPath = Join-Path $temporaryRoot 'aws-calls.log'
$recordPath = Join-Path $temporaryRoot 'billing-control-record.json'
$budgetResponsePath = Join-Path $temporaryRoot 'budgets.json'
$notificationResponsePath = Join-Path $temporaryRoot 'notifications.json'
$subscriberResponsePath = Join-Path $temporaryRoot 'subscribers.json'
$tagResponsePath = Join-Path $temporaryRoot 'tags.json'
$actionResponsePath = Join-Path $temporaryRoot 'actions.json'
$originalPath = $env:PATH
$environmentNames = @(
    'FAKE_AWS_MARKER',
    'FAKE_AWS_ACCOUNT',
    'FAKE_AWS_CALLER_ARN',
    'FAKE_AWS_BUDGETS',
    'FAKE_AWS_NOTIFICATIONS',
    'FAKE_AWS_SUBSCRIBERS',
    'FAKE_AWS_TAGS',
    'FAKE_AWS_ACTIONS'
)
$originalEnvironment = @{}
foreach ($name in $environmentNames) {
    $originalEnvironment[$name] = [System.Environment]::GetEnvironmentVariable($name)
}
$passed = 0

function Invoke-Preflight {
    param([System.Collections.IDictionary] $Arguments)

    $captured = @()
    try {
        $captured = @(& $preflightPath @Arguments *>&1)
        return [pscustomobject]@{
            Succeeded = $true
            Output = (($captured | ForEach-Object { $_.ToString() }) -join "`n")
        }
    }
    catch {
        $captured += $_.Exception.Message
        return [pscustomobject]@{
            Succeeded = $false
            Output = (($captured | ForEach-Object { $_.ToString() }) -join "`n")
        }
    }
    finally {
        $global:LASTEXITCODE = 0
    }
}

function Assert-Condition {
    param(
        [bool] $Condition,
        [string] $Message
    )

    if (-not $Condition) {
        throw "ASSERTION FAILED: $Message"
    }
}

function Invoke-FocusedTest {
    param(
        [string] $Name,
        [scriptblock] $Body
    )

    & $Body
    $script:passed += 1
    Write-Host "PASS: $Name"
}

function Clear-AwsMarker {
    if (Test-Path -LiteralPath $markerPath) {
        Remove-Item -LiteralPath $markerPath -Force
    }
}

function Get-AwsCalls {
    if (-not (Test-Path -LiteralPath $markerPath)) {
        return @()
    }
    return @(Get-Content -LiteralPath $markerPath)
}

try {
    New-Item -ItemType Directory -Path $fakeAwsDirectory -Force | Out-Null
    $isWindowsPlatform = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
    if ($isWindowsPlatform) {
        $fakeAwsPath = Join-Path $fakeAwsDirectory 'aws.cmd'
        @'
@echo off
setlocal
>>"%FAKE_AWS_MARKER%" echo %*
if /I "%~1"=="sts" if /I "%~2"=="get-caller-identity" (
  echo {"UserId":"AROATEST:kan229-readonly","Account":"%FAKE_AWS_ACCOUNT%","Arn":"%FAKE_AWS_CALLER_ARN%"}
  exit /b 0
)
if /I "%~1"=="iam" if /I "%~2"=="list-account-aliases" (
  echo {"AccountAliases":["crypto-lending-test"]}
  exit /b 0
)
if /I "%~1"=="budgets" if /I "%~2"=="describe-budgets" (
  type "%FAKE_AWS_BUDGETS%"
  exit /b 0
)
if /I "%~1"=="budgets" if /I "%~2"=="describe-notifications-for-budget" (
  type "%FAKE_AWS_NOTIFICATIONS%"
  exit /b 0
)
if /I "%~1"=="budgets" if /I "%~2"=="describe-subscribers-for-notification" (
  type "%FAKE_AWS_SUBSCRIBERS%"
  exit /b 0
)
if /I "%~1"=="budgets" if /I "%~2"=="list-tags-for-resource" (
  type "%FAKE_AWS_TAGS%"
  exit /b 0
)
if /I "%~1"=="budgets" if /I "%~2"=="describe-budget-actions-for-account" (
  type "%FAKE_AWS_ACTIONS%"
  exit /b 0
)
echo {"UnexpectedCommand":true}
exit /b 9
'@ | Set-Content -LiteralPath $fakeAwsPath -Encoding Ascii
    }
    else {
        $fakeAwsPath = Join-Path $fakeAwsDirectory 'aws'
        @'
#!/usr/bin/env sh
printf '%s\n' "$*" >> "$FAKE_AWS_MARKER"
if [ "$1" = "sts" ] && [ "$2" = "get-caller-identity" ]; then
  printf '{"UserId":"AROATEST:kan229-readonly","Account":"%s","Arn":"%s"}\n' "$FAKE_AWS_ACCOUNT" "$FAKE_AWS_CALLER_ARN"
  exit 0
fi
if [ "$1" = "iam" ] && [ "$2" = "list-account-aliases" ]; then
  printf '{"AccountAliases":["crypto-lending-test"]}\n'
  exit 0
fi
if [ "$1" = "budgets" ] && [ "$2" = "describe-budgets" ]; then cat "$FAKE_AWS_BUDGETS"; exit 0; fi
if [ "$1" = "budgets" ] && [ "$2" = "describe-notifications-for-budget" ]; then cat "$FAKE_AWS_NOTIFICATIONS"; exit 0; fi
if [ "$1" = "budgets" ] && [ "$2" = "describe-subscribers-for-notification" ]; then cat "$FAKE_AWS_SUBSCRIBERS"; exit 0; fi
if [ "$1" = "budgets" ] && [ "$2" = "list-tags-for-resource" ]; then cat "$FAKE_AWS_TAGS"; exit 0; fi
if [ "$1" = "budgets" ] && [ "$2" = "describe-budget-actions-for-account" ]; then cat "$FAKE_AWS_ACTIONS"; exit 0; fi
printf '{"UnexpectedCommand":true}\n'
exit 9
'@ | Set-Content -LiteralPath $fakeAwsPath -Encoding Ascii
        & chmod +x $fakeAwsPath
        if ($LASTEXITCODE -ne 0) {
            throw 'Unable to mark the fake AWS executable as executable.'
        }
    }

    [ordered]@{
        recordId = 'KAN-229:test-approval'
        aws = [ordered]@{
            accountId = '111122223333'
            accountAlias = 'crypto-lending-test'
            approvedRoleArn = 'arn:aws:iam::111122223333:role/Kan229GuardrailRole'
            applicationRegion = 'us-west-2'
            controlRegion = 'us-east-1'
        }
        environment = [ordered]@{
            name = 'dev'
            owner = 'environment-owner'
            financeOwner = 'finance-owner'
            costCenter = 'CRYPTO-LENDING'
        }
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $recordPath -Encoding Ascii
    [ordered]@{
        Budgets = @(
            [ordered]@{
                BudgetName = 'private-existing-budget-name'
                BudgetType = 'COST'
                TimeUnit = 'MONTHLY'
            },
            [ordered]@{
                BudgetName = 'private-billing-view-budget-name'
                BudgetType = 'COST'
                TimeUnit = 'MONTHLY'
                BillingViewArn = 'arn:aws:billing::111122223333:billingview/scoped-view'
            }
        )
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $budgetResponsePath -Encoding Ascii
    [ordered]@{
        Notifications = @(
            [ordered]@{
                NotificationType = 'ACTUAL'
                ComparisonOperator = 'GREATER_THAN'
                Threshold = 80
                ThresholdType = 'PERCENTAGE'
            }
        )
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $notificationResponsePath -Encoding Ascii
    @{ Subscribers = @(@{ SubscriptionType = 'EMAIL'; Address = 'not-returned-by-report@example.test' }) } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $subscriberResponsePath -Encoding Ascii
    @{ ResourceTags = @(
            @{ Key = 'application'; Value = 'crypto-lending' },
            @{ Key = 'environment'; Value = 'dev' },
            @{ Key = 'control-scope'; Value = 'account-billing' },
            @{ Key = 'owner'; Value = 'environment-owner' },
            @{ Key = 'finance-owner'; Value = 'finance-owner' },
            @{ Key = 'cost-center'; Value = 'CRYPTO-LENDING' },
            @{ Key = 'managed-by'; Value = 'cloudformation' },
            @{ Key = 'ticket'; Value = 'KAN-229' },
            @{ Key = 'approval-record'; Value = 'KAN-229:test-approval' },
            @{ Key = 'control-configuration-sha256'; Value = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
        ) } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $tagResponsePath -Encoding Ascii
    @{ Actions = @() } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $actionResponsePath -Encoding Ascii

    $env:PATH = $fakeAwsDirectory + [System.IO.Path]::PathSeparator + $originalPath
    $env:FAKE_AWS_MARKER = $markerPath
    $env:FAKE_AWS_ACCOUNT = '111122223333'
    $env:FAKE_AWS_CALLER_ARN = 'arn:aws:sts::111122223333:assumed-role/Kan229GuardrailRole/kan229-readonly'
    $env:FAKE_AWS_BUDGETS = $budgetResponsePath
    $env:FAKE_AWS_NOTIFICATIONS = $notificationResponsePath
    $env:FAKE_AWS_SUBSCRIBERS = $subscriberResponsePath
    $env:FAKE_AWS_TAGS = $tagResponsePath
    $env:FAKE_AWS_ACTIONS = $actionResponsePath

    Invoke-FocusedTest 'default LocalValidate makes zero AWS calls' {
        Clear-AwsMarker
        $result = Invoke-Preflight @{}
        Assert-Condition $result.Succeeded $result.Output
        Assert-Condition (@(Get-AwsCalls).Count -eq 0) 'LocalValidate invoked AWS.'
    }

    Invoke-FocusedTest 'Inventory requires explicit opt-in before AWS discovery' {
        Clear-AwsMarker
        $result = Invoke-Preflight @{
            Action = 'Inventory'
            BillingControlRecordFile = $recordPath
            Profile = 'kan229-test'
            ApplicationRegion = 'us-west-2'
        }
        Assert-Condition (-not $result.Succeeded) 'Inventory unexpectedly succeeded without opt-in.'
        Assert-Condition (@(Get-AwsCalls).Count -eq 0) 'Inventory invoked AWS before opt-in.'
    }

    Invoke-FocusedTest 'constrained inventory invokes only approved reads and sanitizes output' {
        Clear-AwsMarker
        $result = Invoke-Preflight @{
            Action = 'Inventory'
            BillingControlRecordFile = $recordPath
            Profile = 'kan229-test'
            ApplicationRegion = 'us-west-2'
            AllowAwsApiCalls = $true
            Json = $true
        }
        Assert-Condition $result.Succeeded $result.Output
        $report = $result.Output | ConvertFrom-Json
        $calls = @(Get-AwsCalls)
        Assert-Condition ($calls.Count -eq 7) "Expected seven approved reads, received $($calls.Count)."
        Assert-Condition (-not (($calls -join "`n") -match '(?i)(^|\s)ce(\s|$)|create-|update-|delete-|execute-')) 'Inventory invoked a forbidden command.'
        Assert-Condition ($report.mutatingAwsCallsMade -eq 0) 'Report did not prove zero mutations.'
        Assert-Condition ($report.costExplorerCallsMade -eq 0) 'Report did not prove zero Cost Explorer calls.'
        Assert-Condition ($report.awsCliInvocationsMade -eq 7) 'Report did not record the exact CLI invocation count.'
        Assert-Condition ($report.budgetCount -eq 2) 'Report did not count every returned budget.'
        Assert-Condition ($report.accountWideMonthlyCostBudgetCount -eq 1) 'Report treated a billing-view budget as account-wide.'
        Assert-Condition ($report.candidateBudgetsWithRequiredTagKeys -eq 1) 'Report did not match the exact tag-key contract.'
        Assert-Condition ($report.candidateBudgetsMatchingApprovedTags -eq 1) 'Report did not match the exact approved tag values.'
        Assert-Condition ($report.awsApiRequestCount -eq 'UNKNOWN_CLI_PAGINATION_AND_RETRIES') 'Report misstated the underlying API request count.'
        Assert-Condition ($report.recordFileSha256 -match '^[a-f0-9]{64}$') 'Report did not bind the exact record file.'
        Assert-Condition ($report.preflightScriptSha256 -match '^[a-f0-9]{64}$') 'Report did not bind the preflight script.'
        Assert-Condition ($report.readonlyPolicySha256 -match '^[a-f0-9]{64}$') 'Report did not bind the read-only policy.'
        Assert-Condition ($report.recordFileSha256 -ceq (Get-FileHash -Algorithm SHA256 -LiteralPath $recordPath).Hash.ToLowerInvariant()) 'Report record hash differs from the exact fixture.'
        Assert-Condition ($report.preflightScriptSha256 -ceq (Get-FileHash -Algorithm SHA256 -LiteralPath $preflightPath).Hash.ToLowerInvariant()) 'Report script hash differs from the exact invoked artifact.'
        Assert-Condition ($report.readonlyPolicySha256 -ceq (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $PSScriptRoot 'kan-229-readonly-preflight-policy.json')).Hash.ToLowerInvariant()) 'Report policy hash differs from the exact local artifact.'
        $executedAt = [DateTimeOffset]::MinValue
        Assert-Condition ([DateTimeOffset]::TryParseExact([string] $report.executedAtUtc, 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref] $executedAt)) 'Report UTC execution timestamp is not round-trip ISO 8601.'
        Assert-Condition ($executedAt.Offset -eq [TimeSpan]::Zero) 'Report execution timestamp is not UTC.'
        Assert-Condition ($result.Output -notmatch 'example\.test') 'Report leaked a subscriber address.'
        Assert-Condition ($result.Output -notmatch '111122223333') 'Report leaked an account ID.'
        Assert-Condition ($result.Output -notmatch 'crypto-lending-test') 'Report leaked an account alias.'
        Assert-Condition ($result.Output -notmatch 'Kan229GuardrailRole') 'Report leaked a caller ARN or role name.'
        Assert-Condition ($result.Output -notmatch 'private-existing-budget-name') 'Report leaked a budget name.'
        Assert-Condition ($result.Output -notmatch 'private-billing-view-budget-name') 'Report leaked a scoped budget name.'
        Assert-Condition ($result.Output -notmatch 'environment-owner') 'Report leaked a tag value.'
        Assert-Condition ($result.Output -notmatch 'finance-owner') 'Report leaked a finance-owner value.'
        Assert-Condition ($result.Output -notmatch 'CRYPTO-LENDING') 'Report leaked a cost-center value.'
        Assert-Condition ($result.Output -notmatch 'KAN-229:test-approval') 'Report leaked a record ID.'
    }

    Invoke-FocusedTest 'unconsumed pagination token fails closed' {
        Clear-AwsMarker
        $originalBudgetResponse = Get-Content -Raw -LiteralPath $budgetResponsePath
        $truncated = $originalBudgetResponse | ConvertFrom-Json
        $truncated | Add-Member -NotePropertyName NextToken -NotePropertyValue 'unconsumed-page'
        $truncated | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $budgetResponsePath -Encoding Ascii
        try {
            $result = Invoke-Preflight @{
                Action = 'Inventory'
                BillingControlRecordFile = $recordPath
                Profile = 'kan229-test'
                ApplicationRegion = 'us-west-2'
                AllowAwsApiCalls = $true
            }
            Assert-Condition (-not $result.Succeeded) 'Inventory accepted a response with an unconsumed pagination token.'
            Assert-Condition (@(Get-AwsCalls).Count -eq 3) 'Pagination failure did not stop immediately after budget inventory.'
        }
        finally {
            $originalBudgetResponse | Set-Content -LiteralPath $budgetResponsePath -Encoding Ascii
        }
    }

    Invoke-FocusedTest 'tag matching is case-sensitive and allows extra stack tags' {
        Clear-AwsMarker
        $originalTags = Get-Content -Raw -LiteralPath $tagResponsePath
        $wrongCaseTags = $originalTags | ConvertFrom-Json
        $wrongCaseTags.ResourceTags[0].Key = 'Application'
        $wrongCaseTags | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $tagResponsePath -Encoding Ascii
        try {
            $result = Invoke-Preflight @{
                Action = 'Inventory'
                BillingControlRecordFile = $recordPath
                Profile = 'kan229-test'
                ApplicationRegion = 'us-west-2'
                AllowAwsApiCalls = $true
                Json = $true
            }
            Assert-Condition $result.Succeeded $result.Output
            $report = $result.Output | ConvertFrom-Json
            Assert-Condition ($report.candidateBudgetsWithRequiredTagKeys -eq 0) 'Wrong-case tag key matched the approved contract.'
            Assert-Condition ($report.candidateBudgetsMatchingApprovedTags -eq 0) 'Wrong-case tag values matched the approved contract.'
        }
        finally {
            $originalTags | Set-Content -LiteralPath $tagResponsePath -Encoding Ascii
        }
    }

    Invoke-FocusedTest 'application Region mismatch stops before AWS discovery' {
        Clear-AwsMarker
        $result = Invoke-Preflight @{
            Action = 'Inventory'
            BillingControlRecordFile = $recordPath
            Profile = 'kan229-test'
            ApplicationRegion = 'us-east-2'
            AllowAwsApiCalls = $true
        }
        Assert-Condition (-not $result.Succeeded) 'Inventory unexpectedly accepted a mismatched application Region.'
        Assert-Condition (@(Get-AwsCalls).Count -eq 0) 'Region mismatch invoked AWS.'
    }

    Invoke-FocusedTest 'account alias mismatch stops before budget inventory' {
        Clear-AwsMarker
        $record = Get-Content -Raw -LiteralPath $recordPath | ConvertFrom-Json
        $record.aws.accountAlias = 'different-account-alias'
        $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $recordPath -Encoding Ascii
        $result = Invoke-Preflight @{
            Action = 'Inventory'
            BillingControlRecordFile = $recordPath
            Profile = 'kan229-test'
            ApplicationRegion = 'us-west-2'
            AllowAwsApiCalls = $true
        }
        Assert-Condition (-not $result.Succeeded) 'Inventory unexpectedly accepted an account alias mismatch.'
        $calls = @(Get-AwsCalls)
        Assert-Condition ($calls.Count -eq 2) "Alias mismatch should stop after STS and IAM; received $($calls.Count) calls."
        Assert-Condition (-not (($calls -join "`n") -match '(?i)budgets')) 'Alias mismatch reached AWS Budgets.'
    }

    Write-Host "All $passed focused KAN-229 constrained preflight tests passed."
}
finally {
    $env:PATH = $originalPath
    foreach ($name in $environmentNames) {
        [System.Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name])
    }
    $expectedPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $resolvedTemporaryRoot = [System.IO.Path]::GetFullPath($temporaryRoot)
    if ($resolvedTemporaryRoot.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemporaryRoot)) {
        Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
    }
}
