[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$guardPath = Join-Path $PSScriptRoot 'invoke-account-guardrails.ps1'
$templatePath = Join-Path $PSScriptRoot 'account-guardrails.yaml'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("kan229-guard-test-" + [guid]::NewGuid().ToString('N'))
$fakeAwsDirectory = Join-Path $temporaryRoot 'fake-aws'
$markerPath = Join-Path $temporaryRoot 'aws-calls.log'
$responsePath = Join-Path $temporaryRoot 'describe-change-set.json'
$templateResponsePath = Join-Path $temporaryRoot 'get-template.json'
$billingControlRecordPath = Join-Path $temporaryRoot 'billing-control-record.json'
$immutableChangeSetId = 'arn:aws:cloudformation:us-east-1:111122223333:changeSet/kan229-guardrails-20260819/11111111-2222-3333-4444-555555555555'
$originalPath = $env:PATH
$originalMarker = $env:FAKE_AWS_MARKER
$originalAccount = $env:FAKE_AWS_ACCOUNT
$originalCallerArn = $env:FAKE_AWS_CALLER_ARN
$originalResponse = $env:FAKE_AWS_DESCRIBE_RESPONSE
$originalTemplateResponse = $env:FAKE_AWS_TEMPLATE_RESPONSE
$passed = 0

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

function Copy-ArgumentMap {
    param([System.Collections.IDictionary] $Map)

    $copy = @{}
    foreach ($entry in $Map.GetEnumerator()) {
        $copy[$entry.Key] = $entry.Value
    }
    return $copy
}

function Clear-AwsMarker {
    if (Test-Path -LiteralPath $markerPath) {
        Remove-Item -LiteralPath $markerPath -Force
    }
}

function Get-AwsMarkerText {
    if (-not (Test-Path -LiteralPath $markerPath)) {
        return ''
    }
    return Get-Content -LiteralPath $markerPath -Raw
}

function Invoke-Guard {
    param([System.Collections.IDictionary] $Arguments)

    $captured = @()
    try {
        $captured = @(& $guardPath @Arguments *>&1)
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
    $script:passed++
    Write-Host "PASS: $Name"
}

function Write-DescribeResponse {
    param(
        [System.Collections.IDictionary] $ParameterMap,
        [System.Collections.IDictionary] $TagMap,
        [string] $Description,
        [AllowEmptyCollection()]
        [object[]] $Changes = @(),
        [AllowEmptyCollection()]
        [string[]] $Capabilities = @(),
        [string] $Type = 'CREATE'
    )

    $response = [ordered]@{
        StackName = 'crypto-lending-account-guardrails-test'
        ChangeSetName = 'kan229-guardrails-20260819'
        ChangeSetId = $immutableChangeSetId
        ChangeSetType = $Type
        Status = 'CREATE_COMPLETE'
        ExecutionStatus = 'AVAILABLE'
        Description = $Description
        Parameters = @($ParameterMap.GetEnumerator() | ForEach-Object {
                [ordered]@{
                    ParameterKey = [string] $_.Key
                    ParameterValue = [string] $_.Value
                }
            })
        Tags = @($TagMap.GetEnumerator() | ForEach-Object {
                [ordered]@{
                    Key = [string] $_.Key
                    Value = [string] $_.Value
                }
            })
        Capabilities = @($Capabilities)
        Changes = @($Changes)
    }
    $response | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $responsePath -Encoding Ascii
}

function Write-TemplateResponse {
    param([string] $TemplateBody)

    [ordered]@{
        TemplateBody = $TemplateBody
        StagesAvailable = @('Original', 'Processed')
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $templateResponsePath -Encoding Ascii
}

if (-not (Test-Path -LiteralPath $guardPath -PathType Leaf)) {
    throw "Guard under test was not found: $guardPath"
}
if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
    throw "Template fixture was not found: $templatePath"
}

New-Item -ItemType Directory -Path $fakeAwsDirectory -Force | Out-Null
$isWindowsPlatform = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
if ($isWindowsPlatform) {
    $fakeAwsPath = Join-Path $fakeAwsDirectory 'aws.cmd'
    @'
@echo off
setlocal
>>"%FAKE_AWS_MARKER%" echo %*
if /I "%~1"=="sts" if /I "%~2"=="get-caller-identity" (
  echo {"UserId":"AROATEST:kan229-test","Account":"%FAKE_AWS_ACCOUNT%","Arn":"%FAKE_AWS_CALLER_ARN%"}
  exit /b 0
)
if /I "%~1"=="cloudformation" if /I "%~2"=="describe-change-set" (
  type "%FAKE_AWS_DESCRIBE_RESPONSE%"
  exit /b 0
)
if /I "%~1"=="cloudformation" if /I "%~2"=="get-template" (
  type "%FAKE_AWS_TEMPLATE_RESPONSE%"
  exit /b 0
)
echo {}
exit /b 0
'@ | Set-Content -LiteralPath $fakeAwsPath -Encoding Ascii
}
else {
    $fakeAwsPath = Join-Path $fakeAwsDirectory 'aws'
    @'
#!/usr/bin/env sh
printf '%s\n' "$*" >> "$FAKE_AWS_MARKER"
if [ "$1" = "sts" ] && [ "$2" = "get-caller-identity" ]; then
  printf '{"UserId":"AROATEST:kan229-test","Account":"%s","Arn":"%s"}\n' "$FAKE_AWS_ACCOUNT" "$FAKE_AWS_CALLER_ARN"
  exit 0
fi
if [ "$1" = "cloudformation" ] && [ "$2" = "describe-change-set" ]; then
  cat "$FAKE_AWS_DESCRIBE_RESPONSE"
  exit 0
fi
if [ "$1" = "cloudformation" ] && [ "$2" = "get-template" ]; then
  cat "$FAKE_AWS_TEMPLATE_RESPONSE"
  exit 0
fi
printf '{}\n'
exit 0
'@ | Set-Content -LiteralPath $fakeAwsPath -Encoding Ascii
    & chmod +x $fakeAwsPath
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to mark the fake AWS executable as executable.'
    }
}

$env:PATH = $fakeAwsDirectory + [System.IO.Path]::PathSeparator + $originalPath
$env:FAKE_AWS_MARKER = $markerPath
$env:FAKE_AWS_ACCOUNT = '111122223333'
$env:FAKE_AWS_CALLER_ARN = 'arn:aws:sts::111122223333:assumed-role/Kan229GuardrailRole/kan229-test'
$env:FAKE_AWS_DESCRIBE_RESPONSE = $responsePath
$env:FAKE_AWS_TEMPLATE_RESPONSE = $templateResponsePath

$baseArguments = @{
    Action = 'Plan'
    TemplateFile = $templatePath
    BillingControlRecordFile = $billingControlRecordPath
    Profile = 'kan229-test'
    AccountId = '111122223333'
    StackName = 'crypto-lending-account-guardrails-test'
    ChangeSetName = 'kan229-guardrails-20260819'
    ChangeSetType = 'CREATE'
    ApprovedAccountId = '111122223333'
    ApplicationRegion = 'us-west-2'
    ControlRegion = 'us-east-1'
    EnvironmentName = 'test-kan229'
    EnvironmentOwner = 'platform-founders'
    FinanceOwner = 'independent-finance-review'
    CostCenter = 'CRYPTO-PLATFORM'
    WarningEmail = 'aws-cost-warning@cryptolending.dev'
    CriticalEmail = 'aws-cost-critical@cryptolending.dev'
    MonthlyBudgetUsd = '100'
    WarningPercent = '60'
    CriticalPercent = '90'
    AnomalyMode = 'Disabled'
    ExistingAnomalyMonitorArn = ''
    AnomalyAbsoluteUsd = '20'
    AnomalyPercentage = '40'
    ApprovalRecordId = 'KAN-229:THIRD-PARTY-APPROVED'
    ControlsAcknowledgement = 'I_ACKNOWLEDGE_ACCOUNT_LEVEL_COST_CONTROLS'
    AllowAwsApiCalls = $true
}

$utcNow = [DateTime]::UtcNow
$billingControlRecord = [ordered]@{
    schemaVersion = 1
    status = 'APPROVED'
    recordId = $baseArguments.ApprovalRecordId
    approvedAt = $utcNow.AddDays(-1).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
    expiresAt = $utcNow.AddDays(30).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
    aws = [ordered]@{
        accountId = $baseArguments.AccountId
        accountAlias = 'crypto-lending-test'
        approvedRoleArn = 'arn:aws:iam::111122223333:role/Kan229GuardrailRole'
        applicationRegion = $baseArguments.ApplicationRegion
        controlRegion = $baseArguments.ControlRegion
    }
    environment = [ordered]@{
        name = $baseArguments.EnvironmentName
        application = 'crypto-lending'
        owner = $baseArguments.EnvironmentOwner
        financeOwner = $baseArguments.FinanceOwner
        costCenter = $baseArguments.CostCenter
        escalationRoute = 'finops-on-call'
    }
    budget = [ordered]@{
        currency = 'USD'
        expectedMonthlyBaselineUsd = '25'
        monthlyLimitUsd = $baseArguments.MonthlyBudgetUsd
        warningPercent = $baseArguments.WarningPercent
        criticalPercent = $baseArguments.CriticalPercent
        warningRecipient = 'aws-cost-warning'
        criticalRecipient = 'aws-cost-critical'
        exclusions = @('Credits and refunds do not offset the gross guardrail total')
        pricingAsOf = $utcNow.AddDays(-1).ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
        pricingExpiresAt = $utcNow.AddDays(30).ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
        mechanism = 'AWS_BUDGETS'
        anomalyMode = $baseArguments.AnomalyMode
        existingAnomalyMonitorArn = 'NOT_APPLICABLE'
        anomalyAbsoluteUsd = $baseArguments.AnomalyAbsoluteUsd
        anomalyPercentage = $baseArguments.AnomalyPercentage
        feeDecision = 'NO_ADDITIONAL_CHARGE_CONFIRMED'
    }
    authority = [ordered]@{
        planApprovers = @('founder-one', 'founder-two')
        deployApprovers = @('founder-one', 'founder-two')
        retentionApprovers = @('governance-retention-approver')
        deletionApprovers = @('governance-deletion-approver')
    }
    independentVerification = [ordered]@{
        verifier = 'independent-finops-reviewer'
        decision = 'APPROVED'
        verifiedAt = $utcNow.AddHours(-12).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
    }
    evidence = [ordered]@{
        accountRegionRole = 'PASS'
        warningDelivery = 'NOT_RUN'
        criticalDelivery = 'NOT_RUN'
        anomalyDelivery = 'NOT_APPLICABLE'
        retainedResourceReview = 'NOT_RUN'
    }
}
$billingControlRecord | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $billingControlRecordPath -Encoding Ascii
$nodeCommand = Get-Command node -ErrorAction Stop
$validatorPath = Join-Path $PSScriptRoot 'validate-billing-control-record.mjs'
$recordValidationOutput = & $nodeCommand.Source @(
    $validatorPath,
    '--record', $billingControlRecordPath,
    '--mode', 'bootstrap',
    '--expected-account', $baseArguments.AccountId,
    '--expected-application-region', $baseArguments.ApplicationRegion,
    '--expected-control-region', $baseArguments.ControlRegion,
    '--expected-environment', $baseArguments.EnvironmentName,
    '--json'
)
if ($LASTEXITCODE -ne 0) {
    throw "Focused test fixture failed bootstrap validation: $($recordValidationOutput | Out-String)"
}
$recordValidation = (($recordValidationOutput | Out-String) | ConvertFrom-Json)
$recordSha256 = [string] $recordValidation.canonicalSha256
$controlConfigurationSha256 = [string] $recordValidation.controlConfigurationSha256
$global:LASTEXITCODE = 0

$parameterMap = [ordered]@{
    ApprovedAccountId = $baseArguments.ApprovedAccountId
    ApplicationRegion = $baseArguments.ApplicationRegion
    ControlRegion = $baseArguments.ControlRegion
    EnvironmentName = $baseArguments.EnvironmentName
    EnvironmentOwner = $baseArguments.EnvironmentOwner
    FinanceOwner = $baseArguments.FinanceOwner
    CostCenter = $baseArguments.CostCenter
    WarningEmail = $baseArguments.WarningEmail
    CriticalEmail = $baseArguments.CriticalEmail
    MonthlyBudgetUsd = $baseArguments.MonthlyBudgetUsd
    WarningPercent = $baseArguments.WarningPercent
    CriticalPercent = $baseArguments.CriticalPercent
    AnomalyMode = $baseArguments.AnomalyMode
    ExistingAnomalyMonitorArn = $baseArguments.ExistingAnomalyMonitorArn
    AnomalyAbsoluteUsd = $baseArguments.AnomalyAbsoluteUsd
    AnomalyPercentage = $baseArguments.AnomalyPercentage
    ApprovalRecordId = $baseArguments.ApprovalRecordId
    ControlsAcknowledgement = $baseArguments.ControlsAcknowledgement
}
$tagMap = [ordered]@{
    application = 'crypto-lending'
    environment = $baseArguments.EnvironmentName
    'control-scope' = 'account-billing'
    owner = $baseArguments.EnvironmentOwner
    'finance-owner' = $baseArguments.FinanceOwner
    'cost-center' = $baseArguments.CostCenter
    'managed-by' = 'cloudformation'
    ticket = 'KAN-229'
    'approval-record' = $baseArguments.ApprovalRecordId
    'control-configuration-sha256' = $controlConfigurationSha256
}
$templateSha256 = (Get-FileHash -LiteralPath $templatePath -Algorithm SHA256).Hash.ToLowerInvariant()
$localTemplateBody = Get-Content -LiteralPath $templatePath -Raw
if ((Get-TextSha256 -Value $localTemplateBody) -cne $templateSha256) {
    throw 'Focused test requires a UTF-8 template whose text and file SHA-256 values are identical.'
}
$parameterSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $parameterMap)
$tagSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $tagMap)
$description = "KAN-229 template-sha256=$templateSha256 parameters-sha256=$parameterSha256 tags-sha256=$tagSha256 control-record-sha256=$recordSha256"
$deployAcknowledgement = "EXECUTE REVIEWED KAN-229 CHANGE SET $($baseArguments.ChangeSetName) FOR STACK $($baseArguments.StackName); TYPE $($baseArguments.ChangeSetType); TEMPLATE SHA256 $templateSha256; PARAMETERS SHA256 $parameterSha256; TAGS SHA256 $tagSha256; RECORD SHA256 $recordSha256; ACCOUNT $($baseArguments.AccountId); CONTROL REGION $($baseArguments.ControlRegion); PROFILE $($baseArguments.Profile)"
$replacementAcknowledgement = "AUTHORIZE REPLACEMENT OR REMOVAL OF RETAINED KAN-229 CONTROLS IN CHANGE SET $($baseArguments.ChangeSetName) FOR STACK $($baseArguments.StackName); TEMPLATE SHA256 $templateSha256; PARAMETERS SHA256 $parameterSha256; TAGS SHA256 $tagSha256; RECORD SHA256 $recordSha256; ACCOUNT $($baseArguments.AccountId); CONTROL REGION $($baseArguments.ControlRegion); PROFILE $($baseArguments.Profile)"

try {
    Invoke-FocusedTest -Name 'default LocalValidate makes zero AWS calls' -Body {
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments @{}
        Assert-Condition $result.Succeeded "LocalValidate failed: $($result.Output)"
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'LocalValidate invoked the fake AWS CLI.'
        Assert-Condition ($result.Output -match 'No AWS credentials were resolved') 'LocalValidate did not report its zero-call boundary.'
    }

    Invoke-FocusedTest -Name 'cloud actions require explicit opt-in' -Body {
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'CloudValidate'
        $arguments.Remove('AllowAwsApiCalls')
        $result = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $result.Succeeded) 'CloudValidate unexpectedly succeeded without AllowAwsApiCalls.'
        Assert-Condition ($result.Output -match 'AllowAwsApiCalls') 'Missing opt-in failure did not explain the required switch.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Missing opt-in reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'cloud actions require a bootstrap billing control record' -Body {
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Remove('BillingControlRecordFile')
        $result = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $result.Succeeded) 'Plan unexpectedly passed without BillingControlRecordFile.'
        Assert-Condition ($result.Output -match 'BillingControlRecordFile') 'Missing record failure did not name the required control record.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Missing control record reached AWS discovery.'
    }

    $invalidCases = @(
        @{ Name = 'placeholder owner'; Key = 'EnvironmentOwner'; Value = 'tbd' },
        @{ Name = 'placeholder cost center'; Key = 'CostCenter'; Value = 'NONE' },
        @{ Name = 'reserved recipient'; Key = 'WarningEmail'; Value = 'costs@example.com' },
        @{ Name = 'duplicate recipients'; Key = 'CriticalEmail'; Value = $baseArguments.WarningEmail },
        @{ Name = 'zero monthly threshold'; Key = 'MonthlyBudgetUsd'; Value = '0' },
        @{ Name = 'unsupported warning percentage'; Key = 'WarningPercent'; Value = '75' },
        @{ Name = 'out-of-range anomaly percentage'; Key = 'AnomalyPercentage'; Value = '100001' },
        @{ Name = 'placeholder approval record'; Key = 'ApprovalRecordId'; Value = 'KAN-229:TBD' },
        @{ Name = 'owner not approved by control record'; Key = 'EnvironmentOwner'; Value = 'other-platform-owner' }
    )
    foreach ($invalidCase in $invalidCases) {
        Invoke-FocusedTest -Name "preflight rejects $($invalidCase.Name) before AWS discovery" -Body {
            Clear-AwsMarker
            $arguments = Copy-ArgumentMap -Map $baseArguments
            $arguments[$invalidCase.Key] = $invalidCase.Value
            $result = Invoke-Guard -Arguments $arguments
            Assert-Condition (-not $result.Succeeded) "Invalid $($invalidCase.Key) unexpectedly passed."
            Assert-Condition ((Get-AwsMarkerText) -eq '') "Invalid $($invalidCase.Key) reached AWS discovery."
        }
    }

    Invoke-FocusedTest -Name 'preflight rejects an alternate local template before AWS discovery' -Body {
        Clear-AwsMarker
        $alternateTemplatePath = Join-Path $temporaryRoot 'alternate-account-guardrails.yaml'
        [System.IO.File]::WriteAllText(
            $alternateTemplatePath,
            ($localTemplateBody + "`n# unreviewed local mutation"),
            [System.Text.UTF8Encoding]::new($false)
        )
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.TemplateFile = $alternateTemplatePath
        $result = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $result.Succeeded) 'Plan unexpectedly accepted an alternate local template.'
        Assert-Condition ($result.Output -match 'byte-for-byte') 'Alternate-template rejection did not explain the reviewed-template identity requirement.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Alternate local template reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'CloudValidate calls only STS and validate-template' -Body {
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'CloudValidate'
        $result = Invoke-Guard -Arguments $arguments
        $marker = Get-AwsMarkerText
        Assert-Condition $result.Succeeded "CloudValidate failed: $($result.Output)"
        Assert-Condition ($marker -match 'sts get-caller-identity') 'CloudValidate did not verify caller identity.'
        Assert-Condition ($marker -match 'cloudformation validate-template') 'CloudValidate did not call validate-template.'
        Assert-Condition ($marker -notmatch 'create-change-set|execute-change-set') 'CloudValidate attempted a mutating stack action.'
    }

    Invoke-FocusedTest -Name 'Plan creates and inspects but never executes a change set' -Body {
        Clear-AwsMarker
        Write-DescribeResponse -ParameterMap $parameterMap -TagMap $tagMap -Description $description
        $result = Invoke-Guard -Arguments $baseArguments
        $marker = Get-AwsMarkerText
        Assert-Condition $result.Succeeded "Plan failed: $($result.Output)"
        Assert-Condition ($marker -match 'cloudformation create-change-set') 'Plan did not create a change set.'
        Assert-Condition ($marker -match 'cloudformation wait change-set-create-complete') 'Plan did not wait for a reviewable change set.'
        Assert-Condition ($marker -match 'cloudformation describe-change-set') 'Plan did not inspect retained-control changes.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'Plan executed the change set.'
        Assert-Condition ($marker -match [regex]::Escape($templateSha256)) 'Plan command was not bound to the template digest.'
        Assert-Condition ($marker -match [regex]::Escape($parameterSha256)) 'Plan command was not bound to the parameter digest.'
        Assert-Condition ($marker -match [regex]::Escape($tagSha256)) 'Plan command was not bound to the tag digest.'
        Assert-Condition ($marker -match [regex]::Escape($recordSha256)) 'Plan command was not bound to the canonical control-record digest.'
    }

    Invoke-FocusedTest -Name 'Deploy acknowledgement is generated before AWS discovery' -Body {
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'Deploy'
        $result = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $result.Succeeded) 'Deploy unexpectedly passed without its typed acknowledgement.'
        Assert-Condition ($result.Output.Contains($deployAcknowledgement)) 'Deploy did not emit the exact digest-bound acknowledgement.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Deploy without acknowledgement reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'Deploy rejects a non-exact reviewed tag set' -Body {
        Clear-AwsMarker
        $wrongTags = [ordered]@{}
        foreach ($entry in $tagMap.GetEnumerator()) {
            $wrongTags[$entry.Key] = $entry.Value
        }
        $wrongTags['cost-center'] = 'OTHER-COST-CENTER'
        Write-DescribeResponse -ParameterMap $parameterMap -TagMap $wrongTags -Description $description
        Write-TemplateResponse -TemplateBody $localTemplateBody
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'Deploy'
        $arguments.BillableAcknowledgement = $deployAcknowledgement
        $result = Invoke-Guard -Arguments $arguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted a changed cost-center tag.'
        Assert-Condition ($result.Output -match 'tag value') 'Deploy did not identify the tag mismatch.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'Deploy executed a change set with mismatched tags.'
    }

    Invoke-FocusedTest -Name 'Deploy rejects a change set whose original template differs' -Body {
        Clear-AwsMarker
        Write-DescribeResponse -ParameterMap $parameterMap -TagMap $tagMap -Description $description
        Write-TemplateResponse -TemplateBody ($localTemplateBody + "`n# unreviewed template mutation")
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'Deploy'
        $arguments.BillableAcknowledgement = $deployAcknowledgement
        $result = Invoke-Guard -Arguments $arguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted a change set with a mismatched original template.'
        Assert-Condition ($result.Output -match 'original template SHA-256') 'Deploy did not identify the submitted-template digest mismatch.'
        Assert-Condition ($marker -match 'cloudformation get-template') 'Deploy did not retrieve the submitted change-set template.'
        Assert-Condition ($marker -match [regex]::Escape($immutableChangeSetId)) 'get-template was not bound to the immutable change-set ARN.'
        Assert-Condition ($marker -match '--template-stage Original') 'get-template did not request the Original template stage.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'Deploy executed after a submitted-template digest mismatch.'
    }

    Invoke-FocusedTest -Name 'Deploy executes only the exact reviewed set' -Body {
        Clear-AwsMarker
        Write-DescribeResponse -ParameterMap $parameterMap -TagMap $tagMap -Description $description
        Write-TemplateResponse -TemplateBody $localTemplateBody
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'Deploy'
        $arguments.BillableAcknowledgement = $deployAcknowledgement
        $result = Invoke-Guard -Arguments $arguments
        $marker = Get-AwsMarkerText
        Assert-Condition $result.Succeeded "Exact Deploy failed: $($result.Output)"
        Assert-Condition ($marker -match 'sts get-caller-identity') 'Deploy did not verify caller identity.'
        Assert-Condition ($marker -match 'cloudformation describe-change-set') 'Deploy did not verify the reviewed set.'
        Assert-Condition ($marker -match 'cloudformation get-template') 'Deploy did not verify the original submitted template.'
        Assert-Condition ($marker -match [regex]::Escape($immutableChangeSetId)) 'Deploy did not use the immutable change-set ARN.'
        Assert-Condition ($marker -match 'cloudformation execute-change-set') 'Deploy did not execute the verified set.'
        Assert-Condition (@($marker -split "`r?`n" | Where-Object { $_ -match 'execute-change-set' }).Count -eq 1) 'Deploy invoked execute-change-set more than once.'
    }

    $replacementChanges = @(
        [ordered]@{
            Type = 'Resource'
            ResourceChange = [ordered]@{
                Action = 'Modify'
                LogicalResourceId = 'MonthlyCostBudget'
                ResourceType = 'AWS::Budgets::Budget'
                Replacement = 'True'
                Scope = @('Properties')
                Details = @()
            }
        }
    )
    Invoke-FocusedTest -Name 'Plan flags replacement of a retained control separately' -Body {
        Clear-AwsMarker
        Write-DescribeResponse -ParameterMap $parameterMap -TagMap $tagMap -Description $description -Changes $replacementChanges
        $result = Invoke-Guard -Arguments $baseArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Replacement Plan passed without the separate acknowledgement.'
        Assert-Condition ($result.Output.Contains($replacementAcknowledgement)) 'Replacement Plan did not emit its exact separate acknowledgement.'
        Assert-Condition ($marker -match 'create-change-set') 'Replacement Plan did not leave a reviewable change set.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'Replacement Plan executed a change set.'
    }

    Invoke-FocusedTest -Name 'Deploy blocks retained-control replacement without second acknowledgement' -Body {
        Clear-AwsMarker
        Write-DescribeResponse -ParameterMap $parameterMap -TagMap $tagMap -Description $description -Changes $replacementChanges
        Write-TemplateResponse -TemplateBody $localTemplateBody
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'Deploy'
        $arguments.BillableAcknowledgement = $deployAcknowledgement
        $result = Invoke-Guard -Arguments $arguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Replacement Deploy passed without the second acknowledgement.'
        Assert-Condition ($result.Output.Contains($replacementAcknowledgement)) 'Replacement Deploy did not request the exact second acknowledgement.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'Replacement Deploy executed without the second acknowledgement.'
    }

    Invoke-FocusedTest -Name 'both exact acknowledgements permit reviewed retained-control replacement' -Body {
        Clear-AwsMarker
        Write-DescribeResponse -ParameterMap $parameterMap -TagMap $tagMap -Description $description -Changes $replacementChanges
        Write-TemplateResponse -TemplateBody $localTemplateBody
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'Deploy'
        $arguments.BillableAcknowledgement = $deployAcknowledgement
        $arguments.ControlReplacementAcknowledgement = $replacementAcknowledgement
        $result = Invoke-Guard -Arguments $arguments
        $marker = Get-AwsMarkerText
        Assert-Condition $result.Succeeded "Acknowledged replacement Deploy failed: $($result.Output)"
        Assert-Condition ($marker -match 'execute-change-set') 'Acknowledged replacement Deploy did not execute.'
    }

    Write-Host "All $passed focused KAN-229 invocation-guard tests passed."
}
finally {
    $env:PATH = $originalPath
    $env:FAKE_AWS_MARKER = $originalMarker
    $env:FAKE_AWS_ACCOUNT = $originalAccount
    $env:FAKE_AWS_CALLER_ARN = $originalCallerArn
    $env:FAKE_AWS_DESCRIBE_RESPONSE = $originalResponse
    $env:FAKE_AWS_TEMPLATE_RESPONSE = $originalTemplateResponse

    $resolvedTemporaryRoot = [System.IO.Path]::GetFullPath($temporaryRoot)
    $resolvedSystemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $safePrefix = $resolvedSystemTemp.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (
        $resolvedTemporaryRoot.StartsWith($safePrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
        ([System.IO.Path]::GetFileName($resolvedTemporaryRoot) -like 'kan229-guard-test-*') -and
        (Test-Path -LiteralPath $resolvedTemporaryRoot -PathType Container)
    ) {
        Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
    }
}
