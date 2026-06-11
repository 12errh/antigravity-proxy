/**
 * Unit tests for Phase 2 — Universal Tool Translation.
 *
 * Tests ToolCapabilityRegistry (schema management, alias resolution) and
 * ToolNormalizer (name normalization, param alias resolution, type coercion,
 * default filling, unknown param stripping).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolCapabilityRegistry, toolCapabilityRegistry } from '../src/tool-capabilities.js';
import { normalizeToolCall, normalizeToolCalls } from '../src/tool-normalizer.js';

// ─── ToolCapabilityRegistry tests ─────────────────────────────────────────

test('T1: ToolCapabilityRegistry has well-known tools at construction', () => {
  const registry = new ToolCapabilityRegistry();
  assert.ok(registry.hasTool('manage_task'), 'should have manage_task');
  assert.ok(registry.hasTool('run_command'), 'should have run_command');
  assert.ok(registry.hasTool('write_to_file'), 'should have write_to_file');
  assert.ok(registry.hasTool('replace_file_content'), 'should have replace_file_content');
  assert.ok(registry.hasTool('list_dir'), 'should have list_dir');
  assert.ok(registry.hasTool('view_file'), 'should have view_file');
  assert.ok(registry.hasTool('grep_search'), 'should have grep_search');
});

test('T1: ToolCapabilityRegistry resolves aliases to canonical names', () => {
  const registry = new ToolCapabilityRegistry();
  assert.equal(registry.resolveName('manage_task'), 'manage_task');
  assert.equal(registry.resolveName('manageTask'), 'manage_task');
  assert.equal(registry.resolveName('manage-tasks'), 'manage_task');
  assert.equal(registry.resolveName('task_manage'), 'manage_task');
  assert.equal(registry.resolveName('runCommand'), 'run_command');
  assert.equal(registry.resolveName('exec'), 'run_command');
  assert.equal(registry.resolveName('writeToFile'), 'write_to_file');
  assert.equal(registry.resolveName('create_file'), 'write_to_file');
  assert.equal(registry.resolveName('listDir'), 'list_dir');
  assert.equal(registry.resolveName('ls'), 'list_dir');
  assert.equal(registry.resolveName('viewFile'), 'view_file');
  assert.equal(registry.resolveName('cat'), 'view_file');
  assert.equal(registry.resolveName('grepSearch'), 'grep_search');
  assert.equal(registry.resolveName('find'), 'grep_search');
});

test('T1: ToolCapabilityRegistry passes through unknown names', () => {
  const registry = new ToolCapabilityRegistry();
  assert.equal(registry.resolveName('completely_unknown_tool'), 'completely_unknown_tool');
});

test('T1: ToolCapabilityRegistry fuzzy matches aliases', () => {
  const registry = new ToolCapabilityRegistry();
  // "manage" is contained in "manage_task" alias "manageTask" → should resolve
  const resolved = registry.resolveName('manage');
  assert.equal(resolved, 'manage_task', 'fuzzy match should resolve "manage" to manage_task');
});

test('T1: ToolCapabilityRegistry getSchema returns tool schema', () => {
  const registry = new ToolCapabilityRegistry();
  const schema = registry.getSchema('manage_task');
  assert.ok(schema, 'should get schema for manage_task');
  assert.equal(schema!.name, 'manage_task');
  assert.ok(schema!.params.Action, 'should have Action param');
  assert.ok(schema!.params.TaskId, 'should have TaskId param');
  assert.ok(schema!.params.Input, 'should have Input param');
});

test('T1: ToolCapabilityRegistry getSchema returns undefined for unknown', () => {
  const registry = new ToolCapabilityRegistry();
  assert.equal(registry.getSchema('nope'), undefined);
});

test('T1: ToolCapabilityRegistry setDynamicTools adds per-request tools', () => {
  const registry = new ToolCapabilityRegistry();
  registry.setDynamicTools({
    my_custom_tool: {
      description: 'A custom tool',
      parameters: {
        type: 'object',
        properties: {
          foo: { type: 'string', description: 'Foo value' },
          bar: { type: 'number', description: 'Bar value' },
        },
        required: ['foo'],
      },
    },
  });
  assert.ok(registry.hasTool('my_custom_tool'), 'should have dynamic tool');
  const schema = registry.getSchema('my_custom_tool');
  assert.ok(schema, 'should get schema for dynamic tool');
  assert.equal(schema!.params.foo.type, 'string');
  assert.equal(schema!.params.foo.required, true);
  assert.equal(schema!.params.bar.type, 'number');
  assert.equal(schema!.params.bar.required, false);
});

test('T1: ToolCapabilityRegistry setDynamicTools clears previous dynamic tools', () => {
  const registry = new ToolCapabilityRegistry();
  registry.setDynamicTools({ tool_a: { description: 'A', parameters: { type: 'object', properties: {} } } });
  assert.ok(registry.hasTool('tool_a'), 'should have tool_a');
  registry.setDynamicTools({ tool_b: { description: 'B', parameters: { type: 'object', properties: {} } } });
  assert.ok(!registry.hasTool('tool_a'), 'tool_a should be cleared');
  assert.ok(registry.hasTool('tool_b'), 'should have tool_b');
});

test('T1: ToolCapabilityRegistry setDynamicTools handles null/undefined', () => {
  const registry = new ToolCapabilityRegistry();
  registry.setDynamicTools(null);
  // Should not throw — well-known tools remain
  assert.ok(registry.hasTool('manage_task'), 'well-known tools should remain');
});

test('T1: ToolCapabilityRegistry well-known tools have correct schemas', () => {
  const registry = new ToolCapabilityRegistry();

  const runCmd = registry.getSchema('run_command')!;
  assert.equal(runCmd.params.CommandLine.required, true);
  assert.equal(runCmd.params.CommandLine.type, 'string');
  assert.ok(runCmd.params.CommandLine.aliases!.includes('command'));
  assert.equal(runCmd.params.Cwd.required, false);
  assert.equal(runCmd.params.WaitMsBeforeAsync.default, 0);

  const writeFile = registry.getSchema('write_to_file')!;
  assert.equal(writeFile.params.TargetFile.required, true);
  assert.equal(writeFile.params.CodeContent.required, true);
  assert.equal(writeFile.params.Overwrite.required, true);
  assert.ok(writeFile.params.TargetFile.aliases!.includes('file_path'));
});

// ─── Tool Normalizer tests ────────────────────────────────────────────────

test('T2: normalizeToolCall resolves tool name aliases', () => {
  const result = normalizeToolCall('manageTask', {});
  assert.equal(result.name, 'manage_task', 'should normalize manageTask → manage_task');
  assert.ok(result.fixed, 'should mark as fixed');
});

test('T2: normalizeToolCall passes through unknown tools', () => {
  const result = normalizeToolCall('unknown_tool', { foo: 'bar' });
  assert.equal(result.name, 'unknown_tool', 'should pass through unknown name');
  assert.deepEqual(result.args, { foo: 'bar' }, 'should pass through args unchanged');
  assert.equal(result.warnings, undefined, 'no warnings for unknown tool');
});

test('T2: normalizeToolCall resolves param aliases', () => {
  const result = normalizeToolCall('run_command', { command: 'echo hello' });
  assert.ok(result.args.CommandLine, 'should resolve command → CommandLine');
  assert.equal(result.args.CommandLine, 'echo hello');
});

test('T2: normalizeToolCall coerces string boolean to boolean', () => {
  const result = normalizeToolCall('write_to_file', {
    file_path: '/tmp/test.txt',
    content: 'hello',
    overwrite: 'true',
  });
  assert.equal(result.args.Overwrite, true, 'should coerce "true" to true');
  assert.ok(result.fixed, 'should mark as fixed');
});

test('T2: normalizeToolCall coerces string number to number', () => {
  const result = normalizeToolCall('run_command', {
    command: 'sleep 1',
    wait_ms: '5000',
  });
  assert.equal(result.args.WaitMsBeforeAsync, 5000, 'should coerce "5000" to 5000');
});

test('T2: normalizeToolCall fills missing required params with defaults', () => {
  const result = normalizeToolCall('manage_task', { task_id: '123' });
  // Action should default to "list"
  assert.equal(result.args.Action, 'list', 'should fill missing Action with default "list"');
  assert.ok(result.fixed, 'should mark as fixed');
  assert.ok(result.warnings!.some(w => w.includes('Action')), 'should warn about missing Action');
});

test('T2: normalizeToolCall strips unknown params', () => {
  const result = normalizeToolCall('run_command', {
    command: 'echo hi',
    nonexistent_param: 'should be stripped',
  });
  assert.equal(result.args.nonexistent_param, undefined, 'should strip unknown param');
  assert.ok(result.fixed, 'should mark as fixed');
  assert.ok(result.warnings!.some(w => w.includes('nonexistent_param')), 'should warn about stripped param');
});

test('T2: normalizeToolCall handles manage_task with various alias combos', () => {
  // manage_task with aliases for both name and params
  const result = normalizeToolCall('manageTask', {
    action: 'kill',
    task: 'abc-123',
  });
  assert.equal(result.name, 'manage_task');
  assert.equal(result.args.Action, 'kill');
  assert.equal(result.args.TaskId, 'abc-123');
});

test('T2: normalizeToolCall preserves known params with correct types', () => {
  const result = normalizeToolCall('write_to_file', {
    file_path: '/tmp/test.txt',
    content: 'file content',
    overwrite: true,
    desc: 'A test file',
  });
  assert.equal(result.args.TargetFile, '/tmp/test.txt');
  assert.equal(result.args.CodeContent, 'file content');
  assert.equal(result.args.Overwrite, true);
  assert.equal(result.args.Description, 'A test file');
});

test('T2: normalizeToolCall handles empty args', () => {
  const result = normalizeToolCall('list_dir', {});
  assert.equal(result.name, 'list_dir');
  // list_dir has no required params, so should pass through cleanly
  assert.deepEqual(result.args, {});
});

test('T2: normalizeToolCall handles boolean false correctly', () => {
  const result = normalizeToolCall('write_to_file', {
    file_path: '/tmp/new.txt',
    content: 'new',
    overwrite: false,
  });
  assert.equal(result.args.Overwrite, false, 'should keep false as false, not coerce to true');
});

test('T2: normalizeToolCall handles integer coercion', () => {
  const result = normalizeToolCall('replace_file_content', {
    file_path: '/tmp/test.txt',
    start: '5',
    end: '10',
    content: 'replacement',
    old_content: 'existing',
    instruction: 'edit',
  });
  assert.equal(typeof result.args.StartLine, 'number', 'StartLine should be number');
  assert.equal(typeof result.args.EndLine, 'number', 'EndLine should be number');
  assert.equal(result.args.StartLine, 5);
  assert.equal(result.args.EndLine, 10);
});

// ─── normalizeToolCalls tests ─────────────────────────────────────────────

test('T2: normalizeToolCalls handles array of tool calls', () => {
  const calls = [
    { name: 'manageTask', args: { action: 'list' } },
    { name: 'runCommand', args: { command: 'echo hi' } },
    { name: 'unknown_tool', args: { foo: 'bar' } },
  ];
  const results = normalizeToolCalls(calls);
  assert.equal(results.length, 3, 'should process all calls');
  assert.equal(results[0].name, 'manage_task', 'first should be normalized');
  assert.equal(results[1].name, 'run_command', 'second should be normalized');
  assert.equal(results[2].name, 'unknown_tool', 'third should pass through');
});

test('T2: normalizeToolCalls handles empty array', () => {
  const results = normalizeToolCalls([]);
  assert.deepEqual(results, [], 'should return empty array');
});
