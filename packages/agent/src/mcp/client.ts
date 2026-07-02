import type { Client as SdkClient } from '@modelcontextprotocol/sdk/client';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport';
import type { CallToolRequest, CallToolResult, ListToolsResult, ServerCapabilities } from '@modelcontextprotocol/sdk/types';
import type { ITool } from '../types/tool';
import { buildXMLUsage } from './utils';
import { MCPToolAdapter } from './adapter';

type MCPToolDefinition = ListToolsResult['tools'][number];

/** MCP 客户端标识信息（在 initialize 握手时发送给服务端） */
export interface MCPClientInfo {
  name: string;
  version: string;
}

/**
 * MCP 客户端 —— 封装官方 @modelcontextprotocol/sdk 的 Client。
 *
 * 职责：
 * - 管理单个 MCP 服务器的连接生命周期（initialize → listTools → callTool → dispose）
 * - 将 MCP 工具定义包装为 ITool 适配器，可直接注册到 Agent
 * - 动态 import SDK Client，避免浏览器端加载 Node 模块
 */
export class MCPClient {
  private sdkClient: SdkClient | null = null;
  private transport: Transport;
  private clientInfo: MCPClientInfo;
  private initialized = false;
  private tools: MCPToolDefinition[] = [];
  private serverName = '';
  private serverVersion = '';

  constructor(
    transport: Transport,
    clientInfo: MCPClientInfo = { name: 'OpenWork', version: '0.1.0' }
  ) {
    this.transport = transport;
    this.clientInfo = clientInfo;
  }

  // ====================== 连接生命周期 ======================

  /** 执行 MCP 握手 —— 动态加载 SDK Client 并 connect() */
  async initialize(): Promise<void> {
    const { Client } = await import('@modelcontextprotocol/sdk/client');
    this.sdkClient = new Client(
      { name: this.clientInfo.name, version: this.clientInfo.version },
      { capabilities: {} }
    );
    await this.sdkClient.connect(this.transport);

    const serverVersion = this.sdkClient.getServerVersion();
    this.serverName = serverVersion?.name ?? '';
    this.serverVersion = serverVersion?.version ?? '';
    this.initialized = true;
  }

  async dispose(): Promise<void> {
    this.initialized = false;
    this.tools = [];
    this.serverName = '';
    this.serverVersion = '';
    if (this.sdkClient) {
      await this.sdkClient.close();
      this.sdkClient = null;
    }
  }

  // ====================== 工具操作 ======================

  /** 获取服务端工具列表并缓存，保留 SDK 完整元数据 */
  async listTools(): Promise<MCPToolDefinition[]> {
    this.ensureInitialized();
    const result = await this.sdkClient!.listTools();
    this.tools = result.tools as MCPToolDefinition[];
    return this.tools;
  }

  /** 调用指定工具，使用 SDK 的 CallToolRequest 参数格式 */
  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    this.ensureInitialized();
    const params: CallToolRequest['params'] = { name, arguments: args };
    return this.sdkClient!.callTool(params) as Promise<CallToolResult>;
  }

  /** 将已缓存的工具定义包装为 ITool 适配器数组 */
  createToolAdapters(): ITool[] {
    return this.tools.map(def =>
      new MCPToolAdapter(def, buildXMLUsage(def.name, def.inputSchema), (name, args) => this.callTool(name, args))
    );
  }

  /** 便捷方法：发现工具并返回 ITool[]，可直接注册到 Agent */
  async discoverAndCreateAdapters(): Promise<ITool[]> {
    await this.listTools();
    return this.createToolAdapters();
  }

  // ====================== 服务端能力查询 ======================

  /** 获取服务端能力声明（initialize 后可用） */
  getServerCapabilities(): ServerCapabilities | undefined {
    if (!this.sdkClient) return undefined;
    return this.sdkClient.getServerCapabilities();
  }

  /** 检查服务端是否支持 tools 能力 */
  hasToolCapability(): boolean {
    const caps = this.getServerCapabilities();
    return !!caps?.tools;
  }

  // ====================== 查询方法 ======================

  /** 获取缓存的工具定义列表 */
  getToolDefinitions(): MCPToolDefinition[] {
    return this.tools;
  }

  /** 获取服务端信息（initialize 后可用） */
  getServerInfo(): { name: string; version: string } {
    return { name: this.serverName, version: this.serverVersion };
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /** 获取底层 SDK Client（高级用例，initialize 后才可用） */
  getSdkClient(): SdkClient | null {
    return this.sdkClient;
  }

  // ====================== 内部方法 ======================

  private ensureInitialized(): void {
    if (!this.initialized || !this.sdkClient) {
      throw new Error('MCP client not initialized');
    }
  }
}
