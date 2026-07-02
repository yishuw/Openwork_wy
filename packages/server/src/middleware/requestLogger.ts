import type { Request, Response, NextFunction } from 'express';
import { createLogger, runWithContext, LOG_CATEGORY } from '@openwork/agent';

const log = createLogger(LOG_CATEGORY.HTTP);

/** 不需要记录日志的路径（健康检查等） */
const SKIP_PATHS = new Set(['/api/health']);

/** 生成简短的请求 ID */
function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * HTTP 请求日志中间件。
 *
 * 自动注入 requestId 到 AsyncLocalStorage，所有下游
 * createLogger 调用自动附带 requestId。
 *
 * 日志级别：
 * - 2xx/3xx → info
 * - 4xx     → warn
 * - 5xx     → error
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (SKIP_PATHS.has(req.path)) {
    next();
    return;
  }

  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  const startMs = Date.now();

  // 在响应头上回显 requestId，方便前端调试
  res.setHeader('X-Request-Id', requestId);

  // 记录响应完成事件
  res.on('finish', () => {
    const duration = Date.now() - startMs;
    const status = res.statusCode;
    const meta = {
      requestId,
      method: req.method,
      path: req.path,
      status,
      duration,
      contentLength: res.getHeader('content-length') || undefined,
    };

    if (status >= 500) {
      log.error(`${req.method} ${req.path} ${status} (${duration}ms)`, meta);
    } else if (status >= 400) {
      log.warn(`${req.method} ${req.path} ${status} (${duration}ms)`, meta);
    } else {
      log.info(`${req.method} ${req.path} ${status} (${duration}ms)`, meta);
    }
  });

  // 注入 requestId 上下文，供下游 logger 自动使用
  runWithContext({ requestId }, next);
}
