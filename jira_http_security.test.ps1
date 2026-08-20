[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$helperPath = Join-Path $PSScriptRoot 'jira_http.ps1'
$jiraScripts = @(
    (Join-Path $PSScriptRoot 'jira_import.ps1'),
    (Join-Path $PSScriptRoot 'jira_backlog_update.ps1')
)
$passed = 0

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

function Assert-RejectedBaseUrl {
    param([string] $Value)

    try {
        $null = ConvertTo-JiraBaseUrl -Value $Value
        throw "Expected Jira base URL rejection."
    }
    catch {
        Assert-Condition -Condition ($_.Exception.Message -match '^JIRA_URL must') -Message "Unexpected rejection for an unsafe Jira URL."
    }
}

if (-not (Test-Path -LiteralPath $helperPath -PathType Leaf)) {
    throw "Jira HTTP helper under test was not found: $helperPath"
}
foreach ($scriptPath in $jiraScripts) {
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        throw "Jira script under test was not found: $scriptPath"
    }
}

. $helperPath

Invoke-FocusedTest 'accepts and normalizes absolute HTTPS Jira base URLs' {
    Assert-Condition -Condition ((ConvertTo-JiraBaseUrl 'https://team.atlassian.net/') -ceq 'https://team.atlassian.net') -Message 'Root Jira URL was not normalized.'
    Assert-Condition -Condition ((ConvertTo-JiraBaseUrl 'https://jira.example.test:8443/context/') -ceq 'https://jira.example.test:8443/context') -Message 'Context-path Jira URL was not normalized.'
}

Invoke-FocusedTest 'rejects non-HTTPS, relative, credential-bearing, query, and fragment Jira URLs' {
    foreach ($unsafeUrl in @(
            'http://team.atlassian.net',
            'team.atlassian.net',
            '//team.atlassian.net',
            'https://user:token@team.atlassian.net',
            'https://team.atlassian.net?redirect=https://example.test',
            'https://team.atlassian.net#token'
        )) {
        Assert-RejectedBaseUrl -Value $unsafeUrl
    }
}

Invoke-FocusedTest 'constructs only same-origin Jira request URLs' {
    $requestUrl = New-JiraRequestUri -BaseUrl 'https://jira.example.test:8443/context' -Path '/rest/api/3/project/KAN?expand=description'
    Assert-Condition -Condition ($requestUrl -ceq 'https://jira.example.test:8443/context/rest/api/3/project/KAN?expand=description') -Message 'Safe Jira request URL was not constructed correctly.'

    foreach ($unsafePath in @('//attacker.example/rest', 'https://attacker.example/rest', '/rest\attacker', "/rest`nHost: attacker.example")) {
        try {
            $null = New-JiraRequestUri -BaseUrl 'https://jira.example.test' -Path $unsafePath
            throw 'Expected unsafe Jira request path rejection.'
        }
        catch {
            Assert-Condition -Condition ($_.Exception.Message -match '^Jira request paths must') -Message 'Unexpected request-path rejection.'
        }
    }
}

Invoke-FocusedTest 'forces zero redirects on token-bearing REST requests' {
    $script:capturedRequest = $null
    function Invoke-RestMethod {
        param(
            [string] $Uri,
            [System.Collections.IDictionary] $Headers,
            [string] $Method,
            [int] $MaximumRedirection
        )

        $script:capturedRequest = @{
            Uri = $Uri
            Headers = $Headers
            Method = $Method
            MaximumRedirection = $MaximumRedirection
        }
        return @{ ok = $true }
    }

    $headers = @{ Authorization = 'Basic test-only-placeholder'; Accept = 'application/json' }
    $result = Invoke-JiraRestMethodNoRedirect -Parameters @{
        Uri = 'https://jira.example.test/rest/api/3/project/KAN'
        Headers = $headers
        Method = 'Get'
    }

    Assert-Condition -Condition ($result.ok -eq $true) -Message 'Mock Jira request result was not returned.'
    Assert-Condition -Condition ($script:capturedRequest.MaximumRedirection -eq 0) -Message 'Jira request did not disable redirects.'
    Assert-Condition -Condition ($script:capturedRequest.Uri -ceq 'https://jira.example.test/rest/api/3/project/KAN') -Message 'Jira request URI changed unexpectedly.'
    Assert-Condition -Condition ($script:capturedRequest.Headers.Authorization -ceq 'Basic test-only-placeholder') -Message 'Jira Authorization header was not forwarded to the initial request.'
}

Invoke-FocusedTest 'both Jira entry points use the shared validated no-redirect path' {
    foreach ($scriptPath in $jiraScripts) {
        $source = Get-Content -LiteralPath $scriptPath -Raw
        Assert-Condition -Condition ($source -match "\. \(Join-Path \`$PSScriptRoot 'jira_http\.ps1'\)") -Message "$scriptPath does not load the shared Jira helper."
        Assert-Condition -Condition ($source -match 'ConvertTo-JiraBaseUrl -Value') -Message "$scriptPath does not validate JIRA_URL."
        Assert-Condition -Condition ($source -match 'New-JiraRequestUri -BaseUrl') -Message "$scriptPath does not constrain request URLs."
        Assert-Condition -Condition ($source -match 'Invoke-JiraRestMethodNoRedirect -Parameters') -Message "$scriptPath does not disable redirects."
        Assert-Condition -Condition ($source -notmatch '(?m)^\s*return\s+Invoke-RestMethod\b') -Message "$scriptPath bypasses the shared no-redirect request helper."
    }
}

Write-Host "Jira HTTP security focused tests passed: $passed"
Write-Host 'Network requests made: 0'
