<#
.SYNOPSIS
  Builds the NodeDR POS MSIX package for Microsoft Store submission
  (Nodedr-POS-<version>-x64.msix).

.DESCRIPTION
  MUST run on Windows (same reason as build-windows.ps1: native Node addons,
  Prisma's platform-specific engine, plus this script additionally needs
  csc.exe and makeappx.exe, both Windows-only).

  Does NOT touch, replace, or depend on the NSIS/EXE installer output. It
  calls build-windows.ps1 -SkipInstaller to get the same staged payload the
  EXE installer uses (single source of truth for "what files ship"), strips
  out the WinSW/NSIS-specific pieces the MSIX manifest replaces (service\,
  bin\), adds the MSIX manifest + visual assets + a small compiled launcher,
  and packs it with makeappx.

  Package identity (Name + Publisher CN) is intentionally NOT hardcoded
  anywhere in this repo — it comes from Partner Center -> your app -> Product
  management -> App identity, and must be passed in explicitly. Anything else
  would risk silently packaging under an identity that doesn't match what
  Partner Center expects, which fails ingestion.

.EXAMPLE
  pwsh -File packaging\windows\build-msix.ps1 `
    -Version 1.0.0 `
    -PackageIdentityName "12345Publisher.NodedrPOS" `
    -PublisherCn "CN=A1B2C3D4-...-...-...-..." `
    -SelfSignForTesting
#>
[CmdletBinding()]
param(
  [string]$Version            = "1.0.0",
  [int]$BackendPort           = 4000,
  [int]$FrontendPort          = 1994,
  [string]$OutDir             = "dist",
  [string]$PackageIdentityName = $env:NODEDR_MSIX_IDENTITY_NAME,
  [string]$PublisherCn         = $env:NODEDR_MSIX_PUBLISHER_CN,
  # Local-testing convenience only. NEVER used for the Store submission
  # itself — Partner Center re-signs with a Microsoft certificate after
  # certification, which is the entire reason MSIX avoids buying a
  # trusted-root code-signing cert. See packaging/windows/README.md.
  [switch]$SelfSignForTesting
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }
function Ok($m)   { Write-Host "    [ok] $m" -ForegroundColor Green }
function Die($m)  { Write-Host "`nERROR: $m" -ForegroundColor Red; exit 1 }

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$PkgDir   = $PSScriptRoot
$MsixDir  = Join-Path $PkgDir "msix"
$Work     = Join-Path ([System.IO.Path]::GetTempPath()) "nodedr-pos-msix-$(Get-Random)"
$Payload  = Join-Path $Work "payload"
$OutPath  = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $RepoRoot $OutDir }
New-Item -ItemType Directory -Force -Path $Work, $OutPath | Out-Null

Step "Preflight"
if ([string]::IsNullOrWhiteSpace($PackageIdentityName) -or $PackageIdentityName -eq "@PACKAGE_IDENTITY_NAME@") {
  Die "PackageIdentityName is required. Get it from Partner Center -> your app -> Product management -> App identity, then pass -PackageIdentityName or set `$env:NODEDR_MSIX_IDENTITY_NAME. Do not invent one."
}
if ([string]::IsNullOrWhiteSpace($PublisherCn) -or $PublisherCn -eq "@PARTNER_CENTER_PUBLISHER_CN@") {
  Die "PublisherCn is required. Same Partner Center page as above ('Publisher ID', a CN=... string), then pass -PublisherCn or set `$env:NODEDR_MSIX_PUBLISHER_CN. Do not invent one."
}
Info "identity  $PackageIdentityName"
Info "publisher $PublisherCn"
Info "version   $Version.0"

# ---------------------------------------------------------------------------
# 1. Reuse build-windows.ps1's staging step — single source of truth for what
#    files ship, so the MSIX and the EXE never silently drift apart.
# ---------------------------------------------------------------------------
Step "Staging the application payload (via build-windows.ps1 -SkipInstaller)"
$stageOutput = & pwsh -File (Join-Path $PkgDir "build-windows.ps1") `
  -Version $Version -BackendPort $BackendPort -FrontendPort $FrontendPort -SkipInstaller 2>&1 |
  Tee-Object -Variable stageLog
if ($LASTEXITCODE -ne 0) { Die "build-windows.ps1 -SkipInstaller failed:`n$($stageLog -join "`n")" }
$stageLine = $stageLog | Where-Object { $_ -match "^Staged payload: (.+)$" } | Select-Object -Last 1
if (-not $stageLine -or $stageLine -notmatch "^Staged payload: (.+)$") { Die "could not find the staged payload path in build-windows.ps1's output" }
$Stage = $Matches[1].Trim()
if (-not (Test-Path $Stage)) { Die "staged payload directory does not exist: $Stage" }
Ok "staged payload at $Stage"

Step "Assembling the MSIX payload"
Copy-Item $Stage $Payload -Recurse
# service\ (WinSW) is KEPT — see the long comment in backend-service.js.template
# for why: MSIX's windows.service extension only handles SCM registration,
# it does not make an arbitrary process speak the Service Control Protocol.
# Confirmed on real Windows CI (2026-08-14): pointing the extension directly
# at runtime\node.exe fails with "StartService FAILED 1053" (service never
# reports RUNNING back to the SCM). WinSW already solves exactly this for
# the EXE install, so it does the same job here instead of being replaced.
# bin\ (the EXE install's nodedr-pos.cmd operator CLI) is still removed —
# open-pos.exe is its MSIX equivalent.
Remove-Item (Join-Path $Payload "bin") -Recurse -Force -ErrorAction SilentlyContinue
# The EXE's .ico (if it exists) is not part of the MSIX visual asset set;
# MSIX assets are generated fresh below.
Remove-Item (Join-Path $Payload "nodedr-pos.ico") -Force -ErrorAction SilentlyContinue
Ok "payload ready at $Payload (bin\ removed — open-pos.exe replaces it; service\ kept, see above)"

# ---------------------------------------------------------------------------
# 1b. Backend service entry-point wrapper (JWT secret + prisma migrate
#     deploy — see the file's own header comment for the full rationale) and
#     repointing WinSW's own copied XML config at it instead of server.js
#     directly. The frontend needs no wrapper: its WinSW XML already sets
#     everything it needs and calls frontend\server.js unmodified, same as
#     the EXE install.
# ---------------------------------------------------------------------------
Step "Writing the backend service wrapper"
$WrappersDir = Join-Path $Payload "msix-wrappers"
New-Item -ItemType Directory -Force -Path $WrappersDir | Out-Null
$backendWrapperJs = (Get-Content (Join-Path $MsixDir "backend-service.js.template") -Raw).
  Replace("@FRONTEND_PORT@", "$FrontendPort")
Set-Content -Path (Join-Path $WrappersDir "backend-service.js") -Value $backendWrapperJs -Encoding UTF8

$backendXmlPath = Join-Path $Payload "service\nodedr-pos-backend.xml"
$backendXml = (Get-Content $backendXmlPath -Raw).Replace(
  '<arguments>"%BASE%\..\backend\src\server.js"</arguments>',
  '<arguments>"%BASE%\..\msix-wrappers\backend-service.js"</arguments>'
)
if ($backendXml -notmatch [regex]::Escape('msix-wrappers\backend-service.js')) {
  Die "failed to repoint nodedr-pos-backend.xml at the MSIX wrapper — the <arguments> line in packaging/windows/service/nodedr-pos-backend.xml may have changed format"
}
Set-Content -Path $backendXmlPath -Value $backendXml -Encoding UTF8
Ok "wrapper written to msix-wrappers\, backend WinSW config repointed at it"

# ---------------------------------------------------------------------------
# 2. Visual assets, generated fresh each build from the app's own logo — same
#    "no committed generated binaries" philosophy as build-windows.ps1's icon
#    step, just with the full MSIX tile/logo set instead of one .ico.
# ---------------------------------------------------------------------------
Step "Generating MSIX visual assets"
$logo = Join-Path $RepoRoot "frontend\public\logo.png"
if (-not (Test-Path $logo)) { Die "source logo not found at $logo" }

Add-Type -AssemblyName System.Drawing
$AssetsDir = Join-Path $Payload "Assets"
New-Item -ItemType Directory -Force -Path $AssetsDir | Out-Null

function New-SquareAsset($srcPath, $destPath, $size) {
  $src = [System.Drawing.Image]::FromFile($srcPath)
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $size, $size)
  $g.Dispose()
  $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function New-WideAsset($srcPath, $destPath, $width, $height) {
  # Source logo is square; a wide tile needs it centered on a transparent
  # canvas rather than stretched (stretching a square logo 2.07:1 would
  # visibly distort it).
  $src = [System.Drawing.Image]::FromFile($srcPath)
  $bmp = New-Object System.Drawing.Bitmap $width, $height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $side = $height
  $x = [int](($width - $side) / 2)
  $g.DrawImage($src, $x, 0, $side, $side)
  $g.Dispose()
  $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

New-SquareAsset $logo (Join-Path $AssetsDir "Square44x44Logo.png") 44
New-SquareAsset $logo (Join-Path $AssetsDir "Square71x71Logo.png") 71
New-SquareAsset $logo (Join-Path $AssetsDir "Square150x150Logo.png") 150
New-SquareAsset $logo (Join-Path $AssetsDir "StoreLogo.png") 50
New-WideAsset   $logo (Join-Path $AssetsDir "Wide310x150Logo.png") 310 150
Ok "assets generated from frontend\public\logo.png (44/71/150/310x150/StoreLogo) — visually spot-check on Windows before submitting; not verified from this build environment"

# ---------------------------------------------------------------------------
# 3. Compile the Start Menu launch target (open-pos.exe).
# ---------------------------------------------------------------------------
Step "Compiling the launch target (open-pos.exe)"
$csc = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { Die "csc.exe (.NET Framework C# compiler) not found — expected on every windows-latest runner / Windows install" }

$csSrc = (Get-Content (Join-Path $MsixDir "open-pos.cs.template") -Raw).Replace("@FRONTEND_PORT@", "$FrontendPort")
$csPath = Join-Path $Work "open-pos.cs"
Set-Content -Path $csPath -Value $csSrc -Encoding UTF8
& $csc /nologo /target:winexe `
  /r:System.ServiceProcess.dll /r:System.Windows.Forms.dll `
  /out:"$(Join-Path $Payload 'open-pos.exe')" $csPath
if ($LASTEXITCODE -ne 0) { Die "csc.exe failed to compile open-pos.cs" }
Ok "open-pos.exe compiled"

# ---------------------------------------------------------------------------
# 4. Manifest.
# ---------------------------------------------------------------------------
Step "Writing AppxManifest.xml"
$manifest = Get-Content (Join-Path $MsixDir "AppxManifest.xml.template") -Raw
$manifest = $manifest.
  Replace("@PACKAGE_IDENTITY_NAME@", $PackageIdentityName).
  Replace("@PARTNER_CENTER_PUBLISHER_CN@", $PublisherCn).
  Replace("@VERSION@", $Version).
  Replace("@FRONTEND_PORT@", "$FrontendPort")
Set-Content -Path (Join-Path $Payload "AppxManifest.xml") -Value $manifest -Encoding UTF8
Ok "manifest written"

# ---------------------------------------------------------------------------
# 5. Pack.
# ---------------------------------------------------------------------------
Step "Packing the MSIX"
$makeappx = @(
  "${env:ProgramFiles(x86)}\Windows Kits\10\bin\x64\makeappx.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $makeappx) {
  $sdkBin = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (Test-Path $sdkBin) {
    $makeappx = Get-ChildItem $sdkBin -Directory |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName "x64\makeappx.exe" } |
      Where-Object { Test-Path $_ } |
      Select-Object -First 1
  }
}
if (-not $makeappx) { Die "makeappx.exe not found. Install the Windows SDK (present by default on windows-latest GitHub runners)." }
Info "using $makeappx"

$MsixName = "Nodedr-POS-$Version.0-x64.msix"
$MsixPath = Join-Path $OutPath $MsixName
& $makeappx pack /d $Payload /p $MsixPath /o
if ($LASTEXITCODE -ne 0) { Die "makeappx pack failed" }
if (-not (Test-Path $MsixPath)) { Die "MSIX was not produced at $MsixPath" }
Ok "packed $MsixName"

# ---------------------------------------------------------------------------
# 6. Local-testing signature only (never for Store submission).
# ---------------------------------------------------------------------------
if ($SelfSignForTesting) {
  Step "Self-signing for LOCAL TESTING ONLY (not the Store submission)"
  $signtool = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin\x64\signtool.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $signtool) {
    $sdkBin = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    $signtool = Get-ChildItem $sdkBin -Directory |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } |
      Where-Object { Test-Path $_ } |
      Select-Object -First 1
  }
  if (-not $signtool) { Die "signtool.exe not found (Windows SDK)" }

  $certPath = Join-Path $Work "nodedr-pos-test.pfx"
  $certPassword = ConvertTo-SecureString -String "nodedr-pos-test" -Force -AsPlainText
  $cert = New-SelfSignedCertificate -Type Custom -Subject $PublisherCn `
    -KeyUsage DigitalSignature -FriendlyName "NodeDR POS test signing" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
  Export-PfxCertificate -Cert $cert -FilePath $certPath -Password $certPassword | Out-Null
  & $signtool sign /fd SHA256 /f $certPath /p "nodedr-pos-test" $MsixPath
  if ($LASTEXITCODE -ne 0) { Die "signtool failed to sign the test package" }
  Ok "signed for local testing with a self-signed cert (Subject: $PublisherCn)"
  # Exported into $OutPath (dist\), NOT $Work — $Work is deleted at the end
  # of this script, which would leave the instructions below pointing at a
  # file that no longer exists.
  $cerPath = Join-Path $OutPath "nodedr-pos-test.cer"
  Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
  Write-Host ""
  Write-Host "Before Add-AppxPackage will accept this, trust the test cert once:" -ForegroundColor Yellow
  Write-Host "  Import-Certificate -FilePath `"$cerPath`" -CertStoreLocation Cert:\LocalMachine\TrustedPeople"
}

$sizeMb = [math]::Round((Get-Item $MsixPath).Length / 1MB, 1)
$sha = (Get-FileHash $MsixPath -Algorithm SHA256).Hash.ToLower()

Write-Host ""
Write-Host "Built $MsixName ($sizeMb MB)" -ForegroundColor Green
Write-Host "  $MsixPath"
Write-Host "  sha256 $sha"
Write-Host ""
Write-Host "This is the file to upload to Partner Center — Store submission does NOT"
Write-Host "need this signed with a trusted-root cert; Microsoft re-signs it after"
Write-Host "certification passes."

Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
