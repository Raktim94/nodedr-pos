<#
.SYNOPSIS
  Builds the NodeDR POS Microsoft Store package: Nodedr-POS-<version>-x64.msix
  and the Partner Center upload file Nodedr-POS-<version>-x64.msixupload.

.DESCRIPTION
  Must run on Windows x64 (native Node addons, Electron, makeappx). Does not
  touch the Docker / CasaOS packaging.

  Payload = Electron shell (NodeDRPOS.exe) + bundled node.exe + backend +
  Next.js standalone frontend. See packaging/windows-store/README.md.

  Package identity is never hardcoded: pass -PackageIdentityName / -PublisherCn
  (Partner Center > App identity) or set NODEDR_MSIX_IDENTITY_NAME /
  NODEDR_MSIX_PUBLISHER_CN. With -SelfSignForTesting a throwaway certificate is
  created for LOCAL installs only; Partner Center re-signs the Store package.

  -Repack re-stamps -Version on the already staged payload in <OutDir>\stage and
  packs again (used to test an app upgrade without a second full build).
#>
[CmdletBinding()]
param(
  [string]$Version,
  [string]$OutDir = "dist",
  [string]$PackageIdentityName = $env:NODEDR_MSIX_IDENTITY_NAME,
  [string]$PublisherCn = $env:NODEDR_MSIX_PUBLISHER_CN,
  [switch]$SelfSignForTesting,
  [switch]$Repack
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }
function Ok($m)   { Write-Host "    [ok] $m" -ForegroundColor Green }
function Die($m)  { Write-Host "`nERROR: $m" -ForegroundColor Red; exit 1 }
function Run($exe, [string[]]$a) { & $exe @a; if ($LASTEXITCODE -ne 0) { Die "$exe $($a -join ' ') failed ($LASTEXITCODE)" } }

$Here     = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $Here "..\..")).Path
$OutPath  = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $RepoRoot $OutDir }
$Stage    = Join-Path $OutPath "stage"
New-Item -ItemType Directory -Force -Path $OutPath | Out-Null

if (-not $Version) { $Version = (Get-Content (Join-Path $RepoRoot "backend\package.json") -Raw | ConvertFrom-Json).version }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Die "Version must look like 1.6.2 (got '$Version'); the package version becomes $Version.0 (Store requires revision 0)" }
$PkgVersion = "$Version.0"

Step "Preflight"
if ([string]::IsNullOrWhiteSpace($PackageIdentityName)) { Die "PackageIdentityName is required (Partner Center > App identity). Do not invent one." }
if ([string]::IsNullOrWhiteSpace($PublisherCn)) { Die "PublisherCn is required (Partner Center > App identity > Publisher). Do not invent one." }
if (-not [Environment]::Is64BitOperatingSystem) { Die "x64 Windows required" }
Info "identity  $PackageIdentityName"
Info "publisher $PublisherCn"
Info "version   $PkgVersion"

function Find-SdkTool($name) {
  $c = "${env:ProgramFiles(x86)}\Windows Kits\10\bin\x64\$name"
  if (Test-Path $c) { return $c }
  $root = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (Test-Path $root) {
    $f = Get-ChildItem $root -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName "x64\$name" } | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($f) { return $f }
  }
  Die "$name not found (Windows SDK)"
}
function Get-PEMachine($path) {
  $b = [System.IO.File]::ReadAllBytes($path)
  $pe = [BitConverter]::ToInt32($b, 0x3C)
  return [BitConverter]::ToUInt16($b, $pe + 4)
}
function Assert-X64($path) {
  $m = Get-PEMachine $path
  if ($m -ne 0x8664) { Die ("{0} is not a genuine x64 image (machine 0x{1:X4}). This is what caused the earlier Store certification failure 0x8007000B." -f $path, $m) }
}

if (-not $Repack) {
  if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
  $Res = Join-Path $Stage "resources\nodedr"
  New-Item -ItemType Directory -Force -Path $Stage, $Res | Out-Null

  # ---- backend -----------------------------------------------------------
  Step "Backend (production dependencies, Prisma client, no Prisma CLI)"
  $BackendSrc = Join-Path $RepoRoot "backend"
  $BackendWork = Join-Path $OutPath "work-backend"
  if (Test-Path $BackendWork) { Remove-Item $BackendWork -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $BackendWork | Out-Null
  foreach ($i in "package.json", "package-lock.json", "prisma.config.js") { Copy-Item (Join-Path $BackendSrc $i) $BackendWork }
  Copy-Item (Join-Path $BackendSrc "prisma") (Join-Path $BackendWork "prisma") -Recurse
  Copy-Item (Join-Path $BackendSrc "src") (Join-Path $BackendWork "src") -Recurse
  Push-Location $BackendWork
  try {
    Run npm @("ci", "--no-audit", "--no-fund")
    Run npx @("prisma", "generate")
    # `npm prune` would drop the generated client (it lives in a dot-folder), so keep a copy.
    $gen = Join-Path $BackendWork "node_modules\.prisma"
    if (-not (Test-Path (Join-Path $gen "client"))) { Die "prisma generate produced no client" }
    Copy-Item $gen (Join-Path $OutPath "prisma-client-keep") -Recurse -Force
    Run npm @("prune", "--omit=dev", "--no-audit", "--no-fund")
    if (-not (Test-Path (Join-Path $gen "client"))) { Copy-Item (Join-Path $OutPath "prisma-client-keep") $gen -Recurse -Force }
    Remove-Item (Join-Path $OutPath "prisma-client-keep") -Recurse -Force
  } finally { Pop-Location }
  # @prisma/client depends on the `prisma` CLI package, so `npm prune` keeps it (~200 MB: schema engine,
  # Studio, local Postgres). Nothing at runtime uses it (queries go through the better-sqlite3 adapter and
  # migrations through src/desktop/migrate.js), so remove the CLI-only packages. Verified by starting the
  # backend without them (test/desktop.process.test.js runs against the full tree; CI e2e runs this trimmed one).
  foreach ($d in "prisma", "effect", "elkjs", "@electric-sql", "@prisma\engines", "@prisma\studio-core", "@prisma\dev",
                 "@prisma\fetch-engine", "@prisma\query-plan-executor", "@prisma\streams-local", "@prisma\config") {
    $p = Join-Path $BackendWork "node_modules\$d"
    if (Test-Path $p) { Remove-Item $p -Recurse -Force }
  }
  Get-ChildItem (Join-Path $BackendWork "node_modules\.bin") -Filter "prisma*" -ErrorAction SilentlyContinue | Remove-Item -Force
  if (-not (Test-Path (Join-Path $BackendWork "node_modules\@prisma\client"))) { Die "@prisma/client missing after trimming" }
  # keep only the Windows x64 native binaries
  $usbPre = Join-Path $BackendWork "node_modules\usb\prebuilds"
  if (Test-Path $usbPre) { Get-ChildItem $usbPre -Directory | Where-Object { $_.Name -ne "win32-x64" } | Remove-Item -Recurse -Force }
  foreach ($d in "node_modules\better-sqlite3\deps", "node_modules\better-sqlite3\src") { $p = Join-Path $BackendWork $d; if (Test-Path $p) { Remove-Item $p -Recurse -Force } }
  $bkDest = Join-Path $Res "backend"
  New-Item -ItemType Directory -Force -Path $bkDest | Out-Null
  foreach ($i in "package.json", "src", "node_modules") { Copy-Item (Join-Path $BackendWork $i) $bkDest -Recurse }
  New-Item -ItemType Directory -Force -Path (Join-Path $bkDest "prisma") | Out-Null
  Copy-Item (Join-Path $BackendWork "prisma\migrations") (Join-Path $bkDest "prisma\migrations") -Recurse
  Copy-Item (Join-Path $BackendWork "prisma\schema.prisma") (Join-Path $bkDest "prisma")
  Remove-Item $BackendWork -Recurse -Force
  Ok "backend staged"

  # ---- frontend ----------------------------------------------------------
  Step "Frontend (Next.js standalone)"
  $FeWork = Join-Path $RepoRoot "frontend"
  Push-Location $FeWork
  try {
    $env:NEXT_TELEMETRY_DISABLED = "1"
    Run npm @("ci", "--no-audit", "--no-fund")
    Run npm @("run", "build")
  } finally { Pop-Location }
  $sa = Join-Path $FeWork ".next\standalone"
  if (-not (Test-Path (Join-Path $sa "server.js"))) { Die "Next.js standalone server.js missing" }
  $feDest = Join-Path $Res "frontend"
  Copy-Item $sa $feDest -Recurse
  New-Item -ItemType Directory -Force -Path (Join-Path $feDest ".next") | Out-Null
  Copy-Item (Join-Path $FeWork ".next\static") (Join-Path $feDest ".next\static") -Recurse
  if (Test-Path (Join-Path $FeWork "public")) { Copy-Item (Join-Path $FeWork "public") (Join-Path $feDest "public") -Recurse }
  Ok "frontend staged"

  # ---- bundled Node ------------------------------------------------------
  Step "Bundled Node.js runtime"
  $nodeSrc = (Get-Command node).Source
  Assert-X64 $nodeSrc
  New-Item -ItemType Directory -Force -Path (Join-Path $Res "runtime") | Out-Null
  Copy-Item $nodeSrc (Join-Path $Res "runtime\node.exe")
  Info ("node " + (& $nodeSrc --version))
  Ok "runtime staged (same Node the native addons were installed with)"

  # ---- Electron ------------------------------------------------------------
  Step "Electron shell"
  $ShellWork = Join-Path $Here "shell"
  Push-Location $ShellWork
  try {
    Run npm @("ci", "--no-audit", "--no-fund")
    # npm may skip install scripts; fetch the Electron binary explicitly (checksum-verified by @electron/get).
    if (-not (Test-Path "node_modules\electron\dist\electron.exe")) { Run node @("node_modules\electron\install.js") }
  } finally { Pop-Location }
  $electronDist = Join-Path $ShellWork "node_modules\electron\dist"
  if (-not (Test-Path (Join-Path $electronDist "electron.exe"))) { Die "electron.exe not downloaded" }
  Copy-Item (Join-Path $electronDist "*") $Stage -Recurse
  Move-Item (Join-Path $Stage "electron.exe") (Join-Path $Stage "NodeDRPOS.exe")
  Remove-Item (Join-Path $Stage "resources\default_app.asar") -Force -ErrorAction SilentlyContinue
  $appDir = Join-Path $Stage "resources\app"
  New-Item -ItemType Directory -Force -Path $appDir | Out-Null
  foreach ($i in "main.js", "preload.js", "splash.html", "package.json", "lib") { Copy-Item (Join-Path $ShellWork $i) $appDir -Recurse }
  # stamp the shell package version
  $pj = Get-Content (Join-Path $appDir "package.json") -Raw | ConvertFrom-Json; $pj.version = $Version
  ($pj | ConvertTo-Json -Depth 5) | Set-Content (Join-Path $appDir "package.json") -Encoding UTF8
  Assert-X64 (Join-Path $Stage "NodeDRPOS.exe")
  Ok "Electron staged as NodeDRPOS.exe (x64)"

  # ---- visual assets + icon ---------------------------------------------------
  Step "Visual assets"
  $logo = Join-Path $RepoRoot "frontend\public\logo.png"
  if (-not (Test-Path $logo)) { Die "logo not found: $logo" }
  Add-Type -AssemblyName System.Drawing
  $Assets = Join-Path $Stage "Assets"
  New-Item -ItemType Directory -Force -Path $Assets | Out-Null
  function New-Canvas($w, $h, $bg) {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    if ($bg) { $g.Clear([System.Drawing.ColorTranslator]::FromHtml($bg)) }
    return @($bmp, $g)
  }
  function Save-Logo($dest, $w, $h, $bg, $fill) {
    $src = [System.Drawing.Image]::FromFile($logo)
    $bmp, $g = New-Canvas $w $h $bg
    $side = [int]([math]::Min($w, $h) * $fill)
    $g.DrawImage($src, [int](($w - $side) / 2), [int](($h - $side) / 2), $side, $side)
    $g.Dispose(); $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $src.Dispose()
  }
  Save-Logo (Join-Path $Assets "StoreLogo.png") 50 50 $null 1.0
  Save-Logo (Join-Path $Assets "Square44x44Logo.png") 44 44 $null 1.0
  foreach ($s in 16, 24, 32, 48, 256) {
    Save-Logo (Join-Path $Assets "Square44x44Logo.targetsize-$s.png") $s $s $null 1.0
    Save-Logo (Join-Path $Assets "Square44x44Logo.targetsize-${s}_altform-unplated.png") $s $s $null 1.0
  }
  Save-Logo (Join-Path $Assets "Square71x71Logo.png") 71 71 $null 0.9
  Save-Logo (Join-Path $Assets "Square150x150Logo.png") 150 150 $null 0.9
  Save-Logo (Join-Path $Assets "Square310x310Logo.png") 310 310 $null 0.8
  Save-Logo (Join-Path $Assets "Wide310x150Logo.png") 310 150 $null 0.9
  Save-Logo (Join-Path $Assets "SplashScreen.png") 620 300 "#1f6b43" 0.6
  # .ico (PNG-compressed 256px) for the exe
  $icoPng = Join-Path $OutPath "icon256.png"; Save-Logo $icoPng 256 256 $null 1.0
  $png = [System.IO.File]::ReadAllBytes($icoPng)
  $ms = New-Object System.IO.MemoryStream; $bw = New-Object System.IO.BinaryWriter $ms
  $bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]1)
  $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([uint16]1); $bw.Write([uint16]32)
  $bw.Write([uint32]$png.Length); $bw.Write([uint32]22); $bw.Write($png); $bw.Flush()
  $icoPath = Join-Path $OutPath "NodeDRPOS.ico"; [System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
  Ok "assets generated from frontend\public\logo.png"

  # ---- exe resources + fuses -----------------------------------------------------
  Step "Executable branding and hardening"
  $rcedit = Join-Path $ShellWork "node_modules\rcedit\bin\rcedit-x64.exe"
  if (Test-Path $rcedit) {
    Run $rcedit @((Join-Path $Stage "NodeDRPOS.exe"), "--set-icon", $icoPath, "--set-version-string", "ProductName", "NodeDR POS",
      "--set-version-string", "FileDescription", "NodeDR POS", "--set-version-string", "CompanyName", "NODEDR INFOTECH LIMITED",
      "--set-file-version", $PkgVersion, "--set-product-version", $PkgVersion)
    Ok "icon + version info applied"
  } else { Write-Host "    [warn] rcedit not found; exe keeps the Electron icon" -ForegroundColor Yellow }
  Push-Location $ShellWork
  try {
    node -e "const f=require('@electron/fuses');f.flipFuses(process.argv[1],{version:f.FuseVersion.V1,strictlyRequireAllFuses:false,[f.FuseV1Options.RunAsNode]:false,[f.FuseV1Options.EnableNodeOptionsEnvironmentVariable]:false,[f.FuseV1Options.EnableNodeCliInspectArguments]:false}).then(()=>console.log('fuses flipped')).catch(e=>{console.error(e);process.exit(1)})" (Join-Path $Stage "NodeDRPOS.exe")
    if ($LASTEXITCODE -ne 0) { Die "flipping Electron fuses failed" }
  } finally { Pop-Location }
  Assert-X64 (Join-Path $Stage "NodeDRPOS.exe")
  Assert-X64 (Join-Path $Stage "resources\nodedr\runtime\node.exe")
  Get-ChildItem (Join-Path $Stage "resources\nodedr\backend\node_modules") -Recurse -Filter *.node -ErrorAction SilentlyContinue | ForEach-Object {
    $m = Get-PEMachine $_.FullName
    if ($m -ne 0x8664) { Die ("native addon {0} is not x64 (0x{1:X4})" -f $_.FullName, $m) }
  }
  Ok "every native binary is x64"
}

# ---- manifest + pack ---------------------------------------------------------------
Step "Manifest"
if (-not (Test-Path $Stage)) { Die "no staged payload at $Stage (run without -Repack first)" }
$manifest = (Get-Content (Join-Path $Here "AppxManifest.xml.template") -Raw).
  Replace("@PACKAGE_IDENTITY_NAME@", $PackageIdentityName).Replace("@PARTNER_CENTER_PUBLISHER_CN@", $PublisherCn).Replace("@VERSION@", $PkgVersion)
Set-Content -Path (Join-Path $Stage "AppxManifest.xml") -Value $manifest -Encoding UTF8
Ok "AppxManifest.xml written"

Step "Pack"
$makeappx = Find-SdkTool "makeappx.exe"
$MsixName = "Nodedr-POS-$PkgVersion-x64.msix"
$MsixPath = Join-Path $OutPath $MsixName
Run $makeappx @("pack", "/d", $Stage, "/p", $MsixPath, "/o")
Ok "packed $MsixName"

if ($SelfSignForTesting) {
  Step "Self-sign for LOCAL TESTING ONLY (the Store submission is re-signed by Microsoft)"
  $signtool = Find-SdkTool "signtool.exe"
  $pfx = Join-Path $OutPath "nodedr-pos-test.pfx"
  $cerPath = Join-Path $OutPath "nodedr-pos-test.cer"
  if (-not (Test-Path $pfx)) {
    $cert = New-SelfSignedCertificate -Type Custom -Subject $PublisherCn -KeyUsage DigitalSignature -FriendlyName "NodeDR POS test signing" `
      -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
    Export-PfxCertificate -Cert $cert -FilePath $pfx -Password (ConvertTo-SecureString -String "nodedr-pos-test" -Force -AsPlainText) | Out-Null
    Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
  }
  Run $signtool @("sign", "/fd", "SHA256", "/f", $pfx, "/p", "nodedr-pos-test", $MsixPath)
  Ok "signed with a throwaway certificate ($cerPath) — never ship this one"
}

# Partner Center upload file: a zip containing the package.
$upload = Join-Path $OutPath "Nodedr-POS-$PkgVersion-x64.msixupload"
if (Test-Path $upload) { Remove-Item $upload -Force }
$tmpZip = "$upload.zip"
if (Test-Path $tmpZip) { Remove-Item $tmpZip -Force }
Compress-Archive -Path $MsixPath -DestinationPath $tmpZip
Move-Item $tmpZip $upload
$mb = [math]::Round((Get-Item $MsixPath).Length / 1MB, 1)
Write-Host ""
Write-Host "Built $MsixName ($mb MB)" -ForegroundColor Green
Write-Host "  msix       $MsixPath"
Write-Host "  msixupload $upload   <- upload this to Partner Center"
Write-Host "  sha256     $((Get-FileHash $MsixPath -Algorithm SHA256).Hash.ToLower())"
