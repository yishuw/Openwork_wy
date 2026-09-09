/**
 * 工具执行权限闸门（桌面本地优先）。
 *
 * - suggest：非只读工具均需确认（默认最安全）
 * - auto-edit：文件写改自动；bash / destructive 需确认
 * - full-auto：全部自动（仅本地可信环境 / 脚本）
 */
export type PermissionMode = 'suggest' | 'auto-edit' | 'full-auto';

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'suggest';

export type ApprovalDecision = 'allow' | 'deny';

export interface ApprovalRequest {
  toolName: string;
  params: Record<string, string>;
  /** 人类可读预览（大参数已截断） */
  label: string;
  mode: PermissionMode;
}

export type Approver = (req: ApprovalRequest) => Promise<ApprovalDecision> | ApprovalDecision;

/** 单参数预览截断，避免大文件内容刷屏 */
export function previewParam(value: string, max = 120): string {
  const v = value ?? '';
  if (v.length <= max) return v;
  return `${v.slice(0, max)}…(${v.length} chars)`;
}

/** 拼接确认用 label */
export function buildApprovalLabel(
  toolName: string,
  params: Record<string, string>,
): string {
  const path = params.path;
  const command = params.command;
  if (command) return `${toolName} \`${previewParam(command, 80)}\``;
  if (path) {
    const extras: string[] = [];
    if (params.old) extras.push(`old=${previewParam(params.old, 40)}`);
    if (params.new) extras.push(`new=${previewParam(params.new, 40)}`);
    if (params.content) extras.push(`content=${previewParam(params.content, 40)}`);
    return extras.length
      ? `${toolName} ${path} (${extras.join(', ')})`
      : `${toolName} ${path}`;
  }
  const keys = Object.keys(params);
  if (keys.length === 0) return toolName;
  return `${toolName} ${keys.map((k) => `${k}=${previewParam(params[k] || '', 40)}`).join(' ')}`;
}

export interface ToolPermissionHints {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  name: string;
}

/** 是否需要用户确认 */
export function requiresApproval(
  tool: ToolPermissionHints,
  mode: PermissionMode,
): boolean {
  if (mode === 'full-auto') return false;
  if (tool.readOnlyHint === true) return false;
  if (mode === 'auto-edit') {
    return tool.name === 'bash' || tool.destructiveHint === true;
  }
  // suggest：一切非只读
  return true;
}

/** 无 approver 时的默认决策：除 full-auto 外一律 deny */
export function defaultDecision(mode: PermissionMode): ApprovalDecision {
  return mode === 'full-auto' ? 'allow' : 'deny';
}

export function resolvePermissionMode(requested?: PermissionMode): PermissionMode {
  return requested || DEFAULT_PERMISSION_MODE;
}
