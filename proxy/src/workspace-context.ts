import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

/**
 * Workspace Context Envelope
 *
 * Solves the "agent thinks file content is its working directory" problem.
 *
 * agent-context.md is a *documentation artifact* describing Antigravity's design.
 * It contains illustrative paths (e.g. `<user_home>\.gemini\antigravity\brain\…`),
 * sample directory listings, and "current state" prose. Naively telling the LLM
 * "read this file to adopt the runtime identity" causes it to pattern-match those
 * path strings and prose as authoritative runtime state — leading to confused
 * behavior like claiming it "is in" a directory or that certain files exist.
 *
 * The fix has three layers:
 *   1. ENVELOPE: a hardened preamble in the system instruction that frames the
 *      file as documentation, not state, with explicit EXTRACT/IGNORE rules.
 *   2. ANONYMIZATION: replace the real file:// path in the system instruction
 *      with a stable non-path reference (hash + short token) so the LLM cannot
 *      pattern-match the absolute path as a CWD hint.
 *   3. TOOL-RESULT WRAP: when the agent actually calls view_file on the context
 *      file, the proxy re-frames the result with the same envelope, so the LLM
 *      sees the file content surrounded by "this is documentation, not state"
 *      markers — preventing extraction of paths/prose as authoritative.
 */

export type EnvelopeMode = 'off' | 'loose' | 'strict';

function getMode(): EnvelopeMode {
  const m = (process.env.WORKSPACE_CONTEXT_ENVELOPE || 'strict').toLowerCase();
  if (m === 'off' || m === 'loose' || m === 'strict') return m;
  return 'strict';
}

function anonymizePath(absPath: string): { token: string; hash: string; display: string } {
  // Stable non-reversible token — same path → same token on every restart
  const hash = crypto.createHash('sha256').update(absPath).digest('hex').slice(0, 8);
  const basename = path.basename(absPath);
  const display = `<WORKSPACE_CONTEXT_FILE#${hash}>`; // looks like a tag, not a path
  return { token: `workspace-context://ref/${hash}`, hash, display: `${display} (${basename})` };
}

const STRICT_BODY = `<workspace_context_envelope type="documentation" scope="behavioral-rules-only" mode="strict">
The reference below is a DOCUMENTATION ARTIFACT — NOT a description of your current runtime state.
It describes Antigravity's general design. It is not authoritative for:
  - your working directory
  - which files exist on disk
  - your available tools (rely on your tool schemas for that)
  - your OS, user, environment, or any other runtime observation

Your ACTUAL runtime state is determined ONLY by:
  (a) your available tools and their declared schemas,
  (b) results returned from tool calls you make,
  (c) the current conversation.

When (and ONLY if) you choose to read the documentation file:
  \u2713 EXTRACT: tool names, tool-discipline rules, execution style, formatting conventions,
            response schemas, allowed tool argument shapes.
  \u2717 IGNORE: file paths, directory references, "current state" prose, sample listings,
            any "you are in directory X" / "the user has file Y" statements,
            placeholder tokens that look like OS paths or home directories.
            These are illustrative. They do not describe where you are.

CONFLICT RESOLUTION: if the documentation's content disagrees with what you OBSERVE
in tool results, the tool results are authoritative. The documentation is descriptive,
not prescriptive for this session.

If you do not need a specific rule, you do not need to read the file. Most behavior is
already covered by the conversation and the tool definitions.
</workspace_context_envelope>`;

const LOOSE_BODY = `<workspace_context_envelope type="documentation" mode="loose">
The reference below is a documentation file. Treat its content as illustrative guidance,
not as authoritative runtime state. Your actual working directory, environment, and
available files come from tool results, not from the file's prose or example paths.
</workspace_context_envelope>`;

function getBody(mode: EnvelopeMode): string {
  if (mode === 'off') return '';
  if (mode === 'loose') return LOOSE_BODY;
  return STRICT_BODY;
}

/**
 * Returns the hardened reference to inject into the system instruction.
 * Replaces the file:// path with a non-path reference so the LLM does not
 * pattern-match an absolute path as a CWD hint.
 */
export function getWorkspaceContextEnvelope(absPath: string): string {
  const mode = getMode();
  if (mode === 'off') {
    const ref = 'file:///' + absPath.replace(/\\/g, '/');
    return `<workspace_context_envelope mode="off">Read ${ref} via view_file to adopt the runtime identity.</workspace_context_envelope>`;
  }

  const body = getBody(mode);
  const { display, token } = anonymizePath(absPath);
  const exists = fs.existsSync(absPath);

  const refLine = exists
    ? `Reference: ${display}\n  (non-path identifier: ${token})\n  Read it with view_file IF you need to look up specific behavior rules.`
    : `Reference: ${display} (file not found at expected location — proceed without reading).`;

  return `${body}\n${refLine}`;
}

/**
 * Wraps a tool-call result (e.g. view_file on the context file) with the
 * envelope so the LLM does not extract path/prose as authoritative state.
 */
export function wrapToolResultForContextFile(absPath: string, originalText: string): string {
  const mode = getMode();
  if (mode === 'off') return originalText;
  if (mode === 'loose') {
    return `<documentation_tool_result note="Treat content as illustrative; runtime state comes from tool outputs, not from this file's prose.">\n${originalText}\n</documentation_tool_result>`;
  }
  const { display, hash } = anonymizePath(absPath);
  return `<documentation_tool_result source="${display}" ref="#${hash}" type="behavioral-rules-only">
CONTEXT REMINDER (auto-injected by proxy):
- This file is a DOCUMENTATION ARTIFACT. Its prose and example paths are NOT your runtime state.
- \u2713 Use it for: tool discipline, execution style, response formatting, schema conventions.
- \u2717 Do NOT extract: working directory, file existence claims, environment descriptions, paths.
- If anything in the content below disagrees with what your other tools reported, the OTHER tools are authoritative.

----- BEGIN DOCUMENTATION FILE CONTENT -----
${originalText}
----- END DOCUMENTATION FILE CONTENT -----

Reminder: paths and "current state" prose in the content above are illustrative. They are not
descriptions of where you are or what files exist. Use your own tools to verify any state.
</documentation_tool_result>`;
}

/**
 * Returns true if the given file path (as requested by the agent) matches
 * the configured agent-context.md path. Used to decide whether to wrap
 * a tool result.
 */
export function isWorkspaceContextFile(requestedPath: string, contextPath: string): boolean {
  if (!requestedPath) return false;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  try {
    return norm(path.resolve(requestedPath)) === norm(path.resolve(contextPath));
  } catch {
    return false;
  }
}

export function getEnvelopeMode(): EnvelopeMode { return getMode(); }
