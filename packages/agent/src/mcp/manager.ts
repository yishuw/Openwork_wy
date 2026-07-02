import type { Transport } from '@modelcontextprotocol/sdk/shared/transport';
import type { ITool } from '../types/tool';
import type { McpServerConfig, McpConfig } from './config';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types';
import { buildXMLUsage, formatMCPResult } from './utils';
import { MCPClient } from './client';
import { MCPToolAdapter } from './adapter';
import { createLogger } from '../logger';

const log = createLogger('McpManager');

type MCPToolDefinition = ListToolsResult['tools'][number];

const RESERVED_TOOL_NAMES = new Set(['read_file', 'list_dir', 'search_code', 'bash', 'delegate']);

/** 已连接的 MCP 服务端运行时信息 */
export interface ConnectedServer {
  id: string;
  config: McpServerConfig;
  client: MCPClient;
}

/** 跨服务器的工具信息扁平视图（用于展示和查询），保留 SDK 完整元数据 */
export interface McpToolInfo {
  serverId: string;
  serverName: string;
  serverType: string;
  name: string;
  description: string;
  title?: string;
  inputSchema: unknown;
  outputSchema?: MCPToolDefinition['outputSchema'];
  annotations?: MCPToolDefinition['annotations'];
  execution?: MCPToolDefinition['execution'];
  icons?: MCPToolDefinition['icons'];
  _meta?: MCPToolDefinition['_meta'];
}

/**
 * MCP 多服务端管理器。
 *
 * 职责：
 * - 根据 McpConfig 同时连接多个 MCP 服务器（stdio / sse / http）
 * - 汇总所有服务器的工具列表，维护 tool → server 路由映射
 * - 提供统一的 callTool() 自动路由到正确的服务器
 * - 生成 ITool[] 可直接注册到 Agent
 *
 * 使用模式：
 *   const manager = new McpManager();
 *   await manager.connectAll(config);
 *   const tools = await manager.discoverAndCreateAdapters();
 *   tools.forEach(t => agent.registerTool(t));
 */
export class McpManager {
  private servers: ConnectedServer[] = [];
  private tools: McpToolInfo[] = [];
  private toolMap: Map<string, ConnectedServer> = new Map();

  // ====================== 连接管理 ======================

  /** 根据配置连接所有 MCP 服务器，个别失败不影响其他 */
  async connectAll(
    config: McpConfig,
    clientName = 'OpenWork',
    clientVersion = '0.1.0'
  ): Promise<void> {
    const entries = Object.entries(config.mcpServers);
    if (entries.length === 0) {
      throw new Error('No MCP servers configured');
    }

    for (const [id, serverConfig] of entries) {
      try {
        const transport = await createTransport(serverConfig);
        const client = new MCPClient(transport, { name: clientName, version: clientVersion });
        await client.initialize();
        this.servers.push({ id, config: serverConfig, client });
        log.info(`Connected to "${id}" (${serverConfig.type})`);
      } catch (e: any) {
        log.error(`Failed to connect "${id}": ${e.message}`);
      }
    }

    if (this.servers.length === 0) {
      throw new Error('No MCP servers connected — check configuration and server availability');
    }
  }

  /** 断开所有服务器连接 */
  async disconnectAll(): Promise<void> {
    for (const server of this.servers) {
      try {
        log.info(`Disconnecting "${server.id}"...`);
        await server.client.dispose();
        log.info(`Disconnected "${server.id}"`);
      } catch (e: any) {
        log.warn(`Error disconnecting "${server.id}": ${e.message}`);
      }
    }
    this.servers = [];
    this.tools = [];
    this.toolMap.clear();
  }

  // ====================== 工具发现 ======================

  /** 从所有已连接服务器收集工具列表并建立路由映射 */
  async collectTools(): Promise<McpToolInfo[]> {
    this.tools = [];
    this.toolMap.clear();

    for (const server of this.servers) {
      try {
        const defs = await server.client.listTools();
        const serverName = server.config.name || server.id;
        const serverType = server.config.type;

        for (const def of defs) {
          const info: McpToolInfo = {
            serverId: server.id,
            serverName,
            serverType,
            name: def.name,
            description: def.description || def.name,
            title: def.title,
            inputSchema: def.inputSchema,
            outputSchema: def.outputSchema,
            annotations: def.annotations,
            execution: def.execution,
            icons: def.icons,
            _meta: def._meta,
          };
          this.tools.push(info);
          this.toolMap.set(def.name, server);
        }
        log.info(`"${server.id}": ${defs.length} tool(s) discovered`);
      } catch (e: any) {
        log.error(`Failed to list tools from "${server.id}": ${e.message}`);
      }
    }

    return this.tools;
  }

  /** 将已发现的所有工具包装为 ITool 适配器数组 */
  createToolAdapters(): ITool[] {
    const adapters: ITool[] = [];
    const seenNames = new Set<string>();

    for (const server of this.servers) {
      const defs = server.client.getToolDefinitions();
      for (const def of defs) {
        const originalName = def.name;

        let toolName = originalName;
        if (RESERVED_TOOL_NAMES.has(toolName) || seenNames.has(toolName)) {
          toolName = `mcp_${server.id}_${originalName}`;
          log.info(`Renamed tool "${originalName}" → "${toolName}" (name conflict)`);
        }
        seenNames.add(toolName);

        const adapter = new MCPToolAdapter(
          def,
          buildXMLUsage(toolName, def.inputSchema),
          (name, args) => server.client.callTool(name, args),
          toolName !== originalName ? toolName : undefined
        );
        adapters.push(adapter);
      }
    }

    log.info(`Created ${adapters.length} tool adapter(s)`);
    return adapters;
  }

  /** 便捷方法：发现工具并返回 ITool[]，可直接注册到 Agent */
  async discoverAndCreateAdapters(): Promise<ITool[]> {
    await this.collectTools();
    return this.createToolAdapters();
  }

  // ====================== 工具调用 ======================

  /**
   * 调用指定工具并返回格式化后的文本结果。
   * 根据 toolMap 自动路由到正确的服务器。
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const server = this.toolMap.get(name);
    if (!server) {
      log.warn(`callTool: "${name}" not found in tool map`);
      throw new Error(`Tool not found: ${name}`);
    }

    log.debug(`callTool: "${name}" → server "${server.id}"`);
    const result = await server.client.callTool(name, args);
    const isError = !!(result as any).isError;
    if (isError) {
      log.warn(`callTool: "${name}" returned isError=true`);
    }
    return formatMCPResult(name, result);
  }

  // ====================== 查询方法 ======================

  getTools(): McpToolInfo[] {
    return this.tools;
  }

  getServerIds(): string[] {
    return this.servers.map(s => s.id);
  }

  get serverCount(): number {
    return this.servers.length;
  }
}

// ====================== Transport 工厂函数 ======================

/**
 * 根据配置创建对应的 SDK 传输实例。
 * 使用动态 import 避免浏览器端加载 Node 专用模块（如 stdio）。
 * 独立导出，方便单独测试和复用。
 */
export async function createTransport(config: McpServerConfig): Promise<Transport> {
  switch (config.type) {
    case 'stdio': {
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
      });
    }
    case 'sse': {
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
      return new SSEClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      });
    }
    case 'http': {
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
        sessionId: config.sessionId,
      });
    }
    default:
      throw new Error(`Unsupported transport type: ${(config as any).type}`);
  }
}
