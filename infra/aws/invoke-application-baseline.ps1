<#
.SYNOPSIS
Validates KAN-34 locally by default and guards every optional AWS-side action.

.DESCRIPTION
LocalValidate is the default and performs filesystem-only policy validation.
CloudValidate, Plan, and Deploy require an explicit named profile, account ID,
Region, and AllowAwsApiCalls. Plan creates a named change set without executing
it. Deploy verifies and executes that exact template-hash-bound change set only
after an exact billable-resource acknowledgement.

.PARAMETER Action
LocalValidate, CloudValidate, Plan, or Deploy. Defaults to LocalValidate.

.PARAMETER ParameterOverride
Non-secret CloudFormation parameters in Key=Value form. Secret-like parameter
names are rejected; application secrets must be generated in Secrets Manager.

.PARAMETER AllowAwsApiCalls
Explicit opt-in required before this script resolves credentials or calls AWS.

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

    [string] $Profile,

    [string] $AccountId,

    [string] $Region,

    [string] $StackName,

    [string] $ChangeSetName,

    [ValidateSet('CREATE', 'UPDATE')]
    [string] $ChangeSetType,

    [string] $EnvironmentName,

    [string[]] $ParameterOverride = @(),

    [switch] $AllowAwsApiCalls,

    [string] $BillableAcknowledgement
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($TemplateFile)) {
    $TemplateFile = Join-Path $PSScriptRoot 'application-baseline.yaml'
}

$validatorPath = Join-Path $PSScriptRoot 'validate-application-baseline.mjs'
$resolvedTemplate = [System.IO.Path]::GetFullPath($TemplateFile)

function Assert-RequiredValue {
    param(
        [string] $Name,
        [AllowNull()]
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

if (-not (Test-Path -LiteralPath $validatorPath -PathType Leaf)) {
    throw "Local policy validator was not found: $validatorPath"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
    throw 'Node.js is required for local CloudFormation policy validation.'
}

# Every action starts with offline policy validation. This invocation has no AWS
# imports, credential resolution, subprocesses, or network operations.
& $nodeCommand.Source $validatorPath --template $resolvedTemplate
if ($LASTEXITCODE -ne 0) {
    throw 'Local CloudFormation policy validation failed. No AWS calls were made.'
}

if ($Action -eq 'LocalValidate') {
    Write-Host 'Local validation completed. No AWS calls were made and no resources were created.'
    return
}

if (-not $AllowAwsApiCalls.IsPresent) {
    throw "Action '$Action' is cloud-side. Re-run with -AllowAwsApiCalls after reviewing the selected account, profile, and region."
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

$awsCommand = Get-Command aws -ErrorAction SilentlyContinue
if ($null -eq $awsCommand) {
    throw 'AWS CLI v2 is required for explicitly opted-in cloud actions.'
}
$script:AwsExecutable = $awsCommand.Source

$templateInfo = Get-Item -LiteralPath $resolvedTemplate
if ($templateInfo.Length -gt 51200) {
    throw 'Template exceeds the 51,200-byte direct-upload limit. This guard will not stage templates in a paid S3 service.'
}
$templateSha256 = (Get-FileHash -LiteralPath $resolvedTemplate -Algorithm SHA256).Hash.ToLowerInvariant()

# Verify the named profile before any CloudFormation API call. --profile and
# --region are always supplied; ambient/default credentials are never selected.
$identityOutput = & $script:AwsExecutable @(
    'sts',
    'get-caller-identity',
    '--profile', $Profile,
    '--region', $Region,
    '--query', 'Account',
    '--output', 'text',
    '--no-cli-pager'
)
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to verify the explicitly named AWS profile.'
}
$actualAccountId = ($identityOutput | Out-String).Trim()
if ($actualAccountId -ne $AccountId) {
    throw "Named profile '$Profile' resolved to account '$actualAccountId', not the approved account '$AccountId'."
}

$templateUri = 'file://' + ($resolvedTemplate -replace '\\', '/')
if ($Action -eq 'CloudValidate') {
    Invoke-AwsCommand -Arguments @(
        'cloudformation',
        'validate-template',
        '--template-body', $templateUri,
        '--profile', $Profile,
        '--region', $Region,
        '--no-cli-pager'
    )
    Write-Host 'AWS validated the template syntax. No stack or application resources were created.'
    return
}

Assert-RequiredValue -Name 'StackName' -Value $StackName
Assert-RequiredValue -Name 'ChangeSetName' -Value $ChangeSetName

if ($StackName -notmatch '^[A-Za-z][A-Za-z0-9-]{0,127}$') {
    throw 'StackName must be a valid explicit CloudFormation stack name.'
}
if ($ChangeSetName -notmatch '^[A-Za-z][A-Za-z0-9-]{0,127}$') {
    throw 'ChangeSetName must be an explicit CloudFormation-safe name.'
}

if ($Action -eq 'Plan') {
    Assert-RequiredValue -Name 'ChangeSetType' -Value $ChangeSetType
    Assert-RequiredValue -Name 'EnvironmentName' -Value $EnvironmentName
    if ($EnvironmentName.Length -gt 31 -or $EnvironmentName -notmatch '^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$') {
        throw 'EnvironmentName must be at most 31 characters and use the template non-production pattern: dev|test|qa|sandbox|staging with optional lowercase suffix segments.'
    }

    $parameterMap = [ordered]@{
        EnvironmentName = $EnvironmentName
    }
    $sensitiveParameterName = '(?i)(password|credential|accesskey|secret(?:value|string)?|token)'
    foreach ($item in $ParameterOverride) {
        if ($item -notmatch '^([A-Za-z][A-Za-z0-9]*)=(.+)$') {
            throw "ParameterOverride '$item' must use the exact Key=Value form."
        }

        $key = $Matches[1]
        $value = $Matches[2]
        if ($key -eq 'EnvironmentName') {
            throw 'EnvironmentName is a named argument and must not be repeated in ParameterOverride.'
        }
        if ($key -match $sensitiveParameterName) {
            throw "Secret-bearing override '$key' is prohibited. Generate and resolve secrets through Secrets Manager."
        }
        if ($parameterMap.Contains($key)) {
            throw "ParameterOverride contains duplicate key '$key'."
        }
        $parameterMap[$key] = $value
    }

    $requiredParameters = @(
        'BillingAcknowledgement',
        'ApplicationVersion',
        'ApiImageUri',
        'WebImageUri',
        'WorkerImageUri',
        'S3ManagedPrefixListId',
        'AllowedIngressIpv4Cidr',
        'AlbCertificateArn',
        'ApplicationHostname',
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
        StatefulBackupRetentionDays = '1'
        SqsMaxReceiveCount = '3'
        SqsVisibilityTimeoutSeconds = '30'
        LogRetentionDays = '14'
        EnableOperationalAlarms = 'true'
        EnableOperationalDashboard = 'false'
        EnableContainerInsights = 'disabled'
    }
    $allowedParameterNames = @('EnvironmentName') + $requiredParameters + @($parameterDefaults.Keys)
    foreach ($parameterName in $parameterMap.Keys) {
        if ($allowedParameterNames -cnotcontains $parameterName) {
            throw "ParameterOverride contains unknown template parameter '$parameterName'."
        }
    }
    if ($ChangeSetType -eq 'UPDATE') {
        $stackOutput = & $script:AwsExecutable @(
            'cloudformation',
            'describe-stacks',
            '--stack-name', $StackName,
            '--profile', $Profile,
            '--region', $Region,
            '--output', 'json',
            '--no-cli-pager'
        )
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to read current parameters for stack '$StackName'."
        }
        $currentStack = (($stackOutput | Out-String) | ConvertFrom-Json).Stacks | Select-Object -First 1
        if ($null -eq $currentStack) {
            throw "Stack '$StackName' was not returned for UPDATE planning."
        }
        $currentEnvironment = $currentStack.Parameters |
            Where-Object ParameterKey -eq 'EnvironmentName' |
            Select-Object -ExpandProperty ParameterValue -First 1
        if ($currentEnvironment -cne $EnvironmentName) {
            throw "EnvironmentName '$EnvironmentName' does not match the existing stack value '$currentEnvironment'. Create a separate stack for a different environment."
        }
        foreach ($parameter in $currentStack.Parameters) {
            if ($parameterDefaults.Contains($parameter.ParameterKey) -and -not $parameterMap.Contains($parameter.ParameterKey)) {
                $parameterMap[$parameter.ParameterKey] = [string] $parameter.ParameterValue
            }
        }
    }

    foreach ($entry in $parameterDefaults.GetEnumerator()) {
        if (-not $parameterMap.Contains($entry.Key)) {
            $parameterMap[$entry.Key] = $entry.Value
        }
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

    $partition = if ($Region -like 'cn-*') {
        'aws-cn'
    } elseif ($Region -like 'us-gov-*') {
        'aws-us-gov'
    } else {
        'aws'
    }
    $ecrDnsSuffix = if ($partition -eq 'aws-cn') { 'amazonaws.com.cn' } else { 'amazonaws.com' }
    $expectedEcrPrefix = "$AccountId.dkr.ecr.$Region.$ecrDnsSuffix/"
    foreach ($imageParameter in @('ApiImageUri', 'WebImageUri', 'WorkerImageUri')) {
        if (-not $parameterMap[$imageParameter].StartsWith($expectedEcrPrefix, [System.StringComparison]::Ordinal)) {
            throw "$imageParameter must reference private ECR in the approved account and region: $expectedEcrPrefix"
        }
    }

    $expectedCertificatePrefix = "arn:${partition}:acm:${Region}:${AccountId}:certificate/"
    if (-not $parameterMap.AlbCertificateArn.StartsWith($expectedCertificatePrefix, [System.StringComparison]::Ordinal)) {
        throw "AlbCertificateArn must reference ACM in the approved account and region: $expectedCertificatePrefix"
    }

    $parameterArguments = @()
    foreach ($entry in $parameterMap.GetEnumerator()) {
        $parameterArguments += "ParameterKey=$($entry.Key),ParameterValue=$($entry.Value)"
    }
    $canonicalParameters = ($parameterMap.GetEnumerator() | Sort-Object Key | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n"
    $parameterSha256 = Get-TextSha256 -Value $canonicalParameters
    $expectedChangeSetDescription = "KAN-34 template-sha256=$templateSha256 parameters-sha256=$parameterSha256"

    $planArguments = @(
        'cloudformation',
        'create-change-set',
        '--template-body', $templateUri,
        '--stack-name', $StackName,
        '--change-set-name', $ChangeSetName,
        '--change-set-type', $ChangeSetType,
        '--description', $expectedChangeSetDescription,
        '--parameters'
    ) + $parameterArguments + @(
        '--capabilities', 'CAPABILITY_IAM',
        '--tags',
        'Key=application,Value=crypto-lending',
        "Key=environment,Value=$EnvironmentName",
        'Key=managed-by,Value=cloudformation',
        'Key=ticket,Value=KAN-34',
        '--profile', $Profile,
        '--region', $Region,
        '--no-cli-pager'
    )

    Invoke-AwsCommand -Arguments $planArguments
    Write-Host "CloudFormation created change set '$ChangeSetName' for review but did not execute it."
    Write-Host 'No application resources were activated by this command.'
    return
}

$descriptionOutput = & $script:AwsExecutable @(
    'cloudformation',
    'describe-change-set',
    '--stack-name', $StackName,
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
if ($changeSet.StackName -ne $StackName -or $changeSet.ChangeSetName -ne $ChangeSetName) {
    throw 'The described change set identity does not match the explicitly requested stack and change-set names.'
}
if ($changeSet.Status -ne 'CREATE_COMPLETE' -or $changeSet.ExecutionStatus -ne 'AVAILABLE') {
    throw "Change set '$ChangeSetName' is not executable (Status=$($changeSet.Status), ExecutionStatus=$($changeSet.ExecutionStatus))."
}
$canonicalParameters = ($changeSet.Parameters | Sort-Object ParameterKey | ForEach-Object {
        if ($_.UsePreviousValue -or [string]::IsNullOrEmpty($_.ParameterKey) -or $null -eq $_.ParameterValue) {
            throw 'The reviewed change set contains a non-explicit parameter and cannot be executed by this guard.'
        }
        "$($_.ParameterKey)=$($_.ParameterValue)"
    }) -join "`n"
$parameterSha256 = Get-TextSha256 -Value $canonicalParameters
$expectedChangeSetDescription = "KAN-34 template-sha256=$templateSha256 parameters-sha256=$parameterSha256"
if ($changeSet.Description -cne $expectedChangeSetDescription) {
    throw "Change set '$ChangeSetName' is not bound to the current template and canonical parameter SHA-256 values. Re-plan and review it."
}
Write-Host "Reviewed template SHA-256: $templateSha256"
Write-Host "Reviewed parameter SHA-256: $parameterSha256"

$expectedAcknowledgement = "EXECUTE REVIEWED CHANGE SET $ChangeSetName FOR STACK $StackName; I ACKNOWLEDGE BILLABLE AWS RESOURCES IN ACCOUNT $AccountId REGION $Region USING PROFILE $Profile"
if ($BillableAcknowledgement -cne $expectedAcknowledgement) {
    throw @"
Deploy can create RDS, ElastiCache, load balancer, networking, logging, KMS, and other billable resources.
After reviewing the change set and budget controls, supply this exact acknowledgement:
$expectedAcknowledgement
"@
}

Write-Warning "Executing reviewed change set '$ChangeSetName' can create billable AWS resources in account $AccountId ($Region)."
Invoke-AwsCommand -Arguments @(
    'cloudformation',
    'execute-change-set',
    '--stack-name', $StackName,
    '--change-set-name', $ChangeSetName,
    '--client-request-token', ([guid]::NewGuid().ToString()),
    '--profile', $Profile,
    '--region', $Region,
    '--no-cli-pager'
)
