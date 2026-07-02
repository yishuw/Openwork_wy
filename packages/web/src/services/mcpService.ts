import type { McpServerConfig, McpServerEntry, McpToolInfo } from '@openwork/agent';
import { i18n } from '../locales';

declare const __SERVER_PORT__: number;

const DEFAULT_BASE_URL: string = typeof __SERVER_PORT__ !== 'undefined'
  ? `http://localhost:${__SERVER_PORT__}`
  : '';

export interface TestConnectionResult {
  success: boolean;
  serverName?: string;
  serverType?: string;
  tools?: McpToolInfo[];
  error?: string;
}

function api(baseUrl: string, path: string, options?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
}

export function createMcpService(baseUrl = DEFAULT_BASE_URL) {
  return {
    /** 列出所有 MCP 服务器 */
    async listServers(): Promise<McpServerEntry[]> {
      const res = await api(baseUrl, '/api/mcp/servers');
      if (!res.ok) throw new Error(`${i18n.global.t('errors.apiError')}: ${res.status}`);
      return res.json();
    },

    /** 添加服务器 */
    async addServer(params: {
      config: McpServerConfig;
      name?: string;
      description?: string;
      enabled?: boolean;
    }): Promise<McpServerEntry> {
      const res = await api(baseUrl, '/api/mcp/servers', {
        method: 'POST',
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`${i18n.global.t('errors.apiError')} ${res.status}: ${err}`);
      }
      return res.json();
    },

    /** 更新服务器 */
    async updateServer(id: string, params: {
      config?: McpServerConfig;
      name?: string;
      description?: string;
      enabled?: boolean;
    }): Promise<McpServerEntry> {
      const res = await api(baseUrl, `/api/mcp/servers/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`${i18n.global.t('errors.apiError')} ${res.status}: ${err}`);
      }
      return res.json();
    },

    /** 删除服务器 */
    async deleteServer(id: string): Promise<void> {
      const res = await api(baseUrl, `/api/mcp/servers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`${i18n.global.t('errors.apiError')} ${res.status}: ${err}`);
      }
    },

    /** 测试单个服务器连通性 */
    async testServer(id: string): Promise<TestConnectionResult> {
      try {
        const res = await api(baseUrl, `/api/mcp/servers/${encodeURIComponent(id)}/test`, {
          method: 'POST',
        });
        if (!res.ok) {
          return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
        }
        return res.json();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      }
    },

    /** 查询服务器工具列表 */
    async listTools(id: string): Promise<McpToolInfo[]> {
      const res = await api(baseUrl, `/api/mcp/servers/${encodeURIComponent(id)}/tools`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`${i18n.global.t('errors.apiError')}: ${res.status}`);
      const data = await res.json();
      return data.tools || [];
    },
  };
}

const service = createMcpService();

export function getMcpService() {
  return service;
}
