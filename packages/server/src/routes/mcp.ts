import { Router, Request, Response } from 'express';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { McpManager, type McpServerConfig, type McpConfig, type McpServerEntry, type McpSettingsFile } from '@openwork/agent';

function settingsPath(configDir: string): string {
  return path.join(configDir, 'mcp-settings.json');
}

function loadSettings(configDir: string): McpSettingsFile {
  const p = settingsPath(configDir);
  if (!existsSync(p)) return { servers: [] };
  const raw = JSON.parse(readFileSync(p, 'utf-8'));
  if (!raw.servers || !Array.isArray(raw.servers)) return { servers: [] };
  return {
    servers: raw.servers.map((s: any, _i: number) => {
      if (s.config) return s as McpServerEntry;
      // 旧格式兼容：整个对象就是 McpServerConfig，自动包装
      return {
        id: s.id || `mcp_${Date.now()}_${_i}`,
        name: s.name || 'Unnamed',
        enabled: s.enabled !== false,
        config: { type: s.type, command: s.command, args: s.args, env: s.env, cwd: s.cwd, url: s.url, headers: s.headers, sessionId: s.sessionId, name: s.name } as McpServerConfig,
      };
    }),
  };
}

function saveSettings(configDir: string, settings: McpSettingsFile): void {
  writeFileSync(settingsPath(configDir), JSON.stringify(settings, null, 2), 'utf-8');
}

/** 从持久化文件加载启用的服务器配置，返回 runtime McpConfig */
export function loadEnabledMcpConfig(configDir: string): McpConfig {
  const settings = loadSettings(configDir);
  const mcpServers: Record<string, McpServerConfig> = {};
  for (const entry of settings.servers) {
    if (entry.enabled) {
      mcpServers[entry.id] = entry.config;
    }
  }
  return { mcpServers };
}

/** 从持久化文件加载启用的服务器条目列表 */
export function loadEnabledMcpServers(configDir: string): McpServerEntry[] {
  return loadSettings(configDir).servers.filter(s => s.enabled);
}

export function createMcpRouter(configDir: string) {
  const router = Router();

  // ====================== CRUD ======================

  /** 列出所有 MCP 服务器 */
  router.get('/servers', (_req: Request, res: Response) => {
    try {
      const settings = loadSettings(configDir);
      res.json(settings.servers);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** 添加服务器 */
  router.post('/servers', (req: Request, res: Response) => {
    try {
      const { config, name, description, enabled } = req.body;
      if (!config || !config.type) {
        res.status(400).json({ error: 'config is required and must include a type' });
        return;
      }
      const validTypes = ['stdio', 'sse', 'http'];
      if (!validTypes.includes(config.type)) {
        res.status(400).json({ error: `Invalid type "${config.type}". Must be one of: ${validTypes.join(', ')}` });
        return;
      }

      const settings = loadSettings(configDir);
      const id = `mcp_${Date.now()}_${settings.servers.length}`;
      const entry: McpServerEntry = {
        id,
        name: name || config.name || id,
        description: description || undefined,
        enabled: enabled !== false,
        config: { ...config, name: name || config.name },
      };
      settings.servers.push(entry);
      saveSettings(configDir, settings);
      res.status(201).json(entry);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** 更新服务器 */
  router.put('/servers/:id', (req: Request, res: Response) => {
    try {
      const settings = loadSettings(configDir);
      const idx = settings.servers.findIndex(s => s.id === req.params.id);
      if (idx === -1) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }

      const existing = settings.servers[idx];
      const { config, name, description, enabled } = req.body;
      settings.servers[idx] = {
        id: existing.id,
        name: name !== undefined ? name : existing.name,
        description: description !== undefined ? description : existing.description,
        enabled: enabled !== undefined ? enabled : existing.enabled,
        config: config || existing.config,
      };
      saveSettings(configDir, settings);
      res.json(settings.servers[idx]);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** 删除服务器 */
  router.delete('/servers/:id', (req: Request, res: Response) => {
    try {
      const settings = loadSettings(configDir);
      const idx = settings.servers.findIndex(s => s.id === req.params.id);
      if (idx === -1) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }
      settings.servers.splice(idx, 1);
      saveSettings(configDir, settings);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ====================== 测试 + 工具查询 ======================

  /** 测试单个服务器连通性 */
  router.post('/servers/:id/test', async (req: Request, res: Response) => {
    try {
      const settings = loadSettings(configDir);
      const entry = settings.servers.find(s => s.id === req.params.id);
      if (!entry) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }

      const manager = new McpManager();
      const mcpConfig: McpConfig = { mcpServers: { [entry.id]: entry.config } };
      try {
        await manager.connectAll(mcpConfig);
        const tools = await manager.collectTools();
        res.json({ success: true, serverName: entry.name || entry.id, serverType: entry.config.type, tools });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.json({ success: false, error: message });
      } finally {
        try { await manager.disconnectAll(); } catch { /* ignore */ }
      }
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** 查询服务器工具列表（临时连接） */
  router.post('/servers/:id/tools', async (req: Request, res: Response) => {
    try {
      const settings = loadSettings(configDir);
      const entry = settings.servers.find(s => s.id === req.params.id);
      if (!entry) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }

      const manager = new McpManager();
      const mcpConfig: McpConfig = { mcpServers: { [entry.id]: entry.config } };
      try {
        await manager.connectAll(mcpConfig);
        const tools = await manager.collectTools();
        res.json({ tools });
      } finally {
        try { await manager.disconnectAll(); } catch { /* ignore */ }
      }
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
