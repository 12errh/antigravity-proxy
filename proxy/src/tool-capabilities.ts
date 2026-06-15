/**
 * Tool Capability Registry
 *
 * Tracks tool schemas and provides validation/normalization for tool calls.
 * Supports both well-known Antigravity tools and dynamic per-request tools.
 *
 * Well-known tools (like `manage_task`, `run_command`, etc.) are registered
 * by default at module load time. Per-request tools (from mapped.tools) are
 * merged in at request time.
 */

import { logger } from './logger.js';
import type { CoreTool } from './mapper.js';

// ─── Types ─────────────────────────────────────────────────────────────

export interface ToolParamDef {
  type: 'string' | 'number' | 'boolean' | 'integer' | 'object' | 'array';
  required: boolean;
  description?: string;
  default?: unknown;
  /** Known aliases — alternative names the model might use */
  aliases?: string[];
}

export interface ToolSchema {
  description?: string;
  /** Canonical tool name */
  name: string;
  /** Known aliases the model might call this tool by */
  aliases?: string[];
  params: Record<string, ToolParamDef>;
}

/** Result of normalizing a tool call */
export interface NormalizedToolCall {
  name: string;
  args: Record<string, unknown>;
  /** Messages to include in the error/system feedback */
  warnings?: string[];
  fixed?: boolean;
}

// ─── Known tool definitions ────────────────────────────────────────────

/** Antigravity's well-known tools, registered at startup */
const WELL_KNOWN_TOOLS: ToolSchema[] = [
  {
    name: 'manage_task',
    aliases: ['manageTask', 'manage-tasks', 'task_manage'],
    description: 'Manage background processes (list/kill/status/send_input)',
    params: {
      Action: {
        type: 'string',
        required: true,
        description: 'Action to perform: list, kill, kill_all, status, send_input',
        default: 'list',
        aliases: ['action', 'cmd', 'command'],
      },
      TaskId: {
        type: 'string',
        required: false,
        description: 'Task ID (required for kill, status, send_input)',
        aliases: ['task_id', 'taskid', 'id', 'task'],
      },
      Input: {
        type: 'string',
        required: false,
        description: 'Stdin input for send_input action',
      },
    },
  },
  {
    name: 'run_command',
    aliases: ['runCommand', 'run-command', 'exec', 'execute'],
    description: 'Run a shell command (PowerShell on Windows)',
    params: {
      CommandLine: {
        type: 'string',
        required: true,
        description: 'Full command with proper quoting',
        aliases: ['command', 'cmd', 'command_line', 'commandline'],
      },
      Cwd: {
        type: 'string',
        required: false,
        description: 'Working directory (absolute path)',
        aliases: ['cwd', 'working_dir', 'directory', 'path'],
      },
      WaitMsBeforeAsync: {
        type: 'number',
        required: false,
        description: '0 = wait, small number = background task',
        default: 0,
        aliases: ['wait_ms', 'waitms', 'timeout', 'async_after'],
      },
    },
  },
  {
    name: 'write_to_file',
    aliases: ['writeToFile', 'write-file', 'create_file', 'createFile', 'save_file'],
    description: 'Create or overwrite a file',
    params: {
      TargetFile: {
        type: 'string',
        required: true,
        description: 'Absolute path to the target file',
        aliases: ['file_path', 'filepath', 'path', 'file', 'target'],
      },
      CodeContent: {
        type: 'string',
        required: true,
        description: 'Full file content',
        aliases: ['content', 'code', 'text', 'data', 'body'],
      },
      Overwrite: {
        type: 'boolean',
        required: true,
        description: 'Must be true for existing files, false for new files',
        aliases: ['overwrite', 'force', 'replace'],
      },
      Description: {
        type: 'string',
        required: false,
        description: 'Optional description of the file',
        aliases: ['desc', 'summary'],
      },
    },
  },
  {
    name: 'replace_file_content',
    aliases: ['replaceFileContent', 'replace-file-content', 'edit_file', 'editFile'],
    description: 'Targeted edit of a file section with verification',
    params: {
      TargetFile: {
        type: 'string',
        required: true,
        aliases: ['file_path', 'filepath', 'path', 'file', 'target'],
      },
      StartLine: {
        type: 'number',
        required: true,
        description: '1-indexed start line',
        aliases: ['start', 'start_line', 'from'],
      },
      EndLine: {
        type: 'number',
        required: true,
        description: '1-indexed end line (inclusive)',
        aliases: ['end', 'end_line', 'to'],
      },
      ReplacementContent: {
        type: 'string',
        required: true,
        description: 'New content for the replaced lines',
        aliases: ['content', 'new_content', 'replacement', 'code'],
      },
      TargetContent: {
        type: 'string',
        required: true,
        description: 'Exact current content (for verification)',
        aliases: ['old_content', 'existing', 'current'],
      },
      Instruction: {
        type: 'string',
        required: true,
        description: 'Brief description of the edit',
        aliases: ['desc', 'description', 'summary'],
      },
      AllowMultiple: {
        type: 'boolean',
        required: false,
        description: 'Allow matching multiple occurrences of TargetContent',
        aliases: ['allow_multiple', 'allowMultiple', 'multi'],
        default: false,
      },
    },
  },
  {
    name: 'list_dir',
    aliases: ['listDir', 'list-dir', 'ls', 'dir'],
    description: 'List files in a directory',
    params: {
      AbsolutePath: {
        type: 'string',
        required: false,
        description: 'Directory path to list (absolute)',
        aliases: ['path', 'file_path', 'filepath'],
      },
      DirectoryPath: {
        type: 'string',
        required: false,
        description: 'Directory path to list (alternative name)',
        aliases: ['dir', 'directory', 'Dir', 'folder'],
      },
    },
  },
  {
    name: 'view_file',
    aliases: ['viewFile', 'view-file', 'read_file', 'readFile', 'cat', 'show'],
    description: 'View file contents',
    params: {
      AbsolutePath: {
        type: 'string',
        required: false,
        description: 'Absolute path to the file',
        aliases: ['path', 'file', 'file_path', 'filepath', 'target'],
      },
    },
  },
  {
    name: 'grep_search',
    aliases: ['grepSearch', 'grep-search', 'search', 'find'],
    description: 'Search file contents for a pattern',
    params: {
      SearchPath: {
        type: 'string',
        required: false,
        description: 'Directory or file to search in',
        aliases: ['path', 'dir', 'root', 'search_path'],
      },
      Query: {
        type: 'string',
        required: false,
        description: 'Pattern to search for',
        aliases: ['pattern', 'q', 'regex', 'search'],
      },
      Includes: {
        type: 'array',
        required: false,
        description: 'Glob patterns to include (e.g. ["*.ts"])',
        aliases: ['glob', 'include', 'filter'],
      },
    },
  },
  // ─── Agent Orchestration Tools ────────────────────────────────────────
  {
    name: 'invoke_subagent',
    aliases: ['invokeSubagent', 'invoke-subagent', 'spawn_agent', 'spawnAgent'],
    description: 'Spawn a specialist subagent for complex/parallel tasks',
    params: {
      Subagents: {
        type: 'array',
        required: true,
        description: 'Array of subagent configs with TypeName, Role, and Prompt',
        aliases: ['subagents', 'agents', 'tasks'],
      },
    },
  },
  {
    name: 'define_subagent',
    aliases: ['defineSubagent', 'define-subagent', 'register_agent', 'registerAgent'],
    description: 'Register a custom subagent type for reuse',
    params: {
      name: {
        type: 'string',
        required: true,
        description: 'Unique name for the subagent type',
        aliases: ['agent_name', 'agentName', 'type'],
      },
      description: {
        type: 'string',
        required: true,
        description: 'Description of what this subagent does',
        aliases: ['desc', 'summary'],
      },
      system_prompt: {
        type: 'string',
        required: true,
        description: 'System prompt that defines the subagent behavior',
        aliases: ['systemPrompt', 'prompt', 'instructions'],
      },
      enable_mcp_tools: {
        type: 'boolean',
        required: false,
        description: 'Grant MCP tool access to this subagent (default: false)',
        aliases: ['enableMcpTools', 'mcp_tools', 'mcpTools'],
      },
      enable_write_tools: {
        type: 'boolean',
        required: false,
        description: 'Grant file write access to this subagent (default: false)',
        aliases: ['enableWriteTools', 'write_tools', 'writeTools'],
      },
    },
  },
  {
    name: 'manage_subagents',
    aliases: ['manageSubagents', 'manage-subagents', 'subagent_control'],
    description: 'List or kill running subagents. For kill action you MUST provide ConversationIds array.',
    params: {
      Action: {
        type: 'string',
        required: true,
        description: 'Action: list, kill, kill_all',
        default: 'list',
        aliases: ['action', 'cmd'],
      },
      ConversationIds: {
        type: 'array',
        required: false,
        description: 'REQUIRED for kill action. Array of conversation ID strings to kill (e.g. ["conv-id-1", "conv-id-2"]). Get these from manage_subagents(Action="list") first.',
        aliases: ['conversation_ids', 'conversationIds', 'ids', 'subagent_ids', 'subagent_id', 'id', 'conv_ids', 'convId', 'conversationID', 'conversation_id'],
      },
    },
  },
  {
    name: 'send_message',
    aliases: ['sendMessage', 'send-message', 'message_agent', 'msg'],
    description: 'Send a message to a running subagent',
    params: {
      Recipient: {
        type: 'string',
        required: true,
        description: 'Conversation ID of the recipient subagent',
        aliases: ['recipient', 'conv_id', 'convId', 'target', 'to'],
      },
      Message: {
        type: 'string',
        required: true,
        description: 'Message content to send',
        aliases: ['message', 'content', 'text', 'msg'],
      },
    },
  },
  // ─── Research & Browser Tools ─────────────────────────────────────────
  {
    name: 'search_web',
    aliases: ['searchWeb', 'search-web', 'web_search', 'webSearch', 'search'],
    description: 'Search the web for information',
    params: {
      query: {
        type: 'string',
        required: true,
        description: 'Search query string',
        aliases: ['q', 'search', 'keyword', 'keywords'],
      },
      domain: {
        type: 'string',
        required: false,
        description: 'Limit search to a specific domain',
        aliases: ['site', 'source'],
      },
    },
  },
  {
    name: 'read_url_content',
    aliases: ['readUrlContent', 'read-url-content', 'fetch_url', 'fetchUrl', 'read_url'],
    description: 'Fetch and read content from a URL',
    params: {
      Url: {
        type: 'string',
        required: true,
        description: 'The URL to fetch content from',
        aliases: ['url', 'uri', 'link', 'href'],
      },
    },
  },
  {
    name: 'browser_action',
    aliases: ['browserAction', 'browser-action', 'browser'],
    description: 'Control a browser session (navigate, click, type, screenshot, etc.)',
    params: {
      action: {
        type: 'string',
        required: true,
        description: 'Action: navigate, click, type, screenshot, scroll, wait, close, get_html, get_text',
        aliases: ['Action', 'cmd', 'command'],
      },
      url: {
        type: 'string',
        required: false,
        description: 'URL for navigate action',
        aliases: ['Url', 'uri'],
      },
      selector: {
        type: 'string',
        required: false,
        description: 'CSS selector for click/type actions',
        aliases: ['sel', 'element', 'css'],
      },
      text: {
        type: 'string',
        required: false,
        description: 'Text for type action',
        aliases: ['value', 'input'],
      },
    },
  },
  {
    name: 'start_browser_session',
    aliases: ['startBrowserSession', 'start-browser-session', 'browser_session', 'open_browser'],
    description: 'Start a new browser session',
    params: {
      url: {
        type: 'string',
        required: false,
        description: 'Optional URL to navigate to on start',
        aliases: ['Url', 'start_url', 'startUrl'],
      },
    },
  },
  // ─── Interaction & Utility Tools ──────────────────────────────────────
  {
    name: 'ask_permission',
    aliases: ['askPermission', 'ask-permission', 'request_permission', 'requestPermission'],
    description: 'Request a permission grant from the user',
    params: {
      Action: {
        type: 'string',
        required: true,
        description: 'Action to request: e.g. file_write, network, command',
        aliases: ['action', 'permission', 'perm', 'scope'],
      },
      Target: {
        type: 'string',
        required: true,
        description: 'Target path or resource for the permission',
        aliases: ['target', 'path'],
      },
      Reason: {
        type: 'string',
        required: false,
        description: 'Human-readable explanation of why this permission is needed',
        aliases: ['reason', 'why', 'purpose', 'justification'],
      },
    },
  },
  {
    name: 'ask_question',
    aliases: ['askQuestion', 'ask-question', 'question', 'prompt_user'],
    description: 'Ask the user a question with multiple choice options',
    params: {
      questions: {
        type: 'array',
        required: true,
        description: 'Array of question objects, each with text and optional options',
        aliases: ['question', 'q', 'items', 'entries'],
      },
    },
  },
  {
    name: 'list_permissions',
    aliases: ['listPermissions', 'list-permissions', 'permissions', 'show_permissions'],
    description: 'List all granted and available permissions',
    params: {
      // No required params
    },
  },
  {
    name: 'generate_image',
    aliases: ['generateImage', 'generate-image', 'create_image', 'createImage', 'draw'],
    description: 'Generate an AI image',
    params: {
      Prompt: {
        type: 'string',
        required: true,
        description: 'Description of the image to generate',
        aliases: ['prompt', 'description', 'desc'],
      },
      ImageName: {
        type: 'string',
        required: true,
        description: 'Filename to save the image as',
        aliases: ['image_name', 'imageName', 'filename', 'name', 'file'],
      },
    },
  },
  {
    name: 'schedule',
    aliases: ['timer', 'cron', 'reminder', 'schedule_task'],
    description: 'Schedule a prompt to run after a delay or on a cron schedule',
    params: {
      Prompt: {
        type: 'string',
        required: true,
        description: 'The prompt to execute when the schedule fires',
        aliases: ['prompt', 'task', 'message', 'msg'],
      },
      DurationSeconds: {
        type: 'string',
        required: false,
        description: 'Delay in seconds for one-shot scheduling',
        aliases: ['duration_seconds', 'duration', 'delay', 'seconds', 'timeout'],
      },
      CronExpression: {
        type: 'string',
        required: false,
        description: 'Cron expression for recurring scheduling',
        aliases: ['cron_expression', 'cron', 'schedule', 'interval'],
      },
      MaxIterations: {
        type: 'number',
        required: false,
        description: 'Maximum number of recurring runs (default: unlimited)',
        aliases: ['max_iterations', 'maxIterations', 'max_runs', 'limit'],
      },
    },
  },
  {
    name: 'multi_replace_file_content',
    aliases: ['multiReplaceFileContent', 'multi-replace', 'batch_edit', 'batchEdit'],
    description: 'Edit multiple non-contiguous sections in the same file in one call',
    params: {
      TargetFile: {
        type: 'string',
        required: true,
        description: 'Absolute path to the target file',
        aliases: ['file_path', 'filepath', 'path', 'file', 'target'],
      },
      ReplacementChunks: {
        type: 'array',
        required: true,
        description: 'Array of edit chunks, each with StartLine, EndLine, TargetContent, ReplacementContent, AllowMultiple',
        aliases: ['chunks', 'edits', 'replacements'],
      },
    },
  },
  {
    name: 'read_resource',
    aliases: ['readResource', 'read-resource', 'load_resource', 'loadResource'],
    description: 'Read a resource by URI (MCP or built-in)',
    params: {
      uri: {
        type: 'string',
        required: true,
        description: 'Resource URI to read',
        aliases: ['Uri', 'URI', 'url', 'path', 'resource'],
      },
    },
  },
  {
    name: 'list_resources',
    aliases: ['listResources', 'list-resources', 'resources'],
    description: 'List available resources',
    params: {
      // No required params
    },
  },
  {
    name: 'call_mcp_tool',
    aliases: ['callMcpTool', 'call-mcp-tool', 'mcp_tool', 'mcpTool'],
    description: 'Call a tool on an MCP server',
    params: {
      ServerName: {
        type: 'string',
        required: true,
        description: 'Name of the MCP server',
        aliases: ['server', 'server_name', 'serverName'],
      },
      ToolName: {
        type: 'string',
        required: true,
        description: 'Name of the tool on the MCP server',
        aliases: ['tool', 'tool_name', 'toolName'],
      },
      Arguments: {
        type: 'object',
        required: false,
        description: 'Arguments to pass to the MCP tool',
        aliases: ['args', 'params', 'parameters', 'input'],
      },
    },
  },
];

// ─── Registry ──────────────────────────────────────────────────────────

export class ToolCapabilityRegistry {
  /** Static well-known tools keyed by canonical name */
  private wellKnown = new Map<string, ToolSchema>();

  /** Aliases → canonical name */
  private aliasMap = new Map<string, string>();

  /** Per-request dynamic tools (merged on each request) */
  private dynamicTools = new Map<string, ToolSchema>();

  constructor() {
    this.registerWellKnown();
  }

  private registerWellKnown(): void {
    for (const tool of WELL_KNOWN_TOOLS) {
      this.wellKnown.set(tool.name, tool);
      this.aliasMap.set(tool.name, tool.name);
      for (const alias of tool.aliases || []) {
        const lower = alias.toLowerCase();
        if (!this.aliasMap.has(lower)) {
          this.aliasMap.set(lower, tool.name);
        }
      }
    }
  }

  /**
   * Resolve a tool name to its canonical name.
   * Handles aliases and common naming variations.
   *
   * Fuzzy matching rules:
   * - Only match on complete segments (word/snake/kebab boundaries)
   * - Minimum 4 characters to avoid false positives
   * - Prefer exact alias matches over fuzzy
   */
  resolveName(name: string): string {
    const lower = name.toLowerCase().trim();

    // Step 1: Check dynamic tools first (case-insensitive).
    // MCP tools and other per-request tools are registered here.
    // They MUST take priority over well-known alias fuzzy matching to
    // prevent MCP tool names from being hijacked by well-known aliases
    // that share word segments (e.g. MCP "show_graph" vs alias "show"→view_file).
    for (const [dynName] of this.dynamicTools) {
      if (dynName.toLowerCase() === lower) return dynName;
    }

    // Step 2: Direct alias/well-known match
    if (this.aliasMap.has(lower)) return this.aliasMap.get(lower)!;
    if (this.wellKnown.has(name)) return name;

    // Step 3: Fuzzy match — only for well-known tools.
    // Dynamic tools were already checked above and won't reach here.
    const segments = lower.split(/[_-]/);
    for (const [alias, canonical] of this.aliasMap) {
      if (alias.length < 4) continue; // Too short — skip to avoid noise
      // Check if the alias appears as a complete segment
      if (segments.some(s => s === alias)) return canonical;
    }
    // Fallback: check if the entire name is contained in a canonical name or vice versa
    for (const [canonicalName] of this.wellKnown) {
      const cl = canonicalName.toLowerCase();
      if (lower === cl) return canonicalName;
    }
    for (const [alias, canonical] of this.aliasMap) {
      if (alias.length < 4) continue;
      if (lower === alias) return canonical;
    }

    return name; // Unknown — pass through
  }

  /**
   * Get the schema for a tool by its canonical name.
   * Dynamic tools (MCP tools, per-request tools) are checked FIRST
   * so they take priority over well-known tools with the same name.
   */
  getSchema(name: string): ToolSchema | undefined {
    return this.dynamicTools.get(name) || this.wellKnown.get(name);
  }

  /**
   * Merge per-request tools into the registry.
   * These complement but do not override well-known tools.
   */
  setDynamicTools(tools: Record<string, CoreTool> | null | undefined): void {
    this.dynamicTools.clear();
    if (!tools) return;
    for (const [name, def] of Object.entries(tools)) {
      const schema = this.coreToolToSchema(name, def);
      this.dynamicTools.set(name, schema);
    }
  }

  /**
   * Convert a CoreTool (from mapper) to a ToolSchema.
   */
  private coreToolToSchema(name: string, tool: CoreTool): ToolSchema {
    const schema: ToolSchema = { name, params: {} };
    if (tool.description) schema.description = tool.description;

    const params = tool.parameters as Record<string, any> | undefined;
    if (params?.properties) {
      const requiredSet = new Set<string>(
        Array.isArray(params.required) ? params.required : [],
      );
      for (const [key, prop] of Object.entries(params.properties)) {
        const propObj = prop as Record<string, any>;
        schema.params[key] = {
          type: propObj.type || 'string',
          required: requiredSet.has(key),
          description: propObj.description,
          default: propObj.default,
        };
      }
    }
    return schema;
  }

  /**
   * Check if a tool is known.
   */
  hasTool(name: string): boolean {
    const canonical = this.resolveName(name);
    return this.wellKnown.has(canonical) || this.dynamicTools.has(canonical);
  }

  /**
   * Check if a tool name corresponds to a dynamic (per-request, e.g. MCP) tool.
   * Used by the normalizer to decide whether to apply fuzzy param matching.
   */
  isDynamicTool(name: string): boolean {
    for (const [dynName] of this.dynamicTools) {
      if (dynName.toLowerCase() === name.toLowerCase().trim()) return true;
    }
    return false;
  }
}

/** Singleton registry instance */
export const toolCapabilityRegistry = new ToolCapabilityRegistry();
