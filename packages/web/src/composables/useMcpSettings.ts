import { ref } from 'vue';
import type { McpServerConfig, McpServerEntry, McpToolInfo } from '@openwork/agent';
import type { McpServerUI } from '../types/mcp-ui';
import { getMcpService } from '../services/mcpService';

function createMcpSettings() {
  const servers = ref<McpServerUI[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  let initialized = false;

  async function init() {
    if (initialized) return;
    initialized = true;
    await refresh();
  }

  async function refresh() {
    loading.value = true;
    error.value = null;
    try {
      const entries = await getMcpService().listServers();
      servers.value = entries.map(e => {
        const entryName = e.name || e.id;
        return {
          id: e.id,
          name: entryName,
          description: e.description,
          enabled: e.enabled,
          config: e.config,
          toolCount: 0,
          tools: undefined,
        } satisfies McpServerUI;
      });
    } catch (e: any) {
      error.value = e.message || String(e);
    } finally {
      loading.value = false;
    }
  }

  async function addServer(config: McpServerConfig, name: string, description: string, tools?: McpToolInfo[]): Promise<McpServerUI> {
    const entry = await getMcpService().addServer({ config, name, description, enabled: true });
    const ui: McpServerUI = {
      id: entry.id,
      name: entry.name || entry.id,
      description: entry.description,
      enabled: entry.enabled,
      config: entry.config,
      toolCount: tools?.length || 0,
      tools,
    };
    servers.value.push(ui);
    return ui;
  }

  async function updateServer(id: string, config: McpServerConfig, name: string, description: string, enabled?: boolean, tools?: McpToolInfo[]): Promise<void> {
    const entry = await getMcpService().updateServer(id, { config, name, description, enabled });
    const idx = servers.value.findIndex(s => s.id === id);
    if (idx === -1) return;
    const old = servers.value[idx];
    servers.value[idx] = {
      id: entry.id,
      name: entry.name || entry.id,
      description: entry.description,
      enabled: entry.enabled,
      config: entry.config,
      toolCount: tools !== undefined ? tools.length : old.toolCount,
      tools: tools !== undefined ? tools : old.tools,
    };
  }

  async function removeServer(id: string): Promise<void> {
    await getMcpService().deleteServer(id);
    const idx = servers.value.findIndex(s => s.id === id);
    if (idx === -1) return;
    servers.value.splice(idx, 1);
  }

  async function toggleServer(id: string): Promise<void> {
    const server = servers.value.find(s => s.id === id);
    if (!server) return;
    const newEnabled = !server.enabled;
    await getMcpService().updateServer(id, { enabled: newEnabled });
    server.enabled = newEnabled;
  }

  async function setTools(id: string, tools: McpToolInfo[]): Promise<void> {
    const server = servers.value.find(s => s.id === id);
    if (!server) return;
    server.tools = tools;
    server.toolCount = tools.length;
  }

  function addLocal(id: string, config: McpServerConfig, name: string, description: string, tools: McpToolInfo[]): void {
    servers.value.push({
      id,
      name: name || id,
      description: description || undefined,
      enabled: true,
      config,
      toolCount: tools.length,
      tools,
    });
  }

  init();

  return { servers, loading, error, addServer, updateServer, removeServer, toggleServer, setTools, addLocal, refresh };
}

let instance: ReturnType<typeof createMcpSettings> | null = null;

export function useMcpSettings() {
  if (!instance) {
    instance = createMcpSettings();
  }
  return instance;
}
