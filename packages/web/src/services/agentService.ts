import { i18n } from '../locales';
import { webAgentLog } from './logger';
import type { IDESnapshot } from '@vibeeditor/agent';

declare const __SERVER_PORT__: number;

const DEFAULT_BASE_URL: string = typeof __SERVER_PORT__ !== 'undefined'
  ? `http://localhost:${__SERVER_PORT__}`
  : '';


/** Agent 运行配置 */
export interface AgentConfig {
  mode: 'build' | 'plan';
  providerId?: string;
  model?: string;
  apiUrl?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  memoryTokenBudget?: number;
}

/** 对话消息 */
export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  timestamp: number;
}

/** SSE 流式事件类型 */
export interface StreamEvent {
  type: 'tool_start' | 'tool_end' | 'tool_result' | 'thinking_start' | 'thinking_end';
  message?: string;
  content?: string;
}

/** 流式请求 body —— 与 server 端 StreamRequestBody 对齐 */
export interface StreamRequestBody {
  message: string;
  ideSnapshot?: IDESnapshot;
  workspaceRoot?: string;
  workspaceId?: string;
  sessionId?: string;
  config?: AgentConfig;
}

export function createAgentService(baseUrl = DEFAULT_BASE_URL) {
  return {
    async sendMessage(
      message: string,
      body: Partial<StreamRequestBody>,
      config: AgentConfig,
    ): Promise<AgentMessage> {
      const fullBody: StreamRequestBody = {
        message,
        ideSnapshot: body.ideSnapshot,
        workspaceRoot: body.workspaceRoot,
        workspaceId: body.workspaceId,
        sessionId: body.sessionId,
        config,
      };
      const res = await fetch(`${baseUrl}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullBody),
      });
      if (!res.ok) throw new Error(`${i18n.global.t('errors.apiError')}: ${res.status}`);
      return res.json();
    },

    async streamMessage(
      message: string,
      body: Partial<StreamRequestBody>,
      config: AgentConfig,
      onChunk: (type: 'thinking' | 'content', text: string) => void,
      onEvent?: (event: StreamEvent) => void,
      options?: { signal?: AbortSignal },
    ): Promise<AgentMessage> {
      const fullBody: StreamRequestBody = {
        message,
        ideSnapshot: body.ideSnapshot,
        workspaceRoot: body.workspaceRoot,
        workspaceId: body.workspaceId,
        sessionId: body.sessionId,
        config,
      };
      const res = await fetch(`${baseUrl}/api/agent/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullBody),
        signal: options?.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        const msg = `${i18n.global.t('errors.apiError')} ${res.status}: ${errText}`;
        webAgentLog.error(`streamMessage fetch error: ${msg}`);
        throw new Error(msg);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error(i18n.global.t('errors.streamNotAvailable'));

      const decoder = new TextDecoder();
      let fullContent = '';
      let fullThinking = '';
      let buffer = '';
      let thinkingActive = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() || '';

        let streamDone = false;
        for (const line of parts) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) throw new Error(data.error);
            if (data.done) {
              streamDone = true;
              break;
            }

            if (data.tool_start && onEvent) {
              onEvent({ type: 'tool_start', message: data.tool_start });
            } else if (data.tool_end && onEvent) {
              onEvent({ type: 'tool_end', message: data.tool_end });
            } else if (data.tool_result && onEvent) {
              onEvent({ type: 'tool_result', content: typeof data.tool_result === 'string' ? data.tool_result : (data.tool_result?.content || '') });
            }

            if (data.thinking) {
              if (!thinkingActive) {
                thinkingActive = true;
                if (onEvent) onEvent({ type: 'thinking_start' });
              }
              fullThinking += data.thinking;
              onChunk('thinking', data.thinking);
            }

            if (data.chunk) {
              if (thinkingActive) {
                thinkingActive = false;
                if (onEvent) onEvent({ type: 'thinking_end' });
              }
              fullContent += data.chunk;
              onChunk('content', data.chunk);
            }
          } catch {
            // skip unparseable SSE lines
          }
        }
        if (streamDone) break;
      }

      if (thinkingActive && onEvent) {
        onEvent({ type: 'thinking_end' });
      }

      return {
        id: `agent_${Date.now()}`,
        role: 'assistant',
        content: fullContent,
        thinking: fullThinking,
        timestamp: Date.now(),
      };
    },
  };
}
