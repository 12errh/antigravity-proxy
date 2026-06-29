# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Antigravity is a man-in-the-middle TLS proxy that sits between the Antigravity AI desktop app (which speaks Google Gemini API format) and LLM providers (OpenAI-compatible, Anthropic, Google). It intercepts Gemini-format requests on port 443, translates them to the target provider's API format, and streams the response back — making Antigravity work with any LLM.

## Build & Test Commands

All commands run from the `proxy/` directory:

```bash
npm install          # install dependencies
npm run build        # compile TypeScript → dist/
npm run typecheck    # type-check only (no emit)
npm test             # run tests (tsx test/run.ts)
npm run dev          # watch mode (tsx watch src/index.ts)
npm start            # run compiled output
npm run start:prod   # run from dist/index.js
npm run gen-certs    # generate self-signed TLS certs (certs/cert.pem, certs/key.pem)
```

CI runs on Ubuntu, macOS, Windows × Node 20/22/24. It runs typecheck, tests, build, and cert generation in sequence.

## Architecture

### Core Pipeline

```
Antigravity App → [port 443 TLS] → Proxy → [API call] → LLM Provider
                                    ↓
                            Dashboard [port 4000]
```

1. **TLS Intercept** (`proxy/src/index.ts`) — HTTPS server on port 443 captures Gemini-format requests
2. **Context Mode** — `lite` (recommended) strips native context, injects compressed `agent-context-lite.md` (~3.5K tokens); `strip` uses full `agent-context.md` (~10K tokens); `passthrough` forwards native context unchanged (~28K tokens)
3. **Tool Normalization** (`proxy/src/tool-normalizer.ts`) — resolves tool name aliases (`manageTask`→`manage_task`), param aliases (`command`→`CommandLine`), coerces types (`"true"`→`true`), fills defaults
4. **Format Mapping** (`proxy/src/mapper.ts`) — converts Google Gemini request format → OpenAI-compatible format
5. **Routing** (`proxy/src/router.ts`) — failover orchestrator: tries model-specific providers first, then global fallback. Exponential backoff, max 2 retries per provider.
6. **Adapters** (`proxy/src/adapter.ts`) — plugin-based adapter factory with 10 built-in providers:
   - `OpenAICompatAdapter` — OpenAI, OpenRouter, local (Ollama/vLLM/LM Studio, llama.cpp, etc.)
   - `GroqAdapter` — Groq-optimized (strips images, since Groq doesn't support vision)
   - `ZenAdapter` — Zen/OpenCode-optimized (reasoning_effort forwarding)
   - `NvidiaAdapter` — NVIDIA NIM-optimized (reasoning_effort on supported models)
   - `AnthropicAdapter` — Anthropic Messages API
   - `GoogleAdapter` — Google Gemini API
7. **Response Rewrap** — streaming response re-wrapped into Google SSE format back to Antigravity

### Key Design Decisions

- **Format translation is the core value**: Antigravity hardcodes the Google Gemini API. The proxy translates to any provider's format.
- **Context compression** (`agent-context-lite.md`): compressed version of the operating manual (~3.5K tokens vs ~10K full). Injected in lite mode. Same tool coverage, fewer tokens. Browser tools included.
- **Context strip mode** (`CONTEXT_STRIP_MODE` env var): `lite` (recommended) uses compressed context; `strip` uses full context; `passthrough` forwards native Antigravity context unchanged. Controlled from the dashboard Config tab.
- **Workspace context hardening** (`proxy/src/workspace-context.ts`): anti-hallucination envelope system with `off`/`loose`/`strict` modes. Anonymizes file paths, wraps system instructions to prevent LLM confusion between documentation and runtime state.
- **Plugin architecture** (`proxy/src/provider-registry.ts` + `proxy/src/provider-plugin.ts`): providers are registered as plugins via the `IProviderPlugin` interface. New providers can be added without modifying core code — just implement the interface and register.
- **Tool normalization** (`proxy/src/tool-normalizer.ts` + `proxy/src/tool-capabilities.ts`): external LLM tool calls are normalized through alias resolution, type coercion, and default filling before being forwarded to Antigravity. This prevents failures from models that use different parameter names or types.
- **Model capability detection** (`proxy/src/model-capabilities.ts`): capabilities (reasoning, vision, tool support) are auto-detected from model name patterns (e.g., `r1`→reasoning, `vision`→vision). No per-model configuration needed.
- **Universal reasoning extraction** (`proxy/src/adapters/openai.ts`): thought/reasoning content is extracted from any field name (`reasoning_content`, `thinking`, `reasoning`, etc.) and from `<think>` tags, so any reasoning model works without code changes.

### Configuration

- **Hot-reloadable**: Config, models, pricing, blocklist, and reasoning effort reload without restart
- **Singleton config** (`proxy/src/config.ts`): loaded from `.env` via dotenv, supports all provider API keys, priority, ports, rate limits, dashboard auth
- **Model resolver** (`proxy/src/models.ts` + `proxy/models.json`): per-provider overrides and flat default map for model name translation
- **SQLite** (`proxy/src/db.ts`): WAL mode, stores sessions, requests, logs for cost tracking and history

### Dashboard

SPA served on port 4000. Tabs: Stats, Requests, Sessions, Cost, Models, Model Options, Config. Features SSE log streaming, config editor, cost charts (Chart.js), full-text search, session compare, request replay.

## Working With This Codebase

- The proxy directory contains all source code. The root is primarily docs and repo config.
- TypeScript with ESM (`import.meta.url`). Uses `tsx` for dev, `tsc` for build.
- `provider-cache.ts` provides 10-min TTL caching for provider model lists. Cache endpoints: GET/POST/DELETE `/api/provider-models`.
- `reasoning-effort.ts` persists per-model effort levels to `reasoning-effort.json`. Auto-detects reasoning models from model names.
- `local-discovery.ts` auto-detects 9+ local inference solutions (Ollama, vLLM, LM Studio, llama.cpp, text-generation-webui, TabbyAPI, LocalAI, LiteLLM, Aphrodite) on startup.
- `model-capabilities.ts` detects model capabilities (reasoning, vision, tools) from name patterns. Cached with 5-min TTL.
- `http-pool.ts` handles connection pooling; `rate-limiter.ts` provides global + per-provider rate limiting.
- When adding new providers or models, check `proxy/models.json` for the model alias map and `_provider_models` for per-provider overrides.
- To add a new provider, implement `IProviderPlugin` and register with `providerRegistry.register()`. See `proxy/src/plugins/builtin-plugins.ts` for examples.
- Tests are in `proxy/test/`. Run all with `npm test` or filter with `tsx test/run.ts <pattern>`. Key test files:
  - `plugin-architecture.test.ts` — Phase 1: provider plugin system
  - `tool-translation.test.ts` — Phase 2: tool normalization
  - `model-discovery.test.ts` — Phase 3: capability detection
  - `provider-adapters.test.ts` — Phase 4: provider-specific adapters
