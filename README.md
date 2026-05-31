# Antigravity Proxy

Use **NVIDIA** or **OpenRouter** models with **Antigravity 2.0** — no Gemini subscription required.

The proxy intercepts Antigravity's Google Gemini API calls and translates them to OpenAI-format requests for NVIDIA or OpenRouter. Tool calls, streaming, thinking/reasoning — all work transparently.

## Quick Start

```powershell
.\setup.ps1
# Pick provider, enter API key, done
```

The proxy transparently translates between Antigravity's protocol and OpenAI-compatible APIs on NVIDIA or OpenRouter.

## Feature Support

| Feature | Status |
|---------|--------|
| Chat & code generation | ✅ |
| Tool calling / function calling | ✅ |
| File operations (view, edit, create, search) | ✅ |
| Browser automation | ✅ |
| Image generation | ✅ |
| Vision / image understanding | ✅ |
| Streaming responses | ✅ |
| Thinking / reasoning | ✅ |
| Model switching | ✅ |
| Provider switching (NVIDIA ↔ OpenRouter) | ✅ |
| Real-time dashboard | ✅ |
| Request history & live logs | ✅ |
| Config & model management UI | ✅ |

## How It Works

```
┌─────────────────┐     TLS (443)     ┌──────────────┐   OpenAI API   ┌──────────────────┐
│  Antigravity    │ ────────────────▶ │    Proxy     │ ─────────────▶ │  NVIDIA / OpenRouter │
│  2.0 Desktop    │                   │  (TypeScript) │                │  (any model)      │
│                 │ ◀──────────────── │              │ ◀───────────── │                   │
└─────────────────┘                   └──────┬───────┘                └──────────────────┘
                                              │
                                         HTTP (4000)
                                              │
                                     ┌────────┘
                                     │  Dashboard (SPA)
                                     │  - Live logs
                                     │  - Request history
                                     │  - Config editor
                                     │  - Model mapping
                                     └────────
```

The proxy:
1. Intercepts Antigravity's Gemini API calls on port 443 (TLS)
2. Strips massive inline context (skills, plugins, rules) and injects a reference to `agent-context.md`
3. Translates Google-format requests to OpenAI-format and sends to your chosen provider
4. Translates responses back to Google format with proper metadata for Antigravity Desktop
5. Serves a real-time dashboard on port 4000 with live logs, request history, config editor, and model mapping

Open **http://localhost:4000** in your browser to access the dashboard. in your browser for the dashboard — real-time logs, request history, config editor, model mapping, and stats.

## Requirements

- **Windows** — Antigravity is Windows-only
- **Node.js 18+**
- **Administrator privileges** (for port 443 binding)
- API key from [NVIDIA build.nvidia.com](https://build.nvidia.com) or [OpenRouter](https://openrouter.ai/keys)

## Architecture

```
antigravity/
├── agent-context.md          # Compact external-agent runtime identity (~150 lines)
├── setup.ps1                 # Interactive installer and launcher
├── README.md
├── docs/
│   ├── SETUP.md              # Detailed setup guide
│   └── CONFIGURATION.md      # Model mapping and provider config
├── proxy/
│   ├── src/
│   │   ├── index.ts          # TLS handler, context stripping, Google event builder
│   │   ├── engine.ts         # OpenAI streaming, rate limit retry, arg stripping
│   │   ├── mapper.ts         # Bidirectional Google ↔ OpenAI format mapping
│   │   ├── config.ts         # Provider selection, API keys, base URLs
│   │   ├── antigravity-context.ts  # Compact system prompt injected for external models
│   │   ├── auth.ts           # API key validation
│   │   ├── logger.ts         # File + console logging + SSE event bus
│   │   ├── dashboard.ts      # Dashboard REST API + SSE server
│   │   ├── request-store.ts  # In-memory request history ring buffer
│   │   └── types.ts          # Google-format type definitions
│   ├── dashboard/
│   │   └── index.html        # Dashboard SPA (0 build deps)
│   ├── models.json           # Active model mapping (edit this!)
│   ├── models.nvidia.json    # Defaults for NVIDIA
│   ├── models.openrouter.json # Defaults for OpenRouter
│   ├── .env                  # Provider + API key config
│   ├── certs/                # Self-signed TLS certificates
│   └── logs/                 # Timestamped log files
```

## Tested Models

These models have been tested successfully with the proxy:

### NVIDIA NIM
| Model ID | Notes |
|----------|-------|
| `deepseek-ai/deepseek-v4-flash` | Proven 200B+ model — reliable for tool chaining |
| `stepfun-ai/step-3.7-flash` | v3.7 (200B+) — works well for multi-turn agentic tasks |

### OpenRouter
Any OpenAI-compatible model on OpenRouter should work. Test your preferred models by updating `proxy/models.json`.

## Dashboard

Once the proxy is running, open **http://localhost:4000** in your browser:

- **Dashboard** — live stats (requests, tokens, tool calls, errors), provider info, environment overview
- **Requests** — searchable request history with expandable detail view and pagination (model, tokens, content, tool calls, timing)
- **History** — browse requests by date with date picker and date chips showing per-day counts
- **Config** — edit provider, API keys, ports, and log level via UI (saves to `.env`)
- **Models** — add/remove/edit model mappings in real time (saves to `models.json`)
- **Live Log** — real-time log stream with level filter and auto-scroll

All data updates in real time via SSE — no page refresh needed.

## Quick Links

- [Setup Guide](docs/SETUP.md) — step-by-step installation
- [Configuration Guide](docs/CONFIGURATION.md) — model mapping, provider config
- [agent-context.md](agent-context.md) — external model runtime identity

## License

MIT
