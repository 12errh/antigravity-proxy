import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { injectContext } from '../src/context-injector.js';

describe('injectContext', () => {
  it('should skip injection in passthrough mode', () => {
    const mapped = {
      system: undefined,
      messages: [{ role: 'user', content: 'Hello' }],
    };
    
    injectContext(mapped, 'passthrough');
    
    assert.equal(mapped.system, undefined);
    assert.equal(mapped.messages.length, 1);
  });

  it('should inject ANTIGRAVITY_CONTEXT in strip mode', () => {
    const mapped = {
      system: undefined,
      messages: [{ role: 'user', content: 'Hello' }],
    };
    
    injectContext(mapped, 'strip');
    
    // System should be set (ANTIGRAVITY_CONTEXT.prompt)
    assert.ok(mapped.system);
    // User message should be added for agent-context.md
    assert.ok(mapped.messages.some(m => m.role === 'user'));
  });

  it('should not duplicate system message if already present', () => {
    const mapped = {
      system: 'existing system',
      messages: [
        { role: 'system', content: 'existing system' },
        { role: 'user', content: 'Hello' },
      ],
    };
    
    injectContext(mapped, 'strip');
    
    // Should not add another system message
    const systemMessages = mapped.messages.filter(m => m.role === 'system');
    assert.equal(systemMessages.length, 1);
  });

  it('should not add agent-context.md prompt if already present', () => {
    const mapped = {
      system: undefined,
      messages: [
        { role: 'user', content: 'Read the agent-context.md file using the view_file tool' },
        { role: 'assistant', content: 'I will read it' },
        { role: 'user', content: 'Hello' },
      ],
    };
    
    injectContext(mapped, 'strip');
    
    // Should not add another agent-context.md prompt
    const contextPrompts = mapped.messages.filter(m => 
      m.role === 'user' && typeof m.content === 'string' && 
      m.content.includes('Read the agent-context.md file using the view_file tool')
    );
    assert.equal(contextPrompts.length, 1);
  });
});
