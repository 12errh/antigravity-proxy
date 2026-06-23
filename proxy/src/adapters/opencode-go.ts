/**
 * OpenCode Go adapter
 *
 * Optimizations for the OpenCode Go API gateway:
 * - Handles OpenCode Go-specific model routing
 * - OpenCode Go-specific API headers and URL formatting
 * - Handles reasoning field extraction for routed models
 */

import { OpenAICompatAdapter } from './openai.js';
import { getEffortForModel } from '../reasoning-effort.js';
import type { OpenAIMessage } from '../mapper.js';

export class OpencodeGoAdapter extends OpenAICompatAdapter {
  constructor(provider: string, baseUrl: string, apiKey: string) {
    super(provider, baseUrl, apiKey);
  }

  /**
   * Override buildRequest to include OpenCode Go specific parameters:
   * - Reasoning effort via provider-specific parameter name
   * - Proper model name handling for the gateway
   */
  protected buildRequest(
    model: string,
    messages: OpenAIMessage[],
    tools?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: this.serializeMessages(messages),
      stream: true,
    };

    if (tools && Object.keys(tools).length > 0) {
      body.tools = Object.entries(tools).map(([name, tool]: [string, any]) => ({
        type: 'function',
        function: { name, description: tool.description || '', parameters: tool.parameters || {} },
      }));
    }
    if (config?.maxTokens) body.max_tokens = config.maxTokens;
    if (config?.temperature != null) body.temperature = config.temperature;
    if (config?.topP != null) body.top_p = config.topP;
    if ((config as any)?.stopSequences?.length) body.stop = (config as any).stopSequences;

    // Reasoning effort: check explicit providerOptions first, then per-model config.
    // OpenCode Go gateway forwards reasoning_effort to the underlying model.
    const explicitEffort = (config as any)?.providerOptions?.openai?.reasoningEffort;
    const perModelEffort = getEffortForModel(model);
    const effort = explicitEffort || (perModelEffort && perModelEffort !== 'default' ? perModelEffort : null);
    if (effort) body.reasoning_effort = effort;

    return body;
  }
}
