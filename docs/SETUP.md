# Setup Guide

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org) or via a package manager (Node 18 is EOL)
- **npm** (included with Node.js)
- **Administrator / root privileges** — required to bind port 443 (can use port 8443 instead)
- At least one API key from a supported provider (or a local model server)

## Quick Start

### Via npm (recommended)

```bash
npm install -g @12errh/antigravity-proxy
antigravity start
```

Run the interactive setup wizard first:

```bash
antigravity setup
```

This will guide you through selecting a provider, entering your API key, choosing a port, and configuring features.

### Windows (PowerShell as Administrator)

```powershell
.\start.ps1
```

If you can't run as Administrator, use port 8443:

```powershell
# In proxy/.env, set:
PROXY_PORT=8443
# Then start normally — no elevation needed
.\start.ps1
```

### macOS / Linux

```bash
chmod +x start.sh
./start.sh
```

Use a high port to avoid needing `sudo`:

```bash
./start.sh --port 8443
# start.sh automatically writes PROXY_PORT=8443 to proxy/.env
```

Or run with sudo for port 443:

```bash
sudo ./start.sh
```

### Manual Start (all platforms)

```bash
cd proxy
npm install                     # first time only
node scripts/gen-certs.mjs      # first time only
npm start                       # runs via tsx (development)
# or
npm run build && npm run start:prod   # compiled (production)
```

---

## CLI Commands

After installing globally, use these commands:

| Command | Description |
|---------|-------------|
| `antigravity start` | Start proxy + dashboard + launch Antigravity desktop |
| `antigravity start --foreground` | Run in foreground with live logs |
| `antigravity start --port 8443` | Use port 8443 (no admin needed) |
| `antigravity start --no-browser` | Don't open dashboard in browser |
| `antigravity start --trust-cert` | Auto-trust TLS certificate |
| `antigravity stop` | Stop proxy + Antigravity desktop |
| `antigravity status` | Show running status and uptime |
| `antigravity health` | Check health endpoint |
| `antigravity config` | Show current configuration |
| `antigravity config set <key> <value>` | Update a config value |
| `antigravity config get <key>` | Get a specific config value |
| `antigravity logs` | Tail latest log file |
| `antigravity logs list` | List all log files |
| `antigravity certs` | Show certificate info |
| `antigravity certs generate` | Generate TLS certificates |
| `antigravity certs trust` | Install cert to OS trust store |
| `antigravity setup` | Interactive onboarding wizard |

---

## First-time Configuration

1. Start the proxy using one of the commands above
2. Open **http://localhost:4000** in your browser
3. Go to the **Config** tab
4. Add your API keys under "API Keys"
5. Set the **Provider Priority** order (drag to reorder)
6. Click **Save Changes**

The proxy hot-reloads — no restart needed after saving config.

---

## TLS Certificate Trust

The proxy uses a self-signed certificate for port 443. Antigravity needs to trust it.

### Windows (automatic)
`start.ps1` installs the certificate to the Windows Trusted Root store automatically.  
Manual fallback:
```powershell
certutil -addstore -f Root proxy\certs\cert.pem
```

### macOS (automatic with sudo)
`start.sh` runs:
```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain proxy/certs/cert.pem
```
Manual (via UI): Open **Keychain Access**, drag `proxy/certs/cert.pem` into **System** keychain, double-click → **Always Trust**.

### Linux (automatic best-effort)
```bash
# Ubuntu / Debian
sudo cp proxy/certs/cert.pem /usr/local/share/ca-certificates/antigravity-proxy.crt
sudo update-ca-certificates

# Fedora / RHEL
sudo trust anchor --store proxy/certs/cert.pem

# Any distro — Chrome / Chromium only
# Settings → Privacy → Manage certificates → Authorities → Import cert.pem
```

### Using port 8443 instead
If you set `PROXY_PORT=8443` in `proxy/.env`, Antigravity must also be configured to connect to port 8443 instead of 443. This avoids the need for root/Administrator and certificate trust in most setups.

---

## Port Reference

| Port | Protocol | Purpose |
|------|----------|---------|
| 443 (default) | HTTPS / HTTP2 | TLS proxy — intercepts Antigravity → AI provider |
| 8443 (alternative) | HTTPS / HTTP2 | Same, but no root required |
| 4000 (default) | HTTP | Dashboard + REST API |

Change ports in `proxy/.env`:
```env
PROXY_PORT=8443
API_PORT=4001
```

---

## Logs

All proxy logs go to `proxy/logs/` with timestamped filenames:

```
proxy/logs/proxy_20260531_143000.log
```

Enable debug-level logging:
```env
LOG_LEVEL=debug
```

---

## Updating

### Via npm (recommended)

```bash
npm install -g @12errh/antigravity-proxy@latest
```

### From source

```bash
git pull
cd proxy
npm install        # pick up any new dependencies
npm run build      # recompile if running from dist/
```

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| `EACCES` on port 443 | No root/admin privileges | Use `sudo` / Administrator, or `antigravity start --port 8443` |
| `EADDRINUSE` on port 443/4000 | Old process still running | `antigravity stop` kills it automatically; or `lsof -ti :443 \| xargs kill` |
| "API key not configured" | Missing `.env` | Run `antigravity setup` or copy `.env.example` → `.env` and add keys |
| TLS error in Antigravity | Cert not trusted | Run `antigravity certs trust` or follow manual steps below |
| Language Server crashes | API returned error (429, 5xx) | Check `antigravity logs` for details; try a different model or provider |
| "Provider returned error" / 429 | Rate limit hit | Proxy retries automatically; add a second provider as fallback |
| Model not found / 404 | Wrong model ID in Models tab | Use the Browse Models tab to fetch the provider's real catalog |
| Text responses but no tools | Model doesn't support tool calling | Switch to a model that supports function calling (see provider docs) |
| Dashboard shows blank page | JS error in browser | Open browser DevTools console; check for errors; hard-refresh with Ctrl+Shift+R |

---

## How the Proxy Works

The proxy intercepts three specific Antigravity API paths:

- `/v1internal:streamGenerateContent` — Main chat/tool inference
- `/v1internal:cascadeGenerateContent` — Agent cascade calls
- `/v1internal:cascadeStreamGenerateContent` — Streaming cascade calls

All other traffic is forwarded transparently to Google's backend.

### Context Mode

Three modes control how much context is forwarded to external models:

- **`lite` (recommended)** — Strips native Antigravity context, injects compressed `agent-context-lite.md` (~3.5K tokens). Same tool coverage as full context, 66% fewer tokens. Best for most use cases.
- **`strip`** — Strips bulk context (skills/plugins/identity), injects full `agent-context.md` (~10K tokens). More verbose but complete.
- **`passthrough`** — Forwards native Antigravity context unchanged (~28K tokens). Simplest approach, no injection overhead.

Configure via `CONTEXT_STRIP_MODE` in `.env` or the dashboard Config tab. The CLI setup wizard (`antigravity setup`) guides you through selecting a mode.

### Model Resolution

On each request:
1. Router checks the **Models tab matrix** for the requested model alias
2. If a per-provider cell is set, that resolved model name is used for that provider
3. If only a Default is set, that's used for all providers
4. If nothing is set, the router passes the alias through as-is
5. The router tries providers in **priority order** — on failure it retries with backoff, then moves to the next provider

### Response Metadata

The Antigravity Desktop frontend requires specific metadata in every response:
- `safetyRatings` (4 categories at NEGLIGIBLE)
- `index: 0` on every candidate
- `groundingMetadata`

The proxy includes these automatically. Missing them causes silent UI crashes.
