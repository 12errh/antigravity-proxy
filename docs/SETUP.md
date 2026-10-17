# Setup Guide

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org) or via a package manager (Node 18 is EOL)
- **npm** (included with Node.js)
- **Administrator / root privileges** — required to bind port 443 (can run the proxy on port 8443 instead, but the desktop app only connects on 443)
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

If you can't run as Administrator, you can still test the proxy on port 8443 — but the desktop app connects on 443, so use `antigravity start --simple` to run the app without proxying:

```powershell
.\start.ps1 --port 8443   # proxy only, for direct API testing
antigravity start --simple    # launch the desktop app with no proxy
```

### macOS / Linux

```bash
chmod +x start.sh
./start.sh
```

Use a high port to run without `sudo` (direct API testing only — the desktop app connects on 443):

```bash
./start.sh --port 8443
```

Or run with sudo for port 443:

```bash
sudo ./start.sh
# or, when installed via npm:
sudo antigravity start
```

> **Node under sudo:** the CLI locates a Node 20+ install (nvm, fnm, volta, or system-wide) and re-execs under it, so `sudo antigravity start` works even when root's `PATH` has an older Node or none at all. Force a specific binary with `ANTIGRAVITY_NODE=/path/to/node`.

### Manual Start (all platforms)

```bash
cd proxy
npm install                        # first time only
npm run gen-certs                  # first time only (certs land in proxy/certs,
                                   #  auto-migrated to ~/.antigravity/certs)
npm start                          # runs via tsx (development)
# or
npm run build && npm run start:prod   # compiled (production)
```

---

## CLI Commands

After installing globally, use these commands:

> **Recommended:** Run from an **Administrator terminal** (PowerShell/CMD as Admin) for seamless flow — avoids repeated UAC prompts when switching modes, managing certs, or starting/stopping the proxy.
>
> **Linux/macOS:** run privileged commands with `sudo` (e.g. `sudo antigravity start`). The CLI re-execs under a Node 20+ install it locates itself, so nvm/fnm/volta setups work fine under sudo (`ANTIGRAVITY_NODE` overrides the binary).

| Command | Description |
|---------|-------------|
| `antigravity start` | Start proxy + dashboard + launch Antigravity desktop |
| `antigravity start --foreground` | Run in foreground with live logs |
| `antigravity start --port 8443` | Run the proxy on 8443 without admin (testing only — the desktop app connects on 443) |
| `antigravity start --no-browser` | Don't open dashboard in browser |
| `antigravity start --trust-cert` | Auto-trust TLS certificate |
| `antigravity start --simple` | Launch Antigravity directly without proxy (no admin) |
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
| `antigravity switch` | Toggle between proxy and simple mode |
| `antigravity path` | Show the detected Antigravity desktop binary |
| `antigravity path <binary>` | Pin the desktop binary path (useful on Linux) |
| `antigravity remove` | Remove proxy artifacts and clean up |

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

The proxy uses a self-signed certificate for port 443. Antigravity needs to trust it. The CLI generates certs into `~/.antigravity/certs/` (`%USERPROFILE%\.antigravity\certs\` on Windows) and trusts that exact file.

### Windows (automatic)
`antigravity start` installs the certificate to the Windows Trusted Root store automatically (UAC prompt). Manual fallback:
```powershell
certutil -addstore -f Root "$env:USERPROFILE\.antigravity\certs\cert.pem"
```

### macOS (automatic with sudo)
`antigravity certs trust` runs:
```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain ~/.antigravity/certs/cert.pem
```
Manual (via UI): Open **Keychain Access**, drag `~/.antigravity/certs/cert.pem` into **System** keychain, double-click → **Always Trust**.

### Linux (NSS + system CA store)
Antigravity is an Electron/Chromium app: it validates TLS against the **NSS database** (`~/.pki/nssdb`), not the OpenSSL bundle. `antigravity certs trust` therefore does both:

1. **NSS user DB** (required for the desktop app) — uses `certutil`, which comes from `libnss3-tools` (`nss-tools` on Fedora). If `certutil` is missing the CLI installs it via apt/dnf/yum/pacman/zypper when possible. Manual equivalent:
   ```bash
   certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Antigravity Proxy" -i ~/.antigravity/certs/cert.pem
   ```
2. **System CA store** — whichever this distro provides:
   ```bash
   # Ubuntu / Debian
   sudo cp ~/.antigravity/certs/cert.pem /usr/local/share/ca-certificates/antigravity-proxy.crt
   sudo update-ca-certificates

   # Fedora / RHEL
   sudo cp ~/.antigravity/certs/cert.pem /etc/pki/ca-trust/source/anchors/antigravity-proxy.crt
   sudo update-ca-trust

   # Any distro (p11-kit)
   sudo trust anchor --store ~/.antigravity/certs/cert.pem
   ```

Every `antigravity start` verifies the certificate is **actually present** in the stores (not just that it was trusted once) and re-trusts it automatically if missing — for example after `antigravity switch` to simple mode removed it. If sign-in reports `certificate signed by unknown authority`, just start again; `antigravity certs trust` does the same repair manually.

To remove trust again, run `antigravity switch` (to simple mode) or `antigravity remove`.

### Ports other than 443
The desktop app always connects on **port 443** (the CLI routes the Google API hostnames to `127.0.0.1` via the hosts file), so proxy mode must bind 443 to intercept app traffic and complete sign-in:

- If `PROXY_PORT` in `~/.antigravity/.env` is set to something else (e.g. 8443), a root start **auto-corrects it to 443** and prints a note. Pass `--port` explicitly to override (you'll get a warning that app sign-in will fail).
- Running on another port is only useful for testing the proxy directly (e.g. `curl -k https://localhost:8443/...`) without root.

The CLI does not redirect the desktop app to another port — use `antigravity start --simple` to run the app with no proxy at all.

---

## Port Reference

| Port | Protocol | Purpose |
|------|----------|---------|
| 443 (default) | HTTPS / HTTP2 | TLS proxy — intercepts Antigravity → AI provider. The desktop app only connects here |
| 8443 (alternative) | HTTPS / HTTP2 | Same proxy, no root required — for direct API testing; the desktop app is not intercepted |
| 4000 (default) | HTTP | Dashboard + REST API |

Change ports in `~/.antigravity/.env`:
```env
PROXY_PORT=443          # leave at 443 for app interception (root starts auto-correct other values)
API_PORT=4001
```

---

## Logs

All proxy logs go to `~/.antigravity/logs/` with timestamped filenames:

```
~/.antigravity/logs/proxy_20260531_143000.log
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
| `EACCES` on port 443 | No root/admin privileges | Use `sudo` / Administrator, or `antigravity start --port 8443` (testing only — the app needs 443) |
| `EADDRINUSE` on port 443/4000 | Old process still running | `antigravity stop` kills it automatically; or `lsof -ti :443 \| xargs kill` |
| "API key not configured" | Missing `.env` | Run `antigravity setup` or copy `.env.example` → `.env` and add keys |
| TLS error in Antigravity | Cert not trusted | `antigravity certs trust`, or just `sudo antigravity start` — every start re-verifies and repairs trust automatically |
| Sign-in spinner, or `certificate signed by unknown authority` | Trust was lost (e.g. switched to simple mode), or proxy isn't on 443 | `sudo antigravity start` re-trusts and binds 443; a `PROXY_PORT` other than 443 breaks app sign-in |
| Browser doesn't open for sign-in | Desktop app launched via sudo without the session environment | Update to the latest version and restart with `sudo antigravity start` |
| `sudo antigravity` fails (old-Node syntax error / no node) | Bootstrap couldn't find a Node 20+ install | Install Node 20+ anywhere (nvm/fnm/volta fine), or set `ANTIGRAVITY_NODE=/path/to/node` |
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
