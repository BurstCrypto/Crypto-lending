[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$guardPath = Join-Path $PSScriptRoot 'invoke-application-baseline.ps1'
$applicationTemplatePath = Join-Path $PSScriptRoot 'application-baseline.yaml'
$guardrailTemplatePath = Join-Path $PSScriptRoot 'account-guardrails.yaml'
$recordValidatorPath = Join-Path $PSScriptRoot 'validate-billing-control-record.mjs'
$acmDnsRecordValidatorPath = Join-Path $PSScriptRoot 'validate-acm-dns-control-record.mjs'
$releaseRecordValidatorPath = Join-Path $PSScriptRoot 'validate-release-deployment-control-record.mjs'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("kan34-application-guard-test-" + [guid]::NewGuid().ToString('N'))
$fakeAwsDirectory = Join-Path $temporaryRoot 'fake-aws'
$markerPath = Join-Path $temporaryRoot 'aws-calls.log'
$identityResponsePath = Join-Path $temporaryRoot 'identity.json'
$guardrailStackResponsePath = Join-Path $temporaryRoot 'guardrail-stack.json'
$guardrailTemplateResponsePath = Join-Path $temporaryRoot 'guardrail-template.json'
$changeSetResponsePath = Join-Path $temporaryRoot 'change-set.json'
$applicationTemplateResponsePath = Join-Path $temporaryRoot 'application-template.json'
$applicationStackResponsePath = Join-Path $temporaryRoot 'application-stack.json'
$approvedRecordPath = Join-Path $temporaryRoot 'approved-billing-control-record.json'
$incompleteRecordPath = Join-Path $temporaryRoot 'incomplete-billing-control-record.json'
$approvedAcmDnsRecordPath = Join-Path $temporaryRoot 'approved-acm-dns-bootstrap-record.json'
$mismatchedAcmDnsRecordPath = Join-Path $temporaryRoot 'mismatched-acm-dns-bootstrap-record.json'
$incompleteAcmDnsRecordPath = Join-Path $temporaryRoot 'incomplete-acm-dns-bootstrap-record.json'
$approvedReleaseRecordPath = Join-Path $temporaryRoot 'approved-release-control-record.json'
$incompleteReleaseRecordPath = Join-Path $temporaryRoot 'incomplete-release-control-record.json'
$rollbackReleaseRecordPath = Join-Path $temporaryRoot 'rollback-release-control-record.json'
$tamperedPriorReleaseRecordPath = Join-Path $temporaryRoot 'tampered-prior-release-control-record.json'
$immutableChangeSetId = 'arn:aws:cloudformation:us-west-2:111122223333:changeSet/kan34-application-20260819/11111111-2222-3333-4444-555555555555'
$originalEnvironment = @{
    PATH = $env:PATH
    FAKE_AWS_MARKER = $env:FAKE_AWS_MARKER
    FAKE_AWS_IDENTITY_RESPONSE = $env:FAKE_AWS_IDENTITY_RESPONSE
    FAKE_AWS_GUARDRAIL_STACK_RESPONSE = $env:FAKE_AWS_GUARDRAIL_STACK_RESPONSE
    FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE = $env:FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE
    FAKE_AWS_CHANGE_SET_RESPONSE = $env:FAKE_AWS_CHANGE_SET_RESPONSE
    FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE = $env:FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE
    FAKE_AWS_APPLICATION_STACK_RESPONSE = $env:FAKE_AWS_APPLICATION_STACK_RESPONSE
}
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

function Write-JsonFile {
    param(
        [string] $Path,
        [object] $Value,
        [int] $Depth = 12
    )

    $Value | ConvertTo-Json -Depth $Depth | Set-Content -LiteralPath $Path -Encoding Ascii
}

function Write-TemplateResponse {
    param(
        [string] $Path,
        [string] $TemplateBody
    )

    Write-JsonFile -Path $Path -Value ([ordered]@{
            TemplateBody = $TemplateBody
            StagesAvailable = @('Original', 'Processed')
        }) -Depth 4
}

function Write-GuardrailStackResponse {
    param([string] $ConfigurationSha256)

    $tags = @($guardrailStackTags.GetEnumerator() | ForEach-Object {
            $value = if ($_.Key -eq 'control-configuration-sha256') {
                $ConfigurationSha256
            }
            else {
                [string] $_.Value
            }
            [ordered]@{ Key = [string] $_.Key; Value = $value }
        })
    $outputs = @($guardrailOutputs.GetEnumerator() | ForEach-Object {
            [ordered]@{ OutputKey = [string] $_.Key; OutputValue = [string] $_.Value }
        })
    $parameters = @($guardrailParameterMap.GetEnumerator() | ForEach-Object {
            [ordered]@{ ParameterKey = [string] $_.Key; ParameterValue = [string] $_.Value }
        })
    Write-JsonFile -Path $guardrailStackResponsePath -Value ([ordered]@{
            Stacks = @(
                [ordered]@{
                    StackName = 'crypto-lending-account-guardrails-test'
                    StackStatus = 'UPDATE_COMPLETE'
                    Tags = $tags
                    Parameters = $parameters
                    Outputs = $outputs
                }
            )
        })
}

function Write-ApplicationStackResponse {
    param(
        [string] $ApplicationVersion,
        [string] $StackStatus = 'UPDATE_COMPLETE',
        [AllowNull()]
        [string] $RoleArn = $null
    )

    $parameterValues = Copy-ArgumentMap -Map $applicationParameterMap
    $parameterValues.ApplicationVersion = $ApplicationVersion
    $parameters = @($parameterValues.GetEnumerator() | ForEach-Object {
            [ordered]@{ ParameterKey = [string] $_.Key; ParameterValue = [string] $_.Value }
        })
    $stack = [ordered]@{
        StackName = 'crypto-lending-application-test'
        StackStatus = $StackStatus
        Parameters = $parameters
    }
    if ($null -ne $RoleArn) {
        $stack.RoleARN = $RoleArn
    }
    Write-JsonFile -Path $applicationStackResponsePath -Value ([ordered]@{
            Stacks = @(
                $stack
            )
        }) -Depth 8
}

function Write-ChangeSetResponse {
    param(
        [System.Collections.IDictionary] $ParameterValues = $script:applicationParameterMap,
        [System.Collections.IDictionary] $TagValues = $script:applicationStackTags,
        [string] $DescriptionValue = $script:expectedChangeSetDescription,
        [string] $TypeValue = 'CREATE',
        [System.Collections.IDictionary] $ExecutionContextOverrides = @{},
        [switch] $OmitOnStackFailure
    )

    $parameters = @($ParameterValues.GetEnumerator() | ForEach-Object {
            [ordered]@{
                ParameterKey = [string] $_.Key
                ParameterValue = [string] $_.Value
                UsePreviousValue = $false
            }
        })
    $tags = @($TagValues.GetEnumerator() | ForEach-Object {
            [ordered]@{ Key = [string] $_.Key; Value = [string] $_.Value }
        })
    $response = [ordered]@{
        StackName = 'crypto-lending-application-test'
        ChangeSetName = 'kan34-application-20260819'
        ChangeSetId = $immutableChangeSetId
        ChangeSetType = $TypeValue
        Status = 'CREATE_COMPLETE'
        ExecutionStatus = 'AVAILABLE'
        Description = $DescriptionValue
        Parameters = $parameters
        Tags = $tags
        Capabilities = @('CAPABILITY_IAM')
        NotificationARNs = @()
        RollbackConfiguration = [ordered]@{
            RollbackTriggers = @()
            MonitoringTimeInMinutes = 0
        }
        ResourceTypes = @()
        IncludeNestedStacks = $false
        ParentChangeSetId = $null
        RootChangeSetId = $null
        OnStackFailure = if ($TypeValue -eq 'CREATE') { 'ROLLBACK' } else { $null }
        ImportExistingResources = $false
        DeploymentMode = $null
        DeploymentConfig = $null
        Changes = @()
    }
    foreach ($override in $ExecutionContextOverrides.GetEnumerator()) {
        $response[$override.Key] = $override.Value
    }
    if ($OmitOnStackFailure.IsPresent) {
        $response.Remove('OnStackFailure')
    }
    Write-JsonFile -Path $changeSetResponsePath -Value $response
}

if (-not (Test-Path -LiteralPath $guardPath -PathType Leaf)) {
    throw "Application guard under test was not found: $guardPath"
}
foreach ($requiredFile in @($applicationTemplatePath, $guardrailTemplatePath, $recordValidatorPath, $acmDnsRecordValidatorPath, $releaseRecordValidatorPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required focused-test input was not found: $requiredFile"
    }
}

New-Item -ItemType Directory -Path $fakeAwsDirectory -Force | Out-Null
$fakeAwsScriptPath = Join-Path $fakeAwsDirectory 'fake-aws.ps1'
@'
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $AwsArguments
)

$ErrorActionPreference = 'Stop'
Add-Content -LiteralPath $env:FAKE_AWS_MARKER -Value ($AwsArguments -join ' ') -Encoding Ascii

function Write-ResponseFile {
    param([string] $Path)
    [Console]::Out.Write([System.IO.File]::ReadAllText($Path))
    exit 0
}

if ($AwsArguments.Count -lt 2) {
    exit 98
}
$service = $AwsArguments[0]
$operation = $AwsArguments[1]
if ($service -eq 'sts' -and $operation -eq 'get-caller-identity') {
    Write-ResponseFile -Path $env:FAKE_AWS_IDENTITY_RESPONSE
}
if ($service -eq 'cloudformation' -and $operation -eq 'describe-stacks') {
    $stackNameIndex = [Array]::IndexOf($AwsArguments, '--stack-name')
    if (
        $stackNameIndex -ge 0 -and
        $stackNameIndex + 1 -lt $AwsArguments.Count -and
        $AwsArguments[$stackNameIndex + 1] -eq 'crypto-lending-application-test'
    ) {
        Write-ResponseFile -Path $env:FAKE_AWS_APPLICATION_STACK_RESPONSE
    }
    Write-ResponseFile -Path $env:FAKE_AWS_GUARDRAIL_STACK_RESPONSE
}
if ($service -eq 'cloudformation' -and $operation -eq 'get-template') {
    if ($AwsArguments -contains '--change-set-name') {
        Write-ResponseFile -Path $env:FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE
    }
    Write-ResponseFile -Path $env:FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE
}
if ($service -eq 'cloudformation' -and $operation -eq 'describe-change-set') {
    Write-ResponseFile -Path $env:FAKE_AWS_CHANGE_SET_RESPONSE
}
if ($service -eq 'cloudformation' -and $operation -eq 'execute-change-set') {
    [Console]::Out.Write('{}')
    exit 0
}
if ($service -eq 'cloudformation' -and $operation -eq 'create-change-set') {
    [Console]::Out.Write('{}')
    exit 0
}
exit 99
'@ | Set-Content -LiteralPath $fakeAwsScriptPath -Encoding Ascii
$isWindowsPlatform = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
if ($isWindowsPlatform) {
    $fakeAwsCommandPath = Join-Path $fakeAwsDirectory 'aws.cmd'
    @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fake-aws.ps1" %*
exit /b %ERRORLEVEL%
'@ | Set-Content -LiteralPath $fakeAwsCommandPath -Encoding Ascii
}
else {
    $fakeAwsCommandPath = Join-Path $fakeAwsDirectory 'aws'
    @'
#!/usr/bin/env sh
script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec pwsh -NoProfile -File "$script_directory/fake-aws.ps1" "$@"
'@ | Set-Content -LiteralPath $fakeAwsCommandPath -Encoding Ascii
    & chmod +x $fakeAwsCommandPath
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to mark the fake AWS executable as executable.'
    }
}

$env:PATH = $fakeAwsDirectory + [System.IO.Path]::PathSeparator + $originalEnvironment.PATH
$env:FAKE_AWS_MARKER = $markerPath
$env:FAKE_AWS_IDENTITY_RESPONSE = $identityResponsePath
$env:FAKE_AWS_GUARDRAIL_STACK_RESPONSE = $guardrailStackResponsePath
$env:FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE = $guardrailTemplateResponsePath
$env:FAKE_AWS_CHANGE_SET_RESPONSE = $changeSetResponsePath
$env:FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE = $applicationTemplateResponsePath
$env:FAKE_AWS_APPLICATION_STACK_RESPONSE = $applicationStackResponsePath

Write-JsonFile -Path $identityResponsePath -Value ([ordered]@{
        UserId = 'AROATEST:kan34-test'
        Account = '111122223333'
        Arn = 'arn:aws:sts::111122223333:assumed-role/Kan34ApplicationDeployRole/kan34-test'
    }) -Depth 3

$utcNow = [DateTime]::UtcNow
$approvedRecord = [ordered]@{
    schemaVersion = 1
    status = 'APPROVED'
    recordId = 'KAN-229:THIRD-PARTY-FINAL-APPROVAL'
    approvedAt = $utcNow.AddDays(-1).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
    expiresAt = $utcNow.AddDays(30).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
    aws = [ordered]@{
        accountId = '111122223333'
        accountAlias = 'crypto-lending-test'
        approvedRoleArn = 'arn:aws:iam::111122223333:role/Kan34ApplicationDeployRole'
        applicationRegion = 'us-west-2'
        controlRegion = 'us-east-1'
    }
    environment = [ordered]@{
        name = 'test-kan34'
        application = 'crypto-lending'
        owner = 'platform-founders'
        financeOwner = 'finance-controls'
        costCenter = 'CRYPTO-PLATFORM'
        escalationRoute = 'finops-on-call'
    }
    budget = [ordered]@{
        currency = 'USD'
        expectedMonthlyBaselineUsd = '25'
        monthlyLimitUsd = '100'
        warningPercent = '60'
        criticalPercent = '90'
        warningRecipient = 'aws-cost-warning'
        criticalRecipient = 'aws-cost-critical'
        exclusions = @('Credits and refunds do not offset the gross account guardrail')
        pricingAsOf = $utcNow.AddDays(-1).ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
        pricingExpiresAt = $utcNow.AddDays(30).ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
        mechanism = 'AWS_BUDGETS'
        anomalyMode = 'Disabled'
        existingAnomalyMonitorArn = 'NOT_APPLICABLE'
        anomalyAbsoluteUsd = '20'
        anomalyPercentage = '40'
        feeDecision = 'NO_ADDITIONAL_CHARGE_CONFIRMED'
    }
    authority = [ordered]@{
        planApprovers = @('founder-one', 'founder-two')
        deployApprovers = @('founder-one', 'founder-two')
        retentionApprovers = @('governance-retention-approver')
        deletionApprovers = @('governance-deletion-approver')
    }
    independentVerification = [ordered]@{
        verifier = 'independent-third-party-verifier'
        decision = 'APPROVED'
        verifiedAt = $utcNow.AddHours(-12).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
    }
    evidence = [ordered]@{
        accountRegionRole = 'PASS'
        warningDelivery = 'PASS'
        criticalDelivery = 'PASS'
        anomalyDelivery = 'NOT_APPLICABLE'
        retainedResourceReview = 'PASS'
    }
}
Write-JsonFile -Path $approvedRecordPath -Value $approvedRecord
$incompleteRecord = ($approvedRecord | ConvertTo-Json -Depth 12) | ConvertFrom-Json
$incompleteRecord.evidence.criticalDelivery = 'NOT_RUN'
Write-JsonFile -Path $incompleteRecordPath -Value $incompleteRecord

$approvedAcmDnsRecord = [ordered]@{
    schemaVersion = 1
    status = 'APPROVED'
    recordId = 'KAN-230:ACM-DNS-BOOTSTRAP-APPROVAL'
    approvedAt = $utcNow.AddMinutes(-30).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
    expiresAt = $utcNow.AddDays(30).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
    aws = [ordered]@{
        accountId = '111122223333'
        region = 'us-west-2'
        approvedRoleArn = 'arn:aws:iam::111122223333:role/Kan34ApplicationDeployRole'
    }
    hostname = [ordered]@{
        applicationHostname = 'test.crypto-lending.invalid'
        parentDomain = 'crypto-lending.invalid'
        dnsProvider = 'provider:existing-authoritative-dns'
        dnsZoneMode = 'EXISTING_EXTERNAL'
        existingZoneReference = 'dns-zone:crypto-lending-invalid-existing'
        ownershipReference = 'evidence:KAN-230/hostname-ownership'
    }
    certificate = [ordered]@{
        mode = 'ACM_INTEGRATED_NON_EXPORTABLE'
        validationMethod = 'DNS'
        certificateArn = 'arn:aws:acm:us-west-2:111122223333:certificate/11111111-2222-3333-4444-555555555555'
        subjectAlternativeNames = @('test.crypto-lending.invalid')
        certificateStatus = 'ISSUED'
        notAfterUtc = $utcNow.AddDays(365).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
        sha256Fingerprint = ('e' * 64)
        renewalOwner = 'platform-operations'
        renewalMethod = 'AWS_MANAGED'
        renewalWindowDays = '45'
    }
    dnsChange = [ordered]@{
        recordType = 'CNAME'
        ttlSeconds = '300'
        applicationLoadBalancerArn = 'NOT_RUN'
        targetLoadBalancerDnsName = 'NOT_RUN'
        targetLoadBalancerCanonicalHostedZoneId = 'NOT_RUN'
        previousRecordValue = 'NOT_RUN'
        previousTtlSeconds = 'NOT_RUN'
        rollbackDeadlineUtc = 'NOT_RUN'
    }
    costBoundary = [ordered]@{
        decision = 'NO_ADDITIONAL_CHARGE_CONFIRMED'
        domainRegistration = 'NOT_AUTHORIZED'
        hostedZoneCreation = 'NOT_AUTHORIZED'
        exportableCertificate = 'NOT_AUTHORIZED'
        privateCertificateAuthority = 'NOT_AUTHORIZED'
        paidMonitoring = 'NOT_AUTHORIZED'
        estimatedMonthlyIncrementUsd = '0.00'
        pricingAsOf = $utcNow.ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
        pricingExpiresAt = $utcNow.AddDays(30).ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
        pricingSourceReference = 'aws-pricing:acm-integrated-and-existing-dns'
    }
    authority = [ordered]@{
        certificateRequestApprovers = @('release-approver')
        dnsChangeApprovers = @('dns-change-approver')
        cutoverApprovers = @('release-approver', 'dns-change-approver')
        rollbackApprovers = @('incident-commander')
    }
    independentVerification = [ordered]@{
        verifier = 'external-security-reviewer'
        decision = 'APPROVED'
        verifiedAt = $utcNow.AddMinutes(-10).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
    }
    evidence = [ordered]@{
        hostnameOwnership = 'PASS'
        certificateIssued = 'PASS'
        dnsValidation = 'PASS'
        dnsCutover = 'NOT_RUN'
        tlsChainAndHostname = 'NOT_RUN'
        httpRedirect = 'NOT_RUN'
        unexpectedHostRejected = 'NOT_RUN'
        expirationMonitoring = 'NOT_RUN'
        rollbackDrill = 'NOT_RUN'
        observedAtUtc = $utcNow.AddHours(-1).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
        evidenceIndexReference = 'evidence:KAN-230/bootstrap-v1'
    }
}
Write-JsonFile -Path $approvedAcmDnsRecordPath -Value $approvedAcmDnsRecord
$mismatchedAcmDnsRecord = ($approvedAcmDnsRecord | ConvertTo-Json -Depth 12) | ConvertFrom-Json
$mismatchedAcmDnsRecord.aws.accountId = '999999999999'
Write-JsonFile -Path $mismatchedAcmDnsRecordPath -Value $mismatchedAcmDnsRecord
$incompleteAcmDnsRecord = ($approvedAcmDnsRecord | ConvertTo-Json -Depth 12) | ConvertFrom-Json
$incompleteAcmDnsRecord.evidence.dnsValidation = 'NOT_RUN'
Write-JsonFile -Path $incompleteAcmDnsRecordPath -Value $incompleteAcmDnsRecord

$nodeCommand = Get-Command node -ErrorAction Stop
$recordValidationOutput = & $nodeCommand.Source @(
    $recordValidatorPath,
    '--record', $approvedRecordPath,
    '--mode', 'approved',
    '--expected-account', '111122223333',
    '--expected-application-region', 'us-west-2',
    '--expected-control-region', 'us-east-1',
    '--expected-environment', 'test-kan34',
    '--json'
)
if ($LASTEXITCODE -ne 0) {
    throw "Focused final-record fixture failed approved validation: $($recordValidationOutput | Out-String)"
}
$recordValidation = ($recordValidationOutput | Out-String) | ConvertFrom-Json
$controlRecordSha256 = [string] $recordValidation.canonicalSha256
$controlConfigurationSha256 = [string] $recordValidation.controlConfigurationSha256
if ($controlRecordSha256 -notmatch '^[a-f0-9]{64}$' -or $controlConfigurationSha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Focused final-record fixture did not produce both required canonical hashes.'
}
$global:LASTEXITCODE = 0

$acmDnsRecordValidationOutput = & $nodeCommand.Source @(
    $acmDnsRecordValidatorPath,
    '--record', $approvedAcmDnsRecordPath,
    '--mode', 'bootstrap',
    '--expected-account', '111122223333',
    '--expected-region', 'us-west-2',
    '--json'
)
if ($LASTEXITCODE -ne 0) {
    throw "Focused KAN-230 fixture failed bootstrap validation: $($acmDnsRecordValidationOutput | Out-String)"
}
$acmDnsRecordValidation = ($acmDnsRecordValidationOutput | Out-String) | ConvertFrom-Json
$acmDnsRecordSha256 = [string] $acmDnsRecordValidation.canonicalSha256
$acmDnsConfigurationSha256 = [string] $acmDnsRecordValidation.configurationSha256
if (
    -not $acmDnsRecordValidation.ok -or
    $acmDnsRecordValidation.awsCallsMade -ne 0 -or
    $acmDnsRecordValidation.dnsQueriesMade -ne 0 -or
    $acmDnsRecordValidation.providerCallsMade -ne 0 -or
    $acmDnsRecordSha256 -notmatch '^[a-f0-9]{64}$' -or
    $acmDnsConfigurationSha256 -notmatch '^[a-f0-9]{64}$'
) {
    throw 'Focused KAN-230 fixture did not produce a successful zero-external-call result with both required hashes.'
}
$global:LASTEXITCODE = 0

$applicationTemplateBody = Get-Content -LiteralPath $applicationTemplatePath -Raw
$guardrailTemplateBody = Get-Content -LiteralPath $guardrailTemplatePath -Raw
$applicationTemplateSha256 = (Get-FileHash -LiteralPath $applicationTemplatePath -Algorithm SHA256).Hash.ToLowerInvariant()
$guardrailTemplateSha256 = (Get-FileHash -LiteralPath $guardrailTemplatePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ((Get-TextSha256 -Value $applicationTemplateBody) -cne $applicationTemplateSha256) {
    throw 'Focused test requires application template text and file SHA-256 values to be identical.'
}
if ((Get-TextSha256 -Value $guardrailTemplateBody) -cne $guardrailTemplateSha256) {
    throw 'Focused test requires guardrail template text and file SHA-256 values to be identical.'
}

$guardrailStackTags = [ordered]@{
    application = 'crypto-lending'
    environment = 'test-kan34'
    'control-scope' = 'account-billing'
    owner = 'platform-founders'
    'finance-owner' = 'finance-controls'
    'cost-center' = 'CRYPTO-PLATFORM'
    'managed-by' = 'cloudformation'
    ticket = 'KAN-229'
    'approval-record' = 'KAN-229:THIRD-PARTY-FINAL-APPROVAL'
    'control-configuration-sha256' = $controlConfigurationSha256
}
$guardrailOutputs = [ordered]@{
    PolicyVersion = 'kan-229-v1'
    ApprovedAccountId = '111122223333'
    ApplicationRegion = 'us-west-2'
    ControlRegion = 'us-east-1'
    EnvironmentName = 'test-kan34'
    EnvironmentOwner = 'platform-founders'
    FinanceOwner = 'finance-controls'
    CostCenter = 'CRYPTO-PLATFORM'
    ApprovalRecordId = 'KAN-229:THIRD-PARTY-FINAL-APPROVAL'
    MonthlyBudgetName = 'crypto-lending-test-kan34-monthly-budget'
    MonthlyBudgetUsd = '100'
    WarningPercent = '60'
    CriticalPercent = '90'
    AnomalyMode = 'Disabled'
}
$guardrailParameterMap = [ordered]@{
    ApprovedAccountId = '111122223333'
    ApplicationRegion = 'us-west-2'
    ControlRegion = 'us-east-1'
    EnvironmentName = 'test-kan34'
    EnvironmentOwner = 'platform-founders'
    FinanceOwner = 'finance-controls'
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
    ApprovalRecordId = 'KAN-229:THIRD-PARTY-FINAL-APPROVAL'
    ControlsAcknowledgement = 'I_ACKNOWLEDGE_ACCOUNT_LEVEL_COST_CONTROLS'
}

$imagePrefix = '111122223333.dkr.ecr.us-west-2.amazonaws.com/'
$applicationParameterMap = [ordered]@{
    EnvironmentName = 'test-kan34'
    BillingAcknowledgement = 'I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES'
    ApplicationVersion = ('a' * 40)
    ApiImageUri = $imagePrefix + 'crypto-lending-api@sha256:' + ('b' * 64)
    WebImageUri = $imagePrefix + 'crypto-lending-web@sha256:' + ('c' * 64)
    WorkerImageUri = $imagePrefix + 'crypto-lending-worker@sha256:' + ('d' * 64)
    S3ManagedPrefixListId = 'pl-12345678'
    AllowedIngressIpv4Cidr = '203.0.113.10/32'
    AlbCertificateArn = 'arn:aws:acm:us-west-2:111122223333:certificate/11111111-2222-3333-4444-555555555555'
    ApplicationHostname = 'test.crypto-lending.invalid'
    PostgresEngineVersion = '16.4'
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
$approvedReleaseRecord = [ordered]@{
    schemaVersion = 2
    artifactType = 'KAN_35_RELEASE_DEPLOYMENT_CONTROL'
    status = 'APPROVED'
    recordId = 'KAN-35:RELEASE:TEST-V1'
    approvedAt = $utcNow.AddHours(-2).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
    expiresAt = $utcNow.AddHours(24).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
    action = 'DEPLOY'
    templateSha256 = $applicationTemplateSha256
    aws = [ordered]@{
        accountId = '111122223333'
        region = 'us-west-2'
    }
    target = [ordered]@{
        environmentName = 'test-kan34'
        stackName = 'crypto-lending-application-test'
        changeSetName = 'kan34-application-20260819'
        changeSetType = 'CREATE'
    }
    artifact = [ordered]@{
        sourceRevision = ('a' * 40)
        apiImageUri = $applicationParameterMap.ApiImageUri
        webImageUri = $applicationParameterMap.WebImageUri
        workerImageUri = $applicationParameterMap.WorkerImageUri
        buildEvidenceSha256 = ('e' * 64)
        provenanceReference = 'evidence:KAN-35/test-build-v1'
    }
    parameters = $applicationParameterMap
    gates = [ordered]@{
        continuousIntegration = 'PASS'
        unitTests = 'PASS'
        integrationTests = 'PASS'
        migrationValidation = 'PASS'
        reproducibleBuild = 'PASS'
        artifactVersioning = 'PASS'
        evidenceReference = 'evidence:KAN-35/test-gates-v1'
    }
    rollback = [ordered]@{
        intent = 'NONE'
        fromApplicationVersion = 'NOT_APPLICABLE'
        priorReleaseRecordSha256 = 'NOT_APPLICABLE'
        parameterDifferences = @()
        databaseCompatibility = 'NOT_APPLICABLE'
        evidenceReference = 'NOT_APPLICABLE'
    }
    authority = [ordered]@{
        deploymentApprovers = @('release-owner', 'billing-finance-owner')
        rollbackApprovers = @('incident-commander', 'database-owner')
    }
    independentVerification = [ordered]@{
        verifier = 'independent-release-verifier'
        decision = 'APPROVED'
        verifiedAt = $utcNow.AddHours(-1).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
    }
}
Write-JsonFile -Path $approvedReleaseRecordPath -Value $approvedReleaseRecord -Depth 12
$incompleteReleaseRecord = ($approvedReleaseRecord | ConvertTo-Json -Depth 12) | ConvertFrom-Json
$incompleteReleaseRecord.gates.integrationTests = 'FAIL'
Write-JsonFile -Path $incompleteReleaseRecordPath -Value $incompleteReleaseRecord -Depth 12

$releaseValidationOutput = & $nodeCommand.Source @(
    $releaseRecordValidatorPath,
    '--record', $approvedReleaseRecordPath,
    '--mode', 'approved',
    '--expected-account', '111122223333',
    '--expected-region', 'us-west-2',
    '--expected-environment', 'test-kan34',
    '--expected-stack', 'crypto-lending-application-test',
    '--expected-change-set', 'kan34-application-20260819',
    '--expected-change-set-type', 'CREATE',
    '--expected-template-sha256', $applicationTemplateSha256,
    '--json'
)
if ($LASTEXITCODE -ne 0) {
    throw "Focused KAN-35 release fixture failed approved validation: $($releaseValidationOutput | Out-String)"
}
$releaseValidation = ($releaseValidationOutput | Out-String) | ConvertFrom-Json
$releaseRecordSha256 = [string] $releaseValidation.canonicalSha256
if (
    -not $releaseValidation.ok -or
    $releaseValidation.externalCallsMade -ne 0 -or
    $releaseValidation.awsCallsMade -ne 0 -or
    $releaseValidation.registryCallsMade -ne 0 -or
    $releaseRecordSha256 -notmatch '^[a-f0-9]{64}$'
) {
    throw 'Focused KAN-35 release fixture did not produce a successful zero-external-call binding.'
}
$global:LASTEXITCODE = 0

$rollbackReleaseRecord = ($approvedReleaseRecord | ConvertTo-Json -Depth 12) | ConvertFrom-Json
$rollbackReleaseRecord.recordId = 'KAN-35:ROLLBACK:TEST-V1'
$rollbackReleaseRecord.action = 'ROLLBACK'
$rollbackReleaseRecord.target.changeSetType = 'UPDATE'
$rollbackReleaseRecord.rollback.intent = 'REDEPLOY_PRIOR_VERSION'
$rollbackReleaseRecord.rollback.fromApplicationVersion = ('9' * 40)
$rollbackReleaseRecord.rollback.priorReleaseRecordSha256 = $releaseRecordSha256
$rollbackReleaseRecord.rollback.parameterDifferences = @()
$rollbackReleaseRecord.rollback.databaseCompatibility = 'NO_SCHEMA_CHANGE'
$rollbackReleaseRecord.rollback.evidenceReference = 'evidence:KAN-35/test-rollback-v1'
Write-JsonFile -Path $rollbackReleaseRecordPath -Value $rollbackReleaseRecord -Depth 12
$rollbackValidationOutput = & $nodeCommand.Source @(
    $releaseRecordValidatorPath,
    '--record', $rollbackReleaseRecordPath,
    '--prior-record', $approvedReleaseRecordPath,
    '--mode', 'approved',
    '--expected-account', '111122223333',
    '--expected-region', 'us-west-2',
    '--expected-environment', 'test-kan34',
    '--expected-stack', 'crypto-lending-application-test',
    '--expected-change-set', 'kan34-application-20260819',
    '--expected-change-set-type', 'UPDATE',
    '--expected-template-sha256', $applicationTemplateSha256,
    '--json'
)
if ($LASTEXITCODE -ne 0) {
    throw "Focused KAN-35 rollback fixture failed approved validation: $($rollbackValidationOutput | Out-String)"
}
$rollbackValidation = ($rollbackValidationOutput | Out-String) | ConvertFrom-Json
$rollbackRecordSha256 = [string] $rollbackValidation.canonicalSha256
if (
    -not $rollbackValidation.ok -or
    $rollbackValidation.externalCallsMade -ne 0 -or
    $rollbackValidation.awsCallsMade -ne 0 -or
    $rollbackRecordSha256 -notmatch '^[a-f0-9]{64}$'
) {
    throw 'Focused KAN-35 rollback fixture did not produce a successful zero-external-call binding.'
}
$global:LASTEXITCODE = 0

$tamperedPriorReleaseRecord = ($approvedReleaseRecord | ConvertTo-Json -Depth 12) | ConvertFrom-Json
$tamperedPriorReleaseRecord.artifact.provenanceReference = 'evidence:KAN-35/substituted-build-v1'
Write-JsonFile -Path $tamperedPriorReleaseRecordPath -Value $tamperedPriorReleaseRecord -Depth 12

Write-ApplicationStackResponse -ApplicationVersion $applicationParameterMap.ApplicationVersion -StackStatus 'REVIEW_IN_PROGRESS'

$applicationStackTags = [ordered]@{
    application = 'crypto-lending'
    environment = 'test-kan34'
    owner = 'platform-founders'
    'finance-owner' = 'finance-controls'
    'cost-center' = 'CRYPTO-PLATFORM'
    'control-record-sha256' = $controlRecordSha256
    'billing-control-record' = 'KAN-229:THIRD-PARTY-FINAL-APPROVAL'
    'acm-dns-control-record' = 'KAN-230:ACM-DNS-BOOTSTRAP-APPROVAL'
    'acm-dns-configuration-sha256' = $acmDnsConfigurationSha256
    'release-control-record' = 'KAN-35:RELEASE:TEST-V1'
    'release-control-sha256' = $releaseRecordSha256
    'release-action' = 'deploy'
    'source-revision' = ('a' * 40)
    'managed-by' = 'cloudformation'
    ticket = 'KAN-34'
}
$parameterSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $applicationParameterMap)
$tagSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $applicationStackTags)
$expectedChangeSetDescription = "KAN-35 release-record-sha256=$releaseRecordSha256 release-action=DEPLOY source-revision=$('a' * 40) prior-release-record-sha256=NOT_APPLICABLE KAN-34 template-sha256=$applicationTemplateSha256 parameters-sha256=$parameterSha256 tags-sha256=$tagSha256 control-record-sha256=$controlRecordSha256 acm-dns-record-sha256=$acmDnsRecordSha256 guardrail-policy=kan-229-v1"
$billableAcknowledgement = "EXECUTE REVIEWED DEPLOY CHANGE SET kan34-application-20260819 FOR STACK crypto-lending-application-test USING INDEPENDENTLY EXPECTED RELEASE CONTROL DIGEST $releaseRecordSha256, BILLING CONTROL $controlRecordSha256, AND ACM DNS CONTROL $acmDnsRecordSha256; I ACKNOWLEDGE BILLABLE AWS RESOURCES IN ACCOUNT 111122223333 REGION us-west-2 USING PROFILE kan34-test"
$rollbackStackTags = Copy-ArgumentMap -Map $applicationStackTags
$rollbackStackTags['release-control-record'] = 'KAN-35:ROLLBACK:TEST-V1'
$rollbackStackTags['release-control-sha256'] = $rollbackRecordSha256
$rollbackStackTags['release-action'] = 'rollback'
$rollbackTagSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $rollbackStackTags)
$rollbackExpectedChangeSetDescription = "KAN-35 release-record-sha256=$rollbackRecordSha256 release-action=ROLLBACK source-revision=$('a' * 40) prior-release-record-sha256=$releaseRecordSha256 KAN-34 template-sha256=$applicationTemplateSha256 parameters-sha256=$parameterSha256 tags-sha256=$rollbackTagSha256 control-record-sha256=$controlRecordSha256 acm-dns-record-sha256=$acmDnsRecordSha256 guardrail-policy=kan-229-v1"
$rollbackBillableAcknowledgement = "EXECUTE REVIEWED ROLLBACK CHANGE SET kan34-application-20260819 FOR STACK crypto-lending-application-test FROM APPLICATION VERSION $('9' * 40) TO PRIOR VERSION $('a' * 40) USING INDEPENDENTLY EXPECTED RELEASE CONTROL DIGEST $rollbackRecordSha256 AND PRIOR RELEASE RECORD $releaseRecordSha256; I ACKNOWLEDGE BILLABLE AWS RESOURCES IN ACCOUNT 111122223333 REGION us-west-2 USING PROFILE kan34-test"

$baseArguments = @{
    Action = 'Deploy'
    TemplateFile = $applicationTemplatePath
    Profile = 'kan34-test'
    AccountId = '111122223333'
    Region = 'us-west-2'
    StackName = 'crypto-lending-application-test'
    ChangeSetName = 'kan34-application-20260819'
    ChangeSetType = 'CREATE'
    EnvironmentName = 'test-kan34'
    BillingControlRecordFile = $approvedRecordPath
    AcmDnsControlRecordFile = $approvedAcmDnsRecordPath
    ReleaseControlRecordFile = $approvedReleaseRecordPath
    ExpectedReleaseControlRecordSha256 = $releaseRecordSha256
    GuardrailStackName = 'crypto-lending-account-guardrails-test'
    GuardrailControlRegion = 'us-east-1'
    AllowAwsApiCalls = $true
    BillableAcknowledgement = $billableAcknowledgement
}

try {
    Invoke-FocusedTest -Name 'default LocalValidate makes zero AWS calls' -Body {
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments @{}
        Assert-Condition $result.Succeeded "LocalValidate failed: $($result.Output)"
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'LocalValidate invoked the fake AWS CLI.'
        Assert-Condition ($result.Output -match 'No AWS calls were made') 'LocalValidate did not report its zero-call boundary.'
    }

    Invoke-FocusedTest -Name 'KAN-35 release preflight rejects missing and failed-gate records before AWS' -Body {
        Clear-AwsMarker
        $missingArguments = Copy-ArgumentMap -Map $baseArguments
        [void] $missingArguments.Remove('ReleaseControlRecordFile')
        $missingResult = Invoke-Guard -Arguments $missingArguments
        Assert-Condition (-not $missingResult.Succeeded) 'Deploy accepted a missing KAN-35 release record.'
        Assert-Condition ($missingResult.Output -match 'ReleaseControlRecordFile must be supplied explicitly') 'Missing KAN-35 release record rejection did not identify the required record.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Missing KAN-35 release record reached AWS discovery.'

        Clear-AwsMarker
        $failedArguments = Copy-ArgumentMap -Map $baseArguments
        $failedArguments.ReleaseControlRecordFile = $incompleteReleaseRecordPath
        $failedResult = Invoke-Guard -Arguments $failedArguments
        Assert-Condition (-not $failedResult.Succeeded) 'Deploy accepted a failed KAN-35 integration gate.'
        Assert-Condition ($failedResult.Output -match 'gate-complete') 'Failed KAN-35 gate rejection did not identify the release gate.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Failed KAN-35 gate reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'KAN-35 preflight rejects unauthenticated active records and missing or substituted prior records before AWS' -Body {
        Clear-AwsMarker
        $missingDigestArguments = Copy-ArgumentMap -Map $baseArguments
        [void] $missingDigestArguments.Remove('ExpectedReleaseControlRecordSha256')
        $missingDigestResult = Invoke-Guard -Arguments $missingDigestArguments
        Assert-Condition (-not $missingDigestResult.Succeeded) 'Deploy accepted a missing independently supplied release-record digest.'
        Assert-Condition ($missingDigestResult.Output -match 'ExpectedReleaseControlRecordSha256 must be supplied explicitly') 'Missing expected release-record digest rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Missing expected release-record digest reached AWS discovery.'

        Clear-AwsMarker
        $wrongDigestArguments = Copy-ArgumentMap -Map $baseArguments
        $wrongDigestArguments.ExpectedReleaseControlRecordSha256 = ('0' * 64)
        $wrongDigestResult = Invoke-Guard -Arguments $wrongDigestArguments
        Assert-Condition (-not $wrongDigestResult.Succeeded) 'Deploy accepted a release record that did not match the independently supplied digest.'
        Assert-Condition ($wrongDigestResult.Output -match 'release/deployment control record is not approved') 'Wrong expected release-record digest rejection did not fail the local release gate.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Wrong expected release-record digest reached AWS discovery.'

        $rollbackPreflightArguments = Copy-ArgumentMap -Map $baseArguments
        $rollbackPreflightArguments.ChangeSetType = 'UPDATE'
        $rollbackPreflightArguments.ReleaseControlRecordFile = $rollbackReleaseRecordPath
        $rollbackPreflightArguments.ExpectedReleaseControlRecordSha256 = $rollbackRecordSha256
        $rollbackPreflightArguments.BillableAcknowledgement = $rollbackBillableAcknowledgement

        Clear-AwsMarker
        $missingPriorResult = Invoke-Guard -Arguments $rollbackPreflightArguments
        Assert-Condition (-not $missingPriorResult.Succeeded) 'Rollback accepted a missing prior DEPLOY control record.'
        Assert-Condition ($missingPriorResult.Output -match 'release/deployment control record is not approved') 'Missing prior DEPLOY record rejection did not fail the local release gate.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Missing prior DEPLOY record reached AWS discovery.'

        Clear-AwsMarker
        $substitutedPriorArguments = Copy-ArgumentMap -Map $rollbackPreflightArguments
        $substitutedPriorArguments.PriorReleaseControlRecordFile = $tamperedPriorReleaseRecordPath
        $substitutedPriorResult = Invoke-Guard -Arguments $substitutedPriorArguments
        Assert-Condition (-not $substitutedPriorResult.Succeeded) 'Rollback accepted a substituted prior DEPLOY control record.'
        Assert-Condition ($substitutedPriorResult.Output -match 'release/deployment control record is not approved') 'Substituted prior DEPLOY record rejection did not fail the local release gate.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Substituted prior DEPLOY record reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'final-record preflight rejects incomplete delivery evidence before AWS' -Body {
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.BillingControlRecordFile = $incompleteRecordPath
        $result = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted an evidence-incomplete final control record.'
        Assert-Condition ($result.Output -match 'evidence-complete') "Final-record rejection did not identify the approved evidence gate: $($result.Output)"
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Incomplete final record reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'KAN-230 preflight rejects missing, mismatched, and incomplete bootstrap records before AWS' -Body {
        Clear-AwsMarker
        $missingArguments = Copy-ArgumentMap -Map $baseArguments
        [void] $missingArguments.Remove('AcmDnsControlRecordFile')
        $missingResult = Invoke-Guard -Arguments $missingArguments
        Assert-Condition (-not $missingResult.Succeeded) 'Deploy accepted a missing KAN-230 control record.'
        Assert-Condition ($missingResult.Output -match 'AcmDnsControlRecordFile must be supplied explicitly') 'Missing KAN-230 record rejection did not identify the required prerequisite.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Missing KAN-230 record reached AWS discovery.'

        Clear-AwsMarker
        $mismatchedArguments = Copy-ArgumentMap -Map $baseArguments
        $mismatchedArguments.AcmDnsControlRecordFile = $mismatchedAcmDnsRecordPath
        $mismatchedResult = Invoke-Guard -Arguments $mismatchedArguments
        Assert-Condition (-not $mismatchedResult.Succeeded) 'Deploy accepted a KAN-230 record for the wrong account.'
        Assert-Condition ($mismatchedResult.Output -match 'KAN-230 ACM/DNS prerequisite') 'Mismatched KAN-230 record rejection did not identify the prerequisite.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Mismatched KAN-230 record reached AWS discovery.'

        Clear-AwsMarker
        $incompleteArguments = Copy-ArgumentMap -Map $baseArguments
        $incompleteArguments.AcmDnsControlRecordFile = $incompleteAcmDnsRecordPath
        $incompleteResult = Invoke-Guard -Arguments $incompleteArguments
        Assert-Condition (-not $incompleteResult.Succeeded) 'Deploy accepted an evidence-incomplete KAN-230 bootstrap record.'
        Assert-Condition ($incompleteResult.Output -match 'KAN-230 ACM/DNS prerequisite') 'Incomplete KAN-230 record rejection did not identify the prerequisite.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Incomplete KAN-230 record reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'CREATE Plan pins OnStackFailure ROLLBACK without execution' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        $planArguments = Copy-ArgumentMap -Map $baseArguments
        $planArguments.Action = 'Plan'
        $planArguments.ParameterOverride = @($applicationParameterMap.GetEnumerator() | Where-Object {
                $_.Key -ne 'EnvironmentName'
            } | ForEach-Object {
                "$($_.Key)=$($_.Value)"
            })
        [void] $planArguments.Remove('BillableAcknowledgement')
        $result = Invoke-Guard -Arguments $planArguments
        $marker = Get-AwsMarkerText
        $createLines = @($marker -split "`r?`n" | Where-Object { $_ -match 'cloudformation create-change-set' })
        Assert-Condition $result.Succeeded "CREATE Plan failed: $($result.Output)"
        Assert-Condition ($createLines.Count -eq 1) 'CREATE Plan did not submit exactly one change set.'
        Assert-Condition ($createLines[0] -match '--on-stack-failure ROLLBACK(?:\s|$)') 'CREATE Plan did not explicitly pin OnStackFailure ROLLBACK.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'CREATE Plan executed a change set.'
    }

    Invoke-FocusedTest -Name 'guardrail preflight requires the stable control configuration hash tag' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlRecordSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse
        $result = Invoke-Guard -Arguments $baseArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted canonical record SHA in place of controlConfigurationSha256.'
        Assert-Condition ($result.Output -match 'control-configuration-sha256') 'Guardrail preflight did not identify the stable configuration-hash tag mismatch.'
        Assert-Condition ($marker -match 'cloudformation describe-stacks') 'Guardrail stack preflight was not attempted.'
        Assert-Condition ($marker -notmatch 'describe-change-set|execute-change-set') 'Application change-set APIs ran after guardrail tag rejection.'
    }

    Invoke-FocusedTest -Name 'Deploy rejects the wrong guardrail Original template' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody ($guardrailTemplateBody + "`n# unreviewed guardrail mutation")
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse
        $result = Invoke-Guard -Arguments $baseArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted a mismatched guardrail Original template.'
        Assert-Condition ($result.Output -match 'reviewed local KAN-229 template') 'Guardrail template mismatch was not identified.'
        Assert-Condition ($marker -match 'cloudformation get-template') 'Guardrail Original template was not retrieved.'
        Assert-Condition ($marker -notmatch 'describe-change-set|execute-change-set') 'Application change-set APIs ran after guardrail template rejection.'
    }

    Invoke-FocusedTest -Name 'Deploy rejects the wrong application change-set Original template' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody ($applicationTemplateBody + "`n# unreviewed application mutation")
        Write-ChangeSetResponse
        $result = Invoke-Guard -Arguments $baseArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted a mismatched application change-set Original template.'
        Assert-Condition ($result.Output -match 'actual Original template') 'Application template mismatch was not identified.'
        Assert-Condition ($marker -match 'cloudformation describe-change-set') 'Application change set was not described.'
        Assert-Condition ($marker -match [regex]::Escape($immutableChangeSetId)) 'Application get-template was not bound to the immutable change-set ARN.'
        Assert-Condition ($marker -match '--template-stage Original') 'Application get-template did not request the Original template stage.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'Deploy executed after application template rejection.'
    }

    Invoke-FocusedTest -Name 'Deploy rejects a self-resealed change set whose parameters differ from the KAN-35 record' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        $forgedParameters = Copy-ArgumentMap -Map $applicationParameterMap
        $forgedParameters.ApiDesiredCount = '1'
        $forgedParameterSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $forgedParameters)
        $forgedDescription = $expectedChangeSetDescription.Replace(
            "parameters-sha256=$parameterSha256",
            "parameters-sha256=$forgedParameterSha256"
        )
        Write-ChangeSetResponse -ParameterValues $forgedParameters -DescriptionValue $forgedDescription
        $result = Invoke-Guard -Arguments $baseArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted a self-resealed change set with an unapproved desired count.'
        Assert-Condition ($result.Output -match 'ApiDesiredCount.*does not match the approved KAN-35') 'Parameter mismatch did not identify the exact KAN-35 binding.'
        Assert-Condition ($marker -match 'cloudformation describe-change-set') 'Self-resealed parameter test did not reach change-set verification.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'Deploy executed a self-resealed parameter mismatch.'
    }

    Invoke-FocusedTest -Name 'Deploy rejects a change-set type that differs from the KAN-35 target' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse -TypeValue 'UPDATE'
        $result = Invoke-Guard -Arguments $baseArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted a change-set type that differed from the approved KAN-35 target.'
        Assert-Condition ($result.Output -match 'change set type.*does not match the approved type') 'Change-set type mismatch was not identified.'
        Assert-Condition ($marker -notmatch [regex]::Escape($immutableChangeSetId)) 'Deploy retrieved the application template after a change-set type mismatch.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'Deploy executed after a change-set type mismatch.'
    }

    Invoke-FocusedTest -Name 'Deploy rejects every unreviewed observable change-set execution context' -Body {
        $unsafeContexts = @(
            [ordered]@{ Name = 'notification ARN'; Overrides = [ordered]@{ NotificationARNs = @('arn:aws:sns:us-west-2:111122223333:unapproved') }; Pattern = 'notification ARNs' },
            [ordered]@{ Name = 'rollback trigger'; Overrides = [ordered]@{ RollbackConfiguration = [ordered]@{ RollbackTriggers = @([ordered]@{ Arn = 'arn:aws:cloudwatch:us-west-2:111122223333:alarm:unapproved'; Type = 'AWS::CloudWatch::Alarm' }); MonitoringTimeInMinutes = 5 } }; Pattern = 'rollback configuration' },
            [ordered]@{ Name = 'capability drift'; Overrides = [ordered]@{ Capabilities = @('CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM') }; Pattern = 'exactly.*CAPABILITY_IAM' },
            [ordered]@{ Name = 'resource types'; Overrides = [ordered]@{ ResourceTypes = @('AWS::IAM::Role') }; Pattern = 'ResourceTypes' },
            [ordered]@{ Name = 'nested stacks'; Overrides = [ordered]@{ IncludeNestedStacks = $true }; Pattern = 'IncludeNestedStacks' },
            [ordered]@{ Name = 'parent change set'; Overrides = [ordered]@{ ParentChangeSetId = 'arn:aws:cloudformation:us-west-2:111122223333:changeSet/parent/id' }; Pattern = 'ParentChangeSetId' },
            [ordered]@{ Name = 'root change set'; Overrides = [ordered]@{ RootChangeSetId = 'arn:aws:cloudformation:us-west-2:111122223333:changeSet/root/id' }; Pattern = 'RootChangeSetId' },
            [ordered]@{ Name = 'missing CREATE failure policy'; Overrides = [ordered]@{}; OmitOnStackFailure = $true; Pattern = 'explicitly use OnStackFailure ROLLBACK' },
            [ordered]@{ Name = 'DELETE failure override'; Overrides = [ordered]@{ OnStackFailure = 'DELETE' }; Pattern = 'explicitly use OnStackFailure ROLLBACK' },
            [ordered]@{ Name = 'DO_NOTHING failure override'; Overrides = [ordered]@{ OnStackFailure = 'DO_NOTHING' }; Pattern = 'explicitly use OnStackFailure ROLLBACK' },
            [ordered]@{ Name = 'resource import'; Overrides = [ordered]@{ ImportExistingResources = $true }; Pattern = 'ImportExistingResources' },
            [ordered]@{ Name = 'deployment mode'; Overrides = [ordered]@{ DeploymentMode = [ordered]@{ Mode = 'REVERT_DRIFT' } }; Pattern = 'DeploymentMode' },
            [ordered]@{ Name = 'deployment config'; Overrides = [ordered]@{ DeploymentConfig = [ordered]@{ FailureToleranceCount = 1 } }; Pattern = 'DeploymentConfig' }
        )
        foreach ($unsafeContext in $unsafeContexts) {
            Clear-AwsMarker
            Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
            Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
            Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
            Write-ApplicationStackResponse -ApplicationVersion $applicationParameterMap.ApplicationVersion -StackStatus 'REVIEW_IN_PROGRESS'
            if ($unsafeContext.Contains('OmitOnStackFailure') -and $unsafeContext.OmitOnStackFailure) {
                Write-ChangeSetResponse -ExecutionContextOverrides $unsafeContext.Overrides -OmitOnStackFailure
            }
            else {
                Write-ChangeSetResponse -ExecutionContextOverrides $unsafeContext.Overrides
            }
            $result = Invoke-Guard -Arguments $baseArguments
            $marker = Get-AwsMarkerText
            Assert-Condition (-not $result.Succeeded) "Deploy accepted unreviewed $($unsafeContext.Name)."
            Assert-Condition ($result.Output -match $unsafeContext.Pattern) "Unreviewed $($unsafeContext.Name) rejection was not explicit: $($result.Output)"
            Assert-Condition ($marker -match 'cloudformation describe-change-set') "Unreviewed $($unsafeContext.Name) test did not reach change-set verification."
            Assert-Condition ($marker -notmatch [regex]::Escape($immutableChangeSetId)) "Deploy retrieved the application template after rejecting unreviewed $($unsafeContext.Name)."
            Assert-Condition ($marker -notmatch 'execute-change-set') "Deploy executed with unreviewed $($unsafeContext.Name)."
        }
    }

    Invoke-FocusedTest -Name 'Deploy rejects persisted stack service roles for CREATE and UPDATE' -Body {
        $unapprovedRoleArn = 'arn:aws:iam::111122223333:role/UnapprovedCloudFormationServiceRole'

        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ApplicationStackResponse -ApplicationVersion $applicationParameterMap.ApplicationVersion -StackStatus 'REVIEW_IN_PROGRESS' -RoleArn $unapprovedRoleArn
        Write-ChangeSetResponse
        $createResult = Invoke-Guard -Arguments $baseArguments
        $createMarker = Get-AwsMarkerText
        Assert-Condition (-not $createResult.Succeeded) 'CREATE Deploy accepted an associated REVIEW_IN_PROGRESS stack service role.'
        Assert-Condition ($createResult.Output -match 'unapproved persisted service RoleARN') "CREATE service-role rejection was not explicit: $($createResult.Output)"
        Assert-Condition ($createMarker -notmatch 'execute-change-set') 'CREATE Deploy executed with an unapproved stack service role.'

        Clear-AwsMarker
        Write-ApplicationStackResponse -ApplicationVersion ('9' * 40) -StackStatus 'UPDATE_COMPLETE' -RoleArn $unapprovedRoleArn
        Write-ChangeSetResponse `
            -ParameterValues $applicationParameterMap `
            -TagValues $rollbackStackTags `
            -DescriptionValue $rollbackExpectedChangeSetDescription `
            -TypeValue 'UPDATE'
        $updateArguments = Copy-ArgumentMap -Map $baseArguments
        $updateArguments.ChangeSetType = 'UPDATE'
        $updateArguments.ReleaseControlRecordFile = $rollbackReleaseRecordPath
        $updateArguments.PriorReleaseControlRecordFile = $approvedReleaseRecordPath
        $updateArguments.ExpectedReleaseControlRecordSha256 = $rollbackRecordSha256
        $updateArguments.BillableAcknowledgement = $rollbackBillableAcknowledgement
        $updateResult = Invoke-Guard -Arguments $updateArguments
        $updateMarker = Get-AwsMarkerText
        Assert-Condition (-not $updateResult.Succeeded) 'UPDATE Deploy accepted an associated stack service role.'
        Assert-Condition ($updateResult.Output -match 'unapproved persisted service RoleARN') "UPDATE service-role rejection was not explicit: $($updateResult.Output)"
        Assert-Condition ($updateMarker -notmatch 'execute-change-set') 'UPDATE Deploy executed with an unapproved stack service role.'

        Write-ApplicationStackResponse -ApplicationVersion $applicationParameterMap.ApplicationVersion -StackStatus 'REVIEW_IN_PROGRESS'
    }

    Invoke-FocusedTest -Name 'exact happy path executes only the immutable change-set ARN' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse
        $result = Invoke-Guard -Arguments $baseArguments
        $marker = Get-AwsMarkerText
        $executeLines = @($marker -split "`r?`n" | Where-Object { $_ -match 'cloudformation execute-change-set' })
        Assert-Condition $result.Succeeded "Exact application Deploy failed: $($result.Output)"
        Assert-Condition ($marker -match 'cloudformation describe-stacks') 'Happy path did not verify the guardrail stack.'
        Assert-Condition ($marker -match 'cloudformation describe-change-set') 'Happy path did not verify the application change set.'
        Assert-Condition ($executeLines.Count -eq 1) 'Happy path did not invoke execute-change-set exactly once.'
        Assert-Condition ($executeLines[0] -match ('--change-set-name ' + [regex]::Escape($immutableChangeSetId) + '(?:\s|$)')) 'execute-change-set did not target the immutable change-set ARN.'
        Assert-Condition ($executeLines[0] -notmatch '--change-set-name kan34-application-20260819(?:\s|$)') 'execute-change-set used the mutable change-set name.'
        Assert-Condition ($marker -notmatch 'create-change-set') 'Deploy unexpectedly created a new change set.'
    }

    Invoke-FocusedTest -Name 'Rollback rejects stale from-version intent before execution' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ApplicationStackResponse -ApplicationVersion $applicationParameterMap.ApplicationVersion
        Write-ChangeSetResponse `
            -ParameterValues $applicationParameterMap `
            -TagValues $rollbackStackTags `
            -DescriptionValue $rollbackExpectedChangeSetDescription `
            -TypeValue 'UPDATE'
        $rollbackArguments = Copy-ArgumentMap -Map $baseArguments
        $rollbackArguments.ChangeSetType = 'UPDATE'
        $rollbackArguments.ReleaseControlRecordFile = $rollbackReleaseRecordPath
        $rollbackArguments.PriorReleaseControlRecordFile = $approvedReleaseRecordPath
        $rollbackArguments.ExpectedReleaseControlRecordSha256 = $rollbackRecordSha256
        $rollbackArguments.BillableAcknowledgement = $rollbackBillableAcknowledgement
        $result = Invoke-Guard -Arguments $rollbackArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Rollback accepted a stale from-version intent.'
        Assert-Condition ($result.Output -match 'Rollback intent expected current ApplicationVersion') 'Stale rollback did not identify the current-version mismatch.'
        Assert-Condition ($marker -match 'cloudformation describe-stacks --stack-name crypto-lending-application-test') 'Rollback did not re-read current application stack state.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'Rollback executed after a stale from-version mismatch.'
    }

    Invoke-FocusedTest -Name 'exact prior-artifact rollback executes only after current-version verification' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ApplicationStackResponse -ApplicationVersion ('9' * 40)
        Write-ChangeSetResponse `
            -ParameterValues $applicationParameterMap `
            -TagValues $rollbackStackTags `
            -DescriptionValue $rollbackExpectedChangeSetDescription `
            -TypeValue 'UPDATE'
        $rollbackArguments = Copy-ArgumentMap -Map $baseArguments
        $rollbackArguments.ChangeSetType = 'UPDATE'
        $rollbackArguments.ReleaseControlRecordFile = $rollbackReleaseRecordPath
        $rollbackArguments.PriorReleaseControlRecordFile = $approvedReleaseRecordPath
        $rollbackArguments.ExpectedReleaseControlRecordSha256 = $rollbackRecordSha256
        $rollbackArguments.BillableAcknowledgement = $rollbackBillableAcknowledgement
        $result = Invoke-Guard -Arguments $rollbackArguments
        $marker = Get-AwsMarkerText
        $executeLines = @($marker -split "`r?`n" | Where-Object { $_ -match 'cloudformation execute-change-set' })
        Assert-Condition $result.Succeeded "Exact application rollback failed: $($result.Output)"
        Assert-Condition ($marker -match 'cloudformation describe-stacks --stack-name crypto-lending-application-test') 'Rollback did not verify the current application version.'
        Assert-Condition ($executeLines.Count -eq 1) 'Rollback did not invoke execute-change-set exactly once.'
        Assert-Condition ($executeLines[0] -match [regex]::Escape($immutableChangeSetId)) 'Rollback did not execute the immutable change-set ARN.'
    }

    Write-Host "All $passed focused KAN-34/KAN-35 application invocation-guard tests passed."
}
finally {
    $env:PATH = $originalEnvironment.PATH
    $env:FAKE_AWS_MARKER = $originalEnvironment.FAKE_AWS_MARKER
    $env:FAKE_AWS_IDENTITY_RESPONSE = $originalEnvironment.FAKE_AWS_IDENTITY_RESPONSE
    $env:FAKE_AWS_GUARDRAIL_STACK_RESPONSE = $originalEnvironment.FAKE_AWS_GUARDRAIL_STACK_RESPONSE
    $env:FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE = $originalEnvironment.FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE
    $env:FAKE_AWS_CHANGE_SET_RESPONSE = $originalEnvironment.FAKE_AWS_CHANGE_SET_RESPONSE
    $env:FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE = $originalEnvironment.FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE
    $env:FAKE_AWS_APPLICATION_STACK_RESPONSE = $originalEnvironment.FAKE_AWS_APPLICATION_STACK_RESPONSE

    $resolvedTemporaryRoot = [System.IO.Path]::GetFullPath($temporaryRoot)
    $resolvedSystemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $safePrefix = $resolvedSystemTemp.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (
        $resolvedTemporaryRoot.StartsWith($safePrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
        ([System.IO.Path]::GetFileName($resolvedTemporaryRoot) -like 'kan34-application-guard-test-*') -and
        (Test-Path -LiteralPath $resolvedTemporaryRoot -PathType Container)
    ) {
        Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
    }
}
