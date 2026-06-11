/**
 * Unit tests for Phase 4 — Provider-Specific Adapters.
 *
 * Tests GroqAdapter (image stripping), ZenAdapter (reasoning effort
 * forwarding), and NvidiaAdapter (NVIDIA-specific reasoning support).
 *
 * Each adapter extends OpenAICompatAdapter and overrides buildRequest().
 * We call buildRequest() via (adapter as any) since it's protected.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroqAdapter } from '../src/adapters/groq.js';
import { ZenAdapter } from '../src/adapters/zen.js';
import { NvidiaAdapter } from '../src/adapters/nvidia.js';
import type { OpenAIMessage } from '../src/mapper.js';

// ─── GroqAdapter tests ───────────────────────────────────────────────────

test('A1: GroqAdapter strips image content from messages', () => {
  const adapter = new GroqAdapter('groq', 'https://api.groq.com/openai/v1', 'test-key');
  const messages: OpenAIMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
      ],
    },
  ];

  const body = (adapter as any).buildRequest('mixtral-8x7b', messages, undefined, {}) as any;
  const cleanedContent = body.messages[0].content;
  assert.ok(Array.isArray(cleanedContent), 'content should be an array');
  assert.equal(cleanedContent.length, 1, 'should have only text part after stripping image');
  assert.equal(cleanedContent[0].type, 'text', 'should keep text parts');
  assert.equal(cleanedContent[0].text, 'Describe this image', 'should preserve text content');
});

test('A1: GroqAdapter handles text-only messages without modification', () => {
  const adapter = new GroqAdapter('groq', 'https://api.groq.com/openai/v1', 'test-key');
  const messages: OpenAIMessage[] = [
    { role: 'user', content: 'Just text' },
  ];

  const body = (adapter as any).buildRequest('mixtral-8x7b', messages, undefined, {}) as any;
  assert.equal(body.messages[0].content, 'Just text', 'text-only messages should pass through unchanged');
});

test('A1: GroqAdapter sets supportsImages to false', () => {
  const adapter = new GroqAdapter('groq', 'https://api.groq.com/openai/v1', 'test-key');
  assert.equal((adapter as any).supportsImages, false, 'GroqAdapter should not support images');
});

test('A1: GroqAdapter handles mixed text/image with multiple text parts', () => {
  const adapter = new GroqAdapter('groq', 'https://api.groq.com/openai/v1', 'test-key');
  const messages: OpenAIMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'First part' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,img1' } },
        { type: 'text', text: 'Second part' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,img2' } },
      ],
    },
  ];

  const body = (adapter as any).buildRequest('mixtral-8x7b', messages, undefined, {}) as any;
  const cleaned = body.messages[0].content;
  assert.equal(cleaned.length, 2, 'should keep only text parts');
  assert.equal(cleaned[0].text, 'First part');
  assert.equal(cleaned[1].text, 'Second part');
});

test('A1: GroqAdapter handles all-image messages gracefully', () => {
  const adapter = new GroqAdapter('groq', 'https://api.groq.com/openai/v1', 'test-key');
  const messages: OpenAIMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,img1' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,img2' } },
      ],
    },
  ];

  const body = (adapter as any).buildRequest('mixtral-8x7b', messages, undefined, {}) as any;
  const cleaned = body.messages[0].content;
  assert.equal(cleaned.length, 0, 'all images stripped → empty content array');
});

test('A1: GroqAdapter passes standard params correctly', () => {
  const adapter = new GroqAdapter('groq', 'https://api.groq.com/openai/v1', 'test-key');
  const body = (adapter as any).buildRequest(
    'mixtral-8x7b',
    [{ role: 'user', content: 'hi' }],
    undefined,
    { maxTokens: 1000, temperature: 0.7, topP: 0.9 },
  ) as any;
  assert.equal(body.max_tokens, 1000);
  assert.equal(body.temperature, 0.7);
  assert.equal(body.top_p, 0.9);
});

// ─── ZenAdapter tests ────────────────────────────────────────────────────

test('A2: ZenAdapter forwards reasoning_effort from providerOptions', () => {
  const adapter = new ZenAdapter('zen', 'https://opencode.ai/zen/v1', 'test-key');
  const body = (adapter as any).buildRequest(
    'deepseek-r1',
    [{ role: 'user', content: 'think step by step' }],
    undefined,
    { providerOptions: { openai: { reasoningEffort: 'high' } } },
  ) as any;
  assert.equal(body.reasoning_effort, 'high', 'should forward reasoning_effort from providerOptions');
});

test('A2: ZenAdapter does not set reasoning_effort when not configured', () => {
  const adapter = new ZenAdapter('zen', 'https://opencode.ai/zen/v1', 'test-key');
  const body = (adapter as any).buildRequest(
    'deepseek-r1',
    [{ role: 'user', content: 'hi' }],
    undefined,
    {},
  ) as any;
  assert.equal(body.reasoning_effort, undefined, 'should not set reasoning_effort when not configured');
});

test('A2: ZenAdapter passes standard params correctly', () => {
  const adapter = new ZenAdapter('zen', 'https://opencode.ai/zen/v1', 'test-key');
  const body = (adapter as any).buildRequest(
    'deepseek-r1',
    [{ role: 'user', content: 'hi' }],
    undefined,
    { maxTokens: 2000, temperature: 0.5, stopSequences: ['\n\n'] },
  ) as any;
  assert.equal(body.max_tokens, 2000);
  assert.equal(body.temperature, 0.5);
  assert.deepEqual(body.stop, ['\n\n']);
});

test('A2: ZenAdapter serializes tools correctly', () => {
  const adapter = new ZenAdapter('zen', 'https://opencode.ai/zen/v1', 'test-key');
  const tools = {
    get_weather: {
      description: 'Get weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string' },
        },
        required: ['location'],
      },
    },
  };
  const body = (adapter as any).buildRequest(
    'deepseek-r1',
    [{ role: 'user', content: 'weather?' }],
    tools,
    {},
  ) as any;
  assert.ok(Array.isArray(body.tools), 'tools should be an array');
  assert.equal(body.tools[0].type, 'function');
  assert.equal(body.tools[0].function.name, 'get_weather');
});

// ─── NvidiaAdapter tests ──────────────────────────────────────────────────

test('A3: NvidiaAdapter forwards reasoning_effort from providerOptions', () => {
  const adapter = new NvidiaAdapter('nvidia', 'https://integrate.api.nvidia.com/v1', 'test-key');
  const body = (adapter as any).buildRequest(
    'nvidia/llama-3.1-nemotron-70b-instruct',
    [{ role: 'user', content: 'think carefully' }],
    undefined,
    { providerOptions: { openai: { reasoningEffort: 'high' } } },
  ) as any;
  assert.equal(body.reasoning_effort, 'high', 'should forward reasoning_effort from providerOptions');
});

test('A3: NvidiaAdapter does not set reasoning_effort when not configured', () => {
  const adapter = new NvidiaAdapter('nvidia', 'https://integrate.api.nvidia.com/v1', 'test-key');
  const body = (adapter as any).buildRequest(
    'nvidia/llama-3.1-nemotron-70b-instruct',
    [{ role: 'user', content: 'hi' }],
    undefined,
    {},
  ) as any;
  assert.equal(body.reasoning_effort, undefined, 'should not set reasoning_effort when not configured');
});

test('A3: NvidiaAdapter passes standard params correctly', () => {
  const adapter = new NvidiaAdapter('nvidia', 'https://integrate.api.nvidia.com/v1', 'test-key');
  const body = (adapter as any).buildRequest(
    'nvidia/llama-3.1-nemotron-70b-instruct',
    [{ role: 'user', content: 'hi' }],
    undefined,
    { maxTokens: 4000, temperature: 0.2, topP: 0.95 },
  ) as any;
  assert.equal(body.max_tokens, 4000);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.top_p, 0.95);
});

test('A3: NvidiaAdapter serializes tools correctly', () => {
  const adapter = new NvidiaAdapter('nvidia', 'https://integrate.api.nvidia.com/v1', 'test-key');
  const tools = {
    search: {
      description: 'Search the web',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
  };
  const body = (adapter as any).buildRequest(
    'nvidia/llama-3.1-nemotron-70b-instruct',
    [{ role: 'user', content: 'search?' }],
    tools,
    {},
  ) as any;
  assert.ok(Array.isArray(body.tools), 'tools should be an array');
  assert.equal(body.tools[0].function.name, 'search');
});

// ─── Cross-adapter consistency tests ─────────────────────────────────────

test('A4: All provider adapters set model and stream:true', () => {
  const groq = new GroqAdapter('groq', 'http://groq', 'k');
  const zen = new ZenAdapter('zen', 'http://zen', 'k');
  const nvidia = new NvidiaAdapter('nvidia', 'http://nvidia', 'k');

  const msg = [{ role: 'user', content: 'test' }];

  const groqBody = (groq as any).buildRequest('m', msg, undefined, {}) as any;
  const zenBody = (zen as any).buildRequest('m', msg, undefined, {}) as any;
  const nvidiaBody = (nvidia as any).buildRequest('m', msg, undefined, {}) as any;

  assert.equal(groqBody.model, 'm', 'Groq should set model');
  assert.equal(zenBody.model, 'm', 'Zen should set model');
  assert.equal(nvidiaBody.model, 'm', 'Nvidia should set model');

  assert.equal(groqBody.stream, true, 'Groq should set stream:true');
  assert.equal(zenBody.stream, true, 'Zen should set stream:true');
  assert.equal(nvidiaBody.stream, true, 'Nvidia should set stream:true');
});
