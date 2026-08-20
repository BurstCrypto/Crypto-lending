[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$guardPath = Join-Path $PSScriptRoot 'invoke-application-baseline.ps1'
$applicationTemplatePath = Join-Path $PSScriptRoot 'application-baseline.yaml'
$guardrailTemplatePath = Join-Path $PSScriptRoot 'account-guardrails.yaml'
$recordValidatorPath = Join-Path $PSScriptRoot 'validate-billing-control-record.mjs'
$acmDnsRecordValidatorPath = Join-Path $PSScriptRoot 'validate-acm-dns-control-record.mjs'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("kan34-application-guard-test-" + [guid]::NewGuid().ToString('N'))
$fakeAwsDirectory = Join-Path $temporaryRoot 'fake-aws'
$markerPath = Join-Path $temporaryRoot 'aws-calls.log'
$identityResponsePath = Join-Path $temporaryRoot 'identity.json'
$guardrailStackResponsePath = Join-Path $temporaryRoot 'guardrail-stack.json'
$guardrailTemplateResponsePath = Join-Path $temporaryRoot 'guardrail-template.json'
$changeSetResponsePath = Join-Path $temporaryRoot 'change-set.json'
$applicationTemplateResponsePath = Join-Path $temporaryRoot 'application-template.json'
$approvedRecordPath = Join-Path $temporaryRoot 'approved-billing-control-record.json'
$incompleteRecordPath = Join-Path $temporaryRoot 'incomplete-billing-control-record.json'
$approvedAcmDnsRecordPath = Join-Path $temporaryRoot 'approved-acm-dns-bootstrap-record.json'
$mismatchedAcmDnsRecordPath = Join-Path $temporaryRoot 'mismatched-acm-dns-bootstrap-record.json'
$incompleteAcmDnsRecordPath = Join-Path $temporaryRoot 'incomplete-acm-dns-bootstrap-record.json'
$immutableChangeSetId = 'arn:aws:cloudformation:us-west-2:111122223333:changeSet/kan34-application-20260819/11111111-2222-3333-4444-555555555555'
$originalEnvironment = @{
    PATH = $env:PATH
    FAKE_AWS_MARKER = $env:FAKE_AWS_MARKER
    FAKE_AWS_IDENTITY_RESPONSE = $env:FAKE_AWS_IDENTITY_RESPONSE
    FAKE_AWS_GUARDRAIL_STACK_RESPONSE = $env:FAKE_AWS_GUARDRAIL_STACK_RESPONSE
    FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE = $env:FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE
    FAKE_AWS_CHANGE_SET_RESPONSE = $env:FAKE_AWS_CHANGE_SET_RESPONSE
    FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE = $env:FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE
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

function Write-ChangeSetResponse {
    $parameters = @($applicationParameterMap.GetEnumerator() | ForEach-Object {
            [ordered]@{
                ParameterKey = [string] $_.Key
                ParameterValue = [string] $_.Value
                UsePreviousValue = $false
            }
        })
    $tags = @($applicationStackTags.GetEnumerator() | ForEach-Object {
            [ordered]@{ Key = [string] $_.Key; Value = [string] $_.Value }
        })
    Write-JsonFile -Path $changeSetResponsePath -Value ([ordered]@{
            StackName = 'crypto-lending-application-test'
            ChangeSetName = 'kan34-application-20260819'
            ChangeSetId = $immutableChangeSetId
            ChangeSetType = 'CREATE'
            Status = 'CREATE_COMPLETE'
            ExecutionStatus = 'AVAILABLE'
            Description = $expectedChangeSetDescription
            Parameters = $parameters
            Tags = $tags
            Capabilities = @('CAPABILITY_IAM')
            Changes = @()
        })
}

if (-not (Test-Path -LiteralPath $guardPath -PathType Leaf)) {
    throw "Application guard under test was not found: $guardPath"
}
foreach ($requiredFile in @($applicationTemplatePath, $guardrailTemplatePath, $recordValidatorPath, $acmDnsRecordValidatorPath)) {
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
    'managed-by' = 'cloudformation'
    ticket = 'KAN-34'
}
$parameterSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $applicationParameterMap)
$tagSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $applicationStackTags)
$expectedChangeSetDescription = "KAN-34 template-sha256=$applicationTemplateSha256 parameters-sha256=$parameterSha256 tags-sha256=$tagSha256 control-record-sha256=$controlRecordSha256 acm-dns-record-sha256=$acmDnsRecordSha256 guardrail-policy=kan-229-v1"
$billableAcknowledgement = "EXECUTE REVIEWED CHANGE SET kan34-application-20260819 FOR STACK crypto-lending-application-test USING BILLING CONTROL $controlRecordSha256 AND ACM DNS CONTROL $acmDnsRecordSha256; I ACKNOWLEDGE BILLABLE AWS RESOURCES IN ACCOUNT 111122223333 REGION us-west-2 USING PROFILE kan34-test"

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

    Invoke-FocusedTest -Name 'final-record preflight rejects incomplete delivery evidence before AWS' -Body {
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.BillingControlRecordFile = $incompleteRecordPath
        $result = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted an evidence-incomplete final control record.'
        Assert-Condition ($result.Output -match 'evidence-complete') 'Final-record rejection did not identify the approved evidence gate.'
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

    Write-Host "All $passed focused KAN-34 application invocation-guard tests passed."
}
finally {
    $env:PATH = $originalEnvironment.PATH
    $env:FAKE_AWS_MARKER = $originalEnvironment.FAKE_AWS_MARKER
    $env:FAKE_AWS_IDENTITY_RESPONSE = $originalEnvironment.FAKE_AWS_IDENTITY_RESPONSE
    $env:FAKE_AWS_GUARDRAIL_STACK_RESPONSE = $originalEnvironment.FAKE_AWS_GUARDRAIL_STACK_RESPONSE
    $env:FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE = $originalEnvironment.FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE
    $env:FAKE_AWS_CHANGE_SET_RESPONSE = $originalEnvironment.FAKE_AWS_CHANGE_SET_RESPONSE
    $env:FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE = $originalEnvironment.FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE

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
