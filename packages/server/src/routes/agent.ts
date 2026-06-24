import { Router, Request, Response } from 'express';
import {
  AgentRuntime,
  type AgentRuntimeConfig,
  type AgentRuntimeEvent,
  type AgentContext,
  type IDESnapshot,
} from '@vibeeditor/agent';
import { createLogger } from '@vibeeditor/agent';
import { loadEnabledMcpServers } from './mcp';
import type { WorkspaceManager } from '../workspace/manager';
import type { LLMGateway } from '@vibeeditor/agent';

const log = createLogger('AgentRouter');

function buildRuntimeConfig(body: Record<string, unknown>, configDir: string, llmGateway: LLMGateway, workspaceRoot?: string): AgentRuntimeConfig {
  const cfg = (body.config as any) || body;
  const mode = (cfg.mode || 'plan') as 'build' | 'plan';
  const providerId = cfg.providerId as string | undefined;

  const provider = providerId
    ? llmGateway.getProvider(providerId)
    : llmGateway.getActiveProvider();

  return {
    mode,
    provider: {
      apiUrl: provider?.apiUrl || '',
      apiKey: provider?.apiKey || '',
      model: provider?.model || '',
    },
    systemPrompt: cfg.systemPrompt,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    workspaceRoot: workspaceRoot || process.cwd(),
    mcpServers: mode === 'build' ? loadEnabledMcpServers(configDir) : undefined,
    memoryTokenBudget: cfg.memoryTokenBudget ? Number(cfg.memoryTokenBudget) : undefined,
  };
}

interface StreamRequestBody {
  message: string;
  /** build 模式:IDE 快照(激活文件 + 其他 tab 路径 + 文件树 + 光标/选区) */
  ideSnapshot?: IDESnapshot;
  /** plan 模式:沿用旧 AgentContext */
  context?: AgentContext;
  workspaceRoot?: string;
  workspaceId?: string;
  sessionId?: string;
  config?: Record<string, unknown>;
}

export function createAgentRouter(configDir: string, workspaceManager: WorkspaceManager, llmGateway: LLMGateway) {
  const router = Router();

  async function getRuntime(reqBody: Record<string, unknown>, workspaceRootOverride?: string): Promise<AgentRuntime> {
    const body = reqBody as unknown as StreamRequestBody;
    // Reuse workspace-cached runtime when workspaceId is provided
    if (body.workspaceId) {
      const existing = workspaceManager.getRuntime(body.workspaceId);
      if (existing) return existing; // REUSE — MCP already connected

      // Workspace not in memory (server restart / hot reload).
      // Re-open from disk to restore sessions + workspace data.
      const wsRoot = workspaceRootOverride ?? body.workspaceRoot;
      if (wsRoot) {
        try {
          log.info(`Workspace ${body.workspaceId} not in memory, re-opening from ${wsRoot}`);
          const data = await workspaceManager.openWorkspace(wsRoot, llmGateway);
          // openWorkspace generates a new workspaceId if the old workspace.json
          // doesn't have one. Use the returned workspaceId going forward.
          // But the frontend still sends the old workspaceId — so we need to
          // also make the old workspaceId work. The simplest way: if the
          // re-opened workspace has a different ID, just use its runtime
          // directly (the old ID is now stale but the runtime is fresh).
          const runtime = workspaceManager.getRuntime(data.workspaceId);
          if (runtime) return runtime;
        } catch (e: any) {
          log.warn(`Re-open workspace failed: ${e.message}`);
        }
      }

      // Last resort: create a bare runtime (no restored sessions, no persistence)
      const fallbackRoot = wsRoot || process.cwd();
      const runtime = new AgentRuntime(buildRuntimeConfig(reqBody, configDir, llmGateway, fallbackRoot));
      workspaceManager.cacheRuntime(body.workspaceId, runtime);
      return runtime;
    }
    // No workspace: create throwaway runtime
    const wsRoot = workspaceRootOverride || body.workspaceRoot;
    return new AgentRuntime(buildRuntimeConfig(reqBody, configDir, llmGateway, wsRoot));
  }

  router.post('/chat', async (req: Request, res: Response) => {
    try {
      const { message, context, ideSnapshot, sessionId } = req.body as StreamRequestBody;
      if (!message) {
        res.status(400).json({ error: 'message is required' });
        return;
      }

      const runtime = await getRuntime(req.body);
      if (req.body.workspaceId) {
        const latestMcpServers = loadEnabledMcpServers(configDir);
        await runtime.reinitialize(latestMcpServers.length > 0 ? latestMcpServers : undefined);
      }

      // build 模式:走 ideSnapshot;plan 模式:走 context
      const payload = ideSnapshot ?? context;
      const result = await runtime.chat(message, payload as IDESnapshot | AgentContext, sessionId || 'default');

      // 流结束后同步 session memory 到 workspace.json
      if (req.body.workspaceId && sessionId) {
        await workspaceManager.persistSessionMemory(req.body.workspaceId, sessionId);
      }

      res.json({
        id: `agent_${Date.now()}`,
        role: 'assistant',
        content: result.content,
        thinking: result.thinking,
        timestamp: Date.now(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/stream', async (req: Request, res: Response) => {
    const body = req.body as StreamRequestBody;
    const { message, context, ideSnapshot, workspaceRoot, workspaceId, sessionId } = body;
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const reqLog = log.child({ requestId, mode: body.config?.mode });
    reqLog.info(`Stream request started (workspaceId=${workspaceId || 'none'})`);

    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const writeSSE = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const runtime = await getRuntime(req.body, workspaceRoot);
    const startMs = Date.now();

    if (body.workspaceId) {
      const latestMcpServers = loadEnabledMcpServers(configDir);
      await runtime.reinitialize(latestMcpServers.length > 0 ? latestMcpServers : undefined);
    }

    const keepAlive = setInterval(() => { res.write(': heartbeat\n\n'); }, 15000);

    try {
      const mcpStatus = runtime.mcpStatus;
      if (mcpStatus.serverCount > 0) {
        await runtime.initialize();
        reqLog.info(`MCP initialized: ${mcpStatus.serverCount} server(s), ${mcpStatus.toolCount} tool(s)`);
        writeSSE({ tool_start: { toolType: 'mcp', toolLabel: `MCP: ${mcpStatus.serverCount} server(s), ${mcpStatus.toolCount} tool(s)`, toolParams: {} } });
      }

      reqLog.info('Stream started');
      // build 模式:走 ideSnapshot;plan 模式:走 context
      const payload = ideSnapshot ?? context;
      const result = await runtime.chatStream(
        message,
        payload as IDESnapshot | AgentContext,
        (e: AgentRuntimeEvent) => {
          switch (e.type) {
            case 'chunk':
              writeSSE({ chunk: e.text });
              break;
            case 'thinking':
              writeSSE({ thinking: e.text });
              break;
            case 'tool_start':
              writeSSE({ tool_start: { toolType: e.toolName, toolLabel: e.toolLabel || '', toolParams: e.toolParams || {} } });
              break;
            case 'tool_end':
              writeSSE({ tool_end: { toolType: e.toolName, durationMs: e.durationMs || 0 } });
              break;
            case 'tool_result':
              writeSSE({ tool_result: { name: e.toolName, content: e.text } });
              break;
            case 'done':
              break;
            case 'error':
              writeSSE({ error: e.error });
              break;
          }
        },
        undefined,
        sessionId || 'default'
      );

      reqLog.info(`Stream done: ${Date.now() - startMs}ms, ${result.content.length} chars, ${result.toolCalls.length} tool calls`);

      // 流结束 → 立即把 session memory 序列化并写入 workspace.json
      if (workspaceId && sessionId) {
        try {
          await workspaceManager.persistSessionMemory(workspaceId, sessionId);
        } catch (e: any) {
          reqLog.warn(`persistSessionMemory failed: ${e.message}`);
        }
      }

      writeSSE({ done: true, toolCalls: result.toolCalls.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reqLog.error(`Stream error: ${msg}`);
      writeSSE({ error: msg });
      writeSSE({ done: true });
    } finally {
      clearInterval(keepAlive);
      if (!body.workspaceId) {
        try { await runtime.dispose(); } catch { /* ignore */ }
      }
    }
  });

  return router;
}
