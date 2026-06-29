import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapContentsToMessages, mapTools, mapGenerationConfig } from '../src/mapper.js';

describe('mapContentsToMessages', () => {
  it('should convert Gemini user message to OpenAI format', () => {
    const contents = [
      { role: 'user', parts: [{ text: 'Hello' }] }
    ];

    const result = mapContentsToMessages(contents);

    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].role, 'user');
    assert.equal(result.messages[0].content, 'Hello');
  });

  it('should convert model role to assistant', () => {
    const contents = [
      { role: 'model', parts: [{ text: 'Hi there' }] }
    ];

    const result = mapContentsToMessages(contents);

    assert.equal(result.messages[0].role, 'assistant');
  });

  it('should convert functionCall to tool_calls', () => {
    const contents = [
      {
        role: 'model',
        parts: [{
          functionCall: { name: 'view_file', args: '{"path": "test.txt"}' }
        }]
      }
    ];

    const result = mapContentsToMessages(contents);

    assert.equal(result.messages[0].role, 'assistant');
    assert.ok(result.messages[0].tool_calls);
    assert.equal(result.messages[0].tool_calls![0].function.name, 'view_file');
  });

  it('should convert functionResponse to tool message', () => {
    const contents = [
      {
        role: 'user',
        parts: [{
          functionResponse: { name: 'view_file', response: { content: 'file content' } }
        }]
      }
    ];

    const result = mapContentsToMessages(contents);

    assert.equal(result.messages[0].role, 'tool');
    assert.equal(result.messages[0].content, '{"content":"file content"}');
  });

  it('should handle thought parts', () => {
    const contents = [
      {
        role: 'model',
        parts: [
          { thought: true, text: 'thinking...' },
          { text: 'response' }
        ]
      }
    ];

    const result = mapContentsToMessages(contents);

    assert.equal(result.messages[0].reasoning_content, 'thinking...');
    assert.equal(result.messages[0].content, 'response');
  });

  it('should set system instruction', () => {
    const contents = [
      { role: 'user', parts: [{ text: 'Hello' }] }
    ];

    const result = mapContentsToMessages(contents, 'You are a helpful assistant');

    assert.equal(result.system, 'You are a helpful assistant');
  });

  it('should handle empty parts with string content', () => {
    const contents = [
      { role: 'user', content: 'Hello' }
    ];

    const result = mapContentsToMessages(contents);

    assert.equal(result.messages[0].content, 'Hello');
  });
});

describe('mapTools', () => {
  it('should convert Gemini tools to OpenAI format', () => {
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'view_file',
            description: 'View file contents',
            parameters: {
              type: 'object',
              properties: {
                AbsolutePath: { type: 'string' }
              },
              required: ['AbsolutePath']
            }
          }
        ]
      }
    ];

    const result = mapTools(tools);

    assert.ok(result);
    assert.ok(result!['view_file']);
    assert.equal(result!['view_file'].description, 'View file contents');
  });

  it('should return undefined for empty tools', () => {
    const result = mapTools([]);
    assert.equal(result, undefined);
  });

  it('should return undefined for undefined tools', () => {
    const result = mapTools(undefined);
    assert.equal(result, undefined);
  });
});

describe('mapGenerationConfig', () => {
  it('should map maxOutputTokens to maxTokens', () => {
    const config = { maxOutputTokens: 1000 };

    const result = mapGenerationConfig(config);

    assert.equal(result.maxTokens, 1000);
  });

  it('should map temperature', () => {
    const config = { temperature: 0.7 };

    const result = mapGenerationConfig(config);

    assert.equal(result.temperature, 0.7);
  });

  it('should map topP', () => {
    const config = { topP: 0.9 };

    const result = mapGenerationConfig(config);

    assert.equal(result.topP, 0.9);
  });

  it('should map stopSequences', () => {
    const config = { stopSequences: ['END', 'STOP'] };

    const result = mapGenerationConfig(config);

    assert.deepEqual(result.stopSequences, ['END', 'STOP']);
  });

  it('should handle empty config', () => {
    const result = mapGenerationConfig({});

    assert.equal(result.maxTokens, undefined);
    assert.equal(result.temperature, undefined);
  });
});
