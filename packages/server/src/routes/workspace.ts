import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { FileEntry } from '../fs/types';
import { WorkspaceManager } from '../workspace/manager';
import type { LLMGateway } from '@openwork/agent';
import { createLogger, LOG_CATEGORY } from '@openwork/agent';

const log = createLogger(LOG_CATEGORY.WORKSPACE);

function getSystemRoots(): string[] {
  if (process.platform === 'win32') {
    const roots: string[] = [];
    for (let c = 'A'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
      const drive = `${String.fromCharCode(c)}:\\`;
      try {
        const fsSync = require('fs');
        fsSync.accessSync(drive);
        roots.push(drive);
      } catch {
        /* drive not available */
      }
    }
    return roots;
  }
  return ['/'];
}

function toFileEntry(absPath: string, name: string, isDir: boolean, size?: number, mtime?: number): FileEntry {
  return {
    name,
    path: absPath.replace(/\\/g, '/'),
    isDirectory: isDir,
    size,
    modifiedAt: mtime,
  };
}

export function createWorkspaceRouter(manager: WorkspaceManager, llmGateway: LLMGateway) {
  const router = Router();

  /**
   * 确保 workspace 在内存中。若 server 重启导致 WorkspaceManager 丢失了该 workspace，
   * 且调用方提供了 rootPath，则自动从磁盘重新打开（复用 agent 路由 getRuntime 的恢复模式）。
   *
   * @returns true 表示 workspace 可用（原本就在或已恢复）
   */
  async function ensureWorkspace(workspaceId: string, rootPath?: string): Promise<boolean> {
    if (manager.getWorkspaceData(workspaceId)) return true;

    // Workspace 不在内存 —— 尝试从磁盘恢复
    if (rootPath) {
      try {
        log.info(`Workspace ${workspaceId} not in memory, re-opening from ${rootPath}`);
        await manager.openWorkspace(rootPath, llmGateway);
        // openWorkspace 可能生成新的 workspaceId,但原 workspaceId 对应的 runtime
        // 也在 openWorkspace 内部被缓存。检查任意一个。
        const data = manager.getWorkspaceData(workspaceId);
        if (data) {
          log.info(`Workspace ${workspaceId} re-opened successfully`);
          return true;
        }
        // 如果旧 workspaceId 没命中,尝试获取 openWorkspace 返回的 data.workspaceId
        // (不是必需的 —— openWorkspace 内部把 runtime 存在 workspaceId 下,
        //  而 workspaceId 来自 existingData 或新生成的)
      } catch (e: any) {
        log.warn(`Failed to re-open workspace ${workspaceId}: ${e.message}`);
      }
    }
    return false;
  }

  router.get('/roots', async (_req: Request, res: Response) => {
    try {
      const roots = getSystemRoots();
      const result = roots.map(r => ({
        name: r === '/' ? '/' : r,
        path: r.replace(/\\/g, '/'),
        isDirectory: true,
      }));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // TODO: 后续 ServerWeb 模式下可通过配置文件限制浏览范围
  router.get('/browse', async (req: Request, res: Response) => {
    try {
      let browsePath = (req.query.path as string) || '/';
      if (process.platform === 'win32' && browsePath === '/') {
        browsePath = 'C:\\';
      }
      const absPath = path.resolve(browsePath);
      const parent = path.dirname(absPath);

      const entries = await fs.readdir(absPath, { withFileTypes: true });
      const result: FileEntry[] = [];

      for (const entry of entries) {
        const entryPath = path.join(absPath, entry.name);
        try {
          const stat = await fs.stat(entryPath);
          result.push(toFileEntry(entryPath, entry.name, entry.isDirectory(), stat.size, stat.mtimeMs));
        } catch {
          result.push(toFileEntry(entryPath, entry.name, entry.isDirectory()));
        }
      }

      result.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      res.json({
        path: absPath.replace(/\\/g, '/'),
        parent: parent.replace(/\\/g, '/'),
        entries: result,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/open', async (req: Request, res: Response) => {
    try {
      const { rootPath, lightweight } = req.body;
      if (!rootPath) {
        res.status(400).json({ error: 'rootPath is required' });
        return;
      }

      log.info(`Opening workspace: rootPath="${rootPath}", lightweight=${!!lightweight}`);
      const data = await manager.openWorkspace(rootPath, llmGateway, !!lightweight);
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Workspace open failed: ${msg}`, { rootPath: req.body.rootPath });
      res.status(500).json({ error: msg });
    }
  });

  router.get('/info', async (req: Request, res: Response) => {
    try {
      const workspaceId = req.query.workspaceId as string;
      if (!workspaceId) {
        res.status(400).json({ error: 'workspaceId is required' });
        return;
      }

      const data = manager.getWorkspaceData(workspaceId);
      if (!data) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      res.json(data);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/update', async (req: Request, res: Response) => {
    try {
      const { workspaceId, openTabs, activeTabPath, workspaceRoot } = req.body;
      if (!workspaceId) {
        res.status(400).json({ error: 'workspaceId is required' });
        return;
      }

      // 若 server 重启导致 workspace 不在内存,尝试从磁盘恢复
      await ensureWorkspace(workspaceId, workspaceRoot);
      await manager.updateWorkspaceData(workspaceId, { openTabs, activeTabPath });
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/close', async (req: Request, res: Response) => {
    try {
      const { workspaceId } = req.body;
      if (!workspaceId) {
        res.status(400).json({ error: 'workspaceId is required' });
        return;
      }

      log.info(`Closing workspace: id=${workspaceId}`);
      await manager.closeWorkspace(workspaceId);
      res.json({ success: true });
    } catch (err) {
      const msg = String(err);
      log.error(`Workspace close failed: ${msg}`, { workspaceId: req.body.workspaceId });
      res.status(500).json({ error: msg });
    }
  });

  // --- Agent Session 持久化端点 ---

  router.get('/sessions', async (req: Request, res: Response) => {
    try {
      const workspaceId = req.query.workspaceId as string;
      const workspaceRoot = req.query.workspaceRoot as string | undefined;
      if (!workspaceId) {
        res.status(400).json({ error: 'workspaceId is required' });
        return;
      }
      await ensureWorkspace(workspaceId, workspaceRoot);
      const sessions = manager.getAgentSessions(workspaceId);
      res.json({ sessions });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/sessions', async (req: Request, res: Response) => {
    try {
      const { workspaceId, session, workspaceRoot } = req.body;
      if (!workspaceId || !session) {
        res.status(400).json({ error: 'workspaceId and session are required' });
        return;
      }
      await ensureWorkspace(workspaceId, workspaceRoot);
      await manager.saveAgentSession(workspaceId, session);
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.delete('/sessions/:sessionId', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const workspaceId = req.query.workspaceId as string;
      const workspaceRoot = req.query.workspaceRoot as string | undefined;
      if (!workspaceId || !sessionId) {
        res.status(400).json({ error: 'workspaceId and sessionId are required' });
        return;
      }
      await ensureWorkspace(workspaceId, workspaceRoot);
      await manager.deleteAgentSession(workspaceId, sessionId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // 获取单个 session 的展示用消息列表(供前端 chat 面板渲染)
  router.get('/sessions/:sessionId/messages', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const workspaceId = req.query.workspaceId as string;
      const workspaceRoot = req.query.workspaceRoot as string | undefined;
      if (!workspaceId || !sessionId) {
        res.status(400).json({ error: 'workspaceId and sessionId are required' });
        return;
      }

      // 若 server 重启导致 workspace 不在内存,尝试从磁盘恢复
      await ensureWorkspace(workspaceId, workspaceRoot);

      const messages = manager.getSessionDisplayMessages(workspaceId, sessionId);
      res.json({ messages });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
