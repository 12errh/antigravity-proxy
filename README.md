<p align="center">
  <img src="https://antigravity.google/assets/image/brand/antigravity-icon__full-color.png" alt="Antigravity" width="64" height="64">
</p>

<h1 align="center">Antigravity Proxy</h1>

<p align="center">Use <strong>any AI provider</strong> with <strong>Antigravity 2.0</strong> — NVIDIA, OpenRouter, OpenAI, Groq, Anthropic, Google Gemini, OpenCode Zen, or local models (Ollama, vLLM, LM Studio).</p>

<p align="center">
  <a href="https://github.com/12errh/antigravity-proxy/actions/workflows/ci.yml">
    <img src="https://github.com/12errh/antigravity-proxy/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node >=20">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform">
</p>

The proxy intercepts Antigravity's Google Gemini API calls and translates them to the target provider's format. Supports multi-provider failover with retry + exponential backoff, per-model per-provider routing via a matrix UI, reasoning effort control, and real-time hot-reload of all config.

---

## Requirements

- **Antigravity 2.0 Desktop** (Windows, macOS, or Linux)
- **Node.js 20+** (Node 18 is EOL — `undici@7` requires the `File` global added in Node 20)
- **Administrator / root privileges** (for port 443 binding; lower to 8443 if preferred)
- At least one API key from a supported cloud provider, or a local model server

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| Windows 10/11 | ✅ Tested | `start.ps1` handles cert install, port binding, and Antigravity launch |
| macOS | ⚠️ Untested | `start.sh` added with best-effort cert trust. **If you hit issues, [open an issue](../../issues).** |
| Linux | ⚠️ Untested | `start.sh` added with best-effort cert trust. **If you hit issues, [open an issue](../../issues).** |

> The proxy TypeScript code itself is fully cross-platform (Node.js 18+). Only the launcher scripts and TLS certificate trust steps are platform-specific. If you run into a problem on macOS or Linux, please open a GitHub issue with your OS version and the error message.

---

## Quick Start

```powershell
# Windows (PowerShell as Administrator)
.\start.ps1
```

```bash
# macOS / Linux  (⚠️ untested — report issues on GitHub)
chmod +x start.sh
./start.sh
# or without root: ./start.sh --port 8443
```

Then open **http://localhost:4000** in your browser to configure providers, model mappings, and view live stats.

---

## Feature Support

| Feature | Status |
|---------|--------|
| Multi-provider failover (priority chain) | ✅ |
| Per-model, per-provider routing matrix | ✅ |
| Retry + exponential backoff | ✅ |
| Per-provider retry cap (max 2 when multiple candidates) | ✅ |
| Hot-reload config & models (no restart) | ✅ |
| Chat & code generation | ✅ |
| Tool calling / function calling | ✅ |
| File operations (view, edit, create, search) | ✅ |
| Browser automation | ✅ |
| Image generation | ✅ |
| Vision / image understanding | ✅ |
| Streaming responses | ✅ |
| Thinking / reasoning (Gemini, Claude, DeepSeek) | ✅ |
| Reasoning effort control (DeepSeek R, NVIDIA stepfun, OpenAI o-series) | ✅ |
| Model switching | ✅ |
| Provider switching (drag-and-drop priority) | ✅ |
| Real-time dashboard | ✅ |
| Request history & live logs | ✅ |
| Config & model management UI | ✅ |
| Session-based history browsing | ✅ |
| Cost tracking & charts (per-day, per-model, per-provider) | ✅ |
| Single-day cost view | ✅ |
| SQLite persistence (survives restarts) | ✅ |
| Local model discovery (Ollama, vLLM, LM Studio, llama.cpp, TabbyAPI, LocalAI, LiteLLM, Aphrodite, text-generation-webui) | ✅ |
| Plugin architecture — dynamic provider registration | ✅ |
| Universal tool translation (alias resolution, type coercion, default filling) | ✅ |
| Model capability detection (auto-detect reasoning, vision, tool support from model name) | ✅ |
| Provider-specific adapter optimizations (Groq, Zen, NVIDIA) | ✅ |
| Provider model cache (10-min TTL, warm on startup) | ✅ |
| Rate limiting (global + per-provider) | ✅ |
| Blocklist (provider, model glob, content regex) | ✅ |
| Full-text search across requests / sessions / logs | ✅ |
| Keyboard shortcuts (`/` search, `r` refresh, `j`/`k` navigate) | ✅ |
| Collapsible sidebar | ✅ |
| Request replay with model selector | ✅ |
| Session compare (side-by-side) | ✅ |
| Dashboard basic auth (username + password, configurable from UI) | ✅ |
| TLS certificate info & expiry warning | ✅ |
| Failover webhook (configurable from UI) | ✅ |
| Provider failover timeline visualization | ✅ |
| Log rotation (size-based, configurable retention) | ✅ |
| Workspace context hardening (anti-confusion envelope) | ✅ |

---

## Supported Providers

| Provider | Type | Env Var | Notes |
|----------|------|---------|-------|
| **OpenRouter** | Cloud API | `OPENROUTER_API_KEY` | 300+ models in one key |
| **NVIDIA NIM** | Cloud API | `NVIDIA_API_KEY` | Free credits on signup |
| **OpenAI** | Cloud API | `OPENAI_API_KEY` | GPT-4o, o-series |
| **Groq** | Cloud API | `GROQ_API_KEY` | Ultra-fast LPU inference |
| **Anthropic** | Cloud API | `ANTHROPIC_API_KEY` | Claude 3.x / 4.x |
| **Google Gemini** | Cloud API | `GOOGLE_API_KEY` | Gemini 2.5 Pro/Flash |
| **OpenCode Zen** | Cloud gateway | `OPENCODE_API_KEY` | Claude, GPT, Gemini, Grok, Kimi, GLM — one key |
| **Ollama** | Local | *(none)* | Auto-discovered on port 11434 |
| **vLLM** | Local | *(none)* | Auto-discovered on port 8000 |
| **LM Studio** | Local | *(none)* | Auto-discovered on port 1234 |
| **llama.cpp** | Local | *(none)* | Auto-discovered on port 8080 |
| **text-generation-webui** | Local | *(none)* | Auto-discovered on port 5000 |
| **TabbyAPI** | Local | *(none)* | Auto-discovered on port 5000 |
| **LocalAI** | Local | *(none)* | Auto-discovered on port 8080 |
| **LiteLLM** | Local | *(none)* | Auto-discovered on port 4000 |
| **Aphrodite Engine** | Local | *(none)* | Auto-discovered on port 8000 |

---

## How It Works

```
┌─────────────────┐   TLS (443)   ┌──────────────┐  Provider API  ┌──────────────────┐
│  Antigravity    │ ────────────▶ │    Proxy     │ ─────────────▶ │  OpenRouter      │
│  2.0 Desktop    │               │ (TypeScript) │  ┌──────────▶  │  NVIDIA NIM      │
│                 │ ◀──────────── │              │  │             │  OpenAI          │
└─────────────────┘               └──────┬───────┘  │             │  Groq            │
                                          │          │             │  Anthropic       │
                                     HTTP (4000)     │             │  Google Gemini   │
                                          │          │             │  OpenCode Zen    │
                                 ┌────────┘          │             │  Ollama / vLLM   │
                                 │  Dashboard (SPA)  │             │  LM Studio       │
                                 │  - Live logs      │             └──────────────────┘
                                 │  - Request history│
                                 │  - Config editor  │
                                 │  - Model matrix   │
                                 │  - Provider priority            
                                 └───────────────────┘
```

**What the proxy does on each request:**

1. Receives Antigravity's Gemini API call on port 443 (TLS)
2. Strips massive inline context, injects a compact `agent-context.md` reference (hardened against context-confusion)
3. **Normalizes tool calls** — resolves aliases (`manageTask`→`manage_task`), coerces types (`"true"`→`true`), fills missing defaults
4. Routes through the **failover router**: iterates providers in priority order, retry + exponential backoff, cap 2 retries per provider when multiple candidates exist
5. Resolves the model name per provider using the **model matrix** (flat default + per-provider overrides)
6. **Detects model capabilities** from model name patterns (reasoning, vision, tool support)
7. Applies **reasoning effort** if configured for the resolved model (`reasoning_effort` param)
8. Translates to the target provider's API format using the **plugin architecture** (provider-specific adapters for Groq, Zen, NVIDIA) and streams the response back
9. Records the request to SQLite for cost tracking, history, and session browsing

---

## Dashboard Tabs

Open **http://localhost:4000** once the proxy is running:

| Tab | What it does |
|-----|--------------|
| **Dashboard** | Live stats (requests, tokens, tool calls, errors), provider status, env overview |
| **Requests** | Today's requests with expandable detail, replay with model selector, pagination |
| **Config** | Drag-and-drop provider priority, API keys, ports, retry, rate limits, blocklist, auth, webhook |
| **Models** | Per-provider model matrix — one row per alias, one column per provider. Double-click cell to pick from live catalog |
| **Browse Models** | Fetch live model catalog from any provider, multi-select, bulk-add into Models tab. Force-refresh bypasses 10-min cache |
| **Cost** | Per-day / per-model / per-provider cost charts + pricing editor. Filter by date or all-time |
| **Live Log** | Real-time SSE log stream with level filter, auto-scroll |
| **History** | Browse requests by date, full-text search across all requests |
| **Sessions** | Session log files, session compare side-by-side, per-session request list |
| **Model Options** | Reasoning effort per model — auto-detects DeepSeek R-series, NVIDIA stepfun, OpenAI o-series |

---

## Models Tab — Matrix Setup

The Models tab shows a **matrix**: one row per Antigravity model alias, one column per provider.

```
┌──────────────────┬────────────────────┬─────────────────────┬────────────────────┐
│ Model Alias      │ Default            │ OpenRouter          │ Zen                │
├──────────────────┼────────────────────┼─────────────────────┼────────────────────┤
│ claude-sonnet-4-6│ claude-sonnet-4-5  │ anthropic/claude... │ claude-sonnet-4-5  │
│ gemini-2.5-flash │ gemini-2.5-flash   │ google/gemini-2...  │ deepseek-v4-flash  │
│ gpt-4o           │ gpt-4o             │ openai/gpt-4o       │ gpt-4o             │
└──────────────────┴────────────────────┴─────────────────────┴────────────────────┘
```

- **Model Alias** — what Antigravity sends (e.g. `claude-sonnet-4-6`)
- **Default** — resolved model when no provider-specific cell is set
- **Provider columns** — exact model name to send to that provider when it's selected by the router
- **Empty cell** — use Default. Provider logo shows in filled cells.
- **Double-click** any provider cell to open the live model picker (populated from provider cache)
- **Column toggles** above the table let you hide providers you don't use
- Quick-add buttons: `+ Claude`, `+ Gemini`, `+ GPT` pre-fill common rows

---

## Model Options Tab — Reasoning Effort

Some models support a `reasoning_effort` parameter that controls how much thinking they do before answering:

| Model family | Supported effort levels |
|---|---|
| DeepSeek R-series (`deepseek-r1`, `deepseek-r2`, etc.) | `low` `medium` `high` `max` |
| NVIDIA stepfun (`stepfun`, `step-*`) | `low` `medium` `high` `max` |
| OpenAI o-series (`o1`, `o3`, `o4-mini`, etc.) | `low` `medium` `high` |
| Qwen Thinking, GLM Thinking, Kimi Thinking | `low` `medium` `high` |

The **Model Options** tab auto-detects which of your currently-mapped models support this feature and lets you set the level per model. You can also add manual overrides for any resolved model name.

Settings are persisted to `proxy/reasoning-effort.json` and applied to every request that resolves to that model — no restart needed.

---

## Config Tab — API Keys

| Key | Provider |
|-----|----------|
| `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) |
| `NVIDIA_API_KEY` | [build.nvidia.com](https://build.nvidia.com) — free credits on signup |
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| `GOOGLE_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `OPENCODE_API_KEY` | [opencode.ai/auth](https://opencode.ai/auth) — one key for Claude, GPT, Gemini, Grok, Kimi, GLM |

All keys are saved to `.env` and hot-reloaded — the proxy picks up a new key on the next request, no restart required.

---

## Architecture

```
antigravity/
├── agent-context.md              # Compact external-agent runtime identity
├── start.ps1                     # Windows launcher (Administrator)
├── README.md
├── CHANGELOG.md
├── docs/
│   ├── SETUP.md                  # Detailed setup guide
│   ├── CONFIGURATION.md          # Env var + JSON file reference
│   └── antigravity-v2-analysis.md# Reverse-engineered v2 network protocol
└── proxy/
    ├── src/
    │   ├── adapters/             # Provider adapters
    │   │   ├── openai.ts         #   OpenAI-compat (NVIDIA, OpenRouter, Groq, Zen, local)
    │   │   ├── anthropic.ts      #   Anthropic Messages API
    │   │   ├── google.ts         #   Google Gemini API
    │   │   ├── groq.ts           #   Groq-optimized (image stripping)
    │   │   ├── zen.ts            #   Zen-optimized (reasoning effort)
    │   │   ├── nvidia.ts         #   NVIDIA-optimized (reasoning effort)
    │   │   └── types.ts          #   StreamChunk / ModelAdapter interfaces
    │   ├── adapter.ts            # Provider → adapter factory (plugin-aware)
    │   ├── provider-plugin.ts    # IProviderPlugin interface + capabilities
    │   ├── provider-registry.ts  # Central plugin registry (singleton)
    │   ├── plugins/
    │   │   └── builtin-plugins.ts# 10 built-in provider plugin definitions
    │   ├── tool-capabilities.ts  # ToolCapabilityRegistry (schema + alias resolution)
    │   ├── tool-normalizer.ts    # normalizeToolCall (alias → canonical, type coercion)
    │   ├── model-capabilities.ts # Pattern-based model capability detection
    │   ├── router.ts             # Failover orchestrator: retry → backoff → next provider
    │   ├── models.ts             # Per-provider model resolver (hot-reload)
    │   ├── index.ts              # TLS handler, context stripping, SSE event builder
    │   ├── engine.ts             # Delegates to router, exports streamResponse
    │   ├── mapper.ts             # Google ↔ OpenAI format mapping
    │   ├── config.ts             # Multi-provider config, priority list, hot-reload
    │   ├── provider-cache.ts     # 10-min TTL cache for provider model lists
    │   ├── reasoning-effort.ts   # Per-model reasoning_effort config (auto-detect + persist)
    │   ├── antigravity-context.ts# System prompt injected for external models
    │   ├── workspace-context.ts  # Hardened context envelope (anti-hallucination)
    │   ├── auth.ts               # API key validation
    │   ├── auth-sessions.ts      # Dashboard session cookie auth
    │   ├── logger.ts             # File + console logging + SSE bus + log rotation
    │   ├── dashboard.ts          # Dashboard REST API + SSE server
    │   ├── db.ts                 # SQLite: requests, cost, sessions, logs
    │   ├── request-store.ts      # In-memory request ring buffer + search
    │   ├── rate-limiter.ts       # Global + per-provider rate limiting
    │   ├── blocklist.ts          # Provider / model / content blocklist
    │   ├── local-discovery.ts    # Auto-discover 9+ local inference solutions
    │   ├── http-pool.ts          # HTTP keep-alive + connection pooling
    │   ├── pricing.ts            # Per-model pricing config
    │   └── types.ts              # Google-format type definitions
    ├── dashboard/
    │   ├── index.html            # Dashboard SPA (zero build deps)
    │   └── login.html            # Auth login page
    ├── models.json               # Active model matrix (flat + per-provider)
    ├── pricing.json              # Per-model pricing ($/1M tokens)
    ├── reasoning-effort.json     # Per-model reasoning effort settings
    ├── blocklist.json            # Blocked providers / models / content patterns
    ├── .env                      # API keys, ports, retry config (not committed)
    ├── .env.example              # Template with all supported vars
    ├── certs/                    # Self-signed TLS cert (generated by setup)
    └── logs/                     # Timestamped log files (rotated by size)
```

---

## Environment Variables

```env
# Provider priority (first = primary, comma-separated)
PROVIDER_PRIORITY=openrouter,nvidia,zen

# API keys
OPENROUTER_API_KEY=sk-or-v1-...
NVIDIA_API_KEY=nvapi-...
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
OPENCODE_API_KEY=sk-...        # OpenCode Zen gateway

# Ports
PROXY_PORT=443                 # TLS port Antigravity connects to
API_PORT=4000                  # Dashboard + REST API port

# Retry & failover
PROXY_RETRIES=3                # Attempts per provider before failover
PROXY_BACKOFF_MS=100           # Initial backoff ms (doubles each retry)

# Rate limiting (0 = unlimited)
RATE_LIMIT_GLOBAL=0
RATE_LIMIT_PROVIDER=0
RATE_LIMIT_WINDOW_MS=60000

# Logging
LOG_LEVEL=info                 # debug | info | warn | error
LOG_MAX_SIZE_MB=10             # Rotate log when this size is reached
LOG_MAX_FILES=5                # Keep this many rotated files
LOG_MAX_AGE_DAYS=30            # Delete files older than this

# Dashboard auth (optional)
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=your_password

# Failover webhook (optional)
FAILOVER_WEBHOOK_URL=https://hooks.example.com/webhook

# Workspace context hardening (optional)
WORKSPACE_CONTEXT_ENVELOPE=strict   # off | loose | strict (default: strict)

# Inline context strip mode (optional)
CONTEXT_STRIP_MODE=strip            # strip (default) | passthrough
```

---

## Quick Links

- [Setup Guide](docs/SETUP.md)
- [Configuration Reference](docs/CONFIGURATION.md)
- [Antigravity v2 Protocol Analysis](docs/antigravity-v2-analysis.md)
- [CHANGELOG](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)

## License

MIT — see [LICENSE](LICENSE).
