# nodedr-pos quickstart — Windows (PowerShell).
#
# Checks whether Docker Desktop is installed and running; installs it via
# winget if not; then clones (or updates) nodedr-pos into .\nodedr-pos and
# starts it with docker compose.
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

$repoUrl = "https://github.com/Raktim94/nodedr-pos.git"
$repoDir = "nodedr-pos"

function Test-DockerReady {
    try { docker info *> $null; return $LASTEXITCODE -eq 0 } catch { return $false }
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
    Write-Error "git isn't installed. Install it from https://git-scm.com/downloads and re-run this command."
    exit 1
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
