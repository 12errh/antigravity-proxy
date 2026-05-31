# Configuration Guide

## Provider: `proxy/.env`

Edit this file or run `setup.ps1` to reconfigure.

```ini
# Provider: nvidia or openrouter
PROVIDER=openrouter

# Your API keys
NVIDIA_API_KEY=nvapi-abc123...
OPENROUTER_API_KEY=sk-or-v1-abc123...

# Proxy ports
PROXY_PORT=443
API_PORT=4000

# Log level: debug, info, warn, error
LOG_LEVEL=info
```

When you change `PROVIDER`, the proxy reads the matching `_API_KEY` and `_BASE_URL` variables automatically.

---

## Model Mapping: `proxy/models.json`

This file controls which AI model Antigravity uses for each feature.

### How It Works

Antigravity requests models by internal names like `claude-opus-4-6-thinking` or `gemini-3.5-flash`. The JSON file maps those names to real model IDs on your provider.

```json
{
  "_comment": "Keys = Antigravity model names, Values = provider model IDs",
  "claude-opus-4-6-thinking": "qwen/qwen3-32b",
  "gpt-oss-120b-medium": "openai/gpt-oss-120b",
  "default": "deepseek-ai/deepseek-v4-flash"
}
```

### Lookup Order

1. **Exact match** — `"claude-opus-4-6-thinking"` matches directly
2. **Prefix match** — Strips `models/` prefix, then tries shorter keys
3. **`default`** — fallback if nothing matches

### Provider Model IDs

| Provider | Format Example | Where to Browse |
|----------|---------------|----------------|
| **OpenRouter** | `openai/gpt-4o`, `anthropic/claude-sonnet-4`, `qwen/qwen3-32b` | [openrouter.ai/models](https://openrouter.ai/models) |
| **NVIDIA** | `meta/llama-3.1-8b-instruct`, `mistralai/mistral-7b-instruct-v0.3` | [build.nvidia.com](https://build.nvidia.com) |

### Default Files

- `proxy/models.openrouter.json` — shipped defaults for OpenRouter
- `proxy/models.nvidia.json` — shipped defaults for NVIDIA

Run `setup.ps1` to copy the right one to `models.json`.

---

## Tips

- **Free OpenRouter models** use the `:free` suffix (e.g. `deepseek-ai/deepseek-v4-flash:free`) but get rate-limited
- **NVIDIA** models require a valid NVIDIA API key from build.nvidia.com
- After editing `models.json`, restart the proxy to pick up changes
