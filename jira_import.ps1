param(
    [string]$ProjectKey = 'KAN',
    [string[]]$ManifestPaths = @(
        '.\jira_phase_1_3.json',
        '.\jira_phase_4_5.json',
        '.\jira_phase_6_7_audit.json'
    ),
    [string]$EnvironmentPath = $env:JIRA_ENV_PATH,
    [switch]$ValidateOnly,
    [switch]$LinkAllDependencies
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($EnvironmentPath)) {
    $EnvironmentPath = Join-Path $PSScriptRoot '.jira.env'
}

function Read-DotEnv {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Jira environment file not found: $Path"
    }

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*([^#][^=]*)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"').Trim("'")
            $values[$name] = $value
        }
    }

    return $values
}

function Invoke-Jira {
    param(
        [ValidateSet('Get', 'Post', 'Put')]
        [string]$Method,
        [string]$Path,
        [object]$Body
    )

    $parameters = @{
        Uri = $script:JiraBase + $Path
        Headers = $script:JiraHeaders
        Method = $Method
    }

    if ($PSBoundParameters.ContainsKey('Body')) {
        $jsonBody = $Body | ConvertTo-Json -Depth 100 -Compress
        $null = $jsonBody | ConvertFrom-Json
        $parameters.ContentType = 'application/json; charset=utf-8'
        $parameters.Body = [Text.Encoding]::UTF8.GetBytes($jsonBody)
    }

    for ($attempt = 1; $attempt -le 6; $attempt++) {
        try {
            return Invoke-RestMethod @parameters
        }
        catch {
            $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            $retryable = $status -in @(429, 500, 502, 503, 504)
            if (-not $retryable -or $attempt -eq 6) {
                throw
            }

            $delaySeconds = [Math]::Min([Math]::Pow(2, $attempt), 10)
            Write-Warning "Jira returned HTTP $status. Retrying in $delaySeconds seconds (attempt $attempt of 6)."
            Start-Sleep -Seconds $delaySeconds
        }
    }
}

function ConvertTo-Adf {
    param(
        [string]$Text,
        [string]$LocalId,
        [string[]]$Dependencies
    )

    $content = [System.Collections.Generic.List[object]]::new()

    $content.Add(@{
        type = 'paragraph'
        content = @(@{
            type = 'text'
            text = "Specification ID: $LocalId"
            marks = @(@{ type = 'strong' })
        })
    })

    foreach ($line in ($Text -split "`r?`n")) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) {
            continue
        }

        if ($trimmed -match '^(#{1,6})\s+(.+)$') {
            $level = [Math]::Min($matches[1].Length, 6)
            $content.Add(@{
                type = 'heading'
                attrs = @{ level = $level }
                content = @(@{ type = 'text'; text = $matches[2] })
            })
            continue
        }

        if ($trimmed -match '^\*\*(.+?)\*\*\s*(.*)$') {
            $paragraphContent = [System.Collections.Generic.List[object]]::new()
            $paragraphContent.Add(@{
                type = 'text'
                text = $matches[1]
                marks = @(@{ type = 'strong' })
            })
            if (-not [string]::IsNullOrWhiteSpace($matches[2])) {
                $paragraphContent.Add(@{ type = 'text'; text = (' ' + ($matches[2] -replace '`', '')) })
            }
            $content.Add(@{ type = 'paragraph'; content = @($paragraphContent) })
            continue
        }

        if ($trimmed -match '^[-*]\s+(.+)$') {
            $trimmed = [char]0x2022 + ' ' + ($matches[1] -replace '`', '')
        }
        else {
            $trimmed = $trimmed -replace '`', ''
        }

        $content.Add(@{
            type = 'paragraph'
            content = @(@{ type = 'text'; text = $trimmed })
        })
    }

    if ($Dependencies.Count -gt 0 -and $Text -notmatch '(?im)^\*\*Dependencies:\*\*') {
        $content.Add(@{
            type = 'paragraph'
            content = @(
                @{ type = 'text'; text = 'Declared dependencies: '; marks = @(@{ type = 'strong' }) },
                @{ type = 'text'; text = ($Dependencies -join ', ') }
            )
        })
    }

    return @{ type = 'doc'; version = 1; content = @($content) }
}

function Get-SpecLabel {
    param([string]$LocalId)
    return 'spec-' + (($LocalId.ToLowerInvariant() -replace '[^a-z0-9_-]', '-') -replace '-+', '-')
}

function Get-JiraIssueType {
    param([string]$ManifestType)

    switch ($ManifestType) {
        'Epic' { return 'Epic' }
        'Story' { return 'Feature' }
        'Feature' { return 'Feature' }
        'Task' { return 'Task' }
        'Spike' { return 'Task' }
        default { throw "Unsupported manifest issue type: $ManifestType" }
    }
}

function Get-DeclaredDependencies {
    param([object]$Item)

    if ('dependencies' -in $Item.PSObject.Properties.Name -and $null -ne $Item.dependencies) {
        return @($Item.dependencies | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }

    $match = [regex]::Match($Item.description, '(?im)^\*\*Dependencies:\*\*\s*(.+)$')
    if (-not $match.Success) {
        return @()
    }

    $text = $match.Groups[1].Value.Trim().TrimEnd('.')
    if ($text -match '^(none|n/a)$') {
        return @()
    }

    $backtickMatches = [regex]::Matches($text, '`([^`]+)`')
    if ($backtickMatches.Count -gt 0) {
        return @($backtickMatches | ForEach-Object { $_.Groups[1].Value.Trim() })
    }

    return @($text -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Get-ProjectIssueMap {
    $map = @{}
    $pageToken = $null

    do {
        $jql = [uri]::EscapeDataString("project = $ProjectKey ORDER BY key ASC")
        $path = "/rest/api/3/search/jql?jql=$jql&maxResults=100&fields=summary,labels,parent,issuetype"
        if ($pageToken) {
            $path += '&nextPageToken=' + [uri]::EscapeDataString($pageToken)
        }

        $page = Invoke-Jira -Method Get -Path $path
        foreach ($issue in @($page.issues)) {
            foreach ($label in @($issue.fields.labels)) {
                if ($label -like 'spec-*') {
                    if ($map.ContainsKey($label) -and $map[$label] -ne $issue.key) {
                        throw "Duplicate specification label '$label' on $($map[$label]) and $($issue.key)."
                    }
                    $map[$label] = $issue.key
                }
            }
        }

        $pageToken = $page.nextPageToken
    } while ($pageToken)

    return $map
}

function New-IssueFields {
    param(
        [object]$Item,
        [hashtable]$IssueMap
    )

    $dependencies = @($Item.dependencies | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $labels = [System.Collections.Generic.List[string]]::new()
    foreach ($label in @($Item.labels)) {
        if (-not [string]::IsNullOrWhiteSpace($label) -and -not $labels.Contains($label)) {
            $labels.Add($label)
        }
    }

    $specLabel = Get-SpecLabel -LocalId $Item.local_id
    if (-not $labels.Contains($specLabel)) { $labels.Add($specLabel) }
    if ($Item.issue_type -eq 'Spike' -and -not $labels.Contains('spike')) { $labels.Add('spike') }

    $fields = @{
        project = @{ key = $ProjectKey }
        summary = $Item.summary
        issuetype = @{ name = Get-JiraIssueType -ManifestType $Item.issue_type }
        description = ConvertTo-Adf -Text $Item.description -LocalId $Item.local_id -Dependencies $dependencies
        priority = @{ name = $Item.priority }
        labels = @($labels)
    }

    if (-not [string]::IsNullOrWhiteSpace($Item.parent_local_id)) {
        $parentLabel = Get-SpecLabel -LocalId $Item.parent_local_id
        if (-not $IssueMap.ContainsKey($parentLabel)) {
            throw "Parent '$($Item.parent_local_id)' for '$($Item.local_id)' has not been created."
        }
        $fields.parent = @{ key = $IssueMap[$parentLabel] }
    }

    return $fields
}

function New-IssueBatch {
    param(
        [object[]]$Items,
        [hashtable]$IssueMap
    )

    for ($offset = 0; $offset -lt $Items.Count; $offset += 50) {
        $end = [Math]::Min($offset + 49, $Items.Count - 1)
        $batch = @($Items[$offset..$end])
        $updates = @()

        foreach ($item in $batch) {
            $specLabel = Get-SpecLabel -LocalId $item.local_id
            if ($IssueMap.ContainsKey($specLabel)) {
                Write-Output "SKIP existing $($item.local_id) -> $($IssueMap[$specLabel])"
                continue
            }

            $updates += @{ fields = New-IssueFields -Item $item -IssueMap $IssueMap }
        }

        if ($updates.Count -eq 0) {
            continue
        }

        $response = Invoke-Jira -Method Post -Path '/rest/api/3/issue/bulk' -Body @{ issueUpdates = $updates }
        if (@($response.errors).Count -gt 0) {
            $details = $response.errors | ConvertTo-Json -Depth 20 -Compress
            throw "Jira bulk create returned errors: $details"
        }

        Write-Output "CREATED batch of $($response.issues.Count) issues"
    }
}

function Add-DependencyLinks {
    param(
        [object[]]$Items,
        [hashtable]$IssueMap,
        [hashtable]$ItemsById,
        [switch]$IncludeChildLinks
    )

    $created = 0
    $skipped = 0
    foreach ($item in $Items) {
        $dependentLabel = Get-SpecLabel -LocalId $item.local_id
        if (-not $IssueMap.ContainsKey($dependentLabel)) {
            continue
        }

        foreach ($dependencyId in @($item.dependencies)) {
            if ([string]::IsNullOrWhiteSpace($dependencyId)) {
                continue
            }

            if (-not $IncludeChildLinks -and ($item.issue_type -ne 'Epic' -or $ItemsById[$dependencyId].issue_type -ne 'Epic')) {
                continue
            }

            $dependencyLabel = Get-SpecLabel -LocalId $dependencyId
            if (-not $IssueMap.ContainsKey($dependencyLabel)) {
                Write-Warning "Cannot link unknown dependency '$dependencyId' for '$($item.local_id)'."
                $skipped++
                continue
            }

            $body = @{
                type = @{ name = 'Blocks' }
                inwardIssue = @{ key = $IssueMap[$dependentLabel] }
                outwardIssue = @{ key = $IssueMap[$dependencyLabel] }
            }

            try {
                Invoke-Jira -Method Post -Path '/rest/api/3/issueLink' -Body $body | Out-Null
                $created++
            }
            catch {
                $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
                if ($status -eq 400) {
                    Write-Warning "Dependency link may already exist: $dependencyId -> $($item.local_id)"
                    $skipped++
                    continue
                }
                throw
            }
        }
    }

    return @{ created = $created; skipped = $skipped }
}

$jiraEnvironment = Read-DotEnv -Path $EnvironmentPath
foreach ($required in @('JIRA_URL', 'JIRA_USERNAME', 'JIRA_API_TOKEN')) {
    if ([string]::IsNullOrWhiteSpace($jiraEnvironment[$required])) {
        throw "Missing $required in $EnvironmentPath"
    }
}

$script:JiraBase = $jiraEnvironment['JIRA_URL'].TrimEnd('/')
$credentialText = $jiraEnvironment['JIRA_USERNAME'] + ':' + $jiraEnvironment['JIRA_API_TOKEN']
$encodedCredential = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($credentialText))
$script:JiraHeaders = @{ Authorization = 'Basic ' + $encodedCredential; Accept = 'application/json' }

$items = [System.Collections.Generic.List[object]]::new()
foreach ($manifestPath in $ManifestPaths) {
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "Manifest not found: $manifestPath"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($item in @($manifest)) {
        $normalizedDependencies = @(Get-DeclaredDependencies -Item $item)
        if ('dependencies' -in $item.PSObject.Properties.Name) {
            $item.dependencies = $normalizedDependencies
        }
        else {
            $item | Add-Member -NotePropertyName dependencies -NotePropertyValue $normalizedDependencies
        }
        $items.Add($item)
    }
}

$byId = @{}
foreach ($item in $items) {
    if ([string]::IsNullOrWhiteSpace($item.local_id)) { throw 'Every item needs local_id.' }
    if ($byId.ContainsKey($item.local_id)) { throw "Duplicate local_id: $($item.local_id)" }
    if ([string]::IsNullOrWhiteSpace($item.summary)) { throw "Missing summary: $($item.local_id)" }
    if ([string]::IsNullOrWhiteSpace($item.description)) { throw "Missing description: $($item.local_id)" }
    if ($item.priority -notin @('Highest', 'High', 'Medium')) { throw "Invalid priority on $($item.local_id): $($item.priority)" }
    $byId[$item.local_id] = $item
}

foreach ($item in $items) {
    if (-not [string]::IsNullOrWhiteSpace($item.parent_local_id) -and -not $byId.ContainsKey($item.parent_local_id)) {
        throw "Unknown parent '$($item.parent_local_id)' for '$($item.local_id)'."
    }
}

$project = Invoke-Jira -Method Get -Path "/rest/api/3/project/$ProjectKey"
$availableTypes = @($project.issueTypes.name)
foreach ($requiredType in @('Epic', 'Feature', 'Task')) {
    if ($requiredType -notin $availableTypes) {
        throw "Project $ProjectKey does not support required type '$requiredType'."
    }
}

$issueMap = Get-ProjectIssueMap
$epics = @($items | Where-Object { $_.issue_type -eq 'Epic' })
$children = @($items | Where-Object { $_.issue_type -ne 'Epic' })
$unknownDependencies = @(
    foreach ($item in $items) {
        foreach ($dependencyId in @($item.dependencies)) {
            if (-not [string]::IsNullOrWhiteSpace($dependencyId) -and -not $byId.ContainsKey($dependencyId)) {
                "$($item.local_id):$dependencyId"
            }
        }
    }
)

Write-Output "Validated $($items.Count) manifest items: $($epics.Count) epics and $($children.Count) focused child issues."
if ($ValidateOnly) {
    [pscustomobject]@{
        valid = $true
        project = $ProjectKey
        total = $items.Count
        epics = $epics.Count
        children = $children.Count
        existing_spec_issues = $issueMap.Count
        unknown_dependencies = $unknownDependencies
    } | ConvertTo-Json -Depth 10
    exit 0
}

if ($unknownDependencies.Count -gt 0) {
    throw "Unresolved dependency references: $($unknownDependencies -join ', ')"
}

New-IssueBatch -Items $epics -IssueMap $issueMap
$issueMap = Get-ProjectIssueMap
New-IssueBatch -Items $children -IssueMap $issueMap
$issueMap = Get-ProjectIssueMap

$linkResult = Add-DependencyLinks -Items $items -IssueMap $issueMap -ItemsById $byId -IncludeChildLinks:$LinkAllDependencies

$resultRows = foreach ($item in $items) {
    $label = Get-SpecLabel -LocalId $item.local_id
    [pscustomobject]@{
        local_id = $item.local_id
        jira_key = $issueMap[$label]
        issue_type = Get-JiraIssueType -ManifestType $item.issue_type
        parent_local_id = $item.parent_local_id
        summary = $item.summary
    }
}

[pscustomobject]@{
    project = $ProjectKey
    total = $items.Count
    epics = $epics.Count
    children = $children.Count
    dependency_links_created = $linkResult.created
    dependency_links_skipped = $linkResult.skipped
    issues = @($resultRows)
} | ConvertTo-Json -Depth 10
