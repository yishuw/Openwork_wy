import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { FileEntry } from '../fs/types';
import { createLogger, LOG_CATEGORY } from '@openwork/agent';

const log = createLogger(LOG_CATEGORY.FILE_OPS);

const router = Router();

function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    tiff: 'image/tiff',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

function resolveRoot(root?: string): string {
  return path.resolve(root || process.cwd());
}

function getSafePath(root: string, target: string): string {
  const resolved = path.resolve(root, target);
  // Use case-insensitive comparison for Windows filesystem compatibility.
  // Include path.sep in the prefix check to prevent prefix-matching attacks
  // (e.g. root=/home/user/proj matching resolved=/home/user/project/evil).
  const resolvedLower = resolved.toLowerCase();
  const rootLower = root.toLowerCase();
  const sep = path.sep.toLowerCase();
  if (resolvedLower === rootLower || resolvedLower.startsWith(rootLower + sep)) {
    return resolved;
  }
  throw new Error('Path traversal not allowed');
}

function toEntry(relativePath: string, isDirectory: boolean, size?: number, mtime?: number): FileEntry {
  return {
    name: path.basename(relativePath),
    path: relativePath.replace(/\\/g, '/'),
    isDirectory,
    size,
    modifiedAt: mtime,
  };
}

router.get('/list', async (req: Request, res: Response) => {
  try {
    const root = resolveRoot(req.query.root as string | undefined);
    const dirPath = (req.query.path as string) || '.';
    const absPath = getSafePath(root, dirPath);

    const entries = await fs.readdir(absPath, { withFileTypes: true });
    const result: FileEntry[] = [];

    for (const entry of entries) {
      const entryPath = path.join(absPath, entry.name);
      const relPath = path.relative(root, entryPath).replace(/\\/g, '/');
      try {
        const stat = await fs.stat(entryPath);
        result.push(toEntry(relPath, entry.isDirectory(), stat.size, stat.mtimeMs));
      } catch {
        result.push(toEntry(relPath, entry.isDirectory()));
      }
    }

    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    log.debug(`list done: ${result.length} entries`, { path: dirPath, entries: result.length });
    res.json(result);
  } catch (err) {
    log.error(`list failed: ${String(err)}`, { path: req.query.path as string, error: String(err) });
    res.status(500).json({ error: String(err) });
  }
});

router.get('/read', async (req: Request, res: Response) => {
  try {
    const root = resolveRoot(req.query.root as string | undefined);
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const absPath = getSafePath(root, filePath);
    const binary = req.query.binary === 'true';

    if (binary) {
      const buf = await fs.readFile(absPath);
      const ext = path.extname(absPath).toLowerCase().replace('.', '');
      const mime = getMimeType(ext);
      const base64 = buf.toString('base64');
      log.debug(`read done: ${buf.length} bytes (binary)`, { path: filePath, size: buf.length, mime });
      res.json({ path: filePath, content: `data:${mime};base64,${base64}` });
    } else {
      const content = await fs.readFile(absPath, 'utf-8');
      log.debug(`read done: ${content.length} chars`, { path: filePath, size: content.length });
      res.json({ path: filePath, content });
    }
  } catch (err) {
    log.error(`read failed: ${String(err)}`, { path: req.query.path as string, error: String(err) });
    res.status(500).json({ error: String(err) });
  }
});

router.get('/read-buffer', async (req: Request, res: Response) => {
  try {
    const root = resolveRoot(req.query.root as string | undefined);
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const absPath = getSafePath(root, filePath);
    const buffer = await fs.readFile(absPath);
    log.debug(`read-buffer done: ${buffer.length} bytes`, { path: filePath, size: buffer.length });
    res.json({ path: filePath, data: buffer.toString('base64') });
  } catch (err) {
    log.error(`read-buffer failed: ${String(err)}`, { path: req.query.path as string, error: String(err) });
    res.status(500).json({ error: String(err) });
  }
});

router.post('/write', async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const root = resolveRoot(req.body.root as string | undefined);
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const absPath = getSafePath(root, filePath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, 'utf-8');
    log.info(`write done: ${content?.length || 0} chars, ${Date.now() - startMs}ms`, { path: filePath, size: content?.length || 0 });
    res.json({ success: true });
  } catch (err) {
    log.error(`write failed: ${String(err)}`, { path: req.body.path, error: String(err) });
    res.status(500).json({ error: String(err) });
  }
});

router.delete('/delete', async (req: Request, res: Response) => {
  try {
    const root = resolveRoot(req.query.root as string | undefined);
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const absPath = getSafePath(root, filePath);
    await fs.unlink(absPath);
    log.info(`delete done`, { path: filePath });
    res.json({ success: true });
  } catch (err) {
    log.error(`delete failed: ${String(err)}`, { path: req.query.path as string, error: String(err) });
    res.status(500).json({ error: String(err) });
  }
});

router.post('/mkdir', async (req: Request, res: Response) => {
  try {
    const root = resolveRoot(req.body.root as string | undefined);
    const { path: dirPath } = req.body;
    if (!dirPath) return res.status(400).json({ error: 'path required' });

    const absPath = getSafePath(root, dirPath);
    await fs.mkdir(absPath, { recursive: true });
    log.info(`mkdir done`, { path: dirPath });
    res.json({ success: true });
  } catch (err) {
    log.error(`mkdir failed: ${String(err)}`, { path: req.body.path, error: String(err) });
    res.status(500).json({ error: String(err) });
  }
});

router.delete('/rmdir', async (req: Request, res: Response) => {
  try {
    const root = resolveRoot(req.query.root as string | undefined);
    const dirPath = req.query.path as string;
    if (!dirPath) return res.status(400).json({ error: 'path required' });

    const absPath = getSafePath(root, dirPath);
    await fs.rm(absPath, { recursive: req.query.recursive === 'true', force: true });
    log.info(`rmdir done`, { path: dirPath, recursive: req.query.recursive === 'true' });
    res.json({ success: true });
  } catch (err) {
    log.error(`rmdir failed: ${String(err)}`, { path: req.query.path as string, error: String(err) });
    res.status(500).json({ error: String(err) });
  }
});

router.get('/exists', async (req: Request, res: Response) => {
  try {
    const root = resolveRoot(req.query.root as string | undefined);
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const absPath = getSafePath(root, filePath);
    try {
      await fs.access(absPath);
      res.json({ exists: true });
    } catch {
      res.json({ exists: false });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/stat', async (req: Request, res: Response) => {
  try {
    const root = resolveRoot(req.query.root as string | undefined);
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const absPath = getSafePath(root, filePath);
    const stat = await fs.stat(absPath);
    res.json({
      name: path.basename(absPath),
      path: path.relative(root, absPath).replace(/\\/g, '/'),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      modifiedAt: stat.mtimeMs,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/rename', async (req: Request, res: Response) => {
  const startMs = Date.now();
  try {
    const root = resolveRoot(req.body.root as string | undefined);
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath and newPath required' });

    const absOld = getSafePath(root, oldPath);
    const absNew = getSafePath(root, newPath);
    await fs.mkdir(path.dirname(absNew), { recursive: true });
    await fs.rename(absOld, absNew);
    log.info(`rename done: ${Date.now() - startMs}ms`, { oldPath, newPath });
    res.json({ success: true });
  } catch (err) {
    log.error(`rename failed: ${String(err)}`, { oldPath: req.body.oldPath, newPath: req.body.newPath, error: String(err) });
    res.status(500).json({ error: String(err) });
  }
});

export { router as filesRouter };
