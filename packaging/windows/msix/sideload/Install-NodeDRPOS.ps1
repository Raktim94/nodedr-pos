<#
.SYNOPSIS
  Installs (or removes) the NodeDR POS .msix downloaded from GitHub Releases.

.DESCRIPTION
  A .msix downloaded outside the Microsoft Store is signed with the project's
  own certificate, which Windows does not trust by default — double-clicking
  it fails with "publisher certificate could not be verified" (0x800B0109).
  This script trusts that certificate for this PC (Trusted People store, needs
  Administrator), then installs the package. Keep the .msix, the .cer and this
  script in the same folder.

  Windows 10 (1809+) / Windows 11, 64-bit. Shop data lives in
  C:\ProgramData\NodeDRPOS and is kept when the app is uninstalled.

.EXAMPLE
  Right-click the file -> "Run with PowerShell"   (installs)
  powershell -ExecutionPolicy Bypass -File .\Install-NodeDRPOS.ps1 -Uninstall
#>
[CmdletBinding()]
param([switch]$Uninstall, [switch]$NoPause)

$ErrorActionPreference = "Stop"

function Pause-IfInteractive { if (-not $NoPause -and $Host.Name -eq "ConsoleHost" -and [Environment]::UserInteractive) { Read-Host "`nPress Enter to close" | Out-Null } }

# Re-launch elevated if needed (certificate trust is machine-wide).
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
  if ($Uninstall) { $argList += "-Uninstall" }
  if ($NoPause) { $argList += "-NoPause" }
  Start-Process powershell -Verb RunAs -ArgumentList $argList
  exit
}

try {
  if ($Uninstall) {
    $pkg = Get-AppxPackage -Name "*Nodedrpos*" -ErrorAction SilentlyContinue
    if ($pkg) { $pkg | Remove-AppxPackage; Write-Host "NodeDR POS removed. Your shop data in C:\ProgramData\NodeDRPOS was kept." -ForegroundColor Green }
    else { Write-Host "NodeDR POS is not installed." }
    Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object { $_.Subject -like "CN=11C721FC-*" } | Remove-Item -ErrorAction SilentlyContinue
    return
  }

  if ([Environment]::Is64BitOperatingSystem -eq $false) { throw "NodeDR POS needs 64-bit Windows." }
  if ([Environment]::OSVersion.Version.Build -lt 17763) { throw "NodeDR POS needs Windows 10 version 1809 or newer." }

  $msix = Get-ChildItem -Path $PSScriptRoot -Filter "Nodedr-POS-*-x64.msix" | Sort-Object Name | Select-Object -Last 1
  $cer  = Get-ChildItem -Path $PSScriptRoot -Filter "*.cer" | Select-Object -First 1
  if (-not $msix) { throw "Nodedr-POS-*-x64.msix not found next to this script." }
  if (-not $cer)  { throw "The .cer certificate file is missing next to this script." }

  Write-Host "Trusting the NodeDR POS publisher certificate on this PC..."
  Import-Certificate -FilePath $cer.FullName -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null

  Write-Host "Installing $($msix.Name) ..."
  Add-AppxPackage -Path $msix.FullName
  Write-Host "`nInstalled. Open 'Nodedr POS' from the Start menu." -ForegroundColor Green
}
catch {
  Write-Host "`nInstall failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "If you installed the Store version of Nodedr POS, remove it first (Settings > Apps) — the two cannot be installed side by side."
  exit 1
}
finally { Pause-IfInteractive }
