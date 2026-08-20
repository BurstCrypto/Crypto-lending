function ConvertTo-JiraBaseUrl {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $Value
    )

    $candidate = $Value.Trim()
    $uri = $null
    if (
        [string]::IsNullOrWhiteSpace($candidate) -or
        -not [Uri]::IsWellFormedUriString($candidate, [UriKind]::Absolute) -or
        -not [Uri]::TryCreate($candidate, [UriKind]::Absolute, [ref] $uri)
    ) {
        throw 'JIRA_URL must be a well-formed absolute HTTPS URL.'
    }

    if (
        $uri.Scheme -cne [Uri]::UriSchemeHttps -or
        [string]::IsNullOrWhiteSpace($uri.Host) -or
        -not [string]::IsNullOrEmpty($uri.UserInfo) -or
        -not [string]::IsNullOrEmpty($uri.Query) -or
        -not [string]::IsNullOrEmpty($uri.Fragment)
    ) {
        throw 'JIRA_URL must use HTTPS and must not contain user information, a query, or a fragment.'
    }

    return $uri.AbsoluteUri.TrimEnd('/')
}

function New-JiraRequestUri {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $BaseUrl,

        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    if ($Path -notmatch '^/(?!/)' -or $Path -match '[\r\n\\]') {
        throw 'Jira request paths must be single-slash, origin-relative paths.'
    }

    $baseUri = [Uri] (ConvertTo-JiraBaseUrl -Value $BaseUrl)
    $requestUri = $null
    if (-not [Uri]::TryCreate($baseUri.AbsoluteUri.TrimEnd('/') + $Path, [UriKind]::Absolute, [ref] $requestUri)) {
        throw 'Could not construct a valid Jira request URL.'
    }

    if (
        $requestUri.Scheme -cne $baseUri.Scheme -or
        $requestUri.IdnHost -cne $baseUri.IdnHost -or
        $requestUri.Port -ne $baseUri.Port -or
        -not [string]::IsNullOrEmpty($requestUri.UserInfo) -or
        -not [string]::IsNullOrEmpty($requestUri.Fragment)
    ) {
        throw 'Jira request paths must remain on the configured Jira origin.'
    }

    return $requestUri.AbsoluteUri
}

function Invoke-JiraRestMethodNoRedirect {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary] $Parameters
    )

    $requestParameters = @{}
    foreach ($entry in $Parameters.GetEnumerator()) {
        $requestParameters[$entry.Key] = $entry.Value
    }
    $requestParameters.MaximumRedirection = 0

    return Invoke-RestMethod @requestParameters
}
