#!/usr/bin/env bash
# nodedr-pos quickstart — macOS & Linux.
#
# Checks whether Docker is installed and running; installs it if not
# (Docker Desktop via Homebrew on macOS, Docker Engine via the official
# get.docker.com script on Linux). Does the same for git (Homebrew on macOS,
# the system package manager on Linux) if it's missing too. Then clones (or
# updates) nodedr-pos into ./nodedr-pos and runs its installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Raktim94/nodedr-pos/master/scripts/quickstart.sh | bash
#
# Safe to re-run: every step only acts if the previous one didn't already
# succeed, and an existing ./nodedr-pos checkout is updated in place rather
# than clobbered.
set -euo pipefail

REPO_URL="https://github.com/Raktim94/nodedr-pos.git"
REPO_DIR="nodedr-pos"
SUDO=""

install_docker_linux() {
  echo "==> Installing Docker Engine via the official convenience script..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" 2>/dev/null || true
  sudo systemctl enable --now docker 2>/dev/null || true
}

install_docker_mac() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "Docker Desktop isn't installed and Homebrew isn't either." >&2
    echo "Install Homebrew first (https://brew.sh) and re-run this command," >&2
    echo "or install Docker Desktop manually: https://docs.docker.com/desktop/setup/install/mac-install/" >&2
    exit 1
  fi
  echo "==> Installing Docker Desktop via Homebrew..."
  brew install --cask docker
  echo "==> Launching Docker Desktop..."
  open -a Docker
  echo "==> Waiting for Docker to start — if macOS shows a permission or license prompt, approve it, this is normal on first launch..."
  for _ in $(seq 1 150); do
    docker info >/dev/null 2>&1 && return
    sleep 2
  done
}

echo "==> Checking for Docker..."
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "Docker is already installed and running."
else
  case "$(uname -s)" in
    Darwin) install_docker_mac ;;
    Linux) install_docker_linux ;;
    *)
      echo "Unsupported OS: $(uname -s). Install Docker manually: https://docs.docker.com/get-docker/" >&2
      exit 1
      ;;
  esac
fi

if ! docker info >/dev/null 2>&1; then
  if sudo docker info >/dev/null 2>&1; then
    # Just-added docker-group membership only takes effect in a fresh login
    # shell. Falling back to sudo for this run means the install still
    # completes in one shot instead of forcing a logout/login first.
    SUDO="sudo"
    echo "Using sudo for Docker for this run — log out and back in once, and future runs won't need it."
  else
    echo "Docker isn't reachable yet." >&2
    echo "On Linux: log out and back in (new docker-group membership needs a fresh session), then re-run this command." >&2
    echo "On Mac: open Docker Desktop, wait for it to say \"running\", then re-run this command." >&2
    exit 1
  fi
fi

install_git_linux() {
  echo "==> Installing git..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y && sudo apt-get install -y git
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y git
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y git
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm git
  elif command -v zypper >/dev/null 2>&1; then
    sudo zypper install -y git
  elif command -v apk >/dev/null 2>&1; then
    sudo apk add git
  else
    echo "Could not detect a supported package manager to install git automatically." >&2
    echo "Install git manually (https://git-scm.com/downloads) and re-run this command." >&2
    exit 1
  fi
}

install_git_mac() {
  # Deliberately NOT running bare `git` to check for it — on a stock Mac
  # with no Xcode Command Line Tools, that alone pops a blocking GUI
  # installer dialog. `command -v` never invokes the binary, so it can't
  # trigger that.
  if command -v brew >/dev/null 2>&1; then
    echo "==> Installing git via Homebrew..."
    brew install git
  else
    echo "git isn't installed and Homebrew isn't either." >&2
    echo "Install Homebrew (https://brew.sh) and re-run this command, or run: xcode-select --install" >&2
    exit 1
  fi
}

if ! command -v git >/dev/null 2>&1; then
  case "$(uname -s)" in
    Darwin) install_git_mac ;;
    Linux) install_git_linux ;;
    *)
      echo "Unsupported OS: $(uname -s). Install git manually: https://git-scm.com/downloads" >&2
      exit 1
      ;;
  esac
fi

echo "==> Getting nodedr-pos..."
if [ -d "$REPO_DIR/.git" ]; then
  echo "Existing checkout found in ./$REPO_DIR — updating it instead of re-cloning."
  git -C "$REPO_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"
echo "==> Installing and starting nodedr-pos..."
$SUDO ./install.sh
