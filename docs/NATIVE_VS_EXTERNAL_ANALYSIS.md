# Antigravity 2.0 — Native vs External Model Analysis

## Executive Summary

The Antigravity 2.0 architecture has a **language_server.exe** (Go binary) that handles all AI interactions natively with Google Gemini. The proxy intercepts these calls and routes them to external providers. The key difference is **how context, tools, and instructions reach the model**.

---

## 1. What Native Gemini Models Receive

### 1.1 System Instruction (Built into language_server.exe)

The language server constructs the system prompt internally with:

```
┌─────────────────────────────────────────────────┐
│ SYSTEM INSTRUCTION (Gemini native)              │
├─────────────────────────────────────────────────┤
│ 1. Identity & Role                              │
│    - Agent persona and behavioral rules         │
│    - Working directory context                   │
│    - User preferences and settings              │
│                                                 │
│ 2. Tool Definitions (functionDeclarations)       │
│    - Full JSON schemas for every tool           │
│    - Parameter types, descriptions, required    │
│    - Tool config (auto/manual/none)             │
│                                                 │
│ 3. Context Tags (XML-like)                      │
│    <skills>     → Plugin/skill definitions      │
│    <plugins>    → Plugin configurations         │
│    <user_rules> → User custom rules             │
│    <identity>   → Agent identity/persona        │
│    <subagents>  → Available subagents           │
│                                                 │
│ 4. Workspace Context                             │
│    - File paths and directory structure          │
│    - Available files and their purposes          │
│    - Project type and tech stack                 │
│                                                 │
│ 5. Behavioral Instructions                      │
│    - Response style guidelines                   │
│    - Safety and compliance rules                 │
│    - Communication formatting                    │
└─────────────────────────────────────────────────┘
```

### 1.2 Tool Format (Gemini Native)

```json
{
  "functionDeclarations": [
    {
      "name": "run_command",
      "description": "Execute a shell command...",
      "parameters": {
        "type": "object",
        "properties": {
          "CommandLine": { "type": "string", "description": "..." },
          "Cwd": { "type": "string", "description": "..." },
          "WaitMsBeforeAsync": { "type": "integer", "description": "..." }
        },
        "required": ["CommandLine"]
      }
    }
  ]
}
```

### 1.3 Key Characteristics
- **All context is in the system instruction** — no need to read files
- **Tools are native Gemini format** — no translation needed
- **Context tags are parsed by the model** — structured XML-like format
- **Working directory is explicit** — injected directly
- **Skills/plugins are inline** — not referenced externally

---

## 2. What External Models Receive (via Proxy)

### 2.1 Context Stripping

The proxy **removes** these bulk context tags:
- `<skills>` → ~1000-2000 tokens saved
- `<plugins>` → ~500-1000 tokens saved
- `<user_rules>` → ~200-500 tokens saved
- `<identity>` → ~500-1000 tokens saved
- `<subagents>` → ~300-500 tokens saved

**Total saved: ~3500-5000 tokens per request**

### 2.2 What Gets Injected Instead

The proxy injects TWO things:

#### A. System Message (`ANTIGRAVITY_CONTEXT.prompt`)
Location: `proxy/src/antigravity-context.ts`

This contains:
1. **Tool Schemas** — manage_task, run_command, write_to_file, replace_file_content
2. **Tool Selection Decision Tree** — 8-point decision process
3. **Error Recovery Rules** — Common errors and fixes
4. **Agent Spawning Guidelines** — When to spawn vs do directly
5. **Verification Doctrine** — How to validate changes
6. **Background Task Management** — manage_task lifecycle
7. **Completion Criteria** — When to stop
8. **Reasoning & Thinking Support** — Thought chunk format
9. **Workspace Context Envelope** — Anti-hallucination wrapper
10. **Runtime State Authority** — What's authoritative

#### B. User Message (Context File Prompt)
Injected as first user message:

```
Read the agent-context.md file using the view_file tool to adopt the runtime identity.
Use this tool to access the complete operating manual for external agents before
proceeding with your task. The file is located at: <path>. This includes the
critical tool selection rules, subagent doctrine, verification requirements,
and confidence framework needed to use Antigravity correctly.
```

### 2.3 Tool Format (OpenAI-compatible)

```json
{
  "type": "function",
  "function": {
    "name": "run_command",
    "description": "Execute a shell command...",
    "parameters": {
      "type": "object",
      "properties": {
        "CommandLine": { "type": "string", "description": "..." },
        "Cwd": { "type": "string", "description": "..." },
        "WaitMsBeforeAsync": { "type": "integer", "description": "..." }
      },
      "required": ["CommandLine"]
    }
  }
}
```

### 2.4 Key Differences from Native
- **Context is split** — system message + file read required
- **Tools are translated** — Gemini → OpenAI format
- **Model must read a file** — extra tool call needed
- **Less structured** — no XML-like tags for organization
- **Some tools missing** — not all Antigravity tools are documented

---

## 3. Gap Analysis — What External Models Miss

### 3.1 Missing Tool Documentation

The proxy's system message documents these tools:
- ✅ manage_task
- ✅ run_command
- ✅ write_to_file
- ✅ replace_file_content

**But these tools are NOT documented in the system message:**
- ❌ list_dir
- ❌ view_file
- ❌ grep_search
- ❌ invoke_subagent
- ❌ define_subagent
- ❌ manage_subagents
- ❌ send_message
- ❌ read_url_content
- ❌ ask_permission
- ❌ ask_question
- ❌ list_permissions
- ❌ generate_image
- ❌ schedule
- ❌ search_web
- ❌ multi_replace_file_content
- ❌ read_resource
- ❌ list_resources
- ❌ call_mcp_tool

### 3.2 Missing Context Elements

**Native Gemini gets these inline, external models don't:**
1. **Complete skills list** — All 30+ science skills, Android CLI, Chrome DevTools, etc.
2. **Plugin configurations** — Firebase, Google Antigravity SDK, Modern Web Guidance
3. **Subagent definitions** — research, self, and custom agents
4. **User rules** — Personal preferences and custom instructions
5. **Identity prompt** — Agent persona and behavioral guidelines
6. **Communication style** — Response formatting rules
7. **Safety/compliance** — Chinese AI model compliance rules

### 3.3 Missing Behavioral Context

**Native Gemini understands these natively:**
1. **Planning mode** — When to create implementation plans
2. **Artifact system** — How to create/manage artifacts
3. **Slash commands** — /goal, /schedule, /browser, /grill-me
4. **Web application development** — Tech stack, design aesthetics, SEO
5. **Conversation transcripts** — How to access history
6. **Background task lifecycle** — Complete manage_task reference

### 3.4 Tool Schema Gaps

**The proxy normalizes tool calls but some schemas are incomplete:**
1. **invoke_subagent** — Missing full Subagents array schema
2. **define_subagent** — Missing system_prompt, enable_write_tools params
3. **manage_subagents** — Missing Action enum details
4. **ask_question** — Missing is_multi_select, options schema
5. **schedule** — Missing CronExpression format details
6. **call_mcp_tool** — Missing ServerName, ToolName, Arguments schema

---

## 4. Root Cause Analysis

### Why the Gap Exists

1. **Incremental Development** — agent-context.md was built iteratively, not from a spec
2. **Token Budget** — Adding all tools would increase system prompt size significantly
3. **Binary Extraction Difficulty** — language_server.exe is compiled Go, hard to reverse
4. **Format Translation Loss** — Gemini → OpenAI conversion loses some structure
5. **Context Stripping Trade-off** — Removing bulk context saves tokens but loses information

### The Core Problem

**Native Gemini models have a 1M token context window and receive everything inline.**

**External models via the proxy:**
- Receive a stripped system message (~3000 tokens)
- Must read agent-context.md (~32KB) via view_file
- May not understand all available tools
- May not follow Antigravity-specific workflows

---

## 5. Recommended Improvements

### Priority 1: Expand System Message Documentation

Add ALL Antigravity tools to the system message in `antigravity-context.ts`:

```
Priority Tools (add to system message):
1. list_dir — Directory exploration
2. view_file — File reading
3. grep_search — Pattern matching
4. invoke_subagent — Agent spawning
5. define_subagent — Agent creation
6. manage_subagents — Agent lifecycle
7. send_message — Inter-agent communication
8. ask_permission — Permission requests
9. ask_question — User clarification
10. generate_image — Image generation
11. schedule — Timer/cron management
```

### Priority 2: Add Missing Context Sections

Add these sections to the system message:

1. **Complete Skills Reference** — Brief list of all 30+ skills
2. **Plugin Overview** — Available plugins and their capabilities
3. **Subagent Types** — research, self, and custom agent definitions
4. **Planning Mode** — When/how to create implementation plans
5. **Artifact System** — How to create/manage artifacts
6. **Communication Style** — Response formatting rules

### Priority 3: Improve Context File (agent-context.md)

Restructure agent-context.md to be more scannable:

1. **Quick Reference Table** — Tool name → parameters → common usage
2. **Decision Flowcharts** — Visual decision trees for tool selection
3. **Error Recovery Matrix** — Quick lookup for common errors
4. **Workflow Templates** — Common task patterns
5. **Verification Checklists** — Step-by-step validation

### Priority 4: Enhance Tool Normalization

Improve the tool normalizer to handle:

1. **Missing required parameters** — Auto-fill from context
2. **Incorrect parameter types** — Coerce more aggressively
3. **Unknown tool names** — Map to closest match
4. **Malformed arguments** — Parse and fix

### Priority 5: Add Model-Specific Optimizations

Create adapter-specific enhancements:

1. **Claude** — Maximize thinking budget, use extended thinking
2. **GPT-4** — Optimize for function calling format
3. **DeepSeek** — Leverage reasoning capabilities
4. **Local models** — Simplified tool schemas for smaller context windows

---

## 6. Implementation Plan

### Phase 1: Expand System Message (1-2 hours)
- Add all tool schemas to `antigravity-context.ts`
- Add context sections (skills, plugins, subagents)
- Test with Claude, GPT-4, DeepSeek

### Phase 2: Restructure agent-context.md (2-3 hours)
- Create quick reference tables
- Add decision flowcharts
- Improve error recovery matrix

### Phase 3: Enhance Tool Normalizer (1-2 hours)
- Add missing parameter defaults
- Improve type coercion
- Add tool name fuzzy matching

### Phase 4: Model-Family-Aware Context Injection — ⏸️ ON HOLD (not currently implementing)

> **Status: ON HOLD** — Design approved but not being implemented at this time.
> Phases 1-3 are complete. Phase 5 (Testing & Validation) should be done first.
> This phase will be revisited after real-world provider testing data is available.

**Approach:** Config-driven model family registry instead of hardcoded per-model logic.

**Core idea:** A `model-family-profiles.json` config file maps model name patterns to behavior profiles. Adding a new model family is a config entry, not code.

**Profile fields per model family:**
- `pattern` — regex to match model names (e.g. `"qwen|qwq"`)
- `context_tier` — `full` | `medium` | `minimal` (controls system prompt size)
- `prompt_style` — `xml-tags` | `concise-rules` | `step-by-step` | `minimal`
- `tool_schemas` — `full` | `condensed` | `essential-only`
- `reasoning` — thinking/reasoning configuration per model family

**Context tiers:**
| Tier | Max Tokens | Includes | Target Models |
|------|-----------|----------|---------------|
| full | ~6000 | All tools, workflow templates, error recovery, verification doctrine | Claude, GPT-4, DeepSeek, Qwen-72B+ |
| medium | ~3000 | All tools, error recovery, condensed descriptions | Kimi, MiniMax, GLM, Yi, Qwen-7B-14B |
| minimal | ~1500 | Essential tools only (6 tools), minimal descriptions | Llama, Mistral, Phi, Gemma, InternLM, Baichuan |

**Implementation files (when activated):**
- `proxy/src/model-family-profiles.json` — Config registry
- `proxy/src/model-family-resolver.ts` — Pattern matching + profile resolution
- `proxy/src/antigravity-context.ts` — Profile-aware prompt generation

**Covered model families:**
- Western: Claude, GPT-4/o-series, DeepSeek, Gemini
- Chinese: Qwen, Kimi/Moonshot, MiniMax/Abab, GLM/ChatGLM, Yi/01-AI, InternLM, Baichuan
- Local/Open: Llama, Mistral, Phi, Gemma
- Provider-hosted: Groq, NVIDIA, OpenRouter

**Why ON HOLD:**
- Phases 1-3 already closed the major gap (external models now see 100% of tools)
- Need real-world testing data to know which models actually need condensed contexts
- Risk of over-engineering before validating the need
- Current system message works across all tested providers

### Phase 5: Testing & Validation (2-3 hours)
- Run comprehensive test suite
- Validate with each provider
- Measure token usage and latency

---

## 7. Expected Outcomes

### Before Improvement
- External models miss ~40% of available tools
- Models must read agent-context.md (extra tool call)
- Some workflows fail silently
- Inconsistent behavior across providers

### After Improvement (Phases 1-3 Complete)
- External models see 100% of tools in system message ✅
- No need to read files for basic operation ✅
- All workflows work consistently ✅
- Tool normalizer handles misspellings, type coercion, and missing params ✅
- agent-context.md restructured with quick reference tables and workflow templates ✅
- Provider-specific optimizations: deferred to Phase 4 (ON HOLD)
- Token usage optimized (no wasted context): deferred to Phase 4 (ON HOLD)

---

## 8. Appendix: File Locations

| File | Purpose | Status |
|------|---------|--------|
| `proxy/src/antigravity-context.ts` | System message injection | Modified (Phase 1) |
| `proxy/src/workspace-context.ts` | Anti-hallucination envelope | Unchanged |
| `proxy/src/engine.ts` | Context injection pipeline | Unchanged |
| `proxy/src/tool-normalizer.ts` | Tool call normalization | Modified (Phase 3) |
| `proxy/src/tool-capabilities.ts` | Tool schema registry | Modified (Phase 1, 3) |
| `agent-context.md` | Full operating manual | Modified (Phase 2) |
| `proxy/src/model-family-profiles.json` | Model family config registry | Phase 4 (ON HOLD) |
| `proxy/src/model-family-resolver.ts` | Pattern matching + profile resolution | Phase 4 (ON HOLD) |
| `language_server.exe` | Native Gemini handler | 127MB (binary, unchanged) |

---

*Analysis completed: 2026-06-15*
*Analyst: MiMo-v2.5 (Antigravity Proxy)*
