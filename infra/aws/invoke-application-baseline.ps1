<#
.SYNOPSIS
Validates KAN-34 locally by default and guards every optional AWS-side action.

.DESCRIPTION
LocalValidate is the default and performs filesystem-only policy validation of
both the parent application template and its workload-boundary child template.
CloudValidate, Plan, and Deploy require an explicit named profile, account ID,
Region, and AllowAwsApiCalls. Plan creates a named change set without executing
it, but its versioned S3 artifact reads can incur AWS request charges. The guard
never uploads a template or creates an artifact bucket. Plan and Deploy also
require the independently approved KAN-229 billing
control record, deployed guardrail stack, and KAN-230 certificate/DNS prerequisite
record. Deploy verifies and executes that exact template/parameter/tag/control-
record-bound change set only after an exact billable-resource acknowledgement.

.PARAMETER Action
LocalValidate, CloudValidate, Plan, or Deploy. Defaults to LocalValidate.

.PARAMETER ParameterOverride
Non-secret CloudFormation parameters in Key=Value form. Secret values are
rejected; AuthWalletKeysSecretArn is the sole reviewed external secret reference.
When operational alarms are enabled, AlarmTopicArn must name one
existing SNS topic in the approved partition, account, and Region.
The child-template delivery parameters, auth/wallet secret VersionId, and seven
credential-state VersionIds are derived from named inputs by this guard and
must not be supplied as overrides.

.PARAMETER WorkloadBoundariesTemplateFile
Reviewed local workload-boundary child template. Its exact byte SHA-256 is bound
to the versioned S3 object, parent parameters, tags, change-set description, and
Deploy acknowledgement.

.PARAMETER WorkloadBoundariesArtifactBucket
Existing same-account, same-Region, versioning-enabled S3 bucket. This guard
does not create, modify, or upload to the bucket.

.PARAMETER WorkloadBoundariesArtifactVersionId
Exact non-null S3 VersionId for the content-addressed child template object.

.PARAMETER ObservabilityTemplateFile
Reviewed local operational-observability child template.

.PARAMETER ObservabilityArtifactBucket
Existing same-account, same-Region, versioning-enabled S3 bucket containing the
content-addressed observability child. This guard never uploads it.

.PARAMETER ObservabilityArtifactVersionId
Exact non-null S3 VersionId for the observability child template object.

.PARAMETER AuthWalletKeysSecretVersionId
Exact 32-64 character Secrets Manager VersionId shared by all seven API
authentication and wallet key selectors. APPLICATION and fixed-slot updates
preserve it; AUTH_WALLET_TRANSITION alone may adopt or advance its signed state.

.PARAMETER RedisOperatorSecretVersionId
Exact Secrets Manager VersionId for the disabled Redis operator credential, or
the uppercase UNPINNED sentinel for a zero-count CREATE only. Adoption pins it
with the six A/B slots; every later fixed-slot transition must preserve it.

.PARAMETER ApiDatabaseSlotAVersionId
Exact Secrets Manager VersionId for API database slot A, or the uppercase
UNPINNED sentinel for a zero-count CREATE only. The other five fixed-slot
VersionId parameters and Redis operator VersionId have the same contract and
must be supplied together.

.PARAMETER FixedSlotCredentialTransitionRecordFile
Git-ignored local JSON record validated for every UPDATE against the exact
account, Region, immutable stack ID, environment, and reviewed template hashes.

.PARAMETER CurrentStackId
Exact immutable application stack ARN. Required for UPDATE and checked against
the live stack response, change set, current-state binding, and acknowledgement;
credential transitions also require the local record to name the same ARN.

.PARAMETER UpdateIntent
Required for UPDATE. APPLICATION permits a non-credential application change
only while all eleven credential-state version/phase/operator bindings remain
unchanged. CREDENTIAL_TRANSITION permits only the transition record's exact
eleven bindings. AUTH_WALLET_TRANSITION permits a signed chain-tag adoption or
shared outer VersionId change. Both transition intents freeze unrelated template,
parameter, and base-tag state and preserve the other credential chain.

.PARAMETER FixedSlotCredentialTransitionMode
Exact lowercase adopt or transition mode for the local fixed-slot validator.

.PARAMETER FixedSlotCredentialTransitionValidationAt
Explicit current canonical UTC instant used by the local transition validator.
It must be within five minutes of this invocation so an old validation instant
cannot make expired evidence appear current.

.PARAMETER AuthWalletTransitionRecordFile
Git-ignored local signed record for the dedicated auth/wallet outer-VersionId
adoption or transition. It is prohibited for every other update intent.

.PARAMETER AuthWalletTransitionMode
Exact lowercase adopt or transition mode for the signed auth/wallet validator.

.PARAMETER AuthWalletTransitionValidationAt
Explicit current canonical UTC instant for the initial offline auth/wallet
validation. Deploy revalidates at a fresh canonical UTC instant immediately
before execution.

.PARAMETER AuthWalletTransitionAuthorityRegistrySha256
Exact lowercase SHA-256 of the validator's checked-in production authority
registry. This is a digest pin only; callers cannot supply a trust registry.

.PARAMETER AuthWalletTransitionCurrentVersionId
Exact currently deployed outer Secrets Manager VersionId independently supplied
by the caller and checked against both the signed record and live stack.

.PARAMETER AuthWalletTransitionOperation
Exact reviewed signed operation independently selected by the caller.

.PARAMETER AuthWalletTransitionFieldName
Exact reviewed seven-field adoption marker or individual auth/wallet ring field
independently selected by the caller.

.PARAMETER AllowAwsApiCalls
Explicit opt-in required before this script resolves credentials or calls AWS.

.PARAMETER BillingControlRecordFile
Git-ignored local JSON record whose identity, ownership, approval, expiry, and live
notification evidence must pass final KAN-229 validation before Plan or Deploy.

.PARAMETER AcmDnsControlRecordFile
Git-ignored KAN-230 record whose approved hostname and issued ACM certificate
must match the application parameters before Plan or Deploy.

.PARAMETER GuardrailStackName
Existing KAN-229 account-guardrail stack verified before an application change
set is created or executed.

.PARAMETER GuardrailControlRegion
Approved Region containing the KAN-229 account-guardrail stack.

.PARAMETER BillableAcknowledgement
Exact case-sensitive text printed by a blocked Deploy attempt. Supplying it is
an execution authorization, not evidence that the resources are free.

.EXAMPLE
pwsh -NoProfile -File infra/aws/invoke-application-baseline.ps1

Runs only the local validator, makes zero AWS calls, and creates no resources.
#>
[CmdletBinding()]
param(
    [ValidateSet('LocalValidate', 'CloudValidate', 'Plan', 'Deploy')]
    [string] $Action = 'LocalValidate',

    [string] $TemplateFile,

    [string] $WorkloadBoundariesTemplateFile,

    [string] $ObservabilityTemplateFile,

    [string] $Profile,

    [string] $AccountId,

    [string] $Region,

    [string] $StackName,

    [string] $ChangeSetName,

    [ValidateSet('CREATE', 'UPDATE')]
    [string] $ChangeSetType,

    [string] $EnvironmentName,

    [string] $BillingControlRecordFile,

    [string] $AcmDnsControlRecordFile,

    [string] $GuardrailStackName,

    [string] $GuardrailControlRegion,

    [string] $WorkloadBoundariesArtifactBucket,

    [string] $WorkloadBoundariesArtifactVersionId,

    [string] $ObservabilityArtifactBucket,

    [string] $ObservabilityArtifactVersionId,

    [string] $AuthWalletKeysSecretVersionId,

    [string] $RedisOperatorSecretVersionId,

    [string] $ApiDatabaseSlotAVersionId,

    [string] $ApiDatabaseSlotBVersionId,

    [string] $WorkerDatabaseSlotAVersionId,

    [string] $WorkerDatabaseSlotBVersionId,

    [string] $RedisApiSlotAVersionId,

    [string] $RedisApiSlotBVersionId,

    [string] $CurrentStackId,

    [ValidateSet('APPLICATION', 'CREDENTIAL_TRANSITION', 'AUTH_WALLET_TRANSITION')]
    [string] $UpdateIntent,

    [string] $FixedSlotCredentialTransitionRecordFile,

    [ValidateSet('adopt', 'transition')]
    [string] $FixedSlotCredentialTransitionMode,

    [string] $FixedSlotCredentialTransitionValidationAt,

    [string] $AuthWalletTransitionRecordFile,

    [ValidateSet('adopt', 'transition')]
    [string] $AuthWalletTransitionMode,

    [string] $AuthWalletTransitionValidationAt,

    [string] $AuthWalletTransitionAuthorityRegistrySha256,

    [string] $AuthWalletTransitionCurrentVersionId,

    [string] $AuthWalletTransitionOperation,

    [string] $AuthWalletTransitionFieldName,

    [string[]] $ParameterOverride = @(),

    [switch] $AllowAwsApiCalls,

    [string] $BillableAcknowledgement
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($TemplateFile)) {
    $TemplateFile = Join-Path $PSScriptRoot 'application-baseline.yaml'
}
if ([string]::IsNullOrWhiteSpace($WorkloadBoundariesTemplateFile)) {
    $WorkloadBoundariesTemplateFile = Join-Path $PSScriptRoot 'application-workload-boundaries.yaml'
}
if ([string]::IsNullOrWhiteSpace($ObservabilityTemplateFile)) {
    $ObservabilityTemplateFile = Join-Path $PSScriptRoot 'application-observability.yaml'
}

$validatorPath = Join-Path $PSScriptRoot 'validate-application-baseline.mjs'
$workloadBoundariesValidatorPath = Join-Path $PSScriptRoot 'validate-application-workload-boundaries.mjs'
$observabilityValidatorPath = Join-Path $PSScriptRoot 'validate-application-observability.mjs'
$billingRecordValidatorPath = Join-Path $PSScriptRoot 'validate-billing-control-record.mjs'
$acmDnsRecordValidatorPath = Join-Path $PSScriptRoot 'validate-acm-dns-control-record.mjs'
$fixedSlotCredentialTransitionValidatorPath = Join-Path $PSScriptRoot 'validate-fixed-slot-credential-transition.mjs'
$authWalletTransitionValidatorPath = Join-Path $PSScriptRoot 'validate-auth-wallet-secret-version-transition.mjs'
$accountGuardrailTemplatePath = Join-Path $PSScriptRoot 'account-guardrails.yaml'
$resolvedTemplate = [System.IO.Path]::GetFullPath($TemplateFile)
$resolvedWorkloadBoundariesTemplate = [System.IO.Path]::GetFullPath($WorkloadBoundariesTemplateFile)
$resolvedObservabilityTemplate = [System.IO.Path]::GetFullPath($ObservabilityTemplateFile)

function Assert-RequiredValue {
    param(
        [string] $Name,
        [AllowNull()]
        [AllowEmptyString()]
        [string] $Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$Name must be supplied explicitly."
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

function ConvertTo-CanonicalTagText {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary] $Tags
    )

    return ($Tags.GetEnumerator() | Sort-Object Key | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"
}

function ConvertFrom-ChangeSetTags {
    param(
        [AllowNull()]
        [object[]] $Tags
    )

    $result = [System.Collections.Specialized.OrderedDictionary]::new([System.StringComparer]::Ordinal)
    foreach ($tag in @($Tags)) {
        if ([string]::IsNullOrWhiteSpace([string] $tag.Key) -or $null -eq $tag.Value) {
            throw 'The reviewed change set contains an incomplete stack tag.'
        }
        if ($result.Contains([string] $tag.Key)) {
            throw "The reviewed change set contains duplicate stack tag '$($tag.Key)'."
        }
        $result[[string] $tag.Key] = [string] $tag.Value
    }
    return $result
}

function Get-StackOutputMap {
    param(
        [Parameter(Mandatory = $true)]
        [object] $Stack
    )

    $result = [ordered]@{}
    foreach ($output in @($Stack.Outputs)) {
        if (-not [string]::IsNullOrWhiteSpace([string] $output.OutputKey)) {
            $result[[string] $output.OutputKey] = [string] $output.OutputValue
        }
    }
    return $result
}

function Get-StackParameterMap {
    param(
        [Parameter(Mandatory = $true)]
        [object] $Stack
    )

    $result = [ordered]@{}
    foreach ($parameter in @($Stack.Parameters)) {
        if ([string]::IsNullOrWhiteSpace([string] $parameter.ParameterKey) -or $null -eq $parameter.ParameterValue) {
            throw 'The guardrail stack contains an incomplete parameter.'
        }
        if ($result.Contains([string] $parameter.ParameterKey)) {
            throw "The guardrail stack contains duplicate parameter '$($parameter.ParameterKey)'."
        }
        $result[[string] $parameter.ParameterKey] = [string] $parameter.ParameterValue
    }
    return $result
}

function Get-OptionalPropertyValue {
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

function ConvertFrom-ParameterOverrides {
    param([string[]] $Overrides)

    $result = [System.Collections.Specialized.OrderedDictionary]::new([System.StringComparer]::Ordinal)
    foreach ($item in $Overrides) {
        if ($item -notmatch '^([A-Za-z][A-Za-z0-9]*)=(.+)$') {
            throw "ParameterOverride '$item' must use the exact Key=Value form."
        }
        $key = $Matches[1]
        if ($result.Contains($key)) {
            throw "ParameterOverride contains duplicate key '$key'."
        }
        $result[$key] = $Matches[2]
    }
    return $result
}

function ConvertFrom-FixedSlotRecordState {
    param(
        [Parameter(Mandatory = $true)]
        [object] $State
    )

    return [ordered]@{
        RedisOperatorSecretVersionId = [string] $State.redisOperatorSecretVersionId
        ApiDatabaseSlotAVersionId = [string] $State.apiDatabase.slots.a.currentVersionId
        ApiDatabaseSlotBVersionId = [string] $State.apiDatabase.slots.b.currentVersionId
        WorkerDatabaseSlotAVersionId = [string] $State.workerDatabase.slots.a.currentVersionId
        WorkerDatabaseSlotBVersionId = [string] $State.workerDatabase.slots.b.currentVersionId
        RedisApiSlotAVersionId = [string] $State.redis.slots.a.currentVersionId
        RedisApiSlotBVersionId = [string] $State.redis.slots.b.currentVersionId
        ApiDatabaseCredentialPhase = [string] $State.apiDatabase.phase
        WorkerDatabaseCredentialPhase = [string] $State.workerDatabase.phase
        RedisCredentialPhase = [string] $State.redis.phase
        RedisOperatorMode = [string] $State.operatorMode
    }
}

function Invoke-FixedSlotCredentialTransitionValidation {
    param(
        [string] $RecordPath,
        [string] $Mode,
        [string] $ValidationAt,
        [string] $ExpectedStackId
    )

    $validationOutput = @(& $nodeCommand.Source @(
            $fixedSlotCredentialTransitionValidatorPath,
            '--record', $RecordPath,
            '--mode', $Mode,
            '--at', $ValidationAt,
            '--expected-account', $AccountId,
            '--expected-region', $Region,
            '--expected-stack', $StackName,
            '--expected-stack-id', $ExpectedStackId,
            '--expected-environment', $EnvironmentName,
            '--expected-parent-template-sha256', $templateSha256,
            '--expected-workload-template-sha256', $workloadBoundariesTemplateSha256,
            '--json'
        ) 2>&1)
    $validationExitCode = $LASTEXITCODE
    if ($validationExitCode -ne 0) {
        throw 'The fixed-slot credential transition record is malformed, stale, unauthorized, or deployment-mismatched. No AWS calls were made.'
    }
    try {
        $validation = (($validationOutput | ForEach-Object { $_.ToString() }) -join "`n") | ConvertFrom-Json
    }
    catch {
        throw 'Fixed-slot credential transition validation did not return a valid local report. No AWS calls were made.'
    }
    if (
        -not $validation.ok -or
        -not $validation.readyForAuthorizedPlan -or
        [string] $validation.mode -cne $Mode -or
        $validation.plan.executionAllowed -ne $false -or
        $validation.externalCallsMade -ne 0 -or
        $validation.awsCallsMade -ne 0 -or
        $validation.databaseConnectionsMade -ne 0 -or
        $validation.redisConnectionsMade -ne 0 -or
        $validation.dnsQueriesMade -ne 0 -or
        $validation.httpRequestsMade -ne 0 -or
        $validation.resourcesCreated -ne 0 -or
        $validation.credentialBytesRead -ne 0 -or
        $validation.filesWritten -ne 0
    ) {
        throw 'Fixed-slot credential transition validation did not produce an approved zero-call, non-executable report.'
    }
    foreach ($hashProperty in @('canonicalSha256', 'currentStateSha256', 'targetStateSha256')) {
        if ([string] $validation.$hashProperty -notmatch '^[a-f0-9]{64}$') {
            throw "Fixed-slot credential transition validation did not return a valid $hashProperty binding."
        }
    }
    return $validation
}

function Invoke-AuthWalletTransitionValidation {
    param(
        [string] $RecordPath,
        [string] $Mode,
        [string] $ValidationAt,
        [string] $ExpectedStackId,
        [string] $ExpectedSecretArn,
        [string] $ExpectedKmsKeyArn,
        [string] $ExpectedCurrentVersionId,
        [string] $ExpectedTargetVersionId,
        [string] $ExpectedOperation,
        [string] $ExpectedFieldName,
        [string] $ExpectedAuthorityRegistrySha256
    )

    $validationOutput = @(& $nodeCommand.Source @(
            $authWalletTransitionValidatorPath,
            '--record', $RecordPath,
            '--mode', $Mode,
            '--at', $ValidationAt,
            '--expected-account', $AccountId,
            '--expected-region', $Region,
            '--expected-stack', $StackName,
            '--expected-stack-id', $ExpectedStackId,
            '--expected-environment', $EnvironmentName,
            '--expected-parent-template-sha256', $templateSha256,
            '--expected-workload-template-sha256', $workloadBoundariesTemplateSha256,
            '--expected-secret-arn', $ExpectedSecretArn,
            '--expected-kms-key-arn', $ExpectedKmsKeyArn,
            '--expected-current-version-id', $ExpectedCurrentVersionId,
            '--expected-target-version-id', $ExpectedTargetVersionId,
            '--json'
        ) 2>&1)
    $validationExitCode = $LASTEXITCODE
    if ($validationExitCode -ne 0) {
        throw 'The auth/wallet transition record is malformed, stale, unauthorized, or deployment-mismatched. No AWS calls were made.'
    }
    try {
        $validation = (($validationOutput | ForEach-Object { $_.ToString() }) -join "`n") | ConvertFrom-Json
    }
    catch {
        throw 'Auth/wallet transition validation did not return a valid local report. No AWS calls were made.'
    }

    foreach ($trueProperty in @('ok', 'readyForAuthorizedPlan', 'productionAuthorityValidated', 'signatureValidated')) {
        $property = $validation.PSObject.Properties[$trueProperty]
        if ($null -eq $property -or $property.Value -isnot [bool] -or $property.Value -ne $true) {
            throw "Auth/wallet transition validation did not return exact true '$trueProperty' authority."
        }
    }
    if (
        [string] $validation.mode -cne $Mode -or
        [string] $validation.operation -cne $ExpectedOperation -or
        [string] $validation.fieldName -cne $ExpectedFieldName -or
        $null -eq $validation.PSObject.Properties['errors'] -or
        @($validation.errors).Count -ne 0
    ) {
        throw 'Auth/wallet transition validation did not match the exact signed operation, field, and mode.'
    }
    foreach ($counterProperty in @(
            'externalCallsMade',
            'awsCallsMade',
            'databaseConnectionsMade',
            'redisConnectionsMade',
            'dnsQueriesMade',
            'httpRequestsMade',
            'resourcesCreated',
            'credentialBytesRead',
            'filesWritten'
        )) {
        $counter = $validation.PSObject.Properties[$counterProperty]
        if (
            $null -eq $counter -or
            $counter.Value -is [bool] -or
            $counter.Value -is [string] -or
            $counter.Value -notin @([byte] 0, [sbyte] 0, [int16] 0, [uint16] 0, [int32] 0, [uint32] 0, [int64] 0, [uint64] 0, [single] 0, [double] 0, [decimal] 0)
        ) {
            throw "Auth/wallet transition validation did not return exact numeric zero '$counterProperty'."
        }
    }
    foreach ($hashProperty in @('canonicalSha256', 'currentStateSha256', 'targetStateSha256', 'authorityRegistrySha256')) {
        if ([string] $validation.$hashProperty -cnotmatch '^[a-f0-9]{64}$') {
            throw "Auth/wallet transition validation did not return a valid $hashProperty binding."
        }
    }
    $predecessorTransitionProperty = $validation.PSObject.Properties['predecessorTransitionSha256']
    $predecessorTransitionSha256 = if ($null -eq $predecessorTransitionProperty) { $null } else { [string] $predecessorTransitionProperty.Value }
    if (
        ($Mode -ceq 'adopt' -and $predecessorTransitionSha256 -cne 'NONE') -or
        ($Mode -ceq 'transition' -and $predecessorTransitionSha256 -cnotmatch '^[a-f0-9]{64}$')
    ) {
        throw 'Auth/wallet transition validation did not return the exact signed predecessor transition binding.'
    }
    if ([string] $validation.authorityRegistrySha256 -cne $ExpectedAuthorityRegistrySha256) {
        throw 'Auth/wallet transition validation used a different production authority registry than the exact caller-pinned digest.'
    }
    $planProperty = $validation.PSObject.Properties['plan']
    $plan = if ($null -eq $planProperty) { $null } else { $planProperty.Value }
    if (
        $null -eq $plan -or
        [string] $plan.kind -cne 'LOCAL_ONLY_NON_EXECUTABLE_AUTH_WALLET_VERSION_PLAN' -or
        [string] $plan.operation -cne $ExpectedOperation -or
        [string] $plan.fieldName -cne $ExpectedFieldName -or
        [string] $plan.versionParameter -cne 'AuthWalletKeysSecretVersionId' -or
        [string] $plan.currentVersionId -cne $ExpectedCurrentVersionId -or
        [string] $plan.targetVersionId -cne $ExpectedTargetVersionId -or
        $plan.executionAllowed -isnot [bool] -or
        $plan.executionAllowed -ne $false -or
        $plan.separateAuthorizationRequired -isnot [bool] -or
        $plan.separateAuthorizationRequired -ne $true
    ) {
        throw 'Auth/wallet transition validation did not return the exact non-executable outer-VersionId plan.'
    }
    return $validation
}

function Assert-VersionedChildArtifact {
    param(
        [string] $ArtifactLabel,
        [string] $DownloadFileName,
        [string] $Bucket,
        [string] $Key,
        [string] $VersionId,
        [string] $ExpectedOwner,
        [string] $ExpectedRegion,
        [string] $ExpectedSha256,
        [string] $ProfileName
    )

    $locationOutput = & $script:AwsExecutable @(
        's3api',
        'get-bucket-location',
        '--bucket', $Bucket,
        '--expected-bucket-owner', $ExpectedOwner,
        '--profile', $ProfileName,
        '--region', $ExpectedRegion,
        '--output', 'json',
        '--no-cli-pager'
    )
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to verify the $ArtifactLabel artifact bucket '$Bucket' in the approved account."
    }
    $locationResponse = ($locationOutput | Out-String) | ConvertFrom-Json
    if ($null -eq $locationResponse -or $null -eq $locationResponse.PSObject.Properties['LocationConstraint']) {
        throw "S3 did not return a bucket LocationConstraint for '$Bucket'."
    }
    $locationConstraint = $locationResponse.PSObject.Properties['LocationConstraint'].Value
    $actualBucketRegion = if ($null -eq $locationConstraint -or [string]::IsNullOrEmpty([string] $locationConstraint)) {
        'us-east-1'
    } elseif ([string] $locationConstraint -ceq 'EU') {
        'eu-west-1'
    } else {
        [string] $locationConstraint
    }
    if ($actualBucketRegion -cne $ExpectedRegion) {
        throw "$ArtifactLabel artifact bucket '$Bucket' is in '$actualBucketRegion', not approved Region '$ExpectedRegion'."
    }

    $versioningOutput = & $script:AwsExecutable @(
        's3api',
        'get-bucket-versioning',
        '--bucket', $Bucket,
        '--expected-bucket-owner', $ExpectedOwner,
        '--profile', $ProfileName,
        '--region', $ExpectedRegion,
        '--output', 'json',
        '--no-cli-pager'
    )
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to verify versioning for $ArtifactLabel artifact bucket '$Bucket'."
    }
    $versioningResponse = ($versioningOutput | Out-String) | ConvertFrom-Json
    if (([string] (Get-OptionalPropertyValue -InputObject $versioningResponse -Name 'Status')) -cne 'Enabled') {
        throw "$ArtifactLabel artifact bucket '$Bucket' must have versioning Enabled."
    }

    $temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $temporaryDirectory = Join-Path $temporaryBase ('kan34-child-artifact-' + [guid]::NewGuid().ToString('N'))
    [void] [System.IO.Directory]::CreateDirectory($temporaryDirectory)
    $downloadPath = Join-Path $temporaryDirectory $DownloadFileName
    try {
        $getObjectOutput = & $script:AwsExecutable @(
            's3api',
            'get-object',
            '--bucket', $Bucket,
            '--key', $Key,
            '--version-id', $VersionId,
            '--expected-bucket-owner', $ExpectedOwner,
            '--profile', $ProfileName,
            '--region', $ExpectedRegion,
            '--output', 'json',
            '--no-cli-pager',
            $downloadPath
        )
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to retrieve the exact versioned $ArtifactLabel artifact."
        }
        if (-not (Test-Path -LiteralPath $downloadPath -PathType Leaf)) {
            throw "The exact versioned $ArtifactLabel artifact was not downloaded."
        }

        $getObjectResponse = ($getObjectOutput | Out-String) | ConvertFrom-Json
        $returnedVersionId = [string] (Get-OptionalPropertyValue -InputObject $getObjectResponse -Name 'VersionId')
        if ($returnedVersionId -cne $VersionId) {
            throw "S3 did not return the exact requested $ArtifactLabel artifact VersionId."
        }
        $downloadedSha256 = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($downloadedSha256 -cne $ExpectedSha256) {
            throw "The exact versioned $ArtifactLabel artifact does not match reviewed local bytes (Expected=$ExpectedSha256, Actual=$downloadedSha256)."
        }
    }
    finally {
        $resolvedTemporaryDirectory = [System.IO.Path]::GetFullPath($temporaryDirectory)
        $safePrefix = $temporaryBase.TrimEnd(
            [System.IO.Path]::DirectorySeparatorChar,
            [System.IO.Path]::AltDirectorySeparatorChar
        ) + [System.IO.Path]::DirectorySeparatorChar
        if (
            $resolvedTemporaryDirectory.StartsWith($safePrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
            ([System.IO.Path]::GetFileName($resolvedTemporaryDirectory) -like 'kan34-child-artifact-*') -and
            (Test-Path -LiteralPath $resolvedTemporaryDirectory -PathType Container)
        ) {
            Remove-Item -LiteralPath $resolvedTemporaryDirectory -Recurse -Force
        }
    }
}

function Assert-RegionalS3ManagedPrefixList {
    param(
        [string] $PrefixListId,
        [string] $ExpectedRegion,
        [string] $ProfileName
    )

    $prefixListOutput = & $script:AwsExecutable @(
        'ec2',
        'describe-managed-prefix-lists',
        '--prefix-list-ids', $PrefixListId,
        '--profile', $ProfileName,
        '--region', $ExpectedRegion,
        '--no-paginate',
        '--output', 'json',
        '--no-cli-pager'
    )
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to verify S3ManagedPrefixListId '$PrefixListId'."
    }
    $prefixListResponse = ($prefixListOutput | Out-String) | ConvertFrom-Json
    $prefixListValue = Get-OptionalPropertyValue -InputObject $prefixListResponse -Name 'PrefixLists'
    [object[]] $managedPrefixLists = @()
    if ($null -ne $prefixListValue) {
        $managedPrefixLists = @($prefixListValue)
    }
    if ($managedPrefixLists.Count -ne 1) {
        throw "S3ManagedPrefixListId '$PrefixListId' must resolve to exactly one managed prefix list."
    }
    $prefixList = $managedPrefixLists[0]
    $expectedName = "com.amazonaws.$ExpectedRegion.s3"
    if (
        [string] (Get-OptionalPropertyValue -InputObject $prefixList -Name 'PrefixListId') -cne $PrefixListId -or
        [string] (Get-OptionalPropertyValue -InputObject $prefixList -Name 'PrefixListName') -cne $expectedName -or
        [string] (Get-OptionalPropertyValue -InputObject $prefixList -Name 'OwnerId') -cne 'AWS' -or
        [string] (Get-OptionalPropertyValue -InputObject $prefixList -Name 'State') -cne 'create-complete' -or
        [string] (Get-OptionalPropertyValue -InputObject $prefixList -Name 'AddressFamily') -cne 'IPv4'
    ) {
        throw "S3ManagedPrefixListId '$PrefixListId' is not the exact AWS-owned, active IPv4 '$expectedName' prefix list."
    }
}

if (-not (Test-Path -LiteralPath $validatorPath -PathType Leaf)) {
    throw "Local policy validator was not found: $validatorPath"
}
if (-not (Test-Path -LiteralPath $workloadBoundariesValidatorPath -PathType Leaf)) {
    throw "Local workload-boundary policy validator was not found: $workloadBoundariesValidatorPath"
}
if (-not (Test-Path -LiteralPath $observabilityValidatorPath -PathType Leaf)) {
    throw "Local observability policy validator was not found: $observabilityValidatorPath"
}
if (-not (Test-Path -LiteralPath $billingRecordValidatorPath -PathType Leaf)) {
    throw "Billing control record validator was not found: $billingRecordValidatorPath"
}
if (-not (Test-Path -LiteralPath $acmDnsRecordValidatorPath -PathType Leaf)) {
    throw "ACM/DNS control record validator was not found: $acmDnsRecordValidatorPath"
}
if (-not (Test-Path -LiteralPath $fixedSlotCredentialTransitionValidatorPath -PathType Leaf)) {
    throw "Fixed-slot credential transition validator was not found: $fixedSlotCredentialTransitionValidatorPath"
}
if (-not (Test-Path -LiteralPath $authWalletTransitionValidatorPath -PathType Leaf)) {
    throw "Auth/wallet transition validator was not found: $authWalletTransitionValidatorPath"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
    throw 'Node.js is required for local CloudFormation policy validation.'
}

# Every action starts with local Node.js policy validation before AWS tooling or
# credentials are resolved. These validators perform no provider/network calls.
$preValidationTemplateSha256 = (Get-FileHash -LiteralPath $resolvedTemplate -Algorithm SHA256).Hash.ToLowerInvariant()
$preValidationChildSha256 = (Get-FileHash -LiteralPath $resolvedWorkloadBoundariesTemplate -Algorithm SHA256).Hash.ToLowerInvariant()
$preValidationObservabilitySha256 = (Get-FileHash -LiteralPath $resolvedObservabilityTemplate -Algorithm SHA256).Hash.ToLowerInvariant()
& $nodeCommand.Source $validatorPath --template $resolvedTemplate
if ($LASTEXITCODE -ne 0) {
    throw 'Local CloudFormation policy validation failed. No AWS calls were made.'
}
& $nodeCommand.Source $workloadBoundariesValidatorPath --template $resolvedWorkloadBoundariesTemplate
if ($LASTEXITCODE -ne 0) {
    throw 'Local workload-boundary policy validation failed. No AWS calls were made.'
}
& $nodeCommand.Source $observabilityValidatorPath --template $resolvedObservabilityTemplate
if ($LASTEXITCODE -ne 0) {
    throw 'Local observability policy validation failed. No AWS calls were made.'
}
$postValidationTemplateSha256 = (Get-FileHash -LiteralPath $resolvedTemplate -Algorithm SHA256).Hash.ToLowerInvariant()
$postValidationChildSha256 = (Get-FileHash -LiteralPath $resolvedWorkloadBoundariesTemplate -Algorithm SHA256).Hash.ToLowerInvariant()
$postValidationObservabilitySha256 = (Get-FileHash -LiteralPath $resolvedObservabilityTemplate -Algorithm SHA256).Hash.ToLowerInvariant()
if (
    $postValidationTemplateSha256 -cne $preValidationTemplateSha256 -or
    $postValidationChildSha256 -cne $preValidationChildSha256 -or
    $postValidationObservabilitySha256 -cne $preValidationObservabilitySha256
) {
    throw 'A local template changed during offline policy validation. No AWS calls were made; retry from a stable reviewed worktree.'
}

$templateInfo = Get-Item -LiteralPath $resolvedTemplate
if ($templateInfo.Length -gt 50500) {
    throw 'Parent template exceeds the reviewed 50,500-byte direct-upload ceiling.'
}
$workloadBoundariesTemplateInfo = Get-Item -LiteralPath $resolvedWorkloadBoundariesTemplate
if ($workloadBoundariesTemplateInfo.Length -gt 51200) {
    throw 'Workload-boundary template exceeds the reviewed 51,200-byte limit.'
}
$observabilityTemplateInfo = Get-Item -LiteralPath $resolvedObservabilityTemplate
if ($observabilityTemplateInfo.Length -gt 51200) {
    throw 'Observability child template exceeds the reviewed 51,200-byte limit.'
}
$templateSha256 = $postValidationTemplateSha256
$workloadBoundariesTemplateSha256 = $postValidationChildSha256
$observabilityTemplateSha256 = $postValidationObservabilitySha256
$parentTemplateSource = Get-Content -LiteralPath $resolvedTemplate -Raw
$pinnedChildHashMatch = [regex]::Match(
    $parentTemplateSource,
    '(?m)^\s+WorkloadBoundariesTemplateSha256:\r?$\n\s+Type: String\r?$\n\s+AllowedValues: \[([a-f0-9]{64})\]\r?$'
)
$pinnedChildUrlFragment = "application-workload-boundaries-$workloadBoundariesTemplateSha256\.yaml"
if (
    -not $pinnedChildHashMatch.Success -or
    $pinnedChildHashMatch.Groups[1].Value -cne $workloadBoundariesTemplateSha256 -or
    $parentTemplateSource.IndexOf($pinnedChildUrlFragment, [System.StringComparison]::Ordinal) -lt 0
) {
    throw "Reviewed child SHA-256 $workloadBoundariesTemplateSha256 does not match the parent template's exact AllowedValue and content-addressed TemplateURL pin. No AWS calls were made."
}
$pinnedObservabilityHashMatch = [regex]::Match(
    $parentTemplateSource,
    '(?m)^\s+ObservabilityTemplateSha256:\r?$\n\s+Type: String\r?$\n\s+AllowedValues: \[([a-f0-9]{64})\]\r?$'
)
$pinnedObservabilityUrlFragment = "application-observability-$observabilityTemplateSha256\.yaml"
if (
    -not $pinnedObservabilityHashMatch.Success -or
    $pinnedObservabilityHashMatch.Groups[1].Value -cne $observabilityTemplateSha256 -or
    $parentTemplateSource.IndexOf($pinnedObservabilityUrlFragment, [System.StringComparison]::Ordinal) -lt 0
) {
    throw "Reviewed observability SHA-256 $observabilityTemplateSha256 does not match the parent template's exact AllowedValue and content-addressed TemplateURL pin. No AWS calls were made."
}

if ($Action -eq 'LocalValidate') {
    Write-Host "Local parent and both child validations completed (Workload SHA-256=$workloadBoundariesTemplateSha256; Observability SHA-256=$observabilityTemplateSha256). No AWS calls were made and no resources were created."
    return
}

Assert-RequiredValue -Name 'Profile' -Value $Profile
Assert-RequiredValue -Name 'AccountId' -Value $AccountId
Assert-RequiredValue -Name 'Region' -Value $Region

if ($AccountId -notmatch '^\d{12}$') {
    throw 'AccountId must be an explicit 12-digit AWS account ID.'
}
if ($Region -notmatch '^[a-z]{2}(?:-gov)?-[a-z]+-\d$') {
    throw 'Region must be an explicit AWS region such as us-east-1.'
}
if ($Profile -match '^default$') {
    throw "The implicit/default AWS profile is prohibited. Supply a named, non-default profile."
}

$requestedPartition = if ($Region -like 'cn-*') {
    'aws-cn'
} elseif ($Region -like 'us-gov-*') {
    'aws-us-gov'
} else {
    'aws'
}
$explicitParameterOverrides = [System.Collections.Specialized.OrderedDictionary]::new([System.StringComparer]::Ordinal)
$fixedSlotTransitionRecord = $null
$fixedSlotTransitionValidation = $null
$fixedSlotTransitionRecordSha256 = $null
$fixedSlotCurrentStateSha256 = $null
$fixedSlotTargetStateSha256 = $null
$fixedSlotTransitionDeploymentBindingSha256 = $null
$fixedSlotCurrentBindings = $null
$fixedSlotTargetBindings = $null
$authWalletTransitionValidation = $null
$authWalletTransitionRecordSha256 = $null
$authWalletCurrentStateSha256 = $null
$authWalletTargetStateSha256 = $null
$authWalletPredecessorTransitionSha256 = $null
$authWalletTransitionDeploymentBindingSha256 = $null
$authWalletCurrentVersionId = $null
$authWalletTargetVersionId = $null
$validatedAuthWalletTransitionOperation = $null
$validatedAuthWalletTransitionFieldName = $null
$resolvedAuthWalletTransitionRecord = $null
$authWalletTransitionRecordRawShaBefore = $null
$currentStackParameterSnapshotSha256 = $null
$currentStackTagSnapshotSha256 = $null
$currentApplicationTemplateSha256 = $null
$currentStackBindingSha256 = $null
$isApplicationUpdate = $false
$isCredentialTransition = $false
$isAuthWalletTransition = $false
$preservedCredentialTags = $null
$preservedAuthWalletTags = $null
$credentialVersionValues = [ordered]@{
    RedisOperatorSecretVersionId = $RedisOperatorSecretVersionId
    ApiDatabaseSlotAVersionId = $ApiDatabaseSlotAVersionId
    ApiDatabaseSlotBVersionId = $ApiDatabaseSlotBVersionId
    WorkerDatabaseSlotAVersionId = $WorkerDatabaseSlotAVersionId
    WorkerDatabaseSlotBVersionId = $WorkerDatabaseSlotBVersionId
    RedisApiSlotAVersionId = $RedisApiSlotAVersionId
    RedisApiSlotBVersionId = $RedisApiSlotBVersionId
}

$controlRecord = $null
$controlRecordSha256 = $null
$controlConfigurationSha256 = $null
$resolvedBillingControlRecord = $null
$acmDnsBinding = $null
$acmDnsRecordSha256 = $null
$acmDnsConfigurationSha256 = $null
$resolvedAcmDnsControlRecord = $null
$expectedGuardrailPolicyVersion = 'kan-229-v1'
$workloadBoundariesArtifactKey = $null
$workloadBoundariesArtifactBindingSha256 = $null
$workloadBoundariesTemplateUrl = $null
$observabilityArtifactKey = $null
$observabilityArtifactBindingSha256 = $null
$observabilityTemplateUrl = $null
if ($Action -in @('Plan', 'Deploy')) {
    Assert-RequiredValue -Name 'StackName' -Value $StackName
    Assert-RequiredValue -Name 'ChangeSetName' -Value $ChangeSetName
    Assert-RequiredValue -Name 'ChangeSetType' -Value $ChangeSetType
    if (@('CREATE', 'UPDATE') -cnotcontains $ChangeSetType) {
        throw 'ChangeSetType must use exact uppercase CREATE or UPDATE.'
    }
    Assert-RequiredValue -Name 'EnvironmentName' -Value $EnvironmentName
    Assert-RequiredValue -Name 'BillingControlRecordFile' -Value $BillingControlRecordFile
    Assert-RequiredValue -Name 'AcmDnsControlRecordFile' -Value $AcmDnsControlRecordFile
    Assert-RequiredValue -Name 'GuardrailStackName' -Value $GuardrailStackName
    Assert-RequiredValue -Name 'GuardrailControlRegion' -Value $GuardrailControlRegion
    Assert-RequiredValue -Name 'WorkloadBoundariesArtifactBucket' -Value $WorkloadBoundariesArtifactBucket
    Assert-RequiredValue -Name 'WorkloadBoundariesArtifactVersionId' -Value $WorkloadBoundariesArtifactVersionId
    Assert-RequiredValue -Name 'ObservabilityArtifactBucket' -Value $ObservabilityArtifactBucket
    Assert-RequiredValue -Name 'ObservabilityArtifactVersionId' -Value $ObservabilityArtifactVersionId

    if ($StackName -notmatch '^[A-Za-z][A-Za-z0-9-]{0,127}$') {
        throw 'StackName must be a valid explicit CloudFormation stack name.'
    }
    if ($ChangeSetName -notmatch '^[A-Za-z][A-Za-z0-9-]{0,127}$') {
        throw 'ChangeSetName must be an explicit CloudFormation-safe name.'
    }

    if ($EnvironmentName.Length -gt 31 -or $EnvironmentName -notmatch '^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$') {
        throw 'EnvironmentName must be at most 31 characters and use the template non-production pattern: dev|test|qa|sandbox|staging with optional lowercase suffix segments.'
    }
    if ($GuardrailStackName -notmatch '^[A-Za-z][A-Za-z0-9-]{0,127}$') {
        throw 'GuardrailStackName must be a valid explicit CloudFormation stack name.'
    }
    if ($GuardrailControlRegion -cne 'us-east-1') {
        throw 'GuardrailControlRegion must be us-east-1 for the current KAN-229 account-control template.'
    }
    if ($WorkloadBoundariesArtifactBucket -notmatch '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$') {
        throw 'WorkloadBoundariesArtifactBucket must be one explicit DNS-compatible bucket name without dots.'
    }
    if ($ObservabilityArtifactBucket -notmatch '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$') {
        throw 'ObservabilityArtifactBucket must be one explicit DNS-compatible bucket name without dots.'
    }
    if (
        $WorkloadBoundariesArtifactVersionId -ceq 'null' -or
        $WorkloadBoundariesArtifactVersionId.Length -gt 1024 -or
        $WorkloadBoundariesArtifactVersionId -match '[\x00-\x1f\x7f]'
    ) {
        throw 'WorkloadBoundariesArtifactVersionId must be an exact non-null printable S3 VersionId of at most 1,024 characters.'
    }
    if (
        $ObservabilityArtifactVersionId -ceq 'null' -or
        $ObservabilityArtifactVersionId.Length -gt 1024 -or
        $ObservabilityArtifactVersionId -match '[\x00-\x1f\x7f]'
    ) {
        throw 'ObservabilityArtifactVersionId must be an exact non-null printable S3 VersionId of at most 1,024 characters.'
    }

    $explicitParameterOverrides = ConvertFrom-ParameterOverrides -Overrides $ParameterOverride
    Assert-RequiredValue -Name 'AuthWalletKeysSecretVersionId' -Value $AuthWalletKeysSecretVersionId
    if ($AuthWalletKeysSecretVersionId -cnotmatch '^[A-Za-z0-9_-]{32,64}$') {
        throw 'AuthWalletKeysSecretVersionId must be an exact 32-64 character Secrets Manager VersionId.'
    }
    if ($explicitParameterOverrides.Contains('AuthWalletKeysSecretVersionId')) {
        throw 'AuthWalletKeysSecretVersionId is a named immutable binding and must not be supplied in ParameterOverride.'
    }
    foreach ($credentialVersion in $credentialVersionValues.GetEnumerator()) {
        Assert-RequiredValue -Name $credentialVersion.Key -Value ([string] $credentialVersion.Value)
        if ([string] $credentialVersion.Value -cnotmatch '^(UNPINNED|[A-Za-z0-9_-]{32,64})$') {
            throw "$($credentialVersion.Key) must be exactly UNPINNED or a 32-64 character Secrets Manager VersionId."
        }
        if ($explicitParameterOverrides.Contains($credentialVersion.Key)) {
            throw "$($credentialVersion.Key) is a named immutable binding and must not be supplied in ParameterOverride."
        }
    }
    $unpinnedVersionCount = @($credentialVersionValues.Values | Where-Object { [string] $_ -ceq 'UNPINNED' }).Count
    if ($unpinnedVersionCount -notin @(0, 7)) {
        throw 'The seven credential-state VersionId values must be either all exact pins or all UNPINNED; mixed state is prohibited.'
    }

    $earlyControlValues = [ordered]@{
        ApiDesiredCount = '0'
        WebDesiredCount = '0'
        WorkerDesiredCount = '0'
        ApiDatabaseCredentialPhase = 'A_ONLY'
        WorkerDatabaseCredentialPhase = 'A_ONLY'
        RedisCredentialPhase = 'A_ONLY'
        RedisOperatorMode = 'DISABLED'
    }
    foreach ($controlName in @($earlyControlValues.Keys)) {
        if ($explicitParameterOverrides.Contains($controlName)) {
            $earlyControlValues[$controlName] = [string] $explicitParameterOverrides[$controlName]
        }
    }

    if ($ChangeSetType -eq 'CREATE') {
        if (
            -not [string]::IsNullOrWhiteSpace($UpdateIntent) -or
            -not [string]::IsNullOrWhiteSpace($CurrentStackId) -or
            -not [string]::IsNullOrWhiteSpace($FixedSlotCredentialTransitionRecordFile) -or
            -not [string]::IsNullOrWhiteSpace($FixedSlotCredentialTransitionMode) -or
            -not [string]::IsNullOrWhiteSpace($FixedSlotCredentialTransitionValidationAt) -or
            -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionRecordFile) -or
            -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionMode) -or
            -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionValidationAt) -or
            -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionAuthorityRegistrySha256) -or
            -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionCurrentVersionId) -or
            -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionOperation) -or
            -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionFieldName)
        ) {
            throw 'CREATE must not supply UPDATE-only stack or transition inputs.'
        }
        if ($unpinnedVersionCount -ne 7) {
            throw 'CREATE requires all seven credential-state VersionId values to be UNPINNED.'
        }
        foreach ($desiredCount in @('ApiDesiredCount', 'WebDesiredCount', 'WorkerDesiredCount')) {
            if ($earlyControlValues[$desiredCount] -cne '0') {
                throw "$desiredCount must be 0 for a CREATE change set. Start services only in a reviewed UPDATE after endpoints and migrations are ready."
            }
        }
        foreach ($phaseName in @('ApiDatabaseCredentialPhase', 'WorkerDatabaseCredentialPhase', 'RedisCredentialPhase')) {
            if ($earlyControlValues[$phaseName] -cne 'A_ONLY') {
                throw "$phaseName must be A_ONLY while CREATE uses the UNPINNED fixed-slot sentinel."
            }
        }
        if ($earlyControlValues.RedisOperatorMode -cne 'DISABLED') {
            throw 'RedisOperatorMode must be DISABLED while CREATE uses the UNPINNED fixed-slot sentinel.'
        }
    }
    else {
        if ($unpinnedVersionCount -ne 0) {
            throw 'UPDATE requires all seven credential-state VersionId values to be exact immutable pins.'
        }
        Assert-RequiredValue -Name 'CurrentStackId' -Value $CurrentStackId
        Assert-RequiredValue -Name 'UpdateIntent' -Value $UpdateIntent
        $isApplicationUpdate = $UpdateIntent -ceq 'APPLICATION'
        $isCredentialTransition = $UpdateIntent -ceq 'CREDENTIAL_TRANSITION'
        $isAuthWalletTransition = $UpdateIntent -ceq 'AUTH_WALLET_TRANSITION'
        if (-not $isApplicationUpdate -and -not $isCredentialTransition -and -not $isAuthWalletTransition) {
            throw 'UpdateIntent must use exact uppercase APPLICATION, CREDENTIAL_TRANSITION, or AUTH_WALLET_TRANSITION.'
        }
        $expectedCurrentStackIdPattern = '^arn:' + [regex]::Escape($requestedPartition) + ':cloudformation:' + [regex]::Escape($Region) + ':' + [regex]::Escape($AccountId) + ':stack/' + [regex]::Escape($StackName) + '/[A-Za-z0-9-]{8,64}$'
        if ($CurrentStackId -cnotmatch $expectedCurrentStackIdPattern) {
            throw 'CurrentStackId must be the exact immutable stack ARN for the approved account, Region, and stack name.'
        }

        foreach ($explicitFixedSlotControl in @(
                'ApiDatabaseCredentialPhase',
                'WorkerDatabaseCredentialPhase',
                'RedisCredentialPhase',
                'RedisOperatorMode'
            )) {
            if (-not $explicitParameterOverrides.Contains($explicitFixedSlotControl)) {
                throw "UPDATE must explicitly provide '$explicitFixedSlotControl'; implicit previous fixed-slot controls are prohibited."
            }
        }

        if ($isApplicationUpdate -or $isAuthWalletTransition) {
            $fixedSlotTargetBindings = [ordered]@{}
            foreach ($credentialVersion in $credentialVersionValues.GetEnumerator()) {
                $fixedSlotTargetBindings[$credentialVersion.Key] = [string] $credentialVersion.Value
            }
            foreach ($fixedSlotControl in @(
                    'ApiDatabaseCredentialPhase',
                    'WorkerDatabaseCredentialPhase',
                    'RedisCredentialPhase',
                    'RedisOperatorMode'
                )) {
                $fixedSlotTargetBindings[$fixedSlotControl] = [string] $explicitParameterOverrides[$fixedSlotControl]
            }
        }

        if ($isApplicationUpdate) {
            if (
                -not [string]::IsNullOrWhiteSpace($FixedSlotCredentialTransitionRecordFile) -or
                -not [string]::IsNullOrWhiteSpace($FixedSlotCredentialTransitionMode) -or
                -not [string]::IsNullOrWhiteSpace($FixedSlotCredentialTransitionValidationAt) -or
                -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionRecordFile) -or
                -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionMode) -or
                -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionValidationAt) -or
                -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionAuthorityRegistrySha256) -or
                -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionCurrentVersionId) -or
                -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionOperation) -or
                -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionFieldName)
            ) {
                throw 'APPLICATION updates must not supply fixed-slot or auth/wallet transition inputs.'
            }
        }
        elseif ($isCredentialTransition) {
            if (
                -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionRecordFile) -or
                -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionMode) -or
                -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionValidationAt) -or
                -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionAuthorityRegistrySha256) -or
                -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionCurrentVersionId) -or
                -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionOperation) -or
                -not [string]::IsNullOrWhiteSpace($AuthWalletTransitionFieldName)
            ) {
                throw 'CREDENTIAL_TRANSITION updates must not supply auth/wallet transition inputs.'
            }
            Assert-RequiredValue -Name 'FixedSlotCredentialTransitionRecordFile' -Value $FixedSlotCredentialTransitionRecordFile
            Assert-RequiredValue -Name 'FixedSlotCredentialTransitionMode' -Value $FixedSlotCredentialTransitionMode
            Assert-RequiredValue -Name 'FixedSlotCredentialTransitionValidationAt' -Value $FixedSlotCredentialTransitionValidationAt
            if (@('adopt', 'transition') -cnotcontains $FixedSlotCredentialTransitionMode) {
                throw 'FixedSlotCredentialTransitionMode must use exact lowercase adopt or transition.'
            }

            $parsedValidationAt = [DateTimeOffset]::MinValue
            $canonicalValidationAt = $FixedSlotCredentialTransitionValidationAt -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' -and
                [DateTimeOffset]::TryParse(
                    $FixedSlotCredentialTransitionValidationAt,
                    [System.Globalization.CultureInfo]::InvariantCulture,
                    [System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal,
                    [ref] $parsedValidationAt
                ) -and
                $parsedValidationAt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture) -ceq $FixedSlotCredentialTransitionValidationAt
            if (-not $canonicalValidationAt) {
                throw 'FixedSlotCredentialTransitionValidationAt must be one canonical UTC instant.'
            }
            $validationAgeSeconds = ([DateTimeOffset]::UtcNow - $parsedValidationAt).TotalSeconds
            if ($validationAgeSeconds -lt -60 -or $validationAgeSeconds -gt 300) {
                throw 'FixedSlotCredentialTransitionValidationAt must be current within the reviewed five-minute window. No AWS calls were made.'
            }

            if ($FixedSlotCredentialTransitionMode -ceq 'adopt') {
                foreach ($desiredCount in @('ApiDesiredCount', 'WebDesiredCount', 'WorkerDesiredCount')) {
                    if (-not $explicitParameterOverrides.Contains($desiredCount) -or [string] $explicitParameterOverrides[$desiredCount] -cne '0') {
                        throw "Fixed-slot adoption requires explicit $desiredCount=0."
                    }
                }
            }

            $resolvedFixedSlotTransitionRecord = [System.IO.Path]::GetFullPath($FixedSlotCredentialTransitionRecordFile)
            $fixedSlotValidationOne = Invoke-FixedSlotCredentialTransitionValidation `
                -RecordPath $resolvedFixedSlotTransitionRecord `
                -Mode $FixedSlotCredentialTransitionMode `
                -ValidationAt $FixedSlotCredentialTransitionValidationAt `
                -ExpectedStackId $CurrentStackId
            try {
                $recordRawShaBefore = (Get-FileHash -LiteralPath $resolvedFixedSlotTransitionRecord -Algorithm SHA256).Hash.ToLowerInvariant()
                $fixedSlotTransitionRecordText = [System.IO.File]::ReadAllText($resolvedFixedSlotTransitionRecord)
                $recordRawShaAfterRead = (Get-FileHash -LiteralPath $resolvedFixedSlotTransitionRecord -Algorithm SHA256).Hash.ToLowerInvariant()
                $fixedSlotTransitionRecord = $fixedSlotTransitionRecordText | ConvertFrom-Json
            }
            catch {
                throw 'The validated fixed-slot credential transition record could not be read stably. No AWS calls were made.'
            }
            $fixedSlotValidationTwo = Invoke-FixedSlotCredentialTransitionValidation `
                -RecordPath $resolvedFixedSlotTransitionRecord `
                -Mode $FixedSlotCredentialTransitionMode `
                -ValidationAt $FixedSlotCredentialTransitionValidationAt `
                -ExpectedStackId $CurrentStackId
            $recordRawShaAfterValidation = (Get-FileHash -LiteralPath $resolvedFixedSlotTransitionRecord -Algorithm SHA256).Hash.ToLowerInvariant()
            if (
                $recordRawShaBefore -cne $recordRawShaAfterRead -or
                $recordRawShaBefore -cne $recordRawShaAfterValidation -or
                [string] $fixedSlotValidationOne.canonicalSha256 -cne [string] $fixedSlotValidationTwo.canonicalSha256 -or
                [string] $fixedSlotValidationOne.currentStateSha256 -cne [string] $fixedSlotValidationTwo.currentStateSha256 -or
                [string] $fixedSlotValidationOne.targetStateSha256 -cne [string] $fixedSlotValidationTwo.targetStateSha256
            ) {
                throw 'The fixed-slot credential transition record changed during local validation. No AWS calls were made.'
            }
            $fixedSlotTransitionValidation = $fixedSlotValidationTwo
            $fixedSlotTransitionRecordSha256 = [string] $fixedSlotTransitionValidation.canonicalSha256
            $fixedSlotCurrentStateSha256 = [string] $fixedSlotTransitionValidation.currentStateSha256
            $fixedSlotTargetStateSha256 = [string] $fixedSlotTransitionValidation.targetStateSha256
            $fixedSlotTransitionDeploymentBindingText = "record-sha256=$fixedSlotTransitionRecordSha256`ncurrent-state-sha256=$fixedSlotCurrentStateSha256`ntarget-state-sha256=$fixedSlotTargetStateSha256`ncurrent-stack-id=$CurrentStackId`nparent-template-sha256=$templateSha256`nworkload-template-sha256=$workloadBoundariesTemplateSha256`nobservability-template-sha256=$observabilityTemplateSha256`nmode=$FixedSlotCredentialTransitionMode`noperation=$($fixedSlotTransitionValidation.operation)"
            $fixedSlotCurrentBindings = ConvertFrom-FixedSlotRecordState -State $fixedSlotTransitionRecord.currentState
            $fixedSlotTargetBindings = ConvertFrom-FixedSlotRecordState -State $fixedSlotTransitionRecord.targetState
            foreach ($targetVersion in $credentialVersionValues.GetEnumerator()) {
                if ([string] $fixedSlotTargetBindings[$targetVersion.Key] -cne [string] $targetVersion.Value) {
                    throw "Target credential-state binding '$($targetVersion.Key)' does not match the approved transition record. No AWS calls were made."
                }
            }
            foreach ($targetControl in @('ApiDatabaseCredentialPhase', 'WorkerDatabaseCredentialPhase', 'RedisCredentialPhase', 'RedisOperatorMode')) {
                if ([string] $fixedSlotTargetBindings[$targetControl] -cne [string] $explicitParameterOverrides[$targetControl]) {
                    throw "Target fixed-slot control '$targetControl' does not match the approved transition record. No AWS calls were made."
                }
            }
            if (
                ($FixedSlotCredentialTransitionMode -ceq 'adopt' -and [string] $fixedSlotTransitionValidation.operation -cne 'ADOPT_AND_PIN') -or
                ($FixedSlotCredentialTransitionMode -ceq 'transition' -and [string] $fixedSlotTransitionValidation.operation -ceq 'ADOPT_AND_PIN')
            ) {
                throw 'The fixed-slot credential transition operation does not match the explicitly requested mode.'
            }
        }
        else {
            if (
                -not [string]::IsNullOrWhiteSpace($FixedSlotCredentialTransitionRecordFile) -or
                -not [string]::IsNullOrWhiteSpace($FixedSlotCredentialTransitionMode) -or
                -not [string]::IsNullOrWhiteSpace($FixedSlotCredentialTransitionValidationAt)
            ) {
                throw 'AUTH_WALLET_TRANSITION updates must not supply fixed-slot transition inputs.'
            }
            Assert-RequiredValue -Name 'AuthWalletTransitionRecordFile' -Value $AuthWalletTransitionRecordFile
            Assert-RequiredValue -Name 'AuthWalletTransitionMode' -Value $AuthWalletTransitionMode
            Assert-RequiredValue -Name 'AuthWalletTransitionValidationAt' -Value $AuthWalletTransitionValidationAt
            Assert-RequiredValue -Name 'AuthWalletTransitionAuthorityRegistrySha256' -Value $AuthWalletTransitionAuthorityRegistrySha256
            Assert-RequiredValue -Name 'AuthWalletTransitionCurrentVersionId' -Value $AuthWalletTransitionCurrentVersionId
            Assert-RequiredValue -Name 'AuthWalletTransitionOperation' -Value $AuthWalletTransitionOperation
            Assert-RequiredValue -Name 'AuthWalletTransitionFieldName' -Value $AuthWalletTransitionFieldName
            if (@('adopt', 'transition') -cnotcontains $AuthWalletTransitionMode) {
                throw 'AuthWalletTransitionMode must use exact lowercase adopt or transition.'
            }
            if ($AuthWalletTransitionAuthorityRegistrySha256 -cnotmatch '^[a-f0-9]{64}$') {
                throw 'AuthWalletTransitionAuthorityRegistrySha256 must be one exact lowercase SHA-256 digest.'
            }
            if ($AuthWalletTransitionCurrentVersionId -cnotmatch '^[A-Za-z0-9_-]{32,64}$') {
                throw 'AuthWalletTransitionCurrentVersionId must be an exact 32-64 character Secrets Manager VersionId.'
            }

            $parsedAuthWalletValidationAt = [DateTimeOffset]::MinValue
            $canonicalAuthWalletValidationAt = $AuthWalletTransitionValidationAt -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' -and
                [DateTimeOffset]::TryParse(
                    $AuthWalletTransitionValidationAt,
                    [System.Globalization.CultureInfo]::InvariantCulture,
                    [System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal,
                    [ref] $parsedAuthWalletValidationAt
                ) -and
                $parsedAuthWalletValidationAt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture) -ceq $AuthWalletTransitionValidationAt
            if (-not $canonicalAuthWalletValidationAt) {
                throw 'AuthWalletTransitionValidationAt must be one canonical UTC instant.'
            }
            $authWalletValidationAgeSeconds = ([DateTimeOffset]::UtcNow - $parsedAuthWalletValidationAt).TotalSeconds
            if ($authWalletValidationAgeSeconds -lt -60 -or $authWalletValidationAgeSeconds -gt 300) {
                throw 'AuthWalletTransitionValidationAt must be current within the reviewed five-minute window. No AWS calls were made.'
            }

            foreach ($requiredAuthWalletParameter in @('AuthWalletKeysSecretArn', 'AuthWalletKeysKmsKeyArn')) {
                if (-not $explicitParameterOverrides.Contains($requiredAuthWalletParameter)) {
                    throw "AUTH_WALLET_TRANSITION requires explicit '$requiredAuthWalletParameter' before offline record validation. No AWS calls were made."
                }
            }
            $expectedAuthWalletSecretArn = [string] $explicitParameterOverrides.AuthWalletKeysSecretArn
            $expectedAuthWalletKmsKeyArn = [string] $explicitParameterOverrides.AuthWalletKeysKmsKeyArn
            $earlyExpectedAuthSecretPattern = '^arn:' + [regex]::Escape($requestedPartition) + ':secretsmanager:' + [regex]::Escape($Region) + ':' + [regex]::Escape($AccountId) + ':secret:[A-Za-z0-9/_+=.@-]+$'
            $earlyExpectedAuthKmsPattern = '^arn:' + [regex]::Escape($requestedPartition) + ':kms:' + [regex]::Escape($Region) + ':' + [regex]::Escape($AccountId) + ':key/[a-f0-9-]+$'
            if ($expectedAuthWalletSecretArn -cnotmatch $earlyExpectedAuthSecretPattern -or $expectedAuthWalletKmsKeyArn -cnotmatch $earlyExpectedAuthKmsPattern) {
                throw 'AUTH_WALLET_TRANSITION requires exact selector-free secret and customer-managed KMS ARNs in the approved account and Region. No AWS calls were made.'
            }

            $authWalletCurrentVersionId = $AuthWalletTransitionCurrentVersionId
            $authWalletTargetVersionId = $AuthWalletKeysSecretVersionId
            $validatedAuthWalletTransitionOperation = $AuthWalletTransitionOperation
            $validatedAuthWalletTransitionFieldName = $AuthWalletTransitionFieldName
            if (
                ($AuthWalletTransitionMode -ceq 'adopt' -and (
                        $validatedAuthWalletTransitionOperation -cne 'ADOPT_EXISTING_BINDING' -or
                        $validatedAuthWalletTransitionFieldName -cne 'ALL_SEVEN_FIELDS' -or
                        $authWalletCurrentVersionId -cne $authWalletTargetVersionId
                    )) -or
                ($AuthWalletTransitionMode -ceq 'transition' -and (
                        $validatedAuthWalletTransitionOperation -ceq 'ADOPT_EXISTING_BINDING' -or
                        $validatedAuthWalletTransitionFieldName -ceq 'ALL_SEVEN_FIELDS' -or
                        $authWalletCurrentVersionId -ceq $authWalletTargetVersionId
                    ))
            ) {
                throw 'The auth/wallet transition operation does not match the explicitly requested adopt or transition mode.'
            }
            $authRingTransitionFields = @(
                'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
                'AUTH_SESSION_HMAC_KEY_RING_JSON',
                'AUTH_CSRF_HMAC_KEY_RING_JSON'
            )
            $walletRingTransitionFields = @(
                'WALLET_IDENTITY_HMAC_KEY_RING_JSON',
                'WALLET_CHALLENGE_HMAC_KEY_RING_JSON',
                'WALLET_METADATA_SEAL_KEY_RING_JSON'
            )
            if (
                $AuthWalletTransitionMode -ceq 'transition' -and
                (
                    ($authRingTransitionFields -ccontains $validatedAuthWalletTransitionFieldName -and $validatedAuthWalletTransitionOperation -cnotin @('STAGE_SUCCESSOR', 'ACTIVATE_SUCCESSOR', 'ABORT_STAGED_SUCCESSOR', 'RETIRE_PREDECESSOR')) -or
                    ($walletRingTransitionFields -ccontains $validatedAuthWalletTransitionFieldName -and $validatedAuthWalletTransitionOperation -cnotin @('ADD_AND_ACTIVATE_SUCCESSOR', 'RETIRE_PREDECESSOR')) -or
                    ($authRingTransitionFields -cnotcontains $validatedAuthWalletTransitionFieldName -and $walletRingTransitionFields -cnotcontains $validatedAuthWalletTransitionFieldName)
                )
            ) {
                throw 'AuthWalletTransitionOperation and AuthWalletTransitionFieldName must identify one exact reviewed auth or wallet ring transition.'
            }

            $resolvedAuthWalletTransitionRecord = [System.IO.Path]::GetFullPath($AuthWalletTransitionRecordFile)
            $authWalletValidationOne = Invoke-AuthWalletTransitionValidation `
                -RecordPath $resolvedAuthWalletTransitionRecord `
                -Mode $AuthWalletTransitionMode `
                -ValidationAt $AuthWalletTransitionValidationAt `
                -ExpectedStackId $CurrentStackId `
                -ExpectedSecretArn $expectedAuthWalletSecretArn `
                -ExpectedKmsKeyArn $expectedAuthWalletKmsKeyArn `
                -ExpectedCurrentVersionId $authWalletCurrentVersionId `
                -ExpectedTargetVersionId $authWalletTargetVersionId `
                -ExpectedOperation $validatedAuthWalletTransitionOperation `
                -ExpectedFieldName $validatedAuthWalletTransitionFieldName `
                -ExpectedAuthorityRegistrySha256 $AuthWalletTransitionAuthorityRegistrySha256
            try {
                $authWalletTransitionRecordRawShaBefore = (Get-FileHash -LiteralPath $resolvedAuthWalletTransitionRecord -Algorithm SHA256).Hash.ToLowerInvariant()
            }
            catch {
                throw 'The validated auth/wallet transition record could not be hashed stably. No AWS calls were made.'
            }
            $authWalletValidationTwo = Invoke-AuthWalletTransitionValidation `
                -RecordPath $resolvedAuthWalletTransitionRecord `
                -Mode $AuthWalletTransitionMode `
                -ValidationAt $AuthWalletTransitionValidationAt `
                -ExpectedStackId $CurrentStackId `
                -ExpectedSecretArn $expectedAuthWalletSecretArn `
                -ExpectedKmsKeyArn $expectedAuthWalletKmsKeyArn `
                -ExpectedCurrentVersionId $authWalletCurrentVersionId `
                -ExpectedTargetVersionId $authWalletTargetVersionId `
                -ExpectedOperation $validatedAuthWalletTransitionOperation `
                -ExpectedFieldName $validatedAuthWalletTransitionFieldName `
                -ExpectedAuthorityRegistrySha256 $AuthWalletTransitionAuthorityRegistrySha256
            $authWalletTransitionRecordRawShaAfterValidation = (Get-FileHash -LiteralPath $resolvedAuthWalletTransitionRecord -Algorithm SHA256).Hash.ToLowerInvariant()
            if (
                $authWalletTransitionRecordRawShaBefore -cne $authWalletTransitionRecordRawShaAfterValidation -or
                [string] $authWalletValidationOne.canonicalSha256 -cne [string] $authWalletValidationTwo.canonicalSha256 -or
                [string] $authWalletValidationOne.currentStateSha256 -cne [string] $authWalletValidationTwo.currentStateSha256 -or
                [string] $authWalletValidationOne.targetStateSha256 -cne [string] $authWalletValidationTwo.targetStateSha256 -or
                [string] $authWalletValidationOne.predecessorTransitionSha256 -cne [string] $authWalletValidationTwo.predecessorTransitionSha256 -or
                [string] $authWalletValidationOne.authorityRegistrySha256 -cne [string] $authWalletValidationTwo.authorityRegistrySha256
            ) {
                throw 'The auth/wallet transition record or authority binding changed during local validation. No AWS calls were made.'
            }
            $authWalletTransitionValidation = $authWalletValidationTwo
            $authWalletTransitionRecordSha256 = [string] $authWalletTransitionValidation.canonicalSha256
            $authWalletCurrentStateSha256 = [string] $authWalletTransitionValidation.currentStateSha256
            $authWalletTargetStateSha256 = [string] $authWalletTransitionValidation.targetStateSha256
            $authWalletPredecessorTransitionSha256 = [string] $authWalletTransitionValidation.predecessorTransitionSha256
            $authWalletTransitionDeploymentBindingText = "record-sha256=$authWalletTransitionRecordSha256`ncurrent-state-sha256=$authWalletCurrentStateSha256`ntarget-state-sha256=$authWalletTargetStateSha256`npredecessor-transition-sha256=$authWalletPredecessorTransitionSha256`nauthority-registry-sha256=$AuthWalletTransitionAuthorityRegistrySha256`ncurrent-stack-id=$CurrentStackId`nparent-template-sha256=$templateSha256`nworkload-template-sha256=$workloadBoundariesTemplateSha256`nobservability-template-sha256=$observabilityTemplateSha256`nmode=$AuthWalletTransitionMode`noperation=$validatedAuthWalletTransitionOperation`nfield=$validatedAuthWalletTransitionFieldName"
        }
    }
    $workloadBoundariesArtifactKey = "application-workload-boundaries-$workloadBoundariesTemplateSha256.yaml"
    $artifactBindingText = "bucket=$WorkloadBoundariesArtifactBucket`nkey=$workloadBoundariesArtifactKey`nversion-id=$WorkloadBoundariesArtifactVersionId"
    $workloadBoundariesArtifactBindingSha256 = Get-TextSha256 -Value $artifactBindingText
    $artifactDnsSuffix = if ($Region -like 'cn-*') { 'amazonaws.com.cn' } else { 'amazonaws.com' }
    $encodedArtifactVersionId = [System.Uri]::EscapeDataString($WorkloadBoundariesArtifactVersionId)
    $workloadBoundariesTemplateUrl = "https://$WorkloadBoundariesArtifactBucket.s3.$Region.$artifactDnsSuffix/$workloadBoundariesArtifactKey`?versionId=$encodedArtifactVersionId"
    if ($workloadBoundariesTemplateUrl.Length -gt 1024) {
        throw "The constructed versioned workload-boundary TemplateURL exceeds CloudFormation's 1,024-character limit."
    }
    $observabilityArtifactKey = "application-observability-$observabilityTemplateSha256.yaml"
    $observabilityBindingText = "bucket=$ObservabilityArtifactBucket`nkey=$observabilityArtifactKey`nversion-id=$ObservabilityArtifactVersionId"
    $observabilityArtifactBindingSha256 = Get-TextSha256 -Value $observabilityBindingText
    $encodedObservabilityVersionId = [System.Uri]::EscapeDataString($ObservabilityArtifactVersionId)
    $observabilityTemplateUrl = "https://$ObservabilityArtifactBucket.s3.$Region.$artifactDnsSuffix/$observabilityArtifactKey`?versionId=$encodedObservabilityVersionId"
    if ($observabilityTemplateUrl.Length -gt 1024) {
        throw "The constructed versioned observability TemplateURL exceeds CloudFormation's 1,024-character limit."
    }
    if (-not (Test-Path -LiteralPath $accountGuardrailTemplatePath -PathType Leaf)) {
        throw "The reviewed KAN-229 account guardrail template was not found: $accountGuardrailTemplatePath"
    }
    $accountGuardrailTemplateSha256 = (Get-FileHash -LiteralPath $accountGuardrailTemplatePath -Algorithm SHA256).Hash.ToLowerInvariant()

    $resolvedBillingControlRecord = [System.IO.Path]::GetFullPath($BillingControlRecordFile)
    if (-not (Test-Path -LiteralPath $resolvedBillingControlRecord -PathType Leaf)) {
        throw "BillingControlRecordFile was not found: $resolvedBillingControlRecord"
    }
    $recordValidationOutput = & $nodeCommand.Source @(
        $billingRecordValidatorPath,
        '--record', $resolvedBillingControlRecord,
        '--mode', 'approved',
        '--expected-account', $AccountId,
        '--expected-application-region', $Region,
        '--expected-control-region', $GuardrailControlRegion,
        '--expected-environment', $EnvironmentName,
        '--json'
    )
    if ($LASTEXITCODE -ne 0) {
        throw 'The billing control record is not approved, current, identity-matched, and evidence-complete. No AWS calls were made.'
    }
    $recordValidation = ($recordValidationOutput | Out-String) | ConvertFrom-Json
    if (-not $recordValidation.ok -or $recordValidation.awsCallsMade -ne 0) {
        throw 'Billing control record validation did not produce a successful zero-AWS-call result.'
    }
    $controlRecordSha256 = [string] $recordValidation.canonicalSha256
    $controlConfigurationSha256 = [string] $recordValidation.controlConfigurationSha256
    if ($controlRecordSha256 -notmatch '^[a-f0-9]{64}$' -or $controlConfigurationSha256 -notmatch '^[a-f0-9]{64}$') {
        throw 'Billing control record validation did not return valid canonical and configuration SHA-256 bindings.'
    }
    $controlRecord = (Get-Content -LiteralPath $resolvedBillingControlRecord -Raw) | ConvertFrom-Json

    $resolvedAcmDnsControlRecord = [System.IO.Path]::GetFullPath($AcmDnsControlRecordFile)
    if (-not (Test-Path -LiteralPath $resolvedAcmDnsControlRecord -PathType Leaf)) {
        throw "AcmDnsControlRecordFile was not found: $resolvedAcmDnsControlRecord"
    }
    $acmDnsValidationOutput = & $nodeCommand.Source @(
        $acmDnsRecordValidatorPath,
        '--record', $resolvedAcmDnsControlRecord,
        '--mode', 'prerequisite',
        '--expected-account', $AccountId,
        '--expected-region', $Region,
        '--json'
    )
    if ($LASTEXITCODE -ne 0) {
        throw 'The KAN-230 ACM/DNS prerequisite is not approved, current, identity-matched, and certificate-issued. No AWS calls were made.'
    }
    $acmDnsValidation = ($acmDnsValidationOutput | Out-String) | ConvertFrom-Json
    if (
        -not $acmDnsValidation.ok -or
        $acmDnsValidation.externalCallsMade -ne 0 -or
        $acmDnsValidation.awsCallsMade -ne 0 -or
        $acmDnsValidation.dnsQueriesMade -ne 0 -or
        $acmDnsValidation.tlsConnectionsMade -ne 0 -or
        $acmDnsValidation.providerCallsMade -ne 0 -or
        $acmDnsValidation.resourcesCreated -ne 0
    ) {
        throw 'KAN-230 validation did not produce a successful zero-external-call result.'
    }
    $acmDnsRecordSha256 = [string] $acmDnsValidation.canonicalSha256
    $acmDnsConfigurationSha256 = [string] $acmDnsValidation.configurationSha256
    if ($acmDnsRecordSha256 -notmatch '^[a-f0-9]{64}$' -or $acmDnsConfigurationSha256 -notmatch '^[a-f0-9]{64}$') {
        throw 'KAN-230 validation did not return valid record and configuration SHA-256 bindings.'
    }
    $acmDnsBinding = $acmDnsValidation.binding
    if (
        $null -eq $acmDnsBinding -or
        [string] $acmDnsBinding.accountId -cne $AccountId -or
        [string] $acmDnsBinding.region -cne $Region
    ) {
        throw 'KAN-230 validation did not return the expected account and Region binding.'
    }
}

if (-not $AllowAwsApiCalls.IsPresent) {
    throw "Action '$Action' is cloud-side. Re-run with -AllowAwsApiCalls after reviewing the selected account, profile, region, and billing controls."
}

$awsCommand = Get-Command aws -ErrorAction SilentlyContinue
if ($null -eq $awsCommand) {
    throw 'AWS CLI v2 is required for explicitly opted-in cloud actions.'
}
$script:AwsExecutable = $awsCommand.Source

# Verify the named profile before any CloudFormation API call. --profile and
# --region are always supplied; ambient/default credentials are never selected.
$identityOutput = & $script:AwsExecutable @(
    'sts',
    'get-caller-identity',
    '--profile', $Profile,
    '--region', $Region,
    '--output', 'json',
    '--no-cli-pager'
)
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to verify the explicitly named AWS profile.'
}
$callerIdentity = ($identityOutput | Out-String) | ConvertFrom-Json
$actualAccountId = [string] $callerIdentity.Account
if ($actualAccountId -ne $AccountId) {
    throw "Named profile '$Profile' resolved to account '$actualAccountId', not the approved account '$AccountId'."
}
if ($Action -in @('Plan', 'Deploy')) {
    $approvedRoleArn = [string] $controlRecord.aws.approvedRoleArn
    $approvedRoleMatch = [regex]::Match($approvedRoleArn, '^arn:(?<partition>aws(?:-us-gov|-cn)?):iam::\d{12}:role/(?:.*/)?(?<roleName>[^/]+)$')
    if (-not $approvedRoleMatch.Success) {
        throw 'The validated billing control record contains an unusable approvedRoleArn.'
    }
    $expectedAssumedRolePrefix = "arn:$($approvedRoleMatch.Groups['partition'].Value):sts::$AccountId`:assumed-role/$($approvedRoleMatch.Groups['roleName'].Value)/"
    if (-not ([string] $callerIdentity.Arn).StartsWith($expectedAssumedRolePrefix, [System.StringComparison]::Ordinal)) {
        throw "Named profile '$Profile' did not assume the independently approved role '$approvedRoleArn'."
    }
}

$templateUri = 'file://' + ($resolvedTemplate -replace '\\', '/')
$workloadBoundariesTemplateUri = 'file://' + ($resolvedWorkloadBoundariesTemplate -replace '\\', '/')
$observabilityTemplateUri = 'file://' + ($resolvedObservabilityTemplate -replace '\\', '/')
if ($Action -eq 'CloudValidate') {
    Invoke-AwsCommand -Arguments @(
        'cloudformation',
        'validate-template',
        '--template-body', $templateUri,
        '--profile', $Profile,
        '--region', $Region,
        '--no-cli-pager'
    )
    Invoke-AwsCommand -Arguments @(
        'cloudformation',
        'validate-template',
        '--template-body', $workloadBoundariesTemplateUri,
        '--profile', $Profile,
        '--region', $Region,
        '--no-cli-pager'
    )
    Invoke-AwsCommand -Arguments @(
        'cloudformation',
        'validate-template',
        '--template-body', $observabilityTemplateUri,
        '--profile', $Profile,
        '--region', $Region,
        '--no-cli-pager'
    )
    Write-Host 'AWS validated the parent and both child template syntaxes. No stack or application resources were created.'
    return
}

# Application planning and execution are blocked until the independently
# approved KAN-229 account guardrail stack is healthy and matches the reviewed
# control record. This read occurs only after explicit cloud opt-in and STS
# identity verification.
$guardrailStackOutput = & $script:AwsExecutable @(
    'cloudformation',
    'describe-stacks',
    '--stack-name', $GuardrailStackName,
    '--profile', $Profile,
    '--region', $GuardrailControlRegion,
    '--output', 'json',
    '--no-cli-pager'
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to verify required KAN-229 guardrail stack '$GuardrailStackName'."
}
$guardrailStack = (($guardrailStackOutput | Out-String) | ConvertFrom-Json).Stacks | Select-Object -First 1
if ($null -eq $guardrailStack) {
    throw "Guardrail stack '$GuardrailStackName' was not returned."
}
if ($guardrailStack.StackStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE')) {
    throw "Guardrail stack '$GuardrailStackName' is not in an approved complete state (Status=$($guardrailStack.StackStatus))."
}
$expectedGuardrailStackTags = [ordered]@{
    application = 'crypto-lending'
    environment = $EnvironmentName
    'control-scope' = 'account-billing'
    owner = [string] $controlRecord.environment.owner
    'finance-owner' = [string] $controlRecord.environment.financeOwner
    'cost-center' = [string] $controlRecord.environment.costCenter
    'managed-by' = 'cloudformation'
    ticket = 'KAN-229'
    'approval-record' = [string] $controlRecord.recordId
    'control-configuration-sha256' = $controlConfigurationSha256
}
$actualGuardrailStackTags = ConvertFrom-ChangeSetTags -Tags $guardrailStack.Tags
if ($actualGuardrailStackTags.Count -ne $expectedGuardrailStackTags.Count) {
    throw "Guardrail stack '$GuardrailStackName' does not contain the exact approved KAN-229 tag set."
}
foreach ($expectedTag in $expectedGuardrailStackTags.GetEnumerator()) {
    if (-not $actualGuardrailStackTags.Contains($expectedTag.Key) -or $actualGuardrailStackTags[$expectedTag.Key] -cne $expectedTag.Value) {
        throw "Guardrail stack tag '$($expectedTag.Key)' does not match the final approved billing control record."
    }
}

$guardrailTemplateOutput = & $script:AwsExecutable @(
    'cloudformation',
    'get-template',
    '--stack-name', $GuardrailStackName,
    '--template-stage', 'Original',
    '--profile', $Profile,
    '--region', $GuardrailControlRegion,
    '--output', 'json',
    '--no-cli-pager'
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to retrieve the original template for guardrail stack '$GuardrailStackName'."
}
$guardrailTemplate = ($guardrailTemplateOutput | Out-String) | ConvertFrom-Json
if ($null -eq $guardrailTemplate -or $guardrailTemplate.TemplateBody -isnot [string]) {
    throw "CloudFormation did not return a string Original template body for guardrail stack '$GuardrailStackName'."
}
$deployedGuardrailTemplateSha256 = Get-TextSha256 -Value ([string] $guardrailTemplate.TemplateBody)
if ($deployedGuardrailTemplateSha256 -cne $accountGuardrailTemplateSha256) {
    throw "Guardrail stack '$GuardrailStackName' was not deployed from the reviewed local KAN-229 template."
}
$guardrailParameters = Get-StackParameterMap -Stack $guardrailStack
$expectedGuardrailParameters = [ordered]@{
    ApprovedAccountId = $AccountId
    ApplicationRegion = $Region
    ControlRegion = $GuardrailControlRegion
    EnvironmentName = $EnvironmentName
    EnvironmentOwner = [string] $controlRecord.environment.owner
    FinanceOwner = [string] $controlRecord.environment.financeOwner
    CostCenter = [string] $controlRecord.environment.costCenter
    MonthlyBudgetUsd = [string] $controlRecord.budget.monthlyLimitUsd
    WarningPercent = [string] $controlRecord.budget.warningPercent
    CriticalPercent = [string] $controlRecord.budget.criticalPercent
    AnomalyMode = [string] $controlRecord.budget.anomalyMode
    ExistingAnomalyMonitorArn = $(if ($controlRecord.budget.existingAnomalyMonitorArn -eq 'NOT_APPLICABLE') { '' } else { [string] $controlRecord.budget.existingAnomalyMonitorArn })
    AnomalyAbsoluteUsd = [string] $controlRecord.budget.anomalyAbsoluteUsd
    AnomalyPercentage = [string] $controlRecord.budget.anomalyPercentage
    ApprovalRecordId = [string] $controlRecord.recordId
    ControlsAcknowledgement = 'I_ACKNOWLEDGE_ACCOUNT_LEVEL_COST_CONTROLS'
}
if ($guardrailParameters.Count -ne 18) {
    throw "Guardrail stack '$GuardrailStackName' does not contain the exact 18-parameter KAN-229 configuration."
}
foreach ($expectedParameter in $expectedGuardrailParameters.GetEnumerator()) {
    if (-not $guardrailParameters.Contains($expectedParameter.Key) -or $guardrailParameters[$expectedParameter.Key] -cne $expectedParameter.Value) {
        throw "Guardrail stack parameter '$($expectedParameter.Key)' does not match the final approved billing control record."
    }
}
foreach ($recipientMapping in @(
        @{ Parameter = 'WarningEmail'; RecordValue = [string] $controlRecord.budget.warningRecipient },
        @{ Parameter = 'CriticalEmail'; RecordValue = [string] $controlRecord.budget.criticalRecipient }
    )) {
    if (-not $guardrailParameters.Contains($recipientMapping.Parameter)) {
        throw "Guardrail stack is missing protected recipient parameter '$($recipientMapping.Parameter)'."
    }
    $recipientAddress = [string] $guardrailParameters[$recipientMapping.Parameter]
    $separator = $recipientAddress.LastIndexOf('@')
    if ($separator -le 0 -or $recipientAddress.Substring(0, $separator) -cne $recipientMapping.RecordValue) {
        throw "Guardrail stack recipient '$($recipientMapping.Parameter)' does not match the approved distribution-alias reference."
    }
}
$guardrailOutputs = Get-StackOutputMap -Stack $guardrailStack
$requiredGuardrailOutputs = [ordered]@{
    PolicyVersion = $expectedGuardrailPolicyVersion
    ApprovedAccountId = $AccountId
    ApplicationRegion = $Region
    ControlRegion = $GuardrailControlRegion
    EnvironmentName = $EnvironmentName
    EnvironmentOwner = [string] $controlRecord.environment.owner
    FinanceOwner = [string] $controlRecord.environment.financeOwner
    CostCenter = [string] $controlRecord.environment.costCenter
    ApprovalRecordId = [string] $controlRecord.recordId
    MonthlyBudgetUsd = [string] $controlRecord.budget.monthlyLimitUsd
    WarningPercent = [string] $controlRecord.budget.warningPercent
    CriticalPercent = [string] $controlRecord.budget.criticalPercent
}
foreach ($expectedOutput in $requiredGuardrailOutputs.GetEnumerator()) {
    if (-not $guardrailOutputs.Contains($expectedOutput.Key)) {
        throw "Guardrail stack '$GuardrailStackName' is missing required output '$($expectedOutput.Key)'."
    }
    if ($guardrailOutputs[$expectedOutput.Key] -cne $expectedOutput.Value) {
        throw "Guardrail output '$($expectedOutput.Key)' does not match the approved billing control record."
    }
}
if (-not $guardrailOutputs.Contains('MonthlyBudgetName') -or [string]::IsNullOrWhiteSpace($guardrailOutputs.MonthlyBudgetName)) {
    throw "Guardrail stack '$GuardrailStackName' did not expose its active monthly budget identity."
}
if (-not $guardrailOutputs.Contains('AnomalyMode')) {
    throw "Guardrail stack '$GuardrailStackName' is missing its anomaly-control decision."
}
if ($guardrailOutputs.AnomalyMode -cne [string] $controlRecord.budget.anomalyMode) {
    throw 'The deployed anomaly mode does not match the final approved billing control record.'
}
if (
    $controlRecord.budget.anomalyMode -eq 'Existing' -and
    $guardrailOutputs.CostAnomalyMonitorArn -cne [string] $controlRecord.budget.existingAnomalyMonitorArn
) {
    throw 'The deployed existing anomaly monitor does not match the final approved billing control record.'
}

Assert-RequiredValue -Name 'StackName' -Value $StackName
Assert-RequiredValue -Name 'ChangeSetName' -Value $ChangeSetName

if ($StackName -notmatch '^[A-Za-z][A-Za-z0-9-]{0,127}$') {
    throw 'StackName must be a valid explicit CloudFormation stack name.'
}
if ($ChangeSetName -notmatch '^[A-Za-z][A-Za-z0-9-]{0,127}$') {
    throw 'ChangeSetName must be an explicit CloudFormation-safe name.'
}

$partition = $requestedPartition

if ($Action -in @('Plan', 'Deploy')) {
    Assert-RequiredValue -Name 'ChangeSetType' -Value $ChangeSetType
    Assert-RequiredValue -Name 'EnvironmentName' -Value $EnvironmentName
    if ($EnvironmentName.Length -gt 31 -or $EnvironmentName -notmatch '^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$') {
        throw 'EnvironmentName must be at most 31 characters and use the template non-production pattern: dev|test|qa|sandbox|staging with optional lowercase suffix segments.'
    }

    $parameterMap = [ordered]@{
        EnvironmentName = $EnvironmentName
        WorkloadBoundariesTemplateUrl = $workloadBoundariesTemplateUrl
        WorkloadBoundariesTemplateSha256 = $workloadBoundariesTemplateSha256
        WorkloadBoundariesArtifactBindingSha256 = $workloadBoundariesArtifactBindingSha256
        ObservabilityTemplateUrl = $observabilityTemplateUrl
        ObservabilityTemplateSha256 = $observabilityTemplateSha256
        ObservabilityArtifactBindingSha256 = $observabilityArtifactBindingSha256
        AuthWalletKeysSecretVersionId = $AuthWalletKeysSecretVersionId
        RedisOperatorSecretVersionId = $RedisOperatorSecretVersionId
        ApiDatabaseSlotAVersionId = $ApiDatabaseSlotAVersionId
        ApiDatabaseSlotBVersionId = $ApiDatabaseSlotBVersionId
        WorkerDatabaseSlotAVersionId = $WorkerDatabaseSlotAVersionId
        WorkerDatabaseSlotBVersionId = $WorkerDatabaseSlotBVersionId
        RedisApiSlotAVersionId = $RedisApiSlotAVersionId
        RedisApiSlotBVersionId = $RedisApiSlotBVersionId
    }
    $sensitiveParameterName = '(?i)(password|credential|accesskey|secret(?:value|string)?|token)'
    $reviewedNonSecretControlParameters = @(
        'ApiDatabaseCredentialPhase',
        'WorkerDatabaseCredentialPhase',
        'RedisCredentialPhase'
    )
    $reviewedSecretReferenceParameters = @('AuthWalletKeysSecretArn')
    foreach ($override in $explicitParameterOverrides.GetEnumerator()) {
        $key = [string] $override.Key
        $value = [string] $override.Value
        if ($key -in @(
                'EnvironmentName',
                'WorkloadBoundariesTemplateUrl',
                'WorkloadBoundariesTemplateSha256',
                'WorkloadBoundariesArtifactBindingSha256',
                'ObservabilityTemplateUrl',
                'ObservabilityTemplateSha256',
                'ObservabilityArtifactBindingSha256',
                'AuthWalletKeysSecretVersionId',
                'RedisOperatorSecretVersionId',
                'ApiDatabaseSlotAVersionId',
                'ApiDatabaseSlotBVersionId',
                'WorkerDatabaseSlotAVersionId',
                'WorkerDatabaseSlotBVersionId',
                'RedisApiSlotAVersionId',
                'RedisApiSlotBVersionId'
            )) {
            throw "$key is derived by a named, locally verified input and must not be repeated in ParameterOverride."
        }
        if (
            $key -match $sensitiveParameterName -and
            $reviewedNonSecretControlParameters -cnotcontains $key -and
            $reviewedSecretReferenceParameters -cnotcontains $key
        ) {
            throw "Secret-bearing override '$key' is prohibited. Generate and resolve secrets through Secrets Manager."
        }
        $parameterMap[$key] = $value
    }

    $requiredParameters = @(
        'BillingAcknowledgement',
        'ApplicationVersion',
        'ApiImageUri',
        'WebImageUri',
        'S3ManagedPrefixListId',
        'AllowedIngressIpv4Cidr',
        'AlbCertificateArn',
        'ApplicationHostname',
        'CognitoPoolId',
        'CognitoLoginHostname',
        'CognitoClientId',
        'AuthWalletKeysSecretArn',
        'AuthWalletKeysKmsKeyArn',
        'PostgresEngineVersion'
    )
    foreach ($requiredParameter in $requiredParameters) {
        if (-not $parameterMap.Contains($requiredParameter)) {
            throw "ParameterOverride must explicitly provide '$requiredParameter'."
        }
    }
    if ($parameterMap.BillingAcknowledgement -cne 'I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES') {
        throw 'BillingAcknowledgement must use the template-defined billable-resource acknowledgement.'
    }

    $parameterDefaults = [ordered]@{
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
        AlarmTopicArn = 'NONE'
        EnableOperationalDashboard = 'false'
        EnableContainerInsights = 'disabled'
    }
    $deliveryParameterNames = @(
        'WorkloadBoundariesTemplateUrl',
        'WorkloadBoundariesTemplateSha256',
        'WorkloadBoundariesArtifactBindingSha256',
        'ObservabilityTemplateUrl',
        'ObservabilityTemplateSha256',
        'ObservabilityArtifactBindingSha256'
    )
    $credentialVersionParameterNames = @($credentialVersionValues.Keys)
    $immutableAuthWalletParameterNames = @('AuthWalletKeysSecretVersionId')
    $allowedParameterNames = @('EnvironmentName') + $deliveryParameterNames + $immutableAuthWalletParameterNames + $credentialVersionParameterNames + $requiredParameters + @($parameterDefaults.Keys)
    foreach ($parameterName in $parameterMap.Keys) {
        if ($allowedParameterNames -cnotcontains $parameterName) {
            throw "ParameterOverride contains unknown template parameter '$parameterName'."
        }
    }
    if ($ChangeSetType -eq 'UPDATE') {
        $stackOutput = & $script:AwsExecutable @(
            'cloudformation',
            'describe-stacks',
            '--stack-name', $CurrentStackId,
            '--profile', $Profile,
            '--region', $Region,
            '--output', 'json',
            '--no-cli-pager'
        )
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to read current parameters for immutable stack '$CurrentStackId'."
        }
        $currentStack = (($stackOutput | Out-String) | ConvertFrom-Json).Stacks | Select-Object -First 1
        if ($null -eq $currentStack) {
            throw "Immutable stack '$CurrentStackId' was not returned for UPDATE planning."
        }
        if (
            [string] (Get-OptionalPropertyValue -InputObject $currentStack -Name 'StackName') -cne $StackName -or
            [string] (Get-OptionalPropertyValue -InputObject $currentStack -Name 'StackId') -cne $CurrentStackId
        ) {
            throw 'The existing application stack does not match the explicitly approved name and immutable stack ID.'
        }
        $currentStackStatus = [string] (Get-OptionalPropertyValue -InputObject $currentStack -Name 'StackStatus')
        if ($currentStackStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE')) {
            throw "The existing application stack is not in a stable complete state (Status=$currentStackStatus)."
        }
        $currentStackParameterMap = Get-StackParameterMap -Stack $currentStack
        if (-not $currentStackParameterMap.Contains('EnvironmentName')) {
            throw "Stack '$StackName' does not expose an explicit EnvironmentName parameter."
        }
        $currentEnvironment = [string] $currentStackParameterMap.EnvironmentName
        if ($currentEnvironment -cne $EnvironmentName) {
            throw "EnvironmentName '$EnvironmentName' does not match the existing stack value '$currentEnvironment'. Create a separate stack for a different environment."
        }
        $expectedCurrentAuthWalletBindings = [ordered]@{
            AuthWalletKeysSecretArn = [string] $parameterMap.AuthWalletKeysSecretArn
            AuthWalletKeysSecretVersionId = if ($isAuthWalletTransition) { $authWalletCurrentVersionId } else { [string] $parameterMap.AuthWalletKeysSecretVersionId }
            AuthWalletKeysKmsKeyArn = [string] $parameterMap.AuthWalletKeysKmsKeyArn
        }
        foreach ($authWalletBinding in $expectedCurrentAuthWalletBindings.GetEnumerator()) {
            if (-not $currentStackParameterMap.Contains($authWalletBinding.Key)) {
                if ($isAuthWalletTransition) {
                    throw "The existing application stack is missing current auth/wallet binding '$($authWalletBinding.Key)'."
                }
                throw "The existing application stack is missing immutable auth/wallet binding '$($authWalletBinding.Key)'. A dedicated reviewed auth/wallet transition is required."
            }
            if ([string] $currentStackParameterMap[$authWalletBinding.Key] -cne [string] $authWalletBinding.Value) {
                if ($isAuthWalletTransition) {
                    throw "Existing auth/wallet binding '$($authWalletBinding.Key)' differs from the exact approved current state."
                }
                throw "Existing auth/wallet binding '$($authWalletBinding.Key)' differs from the approved target. A dedicated reviewed auth/wallet transition is required."
            }
        }
        $expectedCurrentFixedSlotBindings = if ($isCredentialTransition) {
            $fixedSlotCurrentBindings
        }
        else {
            $fixedSlotTargetBindings
        }
        foreach ($currentBinding in $expectedCurrentFixedSlotBindings.GetEnumerator()) {
            if (-not $currentStackParameterMap.Contains($currentBinding.Key)) {
                throw "The existing application stack is missing current credential-state binding '$($currentBinding.Key)'."
            }
            if ([string] $currentStackParameterMap[$currentBinding.Key] -cne [string] $currentBinding.Value) {
                throw "Existing credential-state binding '$($currentBinding.Key)' drifted from the approved update current state."
            }
        }
        $currentStackTags = ConvertFrom-ChangeSetTags -Tags (Get-OptionalPropertyValue -InputObject $currentStack -Name 'Tags')
        if ($isCredentialTransition) {
            if ($FixedSlotCredentialTransitionMode -ceq 'adopt') {
                foreach ($desiredCount in @('ApiDesiredCount', 'WebDesiredCount', 'WorkerDesiredCount')) {
                    if (-not $currentStackParameterMap.Contains($desiredCount) -or [string] $currentStackParameterMap[$desiredCount] -cne '0') {
                        throw "Fixed-slot adoption requires the existing stack's $desiredCount to remain 0."
                    }
                }
                if ($currentStackTags.Contains('credential-transition-sha256') -or $currentStackTags.Contains('credential-state-sha256')) {
                    throw 'Fixed-slot adoption requires an explicitly untracked existing stack without prior credential-chain tags.'
                }
            }
            else {
                if (
                    -not $currentStackTags.Contains('credential-transition-sha256') -or
                    [string] $currentStackTags['credential-transition-sha256'] -cne [string] $fixedSlotTransitionRecord.predecessor.transitionSha256
                ) {
                    throw 'The existing stack credential-transition chain head does not match the approved record predecessor.'
                }
                if (
                    -not $currentStackTags.Contains('credential-state-sha256') -or
                    [string] $currentStackTags['credential-state-sha256'] -cne $fixedSlotCurrentStateSha256
                ) {
                    throw 'The existing stack credential-state hash does not match the approved transition current state.'
                }
            }
        }
        else {
            $credentialTagNames = @(
                'credential-predecessor-sha256',
                'credential-transition-sha256',
                'credential-state-sha256'
            )
            foreach ($credentialTagName in $credentialTagNames) {
                if (
                    -not $currentStackTags.Contains($credentialTagName) -or
                    [string] $currentStackTags[$credentialTagName] -cnotmatch '^(?:NONE|[a-f0-9]{64})$'
                ) {
                    throw "$UpdateIntent update requires a valid existing credential-chain tag '$credentialTagName'."
                }
            }
            if ([string] $currentStackTags['credential-transition-sha256'] -ceq 'NONE' -or [string] $currentStackTags['credential-state-sha256'] -ceq 'NONE') {
                throw "$UpdateIntent update requires a completed fixed-slot adoption chain head."
            }
            $preservedCredentialTags = [ordered]@{}
            foreach ($credentialTagName in $credentialTagNames) {
                $preservedCredentialTags[$credentialTagName] = [string] $currentStackTags[$credentialTagName]
            }
        }

        $authWalletTagNames = @(
            'auth-wallet-predecessor-sha256',
            'auth-wallet-transition-sha256',
            'auth-wallet-state-sha256'
        )
        if ($isAuthWalletTransition) {
            if ($AuthWalletTransitionMode -ceq 'adopt') {
                foreach ($authWalletTagName in $authWalletTagNames) {
                    if ($currentStackTags.Contains($authWalletTagName)) {
                        throw 'Auth/wallet adoption requires an explicitly untracked existing stack without auth/wallet chain tags.'
                    }
                }
            }
            else {
                foreach ($authWalletTagName in $authWalletTagNames) {
                    if (
                        -not $currentStackTags.Contains($authWalletTagName) -or
                        [string] $currentStackTags[$authWalletTagName] -cnotmatch '^(?:NONE|[a-f0-9]{64})$'
                    ) {
                        throw "Auth/wallet transition requires a valid existing chain tag '$authWalletTagName'."
                    }
                }
                if (
                    [string] $currentStackTags['auth-wallet-transition-sha256'] -cne $authWalletPredecessorTransitionSha256 -or
                    [string] $currentStackTags['auth-wallet-state-sha256'] -cne $authWalletCurrentStateSha256
                ) {
                    throw 'The existing auth/wallet chain head does not match the signed transition predecessor and current state.'
                }
                if ([string] $currentStackTags['auth-wallet-transition-sha256'] -ceq 'NONE' -or [string] $currentStackTags['auth-wallet-state-sha256'] -ceq 'NONE') {
                    throw 'Auth/wallet transition requires a completed prior auth/wallet chain head.'
                }
            }
        }
        else {
            $preservedAuthWalletTags = [ordered]@{}
            if ($isCredentialTransition -and $FixedSlotCredentialTransitionMode -ceq 'adopt') {
                foreach ($authWalletTagName in $authWalletTagNames) {
                    if ($currentStackTags.Contains($authWalletTagName)) {
                        throw 'Initial fixed-slot adoption requires the auth/wallet chain to remain explicitly untracked.'
                    }
                }
            }
            else {
                foreach ($authWalletTagName in $authWalletTagNames) {
                    if (
                        -not $currentStackTags.Contains($authWalletTagName) -or
                        [string] $currentStackTags[$authWalletTagName] -cnotmatch '^(?:NONE|[a-f0-9]{64})$'
                    ) {
                        throw "$UpdateIntent update requires a valid existing auth/wallet-chain tag '$authWalletTagName'."
                    }
                    $preservedAuthWalletTags[$authWalletTagName] = [string] $currentStackTags[$authWalletTagName]
                }
                if (
                    [string] $preservedAuthWalletTags['auth-wallet-transition-sha256'] -ceq 'NONE' -or
                    [string] $preservedAuthWalletTags['auth-wallet-state-sha256'] -ceq 'NONE'
                ) {
                    throw "$UpdateIntent update requires a completed auth/wallet adoption chain head."
                }
            }
        }
        $currentApplicationTemplateOutput = & $script:AwsExecutable @(
            'cloudformation',
            'get-template',
            '--stack-name', $CurrentStackId,
            '--template-stage', 'Original',
            '--profile', $Profile,
            '--region', $Region,
            '--output', 'json',
            '--no-cli-pager'
        )
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to retrieve the current Original template for stack '$StackName'."
        }
        $currentApplicationTemplate = ($currentApplicationTemplateOutput | Out-String) | ConvertFrom-Json
        if ($null -eq $currentApplicationTemplate -or $currentApplicationTemplate.TemplateBody -isnot [string]) {
            throw "CloudFormation did not return the current application stack's Original template body."
        }
        $currentApplicationTemplateSha256 = Get-TextSha256 -Value ([string] $currentApplicationTemplate.TemplateBody)
        if (($isCredentialTransition -or $isAuthWalletTransition) -and $currentApplicationTemplateSha256 -cne $templateSha256) {
            throw 'Credential transitions cannot include a parent-template change; the current deployed and reviewed local parent hashes differ.'
        }
        $currentStackParameterSnapshotSha256 = Get-TextSha256 -Value (ConvertTo-CanonicalTagText -Tags $currentStackParameterMap)
        $currentStackTagSnapshotSha256 = Get-TextSha256 -Value (ConvertTo-CanonicalTagText -Tags $currentStackTags)
        $currentStackBindingText = "current-stack-id=$CurrentStackId`ncurrent-parent-template-sha256=$currentApplicationTemplateSha256`ncurrent-stack-parameters-sha256=$currentStackParameterSnapshotSha256`ncurrent-stack-tags-sha256=$currentStackTagSnapshotSha256`nupdate-intent=$UpdateIntent"
        $currentStackBindingSha256 = Get-TextSha256 -Value $currentStackBindingText
        if ($isCredentialTransition) {
            $fixedSlotTransitionDeploymentBindingText += "`ncurrent-stack-binding-sha256=$currentStackBindingSha256"
            $fixedSlotTransitionDeploymentBindingSha256 = Get-TextSha256 -Value $fixedSlotTransitionDeploymentBindingText
        }
        elseif ($isAuthWalletTransition) {
            $authWalletTransitionDeploymentBindingText += "`ncurrent-stack-binding-sha256=$currentStackBindingSha256"
            $authWalletTransitionDeploymentBindingSha256 = Get-TextSha256 -Value $authWalletTransitionDeploymentBindingText
        }
        foreach ($parameter in $currentStackParameterMap.GetEnumerator()) {
            if ($parameterDefaults.Contains($parameter.Key) -and -not $parameterMap.Contains($parameter.Key)) {
                $parameterMap[$parameter.Key] = [string] $parameter.Value
            }
        }
    }

    foreach ($entry in $parameterDefaults.GetEnumerator()) {
        if (-not $parameterMap.Contains($entry.Key)) {
            $parameterMap[$entry.Key] = $entry.Value
        }
    }
    $allowedCredentialPhases = @('A_ONLY', 'BOTH_USE_A', 'BOTH_USE_B', 'B_ONLY')
    foreach ($phaseParameter in $reviewedNonSecretControlParameters) {
        if ($allowedCredentialPhases -cnotcontains [string] $parameterMap[$phaseParameter]) {
            throw "$phaseParameter must use exactly A_ONLY, BOTH_USE_A, BOTH_USE_B, or B_ONLY."
        }
    }
    if (@('DISABLED', 'ENABLED') -cnotcontains [string] $parameterMap.RedisOperatorMode) {
        throw 'RedisOperatorMode must use exactly DISABLED or ENABLED.'
    }
    if ($ChangeSetType -eq 'UPDATE') {
        foreach ($targetBinding in $fixedSlotTargetBindings.GetEnumerator()) {
            if (-not $parameterMap.Contains($targetBinding.Key) -or [string] $parameterMap[$targetBinding.Key] -cne [string] $targetBinding.Value) {
            throw "Planned credential-state binding '$($targetBinding.Key)' does not match the approved update target state."
            }
        }
    }
    foreach ($booleanParameter in @('EnableOperationalAlarms', 'EnableOperationalDashboard')) {
        if (@('true', 'false') -cnotcontains [string] $parameterMap[$booleanParameter]) {
            throw "$booleanParameter must use exactly true or false."
        }
    }

    $expectedOperationalAlarmTopicPattern = '^arn:' + [regex]::Escape($partition) + ':sns:' + [regex]::Escape($Region) + ':' + [regex]::Escape($AccountId) + ':[A-Za-z0-9_-]{1,256}$'
    $operationalAlarmTopicArn = [string] $parameterMap.AlarmTopicArn
    if (
        $parameterMap.EnableOperationalAlarms -ceq 'true' -and
        $operationalAlarmTopicArn -cnotmatch $expectedOperationalAlarmTopicPattern
    ) {
        throw 'AlarmTopicArn must be explicitly supplied as one existing SNS topic ARN in the approved partition, account, and Region when operational alarms are enabled.'
    }
    if (
        $parameterMap.EnableOperationalAlarms -ceq 'false' -and
        $operationalAlarmTopicArn -cne 'NONE' -and
        $operationalAlarmTopicArn -cnotmatch $expectedOperationalAlarmTopicPattern
    ) {
        throw 'AlarmTopicArn must be NONE or one existing SNS topic ARN in the approved partition, account, and Region.'
    }

    $cidrParts = $parameterMap.AllowedIngressIpv4Cidr.Split('/')
    $parsedAddress = $null
    $prefixLength = 0
    if (
        $cidrParts.Length -ne 2 -or
        -not [System.Net.IPAddress]::TryParse($cidrParts[0], [ref] $parsedAddress) -or
        $parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
        -not [int]::TryParse($cidrParts[1], [ref] $prefixLength) -or
        $prefixLength -lt 1 -or
        $prefixLength -gt 32
    ) {
        throw 'AllowedIngressIpv4Cidr must be a valid IPv4 CIDR with prefix length 1-32; public /0 ingress is prohibited.'
    }

    if ($ChangeSetType -eq 'CREATE') {
        foreach ($desiredCount in @('ApiDesiredCount', 'WebDesiredCount', 'WorkerDesiredCount')) {
            if ($parameterMap[$desiredCount] -ne '0') {
                throw "$desiredCount must be 0 for a CREATE change set. Start services only in a reviewed UPDATE after endpoints and migrations are ready."
            }
        }
    }

    $ecrDnsSuffix = if ($partition -eq 'aws-cn') { 'amazonaws.com.cn' } else { 'amazonaws.com' }
    $expectedEcrPrefix = "$AccountId.dkr.ecr.$Region.$ecrDnsSuffix/"
    foreach ($imageParameter in @('ApiImageUri', 'WebImageUri')) {
        if (-not $parameterMap[$imageParameter].StartsWith($expectedEcrPrefix, [System.StringComparison]::Ordinal)) {
            throw "$imageParameter must reference private ECR in the approved account and region: $expectedEcrPrefix"
        }
    }

    $expectedCertificatePrefix = "arn:${partition}:acm:${Region}:${AccountId}:certificate/"
    if (-not $parameterMap.AlbCertificateArn.StartsWith($expectedCertificatePrefix, [System.StringComparison]::Ordinal)) {
        throw "AlbCertificateArn must reference ACM in the approved account and region: $expectedCertificatePrefix"
    }
    if ($parameterMap.AlbCertificateArn -cne [string] $acmDnsBinding.certificateArn) {
        throw 'AlbCertificateArn does not match the validated KAN-230 certificate.'
    }
    if ($parameterMap.ApplicationHostname -cne [string] $acmDnsBinding.applicationHostname) {
        throw 'ApplicationHostname does not match the validated KAN-230 hostname.'
    }
    $cognitoPoolPattern = '^' + [regex]::Escape($Region) + '_[A-Za-z0-9]+$'
    if ($parameterMap.CognitoPoolId.Length -gt 128 -or $parameterMap.CognitoPoolId -notmatch $cognitoPoolPattern) {
        throw 'CognitoPoolId must be a bounded user-pool ID in the approved Region.'
    }
    if (
        $parameterMap.CognitoLoginHostname.Length -gt 253 -or
        $parameterMap.CognitoLoginHostname -cne $parameterMap.CognitoLoginHostname.ToLowerInvariant() -or
        $parameterMap.CognitoLoginHostname -notmatch '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$'
    ) {
        throw 'CognitoLoginHostname must be one canonical lowercase DNS hostname without a scheme, port, path, query, or fragment.'
    }
    if ($parameterMap.CognitoClientId.Length -gt 128 -or $parameterMap.CognitoClientId -notmatch '^[A-Za-z0-9]+$') {
        throw 'CognitoClientId must be a bounded alphanumeric public app-client ID.'
    }
    $expectedAuthSecretPattern = '^arn:' + [regex]::Escape($partition) + ':secretsmanager:' + [regex]::Escape($Region) + ':' + [regex]::Escape($AccountId) + ':secret:[A-Za-z0-9/_+=.@-]+$'
    if ($parameterMap.AuthWalletKeysSecretArn -notmatch $expectedAuthSecretPattern) {
        throw 'AuthWalletKeysSecretArn must be one selector-free Secrets Manager ARN in the approved account and Region.'
    }
    $expectedAuthKmsPattern = '^arn:' + [regex]::Escape($partition) + ':kms:' + [regex]::Escape($Region) + ':' + [regex]::Escape($AccountId) + ':key/[a-f0-9-]+$'
    if ($parameterMap.AuthWalletKeysKmsKeyArn -notmatch $expectedAuthKmsPattern) {
        throw 'AuthWalletKeysKmsKeyArn must be one customer-managed KMS key ARN in the approved account and Region.'
    }
    if ($isCredentialTransition) {
        if ($currentStackParameterMap.Count -ne $parameterMap.Count) {
            throw "Credential-only UPDATE requires the current and target parameter sets to match exactly (Current=$($currentStackParameterMap.Count), Target=$($parameterMap.Count))."
        }
        $credentialStateBindingNames = @($fixedSlotTargetBindings.Keys)
        foreach ($targetParameter in $parameterMap.GetEnumerator()) {
            if (-not $currentStackParameterMap.Contains($targetParameter.Key)) {
                throw "Credential-only UPDATE found target parameter '$($targetParameter.Key)' missing from the current stack."
            }
            if (
                $credentialStateBindingNames -cnotcontains [string] $targetParameter.Key -and
                [string] $currentStackParameterMap[$targetParameter.Key] -cne [string] $targetParameter.Value
            ) {
                throw "Credential-only UPDATE cannot change unrelated parameter '$($targetParameter.Key)'."
            }
        }
    }
    elseif ($isAuthWalletTransition) {
        if ($currentStackParameterMap.Count -ne $parameterMap.Count) {
            throw "Auth/wallet-only UPDATE requires the current and target parameter sets to match exactly (Current=$($currentStackParameterMap.Count), Target=$($parameterMap.Count))."
        }
        foreach ($targetParameter in $parameterMap.GetEnumerator()) {
            if (-not $currentStackParameterMap.Contains($targetParameter.Key)) {
                throw "Auth/wallet-only UPDATE found target parameter '$($targetParameter.Key)' missing from the current stack."
            }
            if (
                [string] $targetParameter.Key -cne 'AuthWalletKeysSecretVersionId' -and
                [string] $currentStackParameterMap[$targetParameter.Key] -cne [string] $targetParameter.Value
            ) {
                throw "Auth/wallet-only UPDATE cannot change unrelated parameter '$($targetParameter.Key)'."
            }
        }
    }

    $stackTags = [ordered]@{
        application = 'crypto-lending'
        environment = $EnvironmentName
        owner = [string] $controlRecord.environment.owner
        'finance-owner' = [string] $controlRecord.environment.financeOwner
        'cost-center' = [string] $controlRecord.environment.costCenter
        'control-record-sha256' = $controlRecordSha256
        'billing-control-record' = [string] $controlRecord.recordId
        'acm-dns-control-record' = [string] $acmDnsBinding.recordId
        'acm-dns-configuration-sha256' = $acmDnsConfigurationSha256
        'workload-boundaries-sha256' = $workloadBoundariesTemplateSha256
        'workload-boundaries-binding-sha256' = $workloadBoundariesArtifactBindingSha256
        'observability-sha256' = $observabilityTemplateSha256
        'observability-binding-sha256' = $observabilityArtifactBindingSha256
        'managed-by' = 'cloudformation'
        ticket = 'KAN-34'
    }
    if ($isCredentialTransition) {
        $currentCredentialTagCount = if ($FixedSlotCredentialTransitionMode -ceq 'adopt') { 0 } else { 3 }
        $currentAuthWalletTagCount = if ($FixedSlotCredentialTransitionMode -ceq 'adopt') { 0 } else { 3 }
        if ($currentStackTags.Count -ne ($stackTags.Count + $currentCredentialTagCount + $currentAuthWalletTagCount)) {
            throw 'Credential-only UPDATE requires the existing stack to have the exact reviewed base, credential-chain, and auth/wallet-chain tag set.'
        }
        foreach ($baseTag in $stackTags.GetEnumerator()) {
            if (
                -not $currentStackTags.Contains($baseTag.Key) -or
                [string] $currentStackTags[$baseTag.Key] -cne [string] $baseTag.Value
            ) {
                throw "Credential-only UPDATE cannot change or repair unrelated stack tag '$($baseTag.Key)'."
            }
        }
        if (
            $FixedSlotCredentialTransitionMode -ceq 'transition' -and
            (
                -not $currentStackTags.Contains('credential-predecessor-sha256') -or
                [string] $currentStackTags['credential-predecessor-sha256'] -cnotmatch '^(?:NONE|[a-f0-9]{64})$'
            )
        ) {
            throw 'The existing stack credential predecessor tag is missing or malformed.'
        }
        $stackTags['credential-predecessor-sha256'] = [string] $fixedSlotTransitionRecord.predecessor.transitionSha256
        $stackTags['credential-transition-sha256'] = $fixedSlotTransitionRecordSha256
        $stackTags['credential-state-sha256'] = $fixedSlotTargetStateSha256
        foreach ($authWalletTag in $preservedAuthWalletTags.GetEnumerator()) {
            $stackTags[$authWalletTag.Key] = [string] $authWalletTag.Value
        }
    }
    elseif ($isAuthWalletTransition) {
        $currentAuthWalletTagCount = if ($AuthWalletTransitionMode -ceq 'adopt') { 0 } else { 3 }
        if ($currentStackTags.Count -ne ($stackTags.Count + 3 + $currentAuthWalletTagCount)) {
            throw 'Auth/wallet-only UPDATE requires the existing stack to have the exact reviewed base, fixed-slot-chain, and auth/wallet-chain tag set.'
        }
        foreach ($baseTag in $stackTags.GetEnumerator()) {
            if (
                -not $currentStackTags.Contains($baseTag.Key) -or
                [string] $currentStackTags[$baseTag.Key] -cne [string] $baseTag.Value
            ) {
                throw "Auth/wallet-only UPDATE cannot change or repair unrelated stack tag '$($baseTag.Key)'."
            }
        }
        foreach ($credentialTag in $preservedCredentialTags.GetEnumerator()) {
            $stackTags[$credentialTag.Key] = [string] $credentialTag.Value
        }
        $stackTags['auth-wallet-predecessor-sha256'] = $authWalletPredecessorTransitionSha256
        $stackTags['auth-wallet-transition-sha256'] = $authWalletTransitionRecordSha256
        $stackTags['auth-wallet-state-sha256'] = $authWalletTargetStateSha256
    }
    elseif ($isApplicationUpdate) {
        foreach ($credentialTag in $preservedCredentialTags.GetEnumerator()) {
            $stackTags[$credentialTag.Key] = [string] $credentialTag.Value
        }
        foreach ($authWalletTag in $preservedAuthWalletTags.GetEnumerator()) {
            $stackTags[$authWalletTag.Key] = [string] $authWalletTag.Value
        }
    }
    $canonicalTags = ConvertTo-CanonicalTagText -Tags $stackTags
    $tagSha256 = Get-TextSha256 -Value $canonicalTags
    $tagArguments = @()
    foreach ($tag in $stackTags.GetEnumerator()) {
        $tagArguments += "Key=$($tag.Key),Value=$($tag.Value)"
    }

    $parameterArguments = @()
    foreach ($entry in $parameterMap.GetEnumerator()) {
        $parameterArguments += "ParameterKey=$($entry.Key),ParameterValue=$($entry.Value)"
    }
    $canonicalParameters = ($parameterMap.GetEnumerator() | Sort-Object Key | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"
    $parameterSha256 = Get-TextSha256 -Value $canonicalParameters
    $updateDescription = if ($ChangeSetType -eq 'UPDATE') {
        " current-stack-binding-sha256=$currentStackBindingSha256"
    }
    else {
        ''
    }
    if ($isCredentialTransition) {
        $updateDescription += " credential-transition-binding-sha256=$fixedSlotTransitionDeploymentBindingSha256"
    }
    elseif ($isAuthWalletTransition) {
        $updateDescription += " auth-wallet-transition-binding-sha256=$authWalletTransitionDeploymentBindingSha256 auth-wallet-authority-registry-sha256=$AuthWalletTransitionAuthorityRegistrySha256"
    }
    $expectedChangeSetDescription = "KAN-34 template-sha256=$templateSha256 workload-template-sha256=$workloadBoundariesTemplateSha256 workload-binding-sha256=$workloadBoundariesArtifactBindingSha256 observability-template-sha256=$observabilityTemplateSha256 observability-binding-sha256=$observabilityArtifactBindingSha256 parameters-sha256=$parameterSha256 tags-sha256=$tagSha256 control-record-sha256=$controlRecordSha256 acm-dns-record-sha256=$acmDnsRecordSha256 guardrail-policy=$expectedGuardrailPolicyVersion$updateDescription"

    if ($Action -eq 'Plan') {
        Assert-RegionalS3ManagedPrefixList `
            -PrefixListId ([string] $parameterMap.S3ManagedPrefixListId) `
            -ExpectedRegion $Region `
            -ProfileName $Profile
        Assert-VersionedChildArtifact `
            -ArtifactLabel 'workload-boundary' `
            -DownloadFileName 'application-workload-boundaries.yaml' `
            -Bucket $WorkloadBoundariesArtifactBucket `
            -Key $workloadBoundariesArtifactKey `
            -VersionId $WorkloadBoundariesArtifactVersionId `
            -ExpectedOwner $AccountId `
            -ExpectedRegion $Region `
            -ExpectedSha256 $workloadBoundariesTemplateSha256 `
            -ProfileName $Profile
        Assert-VersionedChildArtifact `
            -ArtifactLabel 'observability' `
            -DownloadFileName 'application-observability.yaml' `
            -Bucket $ObservabilityArtifactBucket `
            -Key $observabilityArtifactKey `
            -VersionId $ObservabilityArtifactVersionId `
            -ExpectedOwner $AccountId `
            -ExpectedRegion $Region `
            -ExpectedSha256 $observabilityTemplateSha256 `
            -ProfileName $Profile

        $planStackTarget = if ($ChangeSetType -eq 'UPDATE') { $CurrentStackId } else { $StackName }
        $planArguments = @(
        'cloudformation',
        'create-change-set',
        '--template-body', $templateUri,
        '--stack-name', $planStackTarget,
        '--change-set-name', $ChangeSetName,
        '--change-set-type', $ChangeSetType,
        '--description', $expectedChangeSetDescription,
        '--parameters'
    ) + $parameterArguments + @(
        '--capabilities', 'CAPABILITY_IAM',
        '--include-nested-stacks',
        '--tags'
    ) + $tagArguments + @(
        '--profile', $Profile,
        '--region', $Region,
        '--no-cli-pager'
    )

        Invoke-AwsCommand -Arguments $planArguments
        Write-Host "CloudFormation created nested-aware change set '$ChangeSetName' for review but did not execute it."
        Write-Host 'The guard read an existing versioned S3 artifact and did not upload or create one. No application resources were activated.'
        return
    }
}

$deployStackTarget = if ($ChangeSetType -eq 'UPDATE') { $CurrentStackId } else { $StackName }
$descriptionOutput = & $script:AwsExecutable @(
    'cloudformation',
    'describe-change-set',
    '--stack-name', $deployStackTarget,
    '--change-set-name', $ChangeSetName,
    '--profile', $Profile,
    '--region', $Region,
    '--output', 'json',
    '--no-cli-pager'
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to describe reviewed change set '$ChangeSetName'."
}
$changeSet = ($descriptionOutput | Out-String) | ConvertFrom-Json
if ($changeSet.StackName -cne $StackName -or $changeSet.ChangeSetName -cne $ChangeSetName) {
    throw 'The described change set identity does not match the explicitly requested stack and change-set names.'
}
if ([string] (Get-OptionalPropertyValue -InputObject $changeSet -Name 'ChangeSetType') -cne $ChangeSetType) {
    throw 'The described change-set type does not match the exact locally requested CREATE or UPDATE context.'
}
if ((Get-OptionalPropertyValue -InputObject $changeSet -Name 'IncludeNestedStacks') -ne $true) {
    throw 'The reviewed change set was not created with nested-stack change visibility enabled.'
}
$changeSetCapabilities = @((Get-OptionalPropertyValue -InputObject $changeSet -Name 'Capabilities'))
if ($changeSetCapabilities.Count -ne 1 -or [string] $changeSetCapabilities[0] -cne 'CAPABILITY_IAM') {
    throw 'The reviewed change set must use exactly CAPABILITY_IAM and no additional capability.'
}
if ($changeSet.Status -cne 'CREATE_COMPLETE' -or $changeSet.ExecutionStatus -cne 'AVAILABLE') {
    throw "Change set '$ChangeSetName' is not executable (Status=$($changeSet.Status), ExecutionStatus=$($changeSet.ExecutionStatus))."
}
$changeSetId = [string] $changeSet.ChangeSetId
$expectedChangeSetIdPattern = '^arn:' + [regex]::Escape($partition) + ':cloudformation:' + [regex]::Escape($Region) + ':' + [regex]::Escape($AccountId) + ':changeSet/' + [regex]::Escape($ChangeSetName) + '/[A-Za-z0-9-]+$'
if ($changeSetId -notmatch $expectedChangeSetIdPattern) {
    throw 'The reviewed change set did not return the expected immutable ARN for the approved account and Region.'
}
$stackId = [string] (Get-OptionalPropertyValue -InputObject $changeSet -Name 'StackId')
$expectedStackIdPattern = '^arn:' + [regex]::Escape($partition) + ':cloudformation:' + [regex]::Escape($Region) + ':' + [regex]::Escape($AccountId) + ':stack/' + [regex]::Escape($StackName) + '/[A-Za-z0-9-]+$'
if ($stackId -notmatch $expectedStackIdPattern) {
    throw 'The reviewed change set is not bound to the expected immutable stack ARN in the approved account and Region.'
}
if ($ChangeSetType -eq 'UPDATE' -and $stackId -cne $CurrentStackId) {
    throw 'The reviewed UPDATE change set is not bound to the exact immutable current stack ID in the approved update context.'
}
$parentChangeSetId = [string] (Get-OptionalPropertyValue -InputObject $changeSet -Name 'ParentChangeSetId')
if (-not [string]::IsNullOrEmpty($parentChangeSetId)) {
    throw 'Deploy must target the root reviewed change set, not a child change set.'
}
$rootChangeSetId = [string] (Get-OptionalPropertyValue -InputObject $changeSet -Name 'RootChangeSetId')
if (-not [string]::IsNullOrEmpty($rootChangeSetId) -and $rootChangeSetId -cne $changeSetId) {
    throw 'The reviewed change set returned an unexpected root change-set identity.'
}
if ($ChangeSetType -eq 'UPDATE') {
    $changesProperty = $changeSet.PSObject.Properties['Changes']
    if ($null -eq $changesProperty -or $null -eq $changesProperty.Value) {
        throw 'The reviewed UPDATE change set did not expose its complete resource-change list.'
    }
    $reviewedResourceChanges = @($changesProperty.Value)
    if (
        $isAuthWalletTransition -and
        $AuthWalletTransitionMode -ceq 'transition' -and
        $reviewedResourceChanges.Count -lt 2
    ) {
        throw 'AUTH_WALLET_TRANSITION requires its two functional API changes; additional changes may only be non-replacing tag propagation.'
    }
    $observedAuthWalletLogicalResourceChanges = [System.Collections.Specialized.OrderedDictionary]::new([System.StringComparer]::Ordinal)
    $observedAuthWalletFunctionalResourceChanges = [System.Collections.Specialized.OrderedDictionary]::new([System.StringComparer]::Ordinal)
    foreach ($change in $reviewedResourceChanges) {
        if ($null -eq $change -or [string] (Get-OptionalPropertyValue -InputObject $change -Name 'Type') -cne 'Resource') {
            throw 'The reviewed UPDATE change set contains an unrecognized change entry.'
        }
        $resourceChange = Get-OptionalPropertyValue -InputObject $change -Name 'ResourceChange'
        if ($null -eq $resourceChange) {
            throw 'The reviewed UPDATE change set contains a resource entry without resource-change details.'
        }
        $logicalResourceId = [string] (Get-OptionalPropertyValue -InputObject $resourceChange -Name 'LogicalResourceId')
        $resourceType = [string] (Get-OptionalPropertyValue -InputObject $resourceChange -Name 'ResourceType')
        $resourceAction = [string] (Get-OptionalPropertyValue -InputObject $resourceChange -Name 'Action')
        $replacement = [string] (Get-OptionalPropertyValue -InputObject $resourceChange -Name 'Replacement')
        $policyAction = [string] (Get-OptionalPropertyValue -InputObject $resourceChange -Name 'PolicyAction')
        $resourceChangeScope = @((Get-OptionalPropertyValue -InputObject $resourceChange -Name 'Scope'))
        $resourceChangeDetails = @((Get-OptionalPropertyValue -InputObject $resourceChange -Name 'Details'))
        $isTagOnlyResourceChange = (
            $resourceAction -ceq 'Modify' -and
            $replacement -ceq 'False' -and
            [string]::IsNullOrEmpty($policyAction) -and
            $resourceChangeScope.Count -eq 1 -and
            [string] $resourceChangeScope[0] -ceq 'Tags' -and
            $resourceChangeDetails.Count -gt 0
        )
        if ($isTagOnlyResourceChange) {
            foreach ($resourceChangeDetail in $resourceChangeDetails) {
                $resourceChangeTarget = if ($null -eq $resourceChangeDetail) {
                    $null
                }
                else {
                    Get-OptionalPropertyValue -InputObject $resourceChangeDetail -Name 'Target'
                }
                $detailRequiresRecreation = if ($null -eq $resourceChangeTarget) {
                    $null
                }
                else {
                    [string] (Get-OptionalPropertyValue -InputObject $resourceChangeTarget -Name 'RequiresRecreation')
                }
                if (
                    $null -eq $resourceChangeDetail -or
                    $null -eq $resourceChangeTarget -or
                    [string] (Get-OptionalPropertyValue -InputObject $resourceChangeTarget -Name 'Attribute') -cne 'Tags' -or
                    -not [string]::IsNullOrEmpty([string] (Get-OptionalPropertyValue -InputObject $resourceChangeTarget -Name 'Name')) -or
                    (-not [string]::IsNullOrEmpty($detailRequiresRecreation) -and $detailRequiresRecreation -cne 'Never')
                ) {
                    $isTagOnlyResourceChange = $false
                    break
                }
            }
        }
        if ($isAuthWalletTransition) {
            if ([string]::IsNullOrWhiteSpace($logicalResourceId) -or [string]::IsNullOrWhiteSpace($resourceType)) {
                throw 'AUTH_WALLET_TRANSITION change set contains a resource change without an exact logical ID and resource type.'
            }
            if ($observedAuthWalletLogicalResourceChanges.Contains($logicalResourceId)) {
                throw "AUTH_WALLET_TRANSITION change set contains duplicate resource change '$logicalResourceId'."
            }
            $observedAuthWalletLogicalResourceChanges[$logicalResourceId] = $true
            if ($AuthWalletTransitionMode -ceq 'adopt') {
                if (-not $isTagOnlyResourceChange) {
                    throw 'AUTH_WALLET_TRANSITION adoption permits only zero changes or non-replacing changes whose Scope and every Detail target are exactly Tags.'
                }
                continue
            }
            if ($isTagOnlyResourceChange) {
                continue
            }
            if (
                ($logicalResourceId -ceq 'ApiTaskDefinition' -and (
                        $resourceType -cne 'AWS::ECS::TaskDefinition' -or
                        $resourceAction -cne 'Modify' -or
                        $replacement -cne 'True'
                    )) -or
                ($logicalResourceId -ceq 'ApiService' -and (
                        $resourceType -cne 'AWS::ECS::Service' -or
                        $resourceAction -cne 'Modify' -or
                        $replacement -cne 'False'
                    )) -or
                $logicalResourceId -cnotin @('ApiTaskDefinition', 'ApiService')
            ) {
                throw 'AUTH_WALLET_TRANSITION change set is not the exact reviewed ApiTaskDefinition replacement, ApiService modification, and optional non-replacing tag propagation plan.'
            }
            $observedAuthWalletFunctionalResourceChanges[$logicalResourceId] = $true
            continue
        }
        if ($logicalResourceId -ceq 'Database' -and (
                $resourceType -cne 'AWS::RDS::DBInstance' -or
                $resourceAction -cne 'Modify' -or
                $replacement -cne 'False'
            )) {
            throw 'UPDATE change sets must not replace, add, or remove the stateful Database resource. Use a separately reviewed database migration path.'
        }
        if ($logicalResourceId -ceq 'DatabaseCredentialsSecret') {
            throw 'UPDATE change sets must not modify or remove the legacy retained database master secret through this guard. Inventory and retire it separately.'
        }
    }
    if (
        $isAuthWalletTransition -and
        $AuthWalletTransitionMode -ceq 'transition' -and
        (-not $observedAuthWalletFunctionalResourceChanges.Contains('ApiTaskDefinition') -or -not $observedAuthWalletFunctionalResourceChanges.Contains('ApiService'))
    ) {
        throw 'AUTH_WALLET_TRANSITION change set is missing one of its two exact reviewed API resource changes.'
    }
}

# The description is not template provenance: a manually created change set can
# copy it. Retrieve the user-submitted body for this immutable change-set ARN and
# hash the actual bytes before execution.
$submittedTemplateOutput = & $script:AwsExecutable @(
    'cloudformation',
    'get-template',
    '--stack-name', $stackId,
    '--change-set-name', $changeSetId,
    '--template-stage', 'Original',
    '--profile', $Profile,
    '--region', $Region,
    '--output', 'json',
    '--no-cli-pager'
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to retrieve the original template for reviewed change set '$ChangeSetName'."
}
$submittedTemplate = ($submittedTemplateOutput | Out-String) | ConvertFrom-Json
if ($null -eq $submittedTemplate -or $submittedTemplate.TemplateBody -isnot [string]) {
    throw "CloudFormation did not return a string Original template body for change set '$ChangeSetName'."
}
$submittedTemplateSha256 = Get-TextSha256 -Value ([string] $submittedTemplate.TemplateBody)
if ($submittedTemplateSha256 -cne $templateSha256) {
    throw "The actual Original template submitted with change set '$ChangeSetName' does not match the reviewed local template. Re-plan and review it."
}
$expectedStackTags = $stackTags
$changeSetTags = ConvertFrom-ChangeSetTags -Tags $changeSet.Tags
if ($changeSetTags.Count -ne $expectedStackTags.Count) {
    throw 'The reviewed change set does not contain the exact approved ownership and billing tag set.'
}
foreach ($expectedTag in $expectedStackTags.GetEnumerator()) {
    if (-not $changeSetTags.Contains($expectedTag.Key) -or $changeSetTags[$expectedTag.Key] -cne $expectedTag.Value) {
        throw "The reviewed change set tag '$($expectedTag.Key)' does not match the approved billing control record."
    }
}
$canonicalTags = ConvertTo-CanonicalTagText -Tags $changeSetTags
$tagSha256 = Get-TextSha256 -Value $canonicalTags
$changeSetParameterMap = [System.Collections.Specialized.OrderedDictionary]::new([System.StringComparer]::Ordinal)
foreach ($parameter in @($changeSet.Parameters)) {
    $parameterKey = [string] (Get-OptionalPropertyValue -InputObject $parameter -Name 'ParameterKey')
    $parameterValue = Get-OptionalPropertyValue -InputObject $parameter -Name 'ParameterValue'
    $usePreviousValue = Get-OptionalPropertyValue -InputObject $parameter -Name 'UsePreviousValue'
    if ($usePreviousValue -eq $true -or [string]::IsNullOrEmpty($parameterKey) -or $null -eq $parameterValue) {
        throw 'The reviewed change set contains a non-explicit parameter and cannot be executed by this guard.'
    }
    if ($changeSetParameterMap.Contains($parameterKey)) {
        throw "The reviewed change set contains duplicate parameter '$parameterKey'."
    }
    $changeSetParameterMap[$parameterKey] = [string] $parameterValue
}
if ($changeSetParameterMap.Count -ne $parameterMap.Count) {
    throw "The reviewed change set parameter count does not match the exact local Plan/Deploy contract (Expected=$($parameterMap.Count), Actual=$($changeSetParameterMap.Count))."
}
foreach ($expectedParameter in $parameterMap.GetEnumerator()) {
    if (-not $changeSetParameterMap.Contains($expectedParameter.Key)) {
        throw "The reviewed change set is missing exact locally approved parameter '$($expectedParameter.Key)'."
    }
    if ($changeSetParameterMap[$expectedParameter.Key] -cne [string] $expectedParameter.Value) {
        throw "The reviewed change set parameter '$($expectedParameter.Key)' does not match the exact locally approved value."
    }
}
$reviewedCanonicalParameters = ($changeSetParameterMap.GetEnumerator() | Sort-Object Key | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"
$reviewedParameterSha256 = Get-TextSha256 -Value $reviewedCanonicalParameters
if ($reviewedParameterSha256 -cne $parameterSha256) {
    throw 'The reviewed change set parameter SHA-256 does not match the exact locally constructed parameter map.'
}
if ($changeSet.Description -cne $expectedChangeSetDescription) {
    throw "Change set '$ChangeSetName' is not bound to the current template, parameters, tags, billing record, and guardrail policy. Re-plan and review it."
}
$currentLocalTemplateSha256 = (Get-FileHash -LiteralPath $resolvedTemplate -Algorithm SHA256).Hash.ToLowerInvariant()
$currentLocalChildSha256 = (Get-FileHash -LiteralPath $resolvedWorkloadBoundariesTemplate -Algorithm SHA256).Hash.ToLowerInvariant()
$currentLocalObservabilitySha256 = (Get-FileHash -LiteralPath $resolvedObservabilityTemplate -Algorithm SHA256).Hash.ToLowerInvariant()
if (
    $currentLocalTemplateSha256 -cne $templateSha256 -or
    $currentLocalChildSha256 -cne $workloadBoundariesTemplateSha256 -or
    $currentLocalObservabilitySha256 -cne $observabilityTemplateSha256
) {
    throw 'A reviewed local template changed during Deploy verification. Re-run Plan and review a new change set.'
}
if ($isCredentialTransition) {
    $currentTransitionRecordRawSha256 = (Get-FileHash -LiteralPath $resolvedFixedSlotTransitionRecord -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($currentTransitionRecordRawSha256 -cne $recordRawShaBefore) {
        throw 'The fixed-slot credential transition record changed after Plan/Deploy validation. Re-run Plan and review a new change set.'
    }
    $finalFixedSlotValidation = Invoke-FixedSlotCredentialTransitionValidation `
        -RecordPath $resolvedFixedSlotTransitionRecord `
        -Mode $FixedSlotCredentialTransitionMode `
        -ValidationAt $FixedSlotCredentialTransitionValidationAt `
        -ExpectedStackId $CurrentStackId
    if (
        [string] $finalFixedSlotValidation.canonicalSha256 -cne $fixedSlotTransitionRecordSha256 -or
        [string] $finalFixedSlotValidation.currentStateSha256 -cne $fixedSlotCurrentStateSha256 -or
        [string] $finalFixedSlotValidation.targetStateSha256 -cne $fixedSlotTargetStateSha256
    ) {
        throw 'The fixed-slot credential transition validation binding changed before execution. Re-run Plan and review a new change set.'
    }
}
Assert-RegionalS3ManagedPrefixList `
    -PrefixListId ([string] $parameterMap.S3ManagedPrefixListId) `
    -ExpectedRegion $Region `
    -ProfileName $Profile
Assert-VersionedChildArtifact `
    -ArtifactLabel 'workload-boundary' `
    -DownloadFileName 'application-workload-boundaries.yaml' `
    -Bucket $WorkloadBoundariesArtifactBucket `
    -Key $workloadBoundariesArtifactKey `
    -VersionId $WorkloadBoundariesArtifactVersionId `
    -ExpectedOwner $AccountId `
    -ExpectedRegion $Region `
    -ExpectedSha256 $workloadBoundariesTemplateSha256 `
    -ProfileName $Profile
Assert-VersionedChildArtifact `
    -ArtifactLabel 'observability' `
    -DownloadFileName 'application-observability.yaml' `
    -Bucket $ObservabilityArtifactBucket `
    -Key $observabilityArtifactKey `
    -VersionId $ObservabilityArtifactVersionId `
    -ExpectedOwner $AccountId `
    -ExpectedRegion $Region `
    -ExpectedSha256 $observabilityTemplateSha256 `
    -ProfileName $Profile

if ($ChangeSetType -eq 'UPDATE') {
    $finalStackOutput = & $script:AwsExecutable @(
        'cloudformation',
        'describe-stacks',
        '--stack-name', $CurrentStackId,
        '--profile', $Profile,
        '--region', $Region,
        '--output', 'json',
        '--no-cli-pager'
    )
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to re-read immutable stack '$CurrentStackId' immediately before execution."
    }
    $finalCurrentStack = (($finalStackOutput | Out-String) | ConvertFrom-Json).Stacks | Select-Object -First 1
    if (
        $null -eq $finalCurrentStack -or
        [string] (Get-OptionalPropertyValue -InputObject $finalCurrentStack -Name 'StackName') -cne $StackName -or
        [string] (Get-OptionalPropertyValue -InputObject $finalCurrentStack -Name 'StackId') -cne $CurrentStackId -or
        [string] (Get-OptionalPropertyValue -InputObject $finalCurrentStack -Name 'StackStatus') -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE')
    ) {
        throw 'The current application stack identity or stable status changed before execution. Re-plan and review a new change set.'
    }
    $finalCurrentParameterMap = Get-StackParameterMap -Stack $finalCurrentStack
    $finalCurrentTags = ConvertFrom-ChangeSetTags -Tags (Get-OptionalPropertyValue -InputObject $finalCurrentStack -Name 'Tags')
    $finalCurrentTemplateOutput = & $script:AwsExecutable @(
        'cloudformation',
        'get-template',
        '--stack-name', $CurrentStackId,
        '--template-stage', 'Original',
        '--profile', $Profile,
        '--region', $Region,
        '--output', 'json',
        '--no-cli-pager'
    )
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to re-read the Original template for immutable stack '$CurrentStackId' immediately before execution."
    }
    $finalCurrentTemplate = ($finalCurrentTemplateOutput | Out-String) | ConvertFrom-Json
    if ($null -eq $finalCurrentTemplate -or $finalCurrentTemplate.TemplateBody -isnot [string]) {
        throw 'CloudFormation did not return the current Original application template immediately before execution.'
    }
    $finalCurrentTemplateSha256 = Get-TextSha256 -Value ([string] $finalCurrentTemplate.TemplateBody)
    $finalCurrentParameterSnapshotSha256 = Get-TextSha256 -Value (ConvertTo-CanonicalTagText -Tags $finalCurrentParameterMap)
    $finalCurrentTagSnapshotSha256 = Get-TextSha256 -Value (ConvertTo-CanonicalTagText -Tags $finalCurrentTags)
    $finalCurrentStackBindingText = "current-stack-id=$CurrentStackId`ncurrent-parent-template-sha256=$finalCurrentTemplateSha256`ncurrent-stack-parameters-sha256=$finalCurrentParameterSnapshotSha256`ncurrent-stack-tags-sha256=$finalCurrentTagSnapshotSha256`nupdate-intent=$UpdateIntent"
    $finalCurrentStackBindingSha256 = Get-TextSha256 -Value $finalCurrentStackBindingText
    if ($finalCurrentStackBindingSha256 -cne $currentStackBindingSha256) {
        throw 'The immutable current stack changed after review and before execution. Re-plan and review a new change set.'
    }
}

Write-Host "Reviewed template SHA-256: $templateSha256"
Write-Host "Verified submitted template SHA-256: $submittedTemplateSha256"
Write-Host "Verified workload-boundary template SHA-256: $workloadBoundariesTemplateSha256"
Write-Host "Verified workload-boundary artifact binding SHA-256: $workloadBoundariesArtifactBindingSha256"
Write-Host "Verified observability template SHA-256: $observabilityTemplateSha256"
Write-Host "Verified observability artifact binding SHA-256: $observabilityArtifactBindingSha256"
Write-Host "Reviewed parameter SHA-256: $parameterSha256"
Write-Host "Reviewed tag SHA-256: $tagSha256"
Write-Host "Reviewed billing control record SHA-256: $controlRecordSha256"
Write-Host "Reviewed ACM/DNS control record SHA-256: $acmDnsRecordSha256"
if ($ChangeSetType -eq 'UPDATE') {
    Write-Host "Reviewed current stack binding SHA-256: $currentStackBindingSha256"
}
if ($isCredentialTransition) {
    Write-Host "Reviewed fixed-slot credential transition record SHA-256: $fixedSlotTransitionRecordSha256"
    Write-Host "Reviewed fixed-slot current state SHA-256: $fixedSlotCurrentStateSha256"
    Write-Host "Reviewed fixed-slot target state SHA-256: $fixedSlotTargetStateSha256"
    Write-Host "Reviewed fixed-slot deployment binding SHA-256: $fixedSlotTransitionDeploymentBindingSha256"
}
elseif ($isAuthWalletTransition) {
    Write-Host "Reviewed auth/wallet transition record SHA-256: $authWalletTransitionRecordSha256"
    Write-Host "Reviewed auth/wallet current state SHA-256: $authWalletCurrentStateSha256"
    Write-Host "Reviewed auth/wallet target state SHA-256: $authWalletTargetStateSha256"
    Write-Host "Reviewed auth/wallet authority registry SHA-256: $AuthWalletTransitionAuthorityRegistrySha256"
    Write-Host "Reviewed auth/wallet deployment binding SHA-256: $authWalletTransitionDeploymentBindingSha256"
}

$updateAcknowledgement = if ($ChangeSetType -eq 'UPDATE') {
    " CURRENT STACK STATE $currentStackBindingSha256"
}
else {
    ''
}
if ($isCredentialTransition) {
    $updateAcknowledgement += " FIXED-SLOT TRANSITION $fixedSlotTransitionRecordSha256 FROM STATE $fixedSlotCurrentStateSha256 TO STATE $fixedSlotTargetStateSha256 BOUND BY $fixedSlotTransitionDeploymentBindingSha256 WITH TAGS $tagSha256"
}
elseif ($isAuthWalletTransition) {
    $updateAcknowledgement += " AUTH-WALLET TRANSITION $authWalletTransitionRecordSha256 FROM STATE $authWalletCurrentStateSha256 TO STATE $authWalletTargetStateSha256 USING AUTHORITY REGISTRY $AuthWalletTransitionAuthorityRegistrySha256 BOUND BY $authWalletTransitionDeploymentBindingSha256 WITH TAGS $tagSha256"
}
$expectedAcknowledgement = "EXECUTE IMMUTABLE CHANGE SET $changeSetId FOR IMMUTABLE STACK $stackId WITH PARAMETERS $parameterSha256 WORKLOAD TEMPLATE $workloadBoundariesTemplateSha256 WORKLOAD BINDING $workloadBoundariesArtifactBindingSha256 OBSERVABILITY TEMPLATE $observabilityTemplateSha256 OBSERVABILITY BINDING $observabilityArtifactBindingSha256$updateAcknowledgement USING BILLING CONTROL $controlRecordSha256 AND ACM DNS CONTROL $acmDnsRecordSha256; I ACKNOWLEDGE BILLABLE AWS RESOURCES IN ACCOUNT $AccountId REGION $Region USING PROFILE $Profile"
if ($BillableAcknowledgement -cne $expectedAcknowledgement) {
    throw @"
Deploy can create RDS, ElastiCache, load balancer, networking, logging, KMS, and other billable resources.
After reviewing the change set and budget controls, supply this exact acknowledgement:
$expectedAcknowledgement
"@
}

if ($isAuthWalletTransition) {
    $freshAuthWalletValidationAt = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture)
    $authWalletTransitionRecordRawShaBeforeExecute = (Get-FileHash -LiteralPath $resolvedAuthWalletTransitionRecord -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($authWalletTransitionRecordRawShaBeforeExecute -cne $authWalletTransitionRecordRawShaBefore) {
        throw 'The auth/wallet transition record changed before final authorization. Re-run Plan and review a new change set.'
    }
    $finalAuthWalletValidation = Invoke-AuthWalletTransitionValidation `
        -RecordPath $resolvedAuthWalletTransitionRecord `
        -Mode $AuthWalletTransitionMode `
        -ValidationAt $freshAuthWalletValidationAt `
        -ExpectedStackId $CurrentStackId `
        -ExpectedSecretArn $expectedAuthWalletSecretArn `
        -ExpectedKmsKeyArn $expectedAuthWalletKmsKeyArn `
        -ExpectedCurrentVersionId $authWalletCurrentVersionId `
        -ExpectedTargetVersionId $authWalletTargetVersionId `
        -ExpectedOperation $validatedAuthWalletTransitionOperation `
        -ExpectedFieldName $validatedAuthWalletTransitionFieldName `
        -ExpectedAuthorityRegistrySha256 $AuthWalletTransitionAuthorityRegistrySha256
    $authWalletTransitionRecordRawShaAfterExecuteValidation = (Get-FileHash -LiteralPath $resolvedAuthWalletTransitionRecord -Algorithm SHA256).Hash.ToLowerInvariant()
    if (
        $authWalletTransitionRecordRawShaAfterExecuteValidation -cne $authWalletTransitionRecordRawShaBefore -or
        [string] $finalAuthWalletValidation.canonicalSha256 -cne $authWalletTransitionRecordSha256 -or
        [string] $finalAuthWalletValidation.currentStateSha256 -cne $authWalletCurrentStateSha256 -or
        [string] $finalAuthWalletValidation.targetStateSha256 -cne $authWalletTargetStateSha256 -or
        [string] $finalAuthWalletValidation.predecessorTransitionSha256 -cne $authWalletPredecessorTransitionSha256 -or
        [string] $finalAuthWalletValidation.authorityRegistrySha256 -cne $AuthWalletTransitionAuthorityRegistrySha256
    ) {
        throw 'The signed auth/wallet transition or authority binding changed before execution. Re-run Plan and review a new change set.'
    }
}

Write-Warning "Executing reviewed change set '$ChangeSetName' can create billable AWS resources in account $AccountId ($Region)."
Invoke-AwsCommand -Arguments @(
    'cloudformation',
    'execute-change-set',
    '--stack-name', $stackId,
    '--change-set-name', $changeSetId,
    '--client-request-token', ([guid]::NewGuid().ToString()),
    '--profile', $Profile,
    '--region', $Region,
    '--no-cli-pager'
)
