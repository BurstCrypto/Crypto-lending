param(
    [string]$ProjectKey = 'KAN',
    [string]$PhaseLabel = 'phase-5',
    [string]$EnvironmentPath = $env:JIRA_ENV_PATH
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'jira_http.ps1')

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
            $values[$matches[1].Trim()] = $matches[2].Trim().Trim('"').Trim("'")
        }
    }
    return $values
}

function Invoke-Jira {
    param(
        [ValidateSet('Get', 'Post')]
        [string]$Method,
        [string]$Path,
        [object]$Body
    )

    $parameters = @{
        Uri = New-JiraRequestUri -BaseUrl $script:JiraBase -Path $Path
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
            return Invoke-JiraRestMethodNoRedirect -Parameters $parameters
        }
        catch {
            $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            if ($status -notin @(429, 500, 502, 503, 504) -or $attempt -eq 6) {
                $detail = $_.ErrorDetails.Message
                if ([string]::IsNullOrWhiteSpace($detail) -and $_.Exception.Response) {
                    try {
                        $reader = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
                        $detail = $reader.ReadToEnd()
                        $reader.Dispose()
                    }
                    catch {
                        $detail = $null
                    }
                }
                if ([string]::IsNullOrWhiteSpace($detail)) { $detail = $_.Exception.Message }
                throw "Jira $Method $Path failed with HTTP ${status}: $detail"
            }
            Start-Sleep -Seconds ([Math]::Min([Math]::Pow(2, $attempt), 10))
        }
    }
}

function Wait-JiraTask {
    param(
        [string]$TaskId,
        [int]$MaximumAttempts = 60
    )

    for ($attempt = 1; $attempt -le $MaximumAttempts; $attempt++) {
        $task = Invoke-Jira -Method Get -Path "/rest/api/3/task/$TaskId"
        if ($task.status -eq 'COMPLETE') {
            return $task
        }
        if ($task.status -in @('FAILED', 'CANCELLED', 'DEAD')) {
            throw "Jira task $TaskId ended with status $($task.status): $($task.message)"
        }
        Start-Sleep -Seconds 2
    }

    throw "Jira task $TaskId did not complete in time."
}

function Get-IssuesByJql {
    param(
        [string]$Jql,
        [string]$Fields = 'summary,status,labels,parent,issuetype'
    )

    $issues = [System.Collections.Generic.List[object]]::new()
    $pageToken = $null
    do {
        $path = '/rest/api/3/search/jql?jql=' + [uri]::EscapeDataString($Jql) + '&maxResults=100&fields=' + [uri]::EscapeDataString($Fields)
        if ($pageToken) {
            $path += '&nextPageToken=' + [uri]::EscapeDataString($pageToken)
        }
        $page = Invoke-Jira -Method Get -Path $path
        foreach ($issue in @($page.issues)) {
            $issues.Add($issue)
        }
        $pageToken = $page.nextPageToken
    } while ($pageToken)

    return @($issues)
}

function Copy-TransitionForUpdate {
    param([object]$Transition)

    $copy = [ordered]@{
        type = $Transition.type
        toStatusReference = $Transition.toStatusReference
        links = @($Transition.links)
        name = $Transition.name
        description = $Transition.description
        actions = @($Transition.actions)
        validators = @($Transition.validators)
        triggers = @($Transition.triggers)
        properties = if ($null -ne $Transition.properties) { $Transition.properties } else { @{} }
    }
    if ($Transition.id) { $copy['id'] = $Transition.id }
    if ($null -ne $Transition.conditions) { $copy['conditions'] = $Transition.conditions }
    if ($null -ne $Transition.transitionScreen) { $copy['transitionScreen'] = $Transition.transitionScreen }
    if ($null -ne $Transition.customIssueEventId) { $copy['customIssueEventId'] = $Transition.customIssueEventId }
    return $copy
}

$jiraEnvironment = Read-DotEnv -Path $EnvironmentPath
foreach ($required in @('JIRA_URL', 'JIRA_USERNAME', 'JIRA_API_TOKEN')) {
    if ([string]::IsNullOrWhiteSpace($jiraEnvironment[$required])) {
        throw "Missing $required in $EnvironmentPath"
    }
}

$script:JiraBase = ConvertTo-JiraBaseUrl -Value $jiraEnvironment['JIRA_URL']
$credentialText = $jiraEnvironment['JIRA_USERNAME'] + ':' + $jiraEnvironment['JIRA_API_TOKEN']
$encodedCredential = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($credentialText))
$script:JiraHeaders = @{ Authorization = 'Basic ' + $encodedCredential; Accept = 'application/json' }

$project = Invoke-Jira -Method Get -Path "/rest/api/3/project/$ProjectKey"
$projectId = [string]$project.id
$targetJql = "project = $ProjectKey AND labels = $PhaseLabel ORDER BY key ASC"
$targetIssues = @(Get-IssuesByJql -Jql $targetJql)

if ($targetIssues.Count -ne 72) {
    throw "Safety check failed: expected exactly 72 '$PhaseLabel' issues, found $($targetIssues.Count)."
}
if (@($targetIssues | Where-Object { $PhaseLabel -notin @($_.fields.labels) }).Count -ne 0) {
    throw "Safety check failed: at least one selected issue does not have '$PhaseLabel'."
}

$workflowPath = "/rest/api/3/workflows/search?projectId=$projectId&scope=PROJECT&expand=values.transitions&maxResults=50"
$workflowSearch = Invoke-Jira -Method Get -Path $workflowPath
if (@($workflowSearch.values).Count -ne 1) {
    throw "Expected one project workflow for $ProjectKey, found $(@($workflowSearch.values).Count)."
}
$workflow = @($workflowSearch.values)[0]
if (-not $workflow.isEditable) {
    throw "The $ProjectKey workflow is not editable."
}

$backlogStatus = @($workflowSearch.statuses | Where-Object { $_.name -eq 'Backlog' }) | Select-Object -First 1
if ($null -eq $backlogStatus) {
    $backlogReference = [guid]::NewGuid().ToString()

    $statusUpdates = @(
        $workflowSearch.statuses | ForEach-Object {
            [ordered]@{
                id = $_.id
                statusReference = $_.statusReference
                name = $_.name
                description = $_.description
                statusCategory = $_.statusCategory
            }
        }
    )
    $statusUpdates += [ordered]@{
        statusReference = $backlogReference
        name = 'Backlog'
        description = 'Deferred tokenized-stock work outside the current lending focus.'
        statusCategory = 'TODO'
    }

    $workflowStatuses = @(
        $workflow.statuses | ForEach-Object {
            [ordered]@{
                statusReference = $_.statusReference
                layout = if ($null -ne $_.layout) { $_.layout } else { @{} }
                properties = if ($null -ne $_.properties) { $_.properties } else { @{} }
            }
        }
    )
    $workflowStatuses += [ordered]@{
        statusReference = $backlogReference
        layout = @{}
        properties = @{}
    }

    $workflowTransitions = @($workflow.transitions | ForEach-Object { Copy-TransitionForUpdate -Transition $_ })
    $numericTransitionIds = @($workflow.transitions.id | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })
    $backlogTransitionId = if ($numericTransitionIds.Count -gt 0) {
        [string](($numericTransitionIds | Measure-Object -Maximum).Maximum + 10)
    }
    else {
        '51'
    }
    $workflowTransitions += [ordered]@{
        id = $backlogTransitionId
        type = 'GLOBAL'
        toStatusReference = $backlogReference
        links = @()
        name = 'Backlog'
        description = 'Move this work item to the deferred backlog.'
        actions = @()
        validators = @()
        triggers = @()
        properties = @{}
    }

    $workflowUpdate = [ordered]@{
        id = $workflow.id
        description = $workflow.description
        startPointLayout = if ($null -ne $workflow.startPointLayout) { $workflow.startPointLayout } else { @{} }
        statuses = $workflowStatuses
        transitions = $workflowTransitions
        version = $workflow.version
    }
    $payload = [ordered]@{
        statuses = $statusUpdates
        workflows = @($workflowUpdate)
    }

    $validation = Invoke-Jira -Method Post -Path '/rest/api/3/workflows/update/validation' -Body @{
        payload = $payload
        validationOptions = @{ levels = @('ERROR', 'WARNING') }
    }
    if (@($validation.errors).Count -gt 0) {
        throw "Workflow validation failed: $($validation.errors | ConvertTo-Json -Depth 20 -Compress)"
    }

    $update = Invoke-Jira -Method Post -Path '/rest/api/3/workflows/update' -Body $payload
    if ($update.taskId) {
        $null = Wait-JiraTask -TaskId ([string]$update.taskId)
    }

    $workflowSearch = Invoke-Jira -Method Get -Path $workflowPath
    $backlogStatus = @($workflowSearch.statuses | Where-Object { $_.name -eq 'Backlog' }) | Select-Object -First 1
    if ($null -eq $backlogStatus) {
        throw 'Backlog status was not present after the workflow update completed.'
    }
}

$notBacklogged = @($targetIssues | Where-Object { $_.fields.status.name -ne 'Backlog' })
if ($notBacklogged.Count -gt 0) {
    $keys = @($notBacklogged.key)
    $availablePath = '/rest/api/3/bulk/issues/transition?issueIdsOrKeys=' + [uri]::EscapeDataString($keys -join ',')
    $available = Invoke-Jira -Method Get -Path $availablePath
    $backlogTransitions = @(
        @(
            foreach ($group in @($available.availableTransitions)) {
                foreach ($transition in @($group.transitions)) {
                    if ($transition.to.statusName -eq 'Backlog') {
                        [string]$transition.transitionId
                    }
                }
            }
        ) | Sort-Object -Unique
    )

    if ($backlogTransitions.Count -ne 1) {
        throw "Expected one common Backlog transition, found $($backlogTransitions.Count)."
    }

    $bulkMove = Invoke-Jira -Method Post -Path '/rest/api/3/bulk/issues/transition' -Body @{
        bulkTransitionInputs = @(@{
            selectedIssueIdsOrKeys = $keys
            transitionId = $backlogTransitions[0]
        })
        sendBulkNotification = $false
    }
    $null = Wait-JiraTask -TaskId ([string]$bulkMove.taskId)
}

$afterTargets = @(Get-IssuesByJql -Jql $targetJql)
$wrongTargetStatus = @($afterTargets | Where-Object { $_.fields.status.name -ne 'Backlog' })
$nonTargetsInBacklog = @(Get-IssuesByJql -Jql "project = $ProjectKey AND status = Backlog AND (labels != $PhaseLabel OR labels IS EMPTY)")

if ($afterTargets.Count -ne 72 -or $wrongTargetStatus.Count -ne 0 -or $nonTargetsInBacklog.Count -ne 0) {
    throw "Post-move verification failed: target=$($afterTargets.Count), wrongStatus=$($wrongTargetStatus.Count), nonTargetBacklog=$($nonTargetsInBacklog.Count)."
}

[pscustomobject]@{
    project = $ProjectKey
    backlog_status_id = $backlogStatus.id
    moved_ticket_count = $afterTargets.Count
    epics = @($afterTargets | Where-Object { $_.fields.issuetype.name -eq 'Epic' }).Count
    children = @($afterTargets | Where-Object { $_.fields.issuetype.name -ne 'Epic' }).Count
    non_target_tickets_in_backlog = $nonTargetsInBacklog.Count
    selector = "project = $ProjectKey AND labels = $PhaseLabel"
} | ConvertTo-Json -Depth 5
