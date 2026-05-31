# Setup Guide

## Prerequisites

1. **Windows** — Antigravity only runs on Windows
2. **Node.js 18+** — Download from [nodejs.org](https://nodejs.org)
3. **Administrator privileges** — The proxy binds to port 443
4. **API key** — From [NVIDIA build.nvidia.com](https://build.nvidia.com) or [OpenRouter](https://openrouter.ai/keys)
5. (Optional) **Google Gemini API key** — Only needed if you use file/browser/vision operations that pass through to Google

## Quick Install

```powershell
.\setup.ps1
```

The script walks you through:

1. **Admin check** — Self-elevates if needed (required for port 443)
2. **Provider picker** — `1` for NVIDIA, `2` for OpenRouter
3. **API key** — Saved to `proxy/.env`
4. **Model defaults** — Copies the matching model map to `proxy/models.json`
5. **Dependencies** — Runs `npm install` automatically
6. **TLS certificates** — Generates self-signed certificates
7. **Proxy start** — Launches in a new Admin PowerShell window
8. **Antigravity Desktop** — Opens automatically

> First-time setup takes about 30–60 seconds.

## Manual Start

If you need to restart the proxy separately:

```powershell
cd proxy
tsx src/index.ts
```

Or for development with auto-reload on file changes:

```powershell
cd proxy
npm run dev
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

Enable debug-level logging by setting `LOG_LEVEL=debug` in `proxy/.env`.

## How the Proxy Works

The proxy intercepts three specific Antigravity API paths:

- `/v1internal:streamGenerateContent` — Main chat/tool inference
- `/v1internal:cascadeGenerateContent` — Agent cascade calls
- `/v1internal:cascadeStreamGenerateContent` — Streaming cascade calls

### Context Stripping

Antigravity sends massive inline context with every request: 30+ skill descriptions, full plugin lists, and embedded user rules — around 4000+ tokens. The proxy strips this and injects a compact reference to [agent-context.md](../agent-context.md), which external models read once to adopt the runtime identity.

### Response Metadata

The Antigravity Desktop frontend requires specific metadata in every response:
- `safetyRatings` (4 categories at NEGLIGIBLE)
- `index: 0` on every candidate
- `groundingMetadata`

The proxy includes these automatically. Missing them causes silent UI crashes and re-analysis loops.

### Tool Call Handling

Parallel tool calls from models are grouped into a single `parts` array in one SSE event. Tool call arguments are cleaned of Antigravity-internal metadata fields (`toolAction`, `toolSummary`, `Summary`, `Action`) that can confuse external models.

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Proxy won't start | Port 443 in use | Close other apps or change `PROXY_PORT` in `.env` |
| "API key not configured" | Missing `.env` | Run `setup.ps1` again |
| Language Server crashes | API returned error (429, 5xx) | Check `proxy/logs/` for details. Try a different model |
| "Provider returned error" / 429 | Rate limit hit | Proxy retries automatically (up to 4 times with backoff). If it persists, use a paid model tier |
| Model not found / 404 | Wrong model ID in `models.json` | Check valid IDs in [NVIDIA catalog](https://build.nvidia.com) or [OpenRouter models](https://openrouter.ai/models) |
| Text responses but no tools | Model doesn't support tool calling | Switch to a model that supports function calling |
| Tool results are empty `{}` | Outdated proxy version | Update to latest: `git pull` and restart |
| Desktop shows "Analyzing..." forever | Missing response metadata | Update to latest proxy version (fix included since v1.0) |
