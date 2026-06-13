#!/usr/bin/env bash
# Antigravity Proxy — macOS / Linux launcher
#
# ⚠️  PLATFORM SUPPORT NOTICE:
#   This script has NOT been tested on macOS or Linux. It was written based
#   on knowledge of the platform APIs but may contain bugs. If you hit an
#   issue, please open a GitHub issue at: https://github.com/your-repo/issues
#   Include your OS version, Node.js version, and the full error output.
#
# Usage: ./start.sh [--port 8443]
# Requires: Node.js 20+, npm
# Port 443 requires root/sudo. Use --port 8443 to avoid it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY_DIR="$SCRIPT_DIR/proxy"

# ── Colour helpers ────────────────────────────────────────────────────────────
info()  { echo "  [INFO]  $*"; }
ok()    { echo "  [ OK ]  $*"; }
warn()  { echo "  [WARN]  $*" >&2; }
err()   { echo "  [ERR]   $*" >&2; }
step()  { echo; echo "==> $*"; }

# ── Parse args ────────────────────────────────────────────────────────────────
PROXY_PORT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port|-p) PROXY_PORT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# ── Prerequisites ─────────────────────────────────────────────────────────────
step "Checking prerequisites"
if ! command -v node &>/dev/null; then
  err "Node.js not found. Install from https://nodejs.org or via your package manager."
  err "  macOS:  brew install node"
  err "  Ubuntu: sudo apt install nodejs npm"
  exit 1
fi
NODE_VER=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  err "Node.js 20+ required (found v$NODE_VER)"
  exit 1
fi
ok "Node.js v$NODE_VER"
NODE_BIN="$(command -v node)"

if ! command -v npm &>/dev/null; then
  err "npm not found."
  exit 1
fi

# ── npm install ───────────────────────────────────────────────────────────────
mkdir -p "$PROXY_DIR"
cd "$PROXY_DIR"
step "Installing dependencies"
if [[ ! -d node_modules ]]; then
  npm install
  ok "Dependencies installed"
else
  ok "Dependencies already installed (delete node_modules to reinstall)"
fi

# ── TLS certificates ──────────────────────────────────────────────────────────
CERT_DIR="$PROXY_DIR/certs"
CERT_FILE="$CERT_DIR/cert.pem"
mkdir -p "$CERT_DIR"
if [[ ! -f "$CERT_FILE" ]]; then
  step "Generating TLS certificates"
  node scripts/gen-certs.mjs
  ok "Certificates generated at $CERT_FILE"
else
  ok "Certificates exist"
fi

# ── Trust the certificate ─────────────────────────────────────────────────────
step "Trusting TLS certificate"
OS="$(uname -s)"
if [[ "$OS" == "Darwin" ]]; then
  # macOS: add to system keychain
  if security find-certificate -c "localhost" /Library/Keychains/System.keychain &>/dev/null 2>&1; then
    ok "Certificate already trusted (macOS keychain)"
  else
    info "Adding certificate to macOS System Keychain (may prompt for password)..."
    if sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CERT_FILE" 2>/dev/null; then
      ok "Certificate added to macOS System Keychain"
    else
      warn "Could not auto-trust certificate. To trust manually:"
      warn "  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain '$CERT_FILE'"
      warn "Or open Keychain Access, import cert.pem, and set to 'Always Trust'."
    fi
  fi
elif [[ "$OS" == "Linux" ]]; then
  # Linux: varies by distro — best-effort
  if command -v update-ca-certificates &>/dev/null; then
    TRUST_DIR="/usr/local/share/ca-certificates"
    if [[ -d "$TRUST_DIR" ]]; then
      if sudo cp "$CERT_FILE" "$TRUST_DIR/antigravity-proxy.crt" 2>/dev/null && sudo update-ca-certificates 2>/dev/null; then
        ok "Certificate trusted via update-ca-certificates"
      else
        warn "Could not auto-trust certificate."
        warn "  To trust manually: sudo cp '$CERT_FILE' /usr/local/share/ca-certificates/antigravity-proxy.crt && sudo update-ca-certificates"
      fi
    fi
  elif command -v trust &>/dev/null; then
    if sudo trust anchor --store "$CERT_FILE" 2>/dev/null; then
      ok "Certificate trusted via trust anchor"
    else
      warn "Could not auto-trust certificate. Run: sudo trust anchor --store '$CERT_FILE'"
    fi
  else
    warn "Cannot auto-trust certificate on this Linux system."
    warn "Add the certificate to your browser's trusted CAs manually:"
    warn "  Chrome: Settings → Privacy → Manage certificates → Authorities → Import"
    warn "  Firefox: Settings → Privacy → View Certificates → Authorities → Import"
  fi
else
  warn "Unknown OS: $OS — skipping certificate trust step."
fi

# ── Kill old proxy ─────────────────────────────────────────────────────────────
step "Checking for old proxy processes"
PORTS_TO_CHECK=(443 4000)
[[ -n "$PROXY_PORT" ]] && PORTS_TO_CHECK+=("$PROXY_PORT")
for PORT in "${PORTS_TO_CHECK[@]}"; do
  if command -v lsof &>/dev/null; then
    PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
  else
    PIDS=$(ss -tlnp 2>/dev/null | grep ":$PORT " | grep -oP 'pid=\K\d+' || true)
  fi
  if [[ -n "$PIDS" ]]; then
    info "Stopping process(es) on port $PORT (PIDs: $PIDS)"
    echo "$PIDS" | xargs kill -TERM 2>/dev/null || true
    sleep 1
  fi
done
ok "Port check complete"

# ── Port binding decision ─────────────────────────────────────────────────────
if [[ -z "$PROXY_PORT" ]]; then
  if [[ $EUID -ne 0 ]]; then
    warn "Not running as root. Port 443 may fail with EACCES."
    warn "Options:"
    warn "  1. Run with sudo:    sudo ./start.sh"
    warn "  2. Use a high port:  ./start.sh --port 8443"
    warn "     (then set PROXY_PORT=8443 in proxy/.env)"
    warn ""
    warn "Continuing anyway — if port 443 fails, set PROXY_PORT=8443 in proxy/.env"
  fi
fi

# ── Create .env from example if missing ──────────────────────────────────────
if [[ ! -f "$PROXY_DIR/.env" ]]; then
  step "Creating proxy/.env from template"
  cp "$PROXY_DIR/.env.example" "$PROXY_DIR/.env"
  warn "Created proxy/.env — add your API keys before using the proxy."
  warn "Open http://localhost:4000 → Config tab to configure providers."
fi

# ── Set port override if passed ───────────────────────────────────────────────
if [[ -n "$PROXY_PORT" ]]; then
  # Write or update PROXY_PORT in .env
  if grep -q "^PROXY_PORT=" "$PROXY_DIR/.env"; then
    sed -i.bak "s/^PROXY_PORT=.*/PROXY_PORT=$PROXY_PORT/" "$PROXY_DIR/.env" && rm -f "$PROXY_DIR/.env.bak"
  else
    echo "PROXY_PORT=$PROXY_PORT" >> "$PROXY_DIR/.env"
  fi
  info "PROXY_PORT set to $PROXY_PORT in proxy/.env"
fi

# ── Create logs dir ───────────────────────────────────────────────────────────
mkdir -p "$PROXY_DIR/logs"

# ── Start proxy ───────────────────────────────────────────────────────────────
step "Starting proxy"
LOG_FILE="$PROXY_DIR/logs/proxy_$(date +%Y%m%d_%H%M%S).log"

# Run as root if we need port 443 and aren't already root
if [[ -z "$PROXY_PORT" || "$PROXY_PORT" == "443" ]] && [[ $EUID -ne 0 ]]; then
  info "Attempting to start with sudo for port 443..."
  nohup sudo "$NODE_BIN" --import tsx/esm "$PROXY_DIR/src/index.ts" > "$LOG_FILE" 2>&1 &
else
  nohup node --import tsx/esm "$PROXY_DIR/src/index.ts" > "$LOG_FILE" 2>&1 &
fi
PROXY_PID=$!
ok "Proxy starting (PID $PROXY_PID) — log: $LOG_FILE"

# ── Wait for dashboard ────────────────────────────────────────────────────────
step "Waiting for dashboard..."
for i in $(seq 1 20); do
  if command -v curl &>/dev/null; then
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:4000/api/health" 2>/dev/null || echo "000")
  else
    HTTP_STATUS=$(nc -z localhost 4000 2>/dev/null && echo "200" || echo "000")
  fi
  if [[ "$HTTP_STATUS" == "200" ]]; then
    ok "Dashboard ready at http://localhost:4000"
    break
  fi
  sleep 0.5
done
if [[ "$HTTP_STATUS" != "200" ]]; then
  warn "Dashboard not yet responding — check log: $LOG_FILE"
fi

# ── Open browser ──────────────────────────────────────────────────────────────
step "Opening dashboard"
if [[ "$OS" == "Darwin" ]]; then
  open "http://localhost:4000" 2>/dev/null || true
elif command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:4000" 2>/dev/null || true
elif command -v gnome-open &>/dev/null; then
  gnome-open "http://localhost:4000" 2>/dev/null || true
else
  info "Open http://localhost:4000 in your browser."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
step "Ready!"
info "  Dashboard:  http://localhost:4000"
info "  TLS Proxy:  https://localhost:${PROXY_PORT:-443}"
info "  Log file:   $LOG_FILE"
info ""
info "  Configure providers and API keys from the dashboard Config tab."
info "  To stop: kill $PROXY_PID  (or Ctrl+C if you run in foreground)"
info ""
info "  To run in foreground instead of background:"
info "    cd proxy && npm start"
