[CmdletBinding()]
param(
    [ValidateSet('LocalValidate', 'RenderPlan')]
    [string]$Action = 'LocalValidate',

    [ValidateSet('example', 'authorization', 'bootstrap', 'cutover', 'final')]
    [string]$Mode = 'example',

    [string]$RecordFile,
    [string]$ExpectedAccount,
    [string]$ExpectedRegion,
    [string]$OutputFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $PSCommandPath
$repositoryRoot = Resolve-Path (Join-Path $scriptDirectory '..\..')
$defaultRecord = Join-Path $scriptDirectory 'acm-dns-control-record.example.json'
$validator = Join-Path $scriptDirectory 'validate-acm-dns-control-record.mjs'

if ([string]::IsNullOrWhiteSpace($RecordFile)) {
    $RecordFile = $defaultRecord
}

$resolvedRecord = (Resolve-Path -LiteralPath $RecordFile).Path
$resolvedDefaultRecord = (Resolve-Path -LiteralPath $defaultRecord).Path

if ($Action -eq 'LocalValidate' -and -not [string]::IsNullOrWhiteSpace($OutputFile)) {
    throw 'LocalValidate does not accept OutputFile.'
}

if ($Action -eq 'RenderPlan') {
    if ($Mode -notin @('authorization', 'cutover')) {
        throw 'RenderPlan accepts only authorization or cutover mode.'
    }
    if ($resolvedRecord -eq $resolvedDefaultRecord) {
        throw 'RenderPlan requires an ignored, approved operational record instead of the example.'
    }
    if (-not $resolvedRecord.EndsWith('.acm-dns.local.json', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'RenderPlan input must use the ignored .acm-dns.local.json suffix.'
    }
    if ($ExpectedAccount -notmatch '^\d{12}$') {
        throw 'RenderPlan requires ExpectedAccount with exactly 12 digits.'
    }
    if ($ExpectedRegion -notmatch '^[a-z]{2}(?:-gov)?-[a-z]+-\d$') {
        throw 'RenderPlan requires an explicit AWS Region.'
    }
    if ([string]::IsNullOrWhiteSpace($OutputFile) -or -not $OutputFile.EndsWith('.acm-dns-plan.local.json', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'RenderPlan output must end with .acm-dns-plan.local.json.'
    }
    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputFile)
    if ($resolvedOutput -eq $resolvedRecord) {
        throw 'RenderPlan output must not overwrite its input record.'
    }
    if (Test-Path -LiteralPath $resolvedOutput) {
        throw 'RenderPlan refuses to overwrite an existing file.'
    }
}

$node = Get-Command node -ErrorAction Stop
$validatorArguments = @(
    $validator,
    '--record',
    $resolvedRecord,
    '--mode',
    $Mode,
    '--json'
)
if (-not [string]::IsNullOrWhiteSpace($ExpectedAccount)) {
    $validatorArguments += @('--expected-account', $ExpectedAccount)
}
if (-not [string]::IsNullOrWhiteSpace($ExpectedRegion)) {
    $validatorArguments += @('--expected-region', $ExpectedRegion)
}

$validationOutput = & $node.Source @validatorArguments 2>&1
if ($LASTEXITCODE -ne 0) {
    throw ($validationOutput -join [Environment]::NewLine)
}
$validation = ($validationOutput | Out-String) | ConvertFrom-Json
if (
    -not $validation.ok -or
    $validation.externalCallsMade -ne 0 -or
    $validation.awsCallsMade -ne 0 -or
    $validation.dnsQueriesMade -ne 0 -or
    $validation.tlsConnectionsMade -ne 0 -or
    $validation.providerCallsMade -ne 0 -or
    $validation.resourcesCreated -ne 0
) {
    throw 'KAN-230 validation did not produce a successful zero-external-call result.'
}
Write-Host "KAN-230 $Mode control record valid."
Write-Host "Record SHA-256: $($validation.canonicalSha256)"
Write-Host "Configuration SHA-256: $($validation.configurationSha256)"
Write-Host 'External API calls made: 0'

if ($Action -eq 'RenderPlan') {
    $binding = $validation.binding
    if ($null -eq $binding) {
        throw 'KAN-230 validation did not return an exact record binding.'
    }

    $steps = if ($Mode -eq 'authorization') {
        @(
            'Obtain separate authorization for one non-exportable ACM-integrated public certificate request.',
            'Create only the ACM DNS-validation record in the approved existing authoritative zone.',
            'Capture issued-certificate and domain-validation evidence; do not publish application DNS.'
        )
    }
    else {
        @(
            'Confirm the exact KAN-34 load-balancer ARN, DNS name, canonical hosted-zone ID, and healthy targets.',
            'Reconfirm the prior DNS value, TTL, cutover window, approvers, and rollback deadline.',
            'After separate authorization, change only the approved application hostname record and execute the evidence runbook.'
        )
    }

    $plan = [ordered]@{
        schemaVersion = 1
        ticket = 'KAN-230'
        kind = 'LOCAL_ONLY_NON_EXECUTABLE_PLAN'
        stage = $Mode
        generatedAtUtc = [DateTime]::UtcNow.ToString('o')
        recordSha256 = [string] $validation.canonicalSha256
        configurationSha256 = [string] $validation.configurationSha256
        recordId = [string] $binding.recordId
        accountId = [string] $binding.accountId
        region = [string] $binding.region
        applicationHostname = [string] $binding.applicationHostname
        certificateMode = [string] $binding.certificateMode
        dnsZoneMode = [string] $binding.dnsZoneMode
        executionAllowed = $false
        externalCallsMade = 0
        resourcesCreated = 0
        prohibitions = @(
            'NO_AWS_CALLS',
            'NO_DNS_QUERIES',
            'NO_TLS_CONNECTIONS',
            'NO_PROVIDER_CALLS',
            'NO_DOMAIN_REGISTRATION',
            'NO_HOSTED_ZONE_CREATION',
            'NO_EXPORTABLE_OR_PRIVATE_CERTIFICATES',
            'NO_PAID_MONITORING'
        )
        separatelyAuthorizedFutureSteps = $steps
    }

    $outputParent = Split-Path -Parent $OutputFile
    if (-not [string]::IsNullOrWhiteSpace($outputParent) -and -not (Test-Path -LiteralPath $outputParent -PathType Container)) {
        throw 'RenderPlan output directory must already exist.'
    }
    $planJson = $plan | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText(
        [System.IO.Path]::GetFullPath($OutputFile),
        $planJson,
        (New-Object System.Text.UTF8Encoding($false))
    )
    Write-Host "Wrote non-executable local plan: $OutputFile"
}

Write-Host 'AWS API calls made: 0'
Write-Host 'DNS queries made: 0'
Write-Host 'TLS connections made: 0'
Write-Host 'Provider API calls made: 0'
Write-Host 'Resources or paid services activated: 0'
