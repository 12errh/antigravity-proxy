# AGENTS.md

## Project Overview

Antigravity is a man-in-the-middle TLS proxy that translates Antigravity desktop's Google Gemini API calls to any LLM provider (OpenAI, Anthropic, Groq, Google, NVIDIA, OpenRouter, local inference servers).

All source code lives in `proxy/`. Root contains docs, launcher scripts, and agent context. **Never add source files to root.**

## Quick Reference

| What | Command |
|------|---------|
| Install deps | `npm install` (run from `proxy/`) |
| Dev (watch mode) | `npm run dev` (tsx watch) |
| Build | `npm run build` (tsc) |
| Typecheck | `npm run typecheck` |
| Test all | `npm test` |
| Test single | `npx tsx test/run.ts <filter>` |
| Gen self-signed certs | `npm run gen-certs` |

**All commands run from `proxy/`, not root.**

### Single test filters (substring match on filenames):
```
npx tsx test/run.ts plugin-architecture
npx tsx test/run.ts tool-translation
npx tsx test/run.ts model-discovery
npx tsx test/run.ts provider-adapters
npx tsx test/run.ts google-adapter
npx tsx test/run.ts phase3-correctness
npx tsx test/run.ts smoke
npx tsx test/run.ts dead-code
npx tsx test/run.ts package-versions
npx tsx test/run.ts provider-cache
npx tsx test/run.ts start-script
```

## Build/CI Pipeline

CI (`.github/workflows/ci.yml`) runs: **typecheck → test → build → cert gen**. All must pass. Three OS matrix (ubuntu, macos, windows) × three Node versions (20.x, 22.x, 24.x).

## Code Conventions

- **Language**: TypeScript, strict mode, ESM (`"type": "module"` in package.json)
- **Target**: ES2022, ESNext modules, bundler moduleResolution
- **Node.js**: >=20 (use `import.meta.url` for `__dirname` equivalent)
- **Formatter**: Biome (`npm run format`)
- **Commits**: Conventional Commits (`feat(scope): description`, `fix(scope): description`, `docs(scope): description`)
- **Scope** for this project: `anthropic`, `bedrock`, `azure`, `github-copilot`, `openai-compat`, `router`, `config`, `mcp`, `plugin-architecture`, `cli`, `migrator`
- **No `console.log`** in submitted code — use `logger.info/warn/error` from `src/logger.ts`
- **No new runtime dependencies** without strong justification. Current deps: `ai`, `better-sqlite3`, `undici`, `dotenv`, `node-forge`.
- **PR checklist**: TypeScript compiles, 100% tests pass, formatter applied, no console.log, no secrets in code, conventional commit format

## Architecture (compact)

Request flow:
```
Client → [MITM TLS Cert] → Proxy Engine → [Context Injection] → [Adapter] → Provider API
Client ← [Streaming Translation] ← Provider API
```

Key directories (`proxy/src/`):
- `engine.ts` — Core MITM TLS proxy + HTTP server + OpenAI/Anthropic endpoint handlers
- `mapper.ts` — Gemini-to-OpenAI request/response translation
- `router.ts` — Config hot-reload, provider priority, model resolution, health API
- `adapters/` — Provider-specific adapters (Anthropic, Bedrock, GitHub Copilot, etc.)
- `plugins/` — Plugin architecture (IProviderPlugin interface, plugin registry)
- `tool-normalizer.ts` — Tool call alias resolution, type coercion, param normalization
- `tool-capabilities.ts` — Tool schema registry, well-known tool definitions
- `antigravity-context.ts` — System prompt injection for external models
- `workspace-context.ts` — Anti-hallucination workspace envelope
- `config.ts` — Config validation and type definitions
- `logger.ts` — Custom logger (no console.log)
- `models.json` — Model alias map + per-provider overrides
- `pricing.json` — Per-model cost data
- `dashboard/index.html` — Dashboard SPA (single file, zero build step)
- `test/` — Tests (node:test, no Jest)

### Provider Plugin System
New providers implement `IProviderPlugin` interface in `src/plugins/`, register in `src/plugins/builtin-plugins.ts`. See `docs/DEVELOPER.md` for full guide. Custom adapters extend `OpenAICompatAdapter` in `src/adapters/`.

## Testing

- **Framework**: `node:test` + `node:assert/strict` (no Jest/Vitest)
- **Smoke test**: `npx tsx test/run.ts smoke` — hits health endpoint, skips gracefully if proxy not running
- **Tests across 19 test files**

## Gotchas

- **Port 443 requires admin/root** — use `--port 8443` for non-admin, or `PROXY_PORT=8443`
- **Windows CI**: uses `npm ci --ignore-scripts` to avoid better-sqlite3 native build issues
- **Dashboard is raw HTML** (`proxy/dashboard/index.html`) — no build step, edit directly and hard-refresh browser
- **Config hot-reloads**: `.env` changes (API keys, priority, ports) take effect without restart
- **`agent-context.md`** at repo root is the full operating manual (~10K tokens). Injected in strip/lite modes as system prompt.
- **`agent-context-lite.md`** at repo root is the compressed version (~3.5K tokens). Used in lite mode.
- **`CONTEXT_STRIP_MODE`**: `lite` (recommended) uses compressed context, `strip` uses full context, `passthrough` forwards native Antigravity context unchanged
- **Model overrides**: `_provider_models` in `models.json` overrides global alias resolution for specific providers
- **Provider priority**: First provider with valid API key wins. Set `ANTIGRAVITY_PROVIDER_PRIORITY` to reorder.

## PR Description Requirements

1. What changed and why
2. How to test the changes
3. Any new dependencies or environment variables
4. Breaking changes or backward compatibility notes
5. Performance impact (if applicable)
6. Security implications (if applicable)
