<#
.SYNOPSIS
  Builds the NodeDR POS Windows installer (nodedr-pos-setup-<version>-x64.exe).

.DESCRIPTION
  MUST run on Windows. The application uses two native Node addons
  (better-sqlite3, usb) whose binaries are platform- and ABI-specific, so the
  payload is assembled by a real `npm ci` on Windows rather than cross-built
  from Linux — npm then fetches the correct win32-x64 prebuilds automatically,
  and `prisma generate` produces Windows query/schema engines.

  Nothing here touches the Docker deployment or the Debian packaging.

.EXAMPLE
  pwsh -File packaging\windows\build-windows.ps1 -Version 1.0.0
#>
[CmdletBinding()]
param(
  [string]$Version      = "1.0.0",
  [string]$NodeVersion  = "26.5.0",
  [string]$WinswVersion = "2.12.0",
  # Baked into the Next.js routes manifest at build time — see the note below.
  [int]$BackendPort     = 4000,
  [int]$FrontendPort    = 1994,
  [string]$OutDir       = "dist",
  [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }
function Ok($m)   { Write-Host "    [ok] $m" -ForegroundColor Green }
function Die($m)  { Write-Host "`nERROR: $m" -ForegroundColor Red; exit 1 }

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$PkgDir   = $PSScriptRoot
$Work     = Join-Path ([System.IO.Path]::GetTempPath()) "nodedr-pos-win-$(Get-Random)"
$Stage    = Join-Path $Work "stage"
$OutPath  = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $RepoRoot $OutDir }

New-Item -ItemType Directory -Force -Path $Stage, $OutPath | Out-Null

Step "Preflight"
Info "repo      $RepoRoot"
Info "version   $Version"
Info "node      $NodeVersion (win-x64)"
Info "ports     web $FrontendPort, api (loopback) $BackendPort"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "node is required on PATH to bootstrap the build" }

# ---------------------------------------------------------------------------
# 1. Node.js runtime
# ---------------------------------------------------------------------------
Step "Fetching the Node.js runtime"
$NodeZip  = "node-v$NodeVersion-win-x64.zip"
$NodeUrl  = "https://nodejs.org/dist/v$NodeVersion/$NodeZip"
$NodeDl   = Join-Path $Work $NodeZip

Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeDl -UseBasicParsing

# Verify against upstream's published checksums — this is the one artefact in
# the installer that is not built from source here, so it does not go in
# unverified.
$Shasums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
$Expected = ($Shasums -split "`n" | Where-Object { $_ -match [regex]::Escape($NodeZip) } | Select-Object -First 1) -split '\s+' | Select-Object -First 1
if (-not $Expected) { Die "$NodeZip is not listed in upstream SHASUMS256.txt" }
$Actual = (Get-FileHash -Path $NodeDl -Algorithm SHA256).Hash.ToLower()
if ($Actual -ne $Expected.ToLower()) { Die "checksum mismatch for $NodeZip`n  expected $Expected`n  actual   $Actual" }
Ok "checksum verified"

Expand-Archive -Path $NodeDl -DestinationPath $Work -Force
$NodeHome = Join-Path $Work "node-v$NodeVersion-win-x64"
$NodeExe  = Join-Path $NodeHome "node.exe"
if (-not (Test-Path $NodeExe)) { Die "extracted runtime has no node.exe" }

# Build with the bundled runtime so the native addons match the ABI of the
# node.exe that actually ships. This is the whole reason it is bundled.
$env:PATH = "$NodeHome;$env:PATH"
$env:npm_config_update_notifier = "false"
$env:NPM_CONFIG_FUND  = "false"
$env:NPM_CONFIG_AUDIT = "false"
$env:NEXT_TELEMETRY_DISABLED = "1"
$env:CHECKPOINT_DISABLE = "1"
$env:CI = "1"
Ok "node $(& $NodeExe -v), abi $(& $NodeExe -p 'process.versions.modules')"

# ---------------------------------------------------------------------------
# 2. Backend
# ---------------------------------------------------------------------------
Step "Building the backend"
Push-Location (Join-Path $RepoRoot "backend")
try {
  # Dev deps are kept deliberately: the only one is the Prisma CLI, which the
  # installer needs to apply migrations at install and upgrade time.
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Die "backend npm ci failed" }

  Info "generating the Prisma client"
  & npx --no-install prisma generate
  if ($LASTEXITCODE -ne 0) { Die "prisma generate failed" }

  # The native addons are the single most likely thing to break this build, and
  # they fail at *runtime* rather than install time if the ABI is wrong. Prove
  # they load under the exact node.exe that will ship.
  Info "verifying native modules load under the bundled runtime"
  & $NodeExe -e @"
const mods = ['better-sqlite3','usb','@prisma/client','@prisma/adapter-better-sqlite3'];
for (const m of mods) {
  try { require(m); } catch (e) { console.error('FAILED ' + m + ': ' + e.message); process.exit(1); }
}
console.log('  all native modules loaded');
"@
  if ($LASTEXITCODE -ne 0) { Die "a required native module does not load on Windows" }
  Ok "backend built and verified"
} finally { Pop-Location }

# ---------------------------------------------------------------------------
# 3. Frontend
# ---------------------------------------------------------------------------
Step "Building the frontend (Next.js production build)"
Push-Location (Join-Path $RepoRoot "frontend")
try {
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Die "frontend npm ci failed" }

  # CRITICAL: Next.js resolves rewrite destinations at BUILD time into the
  # routes manifest — a runtime BACKEND_URL is silently ignored and the proxy
  # falls back to its default, so every /api call would 502.
  $env:BACKEND_URL = "http://127.0.0.1:$BackendPort"
  Info "baking API proxy destination: $env:BACKEND_URL"
  & npm run build
  if ($LASTEXITCODE -ne 0) { Die "next build failed" }

  if (-not (Test-Path ".next\standalone")) { Die "Next.js did not produce .next\standalone — is output:'standalone' still set in next.config.ts?" }

  # Prove the destination actually landed in the manifest rather than trusting
  # that the env var was picked up.
  $manifest = Get-Content ".next\routes-manifest.json" -Raw
  if ($manifest -notmatch [regex]::Escape("127.0.0.1:$BackendPort")) {
    Die "the /api proxy destination was NOT baked into routes-manifest.json — the installer would 502 on every API call"
  }
  Ok "frontend built, /api proxy destination verified in the routes manifest"
} finally { Pop-Location }

# ---------------------------------------------------------------------------
# 4. Assemble the payload
# ---------------------------------------------------------------------------
Step "Assembling the payload"

$AppRuntime  = Join-Path $Stage "runtime"
$AppBackend  = Join-Path $Stage "backend"
$AppFrontend = Join-Path $Stage "frontend"
$AppService  = Join-Path $Stage "service"
$AppBin      = Join-Path $Stage "bin"
New-Item -ItemType Directory -Force -Path $AppRuntime,$AppBackend,$AppFrontend,$AppService,$AppBin | Out-Null

# Only node.exe — npm/npx are build-time tools and have no place on a till.
Copy-Item $NodeExe (Join-Path $AppRuntime "node.exe")
Copy-Item (Join-Path $NodeHome "LICENSE") (Join-Path $AppRuntime "LICENSE") -ErrorAction SilentlyContinue

$B = Join-Path $RepoRoot "backend"
Copy-Item (Join-Path $B "src")               (Join-Path $AppBackend "src")          -Recurse
Copy-Item (Join-Path $B "prisma")            (Join-Path $AppBackend "prisma")       -Recurse
Copy-Item (Join-Path $B "node_modules")      (Join-Path $AppBackend "node_modules") -Recurse
Copy-Item (Join-Path $B "package.json")      (Join-Path $AppBackend "package.json")
# Prisma 7 keeps the Migrate connection URL here, not in schema.prisma. Omitting
# it produces a service that crash-loops on `migrate deploy`.
Copy-Item (Join-Path $B "prisma.config.js")  (Join-Path $AppBackend "prisma.config.js")
if (-not (Test-Path (Join-Path $AppBackend "prisma.config.js"))) { Die "prisma.config.js missing from the payload" }

$F = Join-Path $RepoRoot "frontend"
Copy-Item (Join-Path $F ".next\standalone\*") $AppFrontend -Recurse -Force
New-Item -ItemType Directory -Force -Path (Join-Path $AppFrontend ".next") | Out-Null
Copy-Item (Join-Path $F ".next\static") (Join-Path $AppFrontend ".next\static") -Recurse -Force
if (Test-Path (Join-Path $F "public")) {
  Copy-Item (Join-Path $F "public") (Join-Path $AppFrontend "public") -Recurse -Force
} else {
  New-Item -ItemType Directory -Force -Path (Join-Path $AppFrontend "public") | Out-Null
}
if (-not (Test-Path (Join-Path $AppFrontend "server.js"))) { Die "standalone server.js missing from the frontend payload" }

# --- Windows service wrapper ---
# WinSW turns a plain console process into a proper Windows service (starts
# before login, restarts on failure, logs to disk). The v2 build targets .NET
# Framework 4.6.1, which ships with every supported Windows 10/11 — no runtime
# for the shopkeeper to install.
Info "fetching WinSW $WinswVersion"
$WinswUrl = "https://github.com/winsw/winsw/releases/download/v$WinswVersion/WinSW-x64.exe"
$WinswDl  = Join-Path $Work "WinSW-x64.exe"
Invoke-WebRequest -Uri $WinswUrl -OutFile $WinswDl -UseBasicParsing
# WinSW derives its config filename from its own executable name, so each
# service gets its own renamed copy plus a matching .xml.
Copy-Item $WinswDl (Join-Path $AppService "nodedr-pos-backend.exe")
Copy-Item $WinswDl (Join-Path $AppService "nodedr-pos-frontend.exe")

foreach ($svc in @("backend","frontend")) {
  $xml = Get-Content (Join-Path $PkgDir "service\nodedr-pos-$svc.xml") -Raw
  $xml = $xml.Replace("@FRONTEND_PORT@", "$FrontendPort").Replace("@BACKEND_PORT@", "$BackendPort").Replace("@VERSION@", $Version)
  Set-Content -Path (Join-Path $AppService "nodedr-pos-$svc.xml") -Value $xml -Encoding UTF8
}

Copy-Item (Join-Path $PkgDir "nodedr-pos.cmd") (Join-Path $AppBin "nodedr-pos.cmd")

# --- Icon ---
$logo = Join-Path $RepoRoot "Nodedr pos logo.png"
$icon = Join-Path $Stage "nodedr-pos.ico"
if (Test-Path $logo) {
  # Prefer a real multi-resolution .ico; fall back to shipping without one
  # rather than failing the build over a cosmetic asset.
  try {
    Add-Type -AssemblyName System.Drawing
    $src = [System.Drawing.Image]::FromFile($logo)
    $bmp = New-Object System.Drawing.Bitmap 256,256
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($src, 0, 0, 256, 256)
    $g.Dispose(); $src.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $png = $ms.ToArray(); $ms.Dispose(); $bmp.Dispose()
    # Minimal ICO container wrapping a single 256x256 PNG frame.
    $fs = [System.IO.File]::Create($icon)
    $bw = New-Object System.IO.BinaryWriter($fs)
    $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
    $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$png.Length); $bw.Write([UInt32]22)
    $bw.Write($png); $bw.Flush(); $bw.Close(); $fs.Close()
    Ok "icon generated"
  } catch { Info "icon generation skipped: $($_.Exception.Message)" }
}

$payloadMb = [math]::Round((Get-ChildItem $Stage -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB)
Ok "payload assembled (~$payloadMb MB)"

# ---------------------------------------------------------------------------
# 5. Compile the installer
# ---------------------------------------------------------------------------
if ($SkipInstaller) { Info "installer compilation skipped (-SkipInstaller)"; Write-Host "`nStaged payload: $Stage"; exit 0 }

Step "Compiling the NSIS installer"
$makensis = (Get-Command makensis -ErrorAction SilentlyContinue)?.Source
if (-not $makensis) {
  # NSIS is not on PATH after a default install, and it is not part of the
  # GitHub windows-latest image either — check the usual install locations.
  $candidates = @(
    "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
    "$env:ProgramFiles\NSIS\makensis.exe",
    "$env:ChocolateyInstall\bin\makensis.exe",
    "C:\ProgramData\chocolatey\bin\makensis.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }
  $makensis = $candidates | Select-Object -First 1
}
if (-not $makensis) { Die "makensis not found. Install NSIS (choco install nsis -y) or pass -SkipInstaller." }
Info "using $makensis"

$SetupName = "nodedr-pos-setup-$Version-x64.exe"
$SetupPath = Join-Path $OutPath $SetupName

& $makensis `
  "/DVERSION=$Version" `
  "/DSTAGE_DIR=$Stage" `
  "/DOUT_FILE=$SetupPath" `
  "/DFRONTEND_PORT=$FrontendPort" `
  "/DBACKEND_PORT=$BackendPort" `
  (Join-Path $PkgDir "nodedr-pos.nsi")
if ($LASTEXITCODE -ne 0) { Die "makensis failed" }
if (-not (Test-Path $SetupPath)) { Die "installer was not produced at $SetupPath" }

$sizeMb = [math]::Round((Get-Item $SetupPath).Length / 1MB, 1)
$sha    = (Get-FileHash $SetupPath -Algorithm SHA256).Hash.ToLower()

Write-Host ""
Write-Host "Built $SetupName ($sizeMb MB)" -ForegroundColor Green
Write-Host "  $SetupPath"
Write-Host "  sha256 $sha"
Write-Host ""
Write-Host "Install silently:  $SetupName /S"
Write-Host "Then open:         http://localhost:$FrontendPort"

Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
