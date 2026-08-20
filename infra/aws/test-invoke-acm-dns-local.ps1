[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $PSCommandPath
$repositoryRoot = Resolve-Path (Join-Path $scriptDirectory '..\..')
$entrypoint = Join-Path $scriptDirectory 'invoke-acm-dns-local.ps1'
$validator = Join-Path $scriptDirectory 'validate-acm-dns-control-record.mjs'
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "kan-230-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

$passed = 0
$failed = 0

function Invoke-Test {
    param(
        [string]$Name,
        [scriptblock]$Body
    )
    try {
        & $Body
        $script:passed += 1
        Write-Host "PASS: $Name"
    }
    catch {
        $script:failed += 1
        Write-Host "FAIL: $Name`n$($_.Exception.Message)"
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Write-JsonFile {
    param([string]$Path, [object]$Value)
    [System.IO.File]::WriteAllText(
        [System.IO.Path]::GetFullPath($Path),
        ($Value | ConvertTo-Json -Depth 12),
        (New-Object System.Text.UTF8Encoding($false))
    )
}

function New-AuthorizationRecord {
    $record = Get-Content -Raw (Join-Path $scriptDirectory 'acm-dns-control-record.example.json') | ConvertFrom-Json
    $record.status = 'APPROVED'
    $record.recordId = 'jira:KAN-230/acm-dns-v1'
    $record.approvedAt = '2026-08-19T12:00:00Z'
    $record.expiresAt = '2027-08-19T12:00:00Z'
    $record.aws.accountId = '123456789012'
    $record.aws.region = 'us-west-2'
    $record.aws.approvedRoleArn = 'arn:aws:iam::123456789012:role/crypto-lending-deployer'
    $record.hostname.applicationHostname = 'app.staging.example.com'
    $record.hostname.parentDomain = 'example.com'
    $record.hostname.dnsProvider = 'provider:existing-authoritative-dns'
    $record.hostname.dnsZoneMode = 'EXISTING_EXTERNAL'
    $record.hostname.existingZoneReference = 'dns-zone:example-com-existing'
    $record.hostname.ownershipReference = 'evidence:domain-ownership-2026-08'
    $record.certificate.mode = 'ACM_INTEGRATED_NON_EXPORTABLE'
    $record.certificate.validationMethod = 'DNS'
    $record.certificate.renewalOwner = 'platform-operations'
    $record.certificate.renewalMethod = 'AWS_MANAGED'
    $record.certificate.renewalWindowDays = '45'
    $record.dnsChange.recordType = 'CNAME'
    $record.dnsChange.ttlSeconds = '300'
    $record.costBoundary.decision = 'NO_ADDITIONAL_CHARGE_CONFIRMED'
    $record.costBoundary.estimatedMonthlyIncrementUsd = '0.00'
    $record.costBoundary.pricingAsOf = '2026-08-19'
    $record.costBoundary.pricingExpiresAt = '2027-08-19'
    $record.costBoundary.pricingSourceReference = 'aws-pricing:acm-integrated-and-existing-dns'
    $record.authority.certificateRequestApprovers = @('release-approver')
    $record.authority.dnsChangeApprovers = @('dns-change-approver')
    $record.authority.cutoverApprovers = @('release-approver', 'dns-change-approver')
    $record.authority.rollbackApprovers = @('incident-commander')
    $record.independentVerification.verifier = 'external-security-reviewer'
    $record.independentVerification.decision = 'APPROVED'
    $record.independentVerification.verifiedAt = '2026-08-19T13:00:00Z'
    return $record
}

try {
    Invoke-Test 'default LocalValidate makes no external call' {
        $output = & $entrypoint *>&1
        Assert-True ($LASTEXITCODE -eq 0) 'Default LocalValidate failed.'
        Assert-True (($output -join "`n") -match 'AWS API calls made: 0') 'AWS zero-call marker missing.'
        Assert-True (($output -join "`n") -match 'DNS queries made: 0') 'DNS zero-call marker missing.'
        Assert-True (($output -join "`n") -match 'Resources or paid services activated: 0') 'Activation marker missing.'
    }

    Invoke-Test 'renders an inert authorization plan from an ignored operational record' {
        $recordPath = Join-Path $temporaryDirectory 'approved.acm-dns.local.json'
        $planPath = Join-Path $temporaryDirectory 'authorization.acm-dns-plan.local.json'
        Write-JsonFile -Path $recordPath -Value (New-AuthorizationRecord)
        & $entrypoint -Action RenderPlan -Mode authorization -RecordFile $recordPath -ExpectedAccount 123456789012 -ExpectedRegion us-west-2 -OutputFile $planPath | Out-Null
        Assert-True ($LASTEXITCODE -eq 0) 'RenderPlan failed.'
        $plan = Get-Content -Raw $planPath | ConvertFrom-Json
        $validation = (& node $validator --record $recordPath --mode authorization --json | Out-String) | ConvertFrom-Json
        Assert-True ($plan.executionAllowed -eq $false) 'Rendered plan must not be executable.'
        Assert-True ($plan.externalCallsMade -eq 0) 'Rendered plan claimed external calls.'
        Assert-True ($plan.resourcesCreated -eq 0) 'Rendered plan claimed resource creation.'
        Assert-True ($plan.recordSha256 -ceq $validation.canonicalSha256) 'Plan is not bound to the canonical record hash.'
        Assert-True ($plan.configurationSha256 -ceq $validation.configurationSha256) 'Plan is not bound to the configuration hash.'

        $threw = $false
        try {
            & $entrypoint -Action RenderPlan -Mode authorization -RecordFile $recordPath -ExpectedAccount 123456789012 -ExpectedRegion us-west-2 -OutputFile $planPath | Out-Null
        }
        catch { $threw = $true }
        Assert-True $threw 'RenderPlan unexpectedly overwrote an existing audit artifact.'
    }

    Invoke-Test 'refuses to render the committed placeholder example' {
        $planPath = Join-Path $temporaryDirectory 'bad.acm-dns-plan.local.json'
        $threw = $false
        try {
            & $entrypoint -Action RenderPlan -Mode authorization -ExpectedAccount 123456789012 -ExpectedRegion us-west-2 -OutputFile $planPath | Out-Null
        }
        catch { $threw = $true }
        Assert-True $threw 'Placeholder example unexpectedly rendered.'
        Assert-True (-not (Test-Path $planPath)) 'A plan was written from the placeholder example.'
    }

    Invoke-Test 'refuses an executable-looking output name' {
        $recordPath = Join-Path $temporaryDirectory 'approved.acm-dns.local.json'
        Write-JsonFile -Path $recordPath -Value (New-AuthorizationRecord)
        $threw = $false
        try {
            & $entrypoint -Action RenderPlan -Mode authorization -RecordFile $recordPath -ExpectedAccount 123456789012 -ExpectedRegion us-west-2 -OutputFile (Join-Path $temporaryDirectory 'apply.json') | Out-Null
        }
        catch { $threw = $true }
        Assert-True $threw 'Unsafe output suffix unexpectedly passed.'
    }

    Invoke-Test 'source exposes no cloud, DNS, TLS, or provider execution action' {
        $source = Get-Content -Raw $entrypoint
        foreach ($forbidden in @(
            'Get-Command aws',
            'Resolve-DnsName',
            'Invoke-WebRequest',
            'Invoke-RestMethod',
            'request-certificate',
            'change-resource-record-sets',
            'New-Object Net.Sockets',
            'TcpClient'
        )) {
            Assert-True (-not $source.Contains($forbidden)) "Forbidden execution surface found: $forbidden"
        }
    }
}
finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
        $resolvedTemporaryDirectory = [System.IO.Path]::GetFullPath($temporaryDirectory)
        $resolvedTemporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        $leaf = Split-Path -Leaf $resolvedTemporaryDirectory
        if (
            -not $resolvedTemporaryDirectory.StartsWith($resolvedTemporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
            -not $leaf.StartsWith('kan-230-', [System.StringComparison]::Ordinal)
        ) {
            throw 'Refusing to remove an unexpected temporary directory.'
        }
        Remove-Item -LiteralPath $resolvedTemporaryDirectory -Recurse -Force
    }
}

Write-Host "$passed passed, $failed failed"
if ($failed -gt 0) { exit 1 }
