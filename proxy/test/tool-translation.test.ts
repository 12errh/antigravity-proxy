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

test('T1: ToolCapabilityRegistry does not over-match short substrings', () => {
  const registry = new ToolCapabilityRegistry();
  // "manage" is only 6 chars and is a substring of "manage_subagents" too,
  // so the strict fuzzy matcher should NOT resolve it to avoid ambiguity
  const resolved = registry.resolveName('manage');
  assert.equal(resolved, 'manage', 'short substring "manage" should NOT fuzzy match to avoid over-matching');

  // But full alias names still resolve correctly
  assert.equal(registry.resolveName('manageTask'), 'manage_task', 'camelCase alias should resolve');
  assert.equal(registry.resolveName('manage-tasks'), 'manage_task', 'kebab alias should resolve');
  assert.equal(registry.resolveName('manage_subagents'), 'manage_subagents', 'distinct tool name should not be confused');
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

// ─── Schedule tool tests ────────────────────────────────────────────────

test('T2: schedule accepts DurationSeconds as string (Go backend expects string)', () => {
  const result = normalizeToolCall('schedule', {
    prompt: 'Run this later',
    DurationSeconds: '60',
  });
  assert.equal(result.name, 'schedule');
  assert.equal(result.args.Prompt, 'Run this later');
  assert.equal(result.args.DurationSeconds, '60', 'should keep string as string');
});

test('T2: schedule coerces DurationSeconds number to string', () => {
  const result = normalizeToolCall('schedule', {
    prompt: 'Run this later',
    DurationSeconds: 60,
  });
  assert.equal(result.name, 'schedule');
  assert.equal(result.args.DurationSeconds, '60', 'should coerce number 60 to string "60"');
});

test('T2: schedule accepts CronExpression', () => {
  const result = normalizeToolCall('schedule', {
    Prompt: 'Daily check',
    CronExpression: '0 9 * * *',
  });
  assert.equal(result.args.Prompt, 'Daily check');
  assert.equal(result.args.CronExpression, '0 9 * * *');
});

test('T2: schedule resolves alias duration_seconds', () => {
  const result = normalizeToolCall('schedule', {
    Prompt: 'Remind me',
    duration_seconds: '120',
  });
  assert.equal(result.args.DurationSeconds, '120', 'should resolve duration_seconds → DurationSeconds');
});

// ─── ask_question tool tests ────────────────────────────────────────────

test('T2: ask_question passes questions array (Go backend expects array)', () => {
  const result = normalizeToolCall('ask_question', {
    questions: [{ text: 'Which port?', options: [3000, 4000, 8080] }],
  });
  assert.equal(result.name, 'ask_question');
  assert.ok(Array.isArray(result.args.questions), 'questions should be an array');
  assert.equal(result.args.questions[0].text, 'Which port?');
});

test('T2: ask_question resolves alias question (singular) to questions', () => {
  const result = normalizeToolCall('ask_question', {
    question: 'Continue?',
    options: ['yes', 'no'],
  });
  assert.equal(result.name, 'ask_question');
  // question alias maps to questions, but the value is a string not an array
  // so it gets wrapped in an array by coercion
  assert.ok(result.args.questions, 'should resolve question → questions');
});

test('T2: ask_question resolves aliases', () => {
  const result = normalizeToolCall('askQuestion', {
    q: 'Pick one',
    items: [{ text: 'A' }, { text: 'B' }],
  });
  assert.equal(result.name, 'ask_question');
  assert.ok(Array.isArray(result.args.questions), 'q alias should resolve to questions');
});

// ─── manage_subagents tool tests ────────────────────────────────────────

test('T2: manage_subagents kill with ConversationIds array', () => {
  const result = normalizeToolCall('manage_subagents', {
    action: 'kill',
    ConversationIds: ['conv-1', 'conv-2'],
  });
  assert.equal(result.name, 'manage_subagents');
  assert.equal(result.args.Action, 'kill');
  assert.ok(Array.isArray(result.args.ConversationIds), 'ConversationIds should be an array');
  assert.deepEqual(result.args.ConversationIds, ['conv-1', 'conv-2']);
});

test('T2: manage_subagents resolves alias conversation_ids', () => {
  const result = normalizeToolCall('manage_subagents', {
    Action: 'kill',
    conversation_ids: ['conv-1'],
  });
  assert.equal(result.args.ConversationIds[0], 'conv-1', 'should resolve conversation_ids → ConversationIds');
});

test('T2: manage_subagents list works without ConversationIds', () => {
  const result = normalizeToolCall('manage_subagents', { action: 'list' });
  assert.equal(result.args.Action, 'list');
  assert.equal(result.args.ConversationIds, undefined, 'no ConversationIds for list action');
});

// ─── ask_permission tool tests ──────────────────────────────────────────

test('T2: ask_permission accepts Action and Target (Go backend expects these)', () => {
  const result = normalizeToolCall('ask_permission', {
    Action: 'file_write',
    Target: '/tmp/test.txt',
  });
  assert.equal(result.name, 'ask_permission');
  assert.equal(result.args.Action, 'file_write');
  assert.equal(result.args.Target, '/tmp/test.txt');
});

test('T2: ask_permission resolves aliases permission/reason → Action/Reason', () => {
  const result = normalizeToolCall('askPermission', {
    permission: 'network',
    reason: 'Need to fetch data',
  });
  assert.equal(result.name, 'ask_permission');
  assert.equal(result.args.Action, 'network', 'permission alias should resolve to Action');
  assert.equal(result.args.Reason, 'Need to fetch data', 'reason alias should resolve to Reason');
});

// ─── New tool registration tests ───────────────────────────────────────

test('T1: ToolCapabilityRegistry has new tools at construction', () => {
  const registry = new ToolCapabilityRegistry();
  assert.ok(registry.hasTool('multi_replace_file_content'), 'should have multi_replace_file_content');
  assert.ok(registry.hasTool('read_resource'), 'should have read_resource');
  assert.ok(registry.hasTool('list_resources'), 'should have list_resources');
  assert.ok(registry.hasTool('call_mcp_tool'), 'should have call_mcp_tool');
});

test('T1: ToolCapabilityRegistry resolves new tool aliases', () => {
  const registry = new ToolCapabilityRegistry();
  assert.equal(registry.resolveName('multiReplaceFileContent'), 'multi_replace_file_content');
  assert.equal(registry.resolveName('batch_edit'), 'multi_replace_file_content');
  assert.equal(registry.resolveName('readResource'), 'read_resource');
  assert.equal(registry.resolveName('listResources'), 'list_resources');
  assert.equal(registry.resolveName('callMcpTool'), 'call_mcp_tool');
  assert.equal(registry.resolveName('mcp_tool'), 'call_mcp_tool');
});

test('T1: multi_replace_file_content schema has required params', () => {
  const registry = new ToolCapabilityRegistry();
  const schema = registry.getSchema('multi_replace_file_content')!;
  assert.ok(schema, 'should have schema');
  assert.equal(schema.params.TargetFile.required, true);
  assert.equal(schema.params.ReplacementChunks.required, true);
  assert.equal(schema.params.TargetFile.aliases!.includes('file_path'), true);
});

test('T1: call_mcp_tool schema has required params', () => {
  const registry = new ToolCapabilityRegistry();
  const schema = registry.getSchema('call_mcp_tool')!;
  assert.ok(schema, 'should have schema');
  assert.equal(schema.params.ServerName.required, true);
  assert.equal(schema.params.ToolName.required, true);
  assert.equal(schema.params.Arguments.required, false);
});

test('T1: read_resource schema has required params', () => {
  const registry = new ToolCapabilityRegistry();
  const schema = registry.getSchema('read_resource')!;
  assert.ok(schema, 'should have schema');
  assert.equal(schema.params.uri.required, true);
});

test('T1: list_resources has no required params', () => {
  const registry = new ToolCapabilityRegistry();
  const schema = registry.getSchema('list_resources')!;
  assert.ok(schema, 'should have schema');
  const required = Object.values(schema.params).filter(p => p.required);
  assert.equal(required.length, 0, 'should have no required params');
});

// ─── Updated tool schema tests ─────────────────────────────────────────

test('T1: ask_permission schema has Reason param', () => {
  const registry = new ToolCapabilityRegistry();
  const schema = registry.getSchema('ask_permission')!;
  assert.ok(schema.params.Reason, 'should have Reason param');
  assert.equal(schema.params.Reason.required, false);
  assert.ok(schema.params.Reason.aliases!.includes('reason'));
});

test('T1: define_subagent schema has enable_mcp_tools and enable_write_tools', () => {
  const registry = new ToolCapabilityRegistry();
  const schema = registry.getSchema('define_subagent')!;
  assert.ok(schema.params.enable_mcp_tools, 'should have enable_mcp_tools');
  assert.equal(schema.params.enable_mcp_tools.required, false);
  assert.ok(schema.params.enable_write_tools, 'should have enable_write_tools');
  assert.equal(schema.params.enable_write_tools.required, false);
});

test('T1: schedule schema has MaxIterations param', () => {
  const registry = new ToolCapabilityRegistry();
  const schema = registry.getSchema('schedule')!;
  assert.ok(schema.params.MaxIterations, 'should have MaxIterations param');
  assert.equal(schema.params.MaxIterations.required, false);
  assert.equal(schema.params.MaxIterations.type, 'number');
});

test('T2: multi_replace_file_content normalizes TargetFile alias', () => {
  const result = normalizeToolCall('multi_replace_file_content', {
    file_path: '/tmp/test.ts',
    chunks: [{ StartLine: 1, EndLine: 5, TargetContent: 'old', ReplacementContent: 'new', AllowMultiple: false }],
  });
  assert.equal(result.name, 'multi_replace_file_content');
  assert.equal(result.args.TargetFile, '/tmp/test.ts');
});

test('T2: call_mcp_tool normalizes aliases', () => {
  const result = normalizeToolCall('callMcpTool', {
    server: 'my-server',
    tool: 'do_thing',
    args: { key: 'value' },
  });
  assert.equal(result.name, 'call_mcp_tool');
  assert.equal(result.args.ServerName, 'my-server');
  assert.equal(result.args.ToolName, 'do_thing');
});

test('T2: read_resource normalizes uri alias', () => {
  const result = normalizeToolCall('readResource', {
    Uri: 'file:///tmp/data.json',
  });
  assert.equal(result.name, 'read_resource');
  assert.equal(result.args.uri, 'file:///tmp/data.json');
});

test('T2: define_subagent resolves enable_mcp_tools alias', () => {
  const result = normalizeToolCall('define_subagent', {
    name: 'my-agent',
    description: 'A custom agent',
    system_prompt: 'You are helpful',
    enableMcpTools: true,
    enable_write_tools: false,
  });
  assert.equal(result.name, 'define_subagent');
  assert.equal(result.args.enable_mcp_tools, true);
  assert.equal(result.args.enable_write_tools, false);
});

test('T2: schedule normalizes MaxIterations from alias', () => {
  const result = normalizeToolCall('schedule', {
    prompt: 'Check something',
    max_iterations: 5,
  });
  assert.equal(result.args.MaxIterations, 5);
});

test('T2: ask_permission passes Reason param', () => {
  const result = normalizeToolCall('ask_permission', {
    Action: 'file_write',
    Target: '/tmp/test.txt',
    Reason: 'Need to create a config file',
  });
  assert.equal(result.args.Action, 'file_write');
  assert.equal(result.args.Target, '/tmp/test.txt');
  assert.equal(result.args.Reason, 'Need to create a config file');
});

// ─── Phase 3: Enhanced coercion tests ─────────────────────────────────

test('T3: coerceValue wraps single object in array for array type', () => {
  const result = normalizeToolCall('invoke_subagent', {
    Subagents: { TypeName: 'research', Role: 'explore', Prompt: 'find X' },
  });
  assert.ok(Array.isArray(result.args.Subagents), 'should wrap single object in array');
  assert.equal(result.args.Subagents.length, 1);
  assert.equal(result.args.Subagents[0].TypeName, 'research');
  assert.ok(result.fixed, 'should mark as fixed');
});

test('T3: coerceValue parses comma-separated string into array', () => {
  const result = normalizeToolCall('grep_search', {
    SearchPath: 'src/',
    Query: 'test',
    Includes: '*.ts,*.js',
  });
  assert.ok(Array.isArray(result.args.Includes), 'should parse comma-separated string');
  assert.deepEqual(result.args.Includes, ['*.ts', '*.js']);
});

test('T3: coerceValue parses JSON array string', () => {
  const result = normalizeToolCall('grep_search', {
    SearchPath: 'src/',
    Query: 'test',
    Includes: '["*.ts","*.js"]',
  });
  assert.ok(Array.isArray(result.args.Includes), 'should parse JSON array string');
  assert.deepEqual(result.args.Includes, ['*.ts', '*.js']);
});

test('T3: coerceValue converts number to string for string type', () => {
  const result = normalizeToolCall('schedule', {
    Prompt: 'check',
    DurationSeconds: 60,
  });
  assert.equal(typeof result.args.DurationSeconds, 'string', 'should convert to string');
  assert.equal(result.args.DurationSeconds, '60');
});

test('T3: coerceValue converts number to string for string type (Description)', () => {
  const result = normalizeToolCall('write_to_file', {
    TargetFile: '/tmp/test.txt',
    CodeContent: 'hello',
    Overwrite: true,
    Description: 123,
  });
  assert.equal(typeof result.args.Description, 'string', 'should convert number to string');
  assert.equal(result.args.Description, '123');
});

test('T3: coerceValue parses JSON object string for object type', () => {
  const result = normalizeToolCall('call_mcp_tool', {
    ServerName: 'my-server',
    ToolName: 'do_thing',
    Arguments: '{"key":"value","num":42}',
  });
  assert.equal(typeof result.args.Arguments, 'object');
  assert.equal(result.args.Arguments.key, 'value');
  assert.equal(result.args.Arguments.num, 42);
});

test('T3: coerceValue handles array JSON parse failure gracefully', () => {
  const result = normalizeToolCall('grep_search', {
    SearchPath: 'src/',
    Query: 'test',
    Includes: 'not-json',
  });
  assert.ok(Array.isArray(result.args.Includes), 'should wrap non-JSON string in array');
  assert.deepEqual(result.args.Includes, ['not-json']);
});

// ─── Phase 3: Levenshtein fuzzy matching tests ────────────────────────

test('T3: resolveParamName handles Levenshtein fuzzy match for close misspelling', () => {
  // "TragetFile" is 1 edit away from "TargetFile"
  const result = normalizeToolCall('write_to_file', {
    TragetFile: '/tmp/test.txt',
    CodeContent: 'hello',
    Overwrite: true,
  });
  assert.equal(result.args.TargetFile, '/tmp/test.txt', 'should fuzzy match TragetFile -> TargetFile');
  assert.ok(result.fixed, 'should mark as fixed');
});

test('T3: resolveParamName does not match distant strings', () => {
  const result = normalizeToolCall('write_to_file', {
    xyzabc: '/tmp/test.txt',
    TargetFile: '/tmp/test.txt',
    CodeContent: 'hello',
    Overwrite: true,
  });
  assert.equal(result.args.xyzabc, undefined, 'should strip very distant misspelling');
});

// ─── Phase 3: Post-processing tests ──────────────────────────────────

test('T3: invoke_subagent wraps single SubagentConfig in array', () => {
  const r = normalizeToolCall('invoke_subagent', {
    Subagents: { TypeName: 'research', Role: 'explore', Prompt: 'find X' },
  });
  assert.ok(Array.isArray(r.args.Subagents), 'Subagents should be an array');
  assert.equal(r.args.Subagents.length, 1, 'should have one element');
  assert.equal(r.args.Subagents[0].TypeName, 'research');
  assert.ok(r.warnings!.some(w => w.includes('Wrapped')), 'should warn about wrapping');
});

test('T3: invoke_subagent keeps existing array intact', () => {
  const r = normalizeToolCall('invoke_subagent', {
    Subagents: [{ TypeName: 'a', Role: 'b', Prompt: 'c' }, { TypeName: 'd', Role: 'e', Prompt: 'f' }],
  });
  assert.ok(Array.isArray(r.args.Subagents));
  assert.equal(r.args.Subagents.length, 2, 'should keep both elements');
});

test('T3: ask_question wraps single question object in array', () => {
  const r = normalizeToolCall('ask_question', {
    questions: { question: 'Port?', options: ['3000', '8000'] },
  });
  assert.ok(Array.isArray(r.args.questions), 'questions should be an array');
  assert.equal(r.args.questions.length, 1);
  assert.equal(r.args.questions[0].question, 'Port?');
  assert.ok(r.warnings!.some(w => w.includes('Wrapped')), 'should warn about wrapping');
});

test('T3: replace_file_content fills AllowMultiple default', () => {
  const r = normalizeToolCall('replace_file_content', {
    TargetFile: '/tmp/test.txt',
    StartLine: 1,
    EndLine: 5,
    TargetContent: 'old',
    ReplacementContent: 'new',
    Instruction: 'edit',
  });
  assert.equal(r.args.AllowMultiple, false, 'should fill AllowMultiple with default false');
});
