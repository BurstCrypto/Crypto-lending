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
$authWalletTransitionValidatorPath = Join-Path $PSScriptRoot 'validate-auth-wallet-secret-version-transition.mjs'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("kan34-application-guard-test-" + [guid]::NewGuid().ToString('N'))
$fakeAwsDirectory = Join-Path $temporaryRoot 'fake-aws'
$markerPath = Join-Path $temporaryRoot 'aws-calls.log'
$identityResponsePath = Join-Path $temporaryRoot 'identity.json'
$guardrailStackResponsePath = Join-Path $temporaryRoot 'guardrail-stack.json'
$applicationStackResponsePath = Join-Path $temporaryRoot 'application-stack.json'
$applicationStackResponseAfterFirstPath = Join-Path $temporaryRoot 'application-stack-after-first.json'
$workloadStackResponsePath = Join-Path $temporaryRoot 'workload-stack.json'
$workloadRootResourceResponsePath = Join-Path $temporaryRoot 'workload-root-resource.json'
$redisOperatorSecretResourceResponsePath = Join-Path $temporaryRoot 'redis-operator-secret-resource.json'
$redisOperatorUserResourceResponsePath = Join-Path $temporaryRoot 'redis-operator-user-resource.json'
$guardrailTemplateResponsePath = Join-Path $temporaryRoot 'guardrail-template.json'
$changeSetResponsePath = Join-Path $temporaryRoot 'change-set.json'
$changeSetResponseMapPath = Join-Path $temporaryRoot 'change-set-response-map.json'
$workloadChildChangeSetResponsePath = Join-Path $temporaryRoot 'workload-child-change-set.json'
$observabilityChildChangeSetResponsePath = Join-Path $temporaryRoot 'observability-child-change-set.json'
$grandchildChangeSetResponsePath = Join-Path $temporaryRoot 'grandchild-change-set.json'
$applicationTemplateResponsePath = Join-Path $temporaryRoot 'application-template.json'
$workloadCurrentTemplateResponsePath = Join-Path $temporaryRoot 'workload-current-template.json'
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
$approvedAuthWalletAdoptionRecordPath = Join-Path $localTransitionDirectory ("invoke-application-$([guid]::NewGuid().ToString('N')).auth-wallet-transition.local.json")
$approvedAuthWalletTransitionRecordPath = Join-Path $localTransitionDirectory ("invoke-application-$([guid]::NewGuid().ToString('N')).auth-wallet-transition.local.json")
$authWalletValidatorMarkerPath = Join-Path $temporaryRoot 'auth-wallet-validator-calls.log'
$immutableChangeSetId = 'arn:aws:cloudformation:us-west-2:111122223333:changeSet/kan34-application-20260819/11111111-2222-3333-4444-555555555555'
$immutableStackId = 'arn:aws:cloudformation:us-west-2:111122223333:stack/crypto-lending-application-test/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
$workloadChildChangeSetId = 'arn:aws:cloudformation:us-west-2:111122223333:changeSet/workload-child-change/11111111-aaaa-bbbb-cccc-111111111111'
$workloadChildStackId = 'arn:aws:cloudformation:us-west-2:111122223333:stack/crypto-lending-workload-test/11111111-aaaa-bbbb-cccc-111111111111'
$observabilityChildChangeSetId = 'arn:aws:cloudformation:us-west-2:111122223333:changeSet/observability-child-change/22222222-aaaa-bbbb-cccc-222222222222'
$observabilityChildStackId = 'arn:aws:cloudformation:us-west-2:111122223333:stack/crypto-lending-observability-test/22222222-aaaa-bbbb-cccc-222222222222'
$grandchildChangeSetId = 'arn:aws:cloudformation:us-west-2:111122223333:changeSet/grandchild-change/33333333-aaaa-bbbb-cccc-333333333333'
$grandchildStackId = 'arn:aws:cloudformation:us-west-2:111122223333:stack/crypto-lending-grandchild-test/33333333-aaaa-bbbb-cccc-333333333333'
$originalEnvironment = @{
    PATH = $env:PATH
    FAKE_AWS_MARKER = $env:FAKE_AWS_MARKER
    FAKE_AWS_IDENTITY_RESPONSE = $env:FAKE_AWS_IDENTITY_RESPONSE
    FAKE_AWS_GUARDRAIL_STACK_RESPONSE = $env:FAKE_AWS_GUARDRAIL_STACK_RESPONSE
    FAKE_AWS_APPLICATION_STACK_RESPONSE = $env:FAKE_AWS_APPLICATION_STACK_RESPONSE
    FAKE_AWS_APPLICATION_STACK_RESPONSE_AFTER_FIRST = $env:FAKE_AWS_APPLICATION_STACK_RESPONSE_AFTER_FIRST
    FAKE_AWS_WORKLOAD_STACK_RESPONSE = $env:FAKE_AWS_WORKLOAD_STACK_RESPONSE
    FAKE_AWS_WORKLOAD_STACK_ID = $env:FAKE_AWS_WORKLOAD_STACK_ID
    FAKE_AWS_WORKLOAD_ROOT_RESOURCE_RESPONSE = $env:FAKE_AWS_WORKLOAD_ROOT_RESOURCE_RESPONSE
    FAKE_AWS_REDIS_OPERATOR_SECRET_RESOURCE_RESPONSE = $env:FAKE_AWS_REDIS_OPERATOR_SECRET_RESOURCE_RESPONSE
    FAKE_AWS_REDIS_OPERATOR_USER_RESOURCE_RESPONSE = $env:FAKE_AWS_REDIS_OPERATOR_USER_RESOURCE_RESPONSE
    FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE = $env:FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE
    FAKE_AWS_CHANGE_SET_RESPONSE = $env:FAKE_AWS_CHANGE_SET_RESPONSE
    FAKE_AWS_CHANGE_SET_RESPONSE_MAP = $env:FAKE_AWS_CHANGE_SET_RESPONSE_MAP
    FAKE_AWS_ROOT_CHANGE_SET_ID = $env:FAKE_AWS_ROOT_CHANGE_SET_ID
    FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE = $env:FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE
    FAKE_AWS_WORKLOAD_TEMPLATE_RESPONSE = $env:FAKE_AWS_WORKLOAD_TEMPLATE_RESPONSE
    FAKE_AWS_BUCKET_LOCATION_RESPONSE = $env:FAKE_AWS_BUCKET_LOCATION_RESPONSE
    FAKE_AWS_BUCKET_VERSIONING_RESPONSE = $env:FAKE_AWS_BUCKET_VERSIONING_RESPONSE
    FAKE_AWS_ARTIFACT_OBJECT_RESPONSE = $env:FAKE_AWS_ARTIFACT_OBJECT_RESPONSE
    FAKE_AWS_ARTIFACT_OBJECT_SOURCE = $env:FAKE_AWS_ARTIFACT_OBJECT_SOURCE
    FAKE_AWS_OBSERVABILITY_ARTIFACT_OBJECT_SOURCE = $env:FAKE_AWS_OBSERVABILITY_ARTIFACT_OBJECT_SOURCE
    FAKE_AWS_MANAGED_PREFIX_LIST_RESPONSE = $env:FAKE_AWS_MANAGED_PREFIX_LIST_RESPONSE
    FAKE_REAL_NODE = $env:FAKE_REAL_NODE
    FAKE_AUTH_WALLET_VALIDATOR_MARKER = $env:FAKE_AUTH_WALLET_VALIDATOR_MARKER
    FAKE_AUTH_WALLET_VALIDATOR_VARIANT = $env:FAKE_AUTH_WALLET_VALIDATOR_VARIANT
    FAKE_AUTH_WALLET_CANONICAL_SHA256 = $env:FAKE_AUTH_WALLET_CANONICAL_SHA256
    FAKE_AUTH_WALLET_CURRENT_STATE_SHA256 = $env:FAKE_AUTH_WALLET_CURRENT_STATE_SHA256
    FAKE_AUTH_WALLET_TARGET_STATE_SHA256 = $env:FAKE_AUTH_WALLET_TARGET_STATE_SHA256
    FAKE_AUTH_WALLET_PREDECESSOR_TRANSITION_SHA256 = $env:FAKE_AUTH_WALLET_PREDECESSOR_TRANSITION_SHA256
    FAKE_AUTH_WALLET_AUTHORITY_REGISTRY_SHA256 = $env:FAKE_AUTH_WALLET_AUTHORITY_REGISTRY_SHA256
    FAKE_AUTH_WALLET_OPERATION = $env:FAKE_AUTH_WALLET_OPERATION
    FAKE_AUTH_WALLET_FIELD_NAME = $env:FAKE_AUTH_WALLET_FIELD_NAME
    FAKE_AUTH_WALLET_INITIAL_VALIDATION_AT = $env:FAKE_AUTH_WALLET_INITIAL_VALIDATION_AT
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

function Copy-JsonValue {
    param([Parameter(Mandatory = $true)] [object] $Value)

    return (($Value | ConvertTo-Json -Depth 20 -Compress) | ConvertFrom-Json)
}

function New-NestedChangeSetLink {
    param(
        [Parameter(Mandatory = $true)]
        [string] $LogicalResourceId,
        [Parameter(Mandatory = $true)]
        [string] $StackId,
        [Parameter(Mandatory = $true)]
        [string] $ChangeSetId,
        [ValidateSet('Tags', 'Automatic')]
        [string] $DetailKind = 'Tags'
    )

    [string[]] $scope = if ($DetailKind -ceq 'Tags') { @('Tags') } else { @('Properties') }
    $detail = if ($DetailKind -ceq 'Tags') {
        [ordered]@{
            ChangeSource = 'DirectModification'
            Evaluation = 'Static'
            Target = [ordered]@{
                Attribute = 'Tags'
                RequiresRecreation = 'Never'
            }
        }
    }
    else {
        [ordered]@{
            ChangeSource = 'Automatic'
            Evaluation = 'Dynamic'
            Target = [ordered]@{
                Attribute = 'Properties'
                RequiresRecreation = 'Never'
            }
        }
    }
    return [ordered]@{
        Type = 'Resource'
        ResourceChange = [ordered]@{
            Action = 'Modify'
            LogicalResourceId = $LogicalResourceId
            PhysicalResourceId = $StackId
            ResourceType = 'AWS::CloudFormation::Stack'
            Replacement = 'False'
            ChangeSetId = $ChangeSetId
            Scope = $scope
            Details = @($detail)
        }
    }
}

function Clear-AwsMarker {
    if (Test-Path -LiteralPath $markerPath) {
        Remove-Item -LiteralPath $markerPath -Force
    }
}

function Clear-AuthWalletValidatorMarker {
    if (Test-Path -LiteralPath $authWalletValidatorMarkerPath) {
        Remove-Item -LiteralPath $authWalletValidatorMarkerPath -Force
    }
}

function Set-FakeAuthWalletValidationFixture {
    param(
        [string] $CanonicalSha256,
        [string] $CurrentStateSha256,
        [string] $TargetStateSha256,
        [string] $PredecessorTransitionSha256,
        [string] $AuthorityRegistrySha256,
        [string] $Operation,
        [string] $FieldName,
        [string] $InitialValidationAt,
        [string] $Variant = ''
    )

    $env:FAKE_AUTH_WALLET_CANONICAL_SHA256 = $CanonicalSha256
    $env:FAKE_AUTH_WALLET_CURRENT_STATE_SHA256 = $CurrentStateSha256
    $env:FAKE_AUTH_WALLET_TARGET_STATE_SHA256 = $TargetStateSha256
    $env:FAKE_AUTH_WALLET_PREDECESSOR_TRANSITION_SHA256 = if ([string]::IsNullOrWhiteSpace($PredecessorTransitionSha256)) {
        if ($Operation -ceq 'ADOPT_EXISTING_BINDING') { 'NONE' } else { 'd' * 64 }
    }
    else {
        $PredecessorTransitionSha256
    }
    $env:FAKE_AUTH_WALLET_AUTHORITY_REGISTRY_SHA256 = $AuthorityRegistrySha256
    $env:FAKE_AUTH_WALLET_OPERATION = $Operation
    $env:FAKE_AUTH_WALLET_FIELD_NAME = $FieldName
    $env:FAKE_AUTH_WALLET_INITIAL_VALIDATION_AT = $InitialValidationAt
    $env:FAKE_AUTH_WALLET_VALIDATOR_VARIANT = $Variant
    Clear-AuthWalletValidatorMarker
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
        [string[]] $Capabilities = @('CAPABILITY_IAM'),
        [AllowEmptyCollection()]
        [object[]] $Changes = @(),
        [AllowNull()]
        [object] $NextToken = $null
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
    $response = [ordered]@{
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
            Changes = $Changes
    }
    if ($null -ne $NextToken) {
        $response['NextToken'] = $NextToken
    }
    Write-JsonFile -Path $changeSetResponsePath -Value $response
}

function Write-NestedChangeSetResponse {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,
        [Parameter(Mandatory = $true)]
        [string] $StackName,
        [Parameter(Mandatory = $true)]
        [string] $StackId,
        [Parameter(Mandatory = $true)]
        [string] $ChangeSetName,
        [Parameter(Mandatory = $true)]
        [string] $ChangeSetId,
        [Parameter(Mandatory = $true)]
        [string] $ParentChangeSetId,
        [Parameter(Mandatory = $true)]
        [string] $RootChangeSetId,
        [AllowEmptyCollection()]
        [object[]] $Changes = @(),
        [string] $Status = 'CREATE_COMPLETE',
        [string] $ExecutionStatus = 'UNAVAILABLE',
        [bool] $IncludeNestedStacks = $true,
        [AllowNull()]
        [object] $NextToken = $null,
        [switch] $OmitChangeSetType
    )

    $response = [ordered]@{
        StackName = $StackName
        StackId = $StackId
        ChangeSetName = $ChangeSetName
        ChangeSetId = $ChangeSetId
        ParentChangeSetId = $ParentChangeSetId
        RootChangeSetId = $RootChangeSetId
        IncludeNestedStacks = $IncludeNestedStacks
        Status = $Status
        ExecutionStatus = $ExecutionStatus
        Changes = $Changes
    }
    if (-not $OmitChangeSetType) {
        $response['ChangeSetType'] = 'UPDATE'
    }
    if ($null -ne $NextToken) {
        $response['NextToken'] = $NextToken
    }
    Write-JsonFile -Path $Path -Value $response -Depth 14
}

function Set-FakeChangeSetResponseMap {
    param([System.Collections.IDictionary] $ResponseMap)

    Write-JsonFile -Path $changeSetResponseMapPath -Value $ResponseMap -Depth 4
    $env:FAKE_AWS_CHANGE_SET_RESPONSE_MAP = $changeSetResponseMapPath
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
        [int] $Generation,
        [AllowNull()]
        [string[]] $RedisOperatorUsedVersionIds = $null
    )

    $resolvedRedisOperatorHistory = @()
    if ($null -ne $RedisOperatorUsedVersionIds) {
        $resolvedRedisOperatorHistory = @($RedisOperatorUsedVersionIds)
    }
    elseif ([string] $Versions.RedisOperatorSecretVersionId -cne 'UNPINNED') {
        $resolvedRedisOperatorHistory = @([string] $Versions.RedisOperatorSecretVersionId)
    }
    return [ordered]@{
        operatorMode = 'DISABLED'
        redisOperatorSecretVersionId = [string] $Versions.RedisOperatorSecretVersionId
        redisOperatorUsedVersionIds = $resolvedRedisOperatorHistory
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
        RedisOperatorSecretVersionId = 'UNPINNED'
        ApiDatabaseSlotAVersionId = 'UNPINNED'
        ApiDatabaseSlotBVersionId = 'UNPINNED'
        WorkerDatabaseSlotAVersionId = 'UNPINNED'
        WorkerDatabaseSlotBVersionId = 'UNPINNED'
        RedisApiSlotAVersionId = 'UNPINNED'
        RedisApiSlotBVersionId = 'UNPINNED'
    }
    return [ordered]@{
        schemaVersion = 3
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
        schemaVersion = 3
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

function Write-WorkloadStackResponse {
    param(
        [Parameter(Mandatory = $true)]
        [string] $RedisOperatorVersionId,
        [Parameter(Mandatory = $true)]
        [string] $ApplicationDataKeyArn,
        [string] $Path = $workloadStackResponsePath,
        [string] $ParentId = $immutableStackId,
        [string] $RootId = $immutableStackId,
        [string] $StackStatus = 'UPDATE_COMPLETE'
    )

    $parameters = @(
        [ordered]@{ ParameterKey = 'DeliveryArtifactSha256'; ParameterValue = $workloadBoundariesTemplateSha256 },
        [ordered]@{ ParameterKey = 'DeliveryArtifactBindingSha256'; ParameterValue = $artifactBindingSha256 },
        [ordered]@{ ParameterKey = 'EnvironmentName'; ParameterValue = 'test-kan34' },
        [ordered]@{ ParameterKey = 'ApplicationDataKeyArn'; ParameterValue = $ApplicationDataKeyArn },
        [ordered]@{ ParameterKey = 'RedisOperatorSecretVersionId'; ParameterValue = $RedisOperatorVersionId },
        [ordered]@{ ParameterKey = 'RedisOperatorMode'; ParameterValue = 'DISABLED' }
    )
    Write-JsonFile -Path $Path -Value ([ordered]@{
            Stacks = @(
                [ordered]@{
                    StackName = 'crypto-lending-workload-test'
                    StackId = $workloadChildStackId
                    ParentId = $ParentId
                    RootId = $RootId
                    StackStatus = $StackStatus
                    Parameters = $parameters
                    Tags = @()
                }
            )
        }) -Depth 7
}

function Write-StackResourceResponse {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,
        [Parameter(Mandatory = $true)]
        [string] $StackName,
        [Parameter(Mandatory = $true)]
        [string] $StackId,
        [Parameter(Mandatory = $true)]
        [string] $LogicalResourceId,
        [Parameter(Mandatory = $true)]
        [string] $PhysicalResourceId,
        [Parameter(Mandatory = $true)]
        [string] $ResourceType,
        [string] $ResourceStatus = 'UPDATE_COMPLETE'
    )

    Write-JsonFile -Path $Path -Value ([ordered]@{
            StackResourceDetail = [ordered]@{
                StackName = $StackName
                StackId = $StackId
                LogicalResourceId = $LogicalResourceId
                PhysicalResourceId = $PhysicalResourceId
                ResourceType = $ResourceType
                ResourceStatus = $ResourceStatus
            }
        }) -Depth 5
}

if (-not (Test-Path -LiteralPath $guardPath -PathType Leaf)) {
    throw "Application guard under test was not found: $guardPath"
}
foreach ($requiredFile in @($applicationTemplatePath, $workloadBoundariesTemplatePath, $observabilityTemplatePath, $guardrailTemplatePath, $recordValidatorPath, $acmDnsRecordValidatorPath, $fixedSlotCredentialTransitionValidatorPath, $authWalletTransitionValidatorPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required focused-test input was not found: $requiredFile"
    }
}

$realNodeCommand = Get-Command node -ErrorAction Stop
New-Item -ItemType Directory -Path $fakeAwsDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $localTransitionDirectory -Force | Out-Null
$fakeAwsScriptPath = Join-Path $fakeAwsDirectory 'aws.ps1'
@'
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $AwsArguments
)

$ErrorActionPreference = 'Stop'
if ($AwsArguments.Count -eq 1 -and $AwsArguments[0] -match '\s--') {
    $AwsArguments = @($AwsArguments[0] -split '\s+')
}
Add-Content -LiteralPath $env:FAKE_AWS_MARKER -Value ($AwsArguments -join ' ') -Encoding Ascii

function Write-ResponseFile {
    param([string] $Path)
    Write-Output -NoEnumerate ([System.IO.File]::ReadAllText($Path))
}

if ($AwsArguments.Count -lt 2) {
    $global:LASTEXITCODE = 98
    return
}
$service = $AwsArguments[0]
$operation = $AwsArguments[1]
if ($service -eq 'sts' -and $operation -eq 'get-caller-identity') {
    Write-ResponseFile -Path $env:FAKE_AWS_IDENTITY_RESPONSE
    $global:LASTEXITCODE = 0
    return
}
if ($service -eq 'cloudformation' -and $operation -eq 'describe-stacks') {
    $stackNameIndex = [array]::IndexOf($AwsArguments, '--stack-name')
    $requestedStack = if ($stackNameIndex -ge 0) { $AwsArguments[$stackNameIndex + 1] } else { '' }
    if ($requestedStack -eq [Environment]::GetEnvironmentVariable('FAKE_AWS_WORKLOAD_STACK_ID')) {
        Write-ResponseFile -Path $env:FAKE_AWS_WORKLOAD_STACK_RESPONSE
        $global:LASTEXITCODE = 0
        return
    }
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
            $global:LASTEXITCODE = 0
            return
        }
        Write-ResponseFile -Path $env:FAKE_AWS_APPLICATION_STACK_RESPONSE
        $global:LASTEXITCODE = 0
        return
    }
    Write-ResponseFile -Path $env:FAKE_AWS_GUARDRAIL_STACK_RESPONSE
    $global:LASTEXITCODE = 0
    return
}
if ($service -eq 'cloudformation' -and $operation -eq 'describe-stack-resource') {
    $stackNameIndex = [array]::IndexOf($AwsArguments, '--stack-name')
    $logicalIdIndex = [array]::IndexOf($AwsArguments, '--logical-resource-id')
    $requestedStack = if ($stackNameIndex -ge 0) { $AwsArguments[$stackNameIndex + 1] } else { '' }
    $requestedLogicalId = if ($logicalIdIndex -ge 0) { $AwsArguments[$logicalIdIndex + 1] } else { '' }
    $workloadStackId = [Environment]::GetEnvironmentVariable('FAKE_AWS_WORKLOAD_STACK_ID')
    if (
        ($requestedStack -eq 'crypto-lending-application-test' -or $requestedStack -like '*:stack/crypto-lending-application-test/*') -and
        $requestedLogicalId -eq 'WorkloadBoundaries'
    ) {
        Write-ResponseFile -Path $env:FAKE_AWS_WORKLOAD_ROOT_RESOURCE_RESPONSE
        $global:LASTEXITCODE = 0
        return
    }
    if ($requestedStack -eq $workloadStackId -and $requestedLogicalId -eq 'RedisOperatorSecret') {
        Write-ResponseFile -Path $env:FAKE_AWS_REDIS_OPERATOR_SECRET_RESOURCE_RESPONSE
        $global:LASTEXITCODE = 0
        return
    }
    if ($requestedStack -eq $workloadStackId -and $requestedLogicalId -eq 'RedisOperatorUser') {
        Write-ResponseFile -Path $env:FAKE_AWS_REDIS_OPERATOR_USER_RESOURCE_RESPONSE
        $global:LASTEXITCODE = 0
        return
    }
    $global:LASTEXITCODE = 96
    return
}
if ($service -eq 's3api' -and $operation -eq 'get-bucket-location') {
    Write-ResponseFile -Path $env:FAKE_AWS_BUCKET_LOCATION_RESPONSE
    $global:LASTEXITCODE = 0
    return
}
if ($service -eq 's3api' -and $operation -eq 'get-bucket-versioning') {
    Write-ResponseFile -Path $env:FAKE_AWS_BUCKET_VERSIONING_RESPONSE
    $global:LASTEXITCODE = 0
    return
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
    $global:LASTEXITCODE = 0
    return
}
if ($service -eq 'ec2' -and $operation -eq 'describe-managed-prefix-lists') {
    Write-ResponseFile -Path $env:FAKE_AWS_MANAGED_PREFIX_LIST_RESPONSE
    $global:LASTEXITCODE = 0
    return
}
if ($service -eq 'cloudformation' -and $operation -eq 'create-change-set') {
    Write-Output -NoEnumerate '{"Id":"arn:aws:cloudformation:us-west-2:111122223333:changeSet/kan34-application-20260819/11111111-2222-3333-4444-555555555555","StackId":"arn:aws:cloudformation:us-west-2:111122223333:stack/crypto-lending-application-test/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}'
    $global:LASTEXITCODE = 0
    return
}
if ($service -eq 'cloudformation' -and $operation -eq 'get-template') {
    $stackNameIndex = [array]::IndexOf($AwsArguments, '--stack-name')
    $requestedStack = if ($stackNameIndex -ge 0) { $AwsArguments[$stackNameIndex + 1] } else { '' }
    if ($requestedStack -eq [Environment]::GetEnvironmentVariable('FAKE_AWS_WORKLOAD_STACK_ID')) {
        Write-ResponseFile -Path $env:FAKE_AWS_WORKLOAD_TEMPLATE_RESPONSE
        $global:LASTEXITCODE = 0
        return
    }
    if (
        $AwsArguments -contains '--change-set-name' -or
        $requestedStack -eq 'crypto-lending-application-test' -or
        $requestedStack -like '*:stack/crypto-lending-application-test/*'
    ) {
        Write-ResponseFile -Path $env:FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE
        $global:LASTEXITCODE = 0
        return
    }
    Write-ResponseFile -Path $env:FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE
    $global:LASTEXITCODE = 0
    return
}
if ($service -eq 'cloudformation' -and $operation -eq 'describe-change-set') {
    $changeSetNameIndex = [array]::IndexOf($AwsArguments, '--change-set-name')
    $requestedChangeSet = if ($changeSetNameIndex -ge 0) { $AwsArguments[$changeSetNameIndex + 1] } else { '' }
    $responseMapPath = [Environment]::GetEnvironmentVariable('FAKE_AWS_CHANGE_SET_RESPONSE_MAP')
    if (-not [string]::IsNullOrWhiteSpace($responseMapPath) -and (Test-Path -LiteralPath $responseMapPath -PathType Leaf)) {
        $responseMap = [System.IO.File]::ReadAllText($responseMapPath) | ConvertFrom-Json
        $mappedResponse = $responseMap.PSObject.Properties[$requestedChangeSet]
        if ($null -ne $mappedResponse -and $mappedResponse.Value -is [string] -and (Test-Path -LiteralPath $mappedResponse.Value -PathType Leaf)) {
            Write-ResponseFile -Path $mappedResponse.Value
            $global:LASTEXITCODE = 0
            return
        }
    }
    $rootChangeSetId = [Environment]::GetEnvironmentVariable('FAKE_AWS_ROOT_CHANGE_SET_ID')
    if (
        $requestedChangeSet -ne 'kan34-application-20260819' -and
        $requestedChangeSet -ne $rootChangeSetId
    ) {
        $global:LASTEXITCODE = 97
        return
    }
    Write-ResponseFile -Path $env:FAKE_AWS_CHANGE_SET_RESPONSE
    $global:LASTEXITCODE = 0
    return
}
if ($service -eq 'cloudformation' -and $operation -eq 'execute-change-set') {
    Write-Output -NoEnumerate '{}'
    $global:LASTEXITCODE = 0
    return
}
$global:LASTEXITCODE = 99
return
'@ | Set-Content -LiteralPath $fakeAwsScriptPath -Encoding Ascii
$isWindowsPlatform = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
if ($isWindowsPlatform) {
    $fakeAwsCommandPath = $fakeAwsScriptPath
}
else {
    $fakeAwsCommandPath = Join-Path $fakeAwsDirectory 'aws'
    @'
#!/usr/bin/env sh
script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec pwsh -NoProfile -File "$script_directory/aws.ps1" "$@"
'@ | Set-Content -LiteralPath $fakeAwsCommandPath -Encoding Ascii
    & chmod +x $fakeAwsCommandPath
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to mark the fake AWS executable as executable.'
    }
}

$fakeNodeScriptPath = Join-Path $fakeAwsDirectory 'node.ps1'
@'
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $NodeArguments
)

$ErrorActionPreference = 'Stop'
if ($NodeArguments.Count -eq 1 -and $NodeArguments[0] -match '\s--') {
    $NodeArguments = @($NodeArguments[0] -split '\s+')
}
if ($NodeArguments.Count -eq 0 -or (Split-Path -Leaf $NodeArguments[0]) -cne 'validate-auth-wallet-secret-version-transition.mjs') {
    & $env:FAKE_REAL_NODE @NodeArguments
    return
}

function Get-ArgumentValue {
    param([string] $Name)
    $index = [array]::IndexOf($NodeArguments, $Name)
    if ($index -lt 0 -or $index + 1 -ge $NodeArguments.Count) {
        return ''
    }
    return [string] $NodeArguments[$index + 1]
}

$mode = Get-ArgumentValue -Name '--mode'
$validationAt = Get-ArgumentValue -Name '--at'
$currentVersionId = Get-ArgumentValue -Name '--expected-current-version-id'
$targetVersionId = Get-ArgumentValue -Name '--expected-target-version-id'
Add-Content -LiteralPath $env:FAKE_AUTH_WALLET_VALIDATOR_MARKER -Value "mode=$mode at=$validationAt current=$currentVersionId target=$targetVersionId" -Encoding Ascii
$callCount = @(Get-Content -LiteralPath $env:FAKE_AUTH_WALLET_VALIDATOR_MARKER).Count
$variant = [string] $env:FAKE_AUTH_WALLET_VALIDATOR_VARIANT
if ($variant -ceq 'FAIL_ALWAYS' -or ($variant -ceq 'FAIL_FRESH' -and $callCount -gt 2)) {
    $global:LASTEXITCODE = 1
    return
}

$operation = [string] $env:FAKE_AUTH_WALLET_OPERATION
$fieldName = [string] $env:FAKE_AUTH_WALLET_FIELD_NAME
$authorityRegistrySha256 = [string] $env:FAKE_AUTH_WALLET_AUTHORITY_REGISTRY_SHA256
$targetStateSha256 = [string] $env:FAKE_AUTH_WALLET_TARGET_STATE_SHA256
$predecessorTransitionSha256 = [string] $env:FAKE_AUTH_WALLET_PREDECESSOR_TRANSITION_SHA256
$productionAuthorityValidated = $true
if ($variant -ceq 'WRONG_REGISTRY') {
    $authorityRegistrySha256 = '0' * 64
}
elseif ($variant -ceq 'UNAUTHORIZED') {
    $productionAuthorityValidated = $false
}
elseif ($variant -ceq 'MALFORMED_PREDECESSOR') {
    $predecessorTransitionSha256 = 'NONE'
}
elseif ($variant -ceq 'WRONG_PREDECESSOR') {
    $predecessorTransitionSha256 = '8' * 64
}
elseif ($variant -ceq 'CURRENT_BINDING_MISMATCH') {
    $currentVersionId = 'auth_wallet_keys_secret_version_0001'
}
elseif ($variant -ceq 'DRIFT_FRESH' -and $callCount -gt 2) {
    $targetStateSha256 = '9' * 64
}

$report = [ordered]@{
    ok = $true
    readyForAuthorizedPlan = $true
    productionAuthorityValidated = $productionAuthorityValidated
    signatureValidated = $true
    mode = $mode
    operation = $operation
    fieldName = $fieldName
    canonicalSha256 = [string] $env:FAKE_AUTH_WALLET_CANONICAL_SHA256
    currentStateSha256 = [string] $env:FAKE_AUTH_WALLET_CURRENT_STATE_SHA256
    targetStateSha256 = $targetStateSha256
    predecessorTransitionSha256 = $predecessorTransitionSha256
    authorityRegistrySha256 = $authorityRegistrySha256
    plan = [ordered]@{
        kind = 'LOCAL_ONLY_NON_EXECUTABLE_AUTH_WALLET_VERSION_PLAN'
        operation = $operation
        fieldName = $fieldName
        versionParameter = 'AuthWalletKeysSecretVersionId'
        currentVersionId = $currentVersionId
        targetVersionId = $targetVersionId
        executionAllowed = $false
        separateAuthorizationRequired = $true
    }
    errors = @()
    externalCallsMade = 0
    awsCallsMade = 0
    databaseConnectionsMade = 0
    redisConnectionsMade = 0
    dnsQueriesMade = 0
    httpRequestsMade = 0
    resourcesCreated = 0
    credentialBytesRead = 0
    filesWritten = 0
}
if ($variant -ceq 'STRING_ZERO') {
    $report.awsCallsMade = '0'
}
Write-Output -NoEnumerate ($report | ConvertTo-Json -Depth 8 -Compress)
$global:LASTEXITCODE = 0
return
'@ | Set-Content -LiteralPath $fakeNodeScriptPath -Encoding Ascii
if ($isWindowsPlatform) {
    $fakeNodeCommandPath = $fakeNodeScriptPath
}
else {
    $fakeNodeCommandPath = Join-Path $fakeAwsDirectory 'node'
    @'
#!/usr/bin/env sh
script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec pwsh -NoProfile -File "$script_directory/node.ps1" "$@"
'@ | Set-Content -LiteralPath $fakeNodeCommandPath -Encoding Ascii
    & chmod +x $fakeNodeCommandPath
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to mark the fake Node executable as executable.'
    }
}

$env:PATH = $fakeAwsDirectory + [System.IO.Path]::PathSeparator + $originalEnvironment.PATH
$env:FAKE_REAL_NODE = $realNodeCommand.Source
$env:FAKE_AUTH_WALLET_VALIDATOR_MARKER = $authWalletValidatorMarkerPath
$env:FAKE_AUTH_WALLET_VALIDATOR_VARIANT = ''
$env:FAKE_AWS_MARKER = $markerPath
$env:FAKE_AWS_IDENTITY_RESPONSE = $identityResponsePath
$env:FAKE_AWS_GUARDRAIL_STACK_RESPONSE = $guardrailStackResponsePath
$env:FAKE_AWS_APPLICATION_STACK_RESPONSE = $applicationStackResponsePath
$env:FAKE_AWS_APPLICATION_STACK_RESPONSE_AFTER_FIRST = ''
$env:FAKE_AWS_WORKLOAD_STACK_RESPONSE = $workloadStackResponsePath
$env:FAKE_AWS_WORKLOAD_STACK_ID = $workloadChildStackId
$env:FAKE_AWS_WORKLOAD_ROOT_RESOURCE_RESPONSE = $workloadRootResourceResponsePath
$env:FAKE_AWS_REDIS_OPERATOR_SECRET_RESOURCE_RESPONSE = $redisOperatorSecretResourceResponsePath
$env:FAKE_AWS_REDIS_OPERATOR_USER_RESOURCE_RESPONSE = $redisOperatorUserResourceResponsePath
$env:FAKE_AWS_GUARDRAIL_TEMPLATE_RESPONSE = $guardrailTemplateResponsePath
$env:FAKE_AWS_CHANGE_SET_RESPONSE = $changeSetResponsePath
$env:FAKE_AWS_CHANGE_SET_RESPONSE_MAP = ''
$env:FAKE_AWS_ROOT_CHANGE_SET_ID = $immutableChangeSetId
$env:FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE = $applicationTemplateResponsePath
$env:FAKE_AWS_WORKLOAD_TEMPLATE_RESPONSE = $workloadCurrentTemplateResponsePath
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
$authWalletKeysSecretVersionId = @('auth', 'wallet', 'keys', 'secret', 'version', '0001') -join '_'
if ($authWalletKeysSecretVersionId -cnotmatch '^[A-Za-z0-9_-]{32,64}$') {
    throw 'Focused auth/wallet secret VersionId fixture is malformed.'
}
$redisOperatorSecretVersionId = @('redis', 'operator', 'secret', 'version', '0001') -join '_'
if ($redisOperatorSecretVersionId -cnotmatch '^[A-Za-z0-9_-]{32,64}$') {
    throw 'Focused Redis operator secret VersionId fixture is malformed.'
}
$applicationParameterMap = [ordered]@{
    EnvironmentName = 'test-kan34'
    WorkloadBoundariesTemplateUrl = $artifactTemplateUrl
    WorkloadBoundariesTemplateSha256 = $workloadBoundariesTemplateSha256
    WorkloadBoundariesArtifactBindingSha256 = $artifactBindingSha256
    ObservabilityTemplateUrl = $observabilityTemplateUrl
    ObservabilityTemplateSha256 = $observabilityTemplateSha256
    ObservabilityArtifactBindingSha256 = $observabilityArtifactBindingSha256
    RedisOperatorSecretVersionId = 'UNPINNED'
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
    AuthWalletKeysSecretVersionId = $authWalletKeysSecretVersionId
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
    AuthWalletKeysSecretVersionId = $authWalletKeysSecretVersionId
    RedisOperatorSecretVersionId = 'UNPINNED'
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

$pinnedCredentialVersions = [ordered]@{
    RedisOperatorSecretVersionId = $redisOperatorSecretVersionId
    ApiDatabaseSlotAVersionId = 'api_database_slot_a_version_00001'
    ApiDatabaseSlotBVersionId = 'api_database_slot_b_version_00001'
    WorkerDatabaseSlotAVersionId = 'worker_database_slot_a_version_01'
    WorkerDatabaseSlotBVersionId = 'worker_database_slot_b_version_01'
    RedisApiSlotAVersionId = 'redis_api_slot_a_version_00000001'
    RedisApiSlotBVersionId = 'redis_api_slot_b_version_00000001'
}
foreach ($fixtureVersion in $pinnedCredentialVersions.Values) {
    if ([string] $fixtureVersion -cnotmatch '^[A-Za-z0-9_-]{32,64}$') {
        throw "Focused fixed-slot fixture VersionId has invalid length or characters: $fixtureVersion"
    }
}
$transitionFixtureNow = [DateTime]::UtcNow
$transitionValidationAt = $transitionFixtureNow.ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
$approvedTransitionRecord = New-AdoptionTransitionRecord `
    -PinnedVersions $pinnedCredentialVersions `
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
foreach ($entry in $pinnedCredentialVersions.GetEnumerator()) {
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
$authWalletTransitionAuthorityRegistrySha256 = ('c' * 64)
$authWalletAdoptionRecordSha256 = ('d' * 64)
$authWalletAdoptionStateSha256 = ('e' * 64)
$authWalletTransitionRecordSha256 = ('f' * 64)
$authWalletTransitionTargetStateSha256 = ('0' * 64)
$authWalletTargetVersionId = 'auth_wallet_keys_secret_version_0002'
$authWalletValidationAt = $transitionFixtureNow.AddMinutes(-1).ToString('yyyy-MM-ddTHH:mm:ssZ', [System.Globalization.CultureInfo]::InvariantCulture)
$authWalletAdoptionRecord = [ordered]@{
    content = [ordered]@{
        operation = [ordered]@{ action = 'ADOPT_EXISTING_BINDING'; fieldName = 'ALL_SEVEN_FIELDS' }
        predecessor = [ordered]@{ stateSha256 = 'UNTRACKED'; transitionSha256 = 'NONE' }
        currentState = [ordered]@{
            secretArn = [string] $applicationParameterMap.AuthWalletKeysSecretArn
            kmsKeyArn = [string] $applicationParameterMap.AuthWalletKeysKmsKeyArn
            currentVersionId = $authWalletKeysSecretVersionId
        }
        targetState = [ordered]@{
            secretArn = [string] $applicationParameterMap.AuthWalletKeysSecretArn
            kmsKeyArn = [string] $applicationParameterMap.AuthWalletKeysKmsKeyArn
            currentVersionId = $authWalletKeysSecretVersionId
        }
    }
}
$authWalletTransitionRecord = [ordered]@{
    content = [ordered]@{
        operation = [ordered]@{ action = 'STAGE_SUCCESSOR'; fieldName = 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' }
        predecessor = [ordered]@{
            stateSha256 = $authWalletAdoptionStateSha256
            transitionSha256 = $authWalletAdoptionRecordSha256
        }
        currentState = [ordered]@{
            secretArn = [string] $applicationParameterMap.AuthWalletKeysSecretArn
            kmsKeyArn = [string] $applicationParameterMap.AuthWalletKeysKmsKeyArn
            currentVersionId = $authWalletKeysSecretVersionId
        }
        targetState = [ordered]@{
            secretArn = [string] $applicationParameterMap.AuthWalletKeysSecretArn
            kmsKeyArn = [string] $applicationParameterMap.AuthWalletKeysKmsKeyArn
            currentVersionId = $authWalletTargetVersionId
        }
    }
}
Write-JsonFile -Path $approvedAuthWalletAdoptionRecordPath -Value $authWalletAdoptionRecord -Depth 8
Write-JsonFile -Path $approvedAuthWalletTransitionRecordPath -Value $authWalletTransitionRecord -Depth 8
$authWalletAdoptedStackTags = [ordered]@{}
foreach ($entry in $updateApplicationStackTags.GetEnumerator()) {
    $authWalletAdoptedStackTags[$entry.Key] = [string] $entry.Value
}
$authWalletAdoptedStackTags['auth-wallet-predecessor-sha256'] = 'NONE'
$authWalletAdoptedStackTags['auth-wallet-transition-sha256'] = $authWalletAdoptionRecordSha256
$authWalletAdoptedStackTags['auth-wallet-state-sha256'] = $authWalletAdoptionStateSha256
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
foreach ($entry in $pinnedCredentialVersions.GetEnumerator()) {
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
$applicationCurrentTagSnapshotSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $authWalletAdoptedStackTags)
$applicationCurrentStackBindingText = "current-stack-id=$immutableStackId`ncurrent-parent-template-sha256=$applicationTemplateSha256`ncurrent-stack-parameters-sha256=$applicationCurrentParameterSnapshotSha256`ncurrent-stack-tags-sha256=$applicationCurrentTagSnapshotSha256`nupdate-intent=APPLICATION"
$applicationCurrentStackBindingSha256 = Get-TextSha256 -Value $applicationCurrentStackBindingText
$applicationUpdateParameterSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $applicationUpdateParameterMap)
$applicationUpdateTagSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $authWalletAdoptedStackTags)
$applicationUpdateExpectedChangeSetDescription = "KAN-34 template-sha256=$applicationTemplateSha256 workload-template-sha256=$workloadBoundariesTemplateSha256 workload-binding-sha256=$artifactBindingSha256 observability-template-sha256=$observabilityTemplateSha256 observability-binding-sha256=$observabilityArtifactBindingSha256 parameters-sha256=$applicationUpdateParameterSha256 tags-sha256=$applicationUpdateTagSha256 control-record-sha256=$controlRecordSha256 acm-dns-record-sha256=$acmDnsRecordSha256 guardrail-policy=kan-229-v1 current-stack-binding-sha256=$applicationCurrentStackBindingSha256"
$applicationUpdateBillableAcknowledgement = "EXECUTE IMMUTABLE CHANGE SET $immutableChangeSetId FOR IMMUTABLE STACK $immutableStackId WITH PARAMETERS $applicationUpdateParameterSha256 WORKLOAD TEMPLATE $workloadBoundariesTemplateSha256 WORKLOAD BINDING $artifactBindingSha256 OBSERVABILITY TEMPLATE $observabilityTemplateSha256 OBSERVABILITY BINDING $observabilityArtifactBindingSha256 CURRENT STACK STATE $applicationCurrentStackBindingSha256 USING BILLING CONTROL $controlRecordSha256 AND ACM DNS CONTROL $acmDnsRecordSha256; I ACKNOWLEDGE BILLABLE AWS RESOURCES IN ACCOUNT 111122223333 REGION us-west-2 USING PROFILE kan34-test"
$applicationUpdateArguments = Copy-ArgumentMap -Map $updateArguments
$applicationUpdateArguments.UpdateIntent = 'APPLICATION'
[void] $applicationUpdateArguments.Remove('FixedSlotCredentialTransitionRecordFile')
[void] $applicationUpdateArguments.Remove('FixedSlotCredentialTransitionMode')
[void] $applicationUpdateArguments.Remove('FixedSlotCredentialTransitionValidationAt')
$applicationUpdateArguments.ParameterOverride = $applicationUpdateParameterOverrides
$applicationUpdateArguments.BillableAcknowledgement = $applicationUpdateBillableAcknowledgement

$rotatedFixedSlotVersions = [ordered]@{}
foreach ($entry in $pinnedCredentialVersions.GetEnumerator()) {
    $rotatedFixedSlotVersions[$entry.Key] = [string] $entry.Value
}
$rotatedFixedSlotVersions.ApiDatabaseSlotBVersionId = 'api_database_slot_b_version_00002'
$approvedRotationRecord = New-PreparationTransitionRecord `
    -PinnedVersions $pinnedCredentialVersions `
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
foreach ($entry in $authWalletAdoptedStackTags.GetEnumerator()) {
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

$authWalletAdoptionCurrentStackBindingText = "current-stack-id=$immutableStackId`ncurrent-parent-template-sha256=$applicationTemplateSha256`ncurrent-stack-parameters-sha256=$applicationCurrentParameterSnapshotSha256`ncurrent-stack-tags-sha256=$(Get-TextSha256 -Value (Get-CanonicalMapText -Map $updateApplicationStackTags))`nupdate-intent=AUTH_WALLET_TRANSITION"
$authWalletAdoptionCurrentStackBindingSha256 = Get-TextSha256 -Value $authWalletAdoptionCurrentStackBindingText
$authWalletAdoptionDeploymentBindingText = "record-sha256=$authWalletAdoptionRecordSha256`ncurrent-state-sha256=$authWalletAdoptionStateSha256`ntarget-state-sha256=$authWalletAdoptionStateSha256`npredecessor-transition-sha256=NONE`nauthority-registry-sha256=$authWalletTransitionAuthorityRegistrySha256`ncurrent-stack-id=$immutableStackId`nparent-template-sha256=$applicationTemplateSha256`nworkload-template-sha256=$workloadBoundariesTemplateSha256`nobservability-template-sha256=$observabilityTemplateSha256`nmode=adopt`noperation=ADOPT_EXISTING_BINDING`nfield=ALL_SEVEN_FIELDS`ncurrent-stack-binding-sha256=$authWalletAdoptionCurrentStackBindingSha256"
$authWalletAdoptionDeploymentBindingSha256 = Get-TextSha256 -Value $authWalletAdoptionDeploymentBindingText
$authWalletAdoptionExpectedChangeSetDescription = "KAN-34 template-sha256=$applicationTemplateSha256 workload-template-sha256=$workloadBoundariesTemplateSha256 workload-binding-sha256=$artifactBindingSha256 observability-template-sha256=$observabilityTemplateSha256 observability-binding-sha256=$observabilityArtifactBindingSha256 parameters-sha256=$updateParameterSha256 tags-sha256=$applicationUpdateTagSha256 control-record-sha256=$controlRecordSha256 acm-dns-record-sha256=$acmDnsRecordSha256 guardrail-policy=kan-229-v1 current-stack-binding-sha256=$authWalletAdoptionCurrentStackBindingSha256 auth-wallet-transition-binding-sha256=$authWalletAdoptionDeploymentBindingSha256 auth-wallet-authority-registry-sha256=$authWalletTransitionAuthorityRegistrySha256"
$authWalletAdoptionBillableAcknowledgement = "EXECUTE IMMUTABLE CHANGE SET $immutableChangeSetId FOR IMMUTABLE STACK $immutableStackId WITH PARAMETERS $updateParameterSha256 WORKLOAD TEMPLATE $workloadBoundariesTemplateSha256 WORKLOAD BINDING $artifactBindingSha256 OBSERVABILITY TEMPLATE $observabilityTemplateSha256 OBSERVABILITY BINDING $observabilityArtifactBindingSha256 CURRENT STACK STATE $authWalletAdoptionCurrentStackBindingSha256 AUTH-WALLET TRANSITION $authWalletAdoptionRecordSha256 FROM STATE $authWalletAdoptionStateSha256 TO STATE $authWalletAdoptionStateSha256 USING AUTHORITY REGISTRY $authWalletTransitionAuthorityRegistrySha256 BOUND BY $authWalletAdoptionDeploymentBindingSha256 WITH TAGS $applicationUpdateTagSha256 USING BILLING CONTROL $controlRecordSha256 AND ACM DNS CONTROL $acmDnsRecordSha256; I ACKNOWLEDGE BILLABLE AWS RESOURCES IN ACCOUNT 111122223333 REGION us-west-2 USING PROFILE kan34-test"
$authWalletAdoptionArguments = Copy-ArgumentMap -Map $updateArguments
$authWalletAdoptionArguments.UpdateIntent = 'AUTH_WALLET_TRANSITION'
[void] $authWalletAdoptionArguments.Remove('FixedSlotCredentialTransitionRecordFile')
[void] $authWalletAdoptionArguments.Remove('FixedSlotCredentialTransitionMode')
[void] $authWalletAdoptionArguments.Remove('FixedSlotCredentialTransitionValidationAt')
$authWalletAdoptionArguments.AuthWalletTransitionRecordFile = $approvedAuthWalletAdoptionRecordPath
$authWalletAdoptionArguments.AuthWalletTransitionMode = 'adopt'
$authWalletAdoptionArguments.AuthWalletTransitionValidationAt = $authWalletValidationAt
$authWalletAdoptionArguments.AuthWalletTransitionAuthorityRegistrySha256 = $authWalletTransitionAuthorityRegistrySha256
$authWalletAdoptionArguments.AuthWalletTransitionCurrentVersionId = $authWalletKeysSecretVersionId
$authWalletAdoptionArguments.AuthWalletTransitionOperation = 'ADOPT_EXISTING_BINDING'
$authWalletAdoptionArguments.AuthWalletTransitionFieldName = 'ALL_SEVEN_FIELDS'
$authWalletAdoptionArguments.BillableAcknowledgement = $authWalletAdoptionBillableAcknowledgement

$authWalletTransitionParameterMap = [ordered]@{}
foreach ($entry in $updateApplicationParameterMap.GetEnumerator()) {
    $authWalletTransitionParameterMap[$entry.Key] = [string] $entry.Value
}
$authWalletTransitionParameterMap.AuthWalletKeysSecretVersionId = $authWalletTargetVersionId
$authWalletTransitionStackTags = [ordered]@{}
foreach ($entry in $authWalletAdoptedStackTags.GetEnumerator()) {
    $authWalletTransitionStackTags[$entry.Key] = [string] $entry.Value
}
$authWalletTransitionStackTags['auth-wallet-predecessor-sha256'] = $authWalletAdoptionRecordSha256
$authWalletTransitionStackTags['auth-wallet-transition-sha256'] = $authWalletTransitionRecordSha256
$authWalletTransitionStackTags['auth-wallet-state-sha256'] = $authWalletTransitionTargetStateSha256
$authWalletTransitionCurrentStackBindingText = "current-stack-id=$immutableStackId`ncurrent-parent-template-sha256=$applicationTemplateSha256`ncurrent-stack-parameters-sha256=$applicationCurrentParameterSnapshotSha256`ncurrent-stack-tags-sha256=$applicationCurrentTagSnapshotSha256`nupdate-intent=AUTH_WALLET_TRANSITION"
$authWalletTransitionCurrentStackBindingSha256 = Get-TextSha256 -Value $authWalletTransitionCurrentStackBindingText
$authWalletTransitionDeploymentBindingText = "record-sha256=$authWalletTransitionRecordSha256`ncurrent-state-sha256=$authWalletAdoptionStateSha256`ntarget-state-sha256=$authWalletTransitionTargetStateSha256`npredecessor-transition-sha256=$authWalletAdoptionRecordSha256`nauthority-registry-sha256=$authWalletTransitionAuthorityRegistrySha256`ncurrent-stack-id=$immutableStackId`nparent-template-sha256=$applicationTemplateSha256`nworkload-template-sha256=$workloadBoundariesTemplateSha256`nobservability-template-sha256=$observabilityTemplateSha256`nmode=transition`noperation=STAGE_SUCCESSOR`nfield=AUTH_IDENTITY_HMAC_KEY_RING_JSON`ncurrent-stack-binding-sha256=$authWalletTransitionCurrentStackBindingSha256"
$authWalletTransitionDeploymentBindingSha256 = Get-TextSha256 -Value $authWalletTransitionDeploymentBindingText
$authWalletTransitionParameterSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $authWalletTransitionParameterMap)
$authWalletTransitionTagSha256 = Get-TextSha256 -Value (Get-CanonicalMapText -Map $authWalletTransitionStackTags)
$authWalletTransitionExpectedChangeSetDescription = "KAN-34 template-sha256=$applicationTemplateSha256 workload-template-sha256=$workloadBoundariesTemplateSha256 workload-binding-sha256=$artifactBindingSha256 observability-template-sha256=$observabilityTemplateSha256 observability-binding-sha256=$observabilityArtifactBindingSha256 parameters-sha256=$authWalletTransitionParameterSha256 tags-sha256=$authWalletTransitionTagSha256 control-record-sha256=$controlRecordSha256 acm-dns-record-sha256=$acmDnsRecordSha256 guardrail-policy=kan-229-v1 current-stack-binding-sha256=$authWalletTransitionCurrentStackBindingSha256 auth-wallet-transition-binding-sha256=$authWalletTransitionDeploymentBindingSha256 auth-wallet-authority-registry-sha256=$authWalletTransitionAuthorityRegistrySha256"
$authWalletTransitionBillableAcknowledgement = "EXECUTE IMMUTABLE CHANGE SET $immutableChangeSetId FOR IMMUTABLE STACK $immutableStackId WITH PARAMETERS $authWalletTransitionParameterSha256 WORKLOAD TEMPLATE $workloadBoundariesTemplateSha256 WORKLOAD BINDING $artifactBindingSha256 OBSERVABILITY TEMPLATE $observabilityTemplateSha256 OBSERVABILITY BINDING $observabilityArtifactBindingSha256 CURRENT STACK STATE $authWalletTransitionCurrentStackBindingSha256 AUTH-WALLET TRANSITION $authWalletTransitionRecordSha256 FROM STATE $authWalletAdoptionStateSha256 TO STATE $authWalletTransitionTargetStateSha256 USING AUTHORITY REGISTRY $authWalletTransitionAuthorityRegistrySha256 BOUND BY $authWalletTransitionDeploymentBindingSha256 WITH TAGS $authWalletTransitionTagSha256 USING BILLING CONTROL $controlRecordSha256 AND ACM DNS CONTROL $acmDnsRecordSha256; I ACKNOWLEDGE BILLABLE AWS RESOURCES IN ACCOUNT 111122223333 REGION us-west-2 USING PROFILE kan34-test"
$authWalletTransitionArguments = Copy-ArgumentMap -Map $authWalletAdoptionArguments
$authWalletTransitionArguments.AuthWalletKeysSecretVersionId = $authWalletTargetVersionId
$authWalletTransitionArguments.AuthWalletTransitionRecordFile = $approvedAuthWalletTransitionRecordPath
$authWalletTransitionArguments.AuthWalletTransitionMode = 'transition'
$authWalletTransitionArguments.AuthWalletTransitionOperation = 'STAGE_SUCCESSOR'
$authWalletTransitionArguments.AuthWalletTransitionFieldName = 'AUTH_IDENTITY_HMAC_KEY_RING_JSON'
$authWalletTransitionArguments.BillableAcknowledgement = $authWalletTransitionBillableAcknowledgement
$expectedAuthWalletResourceChanges = @(
    [ordered]@{
        Type = 'Resource'
        ResourceChange = [ordered]@{
            Action = 'Modify'
            LogicalResourceId = 'ApiTaskDefinition'
            ResourceType = 'AWS::ECS::TaskDefinition'
            Replacement = 'True'
            Scope = @('Properties', 'Tags')
            Details = @(
                [ordered]@{
                    ChangeSource = 'DirectModification'
                    Evaluation = 'Dynamic'
                    Target = [ordered]@{
                        Attribute = 'Properties'
                        Name = 'ContainerDefinitions'
                        RequiresRecreation = 'Always'
                    }
                },
                [ordered]@{
                    CausingEntity = 'AuthWalletKeysSecretVersionId'
                    ChangeSource = 'ParameterReference'
                    Evaluation = 'Static'
                    Target = [ordered]@{
                        Attribute = 'Properties'
                        Name = 'ContainerDefinitions'
                        RequiresRecreation = 'Always'
                    }
                },
                [ordered]@{
                    ChangeSource = 'DirectModification'
                    Evaluation = 'Static'
                    Target = [ordered]@{
                        Attribute = 'Tags'
                        RequiresRecreation = 'Never'
                    }
                }
            )
        }
    },
    [ordered]@{
        Type = 'Resource'
        ResourceChange = [ordered]@{
            Action = 'Modify'
            LogicalResourceId = 'ApiService'
            ResourceType = 'AWS::ECS::Service'
            Replacement = 'False'
            Scope = @('Tags', 'Properties')
            Details = @(
                [ordered]@{
                    CausingEntity = 'ApiTaskDefinition'
                    ChangeSource = 'ResourceReference'
                    Evaluation = 'Dynamic'
                    Target = [ordered]@{
                        Attribute = 'Properties'
                        Name = 'TaskDefinition'
                        RequiresRecreation = 'Never'
                    }
                },
                [ordered]@{
                    ChangeSource = 'DirectModification'
                    Evaluation = 'Static'
                    Target = [ordered]@{
                        Attribute = 'Tags'
                        RequiresRecreation = 'Never'
                    }
                }
            )
        }
    }
)
$tagOnlyAuthWalletResourceChange = [ordered]@{
    Type = 'Resource'
    ResourceChange = [ordered]@{
        Action = 'Modify'
        LogicalResourceId = 'WebService'
        ResourceType = 'AWS::ECS::Service'
        Replacement = 'False'
        Scope = @('Tags')
        Details = @(
            [ordered]@{
                ChangeSource = 'DirectModification'
                Evaluation = 'Static'
                Target = [ordered]@{
                    Attribute = 'Tags'
                    RequiresRecreation = 'Never'
                }
            }
        )
    }
}
$expectedRedisOperatorFunctionalChange = [ordered]@{
    Type = 'Resource'
    ResourceChange = [ordered]@{
        Action = 'Modify'
        LogicalResourceId = 'RedisOperatorUser'
        ResourceType = 'AWS::ElastiCache::User'
        Replacement = 'False'
        Scope = @('Properties')
        Details = @(
            [ordered]@{
                ChangeSource = 'DirectModification'
                Evaluation = 'Dynamic'
                Target = [ordered]@{
                    Attribute = 'Properties'
                    Name = 'AuthenticationMode'
                    RequiresRecreation = 'Never'
                    AttributeChangeType = 'Modify'
                    Path = '/Properties/AuthenticationMode/Passwords'
                    BeforeValue = 'REDACTED_CURRENT'
                    AfterValue = 'REDACTED_TARGET'
                }
            },
            [ordered]@{
                CausingEntity = 'RedisOperatorSecretVersionId'
                ChangeSource = 'ParameterReference'
                Evaluation = 'Static'
                Target = [ordered]@{
                    Attribute = 'Properties'
                    Name = 'AuthenticationMode'
                    RequiresRecreation = 'Never'
                }
            }
        )
    }
}
Write-ApplicationStackResponse -ParameterMap $applicationParameterMap -TagMap $applicationStackTags
Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody

$transitionReviewModule = New-Module -ArgumentList $guardPath -ScriptBlock {
    param([string] $GuardUnderTest)
    . $GuardUnderTest -Action LocalValidate *> $null
}
if ($null -eq $transitionReviewModule) {
    throw 'Unable to load the transition review functions into an isolated local test module.'
}

function Invoke-RedisChangeReview {
    param(
        [AllowEmptyCollection()]
        [object[]] $Changes,
        [ValidateSet('adopt', 'transition')]
        [string] $Mode = 'transition'
    )

    $payload = [pscustomobject]@{
        ChangesJson = ConvertTo-Json -InputObject @($Changes) -Depth 20 -Compress
        Mode = $Mode
        RootChangeSetId = $immutableChangeSetId
        FakeAwsPath = $fakeAwsCommandPath
    }
    try {
        $output = @(& $transitionReviewModule {
                param([object] $Payload)
                $script:AccountId = '111122223333'
                $script:Region = 'us-west-2'
                $script:AwsExecutable = [string] $Payload.FakeAwsPath
                $parsedReviewChanges = ([string] $Payload.ChangesJson) | ConvertFrom-Json
                $reviewChanges = @($parsedReviewChanges)
                Assert-AuthWalletRootChanges `
                    -Changes $reviewChanges `
                    -Mode ([string] $Payload.Mode) `
                    -RootChangeSetId ([string] $Payload.RootChangeSetId) `
                    -Partition 'aws' `
                    -ProfileName 'kan34-test-profile' `
                    -ReviewIntent 'REDIS_OPERATOR_TRANSITION'
            } $payload 2>&1)
        return [pscustomobject]@{ Succeeded = $true; Output = ($output -join "`n") }
    }
    catch {
        return [pscustomobject]@{ Succeeded = $false; Output = $_.Exception.Message }
    }
}

function Invoke-RedisWorkloadChildReview {
    param(
        [AllowEmptyCollection()]
        [object[]] $ChildChanges,
        [string] $RootLogicalResourceId = 'WorkloadBoundaries',
        [string] $DetailKind = 'Automatic',
        [ValidateSet('adopt', 'transition')]
        [string] $Mode = 'transition',
        [AllowNull()]
        [object] $NextToken = $null
    )

    $rootLink = New-NestedChangeSetLink `
        -LogicalResourceId $RootLogicalResourceId `
        -StackId $workloadChildStackId `
        -ChangeSetId $workloadChildChangeSetId `
        -DetailKind $DetailKind
    Write-NestedChangeSetResponse `
        -Path $workloadChildChangeSetResponsePath `
        -StackName 'crypto-lending-workload-test' `
        -StackId $workloadChildStackId `
        -ChangeSetName 'workload-child-change' `
        -ChangeSetId $workloadChildChangeSetId `
        -ParentChangeSetId $immutableChangeSetId `
        -RootChangeSetId $immutableChangeSetId `
        -Changes $ChildChanges `
        -NextToken $NextToken
    Set-FakeChangeSetResponseMap -ResponseMap ([ordered]@{ $workloadChildChangeSetId = $workloadChildChangeSetResponsePath })
    try {
        return Invoke-RedisChangeReview -Changes @($rootLink) -Mode $Mode
    }
    finally {
        $env:FAKE_AWS_CHANGE_SET_RESPONSE_MAP = ''
    }
}

try {
    Invoke-FocusedTest -Name 'default LocalValidate makes zero AWS calls' -Body {
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments @{}
        Assert-Condition $result.Succeeded "LocalValidate failed: $($result.Output)"
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'LocalValidate invoked the fake AWS CLI.'
        Assert-Condition ($result.Output -match 'No AWS calls were made') 'LocalValidate did not report its zero-call boundary.'
    }

    Invoke-FocusedTest -Name 'Redis recursive review accepts only exact immediate Workload functional changes' -Body {
        Clear-AwsMarker
        $exactFunctional = Copy-JsonValue -Value $expectedRedisOperatorFunctionalChange
        $exact = Invoke-RedisWorkloadChildReview -ChildChanges @($exactFunctional)
        Assert-Condition $exact.Succeeded "Exact immediate RedisOperatorUser change was rejected: $($exact.Output)"

        $emptyAdoption = Invoke-RedisChangeReview -Changes @() -Mode 'adopt'
        Assert-Condition $emptyAdoption.Succeeded "Empty Redis chain adoption review was rejected: $($emptyAdoption.Output)"
        $tagOnlyAdoptionLeaf = Copy-JsonValue -Value $tagOnlyAuthWalletResourceChange
        $tagOnlyAdoptionLeaf.ResourceChange.LogicalResourceId = 'RedisOperatorUser'
        $tagOnlyAdoptionLeaf.ResourceChange.ResourceType = 'AWS::ElastiCache::User'
        $tagOnlyAdoption = Invoke-RedisWorkloadChildReview -ChildChanges @($tagOnlyAdoptionLeaf) -Mode 'adopt' -DetailKind 'Tags'
        Assert-Condition $tagOnlyAdoption.Succeeded "Tag-only Redis adoption propagation was rejected: $($tagOnlyAdoption.Output)"
        $propertyAdoption = Invoke-RedisWorkloadChildReview -ChildChanges @($exactFunctional) -Mode 'adopt'
        Assert-Condition (-not $propertyAdoption.Succeeded) 'Redis adoption accepted a functional AuthenticationMode mutation.'
    }

    Invoke-FocusedTest -Name 'Redis functional review rejects malformed scope details and causal evidence' -Body {
        $redisFunctionalCases = @(
            [pscustomobject]@{
                Name = 'scope outside Properties and Tags'
                Mutate = { param($change) $change.ResourceChange.Scope = @('Properties', 'Metadata') }
            },
            [pscustomobject]@{
                Name = 'missing direct dynamic detail'
                Mutate = { param($change) $change.ResourceChange.Details = @($change.ResourceChange.Details[1]) }
            },
            [pscustomobject]@{
                Name = 'missing parameter detail'
                Mutate = { param($change) $change.ResourceChange.Details = @($change.ResourceChange.Details[0]) }
            },
            [pscustomobject]@{
                Name = 'wrong parameter cause'
                Mutate = { param($change) $change.ResourceChange.Details[1].CausingEntity = 'RedisApiSlotAVersionId' }
            },
            [pscustomobject]@{
                Name = 'wrong direct evaluation'
                Mutate = { param($change) $change.ResourceChange.Details[0].Evaluation = 'Static' }
            },
            [pscustomobject]@{
                Name = 'add change type'
                Mutate = { param($change) $change.ResourceChange.Details[0].Target.AttributeChangeType = 'Add' }
            },
            [pscustomobject]@{
                Name = 'AccessString path'
                Mutate = { param($change) $change.ResourceChange.Details[0].Target.Path = '/Properties/AccessString' }
            },
            [pscustomobject]@{
                Name = 'AuthenticationMode AccessString path'
                Mutate = { param($change) $change.ResourceChange.Details[0].Target.Path = '/Properties/AuthenticationMode/AccessString' }
            },
            [pscustomobject]@{
                Name = 'AuthenticationMode Type path'
                Mutate = { param($change) $change.ResourceChange.Details[0].Target.Path = '/Properties/AuthenticationMode/Type' }
            },
            [pscustomobject]@{
                Name = 'AuthenticationMode near-prefix path'
                Mutate = { param($change) $change.ResourceChange.Details[0].Target.Path = '/Properties/AuthenticationModeEvil' }
            },
            [pscustomobject]@{
                Name = 'replacement recreation detail'
                Mutate = { param($change) $change.ResourceChange.Details[0].Target.RequiresRecreation = 'Always' }
            },
            [pscustomobject]@{
                Name = 'non-string before value'
                Mutate = { param($change) $change.ResourceChange.Details[0].Target.BeforeValue = @('bad') }
            },
            [pscustomobject]@{
                Name = 'unexpected property'
                Mutate = { param($change) $change.ResourceChange.Details[0].Target.Name = 'AccessString' }
            },
            [pscustomobject]@{
                Name = 'wrong resource type'
                Mutate = { param($change) $change.ResourceChange.ResourceType = 'AWS::ElastiCache::UserGroup' }
            },
            [pscustomobject]@{
                Name = 'wrong action'
                Mutate = { param($change) $change.ResourceChange.Action = 'Remove' }
            },
            [pscustomobject]@{
                Name = 'replacement'
                Mutate = { param($change) $change.ResourceChange.Replacement = 'True' }
            },
            [pscustomobject]@{
                Name = 'policy action'
                Mutate = { param($change) Add-Member -InputObject $change.ResourceChange -NotePropertyName PolicyAction -NotePropertyValue 'ReplaceAndDelete' }
            }
        )
        foreach ($functionalCase in $redisFunctionalCases) {
            $change = Copy-JsonValue -Value $expectedRedisOperatorFunctionalChange
            & $functionalCase.Mutate $change
            $review = Invoke-RedisWorkloadChildReview -ChildChanges @($change)
            Assert-Condition (-not $review.Succeeded) "Redis review accepted $($functionalCase.Name)."
            Assert-Condition ($review.Output -match 'REDIS_OPERATOR_TRANSITION') "$($functionalCase.Name) rejection was not Redis-specific: $($review.Output)"
        }
    }

    Invoke-FocusedTest -Name 'Redis recursive review rejects misplaced missing duplicated paginated and cyclic changes' -Body {
        $functional = Copy-JsonValue -Value $expectedRedisOperatorFunctionalChange
        $directRoot = Invoke-RedisChangeReview -Changes @($functional)
        Assert-Condition (-not $directRoot.Succeeded) 'Redis review accepted RedisOperatorUser directly in the root change set.'

        $observability = Invoke-RedisWorkloadChildReview -ChildChanges @($functional) -RootLogicalResourceId 'Observability'
        Assert-Condition (-not $observability.Succeeded) 'Redis review accepted RedisOperatorUser under Observability.'
        Assert-Condition ($observability.Output -match 'direct WorkloadBoundaries') 'Observability placement rejection was not explicit.'

        $missing = Invoke-RedisWorkloadChildReview -ChildChanges @()
        Assert-Condition (-not $missing.Succeeded) 'Redis transition accepted a missing RedisOperatorUser functional change.'
        Assert-Condition ($missing.Output -match 'missing its exact reviewed RedisOperatorUser') 'Missing Redis functional change rejection was not explicit.'

        $duplicateA = Copy-JsonValue -Value $expectedRedisOperatorFunctionalChange
        $duplicateB = Copy-JsonValue -Value $expectedRedisOperatorFunctionalChange
        $duplicate = Invoke-RedisWorkloadChildReview -ChildChanges @($duplicateA, $duplicateB)
        Assert-Condition (-not $duplicate.Succeeded) 'Redis review accepted duplicate child logical IDs.'

        $spoofed = Copy-JsonValue -Value $expectedRedisOperatorFunctionalChange
        Add-Member -InputObject $spoofed.ResourceChange -NotePropertyName ChangeSetId -NotePropertyValue $grandchildChangeSetId
        $spoofedReview = Invoke-RedisWorkloadChildReview -ChildChanges @($spoofed)
        Assert-Condition (-not $spoofedReview.Succeeded) 'Redis review accepted a non-stack leaf carrying a child ChangeSetId.'

        $paginated = Invoke-RedisWorkloadChildReview -ChildChanges @($functional) -NextToken 'hidden-page'
        Assert-Condition (-not $paginated.Succeeded) 'Redis review accepted an uninspected child page.'
        Assert-Condition ($paginated.Output -match 'pagination token') 'Redis child pagination rejection was not explicit.'

        $grandchildLink = New-NestedChangeSetLink `
            -LogicalResourceId 'DeeperStack' `
            -StackId $grandchildStackId `
            -ChangeSetId $grandchildChangeSetId `
            -DetailKind 'Automatic'
        Write-NestedChangeSetResponse `
            -Path $workloadChildChangeSetResponsePath `
            -StackName 'crypto-lending-workload-test' `
            -StackId $workloadChildStackId `
            -ChangeSetName 'workload-child-change' `
            -ChangeSetId $workloadChildChangeSetId `
            -ParentChangeSetId $immutableChangeSetId `
            -RootChangeSetId $immutableChangeSetId `
            -Changes @($grandchildLink)
        Write-NestedChangeSetResponse `
            -Path $grandchildChangeSetResponsePath `
            -StackName 'crypto-lending-grandchild-test' `
            -StackId $grandchildStackId `
            -ChangeSetName 'grandchild-change' `
            -ChangeSetId $grandchildChangeSetId `
            -ParentChangeSetId $workloadChildChangeSetId `
            -RootChangeSetId $immutableChangeSetId `
            -Changes @($functional)
        $rootLink = New-NestedChangeSetLink `
            -LogicalResourceId 'WorkloadBoundaries' `
            -StackId $workloadChildStackId `
            -ChangeSetId $workloadChildChangeSetId `
            -DetailKind 'Automatic'
        Set-FakeChangeSetResponseMap -ResponseMap ([ordered]@{
                $workloadChildChangeSetId = $workloadChildChangeSetResponsePath
                $grandchildChangeSetId = $grandchildChangeSetResponsePath
            })
        try {
            $deep = Invoke-RedisChangeReview -Changes @($rootLink)
            Assert-Condition (-not $deep.Succeeded) 'Redis review accepted its functional change below the direct Workload child.'
            Assert-Condition ($deep.Output -match 'direct WorkloadBoundaries') 'Deep Redis placement rejection was not explicit.'
        }
        finally {
            $env:FAKE_AWS_CHANGE_SET_RESPONSE_MAP = ''
        }

        $cycleLink = New-NestedChangeSetLink `
            -LogicalResourceId 'CycleStack' `
            -StackId $immutableStackId `
            -ChangeSetId $immutableChangeSetId `
            -DetailKind 'Automatic'
        $cycle = Invoke-RedisWorkloadChildReview -ChildChanges @($cycleLink)
        Assert-Condition (-not $cycle.Succeeded) 'Redis review accepted a cyclic child change-set ID.'
        Assert-Condition ($cycle.Output -match 'duplicate or cyclic') 'Redis cycle rejection was not explicit.'

        Write-NestedChangeSetResponse `
            -Path $workloadChildChangeSetResponsePath `
            -StackName 'crypto-lending-workload-test' `
            -StackId $workloadChildStackId `
            -ChangeSetName 'workload-child-change' `
            -ChangeSetId $workloadChildChangeSetId `
            -ParentChangeSetId $immutableChangeSetId `
            -RootChangeSetId $immutableChangeSetId `
            -Changes @($functional)
        $malformedChild = [System.IO.File]::ReadAllText($workloadChildChangeSetResponsePath) | ConvertFrom-Json
        $malformedChild.Changes = 'not-an-array'
        Write-JsonFile -Path $workloadChildChangeSetResponsePath -Value $malformedChild -Depth 14
        Set-FakeChangeSetResponseMap -ResponseMap ([ordered]@{ $workloadChildChangeSetId = $workloadChildChangeSetResponsePath })
        try {
            $malformed = Invoke-RedisChangeReview -Changes @($rootLink)
            Assert-Condition (-not $malformed.Succeeded) 'Redis review accepted malformed child Changes.'
            Assert-Condition ($malformed.Output -match 'exact JSON array') 'Malformed Redis child Changes rejection was not explicit.'
        }
        finally {
            $env:FAKE_AWS_CHANGE_SET_RESPONSE_MAP = ''
        }
    }

    Invoke-FocusedTest -Name 'Plan requires an exact named auth wallet secret VersionId before AWS discovery' -Body {
        Clear-AwsMarker
        $missingArguments = Copy-ArgumentMap -Map $baseArguments
        $missingArguments.Action = 'Plan'
        [void] $missingArguments.Remove('AuthWalletKeysSecretVersionId')
        $missing = Invoke-Guard -Arguments $missingArguments
        Assert-Condition (-not $missing.Succeeded) 'Plan accepted a missing auth/wallet secret VersionId.'
        Assert-Condition ($missing.Output -match 'AuthWalletKeysSecretVersionId must be supplied explicitly') 'Missing auth/wallet VersionId rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Missing auth/wallet VersionId reached AWS discovery.'

        foreach ($invalidVersion in @(
                'UNPINNED',
                'AWSCURRENT',
                ('a' * 31),
                ('a' * 65),
                (('a' * 31) + '!')
            )) {
            Clear-AwsMarker
            $invalidArguments = Copy-ArgumentMap -Map $baseArguments
            $invalidArguments.Action = 'Plan'
            $invalidArguments.AuthWalletKeysSecretVersionId = $invalidVersion
            $invalid = Invoke-Guard -Arguments $invalidArguments
            Assert-Condition (-not $invalid.Succeeded) "Plan accepted invalid auth/wallet VersionId '$invalidVersion'."
            Assert-Condition ($invalid.Output -match 'exact 32-64 character Secrets Manager VersionId') 'Malformed auth/wallet VersionId rejection was not explicit.'
            Assert-Condition ((Get-AwsMarkerText) -eq '') 'Malformed auth/wallet VersionId reached AWS discovery.'
        }

        Clear-AwsMarker
        $overrideArguments = Copy-ArgumentMap -Map $baseArguments
        $overrideArguments.Action = 'Plan'
        $overrideArguments.ParameterOverride = @($parameterOverrides) + @(
            "AuthWalletKeysSecretVersionId=$authWalletKeysSecretVersionId"
        )
        $override = Invoke-Guard -Arguments $overrideArguments
        Assert-Condition (-not $override.Succeeded) 'Plan accepted auth/wallet VersionId through ParameterOverride.'
        Assert-Condition ($override.Output -match 'named immutable binding') 'Auth/wallet VersionId override rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Auth/wallet VersionId override reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'Plan requires all seven explicit credential VersionIds before AWS discovery' -Body {
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $baseArguments
        $arguments.Action = 'Plan'
        [void] $arguments.Remove('RedisOperatorSecretVersionId')
        $result = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $result.Succeeded) 'Plan accepted a missing Redis operator VersionId.'
        Assert-Condition ($result.Output -match 'RedisOperatorSecretVersionId must be supplied explicitly') 'Missing Redis operator VersionId rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Missing Redis operator VersionId reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'Plan rejects malformed and mixed credential VersionIds before AWS discovery' -Body {
        foreach ($invalidVersion in @('AWSCURRENT', 'unpinned', 'short', ('a' * 65), (('a' * 31) + '!'))) {
            Clear-AwsMarker
            $malformedArguments = Copy-ArgumentMap -Map $baseArguments
            $malformedArguments.Action = 'Plan'
            $malformedArguments.RedisOperatorSecretVersionId = $invalidVersion
            $malformed = Invoke-Guard -Arguments $malformedArguments
            Assert-Condition (-not $malformed.Succeeded) "Plan accepted malformed Redis operator VersionId '$invalidVersion'."
            Assert-Condition ($malformed.Output -match '32-64 character') 'Malformed Redis operator VersionId rejection was not explicit.'
            Assert-Condition ((Get-AwsMarkerText) -eq '') 'Malformed Redis operator VersionId reached AWS discovery.'
        }

        Clear-AwsMarker
        $mixedArguments = Copy-ArgumentMap -Map $baseArguments
        $mixedArguments.Action = 'Plan'
        $mixedArguments.RedisOperatorSecretVersionId = [string] $pinnedCredentialVersions.RedisOperatorSecretVersionId
        $mixed = Invoke-Guard -Arguments $mixedArguments
        Assert-Condition (-not $mixed.Succeeded) 'Plan accepted an exact Redis operator version alongside six UNPINNED fixed slots.'
        Assert-Condition ($mixed.Output -match 'mixed state is prohibited') 'Mixed VersionId rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Mixed VersionId state reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'CREATE enforces seven UNPINNED versions, zero counts, A_ONLY phases, and disabled Redis operator before AWS' -Body {
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
        Assert-Condition ($mixedIntent.Output -match 'must not supply fixed-slot, auth/wallet, or Redis operator transition inputs') 'Mixed update-intent rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Mixed update intent reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'auth wallet intent requires every dedicated input and exact authority digest with zero AWS calls' -Body {
        foreach ($missingInput in @(
                'AuthWalletTransitionRecordFile',
                'AuthWalletTransitionMode',
                'AuthWalletTransitionValidationAt',
                'AuthWalletTransitionAuthorityRegistrySha256',
                'AuthWalletTransitionCurrentVersionId',
                'AuthWalletTransitionOperation',
                'AuthWalletTransitionFieldName'
            )) {
            Clear-AwsMarker
            $arguments = Copy-ArgumentMap -Map $authWalletAdoptionArguments
            $arguments.Action = 'Plan'
            [void] $arguments.Remove($missingInput)
            $result = Invoke-Guard -Arguments $arguments
            Assert-Condition (-not $result.Succeeded) "AUTH_WALLET_TRANSITION accepted missing $missingInput."
            Assert-Condition ($result.Output -match [regex]::Escape("$missingInput must be supplied explicitly")) "Missing $missingInput rejection was not explicit. Output: $($result.Output)"
            Assert-Condition ((Get-AwsMarkerText) -eq '') "Missing $missingInput reached AWS discovery."
        }

        Clear-AwsMarker
        $invalidDigestArguments = Copy-ArgumentMap -Map $authWalletAdoptionArguments
        $invalidDigestArguments.Action = 'Plan'
        $invalidDigestArguments.AuthWalletTransitionAuthorityRegistrySha256 = ('C' * 64)
        $invalidDigest = Invoke-Guard -Arguments $invalidDigestArguments
        Assert-Condition (-not $invalidDigest.Succeeded) 'AUTH_WALLET_TRANSITION accepted a non-lowercase authority registry digest.'
        Assert-Condition ($invalidDigest.Output -match 'exact lowercase SHA-256') 'Malformed authority digest rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Malformed authority digest reached AWS discovery.'
    }

    Invoke-FocusedTest -Name 'update intents reject cross-intent transition inputs before AWS discovery' -Body {
        foreach ($case in @(
                [pscustomobject]@{
                    Name = 'APPLICATION auth/wallet evidence'
                    Arguments = $applicationUpdateArguments
                    Add = @{ AuthWalletTransitionRecordFile = $approvedAuthWalletAdoptionRecordPath }
                    Error = 'must not supply fixed-slot, auth/wallet, or Redis operator transition inputs'
                },
                [pscustomobject]@{
                    Name = 'CREDENTIAL_TRANSITION auth/wallet authority digest'
                    Arguments = $updateArguments
                    Add = @{ AuthWalletTransitionAuthorityRegistrySha256 = $authWalletTransitionAuthorityRegistrySha256 }
                    Error = 'must not supply auth/wallet or Redis operator transition inputs'
                },
                [pscustomobject]@{
                    Name = 'AUTH_WALLET_TRANSITION fixed-slot evidence'
                    Arguments = $authWalletAdoptionArguments
                    Add = @{ FixedSlotCredentialTransitionRecordFile = $approvedTransitionRecordPath }
                    Error = 'must not supply fixed-slot or Redis operator transition inputs'
                }
            )) {
            Clear-AwsMarker
            $arguments = Copy-ArgumentMap -Map $case.Arguments
            $arguments.Action = 'Plan'
            foreach ($entry in $case.Add.GetEnumerator()) {
                $arguments[$entry.Key] = [string] $entry.Value
            }
            $result = Invoke-Guard -Arguments $arguments
            Assert-Condition (-not $result.Succeeded) "$($case.Name) was accepted."
            Assert-Condition ($result.Output -match [regex]::Escape($case.Error)) "$($case.Name) rejection was not explicit."
            Assert-Condition ((Get-AwsMarkerText) -eq '') "$($case.Name) reached AWS discovery."
        }
    }

    Invoke-FocusedTest -Name 'bootstrap sequence adopts fixed slots before the separate auth wallet chain' -Body {
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody

        Write-ApplicationStackResponse -ParameterMap $applicationParameterMap -TagMap $applicationStackTags
        Clear-AwsMarker
        $fixedArguments = Copy-ArgumentMap -Map $updateArguments
        $fixedArguments.Action = 'Plan'
        $fixedResult = Invoke-Guard -Arguments $fixedArguments
        $fixedMarker = Get-AwsMarkerText
        $fixedCreateLine = @($fixedMarker -split "`r?`n" | Where-Object { $_ -match 'cloudformation create-change-set' }) | Select-Object -First 1
        Assert-Condition $fixedResult.Succeeded "Initial fixed-slot adoption failed: $($fixedResult.Output)"
        Assert-Condition ($fixedCreateLine -notmatch 'auth-wallet-(?:predecessor|transition|state)-sha256') 'Initial fixed-slot adoption incorrectly fabricated auth/wallet chain tags.'

        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletAdoptionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletAdoptionStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'ADOPT_EXISTING_BINDING' `
            -FieldName 'ALL_SEVEN_FIELDS' `
            -InitialValidationAt $authWalletValidationAt
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $updateApplicationStackTags
        Clear-AwsMarker
        $authArguments = Copy-ArgumentMap -Map $authWalletAdoptionArguments
        $authArguments.Action = 'Plan'
        $authResult = Invoke-Guard -Arguments $authArguments
        $authMarker = Get-AwsMarkerText
        $authCreateLine = @($authMarker -split "`r?`n" | Where-Object { $_ -match 'cloudformation create-change-set' }) | Select-Object -First 1
        Assert-Condition $authResult.Succeeded "Auth/wallet adoption after fixed-slot adoption failed: $($authResult.Output)"
        Assert-Condition ($authCreateLine -match ('auth-wallet-transition-binding-sha256=' + $authWalletAdoptionDeploymentBindingSha256)) 'Auth/wallet adoption description omitted its exact deployment binding.'
        Assert-Condition ($authCreateLine -match ('auth-wallet-authority-registry-sha256=' + $authWalletTransitionAuthorityRegistrySha256)) 'Auth/wallet adoption description omitted the authority registry pin.'
        foreach ($fixedTag in @('credential-predecessor-sha256', 'credential-transition-sha256', 'credential-state-sha256')) {
            Assert-Condition ($authCreateLine -match ("Key=$fixedTag,Value=" + [regex]::Escape([string] $updateApplicationStackTags[$fixedTag]))) "Auth/wallet adoption did not preserve fixed-slot chain tag $fixedTag."
        }
        foreach ($authTag in @('auth-wallet-predecessor-sha256', 'auth-wallet-transition-sha256', 'auth-wallet-state-sha256')) {
            Assert-Condition ($authCreateLine -match ("Key=$authTag,Value=" + [regex]::Escape([string] $authWalletAdoptedStackTags[$authTag]))) "Auth/wallet adoption omitted exact chain tag $authTag."
        }
        Assert-Condition (@(Get-Content -LiteralPath $authWalletValidatorMarkerPath).Count -eq 2) 'Auth/wallet Plan did not perform two stable offline validations.'
    }

    Invoke-FocusedTest -Name 'auth wallet transition Plan changes only the signed outer VersionId and chain head' -Body {
        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletTransitionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'STAGE_SUCCESSOR' `
            -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
            -InitialValidationAt $authWalletValidationAt
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $authWalletTransitionArguments
        $arguments.Action = 'Plan'
        $result = Invoke-Guard -Arguments $arguments
        $marker = Get-AwsMarkerText
        $createLine = @($marker -split "`r?`n" | Where-Object { $_ -match 'cloudformation create-change-set' }) | Select-Object -First 1
        Assert-Condition $result.Succeeded "Exact auth/wallet transition Plan failed: $($result.Output)"
        Assert-Condition ($createLine -match [regex]::Escape("ParameterKey=AuthWalletKeysSecretVersionId,ParameterValue=$authWalletTargetVersionId")) 'Auth/wallet transition omitted the signed target outer VersionId.'
        Assert-Condition ($createLine -match ('auth-wallet-transition-binding-sha256=' + $authWalletTransitionDeploymentBindingSha256)) 'Auth/wallet transition description omitted its exact deployment binding.'
        foreach ($entry in $pinnedCredentialVersions.GetEnumerator()) {
            Assert-Condition ($createLine -match ("ParameterKey=$($entry.Key),ParameterValue=" + [regex]::Escape([string] $entry.Value))) "Auth/wallet transition did not preserve fixed-slot pin $($entry.Key)."
        }
        foreach ($fixedTag in @('credential-predecessor-sha256', 'credential-transition-sha256', 'credential-state-sha256')) {
            Assert-Condition ($createLine -match ("Key=$fixedTag,Value=" + [regex]::Escape([string] $authWalletAdoptedStackTags[$fixedTag]))) "Auth/wallet transition did not preserve fixed-slot tag $fixedTag."
        }
        Assert-Condition ($createLine -match ('Key=auth-wallet-predecessor-sha256,Value=' + $authWalletAdoptionRecordSha256)) 'Auth/wallet transition did not extend the exact prior chain head.'
        Assert-Condition ($createLine -match ('Key=auth-wallet-transition-sha256,Value=' + $authWalletTransitionRecordSha256)) 'Auth/wallet transition did not bind its signed record digest.'
        Assert-Condition ($createLine -match ('Key=auth-wallet-state-sha256,Value=' + $authWalletTransitionTargetStateSha256)) 'Auth/wallet transition did not bind its signed target-state digest.'
    }

    Invoke-FocusedTest -Name 'auth wallet transition freezes unrelated parameters base tags and parent template' -Body {
        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletTransitionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'STAGE_SUCCESSOR' `
            -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
            -InitialValidationAt $authWalletValidationAt
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody

        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
        Clear-AwsMarker
        $parameterArguments = Copy-ArgumentMap -Map $authWalletTransitionArguments
        $parameterArguments.Action = 'Plan'
        $parameterArguments.ParameterOverride = @($updateParameterOverrides) + @('LogRetentionDays=30')
        $parameterResult = Invoke-Guard -Arguments $parameterArguments
        Assert-Condition (-not $parameterResult.Succeeded) 'Auth/wallet-only update accepted an unrelated parameter change.'
        Assert-Condition ($parameterResult.Output -match "cannot change unrelated parameter 'LogRetentionDays'") 'Auth/wallet unrelated parameter rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -notmatch 's3api get-object|create-change-set') 'Auth/wallet unrelated parameter change reached artifact reads or planning.'

        $driftedAuthWalletBaseTags = [ordered]@{}
        foreach ($entry in $authWalletAdoptedStackTags.GetEnumerator()) {
            $driftedAuthWalletBaseTags[$entry.Key] = [string] $entry.Value
        }
        $driftedAuthWalletBaseTags.owner = 'unexpected-owner'
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $driftedAuthWalletBaseTags
        Clear-AwsMarker
        $tagArguments = Copy-ArgumentMap -Map $authWalletTransitionArguments
        $tagArguments.Action = 'Plan'
        $tagResult = Invoke-Guard -Arguments $tagArguments
        Assert-Condition (-not $tagResult.Succeeded) 'Auth/wallet-only update accepted unrelated base-tag drift.'
        Assert-Condition ($tagResult.Output -match "cannot change or repair unrelated stack tag 'owner'") 'Auth/wallet unrelated base-tag rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -notmatch 's3api get-object|create-change-set') 'Auth/wallet base-tag drift reached artifact reads or planning.'

        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody ($applicationTemplateBody + "`n# drift")
        Clear-AwsMarker
        $templateArguments = Copy-ArgumentMap -Map $authWalletTransitionArguments
        $templateArguments.Action = 'Plan'
        $templateResult = Invoke-Guard -Arguments $templateArguments
        Assert-Condition (-not $templateResult.Succeeded) 'Auth/wallet-only update accepted a parent-template change.'
        Assert-Condition ($templateResult.Output -match 'cannot include a parent-template change') 'Auth/wallet parent-template freeze rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -notmatch 's3api get-object|create-change-set') 'Auth/wallet parent-template change reached artifact reads or planning.'
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
    }

    Invoke-FocusedTest -Name 'auth wallet transition permits the signed abort-staged-successor recovery action' -Body {
        try {
            $abortRecord = ($authWalletTransitionRecord | ConvertTo-Json -Depth 8) | ConvertFrom-Json
            $abortRecord.content.operation.action = 'ABORT_STAGED_SUCCESSOR'
            Write-JsonFile -Path $approvedAuthWalletTransitionRecordPath -Value $abortRecord -Depth 8
            Set-FakeAuthWalletValidationFixture `
                -CanonicalSha256 $authWalletTransitionRecordSha256 `
                -CurrentStateSha256 $authWalletAdoptionStateSha256 `
                -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
                -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
                -Operation 'ABORT_STAGED_SUCCESSOR' `
                -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
                -InitialValidationAt $authWalletValidationAt
            Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
            Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
            Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
            Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
            Clear-AwsMarker
            $arguments = Copy-ArgumentMap -Map $authWalletTransitionArguments
            $arguments.Action = 'Plan'
            $arguments.AuthWalletTransitionOperation = 'ABORT_STAGED_SUCCESSOR'
            $result = Invoke-Guard -Arguments $arguments
            Assert-Condition $result.Succeeded "Signed abort-staged-successor recovery Plan failed: $($result.Output)"
            Assert-Condition ((Get-AwsMarkerText) -match 'cloudformation create-change-set') 'Signed abort-staged-successor recovery did not create a review-only change set.'
        }
        finally {
            Write-JsonFile -Path $approvedAuthWalletTransitionRecordPath -Value $authWalletTransitionRecord -Depth 8
        }
    }

    Invoke-FocusedTest -Name 'auth wallet wrapper consumes only the signed report and never directly parses the record' -Body {
        $guardSource = Get-Content -LiteralPath $guardPath -Raw
        Assert-Condition ($guardSource -notmatch '\$authWalletTransitionRecordText') 'Auth/wallet wrapper retained a direct transition-record text read.'
        Assert-Condition ($guardSource -notmatch '\$authWalletTransitionRecord\.content') 'Auth/wallet wrapper retained direct parsed-record field access.'
        Assert-Condition ($guardSource -match '\$validation\.PSObject\.Properties\[''predecessorTransitionSha256''\]') 'Auth/wallet wrapper does not require the validator-reported signed predecessor.'

        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletTransitionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'STAGE_SUCCESSOR' `
            -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
            -InitialValidationAt $authWalletValidationAt `
            -Variant 'FAIL_ALWAYS'
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $authWalletTransitionArguments
        $arguments.Action = 'Plan'
        $arguments.AuthWalletTransitionRecordFile = Join-Path $temporaryRoot 'untrusted-record-does-not-exist.json'
        $result = Invoke-Guard -Arguments $arguments
        Assert-Condition (-not $result.Succeeded) 'AUTH_WALLET_TRANSITION accepted an untrusted nonexistent record path.'
        Assert-Condition ($result.Output -match 'malformed, stale, unauthorized, or deployment-mismatched') 'The secure validator was not the first component to reject the untrusted path.'
        Assert-Condition (@(Get-Content -LiteralPath $authWalletValidatorMarkerPath).Count -eq 1) 'The untrusted path was not rejected by the first secure validation pass.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Untrusted auth/wallet record path reached AWS discovery.'
        $env:FAKE_AUTH_WALLET_VALIDATOR_VARIANT = ''
    }

    Invoke-FocusedTest -Name 'auth wallet transition rejects unauthorized or malformed validator reports before AWS discovery' -Body {
        foreach ($variant in @('WRONG_REGISTRY', 'UNAUTHORIZED', 'STRING_ZERO', 'MALFORMED_PREDECESSOR')) {
            Set-FakeAuthWalletValidationFixture `
                -CanonicalSha256 $authWalletTransitionRecordSha256 `
                -CurrentStateSha256 $authWalletAdoptionStateSha256 `
                -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
                -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
                -Operation 'STAGE_SUCCESSOR' `
                -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
                -InitialValidationAt $authWalletValidationAt `
                -Variant $variant
            Clear-AwsMarker
            $arguments = Copy-ArgumentMap -Map $authWalletTransitionArguments
            $arguments.Action = 'Plan'
            $result = Invoke-Guard -Arguments $arguments
            Assert-Condition (-not $result.Succeeded) "Auth/wallet transition accepted hostile validator variant $variant."
            Assert-Condition ((Get-AwsMarkerText) -eq '') "Hostile validator variant $variant reached AWS discovery."
        }
        $env:FAKE_AUTH_WALLET_VALIDATOR_VARIANT = ''

        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletTransitionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'STAGE_SUCCESSOR' `
            -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
            -InitialValidationAt $authWalletValidationAt `
            -Variant 'WRONG_PREDECESSOR'
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Clear-AwsMarker
        $wrongPredecessorArguments = Copy-ArgumentMap -Map $authWalletTransitionArguments
        $wrongPredecessorArguments.Action = 'Plan'
        $wrongPredecessor = Invoke-Guard -Arguments $wrongPredecessorArguments
        Assert-Condition (-not $wrongPredecessor.Succeeded) 'Auth/wallet transition accepted a signed predecessor that did not match the deployed chain head.'
        Assert-Condition ($wrongPredecessor.Output -match 'chain head does not match the signed transition predecessor') 'Wrong predecessor rejection did not identify the signed chain binding.'
        Assert-Condition ((Get-AwsMarkerText) -notmatch 's3api get-object|cloudformation create-change-set') 'Wrong auth/wallet predecessor reached artifact reads or change-set creation.'
        $env:FAKE_AUTH_WALLET_VALIDATOR_VARIANT = ''

        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletTransitionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'STAGE_SUCCESSOR' `
            -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
            -InitialValidationAt $authWalletValidationAt `
            -Variant 'CURRENT_BINDING_MISMATCH'
        Clear-AwsMarker
        $mismatchedCurrentArguments = Copy-ArgumentMap -Map $authWalletTransitionArguments
        $mismatchedCurrentArguments.Action = 'Plan'
        $mismatchedCurrentArguments.AuthWalletTransitionCurrentVersionId = 'auth_wallet_keys_secret_version_0999'
        $mismatchedCurrent = Invoke-Guard -Arguments $mismatchedCurrentArguments
        Assert-Condition (-not $mismatchedCurrent.Succeeded) 'Auth/wallet transition accepted a record that did not match the independently named current VersionId.'
        Assert-Condition ($mismatchedCurrent.Output -match 'exact non-executable outer-VersionId plan') 'Independent current VersionId mismatch rejection was not explicit.'
        Assert-Condition ((Get-AwsMarkerText) -eq '') 'Independent current VersionId mismatch reached AWS discovery.'
        $env:FAKE_AUTH_WALLET_VALIDATOR_VARIANT = ''
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

            Clear-AwsMarker
            $operatorMismatchedRecord = ($approvedTransitionRecord | ConvertTo-Json -Depth 14) | ConvertFrom-Json
            $operatorMismatchedRecord.targetState.redisOperatorSecretVersionId = $redisOperatorSecretVersionId -replace '0001$', '0002'
            $operatorMismatchedRecord.targetState.redisOperatorUsedVersionIds = @($operatorMismatchedRecord.targetState.redisOperatorSecretVersionId)
            Write-JsonFile -Path $approvedTransitionRecordPath -Value $operatorMismatchedRecord -Depth 14
            $operatorMismatchedArguments = Copy-ArgumentMap -Map $updateArguments
            $operatorMismatchedArguments.Action = 'Plan'
            $operatorMismatched = Invoke-Guard -Arguments $operatorMismatchedArguments
            Assert-Condition (-not $operatorMismatched.Succeeded) 'UPDATE accepted a record whose Redis operator VersionId differs from the named target.'
            Assert-Condition ($operatorMismatched.Output -match "RedisOperatorSecretVersionId.*does not match the approved transition record") 'Redis operator target VersionId mismatch was not explicit.'
            Assert-Condition ((Get-AwsMarkerText) -eq '') 'Redis operator target VersionId mismatch reached AWS discovery.'
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

    Invoke-FocusedTest -Name 'UPDATE rejects deployed credential-version drift before artifact reads or change-set creation' -Body {
        foreach ($driftCase in @(
                [pscustomobject]@{
                    Parameter = 'ApiDatabaseSlotAVersionId'
                    Value = [string] $pinnedCredentialVersions.ApiDatabaseSlotAVersionId
                },
                [pscustomobject]@{
                    Parameter = 'RedisOperatorSecretVersionId'
                    Value = $redisOperatorSecretVersionId
                }
            )) {
            $driftedCurrentParameters = [ordered]@{}
            foreach ($entry in $applicationParameterMap.GetEnumerator()) {
                $driftedCurrentParameters[$entry.Key] = [string] $entry.Value
            }
            $driftedCurrentParameters[$driftCase.Parameter] = $driftCase.Value
            Write-ApplicationStackResponse -ParameterMap $driftedCurrentParameters -TagMap $applicationStackTags
            Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
            Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
            Clear-AwsMarker
            $arguments = Copy-ArgumentMap -Map $updateArguments
            $arguments.Action = 'Plan'
            $result = Invoke-Guard -Arguments $arguments
            $marker = Get-AwsMarkerText
            Assert-Condition (-not $result.Succeeded) "UPDATE accepted deployed credential-version drift for $($driftCase.Parameter)."
            Assert-Condition ($result.Output -match 'drifted from the approved update current state') "Deployed $($driftCase.Parameter) drift rejection was not explicit."
            Assert-Condition ($marker -notmatch 's3api get-object|create-change-set') "Deployed $($driftCase.Parameter) drift reached artifact reads or change-set creation."
        }
        Write-ApplicationStackResponse -ParameterMap $applicationParameterMap -TagMap $applicationStackTags
    }

    Invoke-FocusedTest -Name 'UPDATE intents preserve the exact auth wallet secret ARN version and KMS tuple' -Body {
        $alternateVersionId = 'auth_wallet_keys_secret_version_0002'

        foreach ($intentCase in @(
                [pscustomobject]@{
                    Name = 'APPLICATION'
                    Arguments = $applicationUpdateArguments
                    CurrentParameters = $updateApplicationParameterMap
                    CurrentTags = $authWalletAdoptedStackTags
                },
                [pscustomobject]@{
                    Name = 'CREDENTIAL_TRANSITION'
                    Arguments = $updateArguments
                    CurrentParameters = $applicationParameterMap
                    CurrentTags = $applicationStackTags
                }
            )) {
            Write-ApplicationStackResponse -ParameterMap $intentCase.CurrentParameters -TagMap $intentCase.CurrentTags
            Clear-AwsMarker
            $arguments = Copy-ArgumentMap -Map $intentCase.Arguments
            $arguments.Action = 'Plan'
            $arguments.AuthWalletKeysSecretVersionId = $alternateVersionId
            $result = Invoke-Guard -Arguments $arguments
            $marker = Get-AwsMarkerText
            Assert-Condition (-not $result.Succeeded) "$($intentCase.Name) accepted auth/wallet VersionId rotation."
            Assert-Condition ($result.Output -match 'dedicated reviewed auth/wallet transition') "$($intentCase.Name) VersionId rejection did not identify the dedicated transition requirement."
            Assert-Condition ($marker -notmatch 's3api get-object|create-change-set') "$($intentCase.Name) auth/wallet VersionId rotation reached artifact reads or change-set creation."
        }

        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
        foreach ($tupleMutation in @(
                [pscustomobject]@{
                    Parameter = 'AuthWalletKeysSecretArn'
                    Value = 'arn:aws:secretsmanager:us-west-2:111122223333:secret:crypto-lending/test/alternate-auth-wallet-AbCdEf'
                },
                [pscustomobject]@{
                    Parameter = 'AuthWalletKeysKmsKeyArn'
                    Value = 'arn:aws:kms:us-west-2:111122223333:key/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
                }
            )) {
            Clear-AwsMarker
            $arguments = Copy-ArgumentMap -Map $applicationUpdateArguments
            $arguments.Action = 'Plan'
            $arguments.ParameterOverride = @($applicationUpdateParameterOverrides | Where-Object {
                    $_ -notlike "$($tupleMutation.Parameter)=*"
                }) + @("$($tupleMutation.Parameter)=$($tupleMutation.Value)")
            $result = Invoke-Guard -Arguments $arguments
            $marker = Get-AwsMarkerText
            Assert-Condition (-not $result.Succeeded) "APPLICATION accepted $($tupleMutation.Parameter) rotation."
            Assert-Condition ($result.Output -match 'dedicated reviewed auth/wallet transition') "$($tupleMutation.Parameter) rejection did not identify the dedicated transition requirement."
            Assert-Condition ($marker -notmatch 's3api get-object|create-change-set') "$($tupleMutation.Parameter) rotation reached artifact reads or change-set creation."
        }

        $missingVersionParameters = Copy-ArgumentMap -Map $updateApplicationParameterMap
        [void] $missingVersionParameters.Remove('AuthWalletKeysSecretVersionId')
        Write-ApplicationStackResponse -ParameterMap $missingVersionParameters -TagMap $authWalletAdoptedStackTags
        Clear-AwsMarker
        $missingArguments = Copy-ArgumentMap -Map $applicationUpdateArguments
        $missingArguments.Action = 'Plan'
        $missing = Invoke-Guard -Arguments $missingArguments
        $missingMarker = Get-AwsMarkerText
        Assert-Condition (-not $missing.Succeeded) 'APPLICATION accepted a deployed stack missing AuthWalletKeysSecretVersionId.'
        Assert-Condition ($missing.Output -match 'missing immutable auth/wallet binding') 'Missing deployed auth/wallet VersionId rejection was not explicit.'
        Assert-Condition ($missingMarker -notmatch 's3api get-object|create-change-set') 'Missing deployed auth/wallet VersionId reached artifact reads or change-set creation.'

        Write-ApplicationStackResponse -ParameterMap $applicationParameterMap -TagMap $applicationStackTags
    }

    Invoke-FocusedTest -Name 'post-adoption updates cannot change the Redis operator secret version' -Body {
        $alternateOperatorVersionId = $redisOperatorSecretVersionId -replace '0001$', '0002'
        foreach ($intentCase in @(
                [pscustomobject]@{
                    Name = 'APPLICATION'
                    Arguments = $applicationUpdateArguments
                    CurrentParameters = $updateApplicationParameterMap
                    CurrentTags = $authWalletAdoptedStackTags
                    ExpectedError = 'drifted from the approved update current state'
                },
                [pscustomobject]@{
                    Name = 'CREDENTIAL_TRANSITION'
                    Arguments = $rotationArguments
                    CurrentParameters = $updateApplicationParameterMap
                    CurrentTags = $authWalletAdoptedStackTags
                    ExpectedError = 'does not match the approved transition record'
                }
            )) {
            Write-ApplicationStackResponse -ParameterMap $intentCase.CurrentParameters -TagMap $intentCase.CurrentTags
            Clear-AwsMarker
            $arguments = Copy-ArgumentMap -Map $intentCase.Arguments
            $arguments.Action = 'Plan'
            $arguments.RedisOperatorSecretVersionId = $alternateOperatorVersionId
            $result = Invoke-Guard -Arguments $arguments
            $marker = Get-AwsMarkerText
            Assert-Condition (-not $result.Succeeded) "$($intentCase.Name) accepted a post-adoption Redis operator VersionId change."
            Assert-Condition ($result.Output -match $intentCase.ExpectedError) "$($intentCase.Name) Redis operator VersionId rejection was not explicit."
            Assert-Condition ($marker -notmatch 's3api get-object|create-change-set') "$($intentCase.Name) Redis operator VersionId change reached artifact reads or change-set creation."
        }

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

    Invoke-FocusedTest -Name 'UPDATE Plan binds the approved transition, exact stack, seven targets, templates, parameters, and tags' -Body {
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
        Assert-Condition ($createLine -match ('credential-transition-binding-sha256' + '=' + $transitionDeploymentBindingSha256)) 'UPDATE description did not bind the exact transition deployment digest.'
        Assert-Condition ($createLine -match ('Key=credential-transition-sha256,Value=' + $transitionRecordSha256)) 'UPDATE tags did not bind the exact transition record.'
        Assert-Condition ($createLine -match ('Key=credential-state-sha256,Value=' + $transitionTargetStateSha256)) 'UPDATE tags did not bind the exact target state.'
        foreach ($entry in $pinnedCredentialVersions.GetEnumerator()) {
            Assert-Condition ($createLine -match ("ParameterKey=$($entry.Key),ParameterValue=" + [regex]::Escape([string] $entry.Value))) "UPDATE omitted exact target $($entry.Key)."
        }
        Assert-Condition ($createLine -match [regex]::Escape("ParameterKey=AuthWalletKeysSecretVersionId,ParameterValue=$authWalletKeysSecretVersionId")) 'UPDATE omitted the preserved auth/wallet secret VersionId.'
        Assert-Condition ($createLine -match [regex]::Escape("--stack-name $immutableStackId")) 'UPDATE Plan did not address the immutable stack ARN.'
        Assert-Condition ($createLine -match ('current-stack-binding-sha256=' + $currentStackBindingSha256)) 'UPDATE description did not bind the exact current stack state.'
    }

    Invoke-FocusedTest -Name 'credential transition Plan advances one inactive slot without unrelated changes' -Body {
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
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
        Assert-Condition ($createLine -match ('credential-transition-binding-sha256' + '=' + $rotationDeploymentBindingSha256)) 'Inactive-slot transition description did not bind the exact deployment digest.'
        Assert-Condition ($createLine -match ('Key=credential-predecessor-sha256,Value=' + $transitionRecordSha256)) 'Inactive-slot transition did not extend the deployed credential chain.'
        Assert-Condition ($createLine -match ('Key=credential-transition-sha256,Value=' + $rotationRecordSha256)) 'Inactive-slot transition did not bind its exact record hash.'
        Assert-Condition ($createLine -match ('Key=credential-state-sha256,Value=' + $rotationTargetStateSha256)) 'Inactive-slot transition did not bind its exact target-state hash.'
        foreach ($authWalletTag in @('auth-wallet-predecessor-sha256', 'auth-wallet-transition-sha256', 'auth-wallet-state-sha256')) {
            Assert-Condition ($createLine -match ("Key=$authWalletTag,Value=" + [regex]::Escape([string] $authWalletAdoptedStackTags[$authWalletTag]))) "Inactive-slot transition did not preserve auth/wallet-chain tag $authWalletTag."
        }
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

        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
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
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
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
        foreach ($entry in $pinnedCredentialVersions.GetEnumerator()) {
            Assert-Condition ($createLine -match ("ParameterKey=$($entry.Key),ParameterValue=" + [regex]::Escape([string] $entry.Value))) "APPLICATION update changed or omitted fixed-slot pin $($entry.Key)."
        }
        Assert-Condition ($createLine -match [regex]::Escape("ParameterKey=AuthWalletKeysSecretVersionId,ParameterValue=$authWalletKeysSecretVersionId")) 'APPLICATION update changed or omitted the auth/wallet secret VersionId.'
        foreach ($credentialTag in @('credential-predecessor-sha256', 'credential-transition-sha256', 'credential-state-sha256')) {
            Assert-Condition ($createLine -match ("Key=$credentialTag,Value=" + [regex]::Escape([string] $authWalletAdoptedStackTags[$credentialTag]))) "APPLICATION update did not preserve credential-chain tag $credentialTag."
        }
        foreach ($authWalletTag in @('auth-wallet-predecessor-sha256', 'auth-wallet-transition-sha256', 'auth-wallet-state-sha256')) {
            Assert-Condition ($createLine -match ("Key=$authWalletTag,Value=" + [regex]::Escape([string] $authWalletAdoptedStackTags[$authWalletTag]))) "APPLICATION update did not preserve auth/wallet-chain tag $authWalletTag."
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
        Assert-Condition ($createLines[0] -match [regex]::Escape("ParameterKey=AuthWalletKeysSecretVersionId,ParameterValue=$authWalletKeysSecretVersionId")) 'Plan did not bind the exact auth/wallet secret VersionId.'
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

    Invoke-FocusedTest -Name 'Deploy rejects a remote auth wallet secret version mutation' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        $mutatedParameters = Copy-ArgumentMap -Map $applicationParameterMap
        $mutatedParameters.AuthWalletKeysSecretVersionId = $authWalletKeysSecretVersionId -replace '0001$', '0002'
        Write-ChangeSetResponse -ParameterMap $mutatedParameters
        $result = Invoke-Guard -Arguments $baseArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted a remote auth/wallet VersionId mutation.'
        Assert-Condition ($result.Output -match 'AuthWalletKeysSecretVersionId.*does not match') 'Remote auth/wallet VersionId rejection was not explicit.'
        Assert-Condition ($marker -notmatch 's3api get-object|execute-change-set') 'Deploy reached artifact billing or execution after remote auth/wallet VersionId mismatch.'
    }

    Invoke-FocusedTest -Name 'Deploy rejects a remote Redis operator secret version mutation' -Body {
        Clear-AwsMarker
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        $mutatedParameters = Copy-ArgumentMap -Map $applicationParameterMap
        $mutatedParameters.RedisOperatorSecretVersionId = $redisOperatorSecretVersionId
        Write-ChangeSetResponse -ParameterMap $mutatedParameters
        $result = Invoke-Guard -Arguments $baseArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Deploy accepted a remote Redis operator VersionId mutation.'
        Assert-Condition ($result.Output -match 'RedisOperatorSecretVersionId.*does not match') 'Remote Redis operator VersionId rejection was not explicit.'
        Assert-Condition ($marker -notmatch 's3api get-object|execute-change-set') 'Deploy reached artifact billing or execution after remote Redis operator VersionId mismatch.'
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

    Invoke-FocusedTest -Name 'UPDATE Deploy rejects UsePreviousValue for the auth wallet secret version' -Body {
        Write-ApplicationStackResponse -ParameterMap $applicationParameterMap -TagMap $applicationStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $updateApplicationParameterMap `
            -TagMap $updateApplicationStackTags `
            -Description $updateExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE' `
            -UsePreviousParameter 'AuthWalletKeysSecretVersionId'
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments $updateArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'UPDATE Deploy accepted UsePreviousValue for the auth/wallet VersionId.'
        Assert-Condition ($result.Output -match 'non-explicit parameter') 'Auth/wallet UsePreviousValue rejection was not explicit.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'UPDATE executed after accepting an implicit auth/wallet VersionId.'
    }

    Invoke-FocusedTest -Name 'UPDATE Deploy rejects UsePreviousValue for the Redis operator secret version' -Body {
        Write-ApplicationStackResponse -ParameterMap $applicationParameterMap -TagMap $applicationStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $updateApplicationParameterMap `
            -TagMap $updateApplicationStackTags `
            -Description $updateExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE' `
            -UsePreviousParameter 'RedisOperatorSecretVersionId'
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments $updateArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'UPDATE Deploy accepted UsePreviousValue for the Redis operator VersionId.'
        Assert-Condition ($result.Output -match 'non-explicit parameter') 'Redis operator UsePreviousValue rejection was not explicit.'
        Assert-Condition ($marker -notmatch 'execute-change-set') 'UPDATE executed after accepting an implicit Redis operator VersionId.'
    }

    Invoke-FocusedTest -Name 'UPDATE Deploy rejects database replacement and legacy master-secret retirement' -Body {
        $unsafeChanges = @(
            [pscustomobject]@{
                Name = 'database replacement'
                ExpectedError = 'must not replace, add, or remove the stateful Database resource'
                Change = [ordered]@{
                    Type = 'Resource'
                    ResourceChange = [ordered]@{
                        Action = 'Modify'
                        LogicalResourceId = 'Database'
                        ResourceType = 'AWS::RDS::DBInstance'
                        Replacement = 'True'
                    }
                }
            },
            [pscustomobject]@{
                Name = 'conditional database replacement'
                ExpectedError = 'must not replace, add, or remove the stateful Database resource'
                Change = [ordered]@{
                    Type = 'Resource'
                    ResourceChange = [ordered]@{
                        Action = 'Modify'
                        LogicalResourceId = 'Database'
                        ResourceType = 'AWS::RDS::DBInstance'
                        Replacement = 'Conditional'
                    }
                }
            },
            [pscustomobject]@{
                Name = 'database removal'
                ExpectedError = 'must not replace, add, or remove the stateful Database resource'
                Change = [ordered]@{
                    Type = 'Resource'
                    ResourceChange = [ordered]@{
                        Action = 'Remove'
                        LogicalResourceId = 'Database'
                        ResourceType = 'AWS::RDS::DBInstance'
                        Replacement = 'False'
                    }
                }
            },
            [pscustomobject]@{
                Name = 'legacy retained master-secret removal'
                ExpectedError = 'must not modify or remove the legacy retained database master secret'
                Change = [ordered]@{
                    Type = 'Resource'
                    ResourceChange = [ordered]@{
                        Action = 'Remove'
                        LogicalResourceId = 'DatabaseCredentialsSecret'
                        ResourceType = 'AWS::SecretsManager::Secret'
                        Replacement = 'False'
                    }
                }
            }
        )

        foreach ($unsafeChange in $unsafeChanges) {
            Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
            Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
            Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
            Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
            Write-ChangeSetResponse `
                -ParameterMap $applicationUpdateParameterMap `
                -TagMap $authWalletAdoptedStackTags `
                -Description $applicationUpdateExpectedChangeSetDescription `
                -ChangeSetType 'UPDATE' `
                -Changes @($unsafeChange.Change)
            Clear-AwsMarker
            $result = Invoke-Guard -Arguments $applicationUpdateArguments
            $marker = Get-AwsMarkerText
            Assert-Condition (-not $result.Succeeded) "UPDATE Deploy accepted $($unsafeChange.Name)."
            Assert-Condition ($result.Output -match [regex]::Escape($unsafeChange.ExpectedError)) "The $($unsafeChange.Name) rejection was not explicit."
            Assert-Condition ($marker -notmatch 'execute-change-set') "UPDATE executed after $($unsafeChange.Name)."
        }
    }

    Invoke-FocusedTest -Name 'auth wallet Deploy rejects functional changes outside the exact two API changes' -Body {
        $changeCases = @(
            [pscustomobject]@{
                Name = 'missing ApiService change'
                Changes = @($expectedAuthWalletResourceChanges[0])
            },
            [pscustomobject]@{
                Name = 'unexpected third resource'
                Changes = @($expectedAuthWalletResourceChanges) + @(
                    [ordered]@{
                        Type = 'Resource'
                        ResourceChange = [ordered]@{
                            Action = 'Modify'
                            LogicalResourceId = 'WebService'
                            ResourceType = 'AWS::ECS::Service'
                            Replacement = 'False'
                        }
                    }
                )
            },
            [pscustomobject]@{
                Name = 'wrong task-definition replacement'
                Changes = @(
                    [ordered]@{
                        Type = 'Resource'
                        ResourceChange = [ordered]@{
                            Action = 'Modify'
                            LogicalResourceId = 'ApiTaskDefinition'
                            ResourceType = 'AWS::ECS::TaskDefinition'
                            Replacement = 'False'
                        }
                    },
                    $expectedAuthWalletResourceChanges[1]
                )
            }
        )
        foreach ($changeCase in $changeCases) {
            Set-FakeAuthWalletValidationFixture `
                -CanonicalSha256 $authWalletTransitionRecordSha256 `
                -CurrentStateSha256 $authWalletAdoptionStateSha256 `
                -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
                -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
                -Operation 'STAGE_SUCCESSOR' `
                -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
                -InitialValidationAt $authWalletValidationAt
            Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
            Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
            Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
            Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
            Write-ChangeSetResponse `
                -ParameterMap $authWalletTransitionParameterMap `
                -TagMap $authWalletTransitionStackTags `
                -Description $authWalletTransitionExpectedChangeSetDescription `
                -ChangeSetType 'UPDATE' `
                -Changes $changeCase.Changes
            Clear-AwsMarker
            $result = Invoke-Guard -Arguments $authWalletTransitionArguments
            $marker = Get-AwsMarkerText
            Assert-Condition (-not $result.Succeeded) "AUTH_WALLET_TRANSITION accepted $($changeCase.Name)."
            Assert-Condition ($result.Output -match 'AUTH_WALLET_TRANSITION') "$($changeCase.Name) rejection did not identify the strict auth/wallet allowlist."
            Assert-Condition ($marker -notmatch 'cloudformation execute-change-set') "AUTH_WALLET_TRANSITION executed with $($changeCase.Name)."
        }
    }

    Invoke-FocusedTest -Name 'auth wallet Deploy rejects malformed ECS scope details and causal evidence' -Body {
        $functionalCases = @(
            [pscustomobject]@{
                Name = 'task definition without Properties scope'
                Mutate = {
                    param($changes)
                    $changes[0].ResourceChange.Scope = @('Tags')
                }
            },
            [pscustomobject]@{
                Name = 'task definition caused by another parameter'
                Mutate = {
                    param($changes)
                    $changes[0].ResourceChange.Details[1].CausingEntity = 'ApiImageUri'
                }
            },
            [pscustomobject]@{
                Name = 'task definition without its dynamic direct-modification companion'
                Mutate = {
                    param($changes)
                    $details = @($changes[0].ResourceChange.Details)
                    $changes[0].ResourceChange.Details = @($details[1], $details[2])
                }
            },
            [pscustomobject]@{
                Name = 'service change outside TaskDefinition'
                Mutate = {
                    param($changes)
                    $changes[1].ResourceChange.Details[0].Target.Name = 'DesiredCount'
                    $changes[1].ResourceChange.Details[0].ChangeSource = 'ParameterReference'
                    $changes[1].ResourceChange.Details[0].CausingEntity = 'ApiDesiredCount'
                    $changes[1].ResourceChange.Details[0].Evaluation = 'Static'
                }
            },
            [pscustomobject]@{
                Name = 'service TaskDefinition change caused by another resource'
                Mutate = {
                    param($changes)
                    $changes[1].ResourceChange.Details[0].CausingEntity = 'WorkerTaskDefinition'
                }
            },
            [pscustomobject]@{
                Name = 'missing task definition Details'
                Mutate = {
                    param($changes)
                    $changes[0].ResourceChange.Details = @()
                }
            },
            [pscustomobject]@{
                Name = 'tag Detail omitted from declared tag Scope'
                Mutate = {
                    param($changes)
                    $changes[1].ResourceChange.Scope = @('Properties')
                }
            }
        )
        foreach ($functionalCase in $functionalCases) {
            Set-FakeAuthWalletValidationFixture `
                -CanonicalSha256 $authWalletTransitionRecordSha256 `
                -CurrentStateSha256 $authWalletAdoptionStateSha256 `
                -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
                -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
                -Operation 'STAGE_SUCCESSOR' `
                -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
                -InitialValidationAt $authWalletValidationAt
            $changes = @(Copy-JsonValue -Value $expectedAuthWalletResourceChanges)
            & $functionalCase.Mutate $changes
            Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
            Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
            Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
            Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
            Write-ChangeSetResponse `
                -ParameterMap $authWalletTransitionParameterMap `
                -TagMap $authWalletTransitionStackTags `
                -Description $authWalletTransitionExpectedChangeSetDescription `
                -ChangeSetType 'UPDATE' `
                -Changes $changes
            Clear-AwsMarker
            $result = Invoke-Guard -Arguments $authWalletTransitionArguments
            $marker = Get-AwsMarkerText
            Assert-Condition (-not $result.Succeeded) "AUTH_WALLET_TRANSITION accepted $($functionalCase.Name)."
            Assert-Condition ($result.Output -match 'AUTH_WALLET_TRANSITION functional change') "$($functionalCase.Name) rejection did not identify the strict ECS causal allowlist."
            Assert-Condition ($marker -notmatch 'cloudformation execute-change-set') "AUTH_WALLET_TRANSITION executed with $($functionalCase.Name)."
        }
    }

    Invoke-FocusedTest -Name 'auth wallet Deploy rejects an uninspected root change-set page' -Body {
        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletTransitionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'STAGE_SUCCESSOR' `
            -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
            -InitialValidationAt $authWalletValidationAt
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $authWalletTransitionParameterMap `
            -TagMap $authWalletTransitionStackTags `
            -Description $authWalletTransitionExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE' `
            -Changes $expectedAuthWalletResourceChanges `
            -NextToken 'uninspected-root-page'
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments $authWalletTransitionArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'AUTH_WALLET_TRANSITION accepted an uninspected root change-set page.'
        Assert-Condition ($result.Output -match 'uninspected pagination token') 'Root pagination rejection was not explicit.'
        Assert-Condition ($marker -notmatch 'cloudformation execute-change-set') 'AUTH_WALLET_TRANSITION executed with an uninspected root page.'
    }

    Invoke-FocusedTest -Name 'auth wallet adoption Deploy rejects any root resource mutation' -Body {
        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletAdoptionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletAdoptionStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'ADOPT_EXISTING_BINDING' `
            -FieldName 'ALL_SEVEN_FIELDS' `
            -InitialValidationAt $authWalletValidationAt
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $updateApplicationStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $updateApplicationParameterMap `
            -TagMap $authWalletAdoptedStackTags `
            -Description $authWalletAdoptionExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE' `
            -Changes @($expectedAuthWalletResourceChanges[0])
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments $authWalletAdoptionArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Auth/wallet adoption accepted a root resource mutation.'
        Assert-Condition ($result.Output -match 'is not a non-replacing Modify action') 'Auth/wallet adoption mutation rejection was not explicit.'
        Assert-Condition ($marker -notmatch 'cloudformation execute-change-set') 'Auth/wallet adoption executed with a root resource mutation.'
    }

    Invoke-FocusedTest -Name 'auth wallet adoption rejects a mislabeled tag-only resource change' -Body {
        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletAdoptionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletAdoptionStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'ADOPT_EXISTING_BINDING' `
            -FieldName 'ALL_SEVEN_FIELDS' `
            -InitialValidationAt $authWalletValidationAt
        $mislabeledTagChange = [ordered]@{
            Type = 'Resource'
            ResourceChange = [ordered]@{
                Action = 'Modify'
                LogicalResourceId = 'WebService'
                ResourceType = 'AWS::ECS::Service'
                Replacement = 'False'
                Scope = @('Tags')
                Details = @(
                    [ordered]@{
                        Target = [ordered]@{
                            Attribute = 'Properties'
                            RequiresRecreation = 'Never'
                        }
                    }
                )
            }
        }
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $updateApplicationStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $updateApplicationParameterMap `
            -TagMap $authWalletAdoptedStackTags `
            -Description $authWalletAdoptionExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE' `
            -Changes @($mislabeledTagChange)
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments $authWalletAdoptionArguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'Auth/wallet adoption accepted a tag Scope whose Detail targeted Properties.'
        Assert-Condition ($result.Output -match 'Detail target outside the Tags attribute') 'Mislabeled adoption tag-change rejection was not explicit.'
        Assert-Condition ($marker -notmatch 'cloudformation execute-change-set') 'Auth/wallet adoption executed a mislabeled tag-only resource change.'
    }

    Invoke-FocusedTest -Name 'exact auth wallet adoption Deploy executes with reviewed tag propagation' -Body {
        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletAdoptionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletAdoptionStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'ADOPT_EXISTING_BINDING' `
            -FieldName 'ALL_SEVEN_FIELDS' `
            -InitialValidationAt $authWalletValidationAt
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $updateApplicationStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $updateApplicationParameterMap `
            -TagMap $authWalletAdoptedStackTags `
            -Description $authWalletAdoptionExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE' `
            -Changes @($tagOnlyAuthWalletResourceChange)
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments $authWalletAdoptionArguments
        $marker = Get-AwsMarkerText
        $validationCalls = @(Get-Content -LiteralPath $authWalletValidatorMarkerPath)
        Assert-Condition $result.Succeeded "Exact auth/wallet adoption Deploy failed: $($result.Output)"
        Assert-Condition ($marker -match 'cloudformation execute-change-set') 'Exact auth/wallet adoption did not execute the immutable change set with reviewed tag propagation.'
        Assert-Condition ($validationCalls.Count -eq 3) 'Exact auth/wallet adoption Deploy did not revalidate immediately before execution.'
        Assert-Condition ($validationCalls[2] -notmatch [regex]::Escape("at=$authWalletValidationAt")) 'Exact auth/wallet adoption Deploy reused its initial validation timestamp.'
        Assert-Condition ($result.Output -match [regex]::Escape($authWalletAdoptionDeploymentBindingSha256)) 'Exact auth/wallet adoption Deploy did not report its deployment binding.'
        Assert-Condition ($result.Output -match [regex]::Escape($authWalletTransitionAuthorityRegistrySha256)) 'Exact auth/wallet adoption Deploy did not report its authority registry binding.'
    }

    Invoke-FocusedTest -Name 'exact auth wallet adoption Deploy accepts an inspected empty resource list' -Body {
        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletAdoptionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletAdoptionStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'ADOPT_EXISTING_BINDING' `
            -FieldName 'ALL_SEVEN_FIELDS' `
            -InitialValidationAt $authWalletValidationAt
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $updateApplicationStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $updateApplicationParameterMap `
            -TagMap $authWalletAdoptedStackTags `
            -Description $authWalletAdoptionExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE' `
            -Changes @()
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments $authWalletAdoptionArguments
        $marker = Get-AwsMarkerText
        Assert-Condition $result.Succeeded "Exact auth/wallet adoption with no resource mutations failed: $($result.Output)"
        Assert-Condition ($marker -match 'cloudformation execute-change-set') 'Exact auth/wallet adoption did not execute after inspecting an empty resource list.'
    }

    Invoke-FocusedTest -Name 'exact auth wallet transition recursively reviews known nested tag propagation' -Body {
        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletTransitionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'STAGE_SUCCESSOR' `
            -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
            -InitialValidationAt $authWalletValidationAt
        $workloadTagChange = Copy-JsonValue -Value $tagOnlyAuthWalletResourceChange
        $workloadTagChange.ResourceChange.LogicalResourceId = 'ApiTaskExecutionRole'
        $workloadTagChange.ResourceChange.ResourceType = 'AWS::IAM::Role'
        $observabilityTagChange = Copy-JsonValue -Value $tagOnlyAuthWalletResourceChange
        $observabilityTagChange.ResourceChange.LogicalResourceId = 'OperationalAlarmTopic'
        $observabilityTagChange.ResourceChange.ResourceType = 'AWS::SNS::Topic'
        $workloadLink = New-NestedChangeSetLink `
            -LogicalResourceId 'WorkloadBoundaries' `
            -StackId $workloadChildStackId `
            -ChangeSetId $workloadChildChangeSetId `
            -DetailKind 'Automatic'
        $observabilityLink = New-NestedChangeSetLink `
            -LogicalResourceId 'Observability' `
            -StackId $observabilityChildStackId `
            -ChangeSetId $observabilityChildChangeSetId `
            -DetailKind 'Tags'
        Write-NestedChangeSetResponse `
            -Path $workloadChildChangeSetResponsePath `
            -StackName 'crypto-lending-workload-test' `
            -StackId $workloadChildStackId `
            -ChangeSetName 'workload-child-change' `
            -ChangeSetId $workloadChildChangeSetId `
            -ParentChangeSetId $immutableChangeSetId `
            -RootChangeSetId $immutableChangeSetId `
            -Changes @($workloadTagChange)
        Write-NestedChangeSetResponse `
            -Path $observabilityChildChangeSetResponsePath `
            -StackName 'crypto-lending-observability-test' `
            -StackId $observabilityChildStackId `
            -ChangeSetName 'observability-child-change' `
            -ChangeSetId $observabilityChildChangeSetId `
            -ParentChangeSetId $immutableChangeSetId `
            -RootChangeSetId $immutableChangeSetId `
            -Changes @()
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $authWalletTransitionParameterMap `
            -TagMap $authWalletTransitionStackTags `
            -Description $authWalletTransitionExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE' `
            -Changes (@($expectedAuthWalletResourceChanges) + @($workloadLink, $observabilityLink))
        Set-FakeChangeSetResponseMap -ResponseMap ([ordered]@{
                $workloadChildChangeSetId = $workloadChildChangeSetResponsePath
                $observabilityChildChangeSetId = $observabilityChildChangeSetResponsePath
            })
        Clear-AwsMarker
        try {
            $result = Invoke-Guard -Arguments $authWalletTransitionArguments
            $marker = Get-AwsMarkerText
            Assert-Condition $result.Succeeded "Exact recursively reviewed auth/wallet transition failed: $($result.Output)"
            Assert-Condition ($marker -match [regex]::Escape("--change-set-name $workloadChildChangeSetId")) 'Workload child change set was not described by immutable ARN.'
            Assert-Condition ($marker -match [regex]::Escape("--change-set-name $observabilityChildChangeSetId")) 'Observability child change set was not described by immutable ARN.'
            Assert-Condition ($marker -match 'cloudformation execute-change-set') 'Recursively reviewed auth/wallet transition did not execute.'
        }
        finally {
            $env:FAKE_AWS_CHANGE_SET_RESPONSE_MAP = ''
        }
    }

    Invoke-FocusedTest -Name 'auth wallet transition rejects a deeply nested non-tag mutation' -Body {
        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletTransitionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'STAGE_SUCCESSOR' `
            -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
            -InitialValidationAt $authWalletValidationAt
        $rootWorkloadLink = New-NestedChangeSetLink `
            -LogicalResourceId 'WorkloadBoundaries' `
            -StackId $workloadChildStackId `
            -ChangeSetId $workloadChildChangeSetId `
            -DetailKind 'Automatic'
        $grandchildLink = New-NestedChangeSetLink `
            -LogicalResourceId 'DeeperStack' `
            -StackId $grandchildStackId `
            -ChangeSetId $grandchildChangeSetId `
            -DetailKind 'Automatic'
        $unsafeGrandchildChange = [ordered]@{
            Type = 'Resource'
            ResourceChange = [ordered]@{
                Action = 'Modify'
                LogicalResourceId = 'UnexpectedRole'
                ResourceType = 'AWS::IAM::Role'
                Replacement = 'False'
                Scope = @('Properties')
                Details = @(
                    [ordered]@{
                        ChangeSource = 'DirectModification'
                        Evaluation = 'Static'
                        Target = [ordered]@{
                            Attribute = 'Properties'
                            Name = 'Policies'
                            RequiresRecreation = 'Never'
                        }
                    }
                )
            }
        }
        Write-NestedChangeSetResponse `
            -Path $workloadChildChangeSetResponsePath `
            -StackName 'crypto-lending-workload-test' `
            -StackId $workloadChildStackId `
            -ChangeSetName 'workload-child-change' `
            -ChangeSetId $workloadChildChangeSetId `
            -ParentChangeSetId $immutableChangeSetId `
            -RootChangeSetId $immutableChangeSetId `
            -Changes @($grandchildLink)
        Write-NestedChangeSetResponse `
            -Path $grandchildChangeSetResponsePath `
            -StackName 'crypto-lending-grandchild-test' `
            -StackId $grandchildStackId `
            -ChangeSetName 'grandchild-change' `
            -ChangeSetId $grandchildChangeSetId `
            -ParentChangeSetId $workloadChildChangeSetId `
            -RootChangeSetId $immutableChangeSetId `
            -Changes @($unsafeGrandchildChange)
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $authWalletTransitionParameterMap `
            -TagMap $authWalletTransitionStackTags `
            -Description $authWalletTransitionExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE' `
            -Changes (@($expectedAuthWalletResourceChanges) + @($rootWorkloadLink))
        Set-FakeChangeSetResponseMap -ResponseMap ([ordered]@{
                $workloadChildChangeSetId = $workloadChildChangeSetResponsePath
                $grandchildChangeSetId = $grandchildChangeSetResponsePath
            })
        Clear-AwsMarker
        try {
            $result = Invoke-Guard -Arguments $authWalletTransitionArguments
            $marker = Get-AwsMarkerText
            Assert-Condition (-not $result.Succeeded) 'AUTH_WALLET_TRANSITION accepted a property mutation hidden in a grandchild change set.'
            Assert-Condition ($result.Output -match 'nested leaf') 'Deep descendant mutation rejection did not identify the nested leaf allowlist.'
            Assert-Condition ($marker -match [regex]::Escape("--change-set-name $workloadChildChangeSetId")) 'Deep review did not inspect the child change set.'
            Assert-Condition ($marker -match [regex]::Escape("--change-set-name $grandchildChangeSetId")) 'Deep review did not inspect the grandchild change set.'
            Assert-Condition ($marker -notmatch 'cloudformation execute-change-set') 'AUTH_WALLET_TRANSITION executed with a hidden grandchild mutation.'
        }
        finally {
            $env:FAKE_AWS_CHANGE_SET_RESPONSE_MAP = ''
        }
    }

    Invoke-FocusedTest -Name 'auth wallet transition rejects mismatched and paginated child identities' -Body {
        $childCases = @(
            [pscustomobject]@{ Name = 'wrong parent identity'; WrongParent = $true; NextToken = $null; OmitChangeSetType = $false },
            [pscustomobject]@{ Name = 'uninspected child page'; WrongParent = $false; NextToken = 'uninspected-child-page'; OmitChangeSetType = $false },
            [pscustomobject]@{ Name = 'missing child UPDATE type'; WrongParent = $false; NextToken = $null; OmitChangeSetType = $true }
        )
        foreach ($childCase in $childCases) {
            Set-FakeAuthWalletValidationFixture `
                -CanonicalSha256 $authWalletTransitionRecordSha256 `
                -CurrentStateSha256 $authWalletAdoptionStateSha256 `
                -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
                -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
                -Operation 'STAGE_SUCCESSOR' `
                -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
                -InitialValidationAt $authWalletValidationAt
            $rootWorkloadLink = New-NestedChangeSetLink `
                -LogicalResourceId 'WorkloadBoundaries' `
                -StackId $workloadChildStackId `
                -ChangeSetId $workloadChildChangeSetId `
                -DetailKind 'Tags'
            $childParent = if ($childCase.WrongParent) { $observabilityChildChangeSetId } else { $immutableChangeSetId }
            $nestedResponseArguments = @{
                Path = $workloadChildChangeSetResponsePath
                StackName = 'crypto-lending-workload-test'
                StackId = $workloadChildStackId
                ChangeSetName = 'workload-child-change'
                ChangeSetId = $workloadChildChangeSetId
                ParentChangeSetId = $childParent
                RootChangeSetId = $immutableChangeSetId
                Changes = @()
                NextToken = $childCase.NextToken
            }
            if ($childCase.OmitChangeSetType) {
                $nestedResponseArguments['OmitChangeSetType'] = $true
            }
            Write-NestedChangeSetResponse @nestedResponseArguments
            Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
            Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
            Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
            Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
            Write-ChangeSetResponse `
                -ParameterMap $authWalletTransitionParameterMap `
                -TagMap $authWalletTransitionStackTags `
                -Description $authWalletTransitionExpectedChangeSetDescription `
                -ChangeSetType 'UPDATE' `
                -Changes (@($expectedAuthWalletResourceChanges) + @($rootWorkloadLink))
            Set-FakeChangeSetResponseMap -ResponseMap ([ordered]@{ $workloadChildChangeSetId = $workloadChildChangeSetResponsePath })
            Clear-AwsMarker
            try {
                $result = Invoke-Guard -Arguments $authWalletTransitionArguments
                $marker = Get-AwsMarkerText
                Assert-Condition (-not $result.Succeeded) "AUTH_WALLET_TRANSITION accepted $($childCase.Name)."
                Assert-Condition ($result.Output -match 'AUTH_WALLET_TRANSITION nested ChangeSetId') "$($childCase.Name) rejection did not identify nested identity review."
                Assert-Condition ($marker -notmatch 'cloudformation execute-change-set') "AUTH_WALLET_TRANSITION executed with $($childCase.Name)."
            }
            finally {
                $env:FAKE_AWS_CHANGE_SET_RESPONSE_MAP = ''
            }
        }
    }

    Invoke-FocusedTest -Name 'auth wallet transition rejects duplicate and cyclic nested change-set IDs' -Body {
        $cycleCases = @('duplicate-root-links', 'cycle-to-root')
        foreach ($cycleCase in $cycleCases) {
            Set-FakeAuthWalletValidationFixture `
                -CanonicalSha256 $authWalletTransitionRecordSha256 `
                -CurrentStateSha256 $authWalletAdoptionStateSha256 `
                -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
                -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
                -Operation 'STAGE_SUCCESSOR' `
                -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
                -InitialValidationAt $authWalletValidationAt
            $workloadLink = New-NestedChangeSetLink `
                -LogicalResourceId 'WorkloadBoundaries' `
                -StackId $workloadChildStackId `
                -ChangeSetId $workloadChildChangeSetId `
                -DetailKind 'Tags'
            $observabilityLink = New-NestedChangeSetLink `
                -LogicalResourceId 'Observability' `
                -StackId $workloadChildStackId `
                -ChangeSetId $workloadChildChangeSetId `
                -DetailKind 'Tags'
            $cycleLink = New-NestedChangeSetLink `
                -LogicalResourceId 'CycleStack' `
                -StackId $immutableStackId `
                -ChangeSetId $immutableChangeSetId `
                -DetailKind 'Automatic'
            $childLeaf = Copy-JsonValue -Value $tagOnlyAuthWalletResourceChange
            $childLeaf.ResourceChange.LogicalResourceId = 'CycleTestLeaf'
            $childLeaf.ResourceChange.ResourceType = 'AWS::SNS::Topic'
            $childChanges = @($childLeaf)
            if ($cycleCase -ceq 'cycle-to-root') {
                $childChanges = @($cycleLink)
            }
            $rootNestedLinks = if ($cycleCase -ceq 'duplicate-root-links') { @($workloadLink, $observabilityLink) } else { @($workloadLink) }
            Write-NestedChangeSetResponse `
                -Path $workloadChildChangeSetResponsePath `
                -StackName 'crypto-lending-workload-test' `
                -StackId $workloadChildStackId `
                -ChangeSetName 'workload-child-change' `
                -ChangeSetId $workloadChildChangeSetId `
                -ParentChangeSetId $immutableChangeSetId `
                -RootChangeSetId $immutableChangeSetId `
                -Changes $childChanges
            Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
            Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
            Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
            Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
            Write-ChangeSetResponse `
                -ParameterMap $authWalletTransitionParameterMap `
                -TagMap $authWalletTransitionStackTags `
                -Description $authWalletTransitionExpectedChangeSetDescription `
                -ChangeSetType 'UPDATE' `
                -Changes (@($expectedAuthWalletResourceChanges) + @($rootNestedLinks))
            Set-FakeChangeSetResponseMap -ResponseMap ([ordered]@{ $workloadChildChangeSetId = $workloadChildChangeSetResponsePath })
            Clear-AwsMarker
            try {
                $result = Invoke-Guard -Arguments $authWalletTransitionArguments
                $marker = Get-AwsMarkerText
                Assert-Condition (-not $result.Succeeded) "AUTH_WALLET_TRANSITION accepted $cycleCase."
                Assert-Condition ($result.Output -match 'duplicate or cyclic nested ChangeSetId') "$cycleCase rejection did not identify duplicate/cycle protection: $($result.Output)"
                Assert-Condition ($marker -notmatch 'cloudformation execute-change-set') "AUTH_WALLET_TRANSITION executed with $cycleCase."
            }
            finally {
                $env:FAKE_AWS_CHANGE_SET_RESPONSE_MAP = ''
            }
        }
    }

    Invoke-FocusedTest -Name 'auth wallet transition rejects unknown root wrappers and unmapped child IDs' -Body {
        $rootCases = @(
            [pscustomobject]@{ Name = 'unknown root nested stack'; LogicalId = 'UnexpectedNestedStack'; UseMap = $true; OmitId = $false },
            [pscustomobject]@{ Name = 'unmapped known child'; LogicalId = 'WorkloadBoundaries'; UseMap = $false; OmitId = $false },
            [pscustomobject]@{ Name = 'known nested stack without child ID'; LogicalId = 'WorkloadBoundaries'; UseMap = $false; OmitId = $true }
        )
        foreach ($rootCase in $rootCases) {
            Set-FakeAuthWalletValidationFixture `
                -CanonicalSha256 $authWalletTransitionRecordSha256 `
                -CurrentStateSha256 $authWalletAdoptionStateSha256 `
                -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
                -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
                -Operation 'STAGE_SUCCESSOR' `
                -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
                -InitialValidationAt $authWalletValidationAt
            $rootLink = New-NestedChangeSetLink `
                -LogicalResourceId $rootCase.LogicalId `
                -StackId $workloadChildStackId `
                -ChangeSetId $workloadChildChangeSetId `
                -DetailKind 'Tags'
            if ($rootCase.OmitId) {
                $rootLink.ResourceChange.Remove('ChangeSetId')
            }
            Write-NestedChangeSetResponse `
                -Path $workloadChildChangeSetResponsePath `
                -StackName 'crypto-lending-workload-test' `
                -StackId $workloadChildStackId `
                -ChangeSetName 'workload-child-change' `
                -ChangeSetId $workloadChildChangeSetId `
                -ParentChangeSetId $immutableChangeSetId `
                -RootChangeSetId $immutableChangeSetId `
                -Changes @()
            Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
            Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
            Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
            Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
            Write-ChangeSetResponse `
                -ParameterMap $authWalletTransitionParameterMap `
                -TagMap $authWalletTransitionStackTags `
                -Description $authWalletTransitionExpectedChangeSetDescription `
                -ChangeSetType 'UPDATE' `
                -Changes (@($expectedAuthWalletResourceChanges) + @($rootLink))
            if ($rootCase.UseMap) {
                Set-FakeChangeSetResponseMap -ResponseMap ([ordered]@{ $workloadChildChangeSetId = $workloadChildChangeSetResponsePath })
            }
            else {
                $env:FAKE_AWS_CHANGE_SET_RESPONSE_MAP = ''
            }
            Clear-AwsMarker
            try {
                $result = Invoke-Guard -Arguments $authWalletTransitionArguments
                $marker = Get-AwsMarkerText
                Assert-Condition (-not $result.Succeeded) "AUTH_WALLET_TRANSITION accepted $($rootCase.Name)."
                Assert-Condition ($result.Output -match 'AUTH_WALLET_TRANSITION') "$($rootCase.Name) rejection did not identify the auth/wallet nested guard."
                Assert-Condition ($marker -notmatch 'cloudformation execute-change-set') "AUTH_WALLET_TRANSITION executed with $($rootCase.Name)."
            }
            finally {
                $env:FAKE_AWS_CHANGE_SET_RESPONSE_MAP = ''
            }
        }
    }

    Invoke-FocusedTest -Name 'auth wallet Deploy requires its transition-bound acknowledgement' -Body {
        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletTransitionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'STAGE_SUCCESSOR' `
            -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
            -InitialValidationAt $authWalletValidationAt
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $authWalletTransitionParameterMap `
            -TagMap $authWalletTransitionStackTags `
            -Description $authWalletTransitionExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE' `
            -Changes $expectedAuthWalletResourceChanges
        Clear-AwsMarker
        $arguments = Copy-ArgumentMap -Map $authWalletTransitionArguments
        $arguments.BillableAcknowledgement = 'NOT_THE_REVIEWED_AUTH_WALLET_ACKNOWLEDGEMENT'
        $result = Invoke-Guard -Arguments $arguments
        $marker = Get-AwsMarkerText
        Assert-Condition (-not $result.Succeeded) 'AUTH_WALLET_TRANSITION accepted an incorrect acknowledgement.'
        Assert-Condition ($result.Output -match [regex]::Escape($authWalletTransitionBillableAcknowledgement)) 'Auth/wallet acknowledgement rejection did not print the exact required text.'
        Assert-Condition ($marker -notmatch 'cloudformation execute-change-set') 'AUTH_WALLET_TRANSITION executed with an incorrect acknowledgement.'
        Assert-Condition (@(Get-Content -LiteralPath $authWalletValidatorMarkerPath).Count -eq 2) 'Incorrect acknowledgement unexpectedly reached final auth/wallet revalidation.'
    }

    Invoke-FocusedTest -Name 'auth wallet Deploy detects current-state drift before execution' -Body {
        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletTransitionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'STAGE_SUCCESSOR' `
            -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
            -InitialValidationAt $authWalletValidationAt
        $driftedAuthWalletParameters = [ordered]@{}
        foreach ($entry in $updateApplicationParameterMap.GetEnumerator()) {
            $driftedAuthWalletParameters[$entry.Key] = [string] $entry.Value
        }
        $driftedAuthWalletParameters.AuthWalletKeysSecretVersionId = $authWalletTargetVersionId
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
        Write-ApplicationStackResponse -ParameterMap $driftedAuthWalletParameters -TagMap $authWalletAdoptedStackTags -Path $applicationStackResponseAfterFirstPath
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $authWalletTransitionParameterMap `
            -TagMap $authWalletTransitionStackTags `
            -Description $authWalletTransitionExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE' `
            -Changes $expectedAuthWalletResourceChanges
        Clear-AwsMarker
        $env:FAKE_AWS_APPLICATION_STACK_RESPONSE_AFTER_FIRST = $applicationStackResponseAfterFirstPath
        try {
            $result = Invoke-Guard -Arguments $authWalletTransitionArguments
            $marker = Get-AwsMarkerText
            Assert-Condition (-not $result.Succeeded) 'AUTH_WALLET_TRANSITION accepted current-state drift before execution.'
            Assert-Condition ($result.Output -match 'changed after review and before execution') 'Auth/wallet current-state drift rejection was not explicit.'
            Assert-Condition ($marker -notmatch 'cloudformation execute-change-set') 'AUTH_WALLET_TRANSITION executed after current-state drift.'
        }
        finally {
            $env:FAKE_AWS_APPLICATION_STACK_RESPONSE_AFTER_FIRST = ''
        }
    }

    Invoke-FocusedTest -Name 'auth wallet Deploy expires closed and revalidates with a fresh UTC instant' -Body {
        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletTransitionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'STAGE_SUCCESSOR' `
            -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
            -InitialValidationAt $authWalletValidationAt `
            -Variant 'FAIL_FRESH'
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $authWalletTransitionParameterMap `
            -TagMap $authWalletTransitionStackTags `
            -Description $authWalletTransitionExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE' `
            -Changes $expectedAuthWalletResourceChanges
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments $authWalletTransitionArguments
        $marker = Get-AwsMarkerText
        $validationCalls = @(Get-Content -LiteralPath $authWalletValidatorMarkerPath)
        Assert-Condition (-not $result.Succeeded) 'AUTH_WALLET_TRANSITION executed after final validation expired.'
        Assert-Condition ($result.Output -match 'malformed, stale, unauthorized, or deployment-mismatched') 'Final auth/wallet expiry rejection was not explicit.'
        Assert-Condition ($marker -notmatch 'cloudformation execute-change-set') 'AUTH_WALLET_TRANSITION executed after final validation expired.'
        Assert-Condition ($validationCalls.Count -eq 3) 'AUTH_WALLET_TRANSITION did not make its third immediate pre-execution validation.'
        Assert-Condition ($validationCalls[0] -match [regex]::Escape("at=$authWalletValidationAt")) 'Initial auth/wallet validation did not use the explicit caller timestamp.'
        Assert-Condition ($validationCalls[2] -match 'at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z') 'Final auth/wallet validation did not use a canonical UTC timestamp.'
        Assert-Condition ($validationCalls[2] -notmatch [regex]::Escape("at=$authWalletValidationAt")) 'Final auth/wallet validation incorrectly reused the initial timestamp.'
        $env:FAKE_AUTH_WALLET_VALIDATOR_VARIANT = ''
    }

    Invoke-FocusedTest -Name 'exact auth wallet Deploy executes its immutable transition with reviewed tag propagation' -Body {
        Set-FakeAuthWalletValidationFixture `
            -CanonicalSha256 $authWalletTransitionRecordSha256 `
            -CurrentStateSha256 $authWalletAdoptionStateSha256 `
            -TargetStateSha256 $authWalletTransitionTargetStateSha256 `
            -AuthorityRegistrySha256 $authWalletTransitionAuthorityRegistrySha256 `
            -Operation 'STAGE_SUCCESSOR' `
            -FieldName 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' `
            -InitialValidationAt $authWalletValidationAt
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $authWalletTransitionParameterMap `
            -TagMap $authWalletTransitionStackTags `
            -Description $authWalletTransitionExpectedChangeSetDescription `
            -ChangeSetType 'UPDATE' `
            -Changes (@($expectedAuthWalletResourceChanges) + @($tagOnlyAuthWalletResourceChange))
        Clear-AwsMarker
        $result = Invoke-Guard -Arguments $authWalletTransitionArguments
        $marker = Get-AwsMarkerText
        $validationCalls = @(Get-Content -LiteralPath $authWalletValidatorMarkerPath)
        Assert-Condition $result.Succeeded "Exact auth/wallet Deploy failed: $($result.Output)"
        Assert-Condition ($marker -match 'cloudformation execute-change-set') 'Exact auth/wallet transition did not execute the immutable change set.'
        Assert-Condition ($validationCalls.Count -eq 3) 'Exact auth/wallet Deploy did not revalidate immediately before execution.'
        Assert-Condition ($validationCalls[2] -notmatch [regex]::Escape("at=$authWalletValidationAt")) 'Exact auth/wallet Deploy reused its initial validation timestamp.'
        Assert-Condition ($result.Output -match [regex]::Escape($authWalletTransitionDeploymentBindingSha256)) 'Exact auth/wallet Deploy did not report its deployment binding.'
        Assert-Condition ($result.Output -match [regex]::Escape($authWalletTransitionAuthorityRegistrySha256)) 'Exact auth/wallet Deploy did not report its authority registry binding.'
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
        $lateDriftParameterMap.AuthWalletKeysSecretVersionId = $authWalletKeysSecretVersionId -replace '0001$', '0002'
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
        Write-ApplicationStackResponse -ParameterMap $lateDriftParameterMap -TagMap $authWalletAdoptedStackTags -Path $applicationStackResponseAfterFirstPath
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $applicationUpdateParameterMap `
            -TagMap $authWalletAdoptedStackTags `
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
        Write-ApplicationStackResponse -ParameterMap $updateApplicationParameterMap -TagMap $authWalletAdoptedStackTags
        Write-GuardrailStackResponse -ConfigurationSha256 $controlConfigurationSha256
        Write-TemplateResponse -Path $guardrailTemplateResponsePath -TemplateBody $guardrailTemplateBody
        Write-TemplateResponse -Path $applicationTemplateResponsePath -TemplateBody $applicationTemplateBody
        Write-ChangeSetResponse `
            -ParameterMap $applicationUpdateParameterMap `
            -TagMap $authWalletAdoptedStackTags `
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
    $env:FAKE_AWS_CHANGE_SET_RESPONSE_MAP = $originalEnvironment.FAKE_AWS_CHANGE_SET_RESPONSE_MAP
    $env:FAKE_AWS_ROOT_CHANGE_SET_ID = $originalEnvironment.FAKE_AWS_ROOT_CHANGE_SET_ID
    $env:FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE = $originalEnvironment.FAKE_AWS_APPLICATION_TEMPLATE_RESPONSE
    $env:FAKE_AWS_BUCKET_LOCATION_RESPONSE = $originalEnvironment.FAKE_AWS_BUCKET_LOCATION_RESPONSE
    $env:FAKE_AWS_BUCKET_VERSIONING_RESPONSE = $originalEnvironment.FAKE_AWS_BUCKET_VERSIONING_RESPONSE
    $env:FAKE_AWS_ARTIFACT_OBJECT_RESPONSE = $originalEnvironment.FAKE_AWS_ARTIFACT_OBJECT_RESPONSE
    $env:FAKE_AWS_ARTIFACT_OBJECT_SOURCE = $originalEnvironment.FAKE_AWS_ARTIFACT_OBJECT_SOURCE
    $env:FAKE_AWS_OBSERVABILITY_ARTIFACT_OBJECT_SOURCE = $originalEnvironment.FAKE_AWS_OBSERVABILITY_ARTIFACT_OBJECT_SOURCE
    $env:FAKE_AWS_MANAGED_PREFIX_LIST_RESPONSE = $originalEnvironment.FAKE_AWS_MANAGED_PREFIX_LIST_RESPONSE
    $env:FAKE_REAL_NODE = $originalEnvironment.FAKE_REAL_NODE
    $env:FAKE_AUTH_WALLET_VALIDATOR_MARKER = $originalEnvironment.FAKE_AUTH_WALLET_VALIDATOR_MARKER
    $env:FAKE_AUTH_WALLET_VALIDATOR_VARIANT = $originalEnvironment.FAKE_AUTH_WALLET_VALIDATOR_VARIANT
    $env:FAKE_AUTH_WALLET_CANONICAL_SHA256 = $originalEnvironment.FAKE_AUTH_WALLET_CANONICAL_SHA256
    $env:FAKE_AUTH_WALLET_CURRENT_STATE_SHA256 = $originalEnvironment.FAKE_AUTH_WALLET_CURRENT_STATE_SHA256
    $env:FAKE_AUTH_WALLET_TARGET_STATE_SHA256 = $originalEnvironment.FAKE_AUTH_WALLET_TARGET_STATE_SHA256
    $env:FAKE_AUTH_WALLET_PREDECESSOR_TRANSITION_SHA256 = $originalEnvironment.FAKE_AUTH_WALLET_PREDECESSOR_TRANSITION_SHA256
    $env:FAKE_AUTH_WALLET_AUTHORITY_REGISTRY_SHA256 = $originalEnvironment.FAKE_AUTH_WALLET_AUTHORITY_REGISTRY_SHA256
    $env:FAKE_AUTH_WALLET_OPERATION = $originalEnvironment.FAKE_AUTH_WALLET_OPERATION
    $env:FAKE_AUTH_WALLET_FIELD_NAME = $originalEnvironment.FAKE_AUTH_WALLET_FIELD_NAME
    $env:FAKE_AUTH_WALLET_INITIAL_VALIDATION_AT = $originalEnvironment.FAKE_AUTH_WALLET_INITIAL_VALIDATION_AT

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
    foreach ($authWalletRecordPath in @($approvedAuthWalletAdoptionRecordPath, $approvedAuthWalletTransitionRecordPath)) {
        $resolvedAuthWalletRecordPath = [System.IO.Path]::GetFullPath($authWalletRecordPath)
        if (
            $resolvedAuthWalletRecordPath.StartsWith($transitionDirectoryPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
            ([System.IO.Path]::GetFileName($resolvedAuthWalletRecordPath) -like 'invoke-application-*.auth-wallet-transition.local.json') -and
            (Test-Path -LiteralPath $resolvedAuthWalletRecordPath -PathType Leaf)
        ) {
            Remove-Item -LiteralPath $resolvedAuthWalletRecordPath -Force
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
