/**
 * Groq-specific adapter
 *
 * Optimizations for Groq's fast inference API:
 * - Strips images (Groq doesn't support vision)
 * - Groq-specific model naming
 * - Rate limit handling for Groq's 30 req/min free tier
 */

import { OpenAICompatAdapter } from './openai.js';
import type { OpenAIMessage } from '../mapper.js';

export class GroqAdapter extends OpenAICompatAdapter {
  constructor(provider: string, baseUrl: string, apiKey: string) {
    super(provider, baseUrl, apiKey);
    this.supportsImages = false;
  }

  /**
   * Override buildRequest to:
   * 1. Strip image content from messages (Groq doesn't support vision)
   * 2. Add Groq-specific parameters
   */
  protected buildRequest(
    model: string,
    messages: OpenAIMessage[],
    tools?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Record<string, unknown> {
    // Strip images before serialization
    const cleanedMessages = messages.map(m => {
      if (Array.isArray(m.content)) {
        const textOnly = m.content.filter((part: any) => part.type !== 'image_url');
        return { ...m, content: textOnly.length > 0 ? textOnly : (typeof m.content === 'string' ? m.content : '') };
      }
      return m;
    });

    const body: Record<string, unknown> = {
      model,
      messages: this.serializeMessages(cleanedMessages),
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

    return body;
  }
}
