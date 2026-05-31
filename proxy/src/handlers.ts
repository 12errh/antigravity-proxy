import http2 from 'http2';
import { logger } from './logger.js';
import { streamResponse, generateResponse } from './engine.js';
import { mapContentsToMessages, mapExternalMessagesToCore, mapTools, mapGenerationConfig, mapModelName, constructToolCallText } from './mapper.js';
import { captureCredentials } from './auth.js';
import type { Content, Tool, GenerationConfig } from './types.js';

function decodeGrpcBody(body: Buffer): Buffer {
  if (body.length < 5) return body;
  const len = body.readUInt32BE(1);
  if (body.length >= 5 + len) return body.subarray(5, 5 + len);
  return body.subarray(5);
}

function encodeGrpcFrame(data: Buffer): Buffer {
  const frame = Buffer.alloc(5 + data.length);
  frame[0] = 0;
  frame.writeUInt32BE(data.length, 1);
  data.copy(frame, 5);
  return frame;
}

function buildCandidate(text: string, role: string): any {
  return {
    content: { parts: text ? [{ text }] : [], role },
    finish_reason: 'FINISH_REASON_STOP',
    index: 0,
  };
}

export async function handleGrpcRequest(
  method: string,
  url: string,
  headers: http2.IncomingHttpHeaders,
  body: Buffer,
  res: http2.Http2ServerResponse,
): Promise<void> {
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.startsWith('grpc-') || k.startsWith('x-') || k === 'authorization') {
      metadata[k] = String(v);
    }
  }
  captureCredentials(metadata);

  if (url.includes('GetChatMessage')) {
    await handleChat(body, res);
  } else if (url.includes('GetStreamingExternalChatCompletions')) {
    await handleExternal(body, res);
  } else {
    logger.warn('Unknown chat method', { url });
    res.writeHead(501);
    res.end();
  }
}

async function handleChat(body: Buffer, res: http2.Http2ServerResponse): Promise<void> {
  let request: any;
  try {
    const payload = decodeGrpcBody(body);
    request = JSON.parse(payload.toString('utf-8'));
  } catch {
    request = { model: 'default', contents: [] };
  }

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

  res.writeHead(200, {
    'content-type': 'application/grpc',
    'grpc-accept-encoding': 'identity',
  });

  try {
    let fullText = '';
    for await (const chunk of streamResponse(mapped, nvidiaModel)) {
      if (chunk.type === 'text') {
        fullText += chunk.content;
        const resp = Buffer.from(JSON.stringify({ candidates: [buildCandidate(chunk.content, 'model')] }), 'utf-8');
        res.write(encodeGrpcFrame(resp), 'binary');
      } else if (chunk.type === 'tool-call') {
        const text = constructToolCallText(chunk.name, chunk.args);
        fullText += text;
        const resp = Buffer.from(JSON.stringify({ candidates: [buildCandidate(text, 'model')] }), 'utf-8');
        res.write(encodeGrpcFrame(resp), 'binary');
      }
    }
    const final = Buffer.from(JSON.stringify({ candidates: [buildCandidate('', 'model')] }), 'utf-8');
    res.write(encodeGrpcFrame(final), 'binary');
    res.addTrailers({ 'grpc-status': '0' });
    res.end();
    logger.info('Chat completed', { textLength: fullText.length });
  } catch (err: any) {
    logger.error('Chat failed', { error: err.message });
    res.addTrailers({ 'grpc-status': '2', 'grpc-message': err.message });
    res.end();
  }
}

async function handleExternal(body: Buffer, res: http2.Http2ServerResponse): Promise<void> {
  let request: any;
  try {
    const payload = decodeGrpcBody(body);
    request = JSON.parse(payload.toString('utf-8'));
  } catch {
    request = { model: 'default', messages: [] };
  }

  const model = request.model || 'default';
  const systemPrompt = request.system_prompt || '';

  logger.info('ExternalChat', { model, provider: request.provider_name });

  const mapped = mapExternalMessagesToCore(request.messages || []);
  if (systemPrompt && !mapped.system) mapped.system = systemPrompt;

  const nvidiaModel = mapModelName(model);

  res.writeHead(200, { 'content-type': 'application/grpc' });

  try {
    const result = await generateResponse(mapped, nvidiaModel);
    const grpcResp = {
      delta_content: result.text,
      index: 0,
      finish_reason: result.finishReason || 'stop',
      full_content: result.text,
      model: nvidiaModel,
    };
    res.write(encodeGrpcFrame(Buffer.from(JSON.stringify(grpcResp), 'utf-8')), 'binary');
    res.addTrailers({ 'grpc-status': '0' });
    res.end();
  } catch (err: any) {
    logger.error('ExternalChat failed', { error: err.message });
    res.addTrailers({ 'grpc-status': '2', 'grpc-message': err.message });
    res.end();
  }
}
