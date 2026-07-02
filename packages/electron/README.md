# OpenWork Desktop（Electron）

> [English](README_EN.md)

OpenWork 的 Electron 桌面壳 —— 加载 `@openwork/web` 前端，并通过 IPC 桥接或内嵌服务端提供本地文件系统能力。

> npm 包名为 `openwork-desktop`（非 `@openwork/electron`）。

## 两个入口

| 入口 | 说明 | 文件操作方式 |
|------|------|--------------|
| `main.ts`（默认，`main: dist/main.js`） | 标准桌面窗口，**不内嵌服务器** | 通过 Electron IPC（`ipc/file-handler.ts`）直接读写本地磁盘 |
| `main-server.ts` | 启动时内嵌 `@openwork/server`（`startServer`），含单实例锁、配置读写 IPC | 既有 IPC 文件操作，又对外提供完整 REST API（工作区 / Agent / LLM / MCP） |

两个入口共享相同的窗口构建、原生菜单、`openwork://` 协议与多窗口逻辑。

## 目录结构

```
src/
├── main.ts             # 标准入口：BrowserWindow、原生菜单、openwork:// 协议、多窗口、IPC 文件操作
├── main-server.ts      # 内嵌服务器入口：startServer + 单实例锁 + config:read/write + __VIBE_SERVER_PORT__
├── preload.ts          # Context Bridge，暴露 window.electronAPI
└── ipc/file-handler.ts # file:* / dialog:* IPC 处理器（按窗口维护工作区根目录）
build.mjs               # esbuild 打包（tsc 之后执行）
app-config.json         # 端口等配置（打包时随资源拷贝）
app-info.json           # 应用名称 / 版本 / 作者
```

## 窗口与渲染

- **无边框窗口**（`frame: false`），macOS 使用 `titleBarStyle: 'hidden'`；窗口控制（最小化 / 最大化 / 关闭 / 拖拽调整）通过 IPC 暴露给前端
- **安全沙箱**：`contextIsolation: true`、`nodeIntegration: false`，所有原生能力经由 `preload.ts` 的 `window.electronAPI` 暴露
- **加载来源**：
  - 开发：`VITE_DEV_SERVER_URL`（默认 `http://localhost:5173`）
  - 生产：自定义 `openwork://app/index.html` 协议，从打包内的 `web-dist`（或 `web/dist`）读取前端资源
- **多窗口**：`window:create` 按工作区路径去重，已打开则聚焦，否则新建窗口

## 原生菜单

`File`（New File `Ctrl+N` / New Folder / Open Folder / Browse Server / Open File / Save `Ctrl+S` / Quit）、`Edit`（Cut / Copy / Paste / Undo / Redo / Find `Ctrl+F` / Replace `Ctrl+H`）、`Help`（About）。菜单点击通过 `menu:action` 频道发送到渲染进程的 `onMenuAction` 回调。

## IPC 桥接（`window.electronAPI`）

| 分类 | 方法 |
|------|------|
| 文件 | `readFile` / `readFileBuffer` / `writeFile` / `deleteFile` / `readDir` / `createDir` / `deleteDir` / `exists` / `stat` / `rename` / `openFolderPath` |
| 对话框 | `openFolder` / `openFile` / `saveFile` |
| 配置 | `readConfig` / `writeConfig`（仅 `main-server.ts` 提供） |
| 窗口 | `minimizeWindow` / `maximizeWindow` / `unmaximizeWindow` / `closeWindow` / `isMaximized` / `getBounds` / `resizeWindow` / `onMaximizeChange` |
| 其它 | `getAppInfo` / `onMenuAction` / `createWindow` / `showNotification` / `registerWorkspace` |

`ipc/file-handler.ts` 按窗口（`webContents.id`）维护工作区根目录：相对路径相对该根解析，打开文件夹时更新根，窗口关闭时清理。

## 开发与打包

```bash
# 开发（需先有运行中的 Vite 前端）
$env:VITE_DEV_SERVER_URL="http://localhost:5173"
npm run dev -w packages/electron        # electron .（默认加载 main.ts → dist/main.js）

# 通过根目录脚本：自动构建 agent + electron 并并行启动 Vite + Electron
npm run dev:electron

# 构建主进程（tsc + esbuild 打包）
npm run build -w packages/electron

# 打包安装程序（先构建 web，再打包；Windows NSIS）
npm run pack:electron       # 仅生成未压缩目录（--dir）
npm run dist:electron       # 生成完整安装程序
```

打包前 `prepack` 会拷贝 `app-info.json`、`app-config.json`、`provider-settings.json`、`mcp-settings.json` 以及 `web/dist` → `web-dist` 作为额外资源。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `VITE_DEV_SERVER_URL` | 开发时前端 URL | `http://localhost:5173` |
| `SERVER_PORT` | 内嵌服务器端口（`main-server.ts`） | `app-config.json` 的 `serverPort` 或 `20385` |

## 依赖

- 工作区：`@openwork/server`（`main-server.ts` 内嵌服务端）、`@openwork/agent`（结构化日志）
- 运行时：`express` / `cors` / `openai` / `@modelcontextprotocol/sdk`（随内嵌服务端打包）
- 构建：`electron`、`electron-builder`、`esbuild`
