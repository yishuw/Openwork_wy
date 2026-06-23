/**
 * 工具间共享的路径工具。
 *
 * 设计原则:仅做"resolve + path-traversal 防护 + 大小写归一",
 * 不存任何状态(状态由 Agent.readFileState 持有)。
 */
import * as path from 'path';

/** 把用户给定的路径解析为绝对路径,并确保不逃出 workspaceRoot。 */
export function resolvePath(root: string, target: string): string {
  const abs = path.resolve(root, target);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error(`Path traversal not allowed: ${target}`);
  }
  return abs;
}

/**
 * 把绝对路径规范化为 readFileState 的 key。
 * Windows 下不区分大小写,所以统一转小写;其余平台原样保留。
 */
export function normalizePathKey(absPath: string): string {
  return process.platform === 'win32' ? absPath.toLowerCase() : absPath;
}

/**
 * 把 resolvePath + normalizePathKey 一步搞定。
 * 任何需要写 readFileState / 查 readFileState 的工具都应走它,
 * 保证 key 一致。
 */
export function resolveKey(root: string, target: string): { absPath: string; key: string } {
  const absPath = resolvePath(root, target);
  return { absPath, key: normalizePathKey(absPath) };
}
