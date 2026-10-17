/**
 * Media passthrough tests — Gemini audio/video inlineData and fileData must
 * translate to OpenAI-compatible content parts (input_audio / video_url)
 * instead of being mislabeled as image_url, and providers that cannot take
 * native media must strip those parts cleanly instead of emitting malformed
 * payloads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapContentsToMessages } from '../src/mapper.js';
import { OpenAICompatAdapter } from '../src/adapters/openai.js';
import { GroqAdapter } from '../src/adapters/groq.js';
import { GoogleAdapter } from '../src/adapters/google.js';
import { AnthropicAdapter } from '../src/adapters/anthropic.js';

const WAV_B64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const MP4_B64 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function mapOne(parts: any[]): any {
  const mapped = mapContentsToMessages([{ role: 'user', parts }] as any);
  return mapped.messages[0].content;
}

function partsOf(content: any): any[] {
  return Array.isArray(content) ? content : [];
}

function findPart(content: any, type: string): any | undefined {
  return partsOf(content).find((p) => p && p.type === type);
}

test('AV1: audio inlineData maps to input_audio with raw base64 and format token', () => {
  const content = mapOne([
    { text: 'what do you hear?' },
    { inlineData: { mimeType: 'audio/wav', data: WAV_B64 } },
  ]);
  const audio = findPart(content, 'input_audio');
  assert.ok(audio, 'input_audio part should exist');
  assert.deepEqual(audio.input_audio, { data: WAV_B64, format: 'wav' });
  assert.ok(findPart(content, 'text'));
  assert.equal(findPart(content, 'image_url'), undefined);
});

test('AV2: audio MIME variants map to the right format token', () => {
  const cases: Array<[string, string]> = [
    ['audio/wav', 'wav'],
    ['audio/x-wav', 'wav'],
    ['audio/mpeg', 'mp3'],
    ['audio/mp3', 'mp3'],
    ['audio/ogg', 'ogg'],
    ['audio/flac', 'flac'],
    ['audio/mp4', 'm4a'],
    ['audio/aiff', 'aiff'],
  ];
  for (const [mime, format] of cases) {
    const content = mapOne([{ inlineData: { mimeType: mime, data: WAV_B64 } }]);
    const audio = findPart(content, 'input_audio');
    assert.ok(audio, `input_audio part expected for ${mime}`);
    assert.equal(audio.input_audio.format, format, `format for ${mime}`);
    assert.equal(audio.input_audio.data, WAV_B64);
  }
});

test('AV3: video inlineData maps to video_url data URL', () => {
  const content = mapOne([
    { text: 'describe the clip' },
    { inlineData: { mimeType: 'video/mp4', data: MP4_B64 } },
  ]);
  const video = findPart(content, 'video_url');
  assert.ok(video, 'video_url part should exist');
  assert.equal(video.video_url.url, `data:video/mp4;base64,${MP4_B64}`);
  assert.equal(findPart(content, 'image_url'), undefined);
});

test('AV4: video fileData with https URL maps to video_url', () => {
  const content = mapOne([
    { fileData: { fileUri: 'https://example.com/clip.mp4', mimeType: 'video/mp4' } },
  ]);
  const video = findPart(content, 'video_url');
  assert.ok(video);
  assert.equal(video.video_url.url, 'https://example.com/clip.mp4');
});

test('AV5: audio fileData converts data URLs and drops non-base64 references', () => {
  const fromData = mapOne([
    { fileData: { fileUri: `data:audio/mpeg;base64,${WAV_B64}`, mimeType: 'audio/mpeg' } },
  ]);
  const audio = findPart(fromData, 'input_audio');
  assert.ok(audio);
  assert.equal(audio.input_audio.format, 'mp3');

  const fromUrl = mapOne([
    { text: 'listen' },
    { fileData: { fileUri: 'https://example.com/clip.wav', mimeType: 'audio/wav' } },
  ]);
  assert.equal(fromUrl, 'listen');
});

test('AV6: unsupported audio MIME is dropped without breaking the message', () => {
  const content = mapOne([
    { text: 'note' },
    { inlineData: { mimeType: 'audio/opus', data: WAV_B64 } },
  ]);
  assert.equal(content, 'note');
});

test('AV7: image handling is unchanged (regression guard)', () => {
  const inline = mapOne([{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }]);
  const image = findPart(inline, 'image_url');
  assert.ok(image);
  assert.equal(image.image_url.url, `data:image/png;base64,${PNG_B64}`);

  const remote = mapOne([{ fileData: { fileUri: 'https://example.com/pic.png', mimeType: 'image/png' } }]);
  assert.equal(findPart(remote, 'image_url')?.image_url.url, 'https://example.com/pic.png');

  const googleRef = mapOne([{ fileData: { fileUri: 'files/abc123', mimeType: 'image/png' } }]);
  assert.equal(findPart(googleRef, 'image_url'), undefined);
});
test('AV8: OpenRouter adapter forwards input_audio and video_url parts', () => {
  const mapped = mapContentsToMessages([
    {
      role: 'user',
      parts: [
        { text: 'media' },
        { inlineData: { mimeType: 'audio/wav', data: WAV_B64 } },
        { inlineData: { mimeType: 'video/mp4', data: MP4_B64 } },
      ],
    },
  ] as any);
  const adapter = new OpenAICompatAdapter('openrouter', 'https://openrouter.ai/api/v1', 'test-key');
  const body = (adapter as any).buildRequest('google/gemini-2.5-flash', mapped.messages);
  const content = body.messages[0].content;
  assert.ok(findPart(content, 'input_audio'));
  assert.ok(findPart(content, 'video_url'));
  assert.ok(findPart(content, 'text'));
});

test('AV9: OpenAI-compat adapters strip audio/video but keep images', () => {
  const mapped = mapContentsToMessages([
    {
      role: 'user',
      parts: [
        { text: 'media' },
        { inlineData: { mimeType: 'image/png', data: PNG_B64 } },
        { inlineData: { mimeType: 'audio/wav', data: WAV_B64 } },
        { inlineData: { mimeType: 'video/mp4', data: MP4_B64 } },
      ],
    },
  ] as any);
  for (const provider of ['nvidia', 'zen', 'opencode-go', 'openai', 'ollama']) {
    const adapter = new OpenAICompatAdapter(provider, 'https://example.com/v1', 'test-key');
    const body = (adapter as any).buildRequest('some-model', mapped.messages);
    const content = body.messages[0].content;
    assert.equal(findPart(content, 'input_audio'), undefined, `${provider} should strip audio`);
    assert.equal(findPart(content, 'video_url'), undefined, `${provider} should strip video`);
    assert.ok(findPart(content, 'image_url'), `${provider} should keep images`);
  }
});

test('AV10: Groq adapter strips image, audio and video parts, keeping text', () => {
  const mapped = mapContentsToMessages([
    {
      role: 'user',
      parts: [
        { text: 'media' },
        { inlineData: { mimeType: 'image/png', data: PNG_B64 } },
        { inlineData: { mimeType: 'audio/wav', data: WAV_B64 } },
        { inlineData: { mimeType: 'video/mp4', data: MP4_B64 } },
      ],
    },
  ] as any);
  const adapter = new GroqAdapter('groq', 'https://api.groq.com/openai/v1', 'test-key');
  const body = (adapter as any).buildRequest('llama-3.3-70b', mapped.messages);
  const content = body.messages[0].content;
  assert.equal(findPart(content, 'image_url'), undefined);
  assert.equal(findPart(content, 'input_audio'), undefined);
  assert.equal(findPart(content, 'video_url'), undefined);
  assert.ok(findPart(content, 'text'));
});

test('AV11: Google adapter maps audio/video parts back to Gemini inlineData', () => {
  const mapped = mapContentsToMessages([
    {
      role: 'user',
      parts: [
        { text: 'media' },
        { inlineData: { mimeType: 'audio/wav', data: WAV_B64 } },
        { inlineData: { mimeType: 'video/mp4', data: MP4_B64 } },
      ],
    },
  ] as any);
  const adapter = new GoogleAdapter('https://generativelanguage.googleapis.com', 'test-key');
  const contents = (adapter as any).convertMessages(mapped.messages);
  const parts = contents[0].parts;
  const audio = parts.find((p: any) => p.inlineData?.mimeType === 'audio/wav');
  assert.ok(audio, 'audio inlineData should be restored');
  assert.equal(audio.inlineData.data, WAV_B64);
  const video = parts.find((p: any) => p.inlineData?.mimeType === 'video/mp4');
  assert.ok(video, 'video inlineData should be restored');
  assert.equal(video.inlineData.data, MP4_B64);
});

test('AV12: Google adapter maps remote video_url to fileData', () => {
  const mapped = mapContentsToMessages([
    {
      role: 'user',
      parts: [{ fileData: { fileUri: 'https://example.com/clip.mp4', mimeType: 'video/mp4' } }],
    },
  ] as any);
  const adapter = new GoogleAdapter('https://generativelanguage.googleapis.com', 'test-key');
  const contents = (adapter as any).convertMessages(mapped.messages);
  const file = contents[0].parts.find((p: any) => p.fileData);
  assert.ok(file);
  assert.equal(file.fileData.fileUri, 'https://example.com/clip.mp4');
  assert.equal(file.fileData.mimeType, 'video/mp4');
});

test('AV13: Anthropic adapter drops audio/video without throwing', () => {
  const mapped = mapContentsToMessages([
    {
      role: 'user',
      parts: [
        { text: 'media' },
        { inlineData: { mimeType: 'audio/wav', data: WAV_B64 } },
        { inlineData: { mimeType: 'video/mp4', data: MP4_B64 } },
      ],
    },
  ] as any);
  const adapter = new AnthropicAdapter('https://api.anthropic.com/v1', 'test-key');
  const messages = (adapter as any).convertMessages(mapped.messages);
  const blocks = messages[0].content;
  assert.ok(Array.isArray(blocks));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'text');
  assert.equal(blocks[0].text, 'media');
});
