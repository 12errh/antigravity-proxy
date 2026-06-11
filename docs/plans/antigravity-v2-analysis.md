# Antigravity 2.0 — Internal Protocol Analysis

*Based on full reverse engineering of Antigravity 2.0's network protocol, verified against production traffic.*

---

## 1. How Antigravity 2.0 Talks to AI

Antigravity 2.0 does **not** call OpenAI, Anthropic, or any third-party API directly. It speaks **only Google Gemini** — specifically three internal Google Cloud Code API endpoints:

| Endpoint | Purpose |
|----------|---------|
| `/v1internal:streamGenerateContent` | Main chat + tool inference (SSE streaming) |
| `/v1internal:cascadeGenerateContent` | Agent cascade / subagent calls (non-streaming) |
| `/v1internal:cascadeStreamGenerateContent` | Streaming agent cascade calls |

All traffic goes to `cloudcode-pa.googleapis.com:443` (or `daily-cloudcode-pa.googleapis.com`). The request format is the **Google Generative Language API** format: `contents[]`, `tools[]`, `generationConfig`, `system_instruction`.

Every single request the desktop app makes hits these three paths. There is no fallback, no multi-provider support, no local model support — it is Google-only, hard-coded.

---

## 2. The Massive Context Problem (Why Quota Burns Fast)

Every request to Gemini carries a massive inline context dump. We measured it. Here is exactly what Antigravity injects:

### XML-Like Tag Structure

```
<identity>...</identity>           → ~1500 tokens of AI agent runtime identity
<skills>...</skills>               → ~1000 tokens, 30+ skill descriptions
<plugins>...</plugins>             → ~500 tokens of plugin configs
<user_rules>...</user_rules>       → ~500 tokens of user-defined rules
<USER_REQUEST>...</USER_REQUEST>   → The actual user message (variable)
<ADDITIONAL_METADATA>...</ADDITIONAL_METADATA> → Extra context
```

### The Math

**Per-request overhead: ~3500-5000 tokens**, every single time.

Even an empty chat where you type "hello" burns ~3500 tokens on context before the model sees your message. If you make 10 requests, that's 35,000-50,000 tokens of pure overhead. Most of this context is identical across requests — it's the same identity, skills, plugins, and rules every time, just re-sent.

On the free Gemini tier (60 requests/min, rate-limited by token count), you can exhaust your quota in a few minutes of normal use.

### The System Instruction

Requests also include a `system_instruction` block containing the full `<identity>...</identity>` block — another ~1500 tokens duplicated from the contents array. So the identity is sent **twice** in every request.

---

## 3. Tool / Function Calling Format

Antigravity declares tools using Google's `functionDeclarations` format with one critical difference: every tool call carries Antigravity-internal metadata fields that the AI model doesn't need:

| Internal Field | Purpose |
|----------------|---------|
| `toolAction` | Tracks the tool action type internally |
| `toolSummary` | Summary text shown in the UI |
| `Summary` | Short display label |
| `Action` | Action type discriminator |

These leak into the model's tool call arguments if not explicitly stripped, confusing third-party models that don't understand Antigravity's internal schema.

### Response Format Requirements

The Antigravity desktop frontend is **extremely strict** about response format. Every SSE event must include:

```json
{
  "candidates": [{
    "index": 0,
    "content": { "role": "model", "parts": [...] },
    "safetyRatings": [
      { "category": "HARM_CATEGORY_HARASSMENT", "probability": "NEGLIGIBLE" },
      { "category": "HARM_CATEGORY_HATE_SPEECH", "probability": "NEGLIGIBLE" },
      { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "probability": "NEGLIGIBLE" },
      { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "probability": "NEGLIGIBLE" }
    ],
    "groundingMetadata": { "groundingChunks": [], "groundingSupports": [] }
  }],
  "usageMetadata": { "promptTokenCount": ..., "candidatesTokenCount": ..., "totalTokenCount": ... }
}
```

**Missing any of these causes silent UI crashes** — the desktop shows "Analyzing..." forever without error messages.

### Parts Array Semantics

Streaming events use **delta** parts (only the new text):
- `{ "text": "Hello" }` → each chunk is incremental
- `{ "thought": true, "text": "..." }` → thinking/reasoning tokens (rendered in a special UI pane)

The final event bundles everything together: accumulated text + all tool calls:
- `{ "text": "full accumulated text" }`
- `{ "functionCall": { "name": "...", "args": {...} } }` → one per parallel tool call
- `{ "thought": true, "text": "..." }` → reasoning tokens

Tool calls from parallel execution are grouped into a single `parts` array — one `functionCall` part per tool call.

---

## 4. Authentication

Antigravity uses a standard Google Gemini API key (`AIza...`). The key is bundled with the desktop app installation. Every request passes the key as a query parameter in the original app traffic:

```
https://cloudcode-pa.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key=AIza...
```

There is no OAuth, no token exchange, no session management. It's just a plain API key in the URL.

> **Proxy note:** When the proxy forwards requests to Google (via the Google Gemini adapter), it sends the key in the `x-goog-api-key` header instead of the URL query param. This avoids leaking the key into logs, HTTP referrers, and intermediate proxies. The fix was applied in the proxy's `GoogleAdapter` and `provider-cache.ts`.

---

## 5. Model Support

Despite being locked to Google's API format, Antigravity 2.0 supports "model switching" in the UI. This works by changing the `model` field in the request body. The supported model IDs are hard-coded in the desktop app and include names like:

- `gemini-2.5-flash` (the default)
- `gemini-3.1-flash`
- `gemini-3-flash-agent` (cascade/subagent model)
- `claude-sonnet-4-6-thinking`
- `claude-opus-4-6-thinking`
- `gpt-oss-120b`
- `deepseek-v4-flash`
- `qwen3-32b`

These are **not real Google model IDs** — they are abstract identifiers. Antigravity sends them as-is in the Google API `model` field. Google's endpoint accepts them because the Cloud Code API doesn't enforce strict model validation at the gateway level — it proxies the model name to whatever backend is configured.

---

## 6. The Cascade Mechanism

Antigravity's agentic features (subagents, planning, background tasks) use the `cascade*` endpoints. A cascade is a multi-step chain where:

1. A primary model call completes
2. The desktop app examines the response for planning actions
3. It spawns sub-agent calls via the `cascade` endpoints
4. Sub-agent results merge back into the main conversation

Each cascade step is a **separate API call** with the full context overhead. A single agentic task (e.g., "build a game engine") can produce 20-50 cascade steps, each burning 3500-5000 context tokens.

---

## 7. What We Built (The Proxy)

The proxy intercepts these three Google API paths on localhost:443 (TLS) and:

### What It Strips

1. **Identity block** (`<identity>...</identity>`) in system_instruction — replaces with a ~50-character reference to `agent-context.md`
2. **Bulk context** (`<skills>`, `<plugins>`, `<user_rules>`) — strips entirely, preserving only `<USER_REQUEST>` and `<ADDITIONAL_METADATA>`
3. **Internal tool parameters** (`toolAction`, `toolSummary`, `Summary`, `Action`) — removed from tool call arguments

### Token Savings

| Item | Before | After |
|------|--------|-------|
| Identity block | ~1500 tokens | ~10 tokens (file reference) |
| Skills + Plugins | ~2000 tokens | 0 (stripped) |
| User rules | ~500 tokens | 0 (stripped) |
| **Total overhead** | **~4000 tokens** | **~10 tokens** |

The model reads `agent-context.md` once via `view_file` on the first request, caching it in context for the session.

### What It Adds

1. **Multi-provider failover** — routes to NVIDIA, OpenRouter, OpenAI, Groq, Anthropic, Google Gemini, or local Ollama/vLLM/LM Studio models
2. **Per-model provider routing** — different models can hit different providers
3. **Retry with exponential backoff** — handles 429/5xx automatically
4. **Cost tracking** — per-request, per-model, per-provider, per-day with SQLite persistence
5. **Rate limiting + blocklist** — prevent abuse at the proxy level
6. **Dashboard** — real-time metrics, logs, config management, session browsing

---

## 8. The Good

- **Amazing UX**: The desktop app is polished — nice UI, inline tool calling, file operations, browser automation, image generation all work seamlessly
- **Agent architecture**: The cascade system for multi-step tasks is genuinely powerful
- **Tool calling**: Parallel function calling with rich file operations works better than most alternatives
- **Context aware**: The app does know about your workspace, skills, and plugins — it's just very verbose about it

## 9. The Bad

- **Google-only**: No provider choice despite advertising "model switching" — all traffic goes to Google Cloud Code
- **Quota incineration**: 3500-5000 tokens of overhead per request means even light use burns through the free tier fast
- **No persistence**: No local storage of conversations, no request history, no audit trail
- **No offline mode**: Cannot work with local models at all
- **Fragile response parsing**: The UI silently crashes if response metadata is missing — no error messages, just infinite "Analyzing..."

## 10. The Ugly

- **Hard-coded API key**: The Gemini key is bundled with the desktop app binary — if it's revoked, every installation breaks simultaneously
- **Internal metadata leaking**: `toolAction`, `toolSummary` etc. leak into model arguments, confusing third-party models
- **Context duplicated**: The `<identity>` block appears in both `contents[]` and `system_instruction` — sent twice per request
- **No streaming fallback**: If the SSE connection drops mid-stream, the entire conversation state can be lost
- **Cascade amplification**: Each agentic step is a separate API call with full overhead — a complex task can generate 50+ API calls

---

## 11. Technical Summary

| Metric | Value |
|--------|-------|
| API Format | Google Generative Language (Gemini) |
| Endpoints | 3 internal Cloud Code paths |
| Context overhead | ~3500-5000 tokens per request |
| Overhead after proxy | ~10 tokens (98% reduction) |
| Supported providers | 10 (proxy), 1 (native) |
| Auth mechanism | API key in URL query param |
| Response format | SSE with strict metadata requirements |
| Tool format | Google functionDeclarations + internal metadata |
| Cascade steps | Separate API call per step |

---

*This analysis is based on packet inspection of Antigravity 2.0 desktop traffic and full source code of the open-source Antigravity Proxy. All measurements were verified against production API calls.*
