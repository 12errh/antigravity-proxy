# Antigravity Proxy v2 — Engineering Spec

---

## PRD — Product Requirements Document

### Problem Statement

Antigravity Proxy v1 is a single-provider (NVIDIA) pass-through with in-memory request tracking. Users face four key limitations:

1. **Single point of failure** — if the provider goes down or rate-limits, all requests fail
2. **No persistence** — requests, logs, and session history are lost on restart
3. **No cost visibility** — users have no idea how much they're spending across providers
4. **Cloud-only** — no way to run local models (Ollama, vLLM) as fallback or primary

### User Stories

| ID  | Story |
|-----|-------|
| US1 | As a user, I want to configure multiple API providers (OpenAI, Anthropic, Google, Groq) so I can choose the best model for each task |
| US2 | As a user, I want to set a priority order of providers so if one fails, the proxy automatically tries the next |
| US3 | As a user, I want local models (Ollama, vLLM, LM Studio) to appear as providers so I can use free/private inference |
| US4 | As a user, I want configurable retries with exponential backoff so transient failures don't kill my requests |
| US5 | As a user, I want auto-failover across providers so my requests succeed even when providers are down |
| US6 | As a user, I want all request history to survive restarts so I can audit past sessions |
| US7 | As a user, I want to see cost per session, per model, and per day so I can track spending |
| US8 | As a user, I want per-model rate limiting so I don't exceed API quotas |
| US9 | As a user, I want analytics (latency, success rate, token usage) so I can optimize my setup |
| US10 | As a user, I want to block or allow specific models/patterns so I can enforce policies |

### Success Metrics

- Zero requests fail due to provider outages (failover handles it)
- All history survives proxy restarts
- Cost tracking within ±1% of provider invoice
- Local models auto-discovered within 2 seconds of config save

---

## TRD — Technical Requirements Document

### Architecture Overview

```
Antigravity Desktop
       │
       ▼
  ┌──────────────┐     ┌─────────────┐
  │  port 4000   │     │  port 443   │
  │  Dashboard   │     │  Proxy TLS  │
  └──────┬───────┘     └──────┬──────┘
         │                    │
         ▼                    ▼
  ┌──────────────┐     ┌──────────────┐
  │  SQLite DB   │     │   Router     │
  │  (requests,  │     │  (failover   │
  │   sessions,  │     │   engine)    │
  │   logs)      │     └──────┬───────┘
  └──────────────┘            │
                              ▼
  ┌──────────────────────────────────────┐
  │         Adapter Layer                │
  │  ┌────────┐┌────────┐┌────────┐      │
  │  │ OpenAI- ││Anthro- ││Google  │      │
  │  │ compat  ││pic     ││Gemini  │      │
  │  │(NVIDIA, ││(Claude)││        │      │
  │  │ OpenRO, ││        ││        │      │
  │  │ OpenAI, ││        ││        │      │
  │  │ Groq,   ││        ││        │      │
  │  │ Ollama, ││        ││        │      │
  │  │ vLLM,   ││        ││        │      │
  │  │ LM Stu) ││        ││        │      │
  │  └────────┘└────────┘└────────┘      │
  └──────────────────────────────────────┘
```

### Component Tree & Responsibilities

```
proxy/src/
  adapters/
    openai.ts      — HTTP streaming for OpenAI-compat API
    anthropic.ts   — HTTP streaming for Anthropic Messages API
    google.ts      — HTTP streaming for Google Gemini API
  adapter.ts        — Registry: provider → adapter resolution
  router.ts         — Failover orchestrator: retry → next → next
  engine.ts         — Rewritten: delegates to router instead of AI SDK
  config.ts         — Extended: provider enum, priority list, URLs, keys
  db.ts             — NEW: SQLite init, migrations, CRUD operations
  request-store.ts  — Rewritten: SQLite-backed instead of in-memory
  logger.ts         — Extended: writes to SQLite logs table
  pricing.ts        — NEW: cost calculation per model/provider
  discovery.ts      — NEW: auto-detect local models from Ollama/vLLM/LM Studio
  ratelimit.ts      — NEW: token bucket rate limiter
  blocklist.ts      — NEW: pattern-based request blocking
  dashboard.ts      — Extended: cost/analytics/sessions endpoints
  index.ts          — Entry: integrate rate limit + block before router
```

### Data Flow — Request Lifecycle

```
1. Incoming request (port 443)
2. [Rate Limit Check] — reject if over quota for model/provider
3. [Block Check]      — reject if matches block rule
4. [Router.execute()] — begin failover loop:
   a. Get provider priority list → [nvidia, groq, openai, google, anthropic, ollama]
   b. For each provider:
      i.   Resolve model via provider-specific mappings
      ii.  Call adapter.stream(resolvedModel, messages, tools, cfg)
      iii. If success → record to SQLite → return response
      iv.  If transient error → retry with backoff (up to N times)
      v.   If exhausted → log failover → try next provider
   c. All providers exhausted → return 503
5. [Cost Calculation] — on success, compute cost from token counts
6. [SQLite Persist]   — save request, update session, append to logs
```

### Database Schema

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
  attempts INTEGER DEFAULT 1,
  cost REAL DEFAULT 0
);

CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  meta TEXT
);
```

### Adapter Contracts

Every adapter implements the same interface:
```typescript
interface ModelAdapter {
  provider: string;
  stream(
    model: string,
    messages: Message[],
    tools?: Tool[],
    config?: GenerationConfig,
  ): AsyncGenerator<StreamChunk>;
}

interface StreamChunk {
  type: 'text' | 'tool-call' | 'error' | 'done' | 'thought';
  content?: string;
  name?: string;
  args?: Record<string, unknown>;
  finishReason?: string;
}
```

### Provider-Adapter Mapping

| Provider       | Adapter          | Auth        | Base URL                                  | Thinking |
|----------------|------------------|-------------|-------------------------------------------|----------|
| NVIDIA         | openai.ts        | API key     | `https://integrate.api.nvidia.com/v1`     | — |
| OpenRouter     | openai.ts        | API key     | `https://openrouter.ai/api/v1`            | — |
| OpenAI         | openai.ts        | API key     | `https://api.openai.com/v1`               | internal |
| Groq           | openai.ts        | API key     | `https://api.groq.com/openai/v1`          | — |
| Anthropic      | anthropic.ts     | API key     | `https://api.anthropic.com/v1`            | `type:"thinking"` |
| Google Gemini  | google.ts        | API key     | `https://generativelanguage.googleapis.com`| `thought: true` |
| OpenCode Zen   | openai.ts        | API key     | `https://opencode.ai/zen/v1`             | `reasoning_content` |
| Ollama         | openai.ts        | none        | `http://localhost:11434`                  | — |
| vLLM           | openai.ts        | none        | `http://localhost:8000`                   | — |
| LM Studio      | openai.ts        | none        | `http://localhost:1234`                   | — |

### Cost Tracking

Pricing data stored in `pricing.json` (editable from dashboard):
```json
{
  "nvidia": {
    "deepseek-ai/deepseek-v4-flash": { "input": 0.15, "output": 0.60 },
    "default": { "input": 0.50, "output": 2.00 }
  },
  "openai": {
    "gpt-4o": { "input": 2.50, "output": 10.00 },
    "default": { "input": 1.00, "output": 4.00 }
  },
  "local": {
    "default": { "input": 0, "output": 0 }
  }
}
```

Calculation: `cost = (promptTokens * inputPrice + outputTokens * outputPrice) / 1_000_000`

### Rate Limiting

Token bucket algorithm, per-model pattern:
```
requests: tokens bucket(rate, period)
check: if bucket.empty → 429 Too Many Requests
allow: consume 1 token
refill: period/rate tokens per second
```

### Block Rules

Pattern-based, evaluated in order:
```
model pattern  → block if model name matches
content regex  → block if request body matches regex
provider match → block all traffic to a specific provider
```

---

## Implementation Plan

### Phase 1 — Core Engine (4 steps)

**Goal**: Replace AI SDK with raw HTTP adapters, add multi-provider support with failover, per-provider model mapping, hot-reload.

| Step | File(s) | Description | Verification |
|------|---------|-------------|--------------|
| 1.1 | `proxy/src/adapters/openai.ts` | HTTP streaming adapter for OpenAI-compatible APIs. Handles SSE parsing, tool calls, error codes | Test with NVIDIA + Groq |
| 1.2 | `proxy/src/adapters/anthropic.ts` | HTTP streaming adapter for Anthropic Messages API + extended thinking | Test with Claude |
| 1.3 | `proxy/src/adapters/google.ts` | HTTP streaming adapter for Google Gemini streaming API + thought parts | Test with Gemini |
| 1.4 | `proxy/src/adapter.ts` | Registry mapping provider names to adapter instances | Unit test |
| 1.5 | `proxy/src/router.ts` | Failover orchestrator — iterate priority list, retry with backoff, fail to next | Integration test with mock providers |
| 1.6 | `proxy/src/models.ts` | ModelResolver — per-provider model mapping (`_provider_models`), hot-reloadable | Verify resolution per provider |
| 1.7 | `proxy/src/engine.ts` | Rewrite to delegate to router instead of AI SDK `streamText` | Full e2e test |
| 1.8 | `proxy/src/config.ts` | Extended config: provider priority list, per-provider API keys/URLs, retry config, hot-reload() | Verify config load + reload |
| 1.9 | `proxy/src/dashboard.ts` | Status + reload endpoints, config/models saves trigger hot-reload | Dashboard updates without restart |
| 1.10 | `proxy/dashboard/index.html` | Drag-and-drop provider priority list, per-provider model entries, retry config, hot-reload toasts | Visual inspection |

**Dependencies**: None (raw `fetch` only)

### Phase 2 — Persistence + Cost (3 steps)

**Goal**: SQLite storage, cost tracking dashboard.

| Step | File(s) | Description | Verification |
|------|---------|-------------|--------------|
| 2.1 | `proxy/src/db.ts` | SQLite init, migrations, CRUD for sessions, requests, logs | Unit tests pass |
| 2.2 | `proxy/src/db.ts`, `proxy/src/request-store.ts`, `proxy/src/logger.ts` | Rewrite in-memory stores to SQLite-backed | Data survives restart |
| 2.3 | `proxy/src/pricing.ts`, `proxy/pricing.json` | Cost calculator, pricing data | Cost matches manual calc |
| 2.4 | `proxy/src/dashboard.ts`, `proxy/dashboard/index.html` | Cost aggregation endpoints + Cost tab with charts | Cost tab shows correct data |

**Dependencies**: `better-sqlite3`

### Phase 3 — Local Models (3 steps)

**Goal**: Auto-discover and support Ollama, vLLM, LM Studio.

| Step | File(s) | Description | Verification |
|------|---------|-------------|--------------|
| 3.1 | `proxy/src/discovery.ts` | Probe each local provider's model API, return available models | Manual with running Ollama |
| 3.2 | `proxy/src/config.ts`, `proxy/dashboard/index.html` | URL inputs for local providers, "Discover Models" button | Discovered models appear |
| 3.3 | `proxy/src/router.ts`, `proxy/src/config.ts` | Local providers participate in priority/failover list | Local used as fallback |

**Dependencies**: One of (Ollama, vLLM, LM Studio) running locally

### Phase 4 — Control (3 steps)

**Goal**: Rate limiting, request blocking, analytics.

| Step | File(s) | Description | Verification |
|------|---------|-------------|--------------|
| 4.1 | `proxy/src/ratelimit.ts`, `proxy/dashboard/index.html` | Token bucket rate limiter per model pattern, UI config | 429 returned when over limit |
| 4.2 | `proxy/src/blocklist.ts`, `proxy/dashboard/index.html` | Pattern-based block rules, UI editor | Blocked requests return 403 |
| 4.3 | `proxy/src/dashboard.ts`, `proxy/dashboard/index.html` | Analytics aggregation + Chart.js charts | Charts render real data |

### Phase 5 — Polish (4 steps)

**Goal**: UX improvements, operations, security.

| Step | File(s) | Description | Verification |
|------|---------|-------------|--------------|
| 5.1 | `proxy/dashboard/index.html` | Full-text search, keyboard shortcuts, collapsible sidebar | User testing |
| 5.2 | `proxy/dashboard/index.html` | Request replay, session compare | User testing |
| 5.3 | `proxy/src/dashboard.ts` | Dashboard basic auth, health endpoint | Auth blocks unauthenticated |
| 5.4 | `proxy/dashboard/index.html` | TLS cert management UI, failover webhook | Cert shows expiry |

---

## Appendix

### File Inventory

Total new files: 7
Total changed files: 8

#### New Files (Phase 1 Complete)
- `proxy/src/adapters/openai.ts` — OpenAI-compat HTTP streaming adapter
- `proxy/src/adapters/anthropic.ts` — Anthropic HTTP streaming adapter
- `proxy/src/adapters/google.ts` — Google Gemini HTTP streaming adapter
- `proxy/src/adapters/types.ts` — Shared StreamChunk / ModelAdapter types
- `proxy/src/adapter.ts` — Adapter registry
- `proxy/src/router.ts` — Failover orchestrator
- `proxy/src/models.ts` — Per-provider model resolver

#### Changed Files (Phase 1 Complete)
- `proxy/src/engine.ts` — Replace AI SDK with adapter/router calls
- `proxy/src/config.ts` — Extended config schema + hot-reload
- `proxy/src/dashboard.ts` — Hot-reload endpoint, config/models saves trigger reload
- `proxy/src/index.ts` — Remove mapModelName, pass raw model to router
- `proxy/dashboard/index.html` — Drag-and-drop provider priority, per-provider models, retry UI, hot-reload

#### Future Files (Phases 2-5)
- `proxy/src/db.ts` — SQLite database layer
- `proxy/src/pricing.ts` — Cost calculator
- `proxy/src/discovery.ts` — Local model auto-discovery
- `proxy/src/ratelimit.ts` — Token bucket rate limiter
- `proxy/src/blocklist.ts` — Pattern-based block rules
- `proxy/pricing.json` — Default pricing data

### Dependencies Added/Removed
- **Removed**: `ai`, `@ai-sdk/openai` — Vercel AI SDK no longer used
- **Added (future)**: `better-sqlite3` — SQLite driver (~700KB, Phase 2)

### Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Provider API format changes | Adapter breaks | Adapters isolate per-provider logic; fix one file |
| SQLite write contention | Dashboard slow | WAL mode, synchronous off |
| Rate limiting false positives | Legit requests blocked | Configurable thresholds, log-only mode |
| Local model discovery fails | Model not listed | Manual model name input as fallback |
