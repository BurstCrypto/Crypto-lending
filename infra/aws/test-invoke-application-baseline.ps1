[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$guardPath = Join-Path $PSScriptRoot 'invoke-application-baseline.ps1'
$applicationTemplatePath = Join-Path $PSScriptRoot 'application-baseline.yaml'
$workloadBoundariesTemplatePath = Join-Path $PSScriptRoot 'application-workload-boundaries.yaml'
$observabilityTemplatePath = Join-Path $PSScriptRoot 'application-observability.yaml'
$guardrailTemplatePath = Join-Path $PSScriptRoot 'account-guardrails.yaml'
$recordValidatorPath = Join-Path $PSScriptRoot 'validate-billing-control-record.mjs'
$acmDnsRecordValidatorPath = Join-Path $PSScriptRoot 'validate-acm-dns-control-record.mjs'
$fixedSlotCredentialTransitionValidatorPath = Join-Path $PSScriptRoot 'validate-fixed-slot-credential-transition.mjs'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("kan34-application-guard-test-" + [guid]::NewGuid().ToString('N'))
$fakeAwsDirectory = Join-Path $temporaryRoot 'fake-aws'
$markerPath = Join-Path $temporaryRoot 'aws-calls.log'
$identityResponsePath = Join-Path $temporaryRoot 'identity.json'
$guardrailStackResponsePath = Join-Path $temporaryRoot 'guardrail-stack.json'
$applicationStackResponsePath = Join-Path $temporaryRoot 'application-stack.json'
$applicationStackResponseAfterFirstPath = Join-Path $temporaryRoot 'application-stack-after-first.json'
$guardrailTemplateResponsePath = Join-Path $temporaryRoot 'guardrail-template.json'
$changeSetResponsePath = Join-Path $temporaryRoot 'change-set.json'
$applicationTemplateResponsePath = Join-Path $temporaryRoot 'application-template.json'
$bucketLocationResponsePath = Join-Path $temporaryRoot 'bucket-location.json'
$bucketVersioningResponsePath = Join-Path $temporaryRoot 'bucket-versioning.json'
$artifactObjectResponsePath = Join-Path $temporaryRoot 'artifact-object.json'
$artifactObjectSourcePath = Join-Path $temporaryRoot 'artifact-object.yaml'
$observabilityArtifactObjectSourcePath = Join-Path $temporaryRoot 'observability-artifact-object.yaml'
$managedPrefixListResponsePath = Join-Path $temporaryRoot 'managed-prefix-list.json'
$mismatchedChildTemplatePath = Join-Path $temporaryRoot 'mismatched-child-template.yaml'
$approvedRecordPath = Join-Path $temporaryRoot 'approved-billing-control-record.json'
$incompleteRecordPath = Join-Path $temporaryRoot 'incomplete-billing-control-record.json'
$approvedAcmDnsRecordPath = Join-Path $temporaryRoot 'approved-acm-dns-bootstrap-record.json'
$mismatchedAcmDnsRecordPath = Join-Path $temporaryRoot 'mismatched-acm-dns-bootstrap-record.json'
$incompleteAcmDnsRecordPath = Join-Path $temporaryRoot 'incomplete-acm-dns-bootstrap-record.json'
$localTransitionDirectory = [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $PSScriptRoot) '..\.local-validation'))
$approvedTransitionRecordPath = Join-Path $localTransitionDirectory ("invoke-application-$([guid]::NewGuid().ToString('N')).credential-transition.local.json")
$approvedRotationRecordPath = Join-Path $localTransitionDirectory ("invoke-application-$([guid]::NewGuid().ToString('N')).credential-transition.local.json")
$immutableChangeSetId = 'arn:aws:cloudformation:us-west-2:111122223333:changeSet/kan34-application-20260819/11111111-2222-3333-4444-555555555555'
$immutableStackId = 'arn:aws:cloudformation:us-west-2:111122223333:stack/crypto-lending-application-test/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
$originalEnvironment = @{
    PATH = $env:PATH
    FAKE_AWS_MARKER = $env:FAKE_AWS_MARKER
    FAKE_AWS_IDENTITY_RESPONSE = $env:FAKE_AWS_IDENTITY_RESPONSE
    FAKE_AWS_GUARDRAIL_STACK_RESPONSE = $env:FAKE_AWS_GUARDRAIL_STACK_RESPONSE
    FAKE_AWS_APPLICATION_STACK_RESPONSE = $env:FAKE_AWS_APPLICATION_STACK_RESPONSE
    FAKE_AWS_APPLICATION_STACK_RESPONSE_AFTER_FIRST = $env:FAKE_AWS_APPLICATION_STACK_RESPONSE_AFTER_FIRST
    FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE = $env:FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE
    FAKE_AWS_CHANGE_SET_RESPONSE = $env:FAKE_AWS_CHANGE_SET_RESPONSE
    FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE = $env:FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE
    FAKE_AWS_BUCKET_LOCATION_RESPONSE = $env:FAKE_AWS_BUCKET_LOCATION_RESPONSE
    FAKE_AWS_BUCKET_VERSIONING_RESPONSE = $env:FAKE_AWS_BUCKET_VERSIONING_RESPONSE
    FAKE_AWS_ARTIFACT_OBJECT_RESPONSE = $env:FAKE_AWS_ARTIFACT_OBJECT_RESPONSE
    FAKE_AWS_ARTIFACT_OBJECT_SOURCE = $env:FAKE_AWS_ARTIFACT_OBJECT_SOURCE
    FAKE_AWS_OBSERVABILITY_ARTIFACT_OBJECT_SOURCE = $env:FAKE_AWS_OBSERVABILITY_ARTIFACT_OBJECT_SOURCE
    FAKE_AWS_MANAGED_PREFIX_LIST_RESPONSE = $env:FAKE_AWS_MANAGED_PREFIX_LIST_RESPONSE
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

function Write-ManagedPrefixListResponse {
    param(
        [string] $PrefixListId = 'pl-12345678',
        [string] $PrefixListName = 'com.amazonaws.us-west-2.s3',
        [string] $OwnerId = 'AWS',
        [string] $State = 'create-complete',
        [string] $AddressFamily = 'IPv4'
    )

    Write-JsonFile -Path $managedPrefixListResponsePath -Value ([ordered]@{
            PrefixLists = @(
                [ordered]@{
                    PrefixListId = $PrefixListId
                    PrefixListName = $PrefixListName
                    OwnerId = $OwnerId
                    State = $State
                    AddressFamily = $AddressFamily
                }
            )
        }) -Depth 5
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
    param(
        [System.Collections.IDictionary] $ParameterMap,
        [System.Collections.IDictionary] $TagMap,
        [string] $Description,
        [ValidateSet('CREATE', 'UPDATE')]
        [string] $ChangeSetType = 'CREATE',
        [string] $UsePreviousParameter,
        [bool] $IncludeNestedStacks = $true,
        [string[]] $Capabilities = @('CAPABILITY_IAM')
    )

    if ($null -eq $ParameterMap) {
        $ParameterMap = $applicationParameterMap
    }
    if ($null -eq $TagMap) {
        $TagMap = $applicationStackTags
    }
    if ([string]::IsNullOrEmpty($Description)) {
        $Description = $expectedChangeSetDescription
    }
    $parameters = @($ParameterMap.GetEnumerator() | ForEach-Object {
            [ordered]@{
                ParameterKey = [string] $_.Key
                ParameterValue = [string] $_.Value
                UsePreviousValue = ([string] $_.Key -ceq $UsePreviousParameter)
            }
        })
    $tags = @($TagMap.GetEnumerator() | ForEach-Object {
            [ordered]@{ Key = [string] $_.Key; Value = [string] $_.Value }
        })
    Write-JsonFile -Path $changeSetResponsePath -Value ([ordered]@{
            StackName = 'crypto-lending-application-test'
            ChangeSetName = 'kan34-application-20260819'
            ChangeSetId = $immutableChangeSetId
            StackId = $immutableStackId
            RootChangeSetId = $immutableChangeSetId
            ChangeSetType = $ChangeSetType
            IncludeNestedStacks = $IncludeNestedStacks
            Status = 'CREATE_COMPLETE'
            ExecutionStatus = 'AVAILABLE'
            Description = $Description
            Parameters = $parameters
            Tags = $tags
            Capabilities = $Capabilities
            Changes = @()
    })
}

function New-FixedSlotScopeState {
    param(
        [string] $SlotAVersionId,
        [string] $SlotBVersionId,
        [int] $Generation
    )

    [string[]] $slotAHistory = @()
    [string[]] $slotBHistory = @()
    if ($Generation -ne 0) {
        $slotAHistory = @($SlotAVersionId)
        $slotBHistory = @($SlotBVersionId)
    }
    return [ordered]@{
        phase = 'A_ONLY'
        slots = [ordered]@{
            a = [ordered]@{
                generation = $Generation
                currentVersionId = $SlotAVersionId
                usedVersionIds = $slotAHistory
            }
            b = [ordered]@{
                generation = $Generation
                currentVersionId = $SlotBVersionId
                usedVersionIds = $slotBHistory
            }
        }
        preparation = $null
        overlap = $null
    }
}

function New-FixedSlotState {
    param(
        [System.Collections.IDictionary] $Versions,
        [int] $Generation
    )

    return [ordered]@{
        operatorMode = 'DISABLED'
        apiDatabase = New-FixedSlotScopeState -SlotAVersionId ([string] $Versions.ApiDatabaseSlotAVersionId) -SlotBVersionId ([string] $Versions.ApiDatabaseSlotBVersionId) -Generation $Generation
        workerDatabase = New-FixedSlotScopeState -SlotAVersionId ([string] $Versions.WorkerDatabaseSlotAVersionId) -SlotBVersionId ([string] $Versions.WorkerDatabaseSlotBVersionId) -Generation $Generation
        redis = New-FixedSlotScopeState -SlotAVersionId ([string] $Versions.RedisApiSlotAVersionId) -SlotBVersionId ([string] $Versions.RedisApiSlotBVersionId) -Generation $Generation
    }
}

function New-AdoptionTransitionRecord {
    param(
        [System.Collections.IDictionary] $PinnedVersions,
        [string] $ParentTemplateSha256,
        [string] $WorkloadTemplateSha256,
        [DateTime] $Now
    )

    $unpinnedVersions = [ordered]@{
        ApiDatabaseSlotAVersionId = 'UNPINNED'
        ApiDatabaseSlotBVersionId = 'UNPINNED'
        WorkerDatabaseSlotAVersionId = 'UNPINNED'
        WorkerDatabaseSlotBVersionId = 'UNPINNED'
        RedisApiSlotAVersionId = 'UNPINNED'
        RedisApiSlotBVersionId = 'UNPINNED'
    }
    return [ordered]@{
        schemaVersion = 1
        status = 'APPROVED'
        recordId = 'rotation:adopt-and-pin:focused-test'
        preparedAt = $Now.AddMinutes(-2).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
        expiresAt = $Now.AddHours(1).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
        deployment = [ordered]@{
            accountId = '111122223333'
            region = 'us-west-2'
            stackName = 'crypto-lending-application-test'
            stackId = $immutableStackId
            environmentName = 'test-kan34'
            parentTemplateSha256 = $ParentTemplateSha256
            workloadTemplateSha256 = $WorkloadTemplateSha256
        }
        predecessor = [ordered]@{
            stateSha256 = 'UNTRACKED'
            transitionSha256 = 'NONE'
        }
        currentState = New-FixedSlotState -Versions $unpinnedVersions -Generation 0
        targetState = New-FixedSlotState -Versions $PinnedVersions -Generation 1
        authority = [ordered]@{
            secretRegenerationApprovers = @('security:secret-approver')
            backendInstallApprovers = @('database:install-approver')
            phaseChangeApprovers = @('release:phase-approver')
            rollbackApprovers = @('operations:rollback-approver')
            independentVerifier = 'audit:independent-verifier'
            decision = 'APPROVED'
            verifiedAt = $Now.AddMinutes(-1).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
        }
        evidence = [ordered]@{
            currentStateCaptureSha256 = ('1' * 64)
            secretRegenerationSha256 = 'NOT_APPLICABLE'
            backendInstallationSha256 = ('2' * 64)
            candidateVerificationSha256 = ('3' * 64)
            activeContinuitySha256 = ('4' * 64)
            replacementReadinessSha256 = 'NOT_APPLICABLE'
            retirementDrainSha256 = 'NOT_APPLICABLE'
            retirementRevocationSha256 = 'NOT_APPLICABLE'
            retirementSessionDenialSha256 = 'NOT_APPLICABLE'
            rollbackPlanSha256 = ('5' * 64)
        }
    }
}

function New-PreparationTransitionRecord {
    param(
        [System.Collections.IDictionary] $PinnedVersions,
        [string] $TargetApiDatabaseSlotBVersionId,
        [string] $ParentTemplateSha256,
        [string] $WorkloadTemplateSha256,
        [string] $PredecessorStateSha256,
        [string] $PredecessorTransitionSha256,
        [DateTime] $Now
    )

    $currentState = New-FixedSlotState -Versions $PinnedVersions -Generation 1
    $targetState = ($currentState | ConvertTo-Json -Depth 14) | ConvertFrom-Json
    $targetState.apiDatabase.slots.b.generation = 2
    $targetState.apiDatabase.slots.b.currentVersionId = $TargetApiDatabaseSlotBVersionId
    $targetState.apiDatabase.slots.b.usedVersionIds = @(
        [string] $PinnedVersions.ApiDatabaseSlotBVersionId
        $TargetApiDatabaseSlotBVersionId
    )
    $secretRegenerationSha256 = ('6' * 64)
    $backendInstallationSha256 = ('7' * 64)
    $targetState.apiDatabase.preparation = [ordered]@{
        slot = 'b'
        preparedAt = $Now.AddMinutes(-2).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
        expiresAt = $Now.AddHours(1).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
        secretVersionEvidenceSha256 = $secretRegenerationSha256
        backendInstallEvidenceSha256 = $backendInstallationSha256
    }
    return [ordered]@{
        schemaVersion = 1
        status = 'APPROVED'
        recordId = 'rotation:prepare-inactive:api-database:focused-test'
        preparedAt = $Now.AddMinutes(-2).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
        expiresAt = $Now.AddHours(1).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
        deployment = [ordered]@{
            accountId = '111122223333'
            region = 'us-west-2'
            stackName = 'crypto-lending-application-test'
            stackId = $immutableStackId
            environmentName = 'test-kan34'
            parentTemplateSha256 = $ParentTemplateSha256
            workloadTemplateSha256 = $WorkloadTemplateSha256
        }
        predecessor = [ordered]@{
            stateSha256 = $PredecessorStateSha256
            transitionSha256 = $PredecessorTransitionSha256
        }
        currentState = $currentState
        targetState = $targetState
        authority = [ordered]@{
            secretRegenerationApprovers = @('security:secret-approver')
            backendInstallApprovers = @('database:install-approver')
            phaseChangeApprovers = @('release:phase-approver')
            rollbackApprovers = @('operations:rollback-approver')
            independentVerifier = 'audit:independent-verifier'
            decision = 'APPROVED'
            verifiedAt = $Now.AddMinutes(-1).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
        }
        evidence = [ordered]@{
            currentStateCaptureSha256 = ('8' * 64)
            secretRegenerationSha256 = $secretRegenerationSha256
            backendInstallationSha256 = $backendInstallationSha256
            candidateVerificationSha256 = ('9' * 64)
            activeContinuitySha256 = ('a' * 64)
            replacementReadinessSha256 = 'NOT_APPLICABLE'
            retirementDrainSha256 = 'NOT_APPLICABLE'
            retirementRevocationSha256 = 'NOT_APPLICABLE'
            retirementSessionDenialSha256 = 'NOT_APPLICABLE'
            rollbackPlanSha256 = ('b' * 64)
        }
    }
}

function Write-ApplicationStackResponse {
    param(
        [System.Collections.IDictionary] $ParameterMap,
        [System.Collections.IDictionary] $TagMap,
        [string] $Path = $applicationStackResponsePath
    )

    $parameters = @($ParameterMap.GetEnumerator() | ForEach-Object {
            [ordered]@{ ParameterKey = [string] $_.Key; ParameterValue = [string] $_.Value }
        })
    $tags = @($TagMap.GetEnumerator() | ForEach-Object {
            [ordered]@{ Key = [string] $_.Key; Value = [string] $_.Value }
        })
    Write-JsonFile -Path $Path -Value ([ordered]@{
            Stacks = @(
                [ordered]@{
                    StackName = 'crypto-lending-application-test'
                    StackId = $immutableStackId
                    StackStatus = 'UPDATE_COMPLETE'
                    Parameters = $parameters
                    Tags = $tags
                }
            )
        }) -Depth 7
}

if (-not (Test-Path -LiteralPath $guardPath -PathType Leaf)) {
    throw "Application guard under test was not found: $guardPath"
}
foreach ($requiredFile in @($applicationTemplatePath, $workloadBoundariesTemplatePath, $observabilityTemplatePath, $guardrailTemplatePath, $recordValidatorPath, $acmDnsRecordValidatorPath, $fixedSlotCredentialTransitionValidatorPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required focused-test input was not found: $requiredFile"
    }
}

New-Item -ItemType Directory -Path $fakeAwsDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $localTransitionDirectory -Force | Out-Null
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
    $stackNameIndex = [array]::IndexOf($AwsArguments, '--stack-name')
    $requestedStack = if ($stackNameIndex -ge 0) { $AwsArguments[$stackNameIndex + 1] } else { '' }
    if (
        $requestedStack -eq 'crypto-lending-application-test' -or
        $requestedStack -like '*:stack/crypto-lending-application-test/*'
    ) {
        $applicationDescribeCount = @(
            Get-Content -LiteralPath $env:FAKE_AWS_MARKER | Where-Object {
                $_ -match 'cloudformation describe-stacks --stack-name .*:stack/crypto-lending-application-test/'
            }
        ).Count
        $afterFirstResponse = [Environment]::GetEnvironmentVariable('FAKE_AWS_APPLICATION_STACK_RESPONSE_AFTER_FIRST')
        if (
            $applicationDescribeCount -gt 1 -and
            -not [string]::IsNullOrWhiteSpace($afterFirstResponse) -and
            (Test-Path -LiteralPath $afterFirstResponse -PathType Leaf)
        ) {
            Write-ResponseFile -Path $afterFirstResponse
        }
        Write-ResponseFile -Path $env:FAKE_AWS_APPLICATION_STACK_RESPONSE
    }
    Write-ResponseFile -Path $env:FAKE_AWS_GUARDRAIL_STACK_RESPONSE
}
if ($service -eq 's3api' -and $operation -eq 'get-bucket-location') {
    Write-ResponseFile -Path $env:FAKE_AWS_BUCKET_LOCATION_RESPONSE
}
if ($service -eq 's3api' -and $operation -eq 'get-bucket-versioning') {
    Write-ResponseFile -Path $env:FAKE_AWS_BUCKET_VERSIONING_RESPONSE
}
if ($service -eq 's3api' -and $operation -eq 'get-object') {
    $destination = $AwsArguments[-1]
    $keyIndex = [array]::IndexOf($AwsArguments, '--key')
    $source = if ($keyIndex -ge 0 -and $AwsArguments[$keyIndex + 1] -like 'application-observability-*') {
        $env:FAKE_AWS_OBSERVABILITY_ARTIFACT_OBJECT_SOURCE
    }
    else {
        $env:FAKE_AWS_ARTIFACT_OBJECT_SOURCE
    }
    [System.IO.File]::Copy($source, $destination, $true)
    Write-ResponseFile -Path $env:FAKE_AWS_ARTIFACT_OBJECT_RESPONSE
}
if ($service -eq 'ec2' -and $operation -eq 'describe-managed-prefix-lists') {
    Write-ResponseFile -Path $env:FAKE_AWS_MANAGED_PREFIX_LIST_RESPONSE
}
if ($service -eq 'cloudformation' -and $operation -eq 'create-change-set') {
    [Console]::Out.Write('{"Id":"arn:aws:cloudformation:us-west-2:111122223333:changeSet/kan34-application-20260819/11111111-2222-3333-4444-555555555555","StackId":"arn:aws:cloudformation:us-west-2:111122223333:stack/crypto-lending-application-test/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}')
    exit 0
}
if ($service -eq 'cloudformation' -and $operation -eq 'get-template') {
    $stackNameIndex = [array]::IndexOf($AwsArguments, '--stack-name')
    $requestedStack = if ($stackNameIndex -ge 0) { $AwsArguments[$stackNameIndex + 1] } else { '' }
    if (
        $AwsArguments -contains '--change-set-name' -or
        $requestedStack -eq 'crypto-lending-application-test' -or
        $requestedStack -like '*:stack/crypto-lending-application-test/*'
    ) {
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
$env:FAKE_AWS_APPLICATION_STACK_RESPONSE = $applicationStackResponsePath
$env:FAKE_AWS_APPLICATION_STACK_RESPONSE_AFTER_FIRST = ''
$env:FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE = $guardrailTemplateResponsePath
$env:FAKE_AWS_CHANGE_SET_RESPONSE = $changeSetResponsePath
$env:FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE = $applicationTemplateResponsePath
$env:FAKE_AWS_BUCKET_LOCATION_RESPONSE = $bucketLocationResponsePath
$env:FAKE_AWS_BUCKET_VERSIONING_RESPONSE = $bucketVersioningResponsePath
$env:FAKE_AWS_ARTIFACT_OBJECT_RESPONSE = $artifactObjectResponsePath
$env:FAKE_AWS_ARTIFACT_OBJECT_SOURCE = $artifactObjectSourcePath
$env:FAKE_AWS_OBSERVABILITY_ARTIFACT_OBJECT_SOURCE = $observabilityArtifactObjectSourcePath
$env:FAKE_AWS_MANAGED_PREFIX_LIST_RESPONSE = $managedPrefixListResponsePath

Write-JsonFile -Path $bucketLocationResponsePath -Value ([ordered]@{ LocationConstraint = 'us-west-2' }) -Depth 3
Write-JsonFile -Path $bucketVersioningResponsePath -Value ([ordered]@{ Status = 'Enabled' }) -Depth 3
Write-ManagedPrefixListResponse

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
$workloadBoundariesTemplateBody = Get-Content -LiteralPath $workloadBoundariesTemplatePath -Raw
$observabilityTemplateBody = Get-Content -LiteralPath $observabilityTemplatePath -Raw
$guardrailTemplateBody = Get-Content -LiteralPath $guardrailTemplatePath -Raw
$applicationTemplateSha256 = (Get-FileHash -LiteralPath $applicationTemplatePath -Algorithm SHA256).Hash.ToLowerInvariant()
$workloadBoundariesTemplateSha256 = (Get-FileHash -LiteralPath $workloadBoundariesTemplatePath -Algorithm SHA256).Hash.ToLowerInvariant()
$observabilityTemplateSha256 = (Get-FileHash -LiteralPath $observabilityTemplatePath -Algorithm SHA256).Hash.ToLowerInvariant()
$guardrailTemplateSha256 = (Get-FileHash -LiteralPath $guardrailTemplatePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ((Get-TextSha256 -Value $applicationTemplateBody) -cne $applicationTemplateSha256) {
    throw 'Focused test requires application template text and file SHA-256 values to be identical.'
}
if ((Get-TextSha256 -Value $guardrailTemplateBody) -cne $guardrailTemplateSha256) {
    throw 'Focused test requires guardrail template text and file SHA-256 values to be identical.'
}
[System.IO.File]::WriteAllBytes(
    $artifactObjectSourcePath,
    [System.IO.File]::ReadAllBytes($workloadBoundariesTemplatePath)
)
[System.IO.File]::WriteAllBytes(
    $observabilityArtifactObjectSourcePath,
    [System.IO.File]::ReadAllBytes($observabilityTemplatePath)
)
$artifactVersionId = 'version+/with=padding'
$artifactBucket = 'crypto-lending-artifacts-111122223333'
$artifactKey = "application-workload-boundaries-$workloadBoundariesTemplateSha256.yaml"
$artifactBindingText = "bucket=$artifactBucket`nkey=$artifactKey`nversion-id=$artifactVersionId"
$artifactBindingSha256 = Get-TextSha256 -Value $artifactBindingText
$encodedArtifactVersionId = [System.Uri]::EscapeDataString($artifactVersionId)
$artifactTemplateUrl = "https://$artifactBucket.s3.us-west-2.amazonaws.com/$artifactKey`?versionId=$encodedArtifactVersionId"
$observabilityArtifactKey = "application-observability-$observabilityTemplateSha256.yaml"
$observabilityArtifactBindingText = "bucket=$artifactBucket`nkey=$observabilityArtifactKey`nversion-id=$artifactVersionId"
$observabilityArtifactBindingSha256 = Get-TextSha256 -Value $observabilityArtifactBindingText
$observabilityTemplateUrl = "https://$artifactBucket.s3.us-west-2.amazonaws.com/$observabilityArtifactKey`?versionId=$encodedArtifactVersionId"
$incorrectEncodedVersionBinding = Get-TextSha256 -Value "bucket=$artifactBucket`nkey=$artifactKey`nversion-id=$encodedArtifactVersionId"
if ($artifactBindingSha256 -ceq $incorrectEncodedVersionBinding -or $artifactTemplateUrl -notmatch 'versionId=version%2B%2Fwith%3Dpadding$') {
    throw 'Focused test requires raw VersionId binding and an independently URL-escaped TemplateURL fixture.'
}
Write-JsonFile -Path $artifactObjectResponsePath -Value ([ordered]@{ VersionId = $artifactVersionId }) -Depth 3

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
$operationalAlarmTopicArn = 'arn:aws:sns:us-west-2:111122223333:crypto-lending-test-kan34-operations'
$applicationParameterMap = [ordered]@{
    EnvironmentName = 'test-kan34'
    WorkloadBoundariesTemplateUrl = $artifactTemplateUrl
    WorkloadBoundariesTemplateSha256 = $workloadBoundariesTemplateSha256
    WorkloadBoundariesArtifactBindingSha256 = $artifactBindingSha256
    ObservabilityTemplateUrl = $observabilityTemplateUrl
    ObservabilityTemplateSha256 = $observabilityTemplateSha256
    ObservabilityArtifactBindingSha256 = $observabilityArtifactBindingSha256
    ApiDatabaseSlotAVersionId = 'UNPINNED'
    ApiDatabaseSlotBVersionId = 'UNPINNED'
    WorkerDatabaseSlotAVersionId = 'UNPINNED'
    WorkerDatabaseSlotBVersionId = 'UNPINNED'
    RedisApiSlotAVersionId = 'UNPINNED'
    RedisApiSlotBVersionId = 'UNPINNED'
    BillingAcknowledgement = 'I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES'
    ApplicationVersion = ('a' * 40)
    ApiImageUri = $imagePrefix + 'crypto-lending-api@sha256:' + ('b' * 64)
    WebImageUri = $imagePrefix + 'crypto-lending-web@sha256:' + ('c' * 64)
    S3ManagedPrefixListId = 'pl-12345678'
    AllowedIngressIpv4Cidr = '203.0.113.10/32'
    AlbCertificateArn = 'arn:aws:acm:us-west-2:111122223333:certificate/11111111-2222-3333-4444-555555555555'
    ApplicationHostname = 'test.crypto-lending.invalid'
    CognitoPoolId = 'us-west-2_TestPool123'
    CognitoLoginHostname = 'login.test.crypto-lending.invalid'
    CognitoClientId = '1exampleclientid'
    AuthWalletKeysSecretArn = 'arn:aws:secretsmanager:us-west-2:111122223333:secret:crypto-lending/test/auth-wallet-keys-AbCdEf'
    AuthWalletKeysKmsKeyArn = 'arn:aws:kms:us-west-2:111122223333:key/11111111-2222-3333-4444-555555555555'
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
    ApiDatabaseCredentialPhase = 'A_ONLY'
    WorkerDatabaseCredentialPhase = 'A_ONLY'
    RedisCredentialPhase = 'A_ONLY'
    RedisOperatorMode = 'DISABLED'
    StatefulBackupRetentionDays = '1'
    SqsMaxReceiveCount = '3'
    SqsVisibilityTimeoutSeconds = '30'
    LogRetentionDays = '14'
    EnableOperationalAlarms = 'true'
    AlarmTopicArn = $operationalAlarmTopicArn
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
    'workload-boundaries-sha256' = $workloadBoundariesTemplateSha256
    'workload-boundaries-binding-sha256' = $artifactBindingSha256
    'observability-sha256' = $observabilityTemplateSha256
    'observability-binding-sha256' = $observabilityArtifactBindingSha256
    'managed-by' = 'cloudformation'
    ticket = 'KAN-34'
}
$parameterSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $applicationParameterMap)
$tagSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $applicationStackTags)
$expectedChangeSetDescription = "KAN-34 template-sha256=$applicationTemplateSha256 workload-template-sha256=$workloadBoundariesTemplateSha256 workload-binding-sha256=$artifactBindingSha256 observability-template-sha256=$observabilityTemplateSha256 observability-binding-sha256=$observabilityArtifactBindingSha256 parameters-sha256=$parameterSha256 tags-sha256=$tagSha256 control-record-sha256=$controlRecordSha256 acm-dns-record-sha256=$acmDnsRecordSha256 guardrail-policy=kan-229-v1"
$billableAcknowledgement = "EXECUTE IMMUTABLE CHANGE SET $immutableChangeSetId FOR IMMUTABLE STACK $immutableStackId WITH PARAMETERS $parameterSha256 WORKLOAD TEMPLATE $workloadBoundariesTemplateSha256 WORKLOAD BINDING $artifactBindingSha256 OBSERVABILITY TEMPLATE $observabilityTemplateSha256 OBSERVABILITY BINDING $observabilityArtifactBindingSha256 USING BILLING CONTROL $controlRecordSha256 AND ACM DNS CONTROL $acmDnsRecordSha256; I ACKNOWLEDGE BILLABLE AWS RESOURCES IN ACCOUNT 111122223333 REGION us-west-2 USING PROFILE kan34-test"
$parameterOverrides = @(
    'BillingAcknowledgement=I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES'
    "ApplicationVersion=$('a' * 40)"
    "ApiImageUri=$($applicationParameterMap.ApiImageUri)"
    "WebImageUri=$($applicationParameterMap.WebImageUri)"
    'S3ManagedPrefixListId=pl-12345678'
    'AllowedIngressIpv4Cidr=203.0.113.10/32'
    "AlbCertificateArn=$($applicationParameterMap.AlbCertificateArn)"
    'ApplicationHostname=test.crypto-lending.invalid'
    'CognitoPoolId=us-west-2_TestPool123'
    'CognitoLoginHostname=login.test.crypto-lending.invalid'
    'CognitoClientId=1exampleclientid'
    "AuthWalletKeysSecretArn=$($applicationParameterMap.AuthWalletKeysSecretArn)"
    "AuthWalletKeysKmsKeyArn=$($applicationParameterMap.AuthWalletKeysKmsKeyArn)"
    'PostgresEngineVersion=16.4'
    "AlarmTopicArn=$operationalAlarmTopicArn"
)

$baseArguments = @{
    Action = 'Deploy'
    TemplateFile = $applicationTemplatePath
    WorkloadBoundariesTemplateFile = $workloadBoundariesTemplatePath
    ObservabilityTemplateFile = $observabilityTemplatePath
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
    WorkloadBoundariesArtifactBucket = $artifactBucket
    WorkloadBoundariesArtifactVersionId = $artifactVersionId
    ObservabilityArtifactBucket = $artifactBucket
    ObservabilityArtifactVersionId = $artifactVersionId
    ApiDatabaseSlotAVersionId = 'UNPINNED'
    ApiDatabaseSlotBVersionId = 'UNPINNED'
    WorkerDatabaseSlotAVersionId = 'UNPINNED'
    WorkerDatabaseSlotBVersionId = 'UNPINNED'
    RedisApiSlotAVersionId = 'UNPINNED'
    RedisApiSlotBVersionId = 'UNPINNED'
    ParameterOverride = $parameterOverrides
    AllowAwsApiCalls = $true
    BillableAcknowledgement = $billableAcknowledgement
}

$pinnedFixedSlotVersions = [ordered]@{
    ApiDatabaseSlotAVersionId = 'api_database_slot_a_version_00001'
    ApiDatabaseSlotBVersionId = 'api_database_slot_b_version_00001'
    WorkerDatabaseSlotAVersionId = 'worker_database_slot_a_version_01'
    WorkerDatabaseSlotBVersionId = 'worker_database_slot_b_version_01'
    RedisApiSlotAVersionId = 'redis_api_slot_a_version_00000001'
    RedisApiSlotBVersionId = 'redis_api_slot_b_version_00000001'
}
foreach ($fixtureVersion in $pinnedFixedSlotVersions.Values) {
    if ([string] $fixtureVersion -cnotmatch '^[A-Za-z0-9_-]{32,64}$') {
        throw "Focused fixed-slot fixture VersionId has invalid length or characters: $fixtureVersion"
    }
}
$transitionFixtureNow = [DateTime]::UtcNow
$transitionValidationAt = $transitionFixtureNow.ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
$approvedTransitionRecord = New-AdoptionTransitionRecord `
    -PinnedVersions $pinnedFixedSlotVersions `
    -ParentTemplateSha256 $applicationTemplateSha256 `
    -WorkloadTemplateSha256 $workloadBoundariesTemplateSha256 `
    -Now $transitionFixtureNow
Write-JsonFile -Path $approvedTransitionRecordPath -Value $approvedTransitionRecord -Depth 14
$transitionValidationOutput = & $nodeCommand.Source @(
    $fixedSlotCredentialTransitionValidatorPath,
    '--record', $approvedTransitionRecordPath,
    '--mode', 'adopt',
    '--at', $transitionValidationAt,
    '--expected-account', '111122223333',
    '--expected-region', 'us-west-2',
    '--expected-stack', 'crypto-lending-application-test',
    '--expected-stack-id', $immutableStackId,
    '--expected-environment', 'test-kan34',
    '--expected-parent-template-sha256', $applicationTemplateSha256,
    '--expected-workload-template-sha256', $workloadBoundariesTemplateSha256,
    '--json'
)
if ($LASTEXITCODE -ne 0) {
    throw "Focused fixed-slot adoption fixture failed local validation: $($transitionValidationOutput | Out-String)"
}
$approvedTransitionValidation = ($transitionValidationOutput | Out-String) | ConvertFrom-Json
if (
    -not $approvedTransitionValidation.ok -or
    $approvedTransitionValidation.operation -cne 'ADOPT_AND_PIN' -or
    $approvedTransitionValidation.awsCallsMade -ne 0
) {
    throw 'Focused fixed-slot adoption fixture did not produce an approved zero-AWS-call validation.'
}
$global:LASTEXITCODE = 0

$updateApplicationParameterMap = [ordered]@{}
foreach ($entry in $applicationParameterMap.GetEnumerator()) {
    $updateApplicationParameterMap[$entry.Key] = [string] $entry.Value
}
foreach ($entry in $pinnedFixedSlotVersions.GetEnumerator()) {
    $updateApplicationParameterMap[$entry.Key] = [string] $entry.Value
}
$updateParameterOverrides = @($parameterOverrides) + @(
    'ApiDesiredCount=0'
    'WebDesiredCount=0'
    'WorkerDesiredCount=0'
    'ApiDatabaseCredentialPhase=A_ONLY'
    'WorkerDatabaseCredentialPhase=A_ONLY'
    'RedisCredentialPhase=A_ONLY'
    'RedisOperatorMode=DISABLED'
)
$transitionRecordSha256 = [string] $approvedTransitionValidation.canonicalSha256
$transitionCurrentStateSha256 = [string] $approvedTransitionValidation.currentStateSha256
$transitionTargetStateSha256 = [string] $approvedTransitionValidation.targetStateSha256
$currentStackParameterSnapshotSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $applicationParameterMap)
$currentStackTagSnapshotSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $applicationStackTags)
$currentStackBindingText = "current-stack-id=$immutableStackId`ncurrent-parent-template-sha256=$applicationTemplateSha256`ncurrent-stack-parameters-sha256=$currentStackParameterSnapshotSha256`ncurrent-stack-tags-sha256=$currentStackTagSnapshotSha256`nupdate-intent=CREDENTIAL_TRANSITION"
$currentStackBindingSha256 = Get-TextSha256 -Value $currentStackBindingText
$transitionDeploymentBindingText = "record-sha256=$transitionRecordSha256`ncurrent-state-sha256=$transitionCurrentStateSha256`ntarget-state-sha256=$transitionTargetStateSha256`ncurrent-stack-id=$immutableStackId`nparent-template-sha256=$applicationTemplateSha256`nworkload-template-sha256=$workloadBoundariesTemplateSha256`nobservability-template-sha256=$observabilityTemplateSha256`nmode=adopt`noperation=ADOPT_AND_PIN`ncurrent-stack-binding-sha256=$currentStackBindingSha256"
$transitionDeploymentBindingSha256 = Get-TextSha256 -Value $transitionDeploymentBindingText
$updateApplicationStackTags = [ordered]@{}
foreach ($entry in $applicationStackTags.GetEnumerator()) {
    $updateApplicationStackTags[$entry.Key] = [string] $entry.Value
}
$updateApplicationStackTags['credential-predecessor-sha256'] = 'NONE'
$updateApplicationStackTags['credential-transition-sha256'] = $transitionRecordSha256
$updateApplicationStackTags['credential-state-sha256'] = $transitionTargetStateSha256
$updateParameterSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $updateApplicationParameterMap)
$updateTagSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $updateApplicationStackTags)
$updateExpectedChangeSetDescription = "KAN-34 template-sha256=$applicationTemplateSha256 workload-template-sha256=$workloadBoundariesTemplateSha256 workload-binding-sha256=$artifactBindingSha256 observability-template-sha256=$observabilityTemplateSha256 observability-binding-sha256=$observabilityArtifactBindingSha256 parameters-sha256=$updateParameterSha256 tags-sha256=$updateTagSha256 control-record-sha256=$controlRecordSha256 acm-dns-record-sha256=$acmDnsRecordSha256 guardrail-policy=kan-229-v1 current-stack-binding-sha256=$currentStackBindingSha256 credential-transition-binding-sha256=$transitionDeploymentBindingSha256"
$updateBillableAcknowledgement = "EXECUTE IMMUTABLE CHANGE SET $immutableChangeSetId FOR IMMUTABLE STACK $immutableStackId WITH PARAMETERS $updateParameterSha256 WORKLOAD TEMPLATE $workloadBoundariesTemplateSha256 WORKLOAD BINDING $artifactBindingSha256 OBSERVABILITY TEMPLATE $observabilityTemplateSha256 OBSERVABILITY BINDING $observabilityArtifactBindingSha256 CURRENT STACK STATE $currentStackBindingSha256 FIXED-SLOT TRANSITION $transitionRecordSha256 FROM STATE $transitionCurrentStateSha256 TO STATE $transitionTargetStateSha256 BOUND BY $transitionDeploymentBindingSha256 WITH TAGS $updateTagSha256 USING BILLING CONTROL $controlRecordSha256 AND ACM DNS CONTROL $acmDnsRecordSha256; I ACKNOWLEDGE BILLABLE AWS RESOURCES IN ACCOUNT 111122223333 REGION us-west-2 USING PROFILE kan34-test"
$updateArguments = Copy-ArgumentMap -Map $baseArguments
$updateArguments.ChangeSetType = 'UPDATE'
$updateArguments.CurrentStackId = $immutableStackId
$updateArguments.UpdateIntent = 'CREDENTIAL_TRANSITION'
$updateArguments.FixedSlotCredentialTransitionRecordFile = $approvedTransitionRecordPath
$updateArguments.FixedSlotCredentialTransitionMode = 'adopt'
$updateArguments.FixedSlotCredentialTransitionValidationAt = $transitionValidationAt
$updateArguments.ParameterOverride = $updateParameterOverrides
$updateArguments.BillableAcknowledgement = $updateBillableAcknowledgement
foreach ($entry in $pinnedFixedSlotVersions.GetEnumerator()) {
    $updateArguments[$entry.Key] = [string] $entry.Value
}

$applicationUpdateParameterMap = [ordered]@{}
foreach ($entry in $updateApplicationParameterMap.GetEnumerator()) {
    $applicationUpdateParameterMap[$entry.Key] = [string] $entry.Value
}
$applicationUpdateParameterMap.ApplicationVersion = ('d' * 40)
$applicationUpdateParameterMap.ApiDesiredCount = '1'
$applicationUpdateParameterMap.WebDesiredCount = '1'
$applicationUpdateParameterMap.WorkerDesiredCount = '1'
$applicationUpdateParameterOverrides = @($updateParameterOverrides | Where-Object {
        $_ -notmatch '^(?:ApplicationVersion|ApiDesiredCount|WebDesiredCount|WorkerDesiredCount)='
    }) + @(
    "ApplicationVersion=$('d' * 40)"
    'ApiDesiredCount=1'
    'WebDesiredCount=1'
    'WorkerDesiredCount=1'
)
$applicationCurrentParameterSnapshotSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $updateApplicationParameterMap)
$applicationCurrentTagSnapshotSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $updateApplicationStackTags)
$applicationCurrentStackBindingText = "current-stack-id=$immutableStackId`ncurrent-parent-template-sha256=$applicationTemplateSha256`ncurrent-stack-parameters-sha256=$applicationCurrentParameterSnapshotSha256`ncurrent-stack-tags-sha256=$applicationCurrentTagSnapshotSha256`nupdate-intent=APPLICATION"
$applicationCurrentStackBindingSha256 = Get-TextSha256 -Value $applicationCurrentStackBindingText
$applicationUpdateParameterSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $applicationUpdateParameterMap)
$applicationUpdateExpectedChangeSetDescription = "KAN-34 template-sha256=$applicationTemplateSha256 workload-template-sha256=$workloadBoundariesTemplateSha256 workload-binding-sha256=$artifactBindingSha256 observability-template-sha256=$observabilityTemplateSha256 observability-binding-sha256=$observabilityArtifactBindingSha256 parameters-sha256=$applicationUpdateParameterSha256 tags-sha256=$updateTagSha256 control-record-sha256=$controlRecordSha256 acm-dns-record-sha256=$acmDnsRecordSha256 guardrail-policy=kan-229-v1 current-stack-binding-sha256=$applicationCurrentStackBindingSha256"
$applicationUpdateBillableAcknowledgement = "EXECUTE IMMUTABLE CHANGE SET $immutableChangeSetId FOR IMMUTABLE STACK $immutableStackId WITH PARAMETERS $applicationUpdateParameterSha256 WORKLOAD TEMPLATE $workloadBoundariesTemplateSha256 WORKLOAD BINDING $artifactBindingSha256 OBSERVABILITY TEMPLATE $observabilityTemplateSha256 OBSERVABILITY BINDING $observabilityArtifactBindingSha256 CURRENT STACK STATE $applicationCurrentStackBindingSha256 USING BILLING CONTROL $controlRecordSha256 AND ACM DNS CONTROL $acmDnsRecordSha256; I ACKNOWLEDGE BILLABLE AWS RESOURCES IN ACCOUNT 111122223333 REGION us-west-2 USING PROFILE kan34-test"
$applicationUpdateArguments = Copy-ArgumentMap -Map $updateArguments
$applicationUpdateArguments.UpdateIntent = 'APPLICATION'
[void] $applicationUpdateArguments.Remove('FixedSlotCredentialTransitionRecordFile')
[void] $applicationUpdateArguments.Remove('FixedSlotCredentialTransitionMode')
[void] $applicationUpdateArguments.Remove('FixedSlotCredentialTransitionValidationAt')
$applicationUpdateArguments.ParameterOverride = $applicationUpdateParameterOverrides
$applicationUpdateArguments.BillableAcknowledgement = $applicationUpdateBillableAcknowledgement

$rotatedFixedSlotVersions = [ordered]@{}
foreach ($entry in $pinnedFixedSlotVersions.GetEnumerator()) {
    $rotatedFixedSlotVersions[$entry.Key] = [string] $entry.Value
}
$rotatedFixedSlotVersions.ApiDatabaseSlotBVersionId = 'api_database_slot_b_version_00002'
$approvedRotationRecord = New-PreparationTransitionRecord `
    -PinnedVersions $pinnedFixedSlotVersions `
    -TargetApiDatabaseSlotBVersionId ([string] $rotatedFixedSlotVersions.ApiDatabaseSlotBVersionId) `
    -ParentTemplateSha256 $applicationTemplateSha256 `
    -WorkloadTemplateSha256 $workloadBoundariesTemplateSha256 `
    -PredecessorStateSha256 $transitionTargetStateSha256 `
    -PredecessorTransitionSha256 $transitionRecordSha256 `
    -Now $transitionFixtureNow
Write-JsonFile -Path $approvedRotationRecordPath -Value $approvedRotationRecord -Depth 14
$rotationValidationOutput = & $nodeCommand.Source @(
    $fixedSlotCredentialTransitionValidatorPath,
    '--record', $approvedRotationRecordPath,
    '--mode', 'transition',
    '--at', $transitionValidationAt,
    '--expected-account', '111122223333',
    '--expected-region', 'us-west-2',
    '--expected-stack', 'crypto-lending-application-test',
    '--expected-stack-id', $immutableStackId,
    '--expected-environment', 'test-kan34',
    '--expected-parent-template-sha256', $applicationTemplateSha256,
    '--expected-workload-template-sha256', $workloadBoundariesTemplateSha256,
    '--json'
)
if ($LASTEXITCODE -ne 0) {
    throw "Focused fixed-slot preparation fixture failed local validation: $($rotationValidationOutput | Out-String)"
}
$approvedRotationValidation = ($rotationValidationOutput | Out-String) | ConvertFrom-Json
if (
    -not $approvedRotationValidation.ok -or
    $approvedRotationValidation.operation -cne 'PREPARE_INACTIVE' -or
    $approvedRotationValidation.awsCallsMade -ne 0
) {
    throw 'Focused fixed-slot preparation fixture did not produce an approved zero-AWS-call validation.'
}
$global:LASTEXITCODE = 0
$rotationRecordSha256 = [string] $approvedRotationValidation.canonicalSha256
$rotationTargetStateSha256 = [string] $approvedRotationValidation.targetStateSha256
$rotationCurrentStackBindingText = "current-stack-id=$immutableStackId`ncurrent-parent-template-sha256=$applicationTemplateSha256`ncurrent-stack-parameters-sha256=$applicationCurrentParameterSnapshotSha256`ncurrent-stack-tags-sha256=$applicationCurrentTagSnapshotSha256`nupdate-intent=CREDENTIAL_TRANSITION"
$rotationCurrentStackBindingSha256 = Get-TextSha256 -Value $rotationCurrentStackBindingText
$rotationDeploymentBindingText = "record-sha256=$rotationRecordSha256`ncurrent-state-sha256=$transitionTargetStateSha256`ntarget-state-sha256=$rotationTargetStateSha256`ncurrent-stack-id=$immutableStackId`nparent-template-sha256=$applicationTemplateSha256`nworkload-template-sha256=$workloadBoundariesTemplateSha256`nobservability-template-sha256=$observabilityTemplateSha256`nmode=transition`noperation=PREPARE_INACTIVE`ncurrent-stack-binding-sha256=$rotationCurrentStackBindingSha256"
$rotationDeploymentBindingSha256 = Get-TextSha256 -Value $rotationDeploymentBindingText
$rotationApplicationParameterMap = [ordered]@{}
foreach ($entry in $updateApplicationParameterMap.GetEnumerator()) {
    $rotationApplicationParameterMap[$entry.Key] = [string] $entry.Value
}
$rotationApplicationParameterMap.ApiDatabaseSlotBVersionId = [string] $rotatedFixedSlotVersions.ApiDatabaseSlotBVersionId
$rotationApplicationStackTags = [ordered]@{}
foreach ($entry in $applicationStackTags.GetEnumerator()) {
    $rotationApplicationStackTags[$entry.Key] = [string] $entry.Value
}
$rotationApplicationStackTags['credential-predecessor-sha256'] = $transitionRecordSha256
$rotationApplicationStackTags['credential-transition-sha256'] = $rotationRecordSha256
$rotationApplicationStackTags['credential-state-sha256'] = $rotationTargetStateSha256
$rotationParameterSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $rotationApplicationParameterMap)
$rotationTagSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $rotationApplicationStackTags)
$rotationExpectedChangeSetDescription = "KAN-34 template-sha256=$applicationTemplateSha256 workload-template-sha256=$workloadBoundariesTemplateSha256 workload-binding-sha256=$artifactBindingSha256 observability-template-sha256=$observabilityTemplateSha256 observability-binding-sha256=$observabilityArtifactBindingSha256 parameters-sha256=$rotationParameterSha256 tags-sha256=$rotationTagSha256 control-record-sha256=$controlRecordSha256 acm-dns-record-sha256=$acmDnsRecordSha256 guardrail-policy=kan-229-v1 current-stack-binding-sha256=$rotationCurrentStackBindingSha256 credential-transition-binding-sha256=$rotationDeploymentBindingSha256"
$rotationArguments = Copy-ArgumentMap -Map $updateArguments
$rotationArguments.FixedSlotCredentialTransitionRecordFile = $approvedRotationRecordPath
$rotationArguments.FixedSlotCredentialTransitionMode = 'transition'
foreach ($entry in $rotatedFixedSlotVersions.GetEnumerator()) {
    $rotationArguments[$entry.Key] = [string] $entry.Value
}
Write-ApplicationStackResponse -ParameterMap $applicationParameterMap -TagMap $applicationStackTags
Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody

try {
    Invoke-FocusedTest -Name 'default LocalValidate makes zero AWS calls' -Body {
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments @{}
        Assert-Condition $result.Succeeded "LocalValidate failed: $($result.Output)"
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'LocalValidate invoked the fake AWS CLI.'
        Assert-Condition ($result.Output -match 'No AWS calls were made') 'LocalValidate did not report its zero-call boundary.'
    }

    Invoke-FocusedTest -Name 'Plan requires all six explicit fixed-slot VersionIds before AWS discovery' -Body {
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'Plan'
        [void] $arguments.Remove('RedisApiSlotBVersionId')
        $result = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $result.Succeeded) 'Plan accepted a missing fixed-slot VersionId.'
        Assert-Condition ($result.Output -match 'RedisApiSlotBVersionId must be supplied explicitly') 'Missing fixed-slot VersionId rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Missing fixed-slot VersionId reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'Plan rejects malformed and mixed fixed-slot VersionIds before AWS discovery' -Body {
        Clear-AwsMarker
        $malformedArguments = Copy-ArgumentMap -Map $baseArguments
        $malformedArguments.Action = 'Plan'
        $malformedArguments.RedisApiSlotBVersionId = 'short'
        $malformed = Invoke-Guard -Arguments $malformedArguments
        Assert-Condition (-not $malformed.Succeeded) 'Plan accepted a malformed fixed-slot VersionId.'
        Assert-Condition ($malformed.Output -match '32-64 character') 'Malformed fixed-slot VersionId rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Malformed fixed-slot VersionId reached AWS discovery.'

        Clear-AwsMarker
        $mixedArguments = Copy-ArgumentMap -Map $baseArguments
        $mixedArguments.Action = 'Plan'
        $mixedArguments.RedisApiSlotBVersionId = [string] $pinnedFixedSlotVersions.RedisApiSlotBVersionId
        $mixed = Invoke-Guard -Arguments $mixedArguments
        Assert-Condition (-not $mixed.Succeeded) 'Plan accepted mixed pinned and UNPINNED VersionIds.'
        Assert-Condition ($mixed.Output -match 'mixed state is prohibited') 'Mixed VersionId rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Mixed VersionId state reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'CREATE enforces zero counts, A_ONLY phases, and disabled Redis operator before AWS' -Body {
        foreach ($invalidOverride in @(
                'ApiDesiredCount=1',
                'ApiDatabaseCredentialPhase=BOTH_USE_A',
                'RedisOperatorMode=ENABLED'
            )) {
            Clear-AwsMarker
            $arguments = Copy-ArgumentMap -Map $baseArguments
            $arguments.Action = 'Plan'
            $arguments.ParameterOverride = @($parameterOverrides) + @($invalidOverride)
            $result = Invoke-Guard -Arguments $arguments
            Assert-Condition (-not $result.Succeeded) "CREATE accepted unsafe override $invalidOverride."
            Assert-Condition ((Get-AwsMarkerText) -eq '') "Unsafe CREATE override $invalidOverride reached AWS discovery."
        }
    }

    Invoke-FocusedTest -Name 'UPDATE rejects missing transition evidence and implicit fixed-slot controls with zero AWS calls' -Body {
        Clear-AwsMarker
        $missingRecordArguments = Copy-ArgumentMap -Map $updateArguments
        $missingRecordArguments.Action = 'Plan'
        [void] $missingRecordArguments.Remove('FixedSlotCredentialTransitionRecordFile')
        $missingRecord = Invoke-Guard -Arguments $missingRecordArguments
        Assert-Condition (-not $missingRecord.Succeeded) 'UPDATE accepted a missing fixed-slot transition record.'
        Assert-Condition ($missingRecord.Output -match 'FixedSlotCredentialTransitionRecordFile must be supplied explicitly') 'Missing transition record rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Missing transition record reached AWS discovery.'

        Clear-AwsMarker
        $implicitArguments = Copy-ArgumentMap -Map $updateArguments
        $implicitArguments.Action = 'Plan'
        $implicitArguments.ParameterOverride = @($updateParameterOverrides | Where-Object { $_ -cne 'ApiDatabaseCredentialPhase=A_ONLY' })
        $implicit = Invoke-Guard -Arguments $implicitArguments
        Assert-Condition (-not $implicit.Succeeded) 'UPDATE accepted an implicit previous fixed-slot phase.'
        Assert-Condition ($implicit.Output -match 'implicit previous fixed-slot controls are prohibited') 'Implicit previous fixed-slot rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Implicit previous fixed-slot control reached AWS discovery.'

        Clear-AwsMarker
        $wrongStackArguments = Copy-ArgumentMap -Map $updateArguments
        $wrongStackArguments.Action = 'Plan'
        $wrongStackArguments.CurrentStackId = 'arn:aws:cloudformation:us-west-2:111122223333:stack/crypto-lending-application-test/bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
        $wrongStack = Invoke-Guard -Arguments $wrongStackArguments
        Assert-Condition (-not $wrongStack.Succeeded) 'UPDATE accepted transition evidence bound to a different immutable stack ID.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Mismatched immutable stack ID reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'UPDATE requires an explicit intent and rejects transition inputs for application updates before AWS' -Body {
        Clear-AwsMarker
        $missingIntentArguments = Copy-ArgumentMap -Map $updateArguments
        $missingIntentArguments.Action = 'Plan'
        [void] $missingIntentArguments.Remove('UpdateIntent')
        $missingIntent = Invoke-Guard -Arguments $missingIntentArguments
        Assert-Condition (-not $missingIntent.Succeeded) 'UPDATE accepted a missing UpdateIntent.'
        Assert-Condition ($missingIntent.Output -match 'UpdateIntent must be supplied explicitly') 'Missing UpdateIntent rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Missing UpdateIntent reached AWS discovery.'

        Clear-AwsMarker
        $mixedIntentArguments = Copy-ArgumentMap -Map $updateArguments
        $mixedIntentArguments.Action = 'Plan'
        $mixedIntentArguments.UpdateIntent = 'APPLICATION'
        $mixedIntent = Invoke-Guard -Arguments $mixedIntentArguments
        Assert-Condition (-not $mixedIntent.Succeeded) 'APPLICATION update accepted fixed-slot transition inputs.'
        Assert-Condition ($mixedIntent.Output -match 'must not supply fixed-slot transition evidence') 'Mixed update-intent rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Mixed update intent reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'UPDATE rejects malformed, unauthorized, and target-mismatched transition records with zero AWS calls' -Body {
        try {
            Clear-AwsMarker
            [System.IO.File]::WriteAllText($approvedTransitionRecordPath, '{', [System.Text.UTF8Encoding]::new($false))
            $malformedArguments = Copy-ArgumentMap -Map $updateArguments
            $malformedArguments.Action = 'Plan'
            $malformed = Invoke-Guard -Arguments $malformedArguments
            Assert-Condition (-not $malformed.Succeeded) 'UPDATE accepted malformed transition JSON.'
            Assert-Condition ((Get-AwsMarkerText) -eq '') 'Malformed transition JSON reached AWS discovery.'

            Clear-AwsMarker
            $unauthorizedRecord = ($approvedTransitionRecord | ConvertTo-Json -Depth 14) | ConvertFrom-Json
            $unauthorizedRecord.authority.decision = 'NOT_APPROVED'
            Write-JsonFile -Path $approvedTransitionRecordPath -Value $unauthorizedRecord -Depth 14
            $unauthorizedArguments = Copy-ArgumentMap -Map $updateArguments
            $unauthorizedArguments.Action = 'Plan'
            $unauthorized = Invoke-Guard -Arguments $unauthorizedArguments
            Assert-Condition (-not $unauthorized.Succeeded) 'UPDATE accepted unauthorized transition evidence.'
            Assert-Condition ((Get-AwsMarkerText) -eq '') 'Unauthorized transition evidence reached AWS discovery.'

            Clear-AwsMarker
            $mismatchedRecord = ($approvedTransitionRecord | ConvertTo-Json -Depth 14) | ConvertFrom-Json
            $mismatchedRecord.targetState.apiDatabase.slots.a.currentVersionId = 'api_database_slot_a_version_00002'
            $mismatchedRecord.targetState.apiDatabase.slots.a.usedVersionIds = @('api_database_slot_a_version_00002')
            Write-JsonFile -Path $approvedTransitionRecordPath -Value $mismatchedRecord -Depth 14
            $mismatchedArguments = Copy-ArgumentMap -Map $updateArguments
            $mismatchedArguments.Action = 'Plan'
            $mismatched = Invoke-Guard -Arguments $mismatchedArguments
            Assert-Condition (-not $mismatched.Succeeded) 'UPDATE accepted a record whose target VersionId differs from the named target.'
            Assert-Condition ($mismatched.Output -match 'does not match the approved transition record') 'Target VersionId mismatch was not explicit.'
            Assert-Condition ((Get-AwsMarkerText) -eq '') 'Target VersionId mismatch reached AWS discovery.'
        }
        finally {
            Write-JsonFile -Path $approvedTransitionRecordPath -Value $approvedTransitionRecord -Depth 14
        }
    }

    Invoke-FocusedTest -Name 'UPDATE rejects a stale caller-supplied validation instant with zero AWS calls' -Body {
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $updateArguments
        $arguments.Action = 'Plan'
        $arguments.FixedSlotCredentialTransitionValidationAt = $transitionFixtureNow.AddMinutes(-10).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
        $result = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $result.Succeeded) 'UPDATE accepted a stale transition validation instant.'
        Assert-Condition ($result.Output -match 'current within the reviewed five-minute window') 'Stale validation instant rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Stale transition validation instant reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'UPDATE rejects deployed fixed-slot version drift before artifact reads or change-set creation' -Body {
        $driftedCurrentParameters = [ordered]@{}
        foreach ($entry in $applicationParameterMap.GetEnumerator()) {
            $driftedCurrentParameters[$entry.Key] = [string] $entry.Value
        }
        $driftedCurrentParameters.ApiDatabaseSlotAVersionId = [string] $pinnedFixedSlotVersions.ApiDatabaseSlotAVersionId
        Write-ApplicationStackResponse -ParameterMap $driftedCurrentParameters -TagMap $applicationStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $updateArguments
        $arguments.Action = 'Plan'
        $result = Invoke-Guard -Arguments $arguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'UPDATE accepted fixed-slot drift in the deployed stack.'
        Assert-Condition ($result.Output -match 'drifted from the approved update current state') 'Deployed fixed-slot drift rejection was not explicit.'
        Assert-Condition ($marker -notmatch 's3api get-object|create-change-set') 'Deployed fixed-slot drift reached artifact reads or change-set creation.'
        Write-ApplicationStackResponse -ParameterMap $applicationParameterMap -TagMap $applicationStackTags
    }

    Invoke-FocusedTest -Name 'credential-only UPDATE rejects unrelated parameter and stack-tag changes' -Body {
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody

        Write-ApplicationStackResponse -ParameterMap $applicationParameterMap -TagMap $applicationStackTags
        Clear-AwsMarker
        $parameterMutationArguments = Copy-ArgumentMap -Map $updateArguments
        $parameterMutationArguments.Action = 'Plan'
        $parameterMutationArguments.ParameterOverride = @($updateParameterOverrides) + @('LogRetentionDays=30')
        $parameterMutation = Invoke-Guard -Arguments $parameterMutationArguments
        $parameterMutationMarker = Get-AwsMarkerText
        Assert-Condition (-not $parameterMutation.Succeeded) 'Credential-only UPDATE accepted an unrelated parameter change.'
        Assert-Condition ($parameterMutation.Output -match "cannot change unrelated parameter 'LogRetentionDays'") 'Unrelated parameter rejection was not explicit.'
        Assert-Condition ($parameterMutationMarker -notmatch 's3api get-object|create-change-set') 'Unrelated credential-update parameter reached artifact reads or change-set creation.'

        $driftedStackTags = [ordered]@{}
        foreach ($entry in $applicationStackTags.GetEnumerator()) {
            $driftedStackTags[$entry.Key] = [string] $entry.Value
        }
        $driftedStackTags.owner = 'unexpected-owner'
        Write-ApplicationStackResponse -ParameterMap $applicationParameterMap -TagMap $driftedStackTags
        Clear-AwsMarker
        $tagMutationArguments = Copy-ArgumentMap -Map $updateArguments
        $tagMutationArguments.Action = 'Plan'
        $tagMutation = Invoke-Guard -Arguments $tagMutationArguments
        $tagMutationMarker = Get-AwsMarkerText
        Assert-Condition (-not $tagMutation.Succeeded) 'Credential-only UPDATE accepted unrelated stack-tag drift.'
        Assert-Condition ($tagMutation.Output -match "cannot change or repair unrelated stack tag 'owner'") 'Unrelated stack-tag rejection was not explicit.'
        Assert-Condition ($tagMutationMarker -notmatch 's3api get-object|create-change-set') 'Unrelated credential-update tag drift reached artifact reads or change-set creation.'
        Write-ApplicationStackResponse -ParameterMap $applicationParameterMap -TagMap $applicationStackTags
    }

    Invoke-FocusedTest -Name 'UPDATE Plan binds the approved transition, exact stack, six targets, templates, parameters, and tags' -Body {
        Write-ApplicationStackResponse -ParameterMap $applicationParameterMap -TagMap $applicationStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $updateArguments
        $arguments.Action = 'Plan'
        $result = Invoke-Guard -Arguments $arguments
        $marker = Get-AwsMarkerText
        $createLine = @($marker -split "`r?`n" | Where-Object { $_ -match 'cloudformation create-change-set' }) | Select-Object -First 1
        Assert-Condition $result.Succeeded "Approved UPDATE Plan failed: $($result.Output)"
        Assert-Condition ($null -ne $createLine) 'Approved UPDATE did not create a change set.'
        Assert-Condition ($createLine -match ('credential-transition-binding-sha256=' + $transitionDeploymentBindingSha256)) 'UPDATE description did not bind the exact transition deployment digest.'
        Assert-Condition ($createLine -match ('Key=credential-transition-sha256,Value=' + $transitionRecordSha256)) 'UPDATE tags did not bind the exact transition record.'
        Assert-Condition ($createLine -match ('Key=credential-state-sha256,Value=' + $transitionTargetStateSha256)) 'UPDATE tags did not bind the exact target state.'
        foreach ($entry in $pinnedFixedSlotVersions.GetEnumerator()) {
            Assert-Condition ($createLine -match ("ParameterKey=$($entry.Key),ParameterValue=" + [regex]::Escape([string] $entry.Value))) "UPDATE omitted exact target $($entry.Key)."
        }
        Assert-Condition ($createLine -match [regex]::Escape("--stack-name $immutableStackId")) 'UPDATE Plan did not address the immutable stack ARN.'
        Assert-Condition ($createLine -match ('current-stack-binding-sha256=' + $currentStackBindingSha256)) 'UPDATE description did not bind the exact current stack state.'
    }

    Invoke-FocusedTest -Name 'credential transition Plan advances one inactive slot without unrelated changes' -Body {
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $updateApplicationStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $rotationArguments
        $arguments.Action = 'Plan'
        $result = Invoke-Guard -Arguments $arguments
        $marker = Get-AwsMarkerText
        $createLine = @($marker -split "`r?`n" | Where-Object { $_ -match 'cloudformation create-change-set' }) | Select-Object -First 1
        Assert-Condition $result.Succeeded "Approved inactive-slot transition Plan failed: $($result.Output)"
        Assert-Condition ($null -ne $createLine) 'Approved inactive-slot transition did not create a change set.'
        Assert-Condition ($createLine -match ('credential-transition-binding-sha256=' + $rotationDeploymentBindingSha256)) 'Inactive-slot transition description did not bind the exact deployment digest.'
        Assert-Condition ($createLine -match ('Key=credential-predecessor-sha256,Value=' + $transitionRecordSha256)) 'Inactive-slot transition did not extend the deployed credential chain.'
        Assert-Condition ($createLine -match ('Key=credential-transition-sha256,Value=' + $rotationRecordSha256)) 'Inactive-slot transition did not bind its exact record hash.'
        Assert-Condition ($createLine -match ('Key=credential-state-sha256,Value=' + $rotationTargetStateSha256)) 'Inactive-slot transition did not bind its exact target-state hash.'
        Assert-Condition ($createLine -match [regex]::Escape("ParameterKey=ApiDatabaseSlotBVersionId,ParameterValue=$($rotatedFixedSlotVersions.ApiDatabaseSlotBVersionId)")) 'Inactive-slot transition omitted its exact new VersionId.'
        Assert-Condition ($createLine -match [regex]::Escape("--stack-name $immutableStackId")) 'Inactive-slot transition did not address the immutable stack ARN.'
    }

    Invoke-FocusedTest -Name 'APPLICATION update requires completed adoption and unchanged fixed-slot bindings before artifact reads' -Body {
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody

        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $applicationStackTags
        Clear-AwsMarker
        $missingChainArguments = Copy-ArgumentMap -Map $applicationUpdateArguments
        $missingChainArguments.Action = 'Plan'
        $missingChain = Invoke-Guard -Arguments $missingChainArguments
        $missingChainMarker = Get-AwsMarkerText
        Assert-Condition (-not $missingChain.Succeeded) 'APPLICATION update accepted a stack without completed adoption tags.'
        Assert-Condition ($missingChain.Output -match 'valid existing credential-chain tag') 'Missing credential-chain rejection was not explicit.'
        Assert-Condition ($missingChainMarker -notmatch 's3api get-object|create-change-set') 'Missing credential chain reached artifact reads or change-set creation.'

        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $updateApplicationStackTags
        Clear-AwsMarker
        $driftedBindingArguments = Copy-ArgumentMap -Map $applicationUpdateArguments
        $driftedBindingArguments.Action = 'Plan'
        $driftedBindingArguments.RedisApiSlotBVersionId = 'redis_api_slot_b_version_00000002'
        $driftedBinding = Invoke-Guard -Arguments $driftedBindingArguments
        $driftedBindingMarker = Get-AwsMarkerText
        Assert-Condition (-not $driftedBinding.Succeeded) 'APPLICATION update accepted a fixed-slot VersionId change.'
        Assert-Condition ($driftedBinding.Output -match 'drifted from the approved update current state') 'APPLICATION fixed-slot drift rejection was not explicit.'
        Assert-Condition ($driftedBindingMarker -notmatch 's3api get-object|create-change-set') 'APPLICATION fixed-slot drift reached artifact reads or change-set creation.'
    }

    Invoke-FocusedTest -Name 'APPLICATION Plan permits service activation while preserving pinned credentials and chain tags' -Body {
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $updateApplicationStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $applicationUpdateArguments
        $arguments.Action = 'Plan'
        $result = Invoke-Guard -Arguments $arguments
        $marker = Get-AwsMarkerText
        $createLine = @($marker -split "`r?`n" | Where-Object { $_ -match 'cloudformation create-change-set' }) | Select-Object -First 1
        Assert-Condition $result.Succeeded "Approved APPLICATION Plan failed: $($result.Output)"
        Assert-Condition ($null -ne $createLine) 'Approved APPLICATION update did not create a change set.'
        Assert-Condition ($createLine -match [regex]::Escape("--stack-name $immutableStackId")) 'APPLICATION Plan did not address the immutable stack ARN.'
        Assert-Condition ($createLine -match ('current-stack-binding-sha256=' + $applicationCurrentStackBindingSha256)) 'APPLICATION description did not bind the exact current stack state.'
        Assert-Condition ($createLine -notmatch 'credential-transition-binding-sha256=') 'APPLICATION update incorrectly claimed a credential transition binding.'
        foreach ($desiredCount in @('ApiDesiredCount', 'WebDesiredCount', 'WorkerDesiredCount')) {
            Assert-Condition ($createLine -match "ParameterKey=$desiredCount,ParameterValue=1") "APPLICATION update did not preserve requested $desiredCount activation."
        }
        foreach ($entry in $pinnedFixedSlotVersions.GetEnumerator()) {
            Assert-Condition ($createLine -match ("ParameterKey=$($entry.Key),ParameterValue=" + [regex]::Escape([string] $entry.Value))) "APPLICATION update changed or omitted fixed-slot pin $($entry.Key)."
        }
        foreach ($credentialTag in @('credential-predecessor-sha256', 'credential-transition-sha256', 'credential-state-sha256')) {
            Assert-Condition ($createLine -match ("Key=$credentialTag,Value=" + [regex]::Escape([string] $updateApplicationStackTags[$credentialTag]))) "APPLICATION update did not preserve credential-chain tag $credentialTag."
        }
    }

    Invoke-FocusedTest -Name 'LocalValidate binds current child bytes to the parent digest pin without AWS' -Body {
        Clear-AwsMarker
        $normalizedChild = $workloadBoundariesTemplateBody -replace "`r`n", "`n"
        $lineEndingMutation = $normalizedChild -replace "`n", "`r`n"
        [System.IO.File]::WriteAllText($mismatchedChildTemplatePath, $lineEndingMutation, [System.Text.UTF8Encoding]::new($false))
        if ((Get-FileHash -LiteralPath $mismatchedChildTemplatePath -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $workloadBoundariesTemplateSha256) {
            [System.IO.File]::WriteAllText($mismatchedChildTemplatePath, $normalizedChild, [System.Text.UTF8Encoding]::new($false))
        }
        $result = Invoke-Guard -Arguments @{ WorkloadBoundariesTemplateFile = $mismatchedChildTemplatePath }
        Assert-Condition (-not $result.Succeeded) 'LocalValidate accepted structurally valid child bytes that differ from the parent digest pin.'
        Assert-Condition ($result.Output -match 'does not match the parent template') 'Parent-to-child digest mismatch was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Parent-to-child digest mismatch reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'Plan requires immutable artifact coordinates before AWS discovery' -Body {
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'Plan'
        [void] $arguments.Remove('WorkloadBoundariesArtifactVersionId')
        $result = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $result.Succeeded) 'Plan accepted a missing versioned child artifact VersionId.'
        Assert-Condition ($result.Output -match 'WorkloadBoundariesArtifactVersionId must be supplied explicitly') 'Missing VersionId rejection did not identify the immutable artifact input.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Missing immutable artifact input reached AWS discovery.'

        $observabilityArguments = Copy-ArgumentMap -Map $baseArguments
        $observabilityArguments.Action = 'Plan'
        [void] $observabilityArguments.Remove('BillableAcknowledgement')
        [void] $observabilityArguments.Remove('ObservabilityArtifactVersionId')
        $observabilityResult = Invoke-Guard -Arguments $observabilityArguments
        Assert-Condition (-not $observabilityResult.Succeeded) 'Plan accepted a missing observability artifact VersionId.'
        Assert-Condition ($observabilityResult.Output -match 'ObservabilityArtifactVersionId must be supplied explicitly') 'Missing observability VersionId rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Missing observability artifact input reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'Plan verifies exact versioned child bytes before creating a nested-aware change set' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'Plan'
        $result = Invoke-Guard -Arguments $arguments
        $marker = Get-AwsMarkerText
        $createLines = @($marker -split "`r?`n" | Where-Object { $_ -match 'cloudformation create-change-set' })
        Assert-Condition $result.Succeeded "Exact Plan failed: $($result.Output)"
        Assert-Condition ($marker -match 's3api get-bucket-location') 'Plan did not verify the artifact bucket Region/owner.'
        Assert-Condition ($marker -match 'ec2 describe-managed-prefix-lists --prefix-list-ids pl-12345678') 'Plan did not verify the exact S3 managed prefix-list identity.'
        Assert-Condition ($marker -match '--expected-bucket-owner 111122223333') 'Plan did not bind S3 reads to the approved account owner.'
        Assert-Condition ($marker -match ('--version-id ' + [regex]::Escape($artifactVersionId) + '(?:\s|$)')) 'Plan did not retrieve the exact raw artifact VersionId.'
        Assert-Condition ($marker -match 's3api get-bucket-versioning') 'Plan did not verify artifact bucket versioning.'
        Assert-Condition ($marker -match 's3api get-object') 'Plan did not retrieve exact versioned artifact bytes.'
        Assert-Condition ($marker.IndexOf('s3api get-object', [System.StringComparison]::Ordinal) -lt $marker.IndexOf('cloudformation create-change-set', [System.StringComparison]::Ordinal)) 'Plan did not verify child bytes before change-set creation.'
        Assert-Condition ($createLines.Count -eq 1) 'Plan did not create exactly one change set.'
        Assert-Condition ($createLines[0] -match '--include-nested-stacks') 'Plan did not enable nested-stack change visibility.'
        Assert-Condition ($createLines[0] -match [regex]::Escape("ParameterKey=WorkloadBoundariesTemplateUrl,ParameterValue=$artifactTemplateUrl")) 'Plan did not bind the constructed versioned TemplateURL.'
        Assert-Condition ($createLines[0] -match [regex]::Escape("ParameterKey=WorkloadBoundariesTemplateSha256,ParameterValue=$workloadBoundariesTemplateSha256")) 'Plan did not bind the reviewed child byte hash.'
        Assert-Condition ($createLines[0] -match [regex]::Escape("ParameterKey=WorkloadBoundariesArtifactBindingSha256,ParameterValue=$artifactBindingSha256")) 'Plan did not bind the artifact location/version hash.'
        Assert-Condition ($createLines[0] -match [regex]::Escape("ParameterKey=ObservabilityTemplateUrl,ParameterValue=$observabilityTemplateUrl")) 'Plan did not bind the observability versioned TemplateURL.'
        Assert-Condition ($createLines[0] -match [regex]::Escape("ParameterKey=ObservabilityTemplateSha256,ParameterValue=$observabilityTemplateSha256")) 'Plan did not bind the reviewed observability bytes.'
        Assert-Condition ($createLines[0] -match [regex]::Escape("ParameterKey=ObservabilityArtifactBindingSha256,ParameterValue=$observabilityArtifactBindingSha256")) 'Plan did not bind the observability artifact location/version hash.'
        Assert-Condition ($createLines[0] -match [regex]::Escape("ParameterKey=AuthWalletKeysSecretArn,ParameterValue=$($applicationParameterMap.AuthWalletKeysSecretArn)")) 'Plan did not bind the one reviewed auth/wallet secret ARN.'
        Assert-Condition ($createLines[0] -match [regex]::Escape("ParameterKey=AuthWalletKeysKmsKeyArn,ParameterValue=$($applicationParameterMap.AuthWalletKeysKmsKeyArn)")) 'Plan did not bind the exact auth/wallet KMS key ARN.'
        Assert-Condition ($createLines[0] -match [regex]::Escape("ParameterKey=AlarmTopicArn,ParameterValue=$operationalAlarmTopicArn")) 'Plan did not bind the exact existing operational alarm SNS topic ARN.'
        Assert-Condition ($marker -notmatch 'put-object|create-bucket|execute-change-set') 'Plan uploaded, created, or executed a cloud resource.'
    }

    Invoke-FocusedTest -Name 'Plan rejects auth secret selectors and cross-account auth KMS keys' -Body {
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody

        Clear-AwsMarker
        $selectorArguments = Copy-ArgumentMap -Map $baseArguments
        $selectorArguments.Action = 'Plan'
        $selectorArguments.ParameterOverride = @($parameterOverrides | Where-Object { $_ -notlike 'AuthWalletKeysSecretArn=*' }) + @(
            "AuthWalletKeysSecretArn=$($applicationParameterMap.AuthWalletKeysSecretArn):AUTH_PREAUTH_SEAL_KEY::"
        )
        $selectorResult = Invoke-Guard -Arguments $selectorArguments
        Assert-Condition (-not $selectorResult.Succeeded) 'Plan accepted a field-selected ARN instead of the one whole JSON secret ARN.'
        Assert-Condition ($selectorResult.Output -match 'selector-free Secrets Manager ARN') 'Secret-selector rejection did not identify the exact ARN contract.'
        Assert-Condition ((Get-AwsMarkerText) -notmatch 'create-change-set|execute-change-set') 'Invalid auth secret ARN reached a change-set mutation.'

        Clear-AwsMarker
        $kmsArguments = Copy-ArgumentMap -Map $baseArguments
        $kmsArguments.Action = 'Plan'
        $kmsArguments.ParameterOverride = @($parameterOverrides | Where-Object { $_ -notlike 'AuthWalletKeysKmsKeyArn=*' }) + @(
            'AuthWalletKeysKmsKeyArn=arn:aws:kms:us-west-2:999900001111:key/11111111-2222-3333-4444-555555555555'
        )
        $kmsResult = Invoke-Guard -Arguments $kmsArguments
        Assert-Condition (-not $kmsResult.Succeeded) 'Plan accepted an auth/wallet KMS key from another account.'
        Assert-Condition ($kmsResult.Output -match 'customer-managed KMS key ARN') 'KMS account rejection did not identify the exact ARN contract.'
        Assert-Condition ((Get-AwsMarkerText) -notmatch 'create-change-set|execute-change-set') 'Invalid auth KMS ARN reached a change-set mutation.'
    }

    Invoke-FocusedTest -Name 'Plan fails closed on missing or cross-boundary alarm notification topics' -Body {
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody

        Clear-AwsMarker
        $missingArguments = Copy-ArgumentMap -Map $baseArguments
        $missingArguments.Action = 'Plan'
        $missingArguments.ParameterOverride = @($parameterOverrides | Where-Object { $_ -notlike 'AlarmTopicArn=*' })
        $missing = Invoke-Guard -Arguments $missingArguments
        Assert-Condition (-not $missing.Succeeded) 'Plan accepted enabled operational alarms without an explicit notification topic.'
        Assert-Condition ($missing.Output -match 'must be explicitly supplied as one existing SNS topic ARN') 'Missing alarm topic rejection did not identify the fail-closed notification contract.'
        Assert-Condition ((Get-AwsMarkerText) -notmatch 'create-change-set|execute-change-set') 'Missing alarm topic reached a change-set mutation.'

        foreach ($invalidTopicArn in @(
                'arn:aws:sns:us-east-1:111122223333:crypto-lending-test-kan34-operations',
                'arn:aws:sns:us-west-2:999900001111:crypto-lending-test-kan34-operations',
                'arn:aws-cn:sns:us-west-2:111122223333:crypto-lending-test-kan34-operations',
                'arn:aws:sns:us-west-2:111122223333:*'
            )) {
            Clear-AwsMarker
            $invalidArguments = Copy-ArgumentMap -Map $baseArguments
            $invalidArguments.Action = 'Plan'
            $invalidArguments.ParameterOverride = @($parameterOverrides | Where-Object { $_ -notlike 'AlarmTopicArn=*' }) + @(
                "AlarmTopicArn=$invalidTopicArn"
            )
            $invalid = Invoke-Guard -Arguments $invalidArguments
            Assert-Condition (-not $invalid.Succeeded) "Plan accepted invalid alarm topic ARN '$invalidTopicArn'."
            Assert-Condition ($invalid.Output -match 'approved partition, account, and Region') 'Invalid alarm topic rejection did not identify the exact deployment boundary.'
            Assert-Condition ((Get-AwsMarkerText) -notmatch 'create-change-set|execute-change-set') 'Invalid alarm topic reached a change-set mutation.'
        }
    }

    Invoke-FocusedTest -Name 'Plan uses the no-topic sentinel only when operational alarms are disabled' -Body {
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'Plan'
        $arguments.ParameterOverride = @($parameterOverrides | Where-Object { $_ -notlike 'AlarmTopicArn=*' }) + @(
            'EnableOperationalAlarms=false'
        )
        $result = Invoke-Guard -Arguments $arguments
        $marker = Get-AwsMarkerText
        Assert-Condition $result.Succeeded "Disabled-alarm Plan failed: $($result.Output)"
        Assert-Condition ($marker -match 'ParameterKey=EnableOperationalAlarms,ParameterValue=false') 'Disabled-alarm Plan did not preserve its exact opt-out.'
        Assert-Condition ($marker -match 'ParameterKey=AlarmTopicArn,ParameterValue=NONE') 'Disabled-alarm Plan did not use the reviewed no-topic sentinel.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'Disabled-alarm Plan unexpectedly executed a change set.'
    }

    Invoke-FocusedTest -Name 'CREATE rejects every non-A_ONLY or unreviewed credential phase' -Body {
        foreach ($phaseParameter in @(
                'ApiDatabaseCredentialPhase',
                'WorkerDatabaseCredentialPhase',
                'RedisCredentialPhase'
            )) {
            foreach ($invalidCreatePhase in @('BOTH_USE_A', 'BOTH_USE_B', 'B_ONLY', 'UNREVIEWED')) {
                Clear-AwsMarker
                $arguments = Copy-ArgumentMap -Map $baseArguments
                $arguments.Action = 'Plan'
                $arguments.ParameterOverride = @($parameterOverrides) + @(
                    "$phaseParameter=$invalidCreatePhase"
                )
                $invalid = Invoke-Guard -Arguments $arguments
                Assert-Condition (-not $invalid.Succeeded) "CREATE accepted $phaseParameter=$invalidCreatePhase."
                Assert-Condition ((Get-AwsMarkerText) -eq '') "Unsafe CREATE phase $phaseParameter=$invalidCreatePhase reached AWS discovery."
            }
        }
    }

    Invoke-FocusedTest -Name 'Plan rejects a customer-owned or wrong-Region S3 prefix list' -Body {
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'Plan'

        Write-ManagedPrefixListResponse -OwnerId '111122223333'
        Clear-AwsMarker
        $wrongOwner = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $wrongOwner.Succeeded) 'Plan accepted a customer-owned prefix list as the AWS-managed S3 list.'
        Assert-Condition ($wrongOwner.Output -match 'not the exact AWS-owned') 'Wrong prefix-list owner rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -notmatch 's3api get-object|create-change-set|execute-change-set') 'Wrong prefix-list owner reached artifact billing or change-set mutation.'

        Write-ManagedPrefixListResponse -PrefixListName 'com.amazonaws.us-east-1.s3'
        Clear-AwsMarker
        $wrongRegionName = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $wrongRegionName.Succeeded) 'Plan accepted an S3 prefix list named for another Region.'
        Assert-Condition ($wrongRegionName.Output -match 'com.amazonaws.us-west-2.s3') 'Wrong prefix-list Region/name rejection did not state the exact expected identity.'
        Assert-Condition ((Get-AwsMarkerText) -notmatch 's3api get-object|create-change-set|execute-change-set') 'Wrong prefix-list Region/name reached artifact billing or change-set mutation.'
        Write-ManagedPrefixListResponse
    }

    Invoke-FocusedTest -Name 'Plan rejects wrong bucket Region and disabled versioning before change-set creation' -Body {
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'Plan'

        Clear-AwsMarker
        Write-JsonFile -Path $bucketLocationResponsePath -Value ([ordered]@{ LocationConstraint = 'us-east-2' }) -Depth 3
        $wrongRegion = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $wrongRegion.Succeeded) 'Plan accepted a child artifact bucket in the wrong Region.'
        Assert-Condition ($wrongRegion.Output -match 'not approved Region') 'Wrong artifact Region rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -notmatch 'create-change-set|execute-change-set') 'Wrong artifact Region reached change-set mutation.'

        Write-JsonFile -Path $bucketLocationResponsePath -Value ([ordered]@{ LocationConstraint = 'us-west-2' }) -Depth 3
        Write-JsonFile -Path $bucketVersioningResponsePath -Value ([ordered]@{ Status = 'Suspended' }) -Depth 3
        Clear-AwsMarker
        $suspended = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $suspended.Succeeded) 'Plan accepted a bucket without Enabled versioning.'
        Assert-Condition ($suspended.Output -match 'versioning Enabled') 'Suspended versioning rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -notmatch 'create-change-set|execute-change-set') 'Suspended versioning reached change-set mutation.'
        Write-JsonFile -Path $bucketVersioningResponsePath -Value ([ordered]@{ Status = 'Enabled' }) -Depth 3
    }

    Invoke-FocusedTest -Name 'Plan rejects wrong child VersionId and wrong child bytes before change-set creation' -Body {
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'Plan'

        Write-JsonFile -Path $artifactObjectResponsePath -Value ([ordered]@{ VersionId = 'different-version' }) -Depth 3
        Clear-AwsMarker
        $wrongVersion = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $wrongVersion.Succeeded) 'Plan accepted an S3 response for a different VersionId.'
        Assert-Condition ($wrongVersion.Output -match 'exact requested.*VersionId') 'Wrong VersionId rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -notmatch 'create-change-set|execute-change-set') 'Wrong VersionId reached change-set mutation.'

        Write-JsonFile -Path $artifactObjectResponsePath -Value ([ordered]@{ VersionId = $artifactVersionId }) -Depth 3
        [System.IO.File]::WriteAllText($artifactObjectSourcePath, $workloadBoundariesTemplateBody + "`n# mutated artifact", [System.Text.UTF8Encoding]::new($false))
        Clear-AwsMarker
        $wrongBytes = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $wrongBytes.Succeeded) 'Plan accepted versioned child bytes that differ from local review.'
        Assert-Condition ($wrongBytes.Output -match 'does not match reviewed local bytes') 'Wrong child-byte rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -notmatch 'create-change-set|execute-change-set') 'Wrong child bytes reached change-set mutation.'
        [System.IO.File]::WriteAllBytes($artifactObjectSourcePath, [System.IO.File]::ReadAllBytes($workloadBoundariesTemplatePath))
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

    Invoke-FocusedTest -Name 'Deploy rejects a self-consistent costly remote parameter mutation' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        $mutatedParameters = Copy-ArgumentMap -Map $applicationParameterMap
        $mutatedParameters.EnableDatabaseMultiAz = 'true'
        $mutatedParameterSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $mutatedParameters)
        $mutatedDescription = "KAN-34 template-sha256=$applicationTemplateSha256 child-template-sha256=$workloadBoundariesTemplateSha256 child-artifact-binding-sha256=$artifactBindingSha256 parameters-sha256=$mutatedParameterSha256 tags-sha256=$tagSha256 control-record-sha256=$controlRecordSha256 acm-dns-record-sha256=$acmDnsRecordSha256 guardrail-policy=kan-229-v1"
        Write-ChangeSetResponse -ParameterMap $mutatedParameters -Description $mutatedDescription
        $result = Invoke-Guard -Arguments $baseArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted a remotely self-consistent Multi-AZ cost mutation.'
        Assert-Condition ($result.Output -match "EnableDatabaseMultiAz.*does not match") 'Costly parameter mutation rejection did not identify the exact local mismatch.'
        Assert-Condition ($marker -notmatch 's3api get-object|execute-change-set') 'Deploy reached artifact billing or execution after remote parameter mismatch.'
    }

    Invoke-FocusedTest -Name 'Deploy requires nested-stack review context' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse -IncludeNestedStacks $false
        $result = Invoke-Guard -Arguments $baseArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted a change set without nested-stack visibility.'
        Assert-Condition ($result.Output -match 'nested-stack change visibility') 'Nested-stack review rejection was not explicit.'
        Assert-Condition ($marker -notmatch 's3api get-object|execute-change-set') 'Deploy reached artifact billing or execution without nested-stack visibility.'
    }

    Invoke-FocusedTest -Name 'Deploy re-verifies child bytes and blocks execution on artifact drift' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse
        [System.IO.File]::WriteAllText($artifactObjectSourcePath, $workloadBoundariesTemplateBody + "`n# drift before execute", [System.Text.UTF8Encoding]::new($false))
        $result = Invoke-Guard -Arguments $baseArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted drifted versioned child bytes.'
        Assert-Condition ($result.Output -match 'does not match reviewed local bytes') 'Deploy child drift rejection was not explicit.'
        Assert-Condition ($marker -match 's3api get-object') 'Deploy did not attempt exact child-byte verification.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'Deploy executed after child artifact drift.'
        [System.IO.File]::WriteAllBytes($artifactObjectSourcePath, [System.IO.File]::ReadAllBytes($workloadBoundariesTemplatePath))
    }

    Invoke-FocusedTest -Name 'Deploy re-verifies observability bytes and blocks execution on artifact drift' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse
        [System.IO.File]::WriteAllText($observabilityArtifactObjectSourcePath, $observabilityTemplateBody + "`n# drift before execute", [System.Text.UTF8Encoding]::new($false))
        $result = Invoke-Guard -Arguments $baseArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted drifted observability artifact bytes.'
        Assert-Condition ($result.Output -match 'observability artifact does not match reviewed local bytes') 'Deploy observability drift rejection was not explicit.'
        Assert-Condition ($marker -match ('--key ' + [regex]::Escape($observabilityArtifactKey))) 'Deploy did not retrieve the exact observability artifact key.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'Deploy executed after observability artifact drift.'
        [System.IO.File]::WriteAllBytes($observabilityArtifactObjectSourcePath, [System.IO.File]::ReadAllBytes($observabilityTemplatePath))
    }

    Invoke-FocusedTest -Name 'UPDATE Deploy rejects UsePreviousValue for a fixed-slot target' -Body {
        Write-ApplicationStackResponse -ParameterMap $applicationParameterMap -TagMap $applicationStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $updateApplicationParameterMap `
            -TagMap $updateApplicationStackTags `
            -Description $updateExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE' `
            -UsePreviousParameter 'ApiDatabaseSlotAVersionId'
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments $updateArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'UPDATE Deploy accepted UsePreviousValue for an exact fixed-slot target.'
        Assert-Condition ($result.Output -match 'non-explicit parameter') 'UsePreviousValue rejection was not explicit.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'UPDATE executed after accepting an implicit previous fixed-slot value.'
    }

    Invoke-FocusedTest -Name 'exact UPDATE Deploy executes only with the transition-bound acknowledgement' -Body {
        Write-ApplicationStackResponse -ParameterMap $applicationParameterMap -TagMap $applicationStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $updateApplicationParameterMap `
            -TagMap $updateApplicationStackTags `
            -Description $updateExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE'
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments $updateArguments
        $marker = Get-AwsMarkerText
        Assert-Condition $result.Succeeded "Exact transition-bound UPDATE Deploy failed: $($result.Output)"
        Assert-Condition ($marker -match 'cloudformation execute-change-set') 'Exact transition-bound UPDATE did not execute the reviewed change set.'
        Assert-Condition ($result.Output -match [regex]::Escape($transitionDeploymentBindingSha256)) 'UPDATE output did not report the transition deployment binding.'
    }

    Invoke-FocusedTest -Name 'UPDATE Deploy rejects current-stack drift immediately before execution' -Body {
        $lateDriftParameterMap = [ordered]@{}
        foreach ($entry in $updateApplicationParameterMap.GetEnumerator()) {
            $lateDriftParameterMap[$entry.Key] = [string] $entry.Value
        }
        $lateDriftParameterMap.ApiDesiredCount = '2'
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $updateApplicationStackTags
        Write-ApplicationStackResponse -ParameterMap $lateDriftParameterMap -TagMap $updateApplicationStackTags -Path $applicationStackResponseAfterFirstPath
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $applicationUpdateParameterMap `
            -TagMap $updateApplicationStackTags `
            -Description $applicationUpdateExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE'
        Clear-AwsMarker
        $env:FAKE_AWS_APPLICATION_STACK_RESPONSE_AFTER_FIRST = $applicationStackResponseAfterFirstPath
        try {
            $result = Invoke-Guard -Arguments $applicationUpdateArguments
            $marker = Get-AwsMarkerText
            Assert-Condition (-not $result.Succeeded) 'UPDATE Deploy accepted current-stack drift between verification and execution.'
            Assert-Condition ($result.Output -match 'changed after review and before execution') 'Late current-stack drift rejection was not explicit.'
            Assert-Condition ($marker -notmatch 'cloudformation execute-change-set') 'UPDATE executed after the reviewed current stack changed.'
        }
        finally {
            $env:FAKE_AWS_APPLICATION_STACK_RESPONSE_AFTER_FIRST = ''
        }
    }

    Invoke-FocusedTest -Name 'exact APPLICATION Deploy executes only with the current-state-bound acknowledgement' -Body {
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $updateApplicationStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $applicationUpdateParameterMap `
            -TagMap $updateApplicationStackTags `
            -Description $applicationUpdateExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE'
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments $applicationUpdateArguments
        $marker = Get-AwsMarkerText
        Assert-Condition $result.Succeeded "Exact current-state-bound APPLICATION Deploy failed: $($result.Output)"
        Assert-Condition ($marker -match 'cloudformation execute-change-set') 'Exact APPLICATION update did not execute the reviewed change set.'
        Assert-Condition ($result.Output -match [regex]::Escape($applicationCurrentStackBindingSha256)) 'APPLICATION output did not report the current stack binding.'
        Assert-Condition ($result.Output -notmatch 'Reviewed fixed-slot credential transition record') 'APPLICATION output incorrectly reported credential-transition evidence.'
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
        Assert-Condition ($marker -match 's3api get-object') 'Happy path did not re-verify exact versioned child bytes before execution.'
        Assert-Condition ($marker.IndexOf('s3api get-object', [System.StringComparison]::Ordinal) -lt $marker.IndexOf('cloudformation execute-change-set', [System.StringComparison]::Ordinal)) 'Deploy did not verify child bytes before execution.'
        Assert-Condition ($executeLines.Count -eq 1) 'Happy path did not invoke execute-change-set exactly once.'
        Assert-Condition ($executeLines[0] -match ('--change-set-name ' + [regex]::Escape($immutableChangeSetId) + '(?:\s|$)')) 'execute-change-set did not target the immutable change-set ARN.'
        Assert-Condition ($executeLines[0] -match ('--stack-name ' + [regex]::Escape($immutableStackId) + '(?:\s|$)')) 'execute-change-set did not target the immutable stack ARN.'
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
    $env:FAKE_AWS_APPLICATION_STACK_RESPONSE = $originalEnvironment.FAKE_AWS_APPLICATION_STACK_RESPONSE
    $env:FAKE_AWS_APPLICATION_STACK_RESPONSE_AFTER_FIRST = $originalEnvironment.FAKE_AWS_APPLICATION_STACK_RESPONSE_AFTER_FIRST
    $env:FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE = $originalEnvironment.FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE
    $env:FAKE_AWS_CHANGE_SET_RESPONSE = $originalEnvironment.FAKE_AWS_CHANGE_SET_RESPONSE
    $env:FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE = $originalEnvironment.FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE
    $env:FAKE_AWS_BUCKET_LOCATION_RESPONSE = $originalEnvironment.FAKE_AWS_BUCKET_LOCATION_RESPONSE
    $env:FAKE_AWS_BUCKET_VERSIONING_RESPONSE = $originalEnvironment.FAKE_AWS_BUCKET_VERSIONING_RESPONSE
    $env:FAKE_AWS_ARTIFACT_OBJECT_RESPONSE = $originalEnvironment.FAKE_AWS_ARTIFACT_OBJECT_RESPONSE
    $env:FAKE_AWS_ARTIFACT_OBJECT_SOURCE = $originalEnvironment.FAKE_AWS_ARTIFACT_OBJECT_SOURCE
    $env:FAKE_AWS_OBSERVABILITY_ARTIFACT_OBJECT_SOURCE = $originalEnvironment.FAKE_AWS_OBSERVABILITY_ARTIFACT_OBJECT_SOURCE
    $env:FAKE_AWS_MANAGED_PREFIX_LIST_RESPONSE = $originalEnvironment.FAKE_AWS_MANAGED_PREFIX_LIST_RESPONSE

    $resolvedTransitionDirectory = [System.IO.Path]::GetFullPath($localTransitionDirectory)
    $transitionDirectoryPrefix = $resolvedTransitionDirectory.TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    ) + [System.IO.Path]::DirectorySeparatorChar
    foreach ($transitionRecordPath in @($approvedTransitionRecordPath, $approvedRotationRecordPath)) {
        $resolvedTransitionRecordPath = [System.IO.Path]::GetFullPath($transitionRecordPath)
        if (
            $resolvedTransitionRecordPath.StartsWith($transitionDirectoryPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
            ([System.IO.Path]::GetFileName($resolvedTransitionRecordPath) -like 'invoke-application-*.credential-transition.local.json') -and
            (Test-Path -LiteralPath $resolvedTransitionRecordPath -PathType Leaf)
        ) {
            Remove-Item -LiteralPath $resolvedTransitionRecordPath -Force
        }
    }

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
