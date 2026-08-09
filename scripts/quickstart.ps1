# nodedr-pos quickstart — Windows (PowerShell).
#
# Checks whether Docker Desktop is installed and running; installs it via
# winget if not. Does the same for git if it's missing too. Then clones (or
# updates) nodedr-pos into %USERPROFILE%\nodedr-pos and starts it with
# docker compose.
#
# Usage (run in PowerShell):
#   irm https://raw.githubusercontent.com/Raktim94/nodedr-pos/master/scripts/quickstart.ps1 | iex
#
# Safe to re-run: every step only acts if the previous one didn't already
# succeed, and an existing .\nodedr-pos checkout is updated in place rather
# than clobbered.
#
# Note: if Docker Desktop needs to enable WSL2 on this machine, Windows may
# require a restart before Docker can start. If that happens, restart, then
# run this command again to pick up where it left off.

$ErrorActionPreference = "Stop"

# If this is launched from an elevated ("Run as Administrator") PowerShell,
# Windows defaults its working directory to C:\Windows\System32 — not
# writable by a normal process, so a relative git clone into .\nodedr-pos
# fails with "Permission denied" right here. Always install under the
# invoking user's home directory instead of trusting the shell's cwd.
Set-Location $HOME

$repoUrl = "https://github.com/Raktim94/nodedr-pos.git"
$repoDir = "nodedr-pos"

function Test-DockerReady {
    try { docker info *> $null; return $LASTEXITCODE -eq 0 } catch { return $false }
}

# winget writes new PATH entries (e.g. Docker's or Git's install dir) to the
# Machine/User registry values, but this already-running PowerShell process
# keeps its own stale copy of $env:Path — a command installed a moment ago
# via winget can still resolve to "not recognized" without this. Re-reading
# both scopes from the registry and rebuilding $env:Path is the same fix
# Windows itself applies the next time you open a new terminal.
function Update-SessionPath {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

Write-Host "==> Checking for Docker..."
if (Test-DockerReady) {
    Write-Host "Docker is already installed and running."
} else {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
            Write-Error "Docker Desktop isn't installed and winget isn't available. Install Docker Desktop manually: https://docs.docker.com/desktop/setup/install/windows-install/"
            exit 1
        }
        Write-Host "==> Installing Docker Desktop via winget (this can take a few minutes)..."
        winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
        Update-SessionPath
    }

    $dockerDesktop = "$Env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerDesktop) {
        Write-Host "==> Launching Docker Desktop..."
        Start-Process $dockerDesktop
    }

    Write-Host "==> Waiting for Docker to start — approve its first-run terms/permission prompt if one appears..."
    $ready = $false
    for ($i = 0; $i -lt 150; $i++) {
        if (Test-DockerReady) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) {
        Write-Error "Docker didn't come up in time. This can mean Windows needs a restart to finish enabling WSL2 — restart if prompted, open Docker Desktop, wait until it says `"running`", then run this command again."
        exit 1
    }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Error "git isn't installed and winget isn't available. Install it from https://git-scm.com/downloads and re-run this command."
        exit 1
    }
    Write-Host "==> Installing Git via winget..."
    winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
    Update-SessionPath
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Error "Git was just installed but this PowerShell window hasn't picked it up. Close this window, open a new PowerShell, and re-run the same command."
        exit 1
    }
}

Write-Host "==> Getting nodedr-pos..."
if (Test-Path "$repoDir\.git") {
    Write-Host "Existing checkout found in .\$repoDir — updating it instead of re-cloning."
    git -C $repoDir pull --ff-only
} else {
    git clone $repoUrl $repoDir
}

Set-Location $repoDir

Write-Host "==> Installing and starting nodedr-pos (this can take a few minutes on first run)..."
docker compose up -d --build

$hostPort = "1994"
if (Test-Path ".env") {
    $line = Select-String -Path ".env" -Pattern '^HOST_PORT=' | Select-Object -First 1
    if ($line) { $hostPort = ($line.Line -split '=', 2)[1] }
}

Write-Host "==> Waiting for the app to come online..."
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$hostPort/api/health" -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
}

if ($ready) {
    Write-Host ""
    Write-Host "nodedr-pos is up and running."
    Write-Host "Open http://localhost:$hostPort in your browser to create your admin account and finish shop setup."
} else {
    Write-Warning "The app didn't respond within 90s. Check the logs with: docker compose logs"
}
