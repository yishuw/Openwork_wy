import { appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import * as path from 'path';
import { AsyncLocalStorage } from 'async_hooks';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(meta: Record<string, unknown>): Logger;
}

// ====================== AsyncLocalStorage 上下文 ======================

const contextStore = new AsyncLocalStorage<Record<string, unknown>>();

/**
 * 在异步上下文中注入元数据，fn 内的所有 log 调用自动附加该元数据。
 * 用于 HTTP 中间件自动注入 requestId 等。
 */
export function runWithContext<T>(meta: Record<string, unknown>, fn: () => T): T {
  const parent = contextStore.getStore();
  const merged = { ...parent, ...meta };
  return contextStore.run(merged, fn);
}

/** 获取当前异步上下文的元数据（log 函数内部使用） */
function getContextMeta(): Record<string, unknown> {
  return contextStore.getStore() || {};
}

// ====================== 日志文件传输 ======================

let logFileStream: { write(s: string): void; path: string } | null = null;

function getLogFilePath(): string | null {
  if (typeof process === 'undefined' || !process.env) return null;
  const env = process.env.LOG_FILE;
  if (!env || env === '0' || env === 'false') return null;
  if (env === 'true' || env === '1') {
    return path.resolve(process.cwd(), 'logs', 'openwork.log');
  }
  return path.resolve(env);
}

function ensureLogFile(): void {
  const filePath = getLogFilePath();
  if (!filePath) return;

  if (logFileStream && logFileStream.path === filePath) return;

  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  logFileStream = {
    path: filePath,
    write(s: string) {
      try { appendFileSync(filePath, s + '\n', 'utf-8'); } catch { /* 静默失败 */ }
    },
  };
}

/** 清理过期日志文件，保留最近 N 天 */
function cleanOldLogs(): void {
  const filePath = getLogFilePath();
  if (!filePath) return;

  const maxFiles = getLogMaxFiles();
  if (maxFiles <= 0) return;

  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, '.log');
  try {
    if (!existsSync(dir)) return;
    const files = readdirSync(dir)
      .filter(f => f.startsWith(baseName) && f.endsWith('.log'))
      .map(f => ({ name: f, mtime: statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    for (let i = maxFiles; i < files.length; i++) {
      try { unlinkSync(path.join(dir, files[i].name)); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

function getLogMaxFiles(): number {
  const env = typeof process !== 'undefined' && process.env?.LOG_MAX_FILES
    ? process.env.LOG_MAX_FILES
    : '';
  const parsed = parseInt(env, 10);
  return isNaN(parsed) ? 7 : Math.max(0, parsed);
}

// ====================== 日志格式 ======================

function getLogFormat(): 'text' | 'json' {
  const env = typeof process !== 'undefined' && process.env?.LOG_FORMAT || '';
  if (env.toLowerCase() === 'json') return 'json';
  return 'text';
}

// ====================== 级别与分类过滤 ======================

function getConfiguredLevel(): LogLevel {
  const env = (typeof process !== 'undefined' && process.env?.LOG_LEVEL) || '';
  const normalized = env.toLowerCase();
  if (normalized === 'debug') return 'debug';
  if (normalized === 'info') return 'info';
  if (normalized === 'warn') return 'warn';
  if (normalized === 'error') return 'error';
  return 'info';
}

function shouldLog(category: string, level: LogLevel): boolean {
  const minLevel = LEVEL_ORDER[getConfiguredLevel()];
  if (LEVEL_ORDER[level] < minLevel) return false;

  const filter = typeof process !== 'undefined' && process.env?.LOG_CATEGORIES
    ? process.env.LOG_CATEGORIES
    : '';
  if (filter) {
    const allowed = filter.split(',').map(s => s.trim());
    if (!allowed.includes(category)) return false;
  }

  return true;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return '';
  return ' ' + JSON.stringify(meta);
}

/** 对敏感字段脱敏（apiKey 等） */
function sanitizeKey(key: string, value: unknown): unknown {
  if (key === 'apiKey' && typeof value === 'string' && value.length > 8) {
    return value.slice(0, 4) + '*'.repeat(value.length - 8) + value.slice(-4);
  }
  return value;
}

// ====================== 核心 log 函数 ======================

function log(
  level: LogLevel,
  category: string,
  msg: string,
  extraMeta: Record<string, unknown>,
  baseMeta?: Record<string, unknown>
): void {
  if (!shouldLog(category, level)) return;

  const ctxMeta = getContextMeta();
  const merged: Record<string, unknown> = { ...baseMeta, ...ctxMeta, ...extraMeta };

  // 脱敏
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) {
    sanitized[k] = sanitizeKey(k, v);
  }

  const format = getLogFormat();

  if (format === 'json') {
    const entry = JSON.stringify({
      ts: formatTimestamp(),
      level: level.toUpperCase(),
      category,
      msg,
      ...sanitized,
    });
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(entry);

    if (logFileStream) {
      logFileStream.write(entry);
    }
    return;
  }

  // text 格式
  const metaStr = formatMeta(sanitized);
  const line = `[${formatTimestamp()}] [${level.toUpperCase()}] [${category}] ${msg}${metaStr}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(line);

  if (logFileStream) {
    logFileStream.write(line);
  }
}

// ====================== 工厂函数 ======================

let logFileInitialized = false;

export function createLogger(category: string, baseMeta?: Record<string, unknown>): Logger {
  if (!logFileInitialized) {
    logFileInitialized = true;
    ensureLogFile();
    cleanOldLogs();
  }

  return {
    debug(msg, meta) { log('debug', category, msg, meta || {}, baseMeta); },
    info(msg, meta)  { log('info', category, msg, meta || {}, baseMeta); },
    warn(msg, meta)  { log('warn', category, msg, meta || {}, baseMeta); },
    error(msg, meta) { log('error', category, msg, meta || {}, baseMeta); },
    child(childMeta: Record<string, unknown>): Logger {
      return createLogger(category, { ...baseMeta, ...childMeta });
    },
  };
}
