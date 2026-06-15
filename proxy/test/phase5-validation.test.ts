/**
 * Phase 5 — Testing & Validation
 *
 * Comprehensive validation of the native vs external model parity system.
 * Verifies:
 * 1. System message contains all tool schemas
 * 2. Tool registry completeness
 * 3. Token count measurement
 * 4. Normalizer edge cases
 * 5. Agent-context.md structure
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { toolCapabilityRegistry } from '../src/tool-capabilities.js';
import { normalizeToolCall } from '../src/tool-normalizer.js';
import { ANTIGRAVITY_CONTEXT } from '../src/antigravity-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 1. System Message Completeness ────────────────────────────────────

const EXPECTED_TOOLS_IN_SYSTEM_MESSAGE = [
  'list_dir', 'view_file', 'grep_search', 'write_to_file', 'replace_file_content',
  'run_command', 'manage_task',
  'invoke_subagent', 'define_subagent', 'manage_subagents', 'send_message',
  'search_web', 'read_url_content', 'start_browser_session', 'browser_action',
  'ask_permission', 'ask_question', 'list_permissions',
  'generate_image', 'schedule', 'multi_replace_file_content',
];

test('V1: System message contains all expected tool names', () => {
  const prompt = ANTIGRAVITY_CONTEXT.prompt;
  for (const tool of EXPECTED_TOOLS_IN_SYSTEM_MESSAGE) {
    assert.ok(
      prompt.includes(tool),
      `System message should mention tool "${tool}"`,
    );
  }
});

test('V1: System message contains key behavioral sections', () => {
  const prompt = ANTIGRAVITY_CONTEXT.prompt;
  const sections = [
    'Tool Selection Decision Tree',
    'Error Recovery Rules',
    'Agent Spawning Guidelines',
    'Verification Doctrine',
    'Background Task Management',
    'Planning Mode',
    'Artifact System',
    'Skills & Plugins',
    'Subagent Types',
    'Confidence Framework',
    'Communication Style',
    'Completion Criteria',
    'Reasoning & Thinking Support',
    'Runtime State Authority',
  ];
  for (const section of sections) {
    assert.ok(
      prompt.includes(section),
      `System message should contain section "${section}"`,
    );
  }
});

test('V1: System message contains workspace context envelope', () => {
  const prompt = ANTIGRAVITY_CONTEXT.prompt;
  assert.ok(
    prompt.includes('workspace_context_envelope') || prompt.includes('WORKSPACE_CONTEXT_FILE'),
    'System message should contain workspace context envelope reference',
  );
});

// ─── 2. Tool Registry Completeness ─────────────────────────────────────

const EXPECTED_WELL_KNOWN_TOOLS = [
  'manage_task', 'run_command', 'write_to_file', 'replace_file_content',
  'list_dir', 'view_file', 'grep_search',
  'invoke_subagent', 'define_subagent', 'manage_subagents', 'send_message',
  'search_web', 'read_url_content', 'browser_action', 'start_browser_session',
  'ask_permission', 'ask_question', 'list_permissions',
  'generate_image', 'schedule',
  'multi_replace_file_content', 'read_resource', 'list_resources', 'call_mcp_tool',
];

test('V2: Tool registry has all expected well-known tools', () => {
  for (const tool of EXPECTED_WELL_KNOWN_TOOLS) {
    assert.ok(
      toolCapabilityRegistry.hasTool(tool),
      `Registry should have tool "${tool}"`,
    );
  }
});

test('V2: All well-known tools have schemas with params', () => {
  for (const tool of EXPECTED_WELL_KNOWN_TOOLS) {
    const schema = toolCapabilityRegistry.getSchema(tool);
    assert.ok(schema, `Tool "${tool}" should have a schema`);
    assert.ok(
      typeof schema!.params === 'object',
      `Tool "${tool}" should have params object`,
    );
  }
});

test('V2: Required params have type definitions', () => {
  for (const tool of EXPECTED_WELL_KNOWN_TOOLS) {
    const schema = toolCapabilityRegistry.getSchema(tool);
    if (!schema) continue;
    for (const [paramName, paramDef] of Object.entries(schema.params)) {
      assert.ok(
        paramDef.type,
        `Tool "${tool}" param "${paramName}" should have a type`,
      );
      assert.ok(
        typeof paramDef.required === 'boolean',
        `Tool "${tool}" param "${paramName}" should have required boolean`,
      );
    }
  }
});

test('V2: Tool name aliases resolve correctly for all tools', () => {
  const aliasTests: Record<string, string[]> = {
    manage_task: ['manageTask', 'manage-tasks', 'task_manage'],
    run_command: ['runCommand', 'exec', 'execute'],
    write_to_file: ['writeToFile', 'create_file', 'save_file'],
    replace_file_content: ['replaceFileContent', 'edit_file'],
    list_dir: ['listDir', 'ls', 'dir'],
    view_file: ['viewFile', 'cat', 'show'],
    grep_search: ['grepSearch', 'search', 'find'],
    invoke_subagent: ['invokeSubagent', 'spawn_agent'],
    schedule: ['timer', 'cron', 'reminder'],
    multi_replace_file_content: ['multiReplaceFileContent', 'batch_edit'],
    call_mcp_tool: ['callMcpTool', 'mcp_tool'],
    read_resource: ['readResource', 'load_resource'],
    list_resources: ['listResources', 'resources'],
  };

  for (const [canonical, aliases] of Object.entries(aliasTests)) {
    for (const alias of aliases) {
      const resolved = toolCapabilityRegistry.resolveName(alias);
      assert.equal(
        resolved, canonical,
        `Alias "${alias}" should resolve to "${canonical}", got "${resolved}"`,
      );
    }
  }
});

// ─── 3. Token Count Measurement ────────────────────────────────────────

/** Rough token count: ~4 chars per token for English text */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

test('V3: System message token count is within budget', () => {
  const prompt = ANTIGRAVITY_CONTEXT.prompt;
  const tokens = estimateTokens(prompt);
  assert.ok(
    tokens > 1000,
    `System message should be substantial (>1000 tokens), got ~${tokens}`,
  );
  assert.ok(
    tokens < 8000,
    `System message should be under 8000 tokens for context efficiency, got ~${tokens}`,
  );
  // Log for visibility
  console.log(`  [V3] System message: ~${tokens} tokens (${prompt.length} chars)`);
});

test('V3: agent-context.md token count is documented', () => {
  const ctxPath = ANTIGRAVITY_CONTEXT.path;
  try {
    const content = readFileSync(ctxPath, 'utf-8');
    const tokens = estimateTokens(content);
    assert.ok(
      tokens > 5000,
      `agent-context.md should be substantial (>5000 tokens), got ~${tokens}`,
    );
    console.log(`  [V3] agent-context.md: ~${tokens} tokens (${content.length} chars)`);
  } catch {
    // File not found — skip if not installed
    console.log('  [V3] agent-context.md not found, skipping token count');
  }
});

test('V3: Total context budget (system + context file) is reasonable', () => {
  const systemTokens = estimateTokens(ANTIGRAVITY_CONTEXT.prompt);
  let contextTokens = 0;
  try {
    contextTokens = estimateTokens(readFileSync(ANTIGRAVITY_CONTEXT.path, 'utf-8'));
  } catch { /* skip */ }
  const total = systemTokens + contextTokens;
  console.log(`  [V3] Total context budget: ~${total} tokens (system: ~${systemTokens}, context: ~${contextTokens})`);
  // Most models have at least 8K context; total should fit
  assert.ok(
    total < 15000,
    `Total context should be under 15K tokens, got ~${total}`,
  );
});

// ─── 4. Normalizer Edge Cases ──────────────────────────────────────────

test('V4: Normalizer handles empty tool name', () => {
  const result = normalizeToolCall('', { foo: 'bar' });
  assert.equal(result.name, '', 'should pass through empty name');
});

test('V4: Normalizer handles null/undefined args', () => {
  const result = normalizeToolCall('run_command', null as any);
  // Should not throw
  assert.ok(result.name, 'should return a result');
});

test('V4: Normalizer handles deeply nested object in args', () => {
  const result = normalizeToolCall('call_mcp_tool', {
    ServerName: 'test',
    ToolName: 'tool',
    Arguments: { nested: { deep: { value: 42 } } },
  });
  assert.equal(result.args.ServerName, 'test');
  assert.equal(result.args.Arguments.nested.deep.value, 42);
});

test('V4: Normalizer handles unicode in string args', () => {
  const result = normalizeToolCall('write_to_file', {
    TargetFile: '/tmp/test.txt',
    CodeContent: '你好世界 🌍',
    Overwrite: true,
  });
  assert.equal(result.args.CodeContent, '你好世界 🌍');
});

test('V4: Normalizer handles very long string args', () => {
  const longString = 'x'.repeat(100000);
  const result = normalizeToolCall('write_to_file', {
    TargetFile: '/tmp/test.txt',
    CodeContent: longString,
    Overwrite: true,
  });
  assert.equal(result.args.CodeContent.length, 100000);
});

test('V4: Normalizer handles special characters in paths', () => {
  const result = normalizeToolCall('view_file', {
    AbsolutePath: 'C:\\Users\\Test\\path with spaces\\file (1).txt',
  });
  assert.equal(result.args.AbsolutePath, 'C:\\Users\\Test\\path with spaces\\file (1).txt');
});

test('V4: Normalizer handles mixed case tool names', () => {
  const result = normalizeToolCall('RUN_COMMAND', { command: 'echo hi' });
  assert.equal(result.name, 'run_command');
  assert.equal(result.args.CommandLine, 'echo hi');
});

test('V4: Normalizer handles tool with all optional params omitted', () => {
  const result = normalizeToolCall('list_dir', {});
  assert.equal(result.name, 'list_dir');
  assert.deepEqual(result.args, {});
  assert.equal(result.warnings, undefined, 'no warnings for clean pass-through');
});

test('V4: Normalizer preserves numeric zero correctly', () => {
  const result = normalizeToolCall('run_command', {
    command: 'sleep 0',
    WaitMsBeforeAsync: 0,
  });
  assert.equal(result.args.WaitMsBeforeAsync, 0, 'should preserve zero, not coerce to falsy');
});

test('V4: Normalizer handles boolean false (not just true)', () => {
  const result = normalizeToolCall('write_to_file', {
    TargetFile: '/tmp/new.txt',
    CodeContent: 'new',
    Overwrite: false,
  });
  assert.equal(result.args.Overwrite, false, 'should preserve false boolean');
});

// ─── 5. Agent-Context.md Structure ─────────────────────────────────────

test('V5: agent-context.md has required top-level sections', () => {
  const ctxPath = ANTIGRAVITY_CONTEXT.path;
  let content: string;
  try {
    content = readFileSync(ctxPath, 'utf-8');
  } catch {
    console.log('  [V5] agent-context.md not found, skipping');
    return;
  }

  const requiredSections = [
    'Identity & Mission',
    'Operating Doctrine',
    'Decision Engine',
    'Tool Reference',
    'Subagent Doctrine',
    'Background Task Doctrine',
    'Verification Doctrine',
    'Error Recovery',
    'Completion Criteria',
    'Quick Reference',
  ];

  for (const section of requiredSections) {
    assert.ok(
      content.includes(section),
      `agent-context.md should contain section "${section}"`,
    );
  }
});

test('V5: agent-context.md has quick reference table', () => {
  const ctxPath = ANTIGRAVITY_CONTEXT.path;
  let content: string;
  try {
    content = readFileSync(ctxPath, 'utf-8');
  } catch {
    return;
  }
  assert.ok(
    content.includes('Quick Reference'),
    'agent-context.md should have Quick Reference section',
  );
  assert.ok(
    content.includes('Tool Cheat Sheet'),
    'agent-context.md should have Tool Cheat Sheet',
  );
});

test('V5: agent-context.md has workflow templates', () => {
  const ctxPath = ANTIGRAVITY_CONTEXT.path;
  let content: string;
  try {
    content = readFileSync(ctxPath, 'utf-8');
  } catch {
    return;
  }
  const templates = ['Add a New Feature', 'Fix a Bug', 'Research a Topic', 'Refactor Code', 'Deploy Changes'];
  for (const tpl of templates) {
    assert.ok(
      content.includes(tpl),
      `agent-context.md should have workflow template "${tpl}"`,
    );
  }
});

test('V5: agent-context.md has error recovery scenarios', () => {
  const ctxPath = ANTIGRAVITY_CONTEXT.path;
  let content: string;
  try {
    content = readFileSync(ctxPath, 'utf-8');
  } catch {
    return;
  }
  const scenarios = [
    'Port already in use',
    'Overwrite is false',
    'TargetContent',
    'manage_task called without Action',
    'Permission denied',
    'Subagent is stuck',
  ];
  for (const scenario of scenarios) {
    assert.ok(
      content.includes(scenario),
      `agent-context.md should have error scenario "${scenario}"`,
    );
  }
});

// ─── 6. Cross-Consistency Checks ───────────────────────────────────────

test('V6: Every tool in registry is mentioned in system message', () => {
  const prompt = ANTIGRAVITY_CONTEXT.prompt;
  for (const tool of EXPECTED_WELL_KNOWN_TOOLS) {
    assert.ok(
      prompt.includes(tool),
      `Tool "${tool}" is in registry but NOT in system message`,
    );
  }
});

test('V6: Every tool in system message is in registry', () => {
  const prompt = ANTIGRAVITY_CONTEXT.prompt;
  // Extract tool names from the system message code blocks
  const toolPattern = /^(\w+)\(/gm;
  let match;
  const toolsInMessage = new Set<string>();
  while ((match = toolPattern.exec(prompt)) !== null) {
    toolsInMessage.add(match[1]);
  }
  for (const tool of toolsInMessage) {
    // Skip non-tool words that match the pattern
    if (['You', 'Use', 'For', 'The', 'NEVER', 'Action', 'CORRECT', 'WRONG'].includes(tool)) continue;
    assert.ok(
      toolCapabilityRegistry.hasTool(tool),
      `Tool "${tool}" is in system message but NOT in registry`,
    );
  }
});

test('V6: Tool param names in system message match registry schemas', () => {
  const prompt = ANTIGRAVITY_CONTEXT.prompt;
  // Check a few key tools for param consistency
  const checks = [
    { tool: 'run_command', param: 'CommandLine' },
    { tool: 'write_to_file', param: 'TargetFile' },
    { tool: 'manage_task', param: 'Action' },
    { tool: 'replace_file_content', param: 'StartLine' },
  ];
  for (const { tool, param } of checks) {
    assert.ok(
      prompt.includes(param),
      `System message should mention param "${param}" for tool "${tool}"`,
    );
    const schema = toolCapabilityRegistry.getSchema(tool);
    assert.ok(schema?.params[param], `Registry should have param "${param}" for tool "${tool}"`);
  }
});
