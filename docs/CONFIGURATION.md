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
OPENCODE_API_KEY=sk-abc123...

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
| `WORKSPACE_CONTEXT_ENVELOPE` | Controls how agent-context.md is wrapped to prevent context-confusion (`off`, `loose`, `strict`) | `strict` |
| `AGENT_CONTEXT_PATH` | Absolute path to agent-context.md (defaults to two levels up from proxy/) | auto-detected |
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
| `zen` | `OPENCODE_API_KEY` | OpenAI-compat | `https://opencode.ai/zen/v1` |
| `ollama` | none | OpenAI-compat | `http://localhost:11434` |
| `vllm` | none | OpenAI-compat | `http://localhost:8000` |
| `lmstudio` | none | OpenAI-compat | `http://localhost:1234` |

---

## Model Mapping: `proxy/models.json`

Controls which AI model the router sends to each provider for each Antigravity model name. Two ways to think about it:

- **Flat map** — one resolved model per Antigravity alias, used by every provider
- **Per-provider overrides** — same Antigravity alias, different resolved model per provider

Both live in the same `models.json` file. The dashboard Models tab edits them through a single matrix view.

### File structure

```json
{
  "_comment": "Optional. Free-form note shown in the dashboard header.",
  "default": "deepseek-ai/deepseek-v4-flash",
  "claude-sonnet-4-6": "deepseek-ai/deepseek-v4-flash",
  "_provider_models": {
    "claude-sonnet-4-6": {
      "google": "gemini-2.5-pro",
      "openrouter": "anthropic/claude-sonnet-4.5",
      "zen": "claude-sonnet-4-6",
      "nvidia": "stepfun-ai/step-3.7-flash"
    },
    "gpt-oss-120b": {
      "nvidia": "deepseek-ai/deepseek-v4-flash",
      "openrouter": "openai/gpt-oss-120b"
    }
  }
}
```

- Top-level keys (except `_comment` / `_provider_models` / `default`) are **flat defaults** per Antigravity model ID
- `_provider_models[antigravityModel][providerId]` are **per-provider overrides**
- `default` is the global fallback for any Antigravity model ID that isn't mapped anywhere

### Lookup order

When Antigravity asks for model `X` and the router picks provider `P`:

1. **Per-provider** — `_provider_models[X][P]` if set → use it
2. **Flat default** — `X` in the top-level keys → use it
3. **Global default** — `default` → use it
4. **Provider default** — code-level fallback in `models.ts` (`getDefaultModel`)

> **Important:** if `_provider_models[X]` is set to *any* provider, the router **only considers those providers** (in priority order). Providers without an entry in the override map are skipped for that model. This is how you route "Claude requests only to Zen/OpenRouter" without affecting other models.

---

## Models Tab — UI Walkthrough

Open **http://localhost:4000 → Models**.

### The matrix

```
┌────────────────────┬─────────────────┬─────────────┬─────────────┬─────────────┬─────────────┐
│ Model              │ Default         │ Google      │ OpenRouter  │ NVIDIA      │ Zen         │ ✕
├────────────────────┼─────────────────┼─────────────┼─────────────┼─────────────┼─────────────┤
│ claude-sonnet-4-6  │ gemini-2.5-pro  │ gemini-2... │ anthropic...│ stepfun-... │ claude-so.. │ ✕
│ gemini-2.5-flash   │ gemini-2.5-flash│ gemini-2... │ google/...  │ stepfun-... │ gemini-2... │ ✕
│ gpt-5              │ (use code def.) │             │ openai/gpt-5│             │ gpt-5       │ ✕
└────────────────────┴─────────────────┴─────────────┴─────────────┴─────────────┴─────────────┘
```

- **Model** column — the Antigravity model ID (e.g. `claude-sonnet-4-6`)
- **Default** column — fallback resolved model when no provider cell is filled
- **One column per provider** — the resolved model to use for that provider
- **✕** — delete the row

Rows are auto-sorted and color-coded by family:

| Color | Family |
|-------|--------|
| Pink | Claude / Opus / Sonnet |
| Blue | Gemini |
| Green | GPT / GPT-OSS |
| Orange | Grok |
| Purple | Kimi / Moonshot |
| Gray | Qwen / Llama / DeepSeek / other |

### Quick add presets

Above the matrix, a button bar gives you one-click insertion of common model rows:

- `+ Claude (Anthropic)` — adds `claude-sonnet-4-6` with Zen, OpenRouter, Google, NVIDIA cells pre-filled
- `+ Gemini Pro` — adds `gemini-2.5-pro` with the four main providers filled
- `+ Gemini Flash` — adds `gemini-2.5-flash` with the four main providers filled
- `+ GPT-5` — adds `gpt-5` with OpenAI, OpenRouter, Zen, NVIDIA cells
- `+ Grok` — adds `grok-3` with OpenRouter, Zen, NVIDIA
- `+ Kimi` — adds `kimi-k2` with OpenRouter, Zen, NVIDIA
- `+ Empty row` — adds a blank row you can fill manually

### Editing cells

Each cell is a text input. You can type any model name the target provider accepts.

- **Filled cells** — solid background, normal text
- **Empty cells** — dashed border, italic placeholder `— use default —`

**Double-click any provider cell** to open a popover picker showing the live model catalog for that provider. The picker is searchable. The catalog is populated by the **Browse tab** (click Fetch to load the catalog for any provider — it caches for 10 minutes). If the catalog is empty, switch to the Browse tab and click **Fetch** for that provider first.

### Saving

Click **Save** in the quick-add bar. The matrix is serialized to `models.json` and the router is hot-reloaded — your changes take effect on the **next request**, no restart needed.

### Common scenarios

#### "I only use OpenRouter"

Add one row, fill the OpenRouter cell, leave the rest blank:

| Model | Default | OpenRouter |
|-------|---------|------------|
| `claude-sonnet-4-6` | `anthropic/claude-sonnet-4.5` | `anthropic/claude-sonnet-4.5` |
| `gemini-2.5-pro` | `google/gemini-2.5-pro` | `google/gemini-2.5-pro` |
| `gemini-2.5-flash` | `google/gemini-2.5-flash` | `google/gemini-2.5-flash` |

OpenRouter is in your `PROVIDER_PRIORITY` first, so it wins. Done.

#### "I want different providers for different model families"

Add one row per family, fill only the cells you want:

| Model | Default | Google | OpenRouter | NVIDIA | Zen |
|-------|---------|--------|------------|--------|-----|
| `claude-sonnet-4-6` | _(empty)_ | `gemini-2.5-pro` | `anthropic/claude-4.5` | | `claude-sonnet-4-6` |
| `gemini-2.5-pro` | _(empty)_ | `gemini-2.5-pro` | | | |
| `gemini-2.5-flash` | _(empty)_ | `gemini-2.5-flash` | | `stepfun-ai/step-3.7-flash` | `gemini-2.5-flash` |

The router will only consider filled providers per row. Note that `claude-sonnet-4-6` here has Google/OpenRouter/Zen in its override map — NVIDIA and others won't be tried, even if they're higher in `PROVIDER_PRIORITY`.

#### "I want a free-only stack"

| Model | Default | NVIDIA | OpenRouter | Google |
|-------|---------|--------|------------|--------|
| `claude-sonnet-4-6` | `stepfun-ai/step-3.7-flash` | `stepfun-ai/step-3.7-flash` | | |
| `gemini-2.5-flash` | `stepfun-ai/step-3.7-flash` | `stepfun-ai/step-3.7-flash` | | |

`stepfun-ai/step-3.7-flash` and `deepseek-ai/deepseek-v4-flash` on NVIDIA are free.

#### "A model keeps failing on Zen with tool-call errors"

If the free `minimax-m3-free` model on Zen rejects tool calls, edit the row to remove Zen from the override map (or move Zen below a working provider in priority). The browser's DevTools → Network tab will show the exact 400 error; the proxy's Live Log will show which model rejected the tool call.

---

## Pricing: `proxy/pricing.json`

Tracks USD cost per 1M tokens for every (provider, model) pair, used by the Cost tab charts.

```json
{
  "$meta": { "autoFree": true },
  "openrouter": {
    "default": { "input": 3, "output": 15 },
    "anthropic/claude-sonnet-4.5": { "input": 3, "output": 15 }
  },
  "google": {
    "default": { "input": 1.25, "output": 5 }
  }
}
```

- **`$meta.autoFree`** — when `true`, any unmapped model is treated as free (cost 0)
- **Provider block** — one per provider in `PROVIDER_PRIORITY`
- **`default`** — the fallback price when no model-specific entry matches
- **Model entries** — override `default` for that specific model

Edit from the **Cost tab → Pricing editor** in the dashboard, or directly in `pricing.json`. Changes are hot-reloaded.

---

## Retry & Failover Behavior

When a provider returns an error, the router:

1. Waits `backoffMs * 2^attempt` (detects rate limits → starts at 10s instead of 1s)
2. Retries up to `PROXY_RETRIES` times (default 10)
3. If all retries exhausted → tries the next provider in priority order
4. If all providers fail → returns error to the client

---

## Tips

- Changes to `.env`, `models.json`, and `pricing.json` are **hot-reloaded immediately** via the dashboard — no restart needed
- The Dashboard Config tab has a drag-and-drop provider priority list with save
- The Models tab matrix view shows one row per Antigravity model, one cell per provider — empty cells = use Default
- Double-click any provider cell to pick from that provider's live model catalog (loaded from the Browse tab)
- The Browse tab caches each provider's model list for 10 minutes — click Refresh to force-refresh
- For local models (Ollama, vLLM, LM Studio), no API key is needed but the local server must be running
- The `default` key in `models.json` and `pricing.json` acts as catch-all for any unmapped model
- Rate limit errors (429, 413) get extended backoff compared to other errors
- `_provider_models` overrides scope the candidate provider list — if you set an override for a model, only those providers will be tried
