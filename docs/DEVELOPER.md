# Developer Guide — Universal LLM Proxy

This guide explains how to extend Antigravity's proxy with new LLM providers, understand the plugin architecture, and contribute effectively.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Adding a New Provider](#adding-a-new-provider)
3. [Creating a Custom Adapter](#creating-a-custom-adapter)
4. [Tool Normalization System](#tool-normalization-system)
5. [Model Capability Detection](#model-capability-detection)
6. [Local Discovery](#local-discovery)
7. [Testing](#testing)
8. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

The proxy uses a **plugin-based architecture** where each LLM provider is a self-contained plugin that knows how to create adapters, report capabilities, and validate configuration.

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  IProviderPlugin │───▶│  ProviderRegistry │───▶│  ModelAdapter    │
│  (interface)     │    │  (singleton)      │    │  (per-request)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
  getCapabilities()      getAdapter()            streamResponse()
  validateConfig()       hasProvider()           buildRequest()
                         register()
```

### Key Files

| File | Purpose |
|------|---------|
| `proxy/src/provider-plugin.ts` | `IProviderPlugin` interface + `ProviderCapabilities` type |
| `proxy/src/provider-registry.ts` | Singleton `providerRegistry` — manages plugins and adapters |
| `proxy/src/plugins/builtin-plugins.ts` | 10 built-in providers (OpenAI, Anthropic, Google, NVIDIA, etc.) |
| `proxy/src/adapters/*.ts` | Concrete adapter implementations |
| `proxy/src/tool-normalizer.ts` | Normalizes tool calls from external LLMs |
| `proxy/src/tool-capabilities.ts` | Schema registry for well-known tools |
| `proxy/src/model-capabilities.ts` | Pattern-based capability detection |
| `proxy/src/local-discovery.ts` | Auto-discovers local inference endpoints |

---

## Adding a New Provider

### Step 1: Create a Plugin

A provider plugin implements `IProviderPlugin`. Here's a minimal example for Cohere:

```typescript
// proxy/src/plugins/cohere-plugin.ts

import type { IProviderPlugin, ProviderCapabilities } from '../provider-plugin.js';
import { DEFAULT_CAPABILITIES } from '../provider-plugin.js';
import { OpenAICompatAdapter } from '../adapters/openai.js';
import type { ModelAdapter } from '../adapters/types.js';
import type { ProviderConfig } from '../adapter.js';

export class CoherePlugin implements IProviderPlugin {
  readonly id = 'cohere';
  readonly name = 'Cohere';

  getAdapter(config: ProviderConfig): ModelAdapter {
    // Cohere has an OpenAI-compatible endpoint
    return new OpenAICompatAdapter(
      this.id,
      config.baseUrl || 'https://api.cohere.com/v2',
      config.apiKey || '',
    );
  }

  getCapabilities(): ProviderCapabilities {
    return {
      ...DEFAULT_CAPABILITIES,
      label: 'Cohere',
      supportsReasoning: false,    // No reasoning models yet
      supportsImages: false,       // No vision support
      supportsTools: true,         // Supports tool calling
      authMethod: 'header',        // Uses Authorization header
    };
  }

  validateConfig(config: Record<string, unknown>): string | null {
    if (!config.apiKey && !process.env['COHERE_API_KEY']) {
      return 'Missing API key — set COHERE_API_KEY in .env or provide it in config';
    }
    return null;
  }
}
```

### Step 2: Register the Plugin

Add your plugin to `builtin-plugins.ts`:

```typescript
// proxy/src/plugins/builtin-plugins.ts

import { CoherePlugin } from './cohere-plugin.js';

// In registerBuiltinPlugins():
const cohere = new CoherePlugin();
providerRegistry.register(cohere);
```

### Step 3: Add to Adapter Factory

If your provider needs a custom adapter (see [Creating a Custom Adapter](#creating-a-custom-adapter)), add it to `adapter.ts`:

```typescript
// proxy/src/adapter.ts

import { CohereAdapter } from './adapters/cohere.js';

// In the createAdapter() switch:
case 'cohere':
  return new CohereAdapter(cfg.id, baseUrl, apiKey);
```

### Step 4: Add to models.json

Add your provider to the model matrix so users can configure model mappings:

```json
{
  "_provider_models": {
    "cohere": {
      "claude-sonnet-4-6": "command-r-plus",
      "gpt-4o": "command-r"
    }
  }
}
```

### Step 5: Test

```bash
cd proxy
npm test  # Run all tests
npm run typecheck  # Verify types
```

---

## Creating a Custom Adapter

If your provider has unique behavior (image stripping, reasoning effort, etc.), create a custom adapter that extends `OpenAICompatAdapter`.

### Example: Groq Adapter (Image Stripping)

Groq doesn't support vision, so we strip image content:

```typescript
// proxy/src/adapters/groq.ts

import { OpenAICompatAdapter } from './openai.js';
import type { OpenAIMessage } from '../mapper.js';

export class GroqAdapter extends OpenAICompatAdapter {
  constructor(provider: string, baseUrl: string, apiKey: string) {
    super(provider, baseUrl, apiKey);
    this.supportsImages = false;  // Tell the system we don't support images
  }

  protected buildRequest(
    model: string,
    messages: OpenAIMessage[],
    tools?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Record<string, unknown> {
    // Strip image content before sending to Groq
    const cleanedMessages = messages.map(m => {
      if (Array.isArray(m.content)) {
        const textOnly = m.content.filter((part: any) => part.type !== 'image_url');
        return { ...m, content: textOnly.length > 0 ? textOnly : '' };
      }
      return m;
    });

    // Call parent buildRequest with cleaned messages
    return super.buildRequest(model, cleanedMessages, tools, config);
  }
}
```

### Example: Zen Adapter (Reasoning Effort)

Zen/OpenCode forwards reasoning effort to the underlying model:

```typescript
// proxy/src/adapters/zen.ts

import { OpenAICompatAdapter } from './openai.js';
import { getEffortForModel } from '../reasoning-effort.js';
import type { OpenAIMessage } from '../mapper.js';

export class ZenAdapter extends OpenAICompatAdapter {
  protected buildRequest(
    model: string,
    messages: OpenAIMessage[],
    tools?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Record<string, unknown> {
    const body = super.buildRequest(model, messages, tools, config);

    // Add reasoning effort if configured
    const explicitEffort = (config as any)?.providerOptions?.openai?.reasoningEffort;
    const perModelEffort = getEffortForModel(model);
    const effort = explicitEffort || (perModelEffort && perModelEffort !== 'default' ? perModelEffort : null);

    if (effort) {
      body.reasoning_effort = effort;
    }

    return body;
  }
}
```

### Key Override Points

| Method | When to Override |
|--------|------------------|
| `buildRequest()` | Provider needs different request body format |
| `serializeMessages()` | Provider has unique message format requirements |
| `fetchWithRetry()` | Provider needs custom retry logic or headers |
| `parseToolArgs()` | Provider returns tool arguments in non-standard format |
| `isStreaming()` | Provider has different streaming detection logic |

---

## Tool Normalization System

External LLMs often call tools with different parameter names or types than Antigravity expects. The tool normalizer fixes this automatically.

### How It Works

1. **Name Resolution**: `manageTask` → `manage_task` (via aliases)
2. **Param Alias Resolution**: `command` → `CommandLine` (via schema)
3. **Type Coercion**: `"true"` → `true`, `"123"` → `123`
4. **Default Filling**: Missing `Action` → `"list"` (for `manage_task`)
5. **Unknown Param Stripping**: Removes params not in the schema

### Well-Known Tools

The system has built-in schemas for 7 tools:

| Tool | Key Parameters |
|------|----------------|
| `manage_task` | `Action` (required), `TaskId`, `Input` |
| `run_command` | `CommandLine` (required), `Cwd`, `WaitMsBeforeAsync` |
| `write_to_file` | `TargetFile`, `CodeContent`, `Overwrite` (all required) |
| `replace_file_content` | `TargetFile`, `StartLine`, `EndLine`, `ReplacementContent`, `TargetContent`, `Instruction` |
| `list_dir` | `AbsolutePath` |
| `view_file` | `AbsolutePath` |
| `grep_search` | `SearchPath`, `Query`, `Includes` |

### Adding a New Tool Schema

```typescript
// In proxy/src/tool-capabilities.ts, add to WELL_KNOWN_TOOLS:

{
  name: 'my_custom_tool',
  aliases: ['customTool', 'custom-tool'],
  description: 'Does something useful',
  params: {
    Arg1: {
      type: 'string',
      required: true,
      description: 'First argument',
      aliases: ['arg1', 'argument1'],
    },
    Arg2: {
      type: 'boolean',
      required: false,
      default: false,
      aliases: ['arg2'],
    },
  },
},
```

### Dynamic Per-Request Tools

The system can also handle tools defined in `mapped.tools` from the request:

```typescript
// In engine.ts, tools from the request are merged:
toolCapabilityRegistry.setDynamicTools(mapped.tools);
```

---

## Model Capability Detection

The proxy auto-detects model capabilities from the model name using pattern matching.

### Detected Capabilities

| Capability | Patterns That Trigger It |
|------------|--------------------------|
| Reasoning | `r1`, `r2`, `reasoner`, `thinking`, `qwq`, `deepseek.*r[0-9]`, `o[1-9]`, `stepfun`, `step-[0-9]` |
| Vision | `vision`, `vl$`, `multimodal`, `llava`, `cogvlm`, `qwen.*vl` |
| Tools | `function`, `tool` |

### Adding New Patterns

```typescript
// In proxy/src/model-capabilities.ts, add to MODEL_PATTERNS:

{
  pattern: /my-model-family/i,
  capabilities: { supportsReasoning: true },
  label: 'reasoning-my-family',
},
```

### Provider-Aware Detection

When the provider is known (e.g., from local discovery), capabilities are merged:

```typescript
import { detectModelCapabilitiesWithProvider } from './model-capabilities.js';

const caps = detectModelCapabilitiesWithProvider(
  'my-model',
  providerInfo  // from local-discovery
);

// Model-level detection + provider-level defaults
// Provider capabilities serve as baseline, model patterns can add to them
```

---

## Local Discovery

The proxy auto-discovers local inference endpoints on startup.

### Supported Providers

| Provider | Default Port | API Endpoint |
|----------|--------------|--------------|
| Ollama | 11434 | `/api/tags` |
| vLLM | 8000 | `/v1/models` |
| LM Studio | 1234 | `/v1/models` |
| llama.cpp | 8080 | `/v1/models` |
| text-generation-webui | 5000 | `/v1/models` |
| TabbyAPI | 5000 | `/v1/models` |
| LocalAI | 8080 | `/v1/models` |
| LiteLLM | 4000 | `/v1/models` |
| Aphrodite | 8000 | `/v1/models` |

### Adding a New Local Provider

```typescript
// In proxy/src/local-discovery.ts, add to LOCAL_PROVIDERS:

{
  id: 'my-local-provider',
  label: 'My Provider',
  baseUrl: 'http://localhost:9000',
  modelEndpoint: '/v1/models',
  parser: (data) => (data.models || []).map((m: any) => m.id),
  capabilities: {
    supportsTools: true,
    supportsStreaming: true,
    supportsReasoning: false,
    supportsSystemMessages: true,
  },
},
```

---

## Testing

### Running Tests

```bash
cd proxy

# Run all tests
npm test

# Run specific test file
npx tsx test/run.ts plugin-architecture

# Run specific test
npx tsx test/run.ts "P1: ProviderRegistry"
```

### Test File Structure

| Test File | Tests |
|-----------|-------|
| `plugin-architecture.test.ts` | Provider registration, adapter creation, capabilities |
| `tool-translation.test.ts` | Tool normalization, alias resolution, type coercion |
| `model-discovery.test.ts` | Capability detection, caching, labels |
| `provider-adapters.test.ts` | Provider-specific adapter behavior |
| `google-adapter.test.ts` | Google API key security |
| `phase3-correctness.test.ts` | Core pipeline correctness |
| `smoke.test.ts` | Health endpoint availability |

### Writing New Tests

Follow the existing pattern:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MyAdapter } from '../src/adapters/my-adapter.js';

test('M1: MyAdapter does X', () => {
  const adapter = new MyAdapter('my-provider', 'http://localhost:9000', 'test-key');
  const body = (adapter as any).buildRequest(
    'my-model',
    [{ role: 'user', content: 'test' }],
    undefined,
    {},
  ) as any;

  assert.equal(body.model, 'my-model');
  assert.equal(body.stream, true);
});
```

---

## Troubleshooting

### "Unknown provider: xxx"

The provider isn't registered. Either:
1. Add it to `builtin-plugins.ts`, or
2. Register it manually with `providerRegistry.register(new MyPlugin())`

### Tool calls fail with "Missing required parameter"

The LLM sent a tool call without a required parameter. The normalizer fills defaults for well-known tools. For custom tools, add the schema to `tool-capabilities.ts`.

### Reasoning content not showing

The adapter isn't extracting reasoning from the response. Check that:
1. The field name is in `REASONING_FIELD_NAMES` (openai.ts), or
2. The model uses `<think>` tags (automatically detected)

### Model capabilities wrong

Add or adjust patterns in `model-capabilities.ts`. The first matching pattern wins.

### Local provider not discovered

Check:
1. Provider is in `LOCAL_PROVIDERS` array
2. Provider is running on the expected port
3. API endpoint returns a valid model list

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-new-provider`
3. Add your provider plugin and adapter
4. Add tests in `proxy/test/`
5. Run `npm test` and `npm run typecheck`
6. Submit a pull request

See [CONTRIBUTING.md](../CONTRIBUTING.md) for more details.
