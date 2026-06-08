/**
 * Unit tests for Phase 3 — Correctness fixes.
 *
 * Each fix is verified with a focused, behavior-asserting test. Where direct
 * testing of internal behavior is cheap (e.g., buildRequest is a pure function
 * of inputs → output), we call the function and assert on the result. Where
 * the behavior is too entangled with the network (e.g., the Anthropic SSE
 * parser, which only runs against a real Anthropic response), we fall back to
 * a static-analysis test on the source.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { AnthropicAdapter } from '../src/adapters/anthropic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(__dirname, '..', 'src', rel), 'utf-8');

// ---------------------------------------------------------------------------
// B11: incoming record uses resolvedModel: '' (not the user-requested model)
// ---------------------------------------------------------------------------

test('Phase 3 / B11: index.ts incoming record uses resolvedModel: "" (placeholder)', () => {
  const index = src('index.ts');
  // Find a requestStore.push({...}) block that has direction: 'incoming'.
  // The push() call spans multiple lines, so we need to look at the FULL
  // call (everything between the nearest 'push({' and the matching '});').
  const pushStart = index.indexOf("requestStore.push({");
  assert.ok(pushStart >= 0, 'should find a requestStore.push call');
  const slice = index.slice(pushStart, pushStart + 1000);
  const incomingBlock = slice.match(/push\(\{[\s\S]*?direction:\s*['"]incoming['"][\s\S]*?\}\);/);
  assert.ok(incomingBlock, 'should find an incoming-direction push() call');
  assert.ok(
    /resolvedModel:\s*['"]['"]/.test(incomingBlock![0]),
    `incoming record should set resolvedModel to empty string, got: ${incomingBlock![0]}`,
  );
  // And it should NOT use `resolvedModel: model` (the buggy old behavior)
  assert.ok(
    !/direction:\s*['"]incoming['"][\s\S]{0,500}resolvedModel:\s*model\b/.test(incomingBlock![0]),
    'incoming record should NOT use `resolvedModel: model` (the misleading placeholder)',
  );
});

test('Phase 3 / B11: index.ts outgoing success record still uses usedModel || model', () => {
  // Sanity: the OUTGOING record should still use the real resolved model.
  const index = src('index.ts');
  // Look for outgoing records (text/tool-call) that use usedModel
  const outgoingUsesUsedModel = /resolvedModel:\s*usedModel\s*\|\|\s*model/.test(index);
  assert.ok(
    outgoingUsesUsedModel,
    'outgoing records should resolve resolvedModel to `usedModel || model` (the actually-sent model)',
  );
});

// ---------------------------------------------------------------------------
// A3: Anthropic buildRequest translates reasoningEffort → thinking
// ---------------------------------------------------------------------------

test('Phase 3 / A3: Anthropic buildRequest sets thinking config when reasoningEffort=high', () => {
  const adapter = new AnthropicAdapter('https://api.anthropic.com', 'test-key');
  const body = (adapter as any).buildRequest(
    'claude-3-5-sonnet-20241022',
    [{ role: 'user', content: 'hi' }],
    undefined,
    { providerOptions: { openai: { reasoningEffort: 'high' } } },
  ) as any;
  assert.ok(body.thinking, 'body.thinking should be set when reasoningEffort is provided');
  assert.equal(body.thinking.type, 'enabled', 'thinking.type should be "enabled"');
  assert.ok(
    typeof body.thinking.budget_tokens === 'number' && body.thinking.budget_tokens >= 1024,
    `budget_tokens should be a number >= 1024, got: ${body.thinking.budget_tokens}`,
  );
});

test('Phase 3 / A3: Anthropic buildRequest does NOT set thinking when no reasoningEffort', () => {
  const adapter = new AnthropicAdapter('https://api.anthropic.com', 'test-key');
  const body = (adapter as any).buildRequest(
    'claude-3-5-sonnet-20241022',
    [{ role: 'user', content: 'hi' }],
    undefined,
    {},
  ) as any;
  assert.equal(
    body.thinking,
    undefined,
    'body.thinking should NOT be set when reasoningEffort is absent (regression guard)',
  );
});

test('Phase 3 / A3: Anthropic buildRequest respects max_tokens cap on budget', () => {
  // If max_tokens is small, the budget should also be small to leave room
  // for the actual response tokens.
  const adapter = new AnthropicAdapter('https://api.anthropic.com', 'test-key');
  const body = (adapter as any).buildRequest(
    'claude-3-5-sonnet-20241022',
    [{ role: 'user', content: 'hi' }],
    undefined,
    {
      maxTokens: 2000,
      providerOptions: { openai: { reasoningEffort: 'high' } }, // would default to 16384
    },
  ) as any;
  assert.ok(body.thinking, 'should set thinking');
  assert.ok(
    body.thinking.budget_tokens < 2000,
    `budget_tokens should be less than max_tokens (2000), got: ${body.thinking.budget_tokens}`,
  );
});

test('Phase 3 / A3: Anthropic buildRequest handles each effort level distinctly', () => {
  const adapter = new AnthropicAdapter('https://api.anthropic.com', 'test-key');
  const low = (adapter as any).buildRequest('m', [], undefined, {
    maxTokens: 20000,
    providerOptions: { openai: { reasoningEffort: 'low' } },
  }) as any;
  const med = (adapter as any).buildRequest('m', [], undefined, {
    maxTokens: 20000,
    providerOptions: { openai: { reasoningEffort: 'medium' } },
  }) as any;
  const high = (adapter as any).buildRequest('m', [], undefined, {
    maxTokens: 20000,
    providerOptions: { openai: { reasoningEffort: 'high' } },
  }) as any;
  assert.ok(low.thinking && med.thinking && high.thinking);
  assert.ok(
    low.thinking.budget_tokens < med.thinking.budget_tokens,
    `low (${low.thinking.budget_tokens}) should be < medium (${med.thinking.budget_tokens})`,
  );
  assert.ok(
    med.thinking.budget_tokens < high.thinking.budget_tokens,
    `medium (${med.thinking.budget_tokens}) should be < high (${high.thinking.budget_tokens})`,
  );
});

// ---------------------------------------------------------------------------
// A4: engine.ts streamResponse surfaces 'attempt' chunks
// ---------------------------------------------------------------------------

test('Phase 3 / A4: engine.ts exports a StreamResponseChunk type that includes "attempt"', () => {
  const engine = src('engine.ts');
  assert.ok(
    /export\s+type\s+StreamResponseChunk\b/.test(engine),
    'engine.ts should export a StreamResponseChunk type',
  );
  // The type definition is multi-line, ending in the LAST `;` on the type
  // statement. We greedy-match from `StreamResponseChunk = ` up to the last
  // `;` (i.e., the end of the union), then check that the body contains
  // a 'attempt' variant.
  const typeDef = engine.match(/export\s+type\s+StreamResponseChunk\s*=\s*[\s\S]+?\}\s*;/);
  assert.ok(typeDef, 'should find the StreamResponseChunk type definition');
  assert.ok(
    /\|\s*\{\s*type:\s*['"]attempt['"]/.test(typeDef![0]),
    `StreamResponseChunk union should include a "attempt" variant, got: ${typeDef![0]}`,
  );
});

test('Phase 3 / A4: engine.ts streamResponse has an "attempt" case in the chunk switch', () => {
  const engine = src('engine.ts');
  assert.ok(
    /chunk\.type\s*===\s*['"]attempt['"]/.test(engine),
    'engine.ts streamResponse should have a case for chunk.type === "attempt"',
  );
});

test('Phase 3 / A4: index.ts consumer already handles "attempt" chunks', () => {
  // Regression guard: A4 plumbs attempt chunks through engine.ts to index.ts.
  // The index.ts consumer must still recognize them. (It did even before A4,
  // but the chunks never arrived.)
  const index = src('index.ts');
  assert.ok(
    /ctype\s*===\s*['"]attempt['"]/.test(index),
    'index.ts handleStreamGenerate should still have a case for ctype === "attempt"',
  );
});

// ---------------------------------------------------------------------------
// B12: catch block records the rate-limit hit on failure
// ---------------------------------------------------------------------------

test('Phase 3 / B12: index.ts declares lastAttemptedProvider in scope of both try and catch', () => {
  // The catch block must be able to read the variable — it must be declared
  // OUTSIDE the streaming try block (or with var, which we don't use).
  // Other try blocks in the file (e.g., forwardToGoogle) are unrelated.
  const index = src('index.ts');
  const declPos = index.search(/(let|const|var)\s+lastAttemptedProvider\s*=/);
  assert.ok(declPos >= 0, 'index.ts should declare lastAttemptedProvider');
  // Find the streaming try — it's the one that comes right after the
  // `const generator = streamResponse(...)` call. We look forward from the
  // declaration for the FIRST `try {` AND its matching `catch` that also
  // references `lastAttemptedProvider`. The declaration must be before the
  // try it pairs with.
  const after = index.slice(declPos);
  const tryPos = after.indexOf('try {');
  const catchPos = after.indexOf('catch (');
  assert.ok(tryPos >= 0, 'should find a try block after the declaration');
  assert.ok(catchPos >= 0, 'should find a catch block after the declaration');
  assert.ok(catchPos > tryPos, 'catch must come after try');
  // And the catch block must reference lastAttemptedProvider (proving this
  // try/catch pair is the streaming one, not some other try in the file).
  const catchSlice = after.slice(catchPos, catchPos + 600);
  assert.ok(
    /recordRequest\s*\(\s*lastAttemptedProvider\s*\)/.test(catchSlice),
    'the catch block that follows the declaration must call recordRequest(lastAttemptedProvider)',
  );
});

test('Phase 3 / B12: index.ts catch block calls recordRequest(lastAttemptedProvider)', () => {
  const index = src('index.ts');
  // The catch block should have `if (lastAttemptedProvider) recordRequest(lastAttemptedProvider);`
  const catchBlock = index.match(/catch\s*\([^)]*\)\s*\{[\s\S]{0,500}/);
  assert.ok(catchBlock, 'should find the catch block');
  assert.ok(
    /recordRequest\s*\(\s*lastAttemptedProvider\s*\)/.test(catchBlock![0]),
    `catch block should call recordRequest(lastAttemptedProvider), got: ${catchBlock![0]}`,
  );
});

test('Phase 3 / B12: index.ts attempt handler updates lastAttemptedProvider', () => {
  const index = src('index.ts');
  // The 'attempt' branch should assign the provider to lastAttemptedProvider.
  assert.ok(
    /lastAttemptedProvider\s*=\s*ap/.test(index) || /lastAttemptedProvider\s*=\s*\(?chunk/.test(index),
    'attempt handler should assign to lastAttemptedProvider',
  );
});

// ---------------------------------------------------------------------------
// B10: Anthropic parallel tool calls (Map<index, ...>)
// ---------------------------------------------------------------------------

test('Phase 3 / B10: anthropic.ts uses a Map for per-block tool state', () => {
  const anthropic = src('adapters/anthropic.ts');
  // The fix uses toolBlocks = new Map<number, ...>()
  assert.ok(
    /const\s+toolBlocks\s*=\s*new\s+Map\s*</.test(anthropic),
    'anthropic.ts should declare a Map<number, ...> for tool-block state (B10 fix)',
  );
});

test('Phase 3 / B10: anthropic.ts no longer uses scalar toolName/toolArgs/hasToolUse', () => {
  const anthropic = src('adapters/anthropic.ts');
  // The old code had `let toolName = ''`, `let toolArgs = ''`, `let hasToolUse = false`
  // These are all removed in the fix.
  for (const sym of ['let hasToolUse', 'let toolName =', 'let toolArgs =']) {
    assert.ok(
      !anthropic.includes(sym),
      `anthropic.ts should no longer have the dead scalar state "${sym}"`,
    );
  }
});

test('Phase 3 / B10: anthropic.ts content_block_stop keys the yield by event.index', () => {
  const anthropic = src('adapters/anthropic.ts');
  // The stop handler should look up the block by index, not just yield the scalar.
  assert.ok(
    /event\.index/.test(anthropic),
    'anthropic.ts should reference event.index for per-block lookups',
  );
  // And the stop handler should delete the block after yielding.
  assert.ok(
    /toolBlocks\.delete/.test(anthropic),
    'anthropic.ts should clean up the per-block entry on content_block_stop',
  );
});

// ---------------------------------------------------------------------------
// A6: router second-pass behavior is documented
// ---------------------------------------------------------------------------

test('Phase 3 / A6: router.ts has a clarifying comment on the second-pass fallback', () => {
  const router = src('router.ts');
  // The second pass should be annotated as "global minus tried" semantics
  assert.ok(
    /Second pass[\s\S]{0,500}A6/i.test(router),
    'router.ts should have a clarifying A6 comment near the second-pass fallback',
  );
});
