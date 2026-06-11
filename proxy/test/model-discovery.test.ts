/**
 * Unit tests for Phase 3 — Enhanced Model Discovery.
 *
 * Tests model-capabilities.ts (pattern-based capability detection, caching,
 * provider-aware merging, label generation) and local-discovery.ts
 * (cache functions, shouldRescan, provider definitions).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectModelCapabilities,
  detectModelCapabilitiesWithProvider,
  getModelCapabilityLabel,
  clearModelCapabilityCache,
  getModelCapabilityCacheSize,
} from '../src/model-capabilities.js';
import {
  getCachedLocalProviders,
  getOnlineLocalProviders,
  getCachedProvider,
  shouldRescan,
} from '../src/local-discovery.js';

// ─── Model Capability Detection tests ─────────────────────────────────────

test('M1: detectModelCapabilities detects reasoning by name patterns', () => {
  // R1 pattern
  const r1 = detectModelCapabilities('deepseek-r1');
  assert.equal(r1.supportsReasoning, true, 'deepseek-r1 should support reasoning');

  // QwQ pattern
  const qwq = detectModelCapabilities('qwq-32b');
  assert.equal(qwq.supportsReasoning, true, 'qwq-32b should support reasoning');

  // O-series pattern
  const o1 = detectModelCapabilities('o1-mini');
  assert.equal(o1.supportsReasoning, true, 'o1-mini should support reasoning');
  const o3 = detectModelCapabilities('o3-4fs');
  assert.equal(o3.supportsReasoning, true, 'o3-4fs should support reasoning');

  // DeepSeek R pattern
  const ds = detectModelCapabilities('deepseek-r1-671b');
  assert.equal(ds.supportsReasoning, true, 'deepseek-r1-671b should support reasoning');

  // Thinking pattern
  const think = detectModelCapabilities('qwen-thinking');
  assert.equal(think.supportsReasoning, true, 'qwen-thinking should support reasoning');

  // Reasoner pattern
  const reasoner = detectModelCapabilities('claude-reasoner');
  assert.equal(reasoner.supportsReasoning, true, 'claude-reasoner should support reasoning');

  // Stepfun pattern
  const stepfun = detectModelCapabilities('stepfun-1v');
  assert.equal(stepfun.supportsReasoning, true, 'stepfun should support reasoning');

  // Step-N pattern
  const step = detectModelCapabilities('step-2-16k');
  assert.equal(step.supportsReasoning, true, 'step-2 should support reasoning');
});

test('M1: detectModelCapabilities detects vision by name patterns', () => {
  const vision = detectModelCapabilities('gpt-4-vision');
  assert.equal(vision.supportsImages, true, 'gpt-4-vision should support images');

  const vl = detectModelCapabilities('qwen-vl');
  assert.equal(vl.supportsImages, true, 'qwen-vl should support images');

  const multimodal = detectModelCapabilities('gemini-multimodal');
  assert.equal(multimodal.supportsImages, true, 'gemini-multimodal should support images');

  const llava = detectModelCapabilities('llava-v1.6');
  assert.equal(llava.supportsImages, true, 'llava should support images');

  const cogvlm = detectModelCapabilities('cogvlm-chat');
  assert.equal(cogvlm.supportsImages, true, 'cogvlm should support images');
});

test('M1: detectModelCapabilities detects tool support', () => {
  const func = detectModelCapabilities('gpt-4-function-call');
  assert.equal(func.supportsTools, true, 'gpt-4-function-call should support tools');

  const tool = detectModelCapabilities('tool-use-model');
  assert.equal(tool.supportsTools, true, 'tool-use-model should support tools');
});

test('M1: detectModelCapabilities returns conservative defaults for unknown models', () => {
  const caps = detectModelCapabilities('some-random-model-v3');
  assert.equal(caps.supportsReasoning, false, 'unknown model should not support reasoning');
  assert.equal(caps.supportsTools, false, 'unknown model should not support tools');
  assert.equal(caps.supportsImages, false, 'unknown model should not support images');
  assert.equal(caps.supportsStreaming, true, 'unknown model should support streaming by default');
  assert.equal(caps.supportsSystemMessages, true, 'unknown model should support system messages by default');
});

test('M1: detectModelCapabilities is case-insensitive', () => {
  const upper = detectModelCapabilities('DEEPSEEK-R1-671B');
  assert.equal(upper.supportsReasoning, true, 'case-insensitive reasoning detection');

  const mixed = detectModelCapabilities('QwQ-32B-Preview');
  assert.equal(mixed.supportsReasoning, true, 'mixed case reasoning detection');
});

test('M1: detectModelCapabilities caches results', () => {
  clearModelCapabilityCache();
  assert.equal(getModelCapabilityCacheSize(), 0, 'cache should start empty');

  detectModelCapabilities('deepseek-r1');
  assert.equal(getModelCapabilityCacheSize(), 1, 'should cache result');

  detectModelCapabilities('deepseek-r1');
  assert.equal(getModelCapabilityCacheSize(), 1, 'should reuse cached result');

  detectModelCapabilities('gpt-4-vision');
  assert.equal(getModelCapabilityCacheSize(), 2, 'should cache new model separately');

  clearModelCapabilityCache();
  assert.equal(getModelCapabilityCacheSize(), 0, 'clear should empty cache');
});

test('M1: detectModelCapabilities handles model names with multiple patterns', () => {
  // A model that matches both reasoning and vision patterns
  const caps = detectModelCapabilities('deepseek-r1-vision');
  assert.equal(caps.supportsReasoning, true, 'should detect reasoning');
  assert.equal(caps.supportsImages, true, 'should detect vision');
});

// ─── Provider-aware detection tests ───────────────────────────────────────

test('M2: detectModelCapabilitiesWithProvider merges provider capabilities', () => {
  const modelCaps = detectModelCapabilities('unknown-model');
  assert.equal(modelCaps.supportsReasoning, false, 'model alone should not detect reasoning');

  // With a provider that supports reasoning
  const providerInfo = {
    id: 'test-provider',
    label: 'Test',
    baseUrl: 'http://test',
    online: true,
    models: ['unknown-model'],
    capabilities: { supportsTools: true, supportsStreaming: true, supportsReasoning: true, supportsSystemMessages: true },
  };

  const merged = detectModelCapabilitiesWithProvider('unknown-model', providerInfo);
  assert.equal(merged.supportsReasoning, true, 'should inherit reasoning from provider');
  assert.equal(merged.supportsTools, true, 'should inherit tools from provider');
});

test('M2: detectModelCapabilitiesWithProvider handles no provider info', () => {
  const caps = detectModelCapabilitiesWithProvider('gpt-4-vision');
  assert.equal(caps.supportsImages, true, 'should still detect vision from model name');
  assert.equal(caps.supportsReasoning, false, 'should not have reasoning');
});

// ─── Label generation tests ───────────────────────────────────────────────

test('M3: getModelCapabilityLabel returns correct labels', () => {
  const reasoningLabel = getModelCapabilityLabel('deepseek-r1');
  assert.ok(reasoningLabel.includes('reasoning'), 'reasoning model should have reasoning label');
  assert.ok(!reasoningLabel.includes('vision'), 'reasoning model should not have vision label');

  const visionLabel = getModelCapabilityLabel('gpt-4-vision');
  assert.ok(visionLabel.includes('vision'), 'vision model should have vision label');

  const bothLabel = getModelCapabilityLabel('deepseek-r1-vision');
  assert.ok(bothLabel.includes('reasoning'), 'should have reasoning label');
  assert.ok(bothLabel.includes('vision'), 'should have vision label');

  const basicLabel = getModelCapabilityLabel('basic-model');
  assert.equal(basicLabel, 'basic', 'basic model should return "basic"');
});

// ─── Local Discovery tests (non-network) ─────────────────────────────────

test('M4: getCachedLocalProviders returns empty array initially', () => {
  const cached = getCachedLocalProviders();
  assert.ok(Array.isArray(cached), 'should return an array');
  assert.equal(cached.length, 0, 'should be empty before first scan');
});

test('M4: getOnlineLocalProviders returns empty array initially', () => {
  const online = getOnlineLocalProviders();
  assert.ok(Array.isArray(online), 'should return an array');
  assert.equal(online.length, 0, 'should be empty before first scan');
});

test('M4: getCachedProvider returns undefined for unknown provider', () => {
  const provider = getCachedProvider('nonexistent');
  assert.equal(provider, undefined, 'should return undefined');
});

test('M4: shouldRescan returns true when never scanned', () => {
  // lastScan starts at 0, so any positive minInterval should trigger true
  assert.ok(shouldRescan(1000), 'should rescan when never scanned');
});

test('M4: shouldRescan respects custom interval', () => {
  // With a very large interval, it should still want to rescan because lastScan=0
  assert.ok(shouldRescan(999999), 'should rescan when lastScan=0 regardless of interval');
});

// ─── Module exports verification ─────────────────────────────────────────

test('M5: local-discovery exports all expected functions', async () => {
  const mod = await import('../src/local-discovery.js');
  assert.equal(typeof mod.scanLocalProviders, 'function', 'should export scanLocalProviders');
  assert.equal(typeof mod.getCachedLocalProviders, 'function', 'should export getCachedLocalProviders');
  assert.equal(typeof mod.getOnlineLocalProviders, 'function', 'should export getOnlineLocalProviders');
  assert.equal(typeof mod.getCachedProvider, 'function', 'should export getCachedProvider');
  assert.equal(typeof mod.shouldRescan, 'function', 'should export shouldRescan');
});

test('M5: model-capabilities exports all expected functions', async () => {
  const mod = await import('../src/model-capabilities.js');
  assert.equal(typeof mod.detectModelCapabilities, 'function');
  assert.equal(typeof mod.detectModelCapabilitiesWithProvider, 'function');
  assert.equal(typeof mod.getModelCapabilityLabel, 'function');
  assert.equal(typeof mod.clearModelCapabilityCache, 'function');
  assert.equal(typeof mod.getModelCapabilityCacheSize, 'function');
});
