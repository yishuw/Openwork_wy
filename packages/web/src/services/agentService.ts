import { i18n } from '../locales';
import { webAgentLog } from './logger';

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
}

/** 对话消息 */
export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/** SSE 流式事件类型 */
export interface StreamEvent {
  type: 'tool_start' | 'tool_end' | 'tool_result' | 'thinking_start' | 'thinking_end';
  message?: string;
  content?: string;
}

export function createAgentService(baseUrl = DEFAULT_BASE_URL) {
  return {
    async sendMessage(message: string, context: Record<string, unknown>, config: AgentConfig): Promise<AgentMessage> {
      const body: Record<string, unknown> = { message, context, config };
      if (context.sessionId) body.sessionId = context.sessionId;
      const res = await fetch(`${baseUrl}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${i18n.global.t('errors.apiError')}: ${res.status}`);
      return res.json();
    },

    async streamMessage(
      message: string,
      context: Record<string, unknown>,
      config: AgentConfig,
      onChunk: (type: 'thinking' | 'content', text: string) => void,
      onEvent?: (event: StreamEvent) => void,
      options?: { signal?: AbortSignal }
    ): Promise<AgentMessage> {
      const body: Record<string, unknown> = { message, context, config };
      if (context.workspaceRoot) {
        body.workspaceRoot = context.workspaceRoot;
      }
      if (context.workspaceId) {
        body.workspaceId = context.workspaceId;
      }
      if (context.sessionId) {
        body.sessionId = context.sessionId;
      }
      const res = await fetch(`${baseUrl}/api/agent/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
              onEvent({ type: 'tool_result', content: data.tool_result });
            }

            if (data.thinking) {
              if (!thinkingActive) {
                thinkingActive = true;
                if (onEvent) onEvent({ type: 'thinking_start' });
              }
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
        timestamp: Date.now(),
      };
    },
  };
}
