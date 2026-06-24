# Changelog

All notable changes to Antigravity Proxy are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Dates are UTC. Commit hashes are the actual merge commits on `main`.

---

## [latest] — 2026-06-24

### Added

- **npm package** — published as `@12errh/antigravity-proxy@1.0.0` on npm. Install globally with `npm install -g @12errh/antigravity-proxy` and run `antigravity start` — no clone required.
- **CLI (Commander.js)** — 8 commands for full proxy lifecycle management:
  - `antigravity start [--port] [--foreground] [--no-browser] [--trust-cert]` — start proxy + dashboard + launch Antigravity desktop
  - `antigravity stop` — stop proxy and desktop app cleanly
  - `antigravity status` — show running status, uptime, ports
  - `antigravity health` — hit health endpoint
  - `antigravity config [show|get|set]` — view/update configuration
  - `antigravity logs [tail|list|show]` — view proxy logs
  - `antigravity certs [show|generate|trust]` — manage TLS certificates
  - `antigravity setup` — interactive onboarding wizard (provider, API key, port, features)
- **Onboarding wizard** — `antigravity setup` guides new users through selecting a provider, entering API key, choosing port, and configuring dashboard features. Preserves existing `.env` settings.
- **OpenCode Go session_id caching** — captures `session_id` from OpenCode Go API responses and re-sends it on follow-up requests for context cache discounts.

### Fixed

- **Router fallback used wrong default model** — when a model had no provider-specific mapping, the router used the hardcoded `_default_model` (`stepfun-ai/step-3.7-flash`) instead of the provider-specific default from `_provider_models.default[provider]`. Now uses `getDefaultModel(providerId)` first.
- **Dashboard default model not syncing** — selecting a new default model in the Models tab wrote to `_provider_models.default` but `_default_model` stayed stale. Fixed `setModelName()` to sync both fields.
- **`config.provider` showed hardcoded `openrouter`** — `legacyProvider` defaulted to `'openrouter'` regardless of provider priority. Now uses `parsePriority()[0]` to match the user's configured first provider.
- **Placeholder API keys showed as configured** — `.env.example` had fake keys (`sk-...`, `nvapi-...`) that passed `isConfigured` check. Cleared to empty strings and added regex filter.
- **`antigravity start` hung on desktop launch** — `execSync` blocked the CLI when launching Antigravity on Windows. Replaced with non-blocking `exec`.
- **Tool normalizer `toolAction`/`toolSummary` warnings** — Antigravity internal params were stripped by `engine.ts` before normalization, but the schema still listed them as required. Added skip for internal params in missing-required check.
- **`antigravity setup` destroyed existing `.env`** — the setup wizard overwrote the entire `.env` with only user-provided values. Now copies `.env.example` first and uses selective updates.
- **Engine used `modelResolver.globalProviderPriority` instead of `config.providerPriority`** — in `per-model-per-provider` mode, the engine used the hardcoded priority from `models.json` instead of the user's `.env` configuration. Fixed to always use `config.providerPriority`.

### Changed

- **`models.json`** — removed `opencode-go` from `_global_provider_priority`, changed `_default_provider` to `zen`, changed `_default_model` to `mimo-v2.5-free`.
- **`.env.example`** — cleared placeholder API key values to empty strings.
- **CLI architecture** — `proxy/bin/cli.js` entry point with Commander.js, `proxy/src/cli/` directory for commands and utilities.

---

## [latest] — 2026-06-23

### Added

- **OpenCode Go provider** — new provider for OpenCode Go's paid tier ($10/mo), offering curated access to high-performing open-source models:
  - DeepSeek V4 Pro, V4 Flash
  - Qwen 3.7 Max, 3.7 Plus
  - MiniMax M3
  - GLM 5.2, 5.1, 5
  - Kimi K2.7 Code, K2.6, K2.5
  - MiMo V2.5 Pro, V2.5, V2 Pro, V2 Omni
  - Set `OPENCODE_GO_API_KEY` in `.env` to enable
- **Provider priority** — `opencode-go` added to default provider chain (second after `zen`)
- **Reasoning effort** — Go models (DeepSeek V4, Qwen 3.7 Max, GLM 5.x, Kimi K2.7) configured for reasoning support
- **Dashboard** — OpenCode Go visible in provider list, config tab, browse tab, and pricing editor
- **Browse tab** — OpenCode Go model listing with proper API key validation

### Fixed

- **Dashboard dropdown scroll** — provider and model dropdown menus no longer close when scrolling inside them (trackpad two-finger scroll)
- **Live Log tab** — logs from previous sessions no longer appear on fresh proxy startup; DB logs are cleared on each launch
- **Browse tab API key error** — selecting a provider without a configured API key now shows a clear error message instead of silently failing

### Changed

- **OpenCode Go** added to provider priority list, pricing config, pricing.json, and .env.example
- **README.md** updated with OpenCode Go in provider table and env vars section
- **reasoning-effort.json** — added reasoning effort entries for Go models

---

## [latest] — 2026-06-16

### Changed

- **`CONTEXT_STRIP_MODE` default changed from `strip` to `passthrough`** — external models now receive the full native Antigravity context (skills, plugins, identity, subagents, user rules) by default. This was validated with MiMo-v2.5: 18/20 tools working correctly with passthrough, matching native Gemini behavior.

- **Passthrough mode now truly forwards context** — fixed three critical bugs:
  - `engine.ts` was injecting ~4220 tokens of ANTIGRAVITY context even in passthrough mode (duplication)
  - `engine.ts` was injecting "Read agent-context.md" prompt even in passthrough mode
  - `GoogleAdapter` was dropping the system instruction entirely (`if (m.role === 'system') continue`)

### Fixed

- **System instruction passthrough** — Google adapter now forwards system instruction as native Gemini `system_instruction` field instead of dropping it
- **Adapter interface** — Added `system?: string` parameter to `ModelAdapter.stream()` so system instruction flows through the entire pipeline
- **OpenAI/Anthropic adapters** — Accept and forward system instruction as system message when not already present

### Context Architecture

> **Why passthrough is now the default:** We built `agent-context.md` (~10K tokens) and the `antigravity-context.ts` system message (~4K tokens) to teach external models about Antigravity's tools and workflows. But after implementation, we discovered the external context grew to **~28K tokens** — the same size as the native Antigravity context that Gemini receives. Since both consume identical tokens, there's no benefit to stripping the native context and injecting our own. Passthrough simply forwards what Antigravity already sends — simpler, no injection overhead, and external models understand it natively (validated: 18/20 tools working).

- **Passthrough mode** (default): Full native context forwarded — no injection, no stripping, no file reads needed
- **Strip mode** (fallback): Bulk context stripped, compact reference injected — only for models that can't handle XML-like tags
- **Future goal:** Compress the external context to deliver the same native quality with fewer tokens, reducing the ~28K token overhead while maintaining full tool coverage

---

## [b45f803] — 2026-06-11

### Added

- **Plugin Architecture (Phase 1)** — complete provider plugin system:
  - `IProviderPlugin` interface with `getAdapter()`, `getCapabilities()`, `validateConfig()` methods
  - `ProviderRegistry` singleton for dynamic provider registration
  - 10 built-in provider plugins (OpenAI, Anthropic, Google, NVIDIA, OpenRouter, Groq, Zen, Ollama, vLLM, LM Studio)
  - `provider-cache.ts` with 10-minute TTL for model lists

- **Universal Tool Normalization (Phase 2)** — resolves tool call issues from external LLMs:
  - `ToolCapabilityRegistry` with 7 well-known tool schemas (`manage_task`, `run_command`, `write_to_file`, etc.)
  - `normalizeToolCall()` — alias resolution (`manageTask`→`manage_task`), param aliases (`command`→`CommandLine`)
  - Type coercion (`"true"`→`true`, `"123"`→`123`), default filling (`manage_task` missing `Action` → `"list"`)
  - Unknown param stripping to prevent errors

- **Enhanced Model Discovery (Phase 3)** — expanded local provider support:
  - 9 local providers: Ollama, vLLM, LM Studio, llama.cpp, text-generation-webui, TabbyAPI, LocalAI, LiteLLM, Aphrodite
  - `detectModelCapabilities()` — pattern-based detection for reasoning (R1, QwQ, o-series, etc.), vision, tool support
  - `detectModelCapabilitiesWithProvider()` — merges provider capabilities with model patterns

- **Provider-Specific Adapters (Phase 4)** — optimized adapters:
  - `GroqAdapter` — strips images (Groq doesn't support vision)
  - `ZenAdapter` — forwards `reasoning_effort` parameter to Zen/OpenCode gateway
  - `NvidiaAdapter` — forwards `reasoning_effort` for NVIDIA stepfun models

- **Universal Reasoning Extraction** — extracts thought content from any field name:
  - Supports `reasoning_content`, `thinking`, `reasoning`, `reasoning_text`, `thinking_content`, etc.
  - Automatically parses `<think>...</think>` tags in response text

- **Developer Guide** (`docs/DEVELOPER.md`) — comprehensive documentation:
  - Plugin architecture overview and usage examples
  - Step-by-step guide for adding new providers
  - Custom adapter creation patterns (image stripping, reasoning effort)
  - Tool normalization system and how to add tool schemas
  - Model capability detection and pattern matching
  - Testing guidelines (running and writing tests)

- **Comprehensive Test Suite** — 4 new test files (126 total tests):
  - `plugin-architecture.test.ts` — ProviderRegistry, IProviderPlugin, adapter factory
  - `tool-translation.test.ts` — ToolCapabilityRegistry, normalizeToolCall
  - `model-discovery.test.ts` — Pattern-based capability detection, caching
  - `provider-adapters.test.ts` — Groq, Zen, NVIDIA adapter behavior

### Changed

- **README rewritten** — modernized with mermaid diagrams, organized sections, comprehensive provider list
- **Node.js minimum version bumped to 20+** — `undici@7` requires the `File` global added in Node 20

### Fixed

- **`manage_task` failures with DeepSeek/mimo** — models now correctly receive required `Action` parameter with default value
- **Reasoning/thought content not displaying** — universal extraction from any field name and `<think>` tags
- **Tool normalization** — external LLM tool calls are now properly normalized before forwarding

---

## [adef7e7] — 2026-06-10

### Fixed
- **`manage_task` schema was completely wrong** — the real tool manages background OS processes
  (`Action: "list"|"kill"|"kill_all"|"status"|"send_input"`), not project tasks. The v2.1
  `agent-context.md` documented fictional `"complete"/"update"/"create"` actions that do not exist,
  causing non-Gemini models to loop on every task completion. Project task tracking is done via
  `write_to_file(IsArtifact=true)`.
- **`grep_search` param name wrong** — real param is `Includes` (array of globs), not `FilePattern` (string).
- **`invoke_subagent` param name wrong** — real param is `Subagents` (array with `TypeName/Role/Prompt`).

### Added
- **agent-context.md v2.2** — complete and accurate tool reference for all Antigravity built-in tools:
  `define_subagent`, `manage_subagents`, `send_message`, `read_url_content`, `ask_permission`,
  `ask_question`, `list_permissions`, `generate_image`, `schedule`. Correct schemas, required fields
  marked explicitly, error recovery table, shell/PowerShell rules.
- **`antigravity-context.ts` updated** — inline system prompt expanded with correct `manage_task` schema
  and full tool selection list so models know what's available on every request.

---

## [7045e55] — 2026-06-10

### Added
- **Dashboard: split prompt / output token stats** — stat grid expanded from 4 to 6 cards.
  New "Prompt Tokens" (blue) and "Output Tokens" (purple) cards. Combined "Tokens" card
  sub-label now shows `N in · M out` live.
- **Inline Context Mode toggle** — new `CONTEXT_STRIP_MODE` env var (`strip` | `passthrough`,
  default `strip`). `strip` removes Antigravity's `<skills>/<plugins>/<identity>` context
  (~3,500–5,000 tokens saved per request). `passthrough` forwards everything unchanged.
  Surfaced as a dropdown in Config tab → Provider section. Hot-reloaded on Save.
- **agent-context.md v2.1** — rewrote tool reference with correct schemas for the 5
  most-failure-prone tools (`manage_task`, `run_command`, `write_to_file`,
  `replace_file_content`, `browser_action`). Added error recovery table and PowerShell rules.
- **`antigravity-context.ts` inline schemas** — proxy system prompt now leads with critical
  tool schemas so every model sees them before any tool call, without needing to read
  `agent-context.md` first.

### Fixed
- **`manage_task` retry loop** — confirmed from production logs: model called `manage_task`
  without `action` parameter 5 times in a row (22:31:09–22:31:21), each returning the same
  error. Root cause: non-Gemini models have no training data for Antigravity's internal tool
  schemas. Fix: document the schemas explicitly in the injected system prompt.
- **PowerShell `&&` operator** — documented that `&&` does not work in PowerShell; use `;` instead.

---

## [5dd2cf5] — 2026-06-08

### Added
- **Reasoning effort control** — new `Model Options` dashboard tab. Auto-detects DeepSeek R-series,
  NVIDIA stepfun, OpenAI o-series, Qwen/GLM/Kimi thinking models from your model map. Per-model
  effort level (`low`/`medium`/`high`/`max`) persisted to `reasoning-effort.json`. Applied in
  OpenAI adapter on every matching request. Manual overrides for any resolved model name.
- **OpenCode Zen provider** — fully wired across all UI surfaces: `PROVIDER_META`, Config tab API
  keys form (`cfgZenKey` + status badge), provider priority list, pricing editor, `saveConfig()`.
  Env var: `OPENCODE_API_KEY`.
- **Models tab matrix UI** — replaced the old flat 3-column table with a per-provider matrix.
  One row per model alias, one column per provider (Default + OpenRouter / NVIDIA / OpenAI /
  Groq / Anthropic / Google / Zen / Ollama / vLLM / LM Studio). Column visibility toggles,
  double-click cell for live searchable model picker, quick-add presets (Claude / Gemini / GPT),
  cell color-coded by provider, sticky alias column.
- **Cross-platform launcher (`start.sh`)** — bash script for macOS and Linux with auto-detect
  Node.js, cert generation, best-effort cert trust, old-process cleanup, `--port` flag.
  Marked ⚠️ untested with "open GitHub issues" notice in README and script header.
- **Platform support table** in README — Windows ✅ tested, macOS/Linux ⚠️ untested.
- **`npm run build` script** added to `package.json` (was missing).
- **`gen-certs.mjs`** creates `certs/` dir if missing (cross-platform fix).
- **`.env.example`** updated with all supported variables and comments.
- **Agent file corruption protection** — `workspace-context.ts` strict envelope extended with
  7 FILE INTEGRITY RULES injected into the system prompt on every request.
- **Session purging** — `auth-sessions.ts` now runs `purgeExpired()` every 30 minutes
  (unref'd interval). Previously the session `Map` grew without bound.
- **CHANGELOG** — this file.
- **`start:prod` npm script** — runs from `dist/index.js` after `npm run build`.

### Fixed
- **Models tab save wiped data** — `saveModels()` dropped alias-only rows (entries that had
  per-provider values but no default). Fixed: rows saved correctly to `_provider_models`.
- **Models tab "No models configured"** — `renderMatrixTable()` only built rows from flat keys,
  ignoring `_provider_models`-only entries. Fixed: both passes now run.
- **`SyntaxError: missing ) after argument list`** in dashboard — CSS strings with `var(--accent)`
  inside `onfocus="..."` HTML attributes broke the browser's HTML parser. Replaced all inline
  CSS string assignments with dedicated `matrixInputFocus/Blur/CellFocus/CellBlur` functions.
- **TypeScript cast in HTML** — `providers as Record<string,string>` in `<script>` block.
  Browsers cannot parse TypeScript. Removed cast.
- **Reasoning effort auto-detect** — was scanning only resolved model values (zen gateway names
  like `minimax-m3-free`). Now scans both model aliases AND resolved values; `-thinking` suffix
  pattern matches `claude-sonnet-4-6-thinking` and `claude-opus-4-6-thinking`.
- **Debug full-body log removed** — `_LOGGED_FULL_BODY` env hack logged entire request body
  (potential PII/secret exposure) on first request. Removed.
- **Logger level was static** — `currentLevel` captured as `const` at module load; `config.reload()`
  never updated it. Fixed: now reads `config.logLevel` dynamically via `getCurrentLevel()`.
- **Failover webhook used global `fetch`** — changed to `poolFetch` for connection pooling.
- **`AGENT_CONTEXT_PATH` resolution** — `__dirname` is `src/` under `tsx` but `dist/` when
  compiled. Fixed in both `index.ts` and `antigravity-context.ts`.
- **Port binding errors** — `EACCES` and `EADDRINUSE` now log clear platform-specific
  instructions instead of a generic error.

### Removed
- `models.nvidia.json`, `models.openrouter.json` — not referenced anywhere in code.
- `test/ui-provider-column.test.ts` — tested CSS classes that no longer exist after matrix rewrite.
- `getOnlineLocalProviders()`, `mapExternalMessagesToCore()`, `constructToolCallText()` — dead exports.
- `@grpc/grpc-js`, `@grpc/proto-loader` — dead npm dependencies (no gRPC imports in source).
- `docs/CONFIGURATION.md`: removed false `models.{provider}.json` cache reference and
  `ANTIGRAVITY_CONTEXT` env var that was never implemented.

---

## [6b62066] — 2026-06-05

### Added
- **Provider model cache** (`provider-cache.ts`) — 10-min TTL in-memory cache per provider.
  Auto-warms at startup. Endpoints: `GET /api/provider-models` (cached), `POST` (fetch),
  `DELETE /api/provider-models/cache`, `POST /api/provider-models/warm`.
- **Browse Models: Refresh button** — force-clears server cache then re-fetches.
- **Cost tab date filter** — date picker + "Today"/"All time" buttons.
  `GET /api/cost?date=YYYY-MM-DD` for single-day; `?all=1` for all-time.
- **History date pills** moved to their own row below the filter bar.
- **Sessions tab DB-backed list** — `refreshSessionListCache()` with 30s TTL replaces
  raw `fs.statSync` scan. Eliminates 50 MB log reads on sessions load.
- **Log rotation** — size-based `.log → .1.log` rotation. `LOG_MAX_FILES` / `LOG_MAX_AGE_DAYS`
  retention. `getLogStats()` via `/api/logs/stats`.
- **Workspace context hardening** (`workspace-context.ts`) — strict envelope, path anonymization
  via SHA-256 token, tool-result wrapper. Configurable via `WORKSPACE_CONTEXT_ENVELOPE`.
- **`validateApiKey`** reports actual missing env-var names instead of generic message.
- **`docs/antigravity-v2-analysis.md`** — full reverse-engineering of Antigravity 2.0 network
  protocol (endpoints, request format, context overhead, tool calling, auth).

### Fixed
- Cost charts: `parentElement of null` crash when switching dates after a "no data" state.
- Router: cap per-provider retries to 2 when multiple candidates exist; add second-pass
  global fallback to stop 11×50s backoff on a broken provider.
- Image/vision: drop `fileData` URIs that aren't `http(s)/data/file` (fixes NVIDIA stepfun 400).
- `files/abc123` Google-style URIs filtered in mapper + OpenAI adapter.

### Removed
- Dead gRPC code: `proxy/src/server.ts`, `proxy/src/handlers.ts`, entire `proxy/proto/` tree.

---

## [14e04eb] — earlier

### Added
- Auto-install self-signed TLS cert to Windows Trusted Root store in `start.ps1` so
  Antigravity Desktop can verify the proxy TLS connection without a manual cert trust step.

---

## [015f54a] — earlier

### Added
- Multi-provider failover (`PROVIDER_PRIORITY` env var).
- Adapters: Anthropic (Messages API), Google Gemini, OpenAI-compatible (NVIDIA, OpenRouter, Groq).
- Dashboard auth — login page, session cookies, `/api/auth/configure`, `/api/auth/disable`.
- Failover webhook — `FAILOVER_WEBHOOK_URL`, `/api/webhook/configure`, `/api/webhook-test`.
- SQLite persistence (`db.ts`) — requests, cost, sessions, logs survive restarts.
- SSE real-time events — request feed, log stream, cleared events.

---

## [1e37e5c] — earlier

### Added
- Keyboard shortcuts: `/` focus search, `?` help overlay.
- Collapsible sidebar (56px icon-only mode, persisted to `localStorage`).
- Full-text search via `/api/search` across requests, sessions, logs.
- Request replay — `/api/replay` re-runs a stored request.
- Session compare — side-by-side diff view for two sessions.
- Provider failover timeline visualization in request detail.

---

## [4b2333d] — earlier

### Added
- Local model discovery — auto-detect Ollama / vLLM / LM Studio on startup.
- `/api/local/discover` (POST = scan, GET = cached), `/api/local/apply`.

---

## [9bac192] — earlier

### Added
- Cost visualization — Chart.js: cost by provider (doughnut), by model (bar), by day (line).
- Pricing editor in Cost tab, saved to `pricing.json`.

---

## [ec401fc] — earlier

### Added
- Rate limiting — global + per-provider. `/api/rate-limit` GET/POST/reset.
- Blocklist — provider IDs, model glob patterns, content regex. `/api/blocklist` GET/POST.

---

## [c2897fc] — initial release

### Added
- Proxy core: intercepts Antigravity's Gemini API calls on port 443, translates to
  OpenAI-compatible format, streams response back.
- NVIDIA NIM and OpenRouter provider support.
- Self-signed TLS with `node-forge`.
- Context stripping: removes `<skills>/<plugins>/<user_rules>/<identity>` (~3,500 tokens/request),
  injects compact `agent-context.md` reference.
- Tool argument sanitization: strips Antigravity internal fields (`toolAction`, `toolSummary`,
  `Summary`, `Action`) before forwarding to external models.
- Basic dashboard on port 4000.
