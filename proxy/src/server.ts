import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';
import { streamResponse, generateResponse } from './engine.js';
import { mapContentsToMessages, mapExternalMessagesToCore, mapTools, mapGenerationConfig, mapModelName, constructToolCallText } from './mapper.js';
import { captureCredentials } from './auth.js';
import type { Content, Tool, GenerationConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__dirname, '..', 'proto', 'api_server.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [path.resolve(__dirname, '..', 'proto')],
});

const proto = grpc.loadPackageDefinition(packageDefinition) as any;

// Loaded message types for manual protobuf encode/decode
export const RequestTypes = proto.api_server_go_proto;
export const ResponseTypes = proto.api_server_go_proto;

// Decode a protobuf-encoded gRPC request body for GetChatMessage
export function decodeChatRequest(buffer: Buffer): any {
  try {
    if (RequestTypes.GenerateContentRequest && typeof RequestTypes.GenerateContentRequest.decode === 'function') {
      return RequestTypes.GenerateContentRequest.decode(buffer);
    }
  } catch {}
  // Fallback: try JSON
  try {
    return JSON.parse(buffer.toString('utf-8'));
  } catch {
    return { model: 'default', contents: [] };
  }
}

// Decode external chat request
export function decodeExternalRequest(buffer: Buffer): any {
  try {
    return JSON.parse(buffer.toString('utf-8'));
  } catch {
    return { model: 'default', messages: [] };
  }
}

// Encode a GenerateContentResponse to protobuf bytes
export function encodeChatResponse(data: any): Buffer {
  try {
    if (ResponseTypes.GenerateContentResponse && typeof ResponseTypes.GenerateContentResponse.encode === 'function') {
      return Buffer.from(ResponseTypes.GenerateContentResponse.encode(data).finish());
    }
  } catch {}
  return Buffer.from(JSON.stringify(data), 'utf-8');
}

// Handle GetChatMessage (unary request, streaming response)
export async function handleChatMessageRaw(
  body: Buffer,
  metadata: Record<string, string>,
  write: (chunk: Buffer) => void,
  end: () => void,
  error: (msg: string) => void,
): Promise<void> {
  captureCredentials(metadata);

  const request = decodeChatRequest(body);
  const contents: Content[] = request.contents || [];
  const tools: Tool[] = request.tools || [];
  const genConfig: GenerationConfig = request.generationConfig;
  const systemInstruction = request.system_instruction?.parts?.[0]?.text || '';
  const model = request.model || 'default';

  logger.info('GetChatMessage', { model, contentCount: contents.length });

  const mapped = mapContentsToMessages(contents, systemInstruction);
  const mappedTools = mapTools(tools);
  const cfg = mapGenerationConfig(genConfig);
  if (mappedTools) mapped.tools = mappedTools;
  Object.assign(mapped, cfg);

  const nvidiaModel = mapModelName(model);

  try {
    let fullText = '';
    for await (const chunk of streamResponse(mapped, nvidiaModel)) {
      if (chunk.type === 'text') {
        fullText += chunk.content;
        const resp = encodeChatResponse({
          candidates: [{ content: { parts: [{ text: chunk.content }], role: 'model' }, finish_reason: 'FINISH_REASON_STOP', index: 0 }],
        });
        write(resp);
      } else if (chunk.type === 'tool-call') {
        const text = constructToolCallText(chunk.name, chunk.args);
        const resp = encodeChatResponse({
          candidates: [{ content: { parts: [{ text }], role: 'model' }, finish_reason: 'FINISH_REASON_STOP', index: 0 }],
        });
        write(resp);
      }
    }
    const final = encodeChatResponse({
      candidates: [{ content: { parts: [], role: 'model' }, finish_reason: 'FINISH_REASON_STOP', index: 0 }],
    });
    write(final);
    end();
    logger.info('Chat completed', { textLength: fullText.length });
  } catch (err: any) {
    logger.error('Chat failed', { error: err.message });
    error(err.message);
  }
}

// Handle GetStreamingExternalChatCompletions
export async function handleExternalChatRaw(
  body: Buffer,
  metadata: Record<string, string>,
  write: (chunk: Buffer) => void,
  end: () => void,
  error: (msg: string) => void,
): Promise<void> {
  captureCredentials(metadata);

  const request = decodeExternalRequest(body);
  const model = request.model || 'default';
  const systemPrompt = request.system_prompt || '';

  logger.info('ExternalChat', { model, provider: request.provider_name });

  const mapped = mapExternalMessagesToCore(request.messages || []);
  if (systemPrompt && !mapped.system) mapped.system = systemPrompt;

  const nvidiaModel = mapModelName(model);

  try {
    const result = await generateResponse(mapped, nvidiaModel);
    write(Buffer.from(JSON.stringify({
      delta_content: result.text, index: 0, finish_reason: result.finishReason || 'stop',
      full_content: result.text, model: nvidiaModel,
    }), 'utf-8'));
    end();
  } catch (err: any) {
    logger.error('ExternalChat failed', { error: err.message });
    error(err.message);
  }
}
