import { ANTIGRAVITY_CONTEXT } from './antigravity-context.js';
import type { MappedRequest } from './mapper.js';

export function injectContext(mapped: MappedRequest, contextStripMode: string): void {
  // Skip in passthrough mode: the original Antigravity context already
  // contains everything, and injecting on top causes duplication.
  if (ANTIGRAVITY_CONTEXT.enabled && contextStripMode !== 'passthrough') {
    const ctx = ANTIGRAVITY_CONTEXT.prompt;
    const existing = mapped.system;
    mapped.system = existing ? `${ctx}\n\n${existing}` : ctx;
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

  // Inject a prompt telling the model to read agent-context.md
  // SKIP in passthrough mode: the model already has the identity inline.
  if (contextStripMode !== 'passthrough' &&
    !mapped.messages.some(msg => msg.role === 'user' && typeof msg.content === 'string' &&
      msg.content.includes('Read the agent-context.md file using the view_file tool')
    )) {
    const contextPath = process.env.AGENT_CONTEXT_PATH || 'agent-context.md';
    mapped.messages.unshift({
      role: 'user' as const,
      content: `Read the agent-context.md file using the view_file tool to adopt the runtime identity. Use this tool to access the complete operating manual for external agents before proceeding with your task. The file is located at: ${contextPath}. This includes the critical tool selection rules, subagent doctrine, verification requirements, and confidence framework needed to use Antigravity correctly. You must read this file to understand when and how to use all available tools, including manage_task for background process management and when to spawn agents for parallel execution.`
    });
  }
}
