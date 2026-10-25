<#
.SYNOPSIS
  Installs X Growth for the current Windows user. No admin rights needed.

.DESCRIPTION
  Grok Bot runs this on the user's computer (the user approves it). It:
    1. installs Bun for this user if it's missing
    2. downloads the latest release bundle for win-x64 and verifies its SHA-256
    3. unpacks it to %LOCALAPPDATA%\XGrowth\app (data lives next to it in
       %LOCALAPPDATA%\XGrowth\data, which updates never touch)
    4. runs `xstats setup`, `xstats autostart enable` and `xstats start`
    5. opens http://127.0.0.1:3000/setup in the default browser
  See install/README.md.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/karthi-98/x-growth/releases/latest/download/install.ps1 | iex"

.EXAMPLE
  & ([scriptblock]::Create((irm https://github.com/karthi-98/x-growth/releases/latest/download/install.ps1))) -Handle designwkarthick -TimeZone Asia/Kolkata -Json
#>
[CmdletBinding()]
param(
  # Release to install: "latest" or a version like 0.2.0.
  [string]$Version = "latest",
  # Folder that gets app\ and data\.
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "XGrowth"),
  # Port on 127.0.0.1 (default 3000, or whatever was used before).
  [int]$Port = 0,
  # Passed to `xstats setup`.
  [string]$Handle,
  [string]$TimeZone,
  # Install this bundle instead of downloading one (SHA256SUMS must sit next to it).
  [string]$FromFile,
  [switch]$NoAutostart,
  [switch]$NoStart,
  [switch]$NoOpen,
  # Print one JSON object at the end (for Grok Bot).
  [switch]$Json
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # Invoke-WebRequest is many times slower with the progress bar.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = "karthi-98/x-growth"
$Platform = "win-x64"

function Step([string]$Message) { if (-not $Json) { Write-Host "==> $Message" -ForegroundColor Cyan } }

function Find-Bun {
  $cmd = Get-Command bun.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $default = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
  if (Test-Path -LiteralPath $default) { return $default }
  return $null
}

if (-not [Environment]::Is64BitOperatingSystem) { throw "X Growth needs 64-bit Windows." }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("xgrowth-install-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  # 1. Bun --------------------------------------------------------------------
  $bun = Find-Bun
  if (-not $bun) {
    Step "Installing Bun for this user (no admin needed)"
    # A child PowerShell, so the Bun installer's own exit can't end this script.
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm https://bun.sh/install.ps1 | iex" | Out-Host
    $bun = Find-Bun
    if (-not $bun) { throw "Bun did not install. Install it from https://bun.sh, then run this again." }
  }
  Step "Using Bun $(& $bun --version) at $bun"

  # 2. Download and verify ---------------------------------------------------------
  if ($FromFile) {
    $archive = (Resolve-Path -LiteralPath $FromFile).Path
    $sumsFile = Join-Path (Split-Path -Parent $archive) "SHA256SUMS"
  } else {
    $api = if ($Version -eq "latest") { "https://api.github.com/repos/$Repo/releases/latest" } else { "https://api.github.com/repos/$Repo/releases/tags/v$($Version.TrimStart('v'))" }
    $release = Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = "x-growth-installer"; "Accept" = "application/vnd.github+json" }
    $assetName = "x-growth-$($release.tag_name.TrimStart('v'))-$Platform.zip"
    $asset = $release.assets | Where-Object { $_.name -eq $assetName }
    $sums = $release.assets | Where-Object { $_.name -eq "SHA256SUMS" }
    if (-not $asset -or -not $sums) { throw "Release $($release.tag_name) has no $assetName or SHA256SUMS." }
    $archive = Join-Path $tmp $assetName
    $sumsFile = Join-Path $tmp "SHA256SUMS"
    Step "Downloading $assetName ($([math]::Round($asset.size / 1MB, 1)) MB)"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archive -UseBasicParsing
    Invoke-WebRequest -Uri $sums.browser_download_url -OutFile $sumsFile -UseBasicParsing
  }
  $name = Split-Path -Leaf $archive
  if (-not (Test-Path -LiteralPath $sumsFile)) { throw "No SHA256SUMS next to $name; refusing to install it unverified." }
  $expected = $null
  foreach ($line in Get-Content -LiteralPath $sumsFile) {
    if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$' -and $Matches[2] -eq $name) { $expected = $Matches[1].ToLowerInvariant() }
  }
  if (-not $expected) { throw "SHA256SUMS has no entry for $name." }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Checksum mismatch for $name (expected $expected, got $actual). Nothing was installed." }
  Step "Checksum verified"

  # 3. Unpack ------------------------------------------------------------------
  $app = Join-Path $InstallDir "app"
  $data = Join-Path $InstallDir "data"
  $staging = Join-Path $InstallDir "app.new"
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  New-Item -ItemType Directory -Path $staging | Out-Null
  Step "Unpacking to $app"
  $tar = Join-Path $env:SystemRoot "System32\tar.exe"
  if (Test-Path -LiteralPath $tar) {
    & $tar -xf $archive -C $staging
    if ($LASTEXITCODE -ne 0) { throw "Could not unpack $name." }
  } else {
    Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force
  }
  $releaseFile = Join-Path $staging "release.json"
  if (-not (Test-Path -LiteralPath $releaseFile)) { throw "$name is not an X Growth bundle." }
  $installed = Get-Content -Raw -LiteralPath $releaseFile | ConvertFrom-Json
  if ($installed.platform -ne $Platform) { throw "$name is for $($installed.platform), not $Platform." }

  if (Test-Path -LiteralPath $app) {
    # Reinstalling: stop the running copy, swap folders, keep data.
    Step "Replacing the installed app (your data stays)"
    $oldCli = Join-Path $app "xstats.js"
    if (Test-Path -LiteralPath $oldCli) { & $bun $oldCli stop | Out-Null }
    $old = Join-Path $InstallDir "app.old"
    if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force }
    Rename-Item -LiteralPath $app -NewName "app.old"
    Rename-Item -LiteralPath $staging -NewName "app"
    Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Rename-Item -LiteralPath $staging -NewName "app"
  }

  # 4. Set up, start at login, start ---------------------------------------------
  $env:XSTATS_DATA_DIR = $data
  $cli = Join-Path $app "xstats.js"

  Step "Setting up the data folder"
  $setupArgs = @("setup")
  if ($Handle) { $setupArgs += @("--handle", $Handle) }
  if ($TimeZone) { $setupArgs += @("--timezone", $TimeZone) }
  & $bun $cli @setupArgs | Out-Host
  $setupOk = $LASTEXITCODE -eq 0
  if (-not $setupOk) { Write-Warning "xstats setup did not finish (exit $LASTEXITCODE). The app still starts; run `"$app\xstats.cmd`" setup again later." }

  $autostart = $false
  if (-not $NoAutostart) {
    Step "Starting X Growth at login"
    & $bun $cli autostart enable | Out-Host
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not set up start at login; turn it on later in Settings > App." } else { $autostart = $true }
  }

  $url = $null
  if (-not $NoStart) {
    Step "Starting X Growth"
    $startArgs = @("start", "--detach", "--json")
    if ($Port -gt 0) { $startArgs += @("--port", "$Port") }
    $out = & $bun $cli @startArgs
    if ($LASTEXITCODE -ne 0) { throw "X Growth did not start: $($out -join ' '). Logs: $data\logs\xstats.log" }
    $started = ($out | Select-Object -Last 1) | ConvertFrom-Json
    $url = "$($started.url)/setup"
    if (-not $NoOpen) { Start-Process $url }
  }

  if ($Json) {
    [ordered]@{
      status = "installed"; version = $installed.version; app = $app; data = $data; inbox = (Join-Path $data "inbox")
      cli = (Join-Path $app "xstats.cmd"); url = $url; setup = $setupOk; autostart = $autostart
    } | ConvertTo-Json -Compress
  } else {
    Write-Host ""
    Write-Host "X Growth $($installed.version) is installed." -ForegroundColor Green
    Write-Host "  App:    $app"
    Write-Host "  Data:   $data"
    if ($url) { Write-Host "  Open:   $url" }
    Write-Host "  CLI:    `"$app\xstats.cmd`" help"
  }
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
