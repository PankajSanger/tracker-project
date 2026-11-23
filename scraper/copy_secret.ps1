# Copies one secret value to the clipboard WITHOUT printing it, so you can paste it into GitHub.
#   powershell -File scraper\copy_secret.ps1 GOOGLE_SERVICE_ACCOUNT_JSON
#   powershell -File scraper\copy_secret.ps1 APIFY_TOKEN      (any NAME=value line in scraper\.env)
param([Parameter(Mandatory = $true)][string]$Name)

$root = Split-Path -Parent $PSScriptRoot
if ($Name -eq "GOOGLE_SERVICE_ACCOUNT_JSON") {
    $key = Get-ChildItem -Path $root -Filter "command-center-*.json" -File | Select-Object -First 1
    if (-not $key) { $key = Get-Item (Join-Path $root "service_account.json") -ErrorAction SilentlyContinue }
    if (-not $key) { Write-Error "Service-account key file not found in $root"; exit 1 }
    $value = (Get-Content $key.FullName -Raw).Trim()
} else {
    $envFile = Join-Path $PSScriptRoot ".env"
    $line = Select-String -Path $envFile -Pattern "^$Name=" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $line) { Write-Error "$Name not found in scraper\.env"; exit 1 }
    $value = $line.Line.Substring($Name.Length + 1).Trim()
}
Set-Clipboard -Value $value
Write-Host "Copied $Name to the clipboard ($($value.Length) characters). Paste it into GitHub now."
