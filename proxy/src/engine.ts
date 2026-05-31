import { config } from './config.js';
import { logger } from './logger.js';
import { ANTIGRAVITY_CONTEXT } from './antigravity-context.js';
import type { MappedRequest } from './mapper.js';

function buildTools(mapped: MappedRequest): any[] | undefined {
  if (!mapped.tools || Object.keys(mapped.tools).length === 0) return undefined;
  return Object.entries(mapped.tools).map(([name, tool]) => ({
    type: 'function',
    function: { name, description: tool.description || '', parameters: tool.parameters || {} },
  }));
}

function buildOpenAIRequest(mapped: MappedRequest, model: string, stream: boolean): Record<string, unknown> {
  const messages: any[] = [];
  if (ANTIGRAVITY_CONTEXT.enabled) {
    messages.push({ role: 'system', content: ANTIGRAVITY_CONTEXT.prompt });
  }
  if (mapped.system) messages.push({ role: 'system', content: mapped.system });
  for (const m of mapped.messages) messages.push(m);

  const body: Record<string, unknown> = { model, messages, stream };
  const tools = buildTools(mapped);
  if (tools) body.tools = tools;
  if (mapped.maxTokens) body.max_tokens = mapped.maxTokens;
  if (mapped.temperature != null) body.temperature = mapped.temperature;
  if (mapped.topP != null) body.top_p = mapped.topP;
  if (mapped.stopSequences?.length) body.stop = mapped.stopSequences;
  if (mapped.providerOptions?.openai?.reasoningEffort) {
    body.reasoning_effort = mapped.providerOptions.openai.reasoningEffort;
  }
  return body;
}

async function fetchWithRetry(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const maxRetries = 4;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (response.status === 429 && attempt < maxRetries) {
      const waitMs = Math.min(1000 * Math.pow(2, attempt), 16000);
      logger.warn(`Rate limited (429), retry ${attempt + 1}/${maxRetries} in ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    if (!response.ok) {
      const err = await response.text().catch(() => 'unknown');
      throw new Error(`API error ${response.status}: ${err}`);
    }
    return response;
  }
  throw new Error('Exceeded max retries for rate limited request');
}

async function doFetch(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  return fetchWithRetry(body, signal);
}

function isStreamingResponse(res: Response): boolean {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  return ct.includes('text/event-stream') || ct.includes('application/x-ndjson');
}

async function parseToolArgs(raw: string): Promise<Record<string, unknown>> {
  try { return JSON.parse(raw); } catch { return {}; }
}

function stripUnknownArgs(args: Record<string, unknown>, toolName: string, tools: Record<string, any> | undefined): Record<string, unknown> {
  if (!tools || !tools[toolName]?.parameters?.properties) return args;
  const validKeys = Object.keys(tools[toolName].parameters.properties);
  const filtered: Record<string, unknown> = {};
  for (const key of validKeys) {
    if (key in args) filtered[key] = args[key];
  }
  return Object.keys(filtered).length > 0 ? filtered : args;
}

export async function* streamResponse(
  mapped: MappedRequest,
  modelId?: string,
  abortSignal?: AbortSignal,
): AsyncGenerator<{ type: 'text'; content: string } | { type: 'tool-call'; name: string; args: Record<string, unknown> }> {
  const model = modelId || 'default';
  const body = buildOpenAIRequest(mapped, model, true);

  logger.info(`Calling ${config.provider.toUpperCase()}: ${model}`, {
    messageCount: mapped.messages.length,
    hasTools: !!mapped.tools && Object.keys(mapped.tools).length > 0,
    hasSystem: !!mapped.system,
  });

  const response = await doFetch(body, abortSignal);

  if (!isStreamingResponse(response)) {
    const data: any = await response.json();
    const choice = data.choices?.[0];
    if (choice?.message?.content) {
      yield { type: 'text', content: choice.message.content };
    }
    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        const args = stripUnknownArgs(await parseToolArgs(tc.function.arguments), tc.function.name, mapped.tools);
        yield { type: 'tool-call', name: tc.function.name, args };
      }
    }
    return;
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const toolCallBuffers: Map<number, { id?: string; name?: string; arguments: string }> = new Map();

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

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta || {};

        if (delta.content) {
          yield { type: 'text', content: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallBuffers.has(idx)) {
              toolCallBuffers.set(idx, { arguments: '' });
            }
            const buf = toolCallBuffers.get(idx)!;
            if (tc.id) buf.id = tc.id;
            if (tc.function?.name) buf.name = tc.function.name;
            if (tc.function?.arguments) buf.arguments += tc.function.arguments;
          }
        }

        if (choice.finish_reason === 'tool_calls') {
          for (const [, buf] of toolCallBuffers) {
            const args = stripUnknownArgs(await parseToolArgs(buf.arguments), buf.name || 'unknown', mapped.tools);
            yield { type: 'tool-call', name: buf.name || 'unknown', args };
          }
          toolCallBuffers.clear();
        }
      }
    }

    if (toolCallBuffers.size > 0) {
      for (const [, buf] of toolCallBuffers) {
        const args = stripUnknownArgs(await parseToolArgs(buf.arguments), buf.name || 'unknown', mapped.tools);
        yield { type: 'tool-call', name: buf.name || 'unknown', args };
      }
      toolCallBuffers.clear();
    }
  } finally {
    reader.releaseLock();
  }
}

export async function generateResponse(
  mapped: MappedRequest,
  modelId?: string,
): Promise<{ text: string; finishReason: string | null }> {
  const model = modelId || 'default';
  const body = buildOpenAIRequest(mapped, model, false);

  const response = await doFetch(body);
  const data: any = await response.json();
  const choice = data.choices?.[0];
  return {
    text: choice?.message?.content || '',
    finishReason: choice?.finish_reason || null,
  };
}
