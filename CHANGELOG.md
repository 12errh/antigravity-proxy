# Changelog

All notable changes to Antigravity Proxy are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- **Reasoning effort control** — new `Model Options` dashboard tab. Auto-detects DeepSeek R-series, NVIDIA stepfun, and OpenAI o-series models from your model map and lets you pin a `reasoning_effort` level (`low` / `medium` / `high` / `max`) per model. Settings persisted to `reasoning-effort.json`, applied in the OpenAI adapter on every matching request. Manual overrides supported for any resolved model name.
- **OpenCode Zen provider** — fully wired: `PROVIDER_META`, `PROVIDER_OPTIONS`, API keys form, provider priority list, pricing editor, and `saveConfig()` all include Zen. Key env var: `OPENCODE_API_KEY`.
- **Models tab matrix UI** — replaced the old flat 3-column table (model / resolved / provider) with a full per-provider matrix. One row per alias, one column per provider (Default + OpenRouter / NVIDIA / OpenAI / Groq / Anthropic / Google / Zen / Ollama / vLLM / LM Studio). Column visibility toggles, double-click cell for live model picker, quick-add preset rows for Claude / Gemini / GPT, cell color-coded by provider, sticky alias column.
- **README rewrite** — corrected "Windows only" claim (proxy runs on any Node 18+ platform), documented all providers including Zen, added matrix UI guide, reasoning effort guide, full env var reference, complete architecture file tree.
- **CHANGELOG** — this file.

### Fixed
- Zen missing from `PROVIDER_META` caused it to show no logo/label anywhere in the UI.
- `saveConfig()` did not send `OPENCODE_API_KEY`, so Zen key changes from Config tab were silently dropped.
- Pricing editor did not include a Zen section.
- `PROVIDER_OPTIONS` list did not include Zen, so it could not be selected in model dropdowns or the provider priority "Add Provider" picker.
- `reasoning_effort` was only applied for `openai` and `zen` providers; it is now applied to all OpenAI-compat providers when a per-model effort is configured.

---

## [6b62066] — 2026-06-05

### Added
- **Provider model cache** (`provider-cache.ts`) — 10-min TTL in-memory cache per provider. Auto-warms at startup. API: `GET /api/provider-models` (cached), `POST` (fetch/force-refresh), `DELETE /api/provider-models/cache` (clear), `/api/provider-models/warm`.
- **Browse Models Refresh button** — force-clears server cache then re-fetches, bypassing the 10-min TTL.
- **Models tab lazy-fetch** — resolver dropdowns in the old flat table try `/api/provider-models` when no cached models exist for the selected provider.
- **Provider logo in model dropdowns** — `createResolverSelect` accepts a `providerMeta` arg; logo shown in both trigger and list items.
- **Cost tab date filter** — date picker, "Today" and "All time" buttons. `GET /api/cost?date=YYYY-MM-DD` returns single-day scope; `?all=1` returns all-time. Stat card subtitles update to reflect scope.
- **`restoreCostCanvases()` / `showCostEmpty()`** — fix for `parentElement of null` crash when switching cost date after a "no data" state replaced a `<canvas>`.
- **History date pills in own row** — `#historyDateList` moved below filter bar into `margin:8px 0 12px` row.
- **Sessions tab DB-backed list** — `refreshSessionListCache()` with 30-second TTL replaces `fs.statSync` scan. Eliminates 50 MB log reads on sessions load.
- **Log rotation** — size-based `.log → .1.log` rotation. `LOG_MAX_FILES` / `LOG_MAX_AGE_DAYS` retention. `getLogStats()` exposed via `/api/logs/stats`.
- **Workspace context hardening** (`workspace-context.ts`) — strict envelope framing `agent-context.md` as documentation, not runtime state. Path anonymization via SHA-256 token. Tool-result wrapper. Configurable via `WORKSPACE_CONTEXT_ENVELOPE` (`off` | `loose` | `strict`).
- **`validateApiKey`** — reports the actual missing env-var names from `DEFAULT_PROVIDER_CONFIGS` instead of a generic message.
- **`docs/antigravity-v2-analysis.md`** — full reverse-engineering of Antigravity 2.0's network protocol.

### Fixed
- Cost charts: `parentElement of null` on date switch when canvas was replaced by "no data" div.
- Router: cap per-provider retries to 2 when multiple candidates exist; add second-pass global fallback to stop 11×50s backoff on a broken provider.
- Image/vision: drop `fileData` URIs that aren't `http(s)/data/file` — fixes NVIDIA stepfun 400 "URL must be HTTP, data or file URL".
- Mapper + OpenAI adapter: filter Google-style `files/abc123` refs before sending to non-Google providers.

### Removed
- Dead gRPC code: `proxy/src/server.ts`, `proxy/src/handlers.ts`, entire `proxy/proto/` tree.
- 8 corrupted `.env` lines (keys not parsed by `config.ts`).

---

## [693a5bf] — earlier

### Fixed
- Dashboard UI: keyboard shortcut focus, sidebar alignment, detail panel overflow.

---

## [1e37e5c] — earlier

### Added
- Keyboard shortcuts: `/` focus search, `?` help overlay, number keys for tab navigation.
- Collapsible sidebar (56px icon-only mode, persisted to `localStorage`).
- Full-text search across requests, sessions, and logs via `/api/search`.
- Per-table paginated search via `/api/requests/search`.
- Request replay — `/api/replay` POST re-runs a stored request through the engine.
- Session compare — select two sessions for side-by-side diff view.
- Provider failover timeline visualization in request detail expand.

---

## [4b2333d] — earlier

### Added
- Local model discovery — auto-detect Ollama / vLLM / LM Studio on startup.
- `/api/local/discover` (POST = scan, GET = cached), `/api/local/apply`.
- Local providers merged into provider list and dashboard Config tab.

---

## [9bac192] — earlier

### Added
- Cost visualization — Chart.js charts: cost by provider (doughnut), by model (horizontal bar), by day (line).
- `getCostAggregation`, `getCostByDay`, `getStats` in `db.ts`.
- Pricing editor in Cost tab — per-provider default and per-model overrides, saved to `pricing.json`.

---

## [ec401fc] — earlier

### Added
- Rate limiting — global + per-provider max requests per window. `/api/rate-limit` GET/POST/reset.
- Blocklist — provider IDs, model glob patterns, content regex. `/api/blocklist` GET/POST.
- Blocklist checked in streaming loop; rate limit 0 treated as unlimited.

---

## [015f54a] — earlier

### Added
- Multi-provider failover with `PROVIDER_PRIORITY` env var.
- Provider adapters: Anthropic (Messages API), Google Gemini, OpenAI-compat.
- Dashboard auth — login page, session cookie, `/api/auth/configure`, `/api/auth/disable`.
- Failover webhook — `FAILOVER_WEBHOOK_URL`, `/api/webhook/configure`, `/api/webhook-test`.
- SQLite persistence via `db.ts` — requests, cost, sessions, logs survive restarts.
- SSE real-time events — request feed, log stream, cleared events.
