import { IpcMain, Dialog, BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger, LOG_CATEGORY } from '@openwork/agent';

const log = createLogger(LOG_CATEGORY.FILE_OPS);

const windowRoots = new Map<number, string>();

function getSenderRoot(event: Electron.IpcMainInvokeEvent): string | null {
  return windowRoots.get(event.sender.id) || null;
}

export function getOpenWorkspacePaths(): string[] {
  return Array.from(windowRoots.values());
}

export function clearWindowRoot(webContentsId: number) {
  windowRoots.delete(webContentsId);
}

export function registerFileHandlers(ipcMain: IpcMain, dialog: Dialog) {
  function resolvePath(event: Electron.IpcMainInvokeEvent, target: string): string {
    if (path.isAbsolute(target)) return target;
    const root = getSenderRoot(event) || process.cwd();
    return path.resolve(root, target);
  }

  async function openFolderAtPath(event: Electron.IpcMainInvokeEvent, folderPath: string): Promise<string> {
    const nextRoot = path.resolve(folderPath);
    const stat = await fs.stat(nextRoot);
    if (!stat.isDirectory()) {
      throw new Error('Dropped item is not a folder');
    }
    windowRoots.set(event.sender.id, nextRoot);
    return nextRoot;
  }

  function toEntry(event: Electron.IpcMainInvokeEvent, entryPath: string, name: string, isDir: boolean, stat?: { size: number; mtimeMs: number }): any {
    const root = getSenderRoot(event) || process.cwd();
    const relPath = path.relative(root, entryPath).replace(/\\/g, '/');
    return {
      name,
      path: relPath,
      isDirectory: isDir,
      size: stat?.size,
      modifiedAt: stat?.mtimeMs,
    };
  }

  ipcMain.handle('file:read', async (event, filePath: string) => {
    const p = resolvePath(event, filePath);
    return fs.readFile(p, 'utf-8');
  });

  ipcMain.handle('file:readBuffer', async (event, filePath: string) => {
    const p = resolvePath(event, filePath);
    const buffer = await fs.readFile(p);
    return buffer.toString('base64');
  });

  ipcMain.handle('file:write', async (event, filePath: string, content: string) => {
    const startMs = Date.now();
    const p = resolvePath(event, filePath);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf-8');
    log.info(`write done: ${content.length} chars, ${Date.now() - startMs}ms (IPC)`, { path: filePath, size: content.length });
  });

  ipcMain.handle('file:delete', async (event, filePath: string) => {
    const p = resolvePath(event, filePath);
    await fs.unlink(p);
    log.info(`delete done (IPC)`, { path: filePath });
  });

  ipcMain.handle('file:readDir', async (event, dirPath: string) => {
    const p = resolvePath(event, dirPath);
    const entries = await fs.readdir(p, { withFileTypes: true });
    const result: any[] = [];
    for (const entry of entries) {
      const entryPath = path.join(p, entry.name);
      try {
        const stat = await fs.stat(entryPath);
        result.push(toEntry(event, entryPath, entry.name, entry.isDirectory(), stat));
      } catch {
        result.push(toEntry(event, entryPath, entry.name, entry.isDirectory()));
      }
    }
    result.sort((a: any, b: any) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  });

  ipcMain.handle('file:createDir', async (event, dirPath: string) => {
    const p = resolvePath(event, dirPath);
    await fs.mkdir(p, { recursive: true });
    log.info(`mkdir done (IPC)`, { path: dirPath });
  });

  ipcMain.handle('file:deleteDir', async (event, dirPath: string, recursive = true) => {
    const p = resolvePath(event, dirPath);
    await fs.rm(p, { recursive, force: true });
    log.info(`rmdir done (IPC)`, { path: dirPath, recursive });
  });

  ipcMain.handle('file:exists', async (event, filePath: string) => {
    const p = resolvePath(event, filePath);
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('file:stat', async (event, filePath: string) => {
    const p = resolvePath(event, filePath);
    const stat = await fs.stat(p);
    return toEntry(event, p, path.basename(p), stat.isDirectory(), stat);
  });

  ipcMain.handle('file:rename', async (event, oldPath: string, newPath: string) => {
    const startMs = Date.now();
    const src = resolvePath(event, oldPath);
    const dest = resolvePath(event, newPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(src, dest);
    log.info(`rename done: ${Date.now() - startMs}ms (IPC)`, { oldPath, newPath });
  });

  ipcMain.handle('dialog:openFolder', async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(senderWindow!, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return openFolderAtPath(event, result.filePaths[0]);
  });

  ipcMain.handle('file:openFolderPath', async (event, folderPath: string) => {
    return openFolderAtPath(event, folderPath);
  });

  ipcMain.handle('dialog:openFile', async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(senderWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return { path: result.filePaths[0] };
  });

  ipcMain.handle('dialog:saveFile', async (event, filePath: string, content: string) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(senderWindow!, {
      defaultPath: filePath,
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, content, 'utf-8');
    return result.filePath;
  });
}
