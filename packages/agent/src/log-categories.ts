/**
 * 标准日志分类名称。
 *
 * 使用方式：
 *   import { LOG_CATEGORY } from '@openwork/agent';
 *   const log = createLogger(LOG_CATEGORY.FILE_OPS);
 *
 * 通过 LOG_CATEGORIES 环境变量过滤（逗号分隔）：
 *   LOG_CATEGORIES=FileOps,LLM npm run dev:server
 */

export const LOG_CATEGORY = {
  /** HTTP 请求/响应日志（Express 中间件） */
  HTTP: 'HTTP',

  /** 文件操作：读、写、删除、重命名、创建目录、删除目录 */
  FILE_OPS: 'FileOps',

  /** LLM API 调用：请求参数、延迟、token 用量、错误 */
  LLM: 'LLM',

  /** Agent 生命周期：轮次、工具调用、内容长度 */
  AGENT: 'Agent',

  /** AgentRuntime：初始化、销毁、模式路由 */
  AGENT_RUNTIME: 'AgentRuntime',

  /** Agent 路由（服务端 SSE / chat 端点） */
  AGENT_ROUTER: 'AgentRouter',

  /** 工具注册表：注册、替换、查找 */
  TOOL_REGISTRY: 'ToolRegistry',

  /** 工具执行：各工具的 execute() 调用 */
  TOOL: 'Tool',

  /** MCP 管理器：连接、断开、工具发现 */
  MCP: 'McpManager',

  /** MCP 适配器：单个 MCP 工具调用 */
  MCP_ADAPTER: 'MCPAdapter',

  /** Session：会话生命周期、子 Agent 委托 */
  SESSION: 'Session',

  /** SessionMemory：记忆模块的写入、投影、持久化 */
  MEMORY: 'Memory',

  /** 工作区：打开、关闭、持久化、会话保存 */
  WORKSPACE: 'Workspace',

  /** LLM Gateway：提供商 CRUD、激活、连接测试 */
  GATEWAY: 'Gateway',

  /** Electron 主进程：IPC、窗口生命周期 */
  ELECTRON: 'Electron',

  /** Web 前端 Agent 操作 */
  WEB_AGENT: 'WebAgent',
} as const;

export type LogCategory = (typeof LOG_CATEGORY)[keyof typeof LOG_CATEGORY];
