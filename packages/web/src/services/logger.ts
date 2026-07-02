/**
 * 浏览器端轻量日志包装器。
 *
 * 与 @openwork/agent 的 Logger 接口兼容。
 * 通过 localStorage 或 URL 参数控制日志级别。
 *
 * 控制方式（优先级从高到低）：
 * 1. URL 参数 `?log=debug|info|warn|error`
 * 2. localStorage `openwork_log_level`
 * 3. 默认 `warn`（仅 warn 和 error 可见）
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function getConfiguredLevel(): LogLevel {
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const urlLevel = urlParams.get('log');
    if (urlLevel && LEVEL_ORDER[urlLevel as LogLevel] !== undefined) {
      return urlLevel as LogLevel;
    }
    try {
      const stored = localStorage.getItem('vibe_log_level');
      if (stored && LEVEL_ORDER[stored as LogLevel] !== undefined) {
        return stored as LogLevel;
      }
    } catch { /* localStorage unavailable */ }
  }
  return 'warn';
}

function shouldLog(category: string, level: LogLevel): boolean {
  const minLevel = LEVEL_ORDER[getConfiguredLevel()];
  return LEVEL_ORDER[level] >= minLevel;
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return '';
  return ' ' + JSON.stringify(meta);
}

function createWebLogger(category: string): {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
} {
  return {
    debug(msg, meta) {
      if (shouldLog(category, 'debug')) console.debug(`[${category}] ${msg}${formatMeta(meta)}`);
    },
    info(msg, meta) {
      if (shouldLog(category, 'info')) console.info(`[${category}] ${msg}${formatMeta(meta)}`);
    },
    warn(msg, meta) {
      if (shouldLog(category, 'warn')) console.warn(`[${category}] ${msg}${formatMeta(meta)}`);
    },
    error(msg, meta) {
      if (shouldLog(category, 'error')) console.error(`[${category}] ${msg}${formatMeta(meta)}`);
    },
  };
}

/** Web Agent 操作日志 */
export const webAgentLog = createWebLogger('WebAgent');

/** Web 文件操作日志 */
export const webFileLog = createWebLogger('FileOps');
