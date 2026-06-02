<p align="center">
  <img src="https://antigravity.google/assets/image/brand/antigravity-icon__full-color.png" alt="Antigravity" width="64" height="64">
</p>

<h1 align="center">Antigravity Proxy</h1>

<p align="center">Use <strong>any provider</strong> with <strong>Antigravity 2.0</strong> — NVIDIA, OpenRouter, OpenAI, Groq, Anthropic, Google Gemini, or local models (Ollama, vLLM, LM Studio).</p>

The proxy intercepts Antigravity's Google Gemini API calls and translates them to the target provider's format. Supports multi-provider failover with retry + exponential backoff, per-model provider routing, and real-time hot-reload of all config.

## Quick Start

```powershell
.\setup.ps1
# Follow prompts to configure providers and API keys
```

## Feature Support

| Feature | Status |
|---------|--------|
| Multi-provider failover (priority chain) | ✅ |
| Per-model provider routing | ✅ |
| Retry + exponential backoff | ✅ |
| Hot-reload config & models (no restart) | ✅ |
| Chat & code generation | ✅ |
| Tool calling / function calling | ✅ |
| File operations (view, edit, create, search) | ✅ |
| Browser automation | ✅ |
| Image generation | ✅ |
| Vision / image understanding | ✅ |
| Streaming responses | ✅ |
| Thinking / reasoning (Gemini, Claude) | ✅ |
| Model switching | ✅ |
| Provider switching (drag-and-drop priority) | ✅ |
| Real-time dashboard | ✅ |
| Request history & live logs | ✅ |
| Config & model management UI | ✅ |
| Session-based history browsing | ✅ |
| Cost tracking & charts (per-day, per-model, per-provider) | ✅ |
| SQLite persistence (survives restarts) | ✅ |
| Local model discovery (Ollama, vLLM, LM Studio) | ✅ |
| Rate limiting (global + per-provider) | ✅ |
| Blocklist (provider, model glob, content regex) | ✅ |
| Full-text search across requests/sessions/logs | ✅ |
| Keyboard shortcuts (`/` search, `r` refresh, `j`/`k` navigate) | ✅ |
| Collapsible sidebar | ✅ |
| Request replay with model selector | ✅ |
| Session compare (side-by-side) | ✅ |
| Dashboard basic auth (configurable from UI) | ✅ |
| TLS certificate info & expiry warning | ✅ |
| Failover webhook (configurable from UI) | ✅ |
| Provider failover timeline visualization | ✅ |

## Supported Providers

| Provider | Type | Auth |
|----------|------|------|
| **OpenRouter** | Cloud API | API key |
| **NVIDIA NIM** | Cloud API | API key |
| **OpenAI** | Cloud API | API key |
| **Groq** | Cloud API | API key |
| **Anthropic (Claude)** | Cloud API | API key |
| **Google Gemini** | Cloud API | API key |
| **Ollama** | Local | None |
| **vLLM** | Local | None |
| **LM Studio** | Local | None |

## How It Works

```
┌─────────────────┐     TLS (443)     ┌──────────────┐   Provider API   ┌──────────────────┐
│  Antigravity    │ ────────────────▶ │    Proxy     │ ───────────────▶ │  OpenRouter      │
│  2.0 Desktop    │                   │  (TypeScript) │   ┌───────────▶  │  NVIDIA           │
│                 │ ◀──────────────── │              │   │              │  OpenAI           │
└─────────────────┘                   └──────┬───────┘   │              │  Groq             │
                                              │           │              │  Anthropic        │
                                         HTTP (4000)      │              │  Google           │
                                              │           │              │  Ollama / vLLM    │
                                     ┌────────┘           │              │  LM Studio        │
                                     │  Dashboard (SPA)   │              └──────────────────┘
                                     │  - Live logs       │
                                     │  - Request history │
                                     │  - Config editor   │
                                     │  - Model mapping   │
                                     │  - Provider priority│
                                     └────────────────────┘
```

The proxy:
1. Intercepts Antigravity's Gemini API calls on port 443 (TLS)
2. Strips massive inline context and injects a reference to `agent-context.md`
3. Routes the request through the **failover router**: iterates providers in priority order, with retry + exponential backoff
4. Resolves the model name per-provider (flat map or `_provider_models` override)
5. Translates to the target provider's API format and streams the response back
6. Serves a real-time dashboard on port 4000 with live logs, config editor, model mapping, and provider priority management

## Requirements

- **Windows** — Antigravity is Windows-only
- **Node.js 18+**
- **Administrator privileges** (for port 443 binding)
- At least one API key from a supported provider

## Architecture

```
antigravity/
├── agent-context.md          # Compact external-agent runtime identity (~150 lines)
├── setup.ps1                 # Interactive installer and launcher
├── README.md
├── docs/
│   ├── SETUP.md              # Detailed setup guide
│   ├── CONFIGURATION.md      # Model mapping and provider config
│   └── v2-plan.md            # Multi-provider engineering spec
├── proxy/
│   ├── src/
│   │   ├── adapters/         # Provider adapters (openai, anthropic, google)
│   │   │   ├── openai.ts     #   OpenAI-compatible streaming (NVIDIA, OpenRouter, Groq, local)
│   │   │   ├── anthropic.ts  #   Anthropic Messages API streaming
│   │   │   ├── google.ts     #   Google Gemini streaming
│   │   │   └── types.ts      #   Shared StreamChunk / ModelAdapter types
│   │   ├── adapter.ts        # Provider → adapter registry with defaults
│   │   ├── router.ts         # Failover orchestrator: retry → backoff → next provider
│   │   ├── models.ts         # Per-provider model resolver with hot-reload
│   │   ├── index.ts          # TLS handler, context stripping, Google event builder
│   │   ├── engine.ts         # Delegates to router, exports streamResponse/generateResponse
│   │   ├── mapper.ts         # Bidirectional Google ↔ OpenAI format mapping
│   │   ├── config.ts         # Multi-provider config, priority list, hot-reload
│   │   ├── antigravity-context.ts  # Compact system prompt injected for external models
│   │   ├── auth.ts           # API key validation
│   │   ├── logger.ts         # File + console logging + SSE event bus
│   │   ├── dashboard.ts      # Dashboard REST API + SSE server + hot-reload endpoint
│   │   ├── request-store.ts  # In-memory request history ring buffer
│   │   └── types.ts          # Google-format type definitions
│   ├── dashboard/
│   │   └── index.html        # Dashboard SPA (0 build deps)
│   ├── models.json           # Active model mapping (flat + per-provider overrides)
│   ├── .env                  # Provider priority, API keys, ports, retry config
│   ├── certs/                # Self-signed TLS certificates
│   └── logs/                 # Timestamped log files
```

## Dashboard

Once the proxy is running, open **http://localhost:4000** in your browser:

- **Dashboard** — live stats (requests, tokens, tool calls, errors), provider info, environment overview
- **Requests** — searchable request history with expandable detail view and pagination
- **History** — browse requests by session/date with date picker and per-day counts
- **Config** — drag-and-drop provider priority, API keys, ports, retry config, log level (hot-reloaded immediately)
- **Models** — add/remove/edit model mappings with optional per-provider overrides (hot-reloaded immediately)
- **Live Log** — real-time log stream with level filter and auto-scroll

All data updates in real time via SSE — no page refresh needed.

## Quick Links

- [Setup Guide](docs/SETUP.md) — step-by-step installation
- [Configuration Guide](docs/CONFIGURATION.md) — model mapping, provider config
- [agent-context.md](agent-context.md) — external model runtime identity

## License

MIT
