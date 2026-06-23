/**
 * 工具参数 JSON Schema 子集，与 MCP inputSchema 对齐。
 *
 * properties 值包含显式声明的 type / description / default 字段，
 * 并通过索引签名允许 MCP 扩展的 JSON Schema 关键字（enum、minimum、pattern 等）透传，
 * 避免 MCPToolAdapter 中不必要的类型断言。
 */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    default?: unknown;
    [key: string]: unknown;
  }>;
  required?: string[];
}

/** 工具注解 —— 与 MCP ToolAnnotations 结构兼容，帮助 LLM 理解工具行为 */
export interface ToolAnnotations {
  /** 人类可读工具标题（优先于 name 用于展示） */
  title?: string;
  /** 工具不修改环境（默认 false） */
  readOnlyHint?: boolean;
  /** 工具可能执行破坏性更新（默认 true，仅在 readOnlyHint=false 时有意义） */
  destructiveHint?: boolean;
  /** 重复调用相同参数无额外效果（默认 false，仅在 readOnlyHint=false 时有意义） */
  idempotentHint?: boolean;
  /** 工具与外部实体交互（默认 true） */
  openWorldHint?: boolean;
}

/** 工具执行上下文 */
export interface ToolExecutionContext {
  workspaceRoot: string;
}

/** 工具接口 —— 内置工具和 MCP 工具的统一契约 */
export interface ITool {
  /** XML 标签名，如 "read_file" */
  readonly name: string;
  /** 用途描述，用于生成系统提示词 */
  readonly description: string;
  /** 用法示例一行，如 '<read_file path="path/to/file"/> — Read a file' */
  readonly usage: string;
  /** JSON Schema 参数定义 */
  readonly inputSchema: ToolInputSchema;
  /** 工具行为注解（只读、破坏性、幂等性等），MCP 工具透传，内置工具可选 */
  readonly annotations?: ToolAnnotations;
  /** 执行属性（如 task 支持），MCP 工具透传 */
  readonly execution?: { taskSupport?: 'optional' | 'required' | 'forbidden' };
  /**
   * 工具调用时如何承载 body：
   * - 不设（默认）：仅支持自闭合标签 `<tag attr="..."/>`，所有参数走属性
   * - `'content'`：支持 `<tag attr="...">body 文本</tag>`，整段 body 文本注入到 params.content
   * - `'children'`：支持 `<tag attr="..."><key>val</key>...</tag>`，子标签解析为 params[key]
   *
   * 'content' 适合承载长文本/代码内容（如 file_write 的文件内容），
   * 'children' 适合承载多段文本参数（如 file_edit 的 old/new 两段代码）。
   */
  readonly body?: 'content' | 'children';
  /** 执行工具，返回注入到对话中的结果文本 */
  execute(params: Record<string, string>, context: ToolExecutionContext): Promise<string>;
}
