# Antigravity Proxy

Use **NVIDIA** or **OpenRouter** models with **Antigravity 2.0** — no Gemini subscription required.

The proxy intercepts Antigravity's Google Gemini API calls and translates them to OpenAI-format requests for NVIDIA or OpenRouter. Tool calls, streaming, thinking/reasoning — all work transparently.

## Quick Start

```powershell
.\setup.ps1
# Pick provider, enter API key, done
```

## What Works

| Feature | Status | Notes |
|---------|--------|-------|
| Chat / code generation | ✅ Works | All text interactions with any OpenAI-compatible model |
| Tool / function calling | ✅ Works | Antigravity agents use tools through the proxy — `list_dir`, `view_file`, `grep_search`, `run_command` |
| Model switching | ✅ Works | Edit `proxy/models.json` — map any Antigravity model name to any provider model ID |
| Provider switching | ✅ Works | Run `setup.ps1` again or edit `proxy/.env` |
| Thinking / reasoning | ✅ Works | Models that support `reasoning_effort` (DeepSeek, StepFun) show thoughts in Antigravity's UI |
| Rate limit retry | ✅ Works | Automatic exponential backoff (1s → 2s → 4s → 8s) for 429 responses |
| Context stripping | ✅ Works | Removes 30+ skill packages, plugin lists, and user rules (~4000 tokens) — injects compact `agent-context.md` reference instead |
| Desktop UI compatibility | ✅ Works | All response metadata (safetyRatings, groundingMetadata, index: 0) included for Antigravity Desktop |
| Streaming | ✅ Works | Text and tool calls arrive as SSE events |
| Parallel tool calls | ✅ Works | Multiple tool calls grouped into single `parts` array |
| Extra args protection | ✅ Works | Antigravity internal fields (`toolAction`, `toolSummary`) stripped from tool call arguments |
| Language Server crashes | ⚠️ Fragile | Antigravity Language Server (Go binary) crashes on any API error — not fixable in proxy |
| File read/write (tool calls) | ✅ Works | `view_file`, `write_to_file`, `list_dir` etc. go through intercepted chat paths |
| Browser automation | ✅ Works | MCP Chrome DevTools plugin — local tools, no Google API needed |
| Image generation | ✅ Works | Built-in Antigravity tool, handled locally |
| Vision / screenshot | ✅ Works | Browser screenshots and file preview via local tools |
| Background file sync | ❌ Not intercepted | Language Server init calls to Google — needs Gemini key for sidebar/project sync |
| Audio | ❌ Not intercepted | Not mapped |

## How It Works

```
┌─────────────────┐     TLS (443)     ┌──────────────┐   OpenAI API   ┌──────────────────┐
│  Antigravity    │ ────────────────▶ │    Proxy     │ ─────────────▶ │  NVIDIA / OpenRouter │
│  2.0 Desktop    │                   │  (TypeScript) │                │  (any model)      │
│                 │ ◀──────────────── │              │ ◀───────────── │                   │
└─────────────────┘                   └──────────────┘                └──────────────────┘
                                             │
                                        REST (4000)
                                             │
                                    ┌────────┴────────┐
                                    │  Google Gemini   │
                                    │  (init calls)    │
                                    └─────────────────┘
```

The proxy:
1. Intercepts Antigravity's Gemini API calls on port 443 (TLS)
2. Strips massive inline context (skills, plugins, rules) and injects a reference to `agent-context.md`
3. Translates Google-format requests to OpenAI-format and sends to your chosen provider
4. Translates responses back to Google format with proper metadata for Antigravity Desktop
5. Forwards non-chat requests (init, file ops, browser) to the real Google API — needs a valid Gemini API key for those

## Requirements

- **Windows** — Antigravity is Windows-only
- **Node.js 18+**
- **Administrator privileges** (for port 443 binding)
- API key from [NVIDIA build.nvidia.com](https://build.nvidia.com) or [OpenRouter](https://openrouter.ai/keys)
- (Optional) **Google Gemini API key** — only needed for file/browser/vision operations that pass through to Google

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
│   │   ├── logger.ts         # File + console logging
│   │   └── types.ts          # Google-format type definitions
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

## Quick Links

- [Setup Guide](docs/SETUP.md) — step-by-step installation
- [Configuration Guide](docs/CONFIGURATION.md) — model mapping, provider config
- [agent-context.md](agent-context.md) — external model runtime identity

## License

MIT
