import { ANTIGRAVITY_CONTEXT } from './antigravity-context.js';
import type { MappedRequest } from './mapper.js';
import fs from 'fs';
import path from 'path';

// Cache for lite context content
let _liteContextContent: string | null = null;

function getLiteContextContent(): string | null {
  if (_liteContextContent !== null) return _liteContextContent;

  // Try to find agent-context-lite.md
  const litePath = process.env.AGENT_CONTEXT_LITE_PATH ||
    path.resolve(process.cwd(), 'agent-context-lite.md');

  if (fs.existsSync(litePath)) {
    _liteContextContent = fs.readFileSync(litePath, 'utf-8');
    return _liteContextContent;
  }

  return null;
}

export function injectContext(mapped: MappedRequest, contextStripMode: string): void {
  // Skip in passthrough mode: the original Antigravity context already
  // contains everything, and injecting on top causes duplication.
  if (ANTIGRAVITY_CONTEXT.enabled && contextStripMode !== 'passthrough') {
    // In lite mode, use the compressed context if available
    if (contextStripMode === 'lite') {
      const liteContent = getLiteContextContent();
      if (liteContent) {
        const existing = mapped.system;
        mapped.system = existing ? `${liteContent}\n\n${existing}` : liteContent;
      } else {
        // Fallback to full context if lite not available
        const ctx = ANTIGRAVITY_CONTEXT.prompt;
        const existing = mapped.system;
        mapped.system = existing ? `${ctx}\n\n${existing}` : ctx;
      }
    } else {
      // strip mode - use full context
      const ctx = ANTIGRAVITY_CONTEXT.prompt;
      const existing = mapped.system;
      mapped.system = existing ? `${ctx}\n\n${existing}` : ctx;
    }
  }

  // Inject mapped.system as a real system-role message so it
  // reaches the model.
  if (mapped.system) {
    if (!mapped.messages.some(msg => msg.role === 'system')) {
      mapped.messages.unshift({
        role: 'system' as const,
        content: mapped.system,
      });
    }
  }
  // NOTE: We do NOT inject a "Read the agent-context.md" user message.
  // The context is already injected as a system message above.
  // Telling the model to read the file would cause it to read it AGAIN,
  // doubling the token usage.
}
