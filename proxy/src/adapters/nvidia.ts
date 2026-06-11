/**
 * NVIDIA NIM adapter
 *
 * Optimizations for NVIDIA's NIM inference API:
 * - Proper model naming for NVIDIA's catalog
 * - Rate limit handling for NVIDIA's API tiers
 * - NVIDIA-specific parameters (reasoning on supported models)
 */

import { OpenAICompatAdapter } from './openai.js';
import { getEffortForModel } from '../reasoning-effort.js';
import type { OpenAIMessage } from '../mapper.js';

export class NvidiaAdapter extends OpenAICompatAdapter {
  constructor(provider: string, baseUrl: string, apiKey: string) {
    super(provider, baseUrl, apiKey);
  }

  /**
   * Override buildRequest to:
   * 1. Add NVIDIA-specific parameters
   * 2. Handle reasoning effort for supported models
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
      // NVIDIA NIM expects tool calls in the standard OpenAI format
      body.tools = Object.entries(tools).map(([name, tool]: [string, any]) => ({
        type: 'function',
        function: { name, description: tool.description || '', parameters: tool.parameters || {} },
      }));
    }
    if (config?.maxTokens) body.max_tokens = config.maxTokens;
    if (config?.temperature != null) body.temperature = config.temperature;
    if (config?.topP != null) body.top_p = config.topP;
    if ((config as any)?.stopSequences?.length) body.stop = (config as any).stopSequences;

    // NVIDIA supports reasoning_effort on stepfun and other reasoning models
    const explicitEffort = (config as any)?.providerOptions?.openai?.reasoningEffort;
    const perModelEffort = getEffortForModel(model);
    const effort = explicitEffort || (perModelEffort && perModelEffort !== 'default' ? perModelEffort : null);
    if (effort) body.reasoning_effort = effort;

    return body;
  }
}
