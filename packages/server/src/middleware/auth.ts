import { Request, Response, NextFunction } from 'express';

/**
 * Bearer token 校验：
 * - AUTH_TOKEN 未设置 → 全部放行（本地开发）
 * - AUTH_TOKEN 已设置 → 所有请求必须携带匹配的 Bearer token，否则 401
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!process.env.AUTH_TOKEN) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice(7);
  if (token === process.env.AUTH_TOKEN) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}
