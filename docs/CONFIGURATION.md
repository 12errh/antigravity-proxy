# Configuration Guide

## Provider Configuration: `proxy/.env`

Edit this file or run `setup.ps1` to reconfigure.

```ini
# Provider: nvidia or openrouter
PROVIDER=nvidia

# Your API keys (only the one for your active provider is needed)
NVIDIA_API_KEY=nvapi-abc123...
OPENROUTER_API_KEY=sk-or-v1-abc123...

# Proxy ports
PROXY_PORT=443
API_PORT=4000

# Log level: debug, info, warn, error
LOG_LEVEL=info
```

When you change `PROVIDER`, the proxy reads the matching `_API_KEY` and `_BASE_URL` automatically.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROVIDER` | Provider selection (`nvidia` or `openrouter`) | `openrouter` |
| `NVIDIA_API_KEY` | API key from build.nvidia.com | — |
| `OPENROUTER_API_KEY` | API key from openrouter.ai/keys | — |
| `NVIDIA_BASE_URL` | NVIDIA API base URL | `https://integrate.api.nvidia.com/v1` |
| `OPENROUTER_BASE_URL` | OpenRouter API base URL | `https://openrouter.ai/api/v1` |
| `PROXY_PORT` | HTTPS intercept port | `443` |
| `API_PORT` | HTTP REST forward port | `4000` |
| `LOG_LEVEL` | Log verbosity | `info` |
| `ANTIGRAVITY_CONTEXT` | Set to `false` to disable context injection | `true` |

---

## Model Mapping: `proxy/models.json`

This file controls which AI model Antigravity uses for each internal model name.

### How It Works

Antigravity requests models by internal names like `claude-sonnet-4-6-thinking` or `gemini-3.1-flash`. The JSON file maps those names to real model IDs on your provider.

```json
{
  "claude-sonnet-4-6-thinking": "deepseek-ai/deepseek-v4-flash",
  "gemini-3.1-flash": "deepseek-ai/deepseek-v4-flash",
  "default": "deepseek-ai/deepseek-v4-flash"
}
```

### Lookup Order

1. **Exact match** — `"claude-sonnet-4-6-thinking"` matches directly
2. **Prefix match** — Strips `models/` prefix, then tries shorter keys
3. **`default`** — Fallback if nothing matches

### Provider Model ID Formats

| Provider | Format Example | Where to Browse |
|----------|---------------|----------------|
| **NVIDIA NIM** | `deepseek-ai/deepseek-v4-flash`, `stepfun-ai/step-3.7-flash` | [build.nvidia.com](https://build.nvidia.com) |
| **OpenRouter** | `openai/gpt-4o`, `anthropic/claude-sonnet-4`, `deepseek-ai/deepseek-v4-flash` | [openrouter.ai/models](https://openrouter.ai/models) |

### Default Files

- `proxy/models.openrouter.json` — Shipped defaults for OpenRouter
- `proxy/models.nvidia.json` — Shipped defaults for NVIDIA

Run `setup.ps1` to copy the right one to `models.json`, or copy manually:

```powershell
Copy-Item proxy/models.nvidia.json proxy/models.json
```

### Proven Working Models

These models have been tested and confirmed to work reliably for tool-calling agentic tasks:

#### NVIDIA NIM
| Model ID | Tier | Notes |
|----------|------|-------|
| `deepseek-ai/deepseek-v4-flash` | Agent / Chat | Best all-rounder. 200B+ parameters. Reliable tool chaining. |
| `stepfun-ai/step-3.7-flash` | Agent / Thinking | v3.7 (200B+). Good for multi-turn agentic tasks. |

#### OpenRouter
| Model ID | Tier | Notes |
|----------|------|-------|
| `deepseek-ai/deepseek-v4-flash` | Agent / Chat | Same model, same reliability |
| `moonshotai/kimi-k2.6` | Agent / Chat | Strong alternative |
| `stepfun-ai/step-3.5-flash` | Fast / Cheap | Lighter model for quick tasks |
| `minimaxai/minimax-m2.7` | Fast / Cheap | Good for lightweight conversations |
| `google/gemma-4-31b-it` | Fast / Cheap | Google's own Gemma 4 |

To use free-tier OpenRouter models, append `:free` suffix (e.g., `deepseek-ai/deepseek-v4-flash:free`), but note these are rate-limited.

---

## Tips

- After editing `models.json`, **restart the proxy** to pick up changes
- For NVIDIA, all models go through the `integrate.api.nvidia.com/v1` endpoint — no special setup needed
- For OpenRouter free models, expect occasional 429 rate limits during rapid tool-calling sequences
- The `default` key acts as a catch-all — anything not explicitly mapped falls back to this
- If a model doesn't support tool/function calling, the proxy will still work for chat but agent tool use will fail
