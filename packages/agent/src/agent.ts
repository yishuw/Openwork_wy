import type { AgentDefinition, AgentResult, AgentConfig } from './types/agent';
import type { ITool } from './types/tool';
import type { LLMMessage, ToolCallRecord } from './memory';
import { ToolRegistry } from './tool-registry';
import { createDefaultTools } from './tools/index';
import { parseToolCalls, type ParsedTool } from './parser';
import { createOpenAILLMProvider } from './llm/openai-client';
import { createLogger } from './logger';
import { LOG_CATEGORY } from './log-categories';

const log = createLogger(LOG_CATEGORY.AGENT);

/** Agent 运行事件 */
export interface AgentEvent {
  type: 'chunk' | 'thinking' | 'tool_start' | 'tool_end' | 'tool_result' | 'done';
  text?: string;
  toolType?: string;
  toolLabel?: string;
  /** 工具调用参数(tool_start 时携带,供前端流式期间展示) */
  toolParams?: Record<string, string>;
  /** 工具执行耗时(tool_end 时携带,供前端展示) */
  durationMs?: number;
}

export type AgentEventCallback = (event: AgentEvent) => void;

/** 工具调用回调 — Agent 每完成一次工具调用通过此回调上报给 Session 写入 memory */
export type ToolCallReportCallback = (toolCall: ToolCallRecord) => void;

const DEFAULT_MAX_TURNS = Infinity;

export class Agent {
  readonly definition: AgentDefinition;
  private provider: ReturnType<typeof createOpenAILLMProvider>;
  private workspaceRoot: string;
  private tools: ToolRegistry;
  /**
   * 本 Agent 会话内已 read 过的文件路径集合(规范化绝对路径)。
   * 由 FileReadTool 写入;FileEditTool / FileWriteTool 读取做前置校验。
   * 故意不存 mtime/content,仅作 bool 标记。
   */
  private readFileState: Set<string> = new Set();

  constructor(definition: AgentDefinition, config: AgentConfig, workspaceRoot: string, extraTools?: ITool[]) {
    this.definition = definition;
    this.provider = createOpenAILLMProvider(config);
    this.workspaceRoot = workspaceRoot;
    this.tools = new ToolRegistry();
    for (const tool of createDefaultTools({ enableBash: config.enableBash })) {
      this.tools.register(tool);
    }
    if (extraTools) {
      for (const tool of extraTools) {
        this.tools.register(tool);
      }
    }
  }

  /** 注册额外工具（可在构造后动态添加，如 MCP 工具） */
  registerTool(tool: ITool): void {
    this.tools.register(tool);
  }

  /** 获取工具注册表（只读访问） */
  getToolRegistry(): Readonly<ToolRegistry> {
    return this.tools;
  }

  /** 暴露 readFileState 给外部只读访问(测试/调试用) */
  getReadFileState(): ReadonlySet<string> {
    return this.readFileState;
  }

  /** 工具用法 text (供 Session 拼 system 段用) */
  getToolsSection(): string {
    return this.tools.buildSystemPromptSection();
  }

  /** 系统提示词(供 Session 拼 system 段用) */
  getSystemPrompt(): string {
    return this.definition.systemPrompt;
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  /**
   * 执行单次对话，自动多轮 + 工具调用。
   *
   * 与旧版的关键差异:
   * - 入参 messages 已由 SessionMemory.projectToLLMMessages 构造好,Agent 不再自己拼装 system/IDE/history
   * - 工具调用通过 onToolCall 回调上报给 Session,Session 写入 memory;Agent 不再自己拼 fullContent
   * - 返回的 AgentResult.toolCalls 仅作为统计返回,真正的结构化记录走回调
   */
  async execute(
    messages: LLMMessage[],
    onEvent?: AgentEventCallback,
    onToolCall?: ToolCallReportCallback
  ): Promise<AgentResult> {
    const emit = (e: AgentEvent) => onEvent?.(e);
    const maxTurns = this.definition.maxTurns ?? DEFAULT_MAX_TURNS;

    // Agent 内部维护一份本地 messages(含本轮工具往返)
    // 入参 messages 是 read-only,这里 clone 一份用于本轮追加
    const localMessages: { role: string; content: string }[] = messages.map(m => ({ ...m }));

    const executeStartMs = Date.now();
    let fullContent = '';
    const toolCalls: { type: string; params: Record<string, string> }[] = [];
    let turns = 0;

    for (let turn = 0; turn < maxTurns; turn++) {
      turns = turn + 1;
      const turnStartMs = Date.now();
      const response = await this.provider.chat(localMessages);

      if (!response) {
        emit({ type: 'done' });
        log.info(`Turn ${turns}/${maxTurns}: empty response, stopping`);
        break;
      }

      const parsedTools = parseToolCalls(response, this.tools);

      if (parsedTools.length > 0) {
        let textBefore = response;
        for (const t of parsedTools) {
          textBefore = textBefore.replace(
            new RegExp(`<${t.type}(\\s[^>]*?)?>[\\s\\S]*?<\\/${t.type}\\s*>`, 'g'),
            '',
          );
          textBefore = textBefore.replace(new RegExp(`<${t.type}[^>]*\\/>`, 'g'), '');
        }
        textBefore = textBefore.trim();

        if (textBefore) {
          emit({ type: 'chunk', text: textBefore + '\n' });
          fullContent += textBefore + '\n';
        }

        for (const tool of parsedTools) {
          toolCalls.push(tool);
          emit({ type: 'tool_start', toolType: tool.type, toolLabel: tool.params.path || tool.params.pattern || '', toolParams: tool.params });

          const { result, durationMs } = await this.executeToolTimed(tool);

          emit({ type: 'tool_result', toolType: tool.type, text: result });
          fullContent += `\n**[Tool: ${tool.type}]**\n${result}\n`;
          emit({ type: 'tool_end', toolType: tool.type, durationMs });

          // 上报给 Session 写入 memory
          onToolCall?.({
            type: tool.type,
            params: { ...tool.params },
            result,
            durationMs,
            agentId: this.definition.id,
          });

          localMessages.push({
            role: 'assistant',
            content: this.serializeToolCall(tool),
          });
          localMessages.push({ role: 'user', content: `Tool result:\n${result}` });
        }

        log.info(`Turn ${turns}/${maxTurns}: ${parsedTools.length} tool(s), ${Date.now() - turnStartMs}ms`, {
          agentId: this.definition.id,
          turn: turns,
          tools: parsedTools.map(t => t.type),
          messages: localMessages.length,
        });

        continue;
      }

      emit({ type: 'chunk', text: response });
      fullContent += response;
      emit({ type: 'done' });
      log.info(`Turn ${turns}/${maxTurns}: final response, ${response.length} chars, ${Date.now() - turnStartMs}ms`, {
        agentId: this.definition.id,
        turn: turns,
        contentLen: response.length,
      });
      break;
    }

    log.info(`execute done: ${fullContent.length} chars, ${turns} turns, ${toolCalls.length} tool calls, ${Date.now() - executeStartMs}ms`, {
      agentId: this.definition.id,
      contentLen: fullContent.length,
      turns,
      toolCalls: toolCalls.length,
    });
    return {
      agentId: this.definition.id,
      content: fullContent,
      turns,
      toolCalls,
    };
  }

  /** 执行流式对话，自动多轮 + 工具调用 */
  async executeStream(
    messages: LLMMessage[],
    onEvent?: AgentEventCallback,
    onToolCall?: ToolCallReportCallback,
    signal?: AbortSignal
  ): Promise<AgentResult> {
    const emit = (e: AgentEvent) => onEvent?.(e);
    const maxTurns = this.definition.maxTurns ?? DEFAULT_MAX_TURNS;

    const localMessages: { role: string; content: string }[] = messages.map(m => ({ ...m }));

    const executeStartMs = Date.now();
    let fullContent = '';
    let thinkingContent = '';
    const toolCalls: { type: string; params: Record<string, string> }[] = [];
    let turns = 0;

    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal?.aborted) {
        emit({ type: 'done' });
        log.info(`Turn ${turns}/${maxTurns}: aborted by signal`);
        break;
      }
      turns = turn + 1;
      const turnStartMs = Date.now();

      // 每轮开始前重置 thinking 累积(每轮独立的 thinking)
      let turnThinking = '';

      const response = await this.provider.chatStream(localMessages, (type, text) => {
        if (type === 'thinking') {
          turnThinking += text;
          emit({ type: 'thinking', text });
        } else if (type === 'content') {
          emit({ type: 'chunk', text });
        }
      });

      // 累加 thinking 内容到整轮
      if (turnThinking) thinkingContent += turnThinking;

      if (!response) {
        emit({ type: 'done' });
        log.info(`Turn ${turns}/${maxTurns}: empty stream response, stopping`);
        break;
      }

      const parsedTools = parseToolCalls(response, this.tools);

      if (parsedTools.length > 0) {
        fullContent += response;

        for (const tool of parsedTools) {
          toolCalls.push(tool);
          emit({ type: 'tool_start', toolType: tool.type, toolLabel: tool.params.path || tool.params.pattern || '', toolParams: tool.params });

          const { result, durationMs } = await this.executeToolTimed(tool);

          emit({ type: 'tool_result', toolType: tool.type, text: result });
          fullContent += `\n\n**[Tool: ${tool.type}]**\n${result}\n`;
          emit({ type: 'tool_end', toolType: tool.type, durationMs });

          onToolCall?.({
            type: tool.type,
            params: { ...tool.params },
            result,
            durationMs,
            agentId: this.definition.id,
          });

          localMessages.push({
            role: 'assistant',
            content: this.serializeToolCall(tool),
          });
          localMessages.push({ role: 'user', content: `Tool result:\n${result}` });
        }

        log.info(`Turn ${turns}/${maxTurns}: ${parsedTools.length} tool(s), ${Date.now() - turnStartMs}ms`, {
          agentId: this.definition.id,
          turn: turns,
          tools: parsedTools.map(t => t.type),
          messages: localMessages.length,
        });

        continue;
      }

      fullContent += response;
      if (fullContent.length > 50000) {
        emit({ type: 'chunk', text: '\n\n*[响应过长，已截断]*' });
        fullContent += '\n\n*[响应过长，已截断]*';
      }
      log.info(`Turn ${turns}/${maxTurns}: final response, ${response.length} chars, ${Date.now() - turnStartMs}ms`, {
        agentId: this.definition.id,
        turn: turns,
        contentLen: response.length,
      });
      emit({ type: 'done' });
      break;
    }

    log.info(`executeStream done: ${fullContent.length} chars, thinking=${thinkingContent.length} chars, turns=${turns}, ${toolCalls.length} tool calls, ${Date.now() - executeStartMs}ms`, {
      agentId: this.definition.id,
      contentLen: fullContent.length,
      thinkingLen: thinkingContent.length,
      turns,
      toolCalls: toolCalls.length,
    });
    return {
      agentId: this.definition.id,
      content: fullContent,
      turns,
      toolCalls,
      thinking: thinkingContent,
    };
  }

  /** 执行工具并计时,返回结果与耗时 */
  private async executeToolTimed(tool: ParsedTool): Promise<{ result: string; durationMs: number }> {
    const impl = this.tools.get(tool.type);
    if (!impl) {
      log.warn(`Unknown tool: ${tool.type}`);
      return { result: `Unknown tool: ${tool.type}`, durationMs: 0 };
    }
    const keyParams = Object.entries(tool.params)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v.length > 60 ? v.slice(0, 60) + '...' : v}`)
      .join(', ');
    log.info(`Tool call: ${tool.type}${keyParams ? ` (${keyParams})` : ''}`);
    const startMs = Date.now();
    const result = await impl.execute(tool.params, {
      workspaceRoot: this.workspaceRoot,
      readFileState: this.readFileState,
    });
    const durationMs = Date.now() - startMs;
    log.info(`Tool done: ${tool.type} (${durationMs}ms, ${result.length} chars)`);
    return { result, durationMs };
  }

  /**
   * 把一次工具调用序列化为可放回对话历史的字符串。
   * 仅用于 assistant 消息展示,LLM 不需要原样复用它。
   * - 自闭合工具:`<read_file path="..."/>`
   * - 带大段 content body:`<file_write path="..."><content>...</content></file_write>`
   *   (用 <content> 包裹避免大文本里出现 " 而无法走 attribute 路径)
   * - 带子标签 body:`<file_edit path="..."><old>...</old><new>...</new></file_edit>`
   */
  private serializeToolCall(tool: ParsedTool): string {
    const bodyMode = this.tools.getBodyMode(tool.type);
    const attrs = Object.entries(tool.params)
      .filter(([k]) => {
        if (bodyMode === 'content' && k === 'content') return false;
        if (bodyMode === 'children') return false;
        return true;
      })
      .map(([k, v]) => `${k}="${v.replace(/"/g, '&quot;')}"`)
      .join(' ');

    if (bodyMode === 'content') {
      return `<${tool.type}${attrs ? ' ' + attrs : ''}>${tool.params.content ?? ''}</${tool.type}>`;
    }
    if (bodyMode === 'children') {
      const children = Object.entries(tool.params)
        .map(([k, v]) => `<${k}>${v}</${k}>`)
        .join('\n');
      return `<${tool.type}${attrs ? ' ' + attrs : ''}>\n${children}\n</${tool.type}>`;
    }
    return `<${tool.type}${attrs ? ' ' + attrs : ''}/>`;
  }
}
