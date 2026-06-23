import type { AgentDefinition, AgentContext, AgentResult, AgentConfig } from './types/agent';
import type { ITool } from './types/tool';
import { ToolRegistry } from './tool-registry';
import { createDefaultTools } from './tools/index';
import { parseToolCalls, type ParsedTool } from './parser';
import { createOpenAILLMProvider } from './llm/openai-client';
import { createLogger } from './logger';

const log = createLogger('Agent');

/** Agent 运行事件 */
export interface AgentEvent {
  type: 'chunk' | 'thinking' | 'tool_start' | 'tool_end' | 'tool_result' | 'done';
  text?: string;
  toolType?: string;
  toolLabel?: string;
}

export type AgentEventCallback = (event: AgentEvent) => void;

const DEFAULT_MAX_TURNS = 15;

export class Agent {
  readonly definition: AgentDefinition;
  private provider: ReturnType<typeof createOpenAILLMProvider>;
  private workspaceRoot: string;
  private tools: ToolRegistry;

  constructor(definition: AgentDefinition, config: AgentConfig, workspaceRoot: string, extraTools?: ITool[]) {
    this.definition = definition;
    this.provider = createOpenAILLMProvider(config);
    this.workspaceRoot = workspaceRoot;
    this.tools = new ToolRegistry();
    for (const tool of createDefaultTools()) {
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

  /** 执行单次对话，自动多轮 + 工具调用 */
  async execute(
    message: string,
    context: AgentContext,
    onEvent?: AgentEventCallback
  ): Promise<AgentResult> {
    const emit = (e: AgentEvent) => onEvent?.(e);
    const maxTurns = this.definition.maxTurns ?? DEFAULT_MAX_TURNS;

    const messages: { role: string; content: string }[] = [];
    messages.push({ role: 'system', content: this.definition.systemPrompt });

    // 附加已注册工具的用法说明（含动态注册的 MCP 工具）
    const toolsSection = this.tools.buildSystemPromptSection();
    if (toolsSection) {
      messages.push({ role: 'system', content: toolsSection });
    }

    messages.push({ role: 'system', content: `## Workspace Root\n${this.workspaceRoot}` });

    if (context.openFiles?.length) {
      const parts = ['## Currently Open Files'];
      for (const f of context.openFiles) {
        parts.push(`\n### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``);
      }
      messages.push({ role: 'system', content: parts.join('\n') });
    }

    if (context.fileTree?.length) {
      messages.push({ role: 'system', content: '## Project File Tree\n' + context.fileTree.join('\n') });
    }

    if (context.cursorPosition) {
      messages.push({
        role: 'system',
        content: `Cursor at ${context.cursorPosition.file}:${context.cursorPosition.line}:${context.cursorPosition.column}`,
      });
    }

    if (context.selection?.text) {
      messages.push({
        role: 'system',
        content: `Selected text in ${context.selection.file} (lines ${context.selection.startLine}-${context.selection.endLine}):\n\`\`\`\n${context.selection.text}\n\`\`\``,
      });
    }

    for (const m of context.conversationHistory || []) {
      messages.push({ role: m.role, content: m.content });
    }

    messages.push({ role: 'user', content: message });

    const executeStartMs = Date.now();
    let fullContent = '';
    const toolCalls: { type: string; params: Record<string, string> }[] = [];
    let turns = 0;

    for (let turn = 0; turn < maxTurns; turn++) {
      turns = turn + 1;
      const turnStartMs = Date.now();
      const response = await this.provider.chat(messages);

      if (!response) {
        emit({ type: 'done' });
        log.info(`Turn ${turns}/${maxTurns}: empty response, stopping`);
        break;
      }

      const parsedTools = parseToolCalls(response, this.tools);

      if (parsedTools.length > 0) {
        let textBefore = response;
        for (const t of parsedTools) {
          // 同时剔除自闭合和带 body 的标签,避免把工具语法塞回对话上下文
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
          emit({ type: 'tool_start', toolType: tool.type, toolLabel: tool.params.path || tool.params.pattern || '' });

          const result = await this.executeTool(tool);

          emit({ type: 'tool_result', toolType: tool.type, text: result });
          fullContent += `\n**[Tool: ${tool.type}]**\n${result}\n`;
          emit({ type: 'tool_end', toolType: tool.type });

          messages.push({
            role: 'assistant',
            content: this.serializeToolCall(tool),
          });
          messages.push({ role: 'user', content: `Tool result:\n${result}` });
        }

        log.info(`Turn ${turns}/${maxTurns}: ${parsedTools.length} tool(s), ${Date.now() - turnStartMs}ms`, {
          agentId: this.definition.id,
          turn: turns,
          tools: parsedTools.map(t => t.type),
          messages: messages.length,
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
    message: string,
    context: AgentContext,
    onEvent?: AgentEventCallback,
    signal?: AbortSignal
  ): Promise<AgentResult> {
    const emit = (e: AgentEvent) => onEvent?.(e);
    const maxTurns = this.definition.maxTurns ?? DEFAULT_MAX_TURNS;

    const messages: { role: string; content: string }[] = [];
    messages.push({ role: 'system', content: this.definition.systemPrompt });

    // 附加已注册工具的用法说明（含动态注册的 MCP 工具）
    const toolsSection = this.tools.buildSystemPromptSection();
    if (toolsSection) {
      messages.push({ role: 'system', content: toolsSection });
    }

    messages.push({ role: 'system', content: `## Workspace Root\n${this.workspaceRoot}` });

    if (context.openFiles?.length) {
      const parts = ['## Currently Open Files'];
      for (const f of context.openFiles) {
        parts.push(`\n### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``);
      }
      messages.push({ role: 'system', content: parts.join('\n') });
    }

    if (context.fileTree?.length) {
      messages.push({ role: 'system', content: '## Project File Tree\n' + context.fileTree.join('\n') });
    }

    if (context.cursorPosition) {
      messages.push({
        role: 'system',
        content: `Cursor at ${context.cursorPosition.file}:${context.cursorPosition.line}:${context.cursorPosition.column}`,
      });
    }

    if (context.selection?.text) {
      messages.push({
        role: 'system',
        content: `Selected text in ${context.selection.file} (lines ${context.selection.startLine}-${context.selection.endLine}):\n\`\`\`\n${context.selection.text}\n\`\`\``,
      });
    }

    for (const m of context.conversationHistory || []) {
      messages.push({ role: m.role, content: m.content });
    }

    messages.push({ role: 'user', content: message });

    const executeStartMs = Date.now();
    let fullContent = '';
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

      const response = await this.provider.chatStream(messages, (type, text) => {
        if (type === 'thinking') {
          emit({ type: 'thinking', text });
        } else if (type === 'content') {
          emit({ type: 'chunk', text });
        }
      });

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
          emit({ type: 'tool_start', toolType: tool.type, toolLabel: tool.params.path || tool.params.pattern || '' });

          const result = await this.executeTool(tool);

          emit({ type: 'tool_result', toolType: tool.type, text: result });
          fullContent += `\n\n**[Tool: ${tool.type}]**\n${result}\n`;
          emit({ type: 'tool_end', toolType: tool.type });

          messages.push({
            role: 'assistant',
            content: this.serializeToolCall(tool),
          });
          messages.push({ role: 'user', content: `Tool result:\n${result}` });
        }

        log.info(`Turn ${turns}/${maxTurns}: ${parsedTools.length} tool(s), ${Date.now() - turnStartMs}ms`, {
          agentId: this.definition.id,
          turn: turns,
          tools: parsedTools.map(t => t.type),
          messages: messages.length,
        });

        continue;
      }

      // 对于没有工具调用的最终轮次，内容已经在流式回调中发射过了
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

    const hasEdit = /<edit\s/i.test(fullContent);
    log.info(`executeStream done: ${fullContent.length} chars, hasEdit=${hasEdit}, turns=${turns}, ${toolCalls.length} tool calls, ${Date.now() - executeStartMs}ms`, {
      agentId: this.definition.id,
      contentLen: fullContent.length,
      hasEdit,
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

  private async executeTool(tool: ParsedTool): Promise<string> {
    const impl = this.tools.get(tool.type);
    if (!impl) {
      log.warn(`Unknown tool: ${tool.type}`);
      return `Unknown tool: ${tool.type}`;
    }
    const keyParams = Object.entries(tool.params)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v.length > 60 ? v.slice(0, 60) + '...' : v}`)
      .join(', ');
    log.info(`Tool call: ${tool.type}${keyParams ? ` (${keyParams})` : ''}`);
    const startMs = Date.now();
    const result = await impl.execute(tool.params, { workspaceRoot: this.workspaceRoot });
    log.info(`Tool done: ${tool.type} (${Date.now() - startMs}ms, ${result.length} chars)`);
    return result;
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
        // content 模式下 content 走 body;children 模式下子标签参数走 body
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
