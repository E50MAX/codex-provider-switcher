param(
    [Parameter(Mandatory = $true)]
    [string]$SecretPath,

    [Parameter(Mandatory = $true)]
    [string]$Binding,

    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9_-]+$')]
    [string]$ProviderId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$bindingUri = $null
if (-not [System.Uri]::TryCreate($Binding, [System.UriKind]::Absolute, [ref]$bindingUri) -or
    $bindingUri.Scheme -ne [System.Uri]::UriSchemeHttps) {
    throw 'Secret binding must be an absolute HTTPS URL.'
}

foreach ($pathToCheck in @($SecretPath, $ConfigPath)) {
    if (-not [System.IO.File]::Exists($pathToCheck)) {
        throw "Required file not found: $pathToCheck"
    }
    $attributes = [System.IO.File]::GetAttributes($pathToCheck)
    if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to read a reparse point: $pathToCheck"
    }
}

$configInfo = [System.IO.FileInfo]::new($ConfigPath)
if ($configInfo.Length -gt 5MB) {
    throw 'Codex configuration file is unexpectedly large.'
}

$configText = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8)
$providerPattern = '(?ms)^\[model_providers\.' + [System.Text.RegularExpressions.Regex]::Escape($ProviderId) + '\]\s*(?<body>.*?)(?=^\[|\z)'
$providerMatch = [System.Text.RegularExpressions.Regex]::Match($configText, $providerPattern)
if (-not $providerMatch.Success) {
    throw 'Managed provider configuration was not found.'
}

$baseUrlPattern = '(?m)^\s*base_url\s*=\s*(?<value>"(?:\\.|[^"\\])*")\s*$'
$baseUrlMatch = [System.Text.RegularExpressions.Regex]::Match($providerMatch.Groups['body'].Value, $baseUrlPattern)
if (-not $baseUrlMatch.Success) {
    throw 'Managed provider Base URL was not found.'
}

$configuredBaseUrl = ConvertFrom-Json -InputObject $baseUrlMatch.Groups['value'].Value
if (-not [string]::Equals($configuredBaseUrl, $Binding, [System.StringComparison]::Ordinal)) {
    throw 'Provider Base URL does not match the encrypted key binding.'
}

$encryptedBytes = $null
$plainBytes = $null
$bindingBytes = $null
$entropyBytes = $null
$sha256 = $null
$apiKey = $null

try {
    $encryptedBytes = [System.IO.File]::ReadAllBytes($SecretPath)
    $bindingBytes = [System.Text.Encoding]::UTF8.GetBytes("codex-provider-switcher:v2:$Binding")
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $entropyBytes = $sha256.ComputeHash($bindingBytes)
    $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
        $encryptedBytes,
        $entropyBytes,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $apiKey = [System.Text.Encoding]::UTF8.GetString($plainBytes)
    if ([string]::IsNullOrWhiteSpace($apiKey) -or
        $apiKey.Length -gt 8192 -or
        [System.Text.RegularExpressions.Regex]::IsMatch($apiKey, '\s')) {
        throw 'Decrypted API key is invalid.'
    }
    [Console]::Out.Write($apiKey)
}
finally {
    if ($encryptedBytes) {
        [Array]::Clear($encryptedBytes, 0, $encryptedBytes.Length)
    }
    if ($plainBytes) {
        [Array]::Clear($plainBytes, 0, $plainBytes.Length)
    }
    if ($bindingBytes) {
        [Array]::Clear($bindingBytes, 0, $bindingBytes.Length)
    }
    if ($entropyBytes) {
        [Array]::Clear($entropyBytes, 0, $entropyBytes.Length)
    }
    if ($sha256) {
        $sha256.Dispose()
    }
    $apiKey = $null
}
