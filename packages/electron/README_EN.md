# OpenWork Desktop (Electron)

> [中文](README.md)

The Electron desktop shell for OpenWork — loads the `@openwork/web` frontend and provides local file-system access via an IPC bridge or an embedded server.

> The npm package name is `openwork-desktop` (not `@openwork/electron`).

## Two entry points

| Entry | Description | File operations |
|-------|-------------|-----------------|
| `main.ts` (default, `main: dist/main.js`) | Standard desktop window, **no embedded server** | Reads/writes local disk directly via Electron IPC (`ipc/file-handler.ts`) |
| `main-server.ts` | Embeds `@openwork/server` (`startServer`) at boot, with a single-instance lock and config read/write IPC | Both IPC file ops and a full REST API (workspace / agent / LLM / MCP) |

Both entries share the same window construction, native menu, `openwork://` protocol, and multi-window logic.

## Directory layout

```
src/
├── main.ts             # Standard entry: BrowserWindow, native menu, openwork:// protocol, multi-window, IPC file ops
├── main-server.ts      # Embedded-server entry: startServer + single-instance lock + config:read/write + __VIBE_SERVER_PORT__
├── preload.ts          # Context bridge exposing window.electronAPI
└── ipc/file-handler.ts # file:* / dialog:* IPC handlers (per-window workspace root)
build.mjs               # esbuild bundling (runs after tsc)
app-config.json         # Port and other config (copied as a resource when packaging)
app-info.json           # App name / version / authors
```

## Window & rendering

- **Frameless window** (`frame: false`), `titleBarStyle: 'hidden'` on macOS; window controls (minimize / maximize / close / drag-resize) are exposed to the frontend over IPC
- **Security sandbox**: `contextIsolation: true`, `nodeIntegration: false` — all native capabilities go through `window.electronAPI` from `preload.ts`
- **Load source**:
  - Dev: `VITE_DEV_SERVER_URL` (default `http://localhost:5173`)
  - Production: the custom `openwork://app/index.html` protocol, served from the bundled `web-dist` (or `web/dist`)
- **Multi-window**: `window:create` de-duplicates by workspace path — focuses an existing window or opens a new one

## Native menu

`File` (New File `Ctrl+N` / New Folder / Open Folder / Browse Server / Open File / Save `Ctrl+S` / Quit), `Edit` (Cut / Copy / Paste / Undo / Redo / Find `Ctrl+F` / Replace `Ctrl+H`), `Help` (About). Menu clicks are sent to the renderer's `onMenuAction` callback over the `menu:action` channel.

## IPC bridge (`window.electronAPI`)

| Category | Methods |
|----------|---------|
| Files | `readFile` / `readFileBuffer` / `writeFile` / `deleteFile` / `readDir` / `createDir` / `deleteDir` / `exists` / `stat` / `rename` / `openFolderPath` |
| Dialogs | `openFolder` / `openFile` / `saveFile` |
| Config | `readConfig` / `writeConfig` (only in `main-server.ts`) |
| Window | `minimizeWindow` / `maximizeWindow` / `unmaximizeWindow` / `closeWindow` / `isMaximized` / `getBounds` / `resizeWindow` / `onMaximizeChange` |
| Other | `getAppInfo` / `onMenuAction` / `createWindow` / `showNotification` / `registerWorkspace` |

`ipc/file-handler.ts` keeps a per-window workspace root (keyed by `webContents.id`): relative paths resolve against that root, opening a folder updates it, and it is cleared when the window closes.

## Develop & package

```bash
# Dev (requires a running Vite frontend)
$env:VITE_DEV_SERVER_URL="http://localhost:5173"
npm run dev -w packages/electron        # electron . (loads main.ts -> dist/main.js by default)

# Via root script: builds agent + electron and launches Vite + Electron together
npm run dev:electron

# Build the main process (tsc + esbuild bundling)
npm run build -w packages/electron

# Build installers (builds web first; Windows NSIS)
npm run pack:electron       # unpacked directory only (--dir)
npm run dist:electron       # full installer
```

Before packaging, `prepack` copies `app-info.json`, `app-config.json`, `provider-settings.json`, `mcp-settings.json`, and `web/dist` → `web-dist` as extra resources.

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `VITE_DEV_SERVER_URL` | Frontend URL in dev | `http://localhost:5173` |
| `SERVER_PORT` | Embedded server port (`main-server.ts`) | `serverPort` from `app-config.json`, or `20385` |

## Dependencies

- Workspace: `@openwork/server` (embedded server in `main-server.ts`), `@openwork/agent` (structured logging)
- Runtime: `express` / `cors` / `openai` / `@modelcontextprotocol/sdk` (bundled with the embedded server)
- Build: `electron`, `electron-builder`, `esbuild`
