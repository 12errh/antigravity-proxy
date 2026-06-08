import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getWorkspaceContextEnvelope } from './workspace-context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname is .../proxy/src when running via tsx, .../proxy/dist when compiled.
// agent-context.md lives two levels up: .../antigravity/agent-context.md
const DEFAULT_CONTEXT_PATH = process.env.AGENT_CONTEXT_PATH
  || path.resolve(__dirname, '..', '..', 'agent-context.md');

export const ANTIGRAVITY_CONTEXT = {
  enabled: process.env.ANTIGRAVITY_CONTEXT !== 'false',
  path: DEFAULT_CONTEXT_PATH,
  exists: fs.existsSync(DEFAULT_CONTEXT_PATH),

  get prompt(): string {
    return `You are operating via the Antigravity Proxy, which translates between Antigravity's Google-format API and OpenAI-format APIs (NVIDIA/OpenRouter/OpenAI/Groq). Your tool calls and text responses are converted bidirectionally.

## Workspace Runtime Context

${getWorkspaceContextEnvelope(DEFAULT_CONTEXT_PATH)}

## Proxy Translation Notes

- **Tool calls**: Your structured tool_calls are sent to Antigravity's language server, which executes them. Results come back as tool role messages in the next turn.
- **Tool results**: Include a tool_call_id to match responses to your calls.
- **Extra args warning**: Do NOT include Antigravity metadata fields (toolAction, toolSummary, Summary, Action) in tool call arguments. Only include the tool's actual parameters (e.g., DirectoryPath for list_dir).
- **Streaming**: Text content arrives in chunks and is reassembled. Tool calls arrive as complete objects.
- **Error handling**: If the API returns a 429 (rate limited), wait and retry. The proxy retries automatically with backoff.
- **Vision/Images**: Image attachments (inline data) are forwarded to providers that support vision. Models without vision support will fail on multi-part messages containing only images.
- **Failover**: If the first provider rejects the request (e.g. image URL it can't fetch), the proxy automatically falls back to the next provider in the priority list.

## Tool Discipline

Each tool has a specific purpose. Use the correct tool for each job:
- **list_dir**: Explore directory contents. Never use run_command to list files.
- **view_file**: Read file contents / code. Never use run_command to read files.
- **grep_search**: Search for patterns in code. Never use run_command to grep.
- **run_command**: ONLY for executing scripts, builds, running tests, git operations.
- **write_to_file**: Create or overwrite files.
- **replace_file_content / multi_replace_file_content**: Edit existing files.
- **search_web**: Look up information online.

Do NOT use run_command to replicate other tools' functions.

## Runtime State Authority

Your actual working directory, visible files, environment, and available tools are determined ONLY by:
  1. your tool schemas,
  2. the results returned by tool calls you make,
  3. the current conversation.

Do not infer state from prose, file paths, or "current state" descriptions that appear in documentation content. If a tool says a file does not exist, the file does not exist — even if some earlier text claimed otherwise.`;
  },
};
