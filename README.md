# Antigravity Proxy

<p align="center">
  <img src="https://antigravity.google/assets/image/brand/antigravity-icon__full-color.png" alt="Antigravity" width="64" height="64">
</p>

<h1 align="center">Antigravity Proxy</h1>

<p align="center"><strong>Use any AI provider</strong> with <strong>Antigravity 2.0</strong> — NVIDIA, OpenRouter, OpenAI, Groq, Anthropic, Google Gemini, OpenCode Zen, OpenCode Go, or 9+ local inference solutions.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@12errh/antigravity-proxy">
    <img src="https://img.shields.io/npm/v/@12errh/antigravity-proxy.svg" alt="npm version">
  </a>
  <a href="https://www.npmjs.com/package/@12errh/antigravity-proxy">
    <img src="https://img.shields.io/npm/dm/@12errh/antigravity-proxy.svg" alt="npm downloads">
  </a>
  <a href="https://github.com/12errh/antigravity-proxy/actions/workflows/ci.yml">
    <img src="https://github.com/12errh/antigravity-proxy/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node >=20">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform">
</p>

---

## Quick Install

```bash
npm install -g @12errh/antigravity-proxy
antigravity setup    # interactive wizard — picks provider, enters API key, configures port
antigravity start    # starts proxy + dashboard + launches Antigravity desktop
```

> **No clone required.** The npm package includes everything: CLI, proxy, dashboard, certs, and all providers. Install once, run anywhere.

---

## Quick Start

### Prerequisites

- **Antigravity 2.0 Desktop** (Windows, macOS, or Linux)
- **Node.js 20+** 
- **Administrator/root privileges** (port 443; can use 8443 without admin)
- At least one API key or local model server

### Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| **Windows 10/11** | ✅ Tested | CLI handles cert install, port binding, and launch |
| **macOS** | ⚠️ Untested | CLI with best-effort cert trust. Report issues on GitHub. |
| **Linux** | ⚠️ Untested | CLI with best-effort cert trust. Report issues on GitHub. |

> TypeScript code is cross-platform. Only TLS cert trust is platform-specific.

### Launch via CLI (recommended)

```bash
npm install -g @12errh/antigravity-proxy
antigravity start                    # background mode — runs silently, launches desktop
antigravity start --foreground       # foreground mode — see live logs in terminal
antigravity start --port 8443        # no admin needed
antigravity start --trust-cert       # auto-trust TLS certificate
antigravity stop                     # stop everything cleanly
```

### Launch from source (development)

**Get the Repository**

```bash
git clone https://github.com/12errh/antigravity-proxy.git
cd antigravity-proxy
```

**Windows (PowerShell as Administrator)**

```powershell
.\start.ps1
```

**macOS / Linux**

```bash
chmod +x start.sh
./start.sh
```

**Without admin (port 8443)**

```bash
./start.sh --port 8443
```

Then open **http://localhost:4000** in your browser to configure providers, model mappings, and view live stats.

---

## 🎯 Key Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Multi-provider failover** | ✅ | Priority chain with exponential backoff |
| **Per-model routing** | ✅ | One row per model alias, one column per provider |
| **Retry + backoff** | ✅ | Configurable per-provider and global |
| **Hot-reload config** | ✅ | No restart needed for changes |
| **Tool normalization** | ✅ | Alias resolution, type coercion, default filling |
| **Model capability detection** | ✅ | Auto-detect reasoning, vision, tools |
| **Provider optimizations** | ✅ | Groq (image stripping), Zen/NVIDIA (reasoning effort) |
| **Real-time dashboard** | ✅ | Live logs, stats, config editor |
| **Cost tracking** | ✅ | Per-day, per-model, per-provider |
| **Local discovery** | ✅ | 9+ inference solutions auto-detected |
| **Full-text search** | ✅ | Search requests, sessions, logs |
| **Blocklist** | ✅ | Provider, model, content filtering |
| **Session comparison** | ✅ | Side-by-side session analysis |

---

## 🚀 How It Works

```mermaid
graph TD
    A[Antigravity 2.0 Desktop] --> B[TLS 443]
    B --> C[Proxy]
    C --> D[Cloud APIs]
    C --> E[Local APIs]
    C --> F[Dashboard]
    
    D --> G[OpenRouter]
    D --> H[NVIDIA]
    D --> I[OpenAI]
    D --> J[Groq]
    D --> K[Anthropic]
    D --> L[Google Gemini]
    D --> M[Zen]
    
    E --> N[Ollama]
    E --> O[vLLM]
    E --> P[LM Studio]
    E --> Q[llama.cpp]
    
    F --> R[Live Logs]
    F --> S[Request History]
    F --> T[Config Editor]
    F --> U[Model Matrix]
    F --> V[Provider Priority]
```

### Per Request Pipeline

1. **TLS Intercept** — Receives Gemini API call on port 443
2. **Context Stripping** — Removes bulk context, injects compact `agent-context.md` reference
3. **Tool Normalization** — Resolves aliases, coerces types, fills defaults
4. **Model Resolution** — Routes through priority order with retry + backoff
5. **Capability Detection** — Auto-detects reasoning/vision/tool support
6. **Reasoning Effort** — Applies `reasoning_effort` if configured
7. **Translation** — Converts to target provider's API format
8. **Streaming** — Returns SSE response wrapped in Gemini format
9. **Logging** — Records to SQLite for cost tracking, history, sessions

---

## 📊 Supported Providers

### Cloud APIs

| Provider | Type | Env Var | Notes |
|----------|------|---------|-------|
| **OpenRouter** | Cloud API | `OPENROUTER_API_KEY` | 300+ models in one key |
| **NVIDIA NIM** | Cloud API | `NVIDIA_API_KEY` | Free credits on signup |
| **OpenAI** | Cloud API | `OPENAI_API_KEY` | GPT-4o, o-series |
| **Groq** | Cloud API | `GROQ_API_KEY` | Ultra-fast LPU inference |
| **Anthropic** | Cloud API | `ANTHROPIC_API_KEY` | Claude 3.x / 4.x |
| **Google Gemini** | Cloud API | `GOOGLE_API_KEY` | Gemini 2.5 Pro/Flash |
| **OpenCode Zen** | Cloud gateway | `OPENCODE_API_KEY` | Claude, GPT, Gemini, Grok, Kimi, GLM — one key |
| **OpenCode Go** | Cloud gateway | `OPENCODE_GO_API_KEY` | DeepSeek, Qwen, MiniMax, GLM, Kimi, MiMo — $10/mo |

### Local Inference

| Provider | Type | Notes |
|----------|------|-------|
| **Ollama** | Local | Auto-discovered on port 11434 |
| **vLLM** | Local | Auto-discovered on port 8000 |
| **LM Studio** | Local | Auto-discovered on port 1234 |
| **llama.cpp** | Local | Auto-discovered on port 8080 |
| **text-generation-webui** | Local | Auto-discovered on port 5000 |
| **TabbyAPI** | Local | Auto-discovered on port 5000 |
| **LocalAI** | Local | Auto-discovered on port 8080 |
| **LiteLLM** | Local | Auto-discovered on port 4000 |
| **Aphrodite Engine** | Local | Auto-discovered on port 8000 |

---

## 📋 Models Tab — Matrix

The Models tab shows a matrix: one row per Antigravity model alias, one column per provider.

```mermaid
graph TD
    A[Model Alias] --> B[Default]
    A --> C[OpenRouter]
    A --> D[Zen]
    
    E[claude-sonnet-4-6] --> F[claude-sonnet-4-5]
    E --> G[anthropic/claude-3-5-sonnet-20241022]
    E --> H[claude-sonnet-4-5]
    
    I[gemini-2.5-flash] --> J[gemini-2.5-flash]
    I --> K[google/gemini-2.0-flash-exp]
    I --> L[deepseek-v4-flash]
    
    M[gpt-4o] --> N[openai/gpt-4o]
    M --> O[openai/gpt-4o]
```

**Features:**
- Double-click any cell to open live model picker
- Column toggles to hide unused providers
- Quick-add buttons (`+ Claude`, `+ Gemini`, `+ GPT`)
- Empty cells use Default value
- Provider logos in filled cells

---

## 🧠 Model Options — Reasoning Effort

Some models support `reasoning_effort` to control thinking depth:

| Model family | Levels |
|--------------|--------|
| DeepSeek R-series | low, medium, high, max |
| NVIDIA stepfun | low, medium, high, max |
| OpenAI o-series | low, medium, high |
| Qwen Thinking, GLM Thinking, Kimi | low, medium, high |

**Auto-detection:** The Model Options tab detects supported models and lets you set levels per model. Settings persist in `proxy/reasoning-effort.json` without restart.

---

## ⚙️ Config Tab — API Keys

| Key | Provider |
|-----|----------|
| `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) |
| `NVIDIA_API_KEY` | [build.nvidia.com](https://build.nvidia.com) — free credits on signup |
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| `GOOGLE_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `OPENCODE_API_KEY` | [opencode.ai/auth](https://opencode.ai/auth) — one key for Claude, GPT, Gemini, Grok, Kimi, GLM |

All keys are hot-reloaded from `.env` — no restart needed.

---

## 🏗️ Architecture

```mermaid
graph TD
    %% Root level
    A[agent-context.md] --> B[start.ps1]
    B --> C[README.md]
    C --> D[CHANGELOG.md]
    C --> E[docs/]
    C --> F[proxy/]
    
    %% docs/ directory
    E --> G[SETUP.md]
    E --> H[CONFIGURATION.md]
    E --> I[DEVELOPER.md]
    E --> J[antigravity-v2-analysis.md]
    
    %% proxy/ directory
    F --> K[src/]
    
    %% src/ directory - main components
    K --> L[adapters/]
    K --> M[adapter.ts]
    K --> N[provider-plugin.ts]
    K --> O[provider-registry.ts]
    K --> P[plugins/]
    K --> Q[tool-capabilities.ts]
    K --> R[tool-normalizer.ts]
    K --> S[model-capabilities.ts]
    K --> T[router.ts]
    K --> U[models.ts]
    K --> V[index.ts]
    K --> W[engine.ts]
    K --> X[mapper.ts]
    K --> Y[config.ts]
    K --> Z[provider-cache.ts]
    
    %% adapters subdirectory
    L --> A1[openai.ts]
    L --> A2[anthropic.ts]
    L --> A3[google.ts]
    L --> A4[groq.ts]
    L --> A5[zen.ts]
    L --> A6[nvidia.ts]
    L --> A7[types.ts]
    
    %% plugins subdirectory
    P --> B1[builtin-plugins.ts]
    
    %% dashboard subdirectory
    F --> C1[dashboard/]
    C1 --> C2[index.html]
    C1 --> C3[login.html]
    
    %% Other files in proxy/
    F --> D1[models.json]
    F --> D2[pricing.json]
    F --> D3[reasoning-effort.json]
    F --> D4[blocklist.json]
    F --> D5[.env]
    F --> D6[.env.example]
    F --> D7[certs/]
    F --> D8[logs/]
    
    %% Note: actual configuration for certs and logs are nested
```
```

---

## 🔧 Environment Variables

```env
# Provider priority (first = primary)
PROVIDER_PRIORITY=openrouter,nvidia,zen

# API keys
OPENROUTER_API_KEY=sk-or-v1-...
NVIDIA_API_KEY=nvapi-...
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
OPENCODE_API_KEY=sk-...
OPENCODE_GO_API_KEY=sk-opencode-go-...

# Ports
PROXY_PORT=443          # TLS port Antigravity connects to
API_PORT=4000           # Dashboard + REST API port

# Retry & failover
PROXY_RETRIES=3         # Attempts per provider
PROXY_BACKOFF_MS=100    # Initial backoff (doubles each retry)

# Rate limiting (0 = unlimited)
RATE_LIMIT_GLOBAL=0
RATE_LIMIT_PROVIDER=0
RATE_LIMIT_WINDOW_MS=60000

# Logging
LOG_LEVEL=info          # debug | info | warn | error
LOG_MAX_SIZE_MB=10      # Rotate when reached
LOG_MAX_FILES=5         # Keep N rotated files
LOG_MAX_AGE_DAYS=30     # Delete files older than

# Dashboard auth (optional)
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=your_password

# Failover webhook (optional)
FAILOVER_WEBHOOK_URL=https://hooks.example.com/webhook

# Workspace context hardening
WORKSPACE_CONTEXT_ENVELOPE=strict   # off | loose | strict

# Inline context mode
CONTEXT_STRIP_MODE=passthrough       # passthrough (default) | strip
```

> ### 💡 Why Passthrough is the Default
>
> We originally built an external context system (`agent-context.md` + `antigravity-context.ts`) to teach external models about Antigravity's tools. But after implementation, we discovered the external context grew to **~28K tokens — the exact same size as the native Antigravity context** that Gemini receives.
>
> Since both consume identical tokens, there's no benefit to stripping the native context and injecting our own. **Passthrough simply forwards what Antigravity already sends** — simpler, no injection overhead, and external models understand it natively (validated: 18/20 tools working with MiMo-v2.5).
>
> **Future goal:** Compress the external context to deliver the same native quality with fewer tokens, reducing the ~28K token overhead while maintaining full tool coverage.

---

## 📚 Quick Links

- [Setup Guide](docs/SETUP.md)
- [Configuration Reference](docs/CONFIGURATION.md)
- [Developer Guide](docs/DEVELOPER.md) ← **For adding providers & plugin development**
- [Antigravity v2 Protocol Analysis](docs/antigravity-v2-analysis.md)
- [CHANGELOG](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)

---

## ⚡ Development Quick Start

```bash
cd proxy
npm install            # Install dependencies
npm run build          # Compile TypeScript → dist/
npm run typecheck      # Type-check only
npm test               # Run tests
npm run dev            # Watch mode
```

**New Providers:** See `docs/DEVELOPER.md` for plugin architecture guide.

**Run tests:**

```bash
# All tests
npm test

# Filter by component
npx tsx test/run.ts plugin-architecture
npx tsx test/run.ts tool-translation
npx tsx test/run.ts model-discovery
npx tsx test/run.ts provider-adapters
```

## 📝 License

MIT — see [LICENSE](LICENSE).
