import type { McpServerEntry, McpToolInfo } from '@openwork/agent';

/** MCP 服务器 UI 层表示，扩展 McpServerEntry 增加前端专属字段 */
export interface McpServerUI extends McpServerEntry {
  /** 扩展：缓存字段（服务端持久化类型中不存在） */
  name: string;
  toolCount: number;
  tools?: McpToolInfo[];
}
