import type { AgentDefinition, AgentResult, AgentConfig } from './types/agent';
import type { ITool, OpenAIFunctionDefinition, FileChangeMeta } from './types/tool';
import type { ILLMProvider, LLMChatMessage, ChatWithToolsResult } from './types/provider';
import type { LLMMessage, ToolCallRecord } from './memory';
import { ToolRegistry } from './tool-registry';
import { createDefaultTools } from './tools/index';
import { parseToolCalls, type ParsedTool } from './parser';
import { createOpenAILLMProvider } from './llm/openai-client';
import {
  resolveToolProtocol,
  type ModelCapabilities,
} from './llm/model-capabilities';
import {
  resolvePermissionMode,
  requiresApproval,
  buildApprovalLabel,
  defaultDecision,
  nextApprovalId,
  DEFAULT_PERMISSION_MODE,
  type Approver,
  type PermissionMode,
  type ApprovalRequest,
} from './permission';
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
  /** 本轮工具产生的文件变更（write/edit） */
  fileChanges?: FileChangeMeta[];
}

export type AgentEventCallback = (event: AgentEvent) => void;

/** 工具调用回调 — Agent 每完成一次工具调用通过此回调上报给 Session 写入 memory */
export type ToolCallReportCallback = (toolCall: ToolCallRecord) => void;

/** 默认单次 execute 最大 LLM 轮次（XML / FC 共用） */
export const DEFAULT_AGENT_MAX_TURNS = 20;
/** 用户可配 maxTurns 的绝对上限，防配置写爆 */
export const ABSOLUTE_MAX_TURNS = 50;
/** 连续 FC 调用失败次数达到该值后，本 Agent 降级为 XML */
const FC_FALLBACK_FAILURE_THRESHOLD = 2;

/** 解析本轮 maxTurns：非法值回退默认，且不超过绝对上限 */
export function resolveMaxTurns(requested?: number): number {
  const n = requested;
  if (n === undefined || n === null || !Number.isFinite(n) || n <= 0) {
    return DEFAULT_AGENT_MAX_TURNS;
  }
  return Math.min(Math.floor(n), ABSOLUTE_MAX_TURNS);
}

const MAX_TURNS_NOTE = (n: number) => `\n\n*[已达到最大轮次 ${n}，已停止]*`;

/** Agent 构造可选覆盖（测试注入 mock provider / 强制协议 / 权限确认） */
export interface AgentOverrides {
  provider?: ILLMProvider;
  toolProtocol?: AgentConfig['toolProtocol'];
  modelCapabilities?: ModelCapabilities;
  approver?: Approver;
  permissionMode?: PermissionMode;
}

/** 判断是否为取消类错误（不计入 FC 失败降级） */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; message?: string };
  if (e.name === 'AbortError' || e.name === 'APIUserAbortError') return true;
  const msg = String(e.message || '');
  return /abort(ed)?/i.test(msg) || /The user aborted/i.test(msg);
}

function toolArgsToStringParams(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let parsed: unknown = {};
  const text = (raw ?? '').trim();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Invalid tool arguments JSON: ${text.slice(0, 200)}`);
    }
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      out[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
  }
  return out;
}

export class Agent {
  readonly definition: AgentDefinition;
  private provider: ILLMProvider;
  private workspaceRoot: string;
  private tools: ToolRegistry;
  /** 日志用模型名(展示/联调);不参与调用逻辑 */
  private readonly modelLabel: string;
  private readonly requestedToolProtocol: NonNullable<AgentConfig['toolProtocol']>;
  private readonly modelCapabilities?: ModelCapabilities | null;
  private permissionMode: PermissionMode;
  private readonly approver?: Approver;
  /** 运行时实际协议；连续失败后变为 fallback_xml → 之后走 XML */
  private activeProtocol: 'xml' | 'fc' | 'fallback_xml';
  private fcFailStreak = 0;
  /**
   * 本 Agent 会话内已 read 过的文件路径集合(规范化绝对路径)。
   * 由 FileReadTool 写入;FileEditTool / FileWriteTool 读取做前置校验。
   * 故意不存 mtime/content,仅作 bool 标记。
   */
  private readFileState: Set<string> = new Set();

  constructor(
    definition: AgentDefinition,
    config: AgentConfig,
    workspaceRoot: string,
    extraTools?: ITool[],
    overrides?: AgentOverrides,
  ) {
    this.definition = definition;
    this.provider = overrides?.provider || createOpenAILLMProvider(config);
    this.modelLabel = config.model || process.env.LLM_MODEL || 'unknown';
    this.requestedToolProtocol = overrides?.toolProtocol || config.toolProtocol || 'xml';
    this.modelCapabilities =
      overrides?.modelCapabilities !== undefined
        ? overrides.modelCapabilities
        : config.modelCapabilities !== undefined
          ? config.modelCapabilities
          : null;
    const resolved = resolveToolProtocol({
      requested: this.requestedToolProtocol,
      model: this.modelLabel,
      capabilities: this.modelCapabilities,
      hasChatWithTools: !!this.provider.chatWithTools,
    });
    this.activeProtocol = resolved;
    this.permissionMode = resolvePermissionMode(
      overrides?.permissionMode || config.permissionMode,
    );
    this.approver = overrides?.approver;
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

  /** 工具协议日志字段。 */
  private logBaseMeta(protocol?: 'xml' | 'fc' | 'fallback_xml'): Record<string, unknown> {
    return {
      protocol: protocol || this.activeProtocol,
      agentId: this.definition.id,
      model: this.modelLabel,
    };
  }

  private effectiveProtocol(): 'xml' | 'fc' {
    return this.activeProtocol === 'fc' ? 'fc' : 'xml';
  }

  /** FC 调用失败计数；连续达到阈值后本 Agent 降级 XML。Abort 不计入失败。 */
  private noteFcFailure(error: unknown): void {
    if (isAbortError(error)) {
      log.info('FC call aborted — not counted as failure', {
        ...this.logBaseMeta('fc'),
      });
      return;
    }
    this.fcFailStreak += 1;
    const msg = error instanceof Error ? error.message : String(error);
    log.warn(`FC call failed (streak=${this.fcFailStreak}): ${msg}`, {
      ...this.logBaseMeta('fc'),
      streak: this.fcFailStreak,
      error: msg,
    });
    if (
      this.fcFailStreak >= FC_FALLBACK_FAILURE_THRESHOLD &&
      this.activeProtocol === 'fc'
    ) {
      this.activeProtocol = 'fallback_xml';
      log.warn('FC fallback to XML for this agent session', {
        ...this.logBaseMeta('fallback_xml'),
        threshold: FC_FALLBACK_FAILURE_THRESHOLD,
      });
    }
  }

  /** 运行时切换权限模式（桌面设置 / 每请求覆盖） */
  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = resolvePermissionMode(mode);
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  private noteFcSuccess(): void {
    this.fcFailStreak = 0;
  }

  /**
   * 权限闸门：返回 true 表示允许执行；返回字符串为拒绝原因（写入 tool result）。
   */
  private async gateApproval(impl: ITool, params: Record<string, string>): Promise<true | string> {
    const need = requiresApproval(
      {
        name: impl.name,
        readOnlyHint: impl.annotations?.readOnlyHint,
        destructiveHint: impl.annotations?.destructiveHint,
      },
      this.permissionMode,
    );
    if (!need) return true;

    const label = buildApprovalLabel(impl.name, params);
    const req: ApprovalRequest = {
      approvalId: nextApprovalId(),
      toolName: impl.name,
      params,
      label,
      mode: this.permissionMode,
    };

    log.info(`permission required: ${label}`, {
      ...this.logBaseMeta(),
      toolName: impl.name,
      mode: this.permissionMode,
    });

    if (!this.approver) {
      const d = defaultDecision(this.permissionMode);
      log.warn(`permission ${d} (no approver): ${label}`, {
        ...this.logBaseMeta(),
        toolName: impl.name,
        mode: this.permissionMode,
        decision: d,
      });
      if (d === 'allow') return true;
      return `Error: User denied (no approver): ${label}. Ask the user or change permissionMode.`;
    }

    try {
      const decision = await this.approver(req);
      log.info(`permission ${decision}: ${label}`, {
        ...this.logBaseMeta(),
        toolName: impl.name,
        mode: this.permissionMode,
        decision,
      });
      if (decision === 'allow') return true;
      return `Error: User denied: ${label}. Do not retry the same tool; change approach.`;
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`approver threw, treating as deny: ${msg}`, {
        ...this.logBaseMeta(),
        toolName: impl.name,
      });
      return `Error: User denied (approver error): ${msg}`;
    }
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
    onToolCall?: ToolCallReportCallback,
    signal?: AbortSignal,
  ): Promise<AgentResult> {
    if (this.effectiveProtocol() === 'fc' && this.provider.chatWithTools) {
      return this.executeWithFunctionCalling(messages, onEvent, onToolCall, signal);
    }
    const emit = (e: AgentEvent) => onEvent?.(e);
    const maxTurns = resolveMaxTurns(this.definition.maxTurns);

    // Agent 内部维护一份本地 messages(含本轮工具往返)
    // 入参 messages 是 read-only,这里 clone 一份用于本轮追加
    const localMessages: { role: string; content: string }[] = messages.map(m => ({ ...m }));

    const executeStartMs = Date.now();
    let fullContent = '';
    const toolCalls: { type: string; params: Record<string, string> }[] = [];
    let turns = 0;
    let stopReason: NonNullable<AgentResult['stopReason']> = 'stop';
    let exitedEarly = false;

    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal?.aborted) {
        stopReason = 'aborted';
        exitedEarly = true;
        const abortNote = '\n\n*[已取消]*';
        fullContent += abortNote;
        emit({ type: 'chunk', text: abortNote });
        emit({ type: 'done' });
        log.info(`Turn ${turns}/${maxTurns}: aborted before chat`, {
          ...this.logBaseMeta(),
          turn: turns,
          maxTurns,
          finishReason: 'aborted',
        });
        break;
      }
      turns = turn + 1;
      const turnStartMs = Date.now();
      let response: string;
      try {
        response = await this.provider.chat(localMessages, { signal });
      } catch (e: any) {
        if (isAbortError(e)) {
          stopReason = 'aborted';
          exitedEarly = true;
          const abortNote = '\n\n*[已取消]*';
          fullContent += abortNote;
          emit({ type: 'chunk', text: abortNote });
          emit({ type: 'done' });
          log.info(`Turn ${turns}/${maxTurns}: aborted by signal during chat`, {
            ...this.logBaseMeta(),
            turn: turns,
            maxTurns,
            finishReason: 'aborted',
          });
          break;
        }
        throw e;
      }

      if (!response) {
        emit({ type: 'done' });
        stopReason = 'empty';
        exitedEarly = true;
        log.info(`Turn ${turns}/${maxTurns}: empty response, stopping`, {
          ...this.logBaseMeta(),
          turn: turns,
          maxTurns,
          finishReason: 'empty',
        });
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

          const { result, durationMs, fileChanges } = await this.executeToolTimed(tool, signal);

          emit({ type: 'tool_result', toolType: tool.type, text: result });
          fullContent += `\n**[Tool: ${tool.type}]**\n${result}\n`;
          emit({ type: 'tool_end', toolType: tool.type, durationMs, fileChanges });

          // 上报给 Session 写入 memory
          onToolCall?.({
            type: tool.type,
            params: { ...tool.params },
            result,
            durationMs,
            agentId: this.definition.id,
            fileChanges,
          });

          localMessages.push({
            role: 'assistant',
            content: this.serializeToolCall(tool),
          });
          localMessages.push({ role: 'user', content: `Tool result:\n${result}` });
        }

        log.info(`Turn ${turns}/${maxTurns}: ${parsedTools.length} tool(s), ${Date.now() - turnStartMs}ms`, {
          ...this.logBaseMeta(),
          turn: turns,
          maxTurns,
          toolNames: parsedTools.map(t => t.type),
          messages: localMessages.length,
          finishReason: 'tool_calls',
        });

        continue;
      }

      emit({ type: 'chunk', text: response });
      fullContent += response;
      emit({ type: 'done' });
      stopReason = 'stop';
      exitedEarly = true;
      log.info(`Turn ${turns}/${maxTurns}: final response, ${response.length} chars, ${Date.now() - turnStartMs}ms`, {
        ...this.logBaseMeta(),
        turn: turns,
        maxTurns,
        contentLen: response.length,
        finishReason: 'stop',
      });
      break;
    }

    if (!exitedEarly) {
      stopReason = 'max_turns';
      const note = MAX_TURNS_NOTE(maxTurns);
      fullContent += note;
      emit({ type: 'chunk', text: note });
      emit({ type: 'done' });
      log.info(`execute stopped at maxTurns=${maxTurns}`, {
        ...this.logBaseMeta(),
        turns,
        maxTurns,
        finishReason: 'max_turns',
      });
    }

    log.info(`execute done: ${fullContent.length} chars, ${turns} turns, ${toolCalls.length} tool calls, ${Date.now() - executeStartMs}ms`, {
      ...this.logBaseMeta(),
      contentLen: fullContent.length,
      turns,
      toolCalls: toolCalls.length,
      stopReason,
    });
    return {
      agentId: this.definition.id,
      content: fullContent,
      turns,
      toolCalls,
      stopReason,
    };
  }

  /**
   * 非流式 function calling 循环（OpenAI tools / 国产兼容 API）。
   * XML 路径保持不变；本方法仅在 protocol=fc/auto 且 provider.chatWithTools 存在时进入。
   */
  private async executeWithFunctionCalling(
    messages: LLMMessage[],
    onEvent?: AgentEventCallback,
    onToolCall?: ToolCallReportCallback,
    signal?: AbortSignal,
  ): Promise<AgentResult> {
    const emit = (e: AgentEvent) => onEvent?.(e);
    const chatWithTools = this.provider.chatWithTools!;
    const openAiTools: OpenAIFunctionDefinition[] = this.tools.listOpenAITools();
    const maxTurns = resolveMaxTurns(this.definition.maxTurns);

    const localMessages: LLMChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const executeStartMs = Date.now();
    let fullContent = '';
    const toolCalls: { type: string; params: Record<string, string> }[] = [];
    let turns = 0;
    let stopReason: NonNullable<AgentResult['stopReason']> = 'stop';
    let exitedEarly = false;

    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal?.aborted) {
        stopReason = 'aborted';
        exitedEarly = true;
        const abortNote = '\n\n*[已取消]*';
        fullContent += abortNote;
        emit({ type: 'chunk', text: abortNote });
        emit({ type: 'done' });
        log.info(`Turn ${turns}/${maxTurns}: aborted before chatWithTools`, {
          ...this.logBaseMeta('fc'),
          turn: turns,
          maxTurns,
          finishReason: 'aborted',
        });
        break;
      }
      turns = turn + 1;
      const turnStartMs = Date.now();
      let result: ChatWithToolsResult;
      try {
        result = await chatWithTools(localMessages, openAiTools, { signal });
        this.noteFcSuccess();
      } catch (e: any) {
        this.noteFcFailure(e);
        if (isAbortError(e)) {
          stopReason = 'aborted';
          exitedEarly = true;
          const abortNote = '\n\n*[已取消]*';
          fullContent += abortNote;
          emit({ type: 'chunk', text: abortNote });
          emit({ type: 'done' });
          log.info(`FC aborted on turn ${turns}`, {
            ...this.logBaseMeta('fc'),
            turn: turns,
            finishReason: 'aborted',
          });
          break;
        }
        emit({ type: 'done' });
        log.error(`FC chatWithTools failed on turn ${turns}: ${e.message}`, {
          ...this.logBaseMeta('fc'),
          turn: turns,
          error: e.message,
        });
        throw e;
      }

      if (result.content) {
        emit({ type: 'chunk', text: result.content });
        fullContent += result.content;
      }

      if (result.toolCalls.length === 0) {
        emit({ type: 'done' });
        stopReason = 'stop';
        exitedEarly = true;
        log.info(`Turn ${turns}/${maxTurns}: final response, ${result.content.length} chars, ${Date.now() - turnStartMs}ms`, {
          ...this.logBaseMeta('fc'),
          turn: turns,
          maxTurns,
          contentLen: result.content.length,
          finishReason: result.finishReason || 'stop',
        });
        break;
      }

      localMessages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: c.arguments },
        })),
      });

      for (const call of result.toolCalls) {
        let params: Record<string, string>;
        try {
          params = toolArgsToStringParams(call.arguments);
        } catch (e: any) {
          const errText = `Error: ${e.message}`;
          toolCalls.push({ type: call.name, params: {} });
          emit({ type: 'tool_start', toolType: call.name, toolLabel: '', toolParams: {} });
          emit({ type: 'tool_result', toolType: call.name, text: errText });
          fullContent += `\n**[Tool: ${call.name}]**\n${errText}\n`;
          emit({ type: 'tool_end', toolType: call.name, durationMs: 0 });
          onToolCall?.({
            type: call.name,
            params: {},
            result: errText,
            durationMs: 0,
            agentId: this.definition.id,
          });
          localMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: errText,
          });
          continue;
        }

        const parsed: ParsedTool = { type: call.name, params };
        toolCalls.push(parsed);
        emit({
          type: 'tool_start',
          toolType: call.name,
          toolLabel: params.path || params.pattern || '',
          toolParams: params,
        });

        const timed = await this.executeToolTimed(parsed, signal);
        emit({ type: 'tool_result', toolType: call.name, text: timed.result });
        fullContent += `\n**[Tool: ${call.name}]**\n${timed.result}\n`;
        emit({ type: 'tool_end', toolType: call.name, durationMs: timed.durationMs, fileChanges: timed.fileChanges });

        onToolCall?.({
          type: call.name,
          params: { ...params },
          result: timed.result,
          durationMs: timed.durationMs,
          agentId: this.definition.id,
          fileChanges: timed.fileChanges,
        });

        localMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: timed.result,
        });
      }

      log.info(`Turn ${turns}/${maxTurns}: ${result.toolCalls.length} tool(s), ${Date.now() - turnStartMs}ms`, {
        ...this.logBaseMeta('fc'),
        turn: turns,
        maxTurns,
        toolNames: result.toolCalls.map((c) => c.name),
        messages: localMessages.length,
        finishReason: 'tool_calls',
      });
    }

    if (!exitedEarly) {
      stopReason = 'max_turns';
      const note = MAX_TURNS_NOTE(maxTurns);
      fullContent += note;
      emit({ type: 'chunk', text: note });
      emit({ type: 'done' });
      log.info(`execute(FC) stopped at maxTurns=${maxTurns}`, {
        ...this.logBaseMeta('fc'),
        turns,
        maxTurns,
        finishReason: 'max_turns',
      });
    }

    log.info(`execute(FC) done: ${fullContent.length} chars, ${turns} turns, ${toolCalls.length} tool calls, ${Date.now() - executeStartMs}ms`, {
      ...this.logBaseMeta('fc'),
      contentLen: fullContent.length,
      turns,
      toolCalls: toolCalls.length,
      stopReason,
    });

    return {
      agentId: this.definition.id,
      content: fullContent,
      turns,
      toolCalls,
      stopReason,
    };
  }

  /** 执行流式对话，自动多轮 + 工具调用 */
  async executeStream(
    messages: LLMMessage[],
    onEvent?: AgentEventCallback,
    onToolCall?: ToolCallReportCallback,
    signal?: AbortSignal
  ): Promise<AgentResult> {
    if (
      this.effectiveProtocol() === 'fc' &&
      this.provider.chatStreamWithTools
    ) {
      return this.executeStreamWithFunctionCalling(messages, onEvent, onToolCall, signal);
    }
    const emit = (e: AgentEvent) => onEvent?.(e);
    const maxTurns = resolveMaxTurns(this.definition.maxTurns);

    const localMessages: { role: string; content: string }[] = messages.map(m => ({ ...m }));

    const executeStartMs = Date.now();
    let fullContent = '';
    let thinkingContent = '';
    const toolCalls: { type: string; params: Record<string, string> }[] = [];
    let turns = 0;
    let stopReason: NonNullable<AgentResult['stopReason']> = 'stop';
    let exitedEarly = false;

    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal?.aborted) {
        emit({ type: 'done' });
        stopReason = 'aborted';
        exitedEarly = true;
        const abortNote = '\n\n*[已取消]*';
        fullContent += abortNote;
        log.info(`Turn ${turns}/${maxTurns}: aborted by signal`, {
          ...this.logBaseMeta(),
          turn: turns,
          maxTurns,
          finishReason: 'aborted',
        });
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
      }, { signal });

      // 累加 thinking 内容到整轮
      if (turnThinking) thinkingContent += turnThinking;

      if (!response) {
        emit({ type: 'done' });
        stopReason = 'empty';
        exitedEarly = true;
        log.info(`Turn ${turns}/${maxTurns}: empty stream response, stopping`, {
          ...this.logBaseMeta(),
          turn: turns,
          maxTurns,
          finishReason: 'empty',
        });
        break;
      }

      const parsedTools = parseToolCalls(response, this.tools);

      if (parsedTools.length > 0) {
        fullContent += response;

        for (const tool of parsedTools) {
          toolCalls.push(tool);
          emit({ type: 'tool_start', toolType: tool.type, toolLabel: tool.params.path || tool.params.pattern || '', toolParams: tool.params });

          const { result, durationMs, fileChanges } = await this.executeToolTimed(tool, signal);

          emit({ type: 'tool_result', toolType: tool.type, text: result });
          fullContent += `\n\n**[Tool: ${tool.type}]**\n${result}\n`;
          emit({ type: 'tool_end', toolType: tool.type, durationMs, fileChanges });

          onToolCall?.({
            type: tool.type,
            params: { ...tool.params },
            result,
            durationMs,
            agentId: this.definition.id,
            fileChanges,
          });

          localMessages.push({
            role: 'assistant',
            content: this.serializeToolCall(tool),
          });
          localMessages.push({ role: 'user', content: `Tool result:\n${result}` });
        }

        log.info(`Turn ${turns}/${maxTurns}: ${parsedTools.length} tool(s), ${Date.now() - turnStartMs}ms`, {
          ...this.logBaseMeta(),
          turn: turns,
          maxTurns,
          toolNames: parsedTools.map(t => t.type),
          messages: localMessages.length,
          finishReason: 'tool_calls',
        });

        continue;
      }

      fullContent += response;
      if (fullContent.length > 50000) {
        emit({ type: 'chunk', text: '\n\n*[响应过长，已截断]*' });
        fullContent += '\n\n*[响应过长，已截断]*';
      }
      log.info(`Turn ${turns}/${maxTurns}: final response, ${response.length} chars, ${Date.now() - turnStartMs}ms`, {
        ...this.logBaseMeta(),
        turn: turns,
        maxTurns,
        contentLen: response.length,
        finishReason: 'stop',
      });
      stopReason = 'stop';
      exitedEarly = true;
      emit({ type: 'done' });
      break;
    }

    if (!exitedEarly) {
      stopReason = 'max_turns';
      const note = MAX_TURNS_NOTE(maxTurns);
      fullContent += note;
      emit({ type: 'chunk', text: note });
      emit({ type: 'done' });
      log.info(`executeStream stopped at maxTurns=${maxTurns}`, {
        ...this.logBaseMeta(),
        turns,
        maxTurns,
        finishReason: 'max_turns',
      });
    }

    log.info(`executeStream done: ${fullContent.length} chars, thinking=${thinkingContent.length} chars, turns=${turns}, ${toolCalls.length} tool calls, ${Date.now() - executeStartMs}ms`, {
      ...this.logBaseMeta(),
      contentLen: fullContent.length,
      thinkingLen: thinkingContent.length,
      turns,
      toolCalls: toolCalls.length,
      stopReason,
    });
    return {
      agentId: this.definition.id,
      content: fullContent,
      turns,
      toolCalls,
      thinking: thinkingContent,
      stopReason,
    };
  }

  /** 流式 function calling 循环（OpenAI tools delta 累积） */
  private async executeStreamWithFunctionCalling(
    messages: LLMMessage[],
    onEvent?: AgentEventCallback,
    onToolCall?: ToolCallReportCallback,
    signal?: AbortSignal,
  ): Promise<AgentResult> {
    const emit = (e: AgentEvent) => onEvent?.(e);
    const chatStreamWithTools = this.provider.chatStreamWithTools!;
    const openAiTools: OpenAIFunctionDefinition[] = this.tools.listOpenAITools();
    const maxTurns = resolveMaxTurns(this.definition.maxTurns);

    const localMessages: LLMChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const executeStartMs = Date.now();
    let fullContent = '';
    let thinkingContent = '';
    const toolCalls: { type: string; params: Record<string, string> }[] = [];
    let turns = 0;
    let stopReason: NonNullable<AgentResult['stopReason']> = 'stop';
    let exitedEarly = false;

    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal?.aborted) {
        emit({ type: 'done' });
        stopReason = 'aborted';
        exitedEarly = true;
        const abortNote = '\n\n*[已取消]*';
        fullContent += abortNote;
        log.info(`Turn ${turns}/${maxTurns}: aborted by signal`, {
          ...this.logBaseMeta('fc'),
          turn: turns,
          maxTurns,
          finishReason: 'aborted',
        });
        break;
      }
      turns = turn + 1;
      const turnStartMs = Date.now();
      let turnThinking = '';

      let result: ChatWithToolsResult;
      try {
        result = await chatStreamWithTools(localMessages, openAiTools, (type, text) => {
          if (type === 'thinking') {
            turnThinking += text;
            emit({ type: 'thinking', text });
          } else if (type === 'content') {
            emit({ type: 'chunk', text });
          }
        }, { signal });
        this.noteFcSuccess();
      } catch (e: any) {
        this.noteFcFailure(e);
        if (isAbortError(e)) {
          stopReason = 'aborted';
          exitedEarly = true;
          const abortNote = '\n\n*[已取消]*';
          fullContent += abortNote;
          emit({ type: 'chunk', text: abortNote });
          emit({ type: 'done' });
          log.info(`FC stream aborted on turn ${turns}`, {
            ...this.logBaseMeta('fc'),
            turn: turns,
            finishReason: 'aborted',
          });
          break;
        }
        throw e;
      }
      if (turnThinking) thinkingContent += turnThinking;

      if (result.content) {
        fullContent += result.content;
      }

      if (result.toolCalls.length === 0) {
        emit({ type: 'done' });
        stopReason = 'stop';
        exitedEarly = true;
        log.info(
          `Turn ${turns}/${maxTurns}: final response, ${result.content.length} chars, ${Date.now() - turnStartMs}ms`,
          {
            ...this.logBaseMeta('fc'),
            turn: turns,
            maxTurns,
            contentLen: result.content.length,
            finishReason: result.finishReason || 'stop',
          },
        );
        break;
      }

      localMessages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: c.arguments },
        })),
      });

      for (const call of result.toolCalls) {
        let params: Record<string, string>;
        try {
          params = toolArgsToStringParams(call.arguments);
        } catch (e: any) {
          const errText = `Error: ${e.message}`;
          toolCalls.push({ type: call.name, params: {} });
          emit({ type: 'tool_start', toolType: call.name, toolLabel: '', toolParams: {} });
          emit({ type: 'tool_result', toolType: call.name, text: errText });
          fullContent += `\n\n**[Tool: ${call.name}]**\n${errText}\n`;
          emit({ type: 'tool_end', toolType: call.name, durationMs: 0 });
          onToolCall?.({
            type: call.name,
            params: {},
            result: errText,
            durationMs: 0,
            agentId: this.definition.id,
          });
          localMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: errText,
          });
          continue;
        }

        const parsed: ParsedTool = { type: call.name, params };
        toolCalls.push(parsed);
        emit({
          type: 'tool_start',
          toolType: call.name,
          toolLabel: params.path || params.pattern || '',
          toolParams: params,
        });
        const timed = await this.executeToolTimed(parsed, signal);
        emit({ type: 'tool_result', toolType: call.name, text: timed.result });
        fullContent += `\n\n**[Tool: ${call.name}]**\n${timed.result}\n`;
        emit({ type: 'tool_end', toolType: call.name, durationMs: timed.durationMs, fileChanges: timed.fileChanges });
        onToolCall?.({
          type: call.name,
          params: { ...params },
          result: timed.result,
          durationMs: timed.durationMs,
          agentId: this.definition.id,
          fileChanges: timed.fileChanges,
        });
        localMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: timed.result,
        });
      }

      log.info(
        `Turn ${turns}/${maxTurns}: ${result.toolCalls.length} tool(s), ${Date.now() - turnStartMs}ms`,
        {
          ...this.logBaseMeta('fc'),
          turn: turns,
          maxTurns,
          toolNames: result.toolCalls.map((c) => c.name),
          messages: localMessages.length,
          finishReason: 'tool_calls',
        },
      );
    }

    if (!exitedEarly) {
      stopReason = 'max_turns';
      const note = MAX_TURNS_NOTE(maxTurns);
      fullContent += note;
      emit({ type: 'chunk', text: note });
      emit({ type: 'done' });
      log.info(`executeStream(FC) stopped at maxTurns=${maxTurns}`, {
        ...this.logBaseMeta('fc'),
        turns,
        maxTurns,
        finishReason: 'max_turns',
      });
    }

    log.info(
      `executeStream(FC) done: ${fullContent.length} chars, thinking=${thinkingContent.length}, turns=${turns}, ${toolCalls.length} tool calls, ${Date.now() - executeStartMs}ms`,
      {
        ...this.logBaseMeta('fc'),
        contentLen: fullContent.length,
        thinkingLen: thinkingContent.length,
        turns,
        toolCalls: toolCalls.length,
        stopReason,
      },
    );

    return {
      agentId: this.definition.id,
      content: fullContent,
      turns,
      toolCalls,
      thinking: thinkingContent,
      stopReason,
    };
  }

  /** 执行工具并计时,返回结果与耗时。工具内部抛错统一转为 Error 文本,不中断整轮。 */
  private async executeToolTimed(tool: ParsedTool, signal?: AbortSignal): Promise<{ result: string; durationMs: number; fileChanges?: FileChangeMeta[] }> {
    const impl = this.tools.get(tool.type);
    if (!impl) {
      log.warn(`Unknown tool: ${tool.type}`);
      return { result: `Unknown tool: ${tool.type}`, durationMs: 0 };
    }
    if (signal?.aborted) {
      return { result: 'Error: aborted before tool execution', durationMs: 0 };
    }

    const approved = await this.gateApproval(impl, tool.params);
    if (approved !== true) {
      return { result: approved, durationMs: 0 };
    }

    const keyParams = Object.entries(tool.params)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v.length > 60 ? v.slice(0, 60) + '...' : v}`)
      .join(', ');
    log.info(`Tool call: ${tool.type}${keyParams ? ` (${keyParams})` : ''}`, {
      ...this.logBaseMeta(),
      toolName: tool.type,
    });
    const startMs = Date.now();
    let result: string;
    const fileChanges: FileChangeMeta[] = [];
    try {
      result = await impl.execute(tool.params, {
        workspaceRoot: this.workspaceRoot,
        readFileState: this.readFileState,
        onFileChange: (meta) => {
          fileChanges.push(meta);
        },
      });
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      result = `Error: ${msg}`;
      log.warn(`Tool threw: ${tool.type}: ${msg}`, {
        ...this.logBaseMeta(),
        toolName: tool.type,
        error: msg,
      });
    }
    const durationMs = Date.now() - startMs;
    log.info(`Tool done: ${tool.type} (${durationMs}ms, ${result.length} chars)`, {
      ...this.logBaseMeta(),
      toolName: tool.type,
      durationMs,
      resultLen: result.length,
      fileChanges: fileChanges.length || undefined,
    });
    return { result, durationMs, fileChanges: fileChanges.length ? fileChanges : undefined };
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
