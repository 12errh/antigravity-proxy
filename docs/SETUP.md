# Setup Guide

## Prerequisites

1. **Windows** — Antigravity only runs on Windows
2. **Node.js 18+** — Download from [nodejs.org](https://nodejs.org)
3. **Administrator access** — The proxy binds to port 443
4. **API key** — From [NVIDIA build.nvidia.com](https://build.nvidia.com) or [OpenRouter](https://openrouter.ai/keys)

## Quick Install

```powershell
.\setup.ps1
```

The script walks you through:
- **Admin check** — self-elevates if needed
- **Provider picker** — `1` for NVIDIA, `2` for OpenRouter
- **API key** — saved to `proxy/.env`
- **Model defaults** — copies the right model map to `proxy/models.json`
- **Dependencies** — runs `npm install` automatically
- **TLS certs** — generates self-signed certificates
- **Proxy start** — launches in a new Admin window
- **Antigravity** — opens automatically

> First-time setup takes about 30-60 seconds.

## Manual Start

If you closed the proxy window:

```powershell
cd proxy
tsx src/index.ts
```

## Changing Provider

```powershell
.\setup.ps1
# Type 'y' at "Reconfigure?"
```

This rewrites `proxy/.env` and copies the matching model defaults to `proxy/models.json`.

## Logs

All proxy logs go to `proxy/logs/` with timestamped filenames:

```
proxy/logs/proxy_20260531_143000.log
```

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Proxy won't start | Port 443 in use | Close other apps or change `PROXY_PORT` in `.env` |
| "API key not configured" | Missing `.env` | Run `setup.ps1` again |
| Antigravity Language Server crashes | API returned error (429, 5xx) | Check `proxy/logs/` for details. Try a different model |
| "Provider returned error" / 429 | Free tier rate limit | Use a paid model or add your key at OpenRouter |
| Model not found / 404 | Wrong model ID in `models.json` | Update with valid provider model IDs |
| Text responses but no tools | Model doesn't support tool calling | Switch to a model that supports functions |
