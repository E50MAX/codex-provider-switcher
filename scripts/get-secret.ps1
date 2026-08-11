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
$secretInfo = [System.IO.FileInfo]::new($SecretPath)
if ($secretInfo.Length -le 0 -or $secretInfo.Length -gt 64KB) {
    throw 'Encrypted secret file has an invalid size.'
}

$configText = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8)
$managedBegin = '# >>> codex-provider-switcher: ' + $ProviderId + ' >>>'
$managedEnd = '# <<< codex-provider-switcher: ' + $ProviderId + ' <<<'
$managedBeginPattern = '(?m)^\s*' + [System.Text.RegularExpressions.Regex]::Escape($managedBegin) + '\s*$'
$managedEndPattern = '(?m)^\s*' + [System.Text.RegularExpressions.Regex]::Escape($managedEnd) + '\s*$'
$managedBeginMatches = [System.Text.RegularExpressions.Regex]::Matches($configText, $managedBeginPattern)
$managedEndMatches = [System.Text.RegularExpressions.Regex]::Matches($configText, $managedEndPattern)
if ($managedBeginMatches.Count -ne 1 -or $managedEndMatches.Count -ne 1 -or
    $managedEndMatches[0].Index -le $managedBeginMatches[0].Index) {
    throw 'Managed provider markers are missing or ambiguous.'
}

$firstTableMatch = [System.Text.RegularExpressions.Regex]::Match($configText, '(?m)^\s*\[')
$topLevelText = if ($firstTableMatch.Success) {
    $configText.Substring(0, $firstTableMatch.Index)
}
else {
    $configText
}
$modelProviderPattern = '(?m)^\s*model_provider\s*=\s*(?<value>"(?:\\.|[^"\\])*")\s*$'
$modelProviderMatches = [System.Text.RegularExpressions.Regex]::Matches($topLevelText, $modelProviderPattern)
if ($modelProviderMatches.Count -ne 1) {
    throw 'Active model provider is missing or ambiguous.'
}
$activeProvider = ConvertFrom-Json -InputObject $modelProviderMatches[0].Groups['value'].Value
if (-not [string]::Equals($activeProvider, $ProviderId, [System.StringComparison]::Ordinal)) {
    throw 'Managed provider is not the active model provider.'
}

$providerPattern = '(?ms)^\[model_providers\.' + [System.Text.RegularExpressions.Regex]::Escape($ProviderId) + '\]\s*(?<body>.*?)(?=^\[|\z)'
$providerMatches = [System.Text.RegularExpressions.Regex]::Matches($configText, $providerPattern)
if ($providerMatches.Count -ne 1) {
    throw 'Managed provider configuration was not found or is ambiguous.'
}
$providerMatch = $providerMatches[0]
if ($providerMatch.Index -le $managedBeginMatches[0].Index -or
    $providerMatch.Index -ge $managedEndMatches[0].Index) {
    throw 'Managed provider configuration is outside its integrity markers.'
}

$baseUrlPattern = '(?m)^\s*base_url\s*=\s*(?<value>"(?:\\.|[^"\\])*")\s*$'
$baseUrlMatches = [System.Text.RegularExpressions.Regex]::Matches($providerMatch.Groups['body'].Value, $baseUrlPattern)
if ($baseUrlMatches.Count -ne 1) {
    throw 'Managed provider Base URL was not found or is ambiguous.'
}
$baseUrlMatch = $baseUrlMatches[0]

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
