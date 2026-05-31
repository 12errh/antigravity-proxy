# Antigravity Proxy

Use **NVIDIA** or **OpenRouter** models with **Antigravity 2.0** instead of paying for Google Gemini.

## Quick Start

```powershell
.\setup.ps1
# Pick provider, enter API key, script does the rest
```

The script handles: admin elevation, provider setup, dependency install, TLS certs, proxy startup, and launching Antigravity.

## What Works

| Feature | Status | Notes |
|---------|--------|-------|
| Chat / code generation | ✅ Works | All text interactions |
| Tool / function calling | ✅ Works | Antigravity agents use tools through the proxy |
| Model switching | ✅ Works | Edit `proxy/models.json` |
| Provider switching | ✅ Works | Run `setup.ps1` again |
| Thinking / reasoning | ✅ Partial | Works if your model supports `reasoning_effort` |
| Free-tier models | ⚠️ Rate-limited | OpenRouter free models get 429 under load |
| Language Server stability | ⚠️ Fragile | Crashes if proxy returns errors (Antigravity bug) |
| File read/write | ❌ Not intercepted | Falls through to Google (needs Gemini API key) |
| Browser automation | ❌ Not intercepted | Uses Google-specific APIs |
| Image / vision | ❌ Not intercepted | Google-specific format not mapped |
| Audio | ❌ Not intercepted | Not mapped |

## Requirements

- **Windows** (Antigravity is Windows-only)
- **Node.js 18+**
- **Administrator privileges** (for port 443)
- An API key from either [NVIDIA](https://build.nvidia.com) or [OpenRouter](https://openrouter.ai/keys)

## Architecture

```
Antigravity --TLS--> Proxy (443) --OpenAI API--> NVIDIA / OpenRouter
                       |
                       +-- REST (4000) --> Google (init calls)
```

The proxy uses a self-signed TLS certificate to intercept Antigravity's Gemini API calls on port 443. Only chat/tool paths are intercepted — everything else forwards to Google's real API.

## Configuration

- **Provider & API key**: `proxy/.env` (or use `setup.ps1`)
- **Model mapping**: `proxy/models.json` — map Antigravity model names to provider model IDs

## Known Limitations

1. **Language Server crashes** on API errors — this is an Antigravity bug (nil pointer in Go code), not fixable in the proxy
2. **Free OpenRouter models** hit rate limits (429) — use paid models or add your own API key at OpenRouter
3. **File/browser/image features** aren't intercepted — they pass through to Google and need a valid Gemini API key

## v2 Roadmap

Planned for v2: full interception of all Antigravity features including file operations, browser automation, and vision — plus multi-model orchestration.

## License

MIT
