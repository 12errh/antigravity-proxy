<#
.SYNOPSIS
  Antigravity Proxy - Launcher.
.DESCRIPTION
  Checks prerequisites, installs deps, generates certs, starts the proxy.
  All configuration (providers, API keys, models, pricing) is done from the dashboard at http://localhost:4000
#>

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $PSCommandPath
$ProxyDir = Join-Path $ScriptDir 'proxy'

# -- Color helpers ------------------------------------------------------------
function Write-Info  { Write-Host "  $args" -Foreground Cyan }
function Write-Ok    { Write-Host "  OK $args" -Foreground Green }
function Write-Warn  { Write-Host "  !! $args" -Foreground Yellow }
function Write-Err   { Write-Host "  XX $args" -Foreground Red }
function Write-Step  { Write-Host "`n==> $args" -Foreground Magenta }

# -- Admin check --------------------------------------------------------------
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
  Write-Warn "Proxy needs Administrator privileges to bind port 443."
  $choice = Read-Host "Restart as Administrator? (Y/n)"
  if ($choice -ne 'n' -and $choice -ne 'N') {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoExit -Command Set-Location '$ScriptDir'; & '$PSCommandPath'"
    exit
  }
  Write-Warn "Running without Admin rights - port 443 may fail."
}

# -- Prerequisites ------------------------------------------------------------
Write-Step "Checking prerequisites"
$node = Get-Command 'node' -ErrorAction SilentlyContinue
if (-not $node) { Write-Err "Node.js not found. Install from https://nodejs.org"; exit 1 }
$npm = Get-Command 'npm' -ErrorAction SilentlyContinue
if (-not $npm) { Write-Err "npm not found."; exit 1 }
Write-Ok "Node.js $($node.Version) / npm $(& $npm --version)"

Set-Location -LiteralPath $ProxyDir

# -- npm install --------------------------------------------------------------
Write-Step "Installing dependencies"
if (-not (Test-Path 'node_modules')) {
  npm install
  if ($LASTEXITCODE -ne 0) { Write-Err "npm install failed"; exit 1 }
  Write-Ok "Dependencies installed"
} else {
  Write-Ok "Dependencies already installed (delete node_modules to reinstall)"
}

# -- Certificates -------------------------------------------------------------
$certDir = Join-Path $ProxyDir 'certs'
$certFile = Join-Path $certDir 'cert.pem'
if (-not (Test-Path $certFile)) {
  Write-Step "Generating TLS certificates"
  if (-not (Test-Path $certDir)) { New-Item -ItemType Directory -Path $certDir -Force | Out-Null }
  & node scripts/gen-certs.mjs
  if ($LASTEXITCODE -ne 0) { Write-Err "Certificate generation failed"; exit 1 }
  Write-Ok "Certificates generated"
} else {
  Write-Ok "Certificates exist"
}

# Install self-signed cert into Windows Trusted Root store so Antigravity TLS verification passes
Write-Step "Installing certificate to Windows Trusted Root store"
# Compute SHA-1 thumbprint from PEM for duplicate check
$lines = Get-Content $certFile -Encoding utf8
$b64 = ($lines | Where-Object { $_ -notmatch '^-' }) -join ''
$derBytes = [Convert]::FromBase64String($b64)
$sha1 = [System.Security.Cryptography.SHA1]::Create().ComputeHash($derBytes)
$thumbprint = [System.BitConverter]::ToString($sha1) -replace '-', ''
$alreadyTrusted = Get-ChildItem Cert:\LocalMachine\Root -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $thumbprint }
if (-not $alreadyTrusted) {
  try {
    Import-Certificate -FilePath $certFile -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
    Write-Ok "Certificate installed to Trusted Root store"
  } catch {
    Write-Warn "Could not install certificate (may already be trusted)."
    Write-Warn "If Antigravity shows a TLS error, run as Administrator:"
    Write-Warn "  certutil -addstore -f Root '$certFile'"
  }
} else {
  Write-Ok "Certificate already trusted"
}

# -- Kill old proxy -----------------------------------------------------------
# Use Get-NetTCPConnection (more reliable than netstat parsing).
# Check BOTH ports: 443 (TLS proxy) AND 4000 (dashboard) so a half-dead
# instance on either port is caught before we try to bind.
$oldPids = @(Get-NetTCPConnection -State Listen -LocalPort 4000,443 -ErrorAction SilentlyContinue `
              | Select-Object -ExpandProperty OwningProcess -Unique `
              | Where-Object { $_ -ne 0 -and $_ -ne $PID })
if ($oldPids.Count -gt 0) {
  Write-Step "Stopping old proxy process(es) (PIDs: $($oldPids -join ', '))"
  foreach ($p in $oldPids) {
    taskkill /F /PID $p 2>$null
  }
  Start-Sleep -Seconds 1
  Write-Ok "Old proxy stopped"
}

# -- Start proxy --------------------------------------------------------------
Write-Step "Starting proxy"
$logDir = Join-Path $ProxyDir 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir "proxy_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"
$logArgs = @("-NoExit", "-Command", "cd '$ProxyDir'; tsx src/index.ts 2>&1 | Tee-Object -FilePath '$logFile'")

# Only request UAC elevation if we're not already admin.
# The old code always used -Verb RunAs, which triggers a SECOND UAC prompt
# even when the user is already elevated, spawning a separate admin process
# that loses the original env / cert store state.
$startArgs = @{
  FilePath     = 'powershell'
  WindowStyle  = 'Normal'
  ArgumentList = $logArgs
  PassThru     = $true
}
if (-not $IsAdmin) {
  $startArgs['Verb'] = 'RunAs'
}
try {
  $proc = Start-Process @startArgs
  Write-Ok "Proxy starting (PID $($proc.Id)) - log: $logFile"
} catch {
  Write-Err "Failed to start proxy: $_"
  exit 1
}

Start-Sleep -Seconds 3

# -- Open Dashboard in browser ------------------------------------------------
$portOpen = $false
for ($i = 0; $i -lt 10; $i++) {
  $portOpen = ((netstat -ano | Select-String ':4000\s') -ne $null)
  if ($portOpen) { break }
  Start-Sleep -Milliseconds 500
}
if ($portOpen) {
  try {
    Start-Process "http://localhost:4000" | Out-Null
    Write-Ok "Dashboard opened in your default browser."
  } catch {
    Write-Warn "Could not open browser automatically. Visit http://localhost:4000 manually."
  }
} else {
  Write-Warn "Dashboard not yet ready. Visit http://localhost:4000 in a few seconds."
}

# -- Launch Antigravity -------------------------------------------------------
Write-Step "Launching Antigravity"
$antigravityPaths = @(
  "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe",
  "$env:ProgramFiles\Antigravity\Antigravity.exe",
  "${env:ProgramFiles(x86)}\Antigravity\Antigravity.exe"
)
$antigravityPath = $null
foreach ($p in $antigravityPaths) {
  if (Test-Path $p) { $antigravityPath = $p; break }
}
if ($antigravityPath) {
  Start-Process $antigravityPath
  Write-Ok "Antigravity launched!"
} else {
  Write-Warn "Antigravity not found at default paths. Launch it manually."
}

# -- Summary ------------------------------------------------------------------
Write-Step "Ready!"
Write-Info "  Dashboard: http://localhost:4000"
Write-Info "  Proxy:     https://localhost:443 (TLS)"
Write-Info "  Logs:      $logFile"
Write-Info ""
Write-Info "  Configure providers, API keys, models, and pricing from the dashboard."
Write-Info "  Press Ctrl+C in the proxy window to stop."
