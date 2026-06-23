import type { AgentConfig, AgentContext, SessionMessage } from './types/agent';
import type { IAgentFileSystem } from './types/filesystem';
import type { McpServerEntry, McpConfig } from './mcp/config';
import type { ITool } from './types/tool';
import { Agent } from './agent';
import { Session, type SessionEvent } from './session';
import { McpManager } from './mcp/manager';
import { createOpenAILLMProvider, buildMessages } from './llm/openai-client';
import { createLogger } from './logger';

const log = createLogger('AgentRuntime');

export interface AgentRuntimeConfig {
  mode: 'build' | 'plan';
  provider: {
    apiUrl?: string;
    apiKey?: string;
    model?: string;
  };
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  workspaceRoot: string;
  mcpServers?: McpServerEntry[];
  maxTurns?: number;
  fileSystem?: IAgentFileSystem;
}

export interface ChatResult {
  content: string;
  turns: number;
  toolCalls: { type: string; params: Record<string, string> }[];
}

export interface AgentRuntimeEvent {
  type: 'chunk' | 'thinking' | 'tool_start' | 'tool_end' | 'tool_result' | 'done' | 'error';
  text?: string;
  toolName?: string;
  toolLabel?: string;
  error?: string;
}

export type AgentRuntimeEventCallback = (event: AgentRuntimeEvent) => void;

const DEFAULT_SYSTEM_PROMPT = [
  'You are an autonomous coding agent. Your goal is to understand, plan, and execute code changes.',
  '',
  '## Making Changes',
  '',
  'You have THREE file tools. Their priority is fixed:',
  '',
  '1. `file_edit` — DEFAULT for any modification to an existing file.',
  '   Sends only the diff (old/new strings), so it is cheap and safe.',
  '2. `file_write` — ONLY for these two cases:',
  '   (a) creating a NEW file that does not exist yet;',
  '   (b) a COMPLETE rewrite where the change touches the majority of lines.',
  '   For anything else, use `file_edit`. Never use `file_write` to "make a small change".',
  '3. `read_file` — load a file before editing it. Both `file_edit` and `file_write`',
  '   REQUIRE a prior `read_file` of the same path in this session; otherwise they will refuse.',
  '',
  '## Rules',
  '1. Read files before editing them (`read_file` first, then `file_edit`).',
  '2. Prefer `file_edit` over `file_write`. If you find yourself reaching for `file_write`',
  '   to patch a few lines, STOP — use `file_edit` instead.',
  '3. With `file_edit`, the <old> text must match EXACTLY (whitespace included) and be unique',
  '   in the file. Add surrounding context lines if it is not unique, or set replace_all="true".',
  '4. With `file_write`, the body is the COMPLETE final file content (no code fences).',
  '5. Think step by step: explore → plan → execute → explain.',
  '6. Only invoke file tools when the user explicitly asks for file changes.',
].join('\n');

export class AgentRuntime {
  private config: AgentRuntimeConfig;
  private agentConfig: AgentConfig;
  private fs: IAgentFileSystem;
  private mcpManager: McpManager | null = null;
  private mcpTools: ITool[] = [];
  private initialized = false;
  private sessionMap = new Map<string, Session>();

  constructor(config: AgentRuntimeConfig) {
    this.config = config;
    this.fs = config.fileSystem || this.createDefaultFS(config.workspaceRoot);
    this.agentConfig = {
      mode: config.mode,
      model: config.provider.model,
      apiUrl: config.provider.apiUrl,
      apiKey: config.provider.apiKey,
      systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    };
  }

  private createDefaultFS(rootPath: string): IAgentFileSystem {
    const { promises: fs } = require('fs');
    const pathModule = require('path');
    const root = pathModule.resolve(rootPath);

    const resolve = (relative: string): string => {
      const p = pathModule.resolve(root, relative);
      if (!p.startsWith(root)) throw new Error('Path traversal not allowed');
      return p;
    };

    return {
      async readFile(relative: string): Promise<string> {
        return fs.readFile(resolve(relative), 'utf-8');
      },
      async writeFile(relative: string, content: string): Promise<void> {
        await fs.mkdir(pathModule.dirname(resolve(relative)), { recursive: true });
        await fs.writeFile(resolve(relative), content, 'utf-8');
      },
      async exists(relative: string): Promise<boolean> {
        try { await fs.access(resolve(relative)); return true; } catch { return false; }
      },
      async readDir(relative: string): Promise<{ name: string; path: string; isDirectory: boolean }[]> {
        const abs = resolve(relative);
        const entries = await fs.readdir(abs, { withFileTypes: true });
        return entries.map((e: { name: string; isDirectory: () => boolean }) => ({
          name: e.name,
          path: pathModule.relative(root, pathModule.join(abs, e.name)).replace(/\\/g, '/'),
          isDirectory: e.isDirectory(),
        }));
      },
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.config.mode === 'build' && this.config.mcpServers && this.config.mcpServers.length > 0) {
      const mcpConfig: McpConfig = { mcpServers: {} };
      for (const entry of this.config.mcpServers) {
        mcpConfig.mcpServers[entry.id] = entry.config;
      }
      this.mcpManager = new McpManager();
      try {
        await this.mcpManager.connectAll(mcpConfig);
        this.mcpTools = await this.mcpManager.discoverAndCreateAdapters();
      } catch (e: any) {
        log.error(`MCP connection failed: ${e.message}`);
      }
    }

    this.initialized = true;
  }

  async dispose(): Promise<void> {
    if (this.mcpManager) {
      try { await this.mcpManager.disconnectAll(); } catch { /* ignore */ }
      this.mcpManager = null;
      this.mcpTools = [];
    }
    this.initialized = false;
  }

  /** 重新初始化 MCP 连接（当 MCP 配置变更时使用） */
  async reinitialize(mcpServers?: typeof this.config.mcpServers): Promise<void> {
    await this.dispose();
    if (mcpServers) this.config.mcpServers = mcpServers;
    await this.initialize();
  }

  async chat(message: string, context: AgentContext, sessionId = 'default'): Promise<ChatResult> {
    await this.initialize();

    if (this.agentConfig.mode === 'plan') {
      const provider = createOpenAILLMProvider(this.agentConfig);
      const messages = buildMessages(this.agentConfig, message, context);
      const content = await provider.chat(messages);
      return this.buildResult(content, 1, []);
    }

    const session = this.getOrCreateSession(sessionId);
    const result = await session.start(message, context);
    return this.buildResult(result.mainResult.content, result.mainResult.turns, result.mainResult.toolCalls);
  }
  async chatStream(
    message: string,
    context: AgentContext,
    onEvent?: AgentRuntimeEventCallback,
    signal?: AbortSignal,
    sessionId = 'default'
  ): Promise<ChatResult> {
    await this.initialize();

    if (this.agentConfig.mode === 'plan') {
      return this.runPlanStream(message, context, onEvent);
    }

    const session = this.getOrCreateSession(sessionId);

    const emit = (e: AgentRuntimeEvent) => onEvent?.(e);
    const sessionEvent = (se: SessionEvent) => {
      switch (se.type) {
        case 'chunk':
          emit({ type: 'chunk', text: se.data });
          break;
        case 'thinking':
          emit({ type: 'thinking', text: se.data });
          break;
        case 'tool_start':
          emit({ type: 'tool_start', toolName: se.toolType, toolLabel: se.toolLabel });
          break;
        case 'tool_end':
          emit({ type: 'tool_end', toolName: se.toolType });
          break;
        case 'tool_result':
          emit({ type: 'tool_result', toolName: se.toolType, text: se.data });
          break;
        case 'done':
          break;
        case 'error':
          emit({ type: 'error', error: se.data });
          break;
      }
    };

    try {
      const result = await session.startStream(message, context, sessionEvent, signal);
      emit({ type: 'done' });
      return this.buildResult(result.mainResult.content, result.mainResult.turns, result.mainResult.toolCalls);
    } catch (e: any) {
      emit({ type: 'error', error: e.message || String(e) });
      throw e;
    }
  }

  get mcpStatus(): { serverCount: number; toolCount: number } {
    if (!this.mcpManager) return { serverCount: 0, toolCount: 0 };
    return {
      serverCount: this.mcpManager.serverCount,
      toolCount: this.mcpTools.length,
    };
  }

  get fileSystem(): IAgentFileSystem {
    return this.fs;
  }

  // ====================== Session 管理 ======================

  private getOrCreateSession(sessionId: string): Session {
    let session = this.sessionMap.get(sessionId);
    if (!session) {
      const agent = this.createAgent();
      session = new Session(sessionId, agent);
      this.sessionMap.set(sessionId, session);
    }
    return session;
  }

  getSessionMessages(sessionId: string): SessionMessage[] {
    const session = this.sessionMap.get(sessionId);
    return session ? [...session.messages] : [];
  }

  restoreSession(sessionId: string, messages: SessionMessage[]): void {
    const agent = this.createAgent();
    const session = new Session(sessionId, agent);
    session.messages = [...messages];
    this.sessionMap.set(sessionId, session);
  }

  getSessionIds(): string[] {
    return Array.from(this.sessionMap.keys());
  }

  deleteSession(sessionId: string): void {
    this.sessionMap.delete(sessionId);
  }

  // ====================== 内部实现 ======================

  private createAgent(): Agent {
    return new Agent(
      {
        id: 'main',
        name: 'Main Agent',
        systemPrompt: this.agentConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        temperature: this.agentConfig.temperature,
        maxTokens: this.agentConfig.maxTokens,
        maxTurns: this.config.maxTurns ?? (this.config.mode === 'build' ? 20 : 10),
      },
      this.agentConfig,
      this.config.workspaceRoot,
      this.mcpTools.length > 0 ? this.mcpTools : undefined
    );
  }

  private async runPlanStream(
    message: string,
    context: AgentContext,
    onEvent?: AgentRuntimeEventCallback
  ): Promise<ChatResult> {
    const emit = (e: AgentRuntimeEvent) => onEvent?.(e);
    const provider = createOpenAILLMProvider(this.agentConfig);
    const messages = buildMessages(this.agentConfig, message, context);
    try {
      const content = await provider.chatStream(messages, (type, text) => {
        emit({ type: type === 'thinking' ? 'thinking' : 'chunk', text });
      });
      emit({ type: 'done' });
      return this.buildResult(content, 1, []);
    } catch (e: any) {
      emit({ type: 'error', error: e.message || String(e) });
      throw e;
    }
  }

  private buildResult(
    content: string,
    turns: number,
    toolCalls: { type: string; params: Record<string, string> }[]
  ): ChatResult {
    // 编辑能力已下沉到 FileWriteTool / FileEditTool,在 agent 循环内直接落盘。
    // 这里不再扫描 <edit> 块;ChatResult 也不再携带 edits 字段。
    return {
      content,
      turns,
      toolCalls,
    };
  }
}
