# Antigravity Proxy v2 Plan

## 1. Multi-Provider Expansion

**Goal**: Support OpenAI, Anthropic, Google Gemini, and Groq alongside NVIDIA and OpenRouter.
**No Vercel AI SDK** — all providers use raw HTTP/fetch directly. This gives full control over
request/response format, streaming, error handling, and removes 6 unnecessary dependencies.

### Why raw HTTP over AI SDK
| Concern              | AI SDK                         | Raw HTTP                    |
|----------------------|--------------------------------|-----------------------------|
| Streaming control    | Wraps in `streamText`          | Direct SSE parsing          |
| Error handling       | Throws generic errors          | Full status code + body     |
| Provider adaptation  | Need adapter per provider      | 3 adapter groups (see below)|
| Bundle size          | ~2-5 MB per provider package   | Zero deps (just `fetch`)    |
| Debugging            | Opaque internal state          | Full request/response log   |

### 3 Adapter Groups (not 6 SDKs)
| Group               | Providers                                           | API Format                          |
|---------------------|-----------------------------------------------------|-------------------------------------|
| OpenAI-compatible   | NVIDIA, OpenRouter, OpenAI, Groq                    | `POST /v1/chat/completions` (SSE)   |
| Anthropic           | Claude                                               | `POST /v1/messages` (SSE)           |
| Google Gemini       | Gemini                                               | `POST /v1/models/{m}:streamGenerate`|

### Provider Priority Order
Users configure a **priority-ordered provider list** in the UI. When a request fails on provider #1,
the router automatically tries #2, #3, etc.

**Config tab UI:**
```
┌─────────────────────────────────────┐
│ Provider Priority                   │
│ ┌───┐                               │
│ │ 1 │ NVIDIA    [API Key: nvapi-…]  │
│ │ 2 │ OpenRouter [API Key: sk-…]    │
│ │ 3 │ Groq       [API Key: gsk-…]   │
│ │ 4 │ OpenAI     [API Key: sk-…]    │
│ │ 5 │ Google     [API Key: AIza…]   │
│ │ 6 │ Anthropic  [API Key: sk-ant…] │
│ └───┘  Drag to reorder              │
│                                      │
│ Max Retries per provider: [10]       │
│ [Save Priority]                      │
└─────────────────────────────────────┘
```

### Files to create
- `proxy/src/adapters/openai.ts` — HTTP streaming for NVIDIA/OpenRouter/OpenAI/Groq
- `proxy/src/adapters/anthropic.ts` — HTTP streaming for Claude
- `proxy/src/adapters/google.ts` — HTTP streaming for Gemini
- `proxy/src/adapter.ts` — adapter registry, provider→adapter resolution

### Files to change
- `proxy/src/config.ts` — add provider enum, API key configs, priority list
- `proxy/src/engine.ts` — replace AI SDK calls with adapter calls
- `proxy/dashboard/index.html` — Config tab: reorderable provider list with API keys

---

## 2. Storage & Persistence

**Goal**: SQLite database so requests, sessions, logs survive proxy restarts.

### Schema (`proxy/src/db.ts`)
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  request_count INTEGER DEFAULT 0
);

CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  timestamp TEXT NOT NULL,
  model TEXT,
  resolved_model TEXT,
  provider TEXT,
  direction TEXT,
  type TEXT,
  content TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  tool_calls TEXT,
  error TEXT,
  duration_ms INTEGER,
  attempts INTEGER DEFAULT 1  -- how many retries before success
);

CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  meta TEXT
);
```

### Files to create/change
- `proxy/src/db.ts` — new: SQLite init, migrations, CRUD helpers
- `proxy/src/request-store.ts` — rewrite to use SQLite
- `proxy/src/logger.ts` — add SQLite log persistence
- `proxy/src/dashboard.ts` — endpoints become DB-backed

### Dependencies
- `better-sqlite3` (synchronous, < 1MB)

---

## 3. Retry System

**Goal**: Retry on the same provider before failing over. Configurable count (default 10).

### How it works
```
for attempt in 0..maxRetries:
  try:
    result = adapter.stream(model, messages, tools, cfg)
    record as success
    return result
  catch (timeout / 5xx / network error):
    wait(1000ms * 2^attempt)  // 1s, 2s, 4s, 8s...
    log "Retry #{attempt+1}/{maxRetries} on {provider}"

// All retries exhausted — failover to next provider
emit "failover: {provider} → {nextProvider}"
route_to_next_provider(model, messages, tools, cfg)
```

### Config
- `DEFAULT_RETRIES=10` in `.env` and Config tab input
- Per-request override via `?retries=5` query param

### Files to change
- `proxy/src/engine.ts` — retry wrapper
- `proxy/src/config.ts` — `retries` field
- `proxy/dashboard/index.html` — Config tab: retry input

---

## 4. Provider-Level Failover (Multi-Routing)

**Goal**: When all retries on provider A fail, automatically try provider B, then C, etc.,
based on the user's priority-ordered provider list. Includes model remapping per provider.

### How it works
```
function execute(model, messages, tools, cfg):
  providers = getProviderPriorityList()  // e.g. [nvidia, openrouter, groq, openai]

  for provider in providers:
    resolvedModel = modelMappings[provider][model] || model
    for attempt in 0..retries:
      try:
        return adapters[provider].stream(resolvedModel, messages, tools, cfg)
      catch (transient error):
        log "retry {provider}/{resolvedModel} attempt {attempt+1}"
        wait(backoff)

    log "failover: {provider}→{next_provider}"

  throw "All providers exhausted for {model}"
```

### Config UI
Provider priority list (drag-reorderable) with model mappings per provider:
```
Provider Priority     Model Mappings
┌──────────────────┐ ┌─────────────────────────────┐
│ 1. NVIDIA  [↑↓] │ │ NVIDIA → claude-opus-4-6     │
│ 2. Groq     [↑↓] │ │   → stepfun-ai/step-3.7-flash│
│ 3. OpenAI   [↑↓] │ │ Groq   → claude-opus-4-6     │
│ 4. Google   [↑↓] │ │   → deepseek-r1-distill      │
│ 5. Anthropic[↑↓] │ │ OpenAI → claude-opus-4-6     │
│ 6. OpenRouter[↑↓]│ │   → gpt-4o                   │
└──────────────────┘ └─────────────────────────────┘
```

### Files to create
- `proxy/src/router.ts` — new: provider failover orchestrator
- `proxy/src/adapters/openai.ts` — see section 1
- `proxy/src/adapters/anthropic.ts`
- `proxy/src/adapters/google.ts`
- `proxy/src/adapter.ts` — registry

### Files to change
- `proxy/src/engine.ts` — delegate to router
- `proxy/src/config.ts` — provider priority list
- `proxy/dashboard/index.html` — Provider Priority tab with model mappings per provider

---

## 5. Analytics

**Goal**: Time-series charts, per-model/per-provider breakdown, latency percentiles.

### Backend endpoints
| Method | Path                       | Response                                      |
|--------|----------------------------|-----------------------------------------------|
| GET    | `/api/analytics/timeseries`| `[{hour, requests, tokens, errors, latency}]` |
| GET    | `/api/analytics/models`    | `[{model, provider, count, avgLatency, successRate}]` |
| GET    | `/api/analytics/providers` | `[{provider, count, failoverCount, avgLatency}]` |
| GET    | `/api/analytics/summary`   | `{totalRequests, totalTokens, uptime, failoverCount}` |

### Files to change
- `proxy/src/dashboard.ts` — analytics aggregation queries
- `proxy/dashboard/index.html` — chart containers (Chart.js CDN)

---

## 6. Traffic Control

**Goal**: Per-model rate limiting, request blocking.

### Rate Limiting
Token bucket per model/provider combo, configurable from UI:
```
Model Pattern       RPM     RPD
claude-opus-4-6*     10    1000
gpt-4o*              30    1500
default              60    5000
```

### Block Rules
Block by model pattern, content regex, or provider:
```
Pattern           Type        Action
gpt-4o-mini       model       block
.*password.*      content     log + block
```

### Files to create/change
- `proxy/src/ratelimit.ts` — new
- `proxy/src/blocklist.ts` — new
- `proxy/src/index.ts` — integrate before routing
- `proxy/dashboard/index.html` — rate limit + block rule UIs

---

## 7. UX Improvements

| Feature                       | Description                                       |
|-------------------------------|---------------------------------------------------|
| Full-text search              | `/api/search?q=...` across sessions + logs        |
| Keyboard shortcuts            | `j/k` navigate, `/` focus search, `r` refresh     |
| Collapsible sidebar           | Toggle to icon-only mode                          |
| Request replay                | "Replay" button resends via POST to same route     |
| Session compare               | Checkbox 2 sessions, side-by-side                  |
| Provider failover timeline    | Visual timeline showing retry → failover chain     |

---

## 8. Operations

| Feature                       | Description                                       |
|-------------------------------|---------------------------------------------------|
| Dashboard auth                | Basic auth via `DASHBOARD_USER`/`DASHBOARD_PASS`  |
| TLS cert management UI        | View expiry, regenerate from dashboard             |
| Health check                  | `GET /api/health`                                 |
| Failover webhook              | POST to URL on every provider failover event       |

---

## Implementation Order

### Phase 1 (Core Engine)
1. Raw HTTP adapters (OpenAI-compat, Anthropic, Google) — remove AI SDK deps
2. Provider priority list config + UI
3. Retry with exponential backoff
4. Provider-level failover router

### Phase 2 (Persistence)
5. SQLite storage (requests, sessions, logs)
6. Rewrite request-store + logger to use SQLite

### Phase 3 (Control)
7. Rate limiting + block rules
8. Analytics aggregation + Chart.js UI
9. Full-text search

### Phase 4 (Polish)
10. UX improvements (keyboard shortcuts, sidebar, replay, compare)
11. Dashboard auth + webhooks + TLS UI

---

## ~20 files, zero AI SDK dependencies, 3 HTTP adapter groups.
