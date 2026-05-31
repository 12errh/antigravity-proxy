import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { config } from './config.js';
import { logger } from './logger.js';
import type { MappedRequest } from './mapper.js';

function getClient() {
  return createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
}

export async function* streamResponse(
  mapped: MappedRequest,
  modelId?: string,
  abortSignal?: AbortSignal,
): AsyncGenerator<{ type: 'text'; content: string } | { type: 'tool-call'; name: string; args: Record<string, unknown> }> {
  const model = modelId || 'default';
  const provider = config.provider.toUpperCase();
  const client = getClient();

  logger.info(`Calling ${provider} via Vercel AI SDK`, {
    model,
    messageCount: mapped.messages.length,
    hasTools: !!mapped.tools && Object.keys(mapped.tools).length > 0,
    hasSystem: !!mapped.system,
  });

  const streamOptions: Record<string, unknown> = {
    model: client.chat(model),
    messages: mapped.messages,
    system: mapped.system,
    temperature: mapped.temperature,
    abortSignal,
    onError: (error: unknown) => {
      const msg = error instanceof Error ? error.message : JSON.stringify(error);
      logger.error(`${provider} AI SDK error`, { error: msg });
    },
  };
  if (mapped.maxTokens) streamOptions.maxTokens = mapped.maxTokens;
  if (mapped.stopSequences) streamOptions.stopSequences = mapped.stopSequences;
  if (mapped.providerOptions) streamOptions.providerOptions = mapped.providerOptions;
  if (mapped.tools && Object.keys(mapped.tools).length > 0) {
    streamOptions.tools = mapped.tools;
  }
  const result = streamText(streamOptions as any);

  try {
    for await (const chunk of result.fullStream) {
      switch (chunk.type) {
        case 'text-delta':
          if ((chunk as any).textDelta || (chunk as any).text) {
            yield { type: 'text', content: (chunk as any).textDelta || (chunk as any).text || '' };
          }
          break;
        case 'tool-call':
          {
            const tc = chunk as any;
            logger.debug('SDK tool-call', { toolName: tc.toolName, args: tc.args, input: tc.input });
            yield { type: 'tool-call', name: tc.toolName, args: tc.args || tc.input || {} };
          }
          break;
        case 'finish':
          logger.debug('Stream finished', { finishReason: chunk.finishReason });
          break;
        case 'error':
          throw chunk.error;
      }
    }
  } catch (error: any) {
    logger.error('Stream error', { error: error.message });
    throw error;
  }
}

export async function generateResponse(
  mapped: MappedRequest,
  modelId?: string,
): Promise<{ text: string; finishReason: string | null }> {
  const model = modelId || 'default';
  const client = getClient();

  const result = streamText({
    model: client.chat(model),
    messages: mapped.messages as any,
    system: mapped.system,
  });

  let fullText = '';
  for await (const chunk of result.textStream) {
    fullText += chunk;
  }

  const finishReason = await result.finishReason;
  return { text: fullText, finishReason };
}