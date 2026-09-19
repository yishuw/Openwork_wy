/** 未打开工作区时，文件类工具的统一友好错误 */
export const MISSING_WORKSPACE_TOOL_ERROR =
  'Error: 当前未打开工作区，文件工具不可用。请先在左侧打开工作区，或直接用通用知识回答。';

/** context.workspaceRoot 为空时调用，返回友好错误字符串 */
export function missingWorkspaceToolError(): string {
  return MISSING_WORKSPACE_TOOL_ERROR;
}

/** true 表示可用文件工具 */
export function hasWorkspaceRoot(workspaceRoot: string | undefined | null): boolean {
  return typeof workspaceRoot === 'string' && workspaceRoot.trim().length > 0;
}
