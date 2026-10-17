#!/usr/bin/env bash
# Antigravity Proxy — macOS / Linux launcher
#
# Thin wrapper around the CLI: all logic (certificates, trust, hosts file,
# ports, process management, config) lives in the CLI itself so Windows and
# POSIX run exactly the same code path.
#
# Usage: ./start.sh [--port 8443]
# Port 443 requires root: sudo ./start.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY_DIR="$SCRIPT_DIR/proxy"

err()  { echo "  [ERR]   $*" >&2; }
info() { echo "  [INFO]  $*"; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  err "Node.js not found. Install from https://nodejs.org or via your package manager."
  err "  macOS:  brew install node"
  err "  Ubuntu: sudo apt install nodejs npm"
  exit 1
fi

NODE_BIN="$(command -v node)"
NODE_VER="$("$NODE_BIN" --version | sed 's/v//')"
NODE_MAJOR="${NODE_VER%%.*}"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  err "Node.js 20+ required (found v$NODE_VER)"
  exit 1
fi

if ! command -v npm &>/dev/null; then
  err "npm not found."
  exit 1
fi

# ── Dependencies ──────────────────────────────────────────────────────────────
if [[ ! -d "$PROXY_DIR/node_modules" ]]; then
  info "Installing dependencies..."
  (cd "$PROXY_DIR" && npm install)
fi

# The CLI entry (bin/cli.js) imports from dist/, so build it when absent.
if [[ ! -f "$PROXY_DIR/dist/cli/commands/start.js" ]]; then
  info "Building..."
  (cd "$PROXY_DIR" && npm run build)
fi

# ── Port 443 note (the CLI handles the rest) ──────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  case " $* " in
    *" --port "*) ;; # explicit high port — fine
    *)
      info "Port 443 requires root; for a high port use: ./start.sh --port 8443"
      ;;
  esac
fi

# ── Run the CLI (owns certs, trust, hosts, ports, process management) ────────
exec "$NODE_BIN" "$PROXY_DIR/bin/cli.js" start "$@"
