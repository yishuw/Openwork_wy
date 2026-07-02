import { app, BrowserWindow, ipcMain, dialog, Menu, protocol } from 'electron';
import { readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { registerFileHandlers, clearWindowRoot } from './ipc/file-handler';

const appInfo = JSON.parse(readFileSync(path.join(__dirname, '../../../app-info.json'), 'utf-8'));

let mainWindow: BrowserWindow | null = null;
const openWindows = new Map<number, { window: BrowserWindow; workspacePath: string }>();


const WEB_DIST_DIR = path.join(__dirname, '../web/dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'openwork',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

function getMimeType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function resolveOpenworkPath(url: string): string {
  const pathPart = url.replace(/^openwork:\/\/app/, '').split(/[?#]/)[0];
  const relativePath = decodeURIComponent(pathPart).replace(/\\/g, '/').replace(/^\/+/, '') || 'index.html';
  const filePath = path.resolve(WEB_DIST_DIR, relativePath);
  const webRoot = path.resolve(WEB_DIST_DIR);

  if (filePath !== webRoot && !filePath.startsWith(`${webRoot}${path.sep}`)) {
    throw new Error('Invalid openwork protocol path');
  }

  return filePath;
}

function registerOpenworkProtocol() {
  protocol.handle('openwork', async (request) => {
    try {
      const filePath = resolveOpenworkPath(request.url);
      const data = await readFile(filePath);
      return new Response(new Uint8Array(data), {
        headers: { 'Content-Type': getMimeType(filePath) },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function sendMenuAction(action: string) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.webContents.send('menu:action', action);
  }
}

function buildMenu(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: 'File',
      submenu: [
        {
          label: 'New File',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuAction('new-file'),
        },
        {
          label: 'New Folder',
          click: () => sendMenuAction('new-folder'),
        },
        { type: 'separator' },
        {
          label: 'Open Folder',
          click: () => sendMenuAction('open-folder'),
        },
        {
          label: 'Browse Server',
          click: () => sendMenuAction('connect-server'),
        },
        {
          label: 'Open File',
          click: () => sendMenuAction('open-file'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('save'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Cut',
          accelerator: 'CmdOrCtrl+X',
          click: () => sendMenuAction('edit-cut'),
        },
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          click: () => sendMenuAction('edit-copy'),
        },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          click: () => sendMenuAction('edit-paste'),
        },
        { type: 'separator' },
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => sendMenuAction('edit-undo'),
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Y',
          click: () => sendMenuAction('edit-redo'),
        },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendMenuAction('edit-find'),
        },
        {
          label: 'Replace',
          accelerator: 'CmdOrCtrl+H',
          click: () => sendMenuAction('edit-replace'),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: `About ${appInfo.name}`,
              message: appInfo.name,
              detail: `Version: ${appInfo.version}\nAuthor: ${appInfo.authors.map((a: { name: string }) => a.name).join('、')}`,
            });
          },
        },
      ],
    },
  ];
}

function getLoadURL(workspacePath?: string, isFile?: boolean): string {
  let baseURL: string;
  if (process.env.VITE_DEV_SERVER_URL) {
    baseURL = process.env.VITE_DEV_SERVER_URL;
  } else if (!app.isPackaged) {
    baseURL = 'http://localhost:5173';
  } else {
    baseURL = 'openwork://app/index.html';
  }
  if (workspacePath) {
    const param = isFile ? 'file' : 'workspace';
    return `${baseURL}?${param}=${encodeURIComponent(workspacePath)}`;
  }
  return baseURL;
}

function toggleDevTools(win: BrowserWindow) {
  if (process.env.VITE_DEV_SERVER_URL || !app.isPackaged) {
    win.webContents.openDevTools();
  }
}

function createWindow(workspacePath?: string, isFile?: boolean) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'OpenWork',
    backgroundColor: '#1e1e1e',
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const wcId = win.webContents.id;

  win.loadURL(getLoadURL(workspacePath, isFile));
  toggleDevTools(win);

  win.on('maximize', () => win.webContents.send('window:maximizeChange', true));
  win.on('unmaximize', () => win.webContents.send('window:maximizeChange', false));

  win.on('closed', () => {
    openWindows.delete(wcId);
    clearWindowRoot(wcId);
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  if (workspacePath) {
    openWindows.set(wcId, { window: win, workspacePath });
  }

  return win;
}

app.whenReady().then(() => {
  registerOpenworkProtocol();
  registerFileHandlers(ipcMain, dialog);

  ipcMain.handle('app:getInfo', () => appInfo);

  const menu = Menu.buildFromTemplate(buildMenu());
  Menu.setApplicationMenu(menu);

  ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle('window:maximize', (event) => BrowserWindow.fromWebContents(event.sender)?.maximize());
  ipcMain.handle('window:unmaximize', (event) => BrowserWindow.fromWebContents(event.sender)?.unmaximize());
  ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle('window:isMaximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);
  ipcMain.handle('window:getBounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const bounds = win.getBounds();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
  ipcMain.handle('window:resize', (event, x: number, y: number, w: number, h: number) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const minW = 800;
    const minH = 600;
    const newW = Math.max(minW, w);
    const newH = Math.max(minH, h);
    win.setBounds({ x, y, width: newW, height: newH });
  });

  ipcMain.handle('window:create', async (_event, workspacePath: string, isFile?: boolean) => {
    const normalizedPath = workspacePath.replace(/\\/g, '/').toLowerCase();
    for (const [id, entry] of openWindows) {
      if (entry.workspacePath.replace(/\\/g, '/').toLowerCase() === normalizedPath) {
        const win = entry.window;
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          win.focus();
        } else {
          openWindows.delete(id);
        }
        return { status: 'duplicate' };
      }
    }
    const win = createWindow(workspacePath, isFile);
    return { status: 'created' };
  });

  ipcMain.handle('window:showNotification', (_event, title: string, body: string) => {
    const win = BrowserWindow.fromWebContents(_event.sender);
    if (win) {
      dialog.showMessageBox(win, { type: 'info', title, message: body });
    }
  });

  ipcMain.handle('window:registerWorkspace', (event, workspacePath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      openWindows.set(event.sender.id, { window: win, workspacePath });
    }
  });

  mainWindow = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
