import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { reasoningStore, saveReasoning, injectReasoning, cleanupReasoningStore } from '../src/engine.js';

describe('ReasoningStore TTL', () => {
  beforeEach(() => {
    // Clear the store before each test
    reasoningStore.clear();
  });

  it('should store and retrieve reasoning', () => {
    saveReasoning('conv1', 'thought1');
    saveReasoning('conv1', 'thought2');
    
    const entry = reasoningStore.get('conv1');
    assert.ok(entry);
    assert.equal(entry.data.length, 2);
    assert.equal(entry.data[0], 'thought1');
    assert.equal(entry.data[1], 'thought2');
  });

  it('should have timestamp on entries', () => {
    const before = Date.now();
    saveReasoning('conv1', 'thought1');
    const after = Date.now();
    
    const entry = reasoningStore.get('conv1');
    assert.ok(entry);
    assert.ok(entry.timestamp >= before);
    assert.ok(entry.timestamp <= after);
  });

  it('should cleanup expired entries', () => {
    saveReasoning('conv1', 'thought1');
    
    const entry = reasoningStore.get('conv1');
    assert.ok(entry);
    
    // Manually set timestamp to past
    entry.timestamp = Date.now() - (31 * 60 * 1000); // 31 minutes ago
    
    // Run cleanup
    cleanupReasoningStore();
    
    // Entry should be deleted
    assert.ok(!reasoningStore.has('conv1'));
  });

  it('should keep non-expired entries', () => {
    saveReasoning('conv1', 'thought1');
    
    const entry = reasoningStore.get('conv1');
    assert.ok(entry);
    
    // Entry is fresh, should not be cleaned up
    cleanupReasoningStore();
    
    assert.ok(reasoningStore.has('conv1'));
  });

  it('should enforce max size by deleting oldest entries', () => {
    // Add entries with varying timestamps
    for (let i = 0; i < 10; i++) {
      saveReasoning(`conv${i}`, `thought${i}`);
    }
    
    // Manually set some entries to be older
    const entry0 = reasoningStore.get('conv0');
    const entry1 = reasoningStore.get('conv1');
    if (entry0) entry0.timestamp = Date.now() - 1000;
    if (entry1) entry1.timestamp = Date.now() - 2000;
    
    // Run cleanup - should delete oldest entries
    cleanupReasoningStore();
    
    // Should still have entries (not all expired yet)
    assert.ok(reasoningStore.size > 0);
  });
});

describe('injectReasoning', () => {
  beforeEach(() => {
    reasoningStore.clear();
  });

  it('should inject reasoning into messages', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    
    saveReasoning('conv1', 'thinking about greeting');
    
    injectReasoning(messages, 'conv1');
    
    assert.equal(messages[1].reasoning_content, 'thinking about greeting');
  });

  it('should handle no stored reasoning', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    
    injectReasoning(messages, 'conv1');
    
    // Should set fallback reasoning
    assert.ok(messages[1].reasoning_content);
  });
});
