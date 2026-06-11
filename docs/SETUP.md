# Setup Guide

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org) or via a package manager (Node 18 is EOL)
- **npm** (included with Node.js)
- **Administrator / root privileges** — required to bind port 443 (can use port 8443 instead)
- At least one API key from a supported provider (or a local model server)

## Quick Start

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
| `EACCES` on port 443 | No root/admin privileges | Use `sudo` / Administrator, or set `PROXY_PORT=8443` |
| `EADDRINUSE` on port 443/4000 | Old process still running | `start.sh` / `start.ps1` kills it automatically; or `lsof -ti :443 \| xargs kill` |
| "API key not configured" | Missing `.env` | Copy `.env.example` → `.env` and add keys, or use the Config tab |
| TLS error in Antigravity | Cert not trusted | Follow the certificate trust steps above |
| Language Server crashes | API returned error (429, 5xx) | Check `proxy/logs/` for details; try a different model or provider |
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

### Context Stripping

Antigravity sends massive inline context with every request (~4000+ tokens of skill descriptions, plugin lists, user rules). The proxy strips this and injects a compact reference to `agent-context.md`, which the model reads once to adopt the runtime identity.

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
