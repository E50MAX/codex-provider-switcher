param(
    [Parameter(Mandatory = $true)]
    [string]$SecretPath,

    [Parameter(Mandatory = $true)]
    [string]$Binding
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$bindingUri = $null
if (-not [System.Uri]::TryCreate($Binding, [System.UriKind]::Absolute, [ref]$bindingUri) -or
    $bindingUri.Scheme -ne [System.Uri]::UriSchemeHttps) {
    throw 'Secret binding must be an absolute HTTPS URL.'
}
$apiKey = [Console]::In.ReadToEnd().Trim()
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw 'API key is empty.'
}
if ($apiKey.Length -gt 8192 -or [System.Text.RegularExpressions.Regex]::IsMatch($apiKey, '\s')) {
    throw 'API key contains whitespace or has an invalid length.'
}

$directory = [System.IO.Path]::GetDirectoryName($SecretPath)
[System.IO.Directory]::CreateDirectory($directory) | Out-Null
$directoryAttributes = [System.IO.File]::GetAttributes($directory)
if (($directoryAttributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Refusing to store a secret inside a reparse-point directory.'
}
if ([System.IO.File]::Exists($SecretPath)) {
    $secretAttributes = [System.IO.File]::GetAttributes($SecretPath)
    if (($secretAttributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Refusing to replace a secret reparse point.'
    }
}

$plainBytes = $null
$bindingBytes = $null
$entropyBytes = $null
$encryptedBytes = $null
$sha256 = $null
$temporaryPath = "$SecretPath.$PID.$([System.Guid]::NewGuid().ToString('N')).tmp"

try {
    $plainBytes = [System.Text.Encoding]::UTF8.GetBytes($apiKey)
    $bindingBytes = [System.Text.Encoding]::UTF8.GetBytes("codex-provider-switcher:v2:$Binding")
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $entropyBytes = $sha256.ComputeHash($bindingBytes)
    $encryptedBytes = [System.Security.Cryptography.ProtectedData]::Protect(
        $plainBytes,
        $entropyBytes,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )

    [System.IO.File]::WriteAllBytes($temporaryPath, $encryptedBytes)
    if ([System.IO.File]::Exists($SecretPath)) {
        [System.IO.File]::Replace($temporaryPath, $SecretPath, $null, $true)
    }
    else {
        [System.IO.File]::Move($temporaryPath, $SecretPath)
    }
}
finally {
    if ([System.IO.File]::Exists($temporaryPath)) {
        [System.IO.File]::Delete($temporaryPath)
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
    if ($encryptedBytes) {
        [Array]::Clear($encryptedBytes, 0, $encryptedBytes.Length)
    }
    if ($sha256) {
        $sha256.Dispose()
    }
    $apiKey = $null
}
