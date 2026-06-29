import type { OpenAIMessage } from '../mapper.js';
import type { StreamChunk, ModelAdapter } from './types.js';
import { poolFetch } from '../http-pool.js';
import { getEffortForModel } from '../reasoning-effort.js';
import { parseToolArgs } from '../utils/parse-tool-args.js';

/**
 * Known field names that providers use to emit reasoning/thinking content.
 * Checked at both the choice-level and delta-level in streaming responses,
 * and at the message-level in non-streaming responses.
 */
const REASONING_FIELD_NAMES = new Set([
  'reasoning_content',
  'reasoning',
  'reasoning_text',
  'thinking',
  'thinking_content',
  'reasoning_content_blocks',
  'reasoning_details',
]);

/**
 * Extract reasoning content from an object by checking all known field names.
 * Returns the first non-empty string found, or null.
 */
function extractReasoning(obj: Record<string, unknown> | null | undefined): string | null {
  if (!obj) return null;
  for (const field of REASONING_FIELD_NAMES) {
    const val = obj[field];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return null;
}


export class OpenAICompatAdapter implements ModelAdapter {
  provider: string;
  protected baseUrl: string;
  protected apiKey: string;
  protected supportsImages: boolean;

  constructor(provider: string, baseUrl: string, apiKey: string) {
    this.provider = provider;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.supportsImages = true;
  }

  async *stream(
    model: string,
    messages: OpenAIMessage[],
    tools?: Record<string, unknown>,
    config?: Record<string, unknown>,
    signal?: AbortSignal,
    system?: string,
  ): AsyncGenerator<StreamChunk> {
    // If system instruction provided and no system message exists, prepend it
    const finalMessages = system && !messages.some(m => m.role === 'system')
      ? [{ role: 'system' as const, content: system }, ...messages]
      : messages;
    const body = this.buildRequest(model, finalMessages, tools, config);
    const response = await this.fetchWithRetry(body, signal);

    if (!this.isStreaming(response)) {
      const data = await response.json() as any;
      const choice = data.choices?.[0];
      // Universal reasoning extraction: check all known field names
      const reason = choice?.message ? extractReasoning(choice.message) : null;
      if (reason) {
        yield { type: 'thought', content: reason };
      }
      if (choice?.message?.content) {
        const text = choice.message.content;
        // Universal <think> tag parsing for any model
        const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>([\s\S]*)/);
        if (thinkMatch) {
          if (thinkMatch[1].trim()) yield { type: 'thought', content: thinkMatch[1] };
          if (thinkMatch[2].trim()) yield { type: 'text', content: thinkMatch[2] };
        } else {
          yield { type: 'text', content: text };
        }
      }
      if (choice?.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          const args = this.parseToolArgs(tc.function.arguments);
          yield { type: 'tool-call', name: tc.function.name, args };
        }
      }
      return;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCallBuffers = new Map<number, { id?: string; name?: string; arguments: string }>();
    let thinkBuffer = '';
    let inThinkTag = false;
    let capturedSessionId: string | undefined;

    function* processContent(text: string): Generator<StreamChunk> {
      // Universal <think> tag parsing for any model
      if (inThinkTag) {
        const endIdx = text.indexOf('</think>');
        if (endIdx >= 0) {
          thinkBuffer += text.slice(0, endIdx);
          yield { type: 'thought', content: thinkBuffer, sessionId: capturedSessionId };
          thinkBuffer = '';
          inThinkTag = false;
          const after = text.slice(endIdx + 8);
          if (after) yield* processContent(after);
        } else {
          thinkBuffer += text;
        }
        return;
      }
      const startIdx = text.indexOf('<think>');
      if (startIdx >= 0) {
        if (startIdx > 0) yield { type: 'text', content: text.slice(0, startIdx), sessionId: capturedSessionId };
        inThinkTag = true;
        const rest = text.slice(startIdx + 7);
        const endIdx = rest.indexOf('</think>');
        if (endIdx >= 0) {
          yield { type: 'thought', content: rest.slice(0, endIdx), sessionId: capturedSessionId };
          inThinkTag = false;
          const after = rest.slice(endIdx + 8);
          if (after) yield* processContent(after);
        } else {
          thinkBuffer = rest;
        }
        return;
      }
      yield { type: 'text', content: text };
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6).trim();
          if (data === '[DONE]') return;
          let chunk: any;
          try { chunk = JSON.parse(data); } catch { continue; }
          // Capture session_id from OpenCode Go response (may appear on any chunk)
          if (chunk.session_id && !capturedSessionId) {
            capturedSessionId = chunk.session_id;
          }
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta || {};
          // Universal reasoning extraction: check delta-level fields first
          const deltaReason = extractReasoning(delta);
          if (deltaReason) {
            yield { type: 'thought', content: deltaReason, sessionId: capturedSessionId };
          }
          // Some providers put reasoning at the choice level (not inside delta)
          if (!deltaReason) {
            const choiceReason = extractReasoning(choice);
            if (choiceReason) {
              yield { type: 'thought', content: choiceReason, sessionId: capturedSessionId };
            }
          }
          if (delta.content) {
            yield* processContent(delta.content);
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallBuffers.has(idx)) toolCallBuffers.set(idx, { arguments: '' });
              const buf = toolCallBuffers.get(idx)!;
              if (tc.id) buf.id = tc.id;
              if (tc.function?.name) buf.name = tc.function.name;
              if (tc.function?.arguments) buf.arguments += tc.function.arguments;
            }
          }
          if (choice.finish_reason === 'tool_calls') {
            for (const [, buf] of toolCallBuffers) {
              yield { type: 'tool-call', name: buf.name || 'unknown', args: this.parseToolArgs(buf.arguments) };
            }
            toolCallBuffers.clear();
          }
        }
      }
      // Flush any remaining think buffer on stream end
      if (thinkBuffer) {
        yield { type: 'thought', content: thinkBuffer, sessionId: capturedSessionId };
        thinkBuffer = '';
      }
      if (toolCallBuffers.size > 0) {
        for (const [, buf] of toolCallBuffers) {
          yield { type: 'tool-call', name: buf.name || 'unknown', args: this.parseToolArgs(buf.arguments) };
        }
        toolCallBuffers.clear();
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Providers that support OpenAI-specific params like reasoning_effort
  // (kept for potential future per-provider guards; effort is now driven by model config)
  private static REASONING_PROVIDERS = new Set(['openai', 'zen', 'opencode-go', 'nvidia', 'openrouter', 'groq']);

  protected buildRequest(
    model: string,
    messages: OpenAIMessage[],
    tools?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = { model, messages: this.serializeMessages(messages), stream: true };
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
    // Reasoning effort: check explicit providerOptions first, then per-model config
    const explicitEffort = (config as any)?.providerOptions?.openai?.reasoningEffort;
    const perModelEffort = getEffortForModel(model);
    const effort = explicitEffort || (perModelEffort && perModelEffort !== 'default' ? perModelEffort : null);
    if (effort) body.reasoning_effort = effort;
    return body;
  }

  protected serializeMessages(messages: OpenAIMessage[]): any[] {
    return messages.map(m => {
      const out: any = { role: m.role };
      if (Array.isArray(m.content)) {
        const cleaned = m.content.map((part: any) => {
          if (part && part.type === 'image_url' && part.image_url && part.image_url.url) {
            const u = part.image_url.url;
            if (!/^(https?:|data:|file:)/i.test(u)) return null;
          }
          return part;
        }).filter(Boolean);
        out.content = cleaned.length === 0 ? '' : cleaned;
      } else {
        out.content = m.content;
      }
      if (m.tool_calls) out.tool_calls = m.tool_calls;
      if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
      if (m.reasoning_content) out.reasoning_content = m.reasoning_content;
      return out;
    });
  }

  protected async fetchWithRetry(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const response = await poolFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const err = await response.text().catch(() => 'unknown');
      throw new Error(`[${this.provider}] API error ${response.status}: ${err}`);
    }
    return response;
  }

  protected isStreaming(res: Response): boolean {
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    return ct.includes('text/event-stream') || ct.includes('application/x-ndjson');
  }

  protected parseToolArgs(raw: string): Record<string, unknown> {
    return parseToolArgs(raw);
  }
}
