#!/usr/bin/env bash
# One-line installer for Anubis-Security-Tool web (build from source).
#   curl -fsSL <your-host>/scripts/one-line-web.sh | bash
# Override with env vars:
#   ANUBIS_REPO_URL  git url   (default: https://github.com/Anubis-Locker/anubis-web.git)
#   ANUBIS_REF       branch/tag to checkout (default: repo default branch)
#   ANUBIS_DIR       target dir (default: ./anubis-web)
set -Eeuo pipefail

REPO_URL="${ANUBIS_REPO_URL:-https://github.com/Anubis-Locker/anubis-web.git}"
REF="${ANUBIS_REF:-}"
TARGET_DIR="${ANUBIS_DIR:-anubis-web}"
MIN_NODE_MAJOR=24

log () { printf '\033[1;34m[anubis]\033[0m %s\n' "$*"; }
die () { printf '\033[1;31m[anubis] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }
trap 'rc=$?; die "failed at line ${LINENO} (exit ${rc})"' ERR

need () { command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not installed. $2"; }

need git "Install git first."
need node "Install Node.js ${MIN_NODE_MAJOR}+ (https://nodejs.org or fnm)."
need npm "Install npm with Node.js."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt "${MIN_NODE_MAJOR}" ]; then
  die "Node.js ${MIN_NODE_MAJOR}+ required, found $(node -v)."
fi
if ! command -v make >/dev/null 2>&1 || ! command -v g++ >/dev/null 2>&1; then
  log "warning: make/g++ not found; native modules (node-pty, serialport) may fail to build."
  log "  Debian/Ubuntu: sudo apt install -y make python3 g++ build-essential"
fi

if [ -d "${TARGET_DIR}/.git" ]; then
  log "updating existing checkout in ${TARGET_DIR}"
  git -C "${TARGET_DIR}" fetch --tags --prune origin
  if [ -n "${REF}" ]; then
    git -C "${TARGET_DIR}" checkout "${REF}"
  fi
  git -C "${TARGET_DIR}" pull --ff-only || log "warning: could not fast-forward (detached ref?), continuing"
elif [ -e "${TARGET_DIR}" ]; then
  die "${TARGET_DIR} exists and is not a git checkout; set ANUBIS_DIR to another path."
else
  log "cloning ${REPO_URL}"
  if [ -n "${REF}" ]; then
    git clone --depth 1 --branch "${REF}" "${REPO_URL}" "${TARGET_DIR}"
  else
    git clone --depth 1 "${REPO_URL}" "${TARGET_DIR}"
  fi
fi

cd "${TARGET_DIR}"

if [ ! -f .env ]; then
  [ -f .sample.env ] || die ".sample.env missing in checkout"
  cp .sample.env .env
  # generate strong secrets so the server can start right away
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -hex 32)"
    PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  else
    SECRET="$(node -p "require('crypto').randomBytes(32).toString('hex')")"
    PASS="$(node -p "require('crypto').randomBytes(15).toString('base64url')")"
  fi
  sed -i.bak -e "s|^SERVER_SECRET=.*|SERVER_SECRET=${SECRET}|" -e "s|^SERVER_PASS=.*|SERVER_PASS=${PASS}|" .env
  rm -f .env.bak
  chmod 600 .env
  log "created .env with generated SERVER_SECRET; login: user 'admin', password: ${PASS}"
  log "(stored in $(pwd)/.env - change it as you like)"
else
  log ".env already exists, leaving it untouched"
fi

log "installing dependencies"
npm install --legacy-peer-deps
log "building"
npm run build

log "done. Start with:  cd ${TARGET_DIR} && ./run-electerm-web.sh   (http://127.0.0.1:5577)"
log "Put nginx + TLS in front for remote use: see examples/nginx-ssl.conf"
