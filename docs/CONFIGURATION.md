# Configuration Guide

## Provider Configuration: `proxy/.env`

Edit this file from the dashboard Config tab or directly.

```ini
# Provider priority order (comma-separated, first = primary)
PROVIDER_PRIORITY=openrouter,nvidia,groq,openai

# API keys (only those for your active providers)
OPENROUTER_API_KEY=sk-or-v1-abc123...
NVIDIA_API_KEY=nvapi-abc123...
GROQ_API_KEY=gsk_abc123...
OPENAI_API_KEY=sk-abc123...
ANTHROPIC_API_KEY=sk-ant-abc123...
GOOGLE_API_KEY=AIza...

# Proxy ports
PROXY_PORT=443
API_PORT=4000

# Retry & failover
PROXY_RETRIES=10
PROXY_BACKOFF_MS=1000

# Log level: debug, info, warn, error
LOG_LEVEL=info
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROVIDER_PRIORITY` | Comma-separated priority list | `openrouter,nvidia` |
| `PROVIDER` | Legacy single-provider (backward compat) | `openrouter` |
| `{PROVIDER}_API_KEY` | API key per provider (e.g. `NVIDIA_API_KEY`) | — |
| `{PROVIDER}_BASE_URL` | Optional base URL override per provider | See adapter defaults |
| `PROXY_PORT` | HTTPS intercept port | `443` |
| `API_PORT` | HTTP REST forward port | `4000` |
| `PROXY_RETRIES` | Max retry attempts per provider before failover | `10` |
| `PROXY_BACKOFF_MS` | Initial backoff in ms (doubles each retry) | `1000` |
| `LOG_LEVEL` | Log verbosity | `info` |
| `ANTIGRAVITY_CONTEXT` | Set to `false` to disable context injection | `true` |
| `DASHBOARD_USER` | Basic auth username for dashboard (set from Config tab) | — |
| `DASHBOARD_PASSWORD` | Basic auth password for dashboard (set from Config tab) | — |
| `FAILOVER_WEBHOOK_URL` | URL to receive POST notifications on provider failover (set from Config tab) | — |
| `RATE_LIMIT_GLOBAL` | Max requests per window across all providers (`0` = unlimited) | `60` |
| `RATE_LIMIT_PROVIDER` | Max requests per window per provider (`0` = unlimited) | `30` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in milliseconds | `60000` |

### Supported Providers

| Provider ID | Env Key | Adapter | Default Base URL |
|-------------|---------|---------|------------------|
| `openrouter` | `OPENROUTER_API_KEY` | OpenAI-compat | `https://openrouter.ai/api/v1` |
| `nvidia` | `NVIDIA_API_KEY` | OpenAI-compat | `https://integrate.api.nvidia.com/v1` |
| `openai` | `OPENAI_API_KEY` | OpenAI-compat | `https://api.openai.com/v1` |
| `groq` | `GROQ_API_KEY` | OpenAI-compat | `https://api.groq.com/openai/v1` |
| `anthropic` | `ANTHROPIC_API_KEY` | Anthropic | `https://api.anthropic.com/v1` |
| `google` | `GOOGLE_API_KEY` | Google Gemini | `https://generativelanguage.googleapis.com` |
| `ollama` | none | OpenAI-compat | `http://localhost:11434` |
| `vllm` | none | OpenAI-compat | `http://localhost:8000` |
| `lmstudio` | none | OpenAI-compat | `http://localhost:1234` |

---

## Model Mapping: `proxy/models.json`

Controls which AI model the router sends to each provider for each Antigravity model name.

### Flat Mapping (Default)

```json
{
  "claude-sonnet-4-6-thinking": "deepseek-ai/deepseek-v4-flash",
  "gemini-3.1-flash": "deepseek-ai/deepseek-v4-flash",
  "default": "deepseek-ai/deepseek-v4-flash"
}
```

Every provider in the priority chain receives the same resolved model name.

### Per-Provider Mapping

Use `_provider_models` to route specific models to specific providers:

```json
{
  "gpt-oss-120b": "stepfun-ai/step-3.7-flash",
  "_provider_models": {
    "gpt-oss-120b": {
      "groq": "qwen/qwen3-32b",
      "nvidia": "nvidia/llama-3.1-nemotron-ultra-253b-v1"
    },
    "qwen3-32b": {
      "ollama": "qwen3:32b"
    }
  },
  "default": "stepfun-ai/step-3.7-flash"
}
```

When `_provider_models` is set for a model, the router **only tries those providers** (in priority order). This lets you use different providers for different model families.

### Lookup Order

1. **Per-provider** — `_provider_models[model][providerId]` if set
2. **Flat map** — exact match or prefix match in `models.json`
3. **`default`** — fallback if nothing matches

### Editing from Dashboard

Use the Models tab in the dashboard — add/remove rows, set provider in dropdown, changes are hot-reloaded immediately.

---

## Retry & Failover Behavior

When a provider returns an error, the router:

1. Waits `backoffMs * 2^attempt` (detects rate limits → starts at 10s instead of 1s)
2. Retries up to `PROXY_RETRIES` times (default 10)
3. If all retries exhausted → tries the next provider in priority order
4. If all providers fail → returns error to the client

---

## Tips

- Changes to `.env` and `models.json` are **hot-reloaded immediately** via the dashboard — no restart needed
- The Dashboard Config tab has a drag-and-drop provider priority list with save
- Models tab supports per-provider model entries via a dropdown column
- For local models (Ollama, vLLM, LM Studio), no API key is needed
- The `default` key acts as catch-all for any unmapped model
- Rate limit errors (429, 413) get extended backoff compared to other errors
