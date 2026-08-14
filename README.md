# OpenWork

> [English](README_EN.md)

基于 **Monaco Editor** + **Vue 3** 的**通用 AI 办公辅助工作台** —— 在一个统一的工作区里查看和处理各类文件（代码、Word、Excel、PPT、PDF、Markdown、HTML、图片），并通过 AI 助手以自然语言完成文件读写、命令执行、外部工具调用等任务。同时支持**服务器部署**（浏览器访问）和 **Electron 桌面端**。

![OpenWork Screenshot](images/app_ui.png)

## 快速开始 · 构建与部署

### 安装

```bash
npm install
```

### 开发

开发模式只有**两种**：

| 模式 | 命令 | 说明 |
|------|------|------|
| **Server（前后端分离）** | `npm run dev:all` | 同时启动 Express 后端（`http://localhost:20385`）与 Vite 前端（`http://localhost:5173`），二者通过 `/api` 代理通信；适用于浏览器 / 远程部署场景 |
| **Electron 桌面端** | `npm run dev:electron` | 自动启动 Vite 前端 + Electron 窗口；本地文件通过主进程 IPC 读写（`main.ts` 入口） |

> 两条命令都会先自动构建 `@openwork/agent`。

如果只想**单独测试 Agent 模块**（不启动界面），可使用交互式 CLI：

```bash
npm run cli          # 交互式 Agent CLI（支持 MCP 工具）

# 传入待测试的模型信息（命令行参数 > 环境变量 LLM_API_URL/LLM_MODEL/LLM_API_KEY > 内置默认值）
npm run cli -- --url https://api.deepseek.com/v1 --model deepseek-v4-flash --key sk-xxxx
```

> CLI 不再内置硬编码的 API Key，需通过 `--key` 或环境变量 `LLM_API_KEY` 提供。模型信息最终通过 `AgentRuntime` 进行调用。

### 构建

```bash
npm run build:all       # 构建所有包（agent → web → server → electron）

# 或单独构建
npm run build:agent     # AI Agent 框架
npm run build:server    # Express 后端
npm run build:web       # Vue 前端（输出到 packages/web/dist/）
npm run build:electron  # Electron 主进程
```

### 部署

| 目标 | 命令 | 说明 |
|------|------|------|
| **Server 部署** | `npm run build:all` + `SERVE_STATIC` | 构建后设置环境变量 `SERVE_STATIC` 指向 `packages/web/dist` 启动服务端，由 Express 同时托管前端与 API |
| **Electron 免安装目录** | `npm run pack:electron` | electron-builder `--dir` 模式：仅产出解包后的应用目录，**不生成安装程序**，用于本地验证打包结果 |
| **Electron 安装程序** | `npm run dist:electron` | electron-builder 完整打包：生成可分发的 **Windows NSIS 安装程序** |

> Electron 有两个主进程入口：`main.ts`（标准窗口，IPC 文件操作）与 `main-server.ts`（内嵌 Express 服务端），详见 [packages/electron/README.md](packages/electron/README.md)。前端会在运行时自动检测环境（Electron / Server / Browser），在 `packages/web/src/services/fileService.ts` 中选择合适的文件服务。

## 功能需求与开发进度

> **图例**: ✅ 已完成 &nbsp; ⚠️ 框架就绪，待实现 &nbsp; ❌ 未开始

### P0 — 文件工作台 & 多格式查看

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 1 | 多 Tab 管理 / 脏标记 | ✅ | Pinia store 驱动, `packages/web/src/stores/editor.ts` |
| 2 | 打开文件 (本地/远程) | ✅ | Electron IPC + Server API 已通; 浏览器 File System Access API 部分可用 |
| 3 | 打开文件夹 (目录树) | ✅ | Electron `showOpenDialog` + Server `/api/files/list` 已通; 浏览器端未完成 |
| 4 | 文件保存 (Ctrl+S) | ✅ | Electron IPC + Server API 均已实现 |
| 5 | 新建无标题文件 | ✅ | `store.newUntitled()` |
| 6 | 拖拽文件到编辑器打开 | ✅ | `MainLayout.vue` 带拖拽遮罩; 支持 Electron（原生路径）与浏览器（FileSystemDirectoryHandle） |
| 7 | 键盘快捷键 | ⚠️ | 已绑定复制（ctrl+c）、粘贴（ctrl+v）、剪切（ctrl+x）、撤销（ctrl+z）、恢复（ctrl+y）、查找（ctrl+f）、替换（ctrl+h）; Electron 菜单快捷键 IPC 桥接就绪但未接入; 缺少完整快捷键体系 |
| 8 | 多格式文档查看 | ✅ | 8 种渲染模式：代码 / Word / Excel / PPT / PDF / Markdown / HTML / 图片，按扩展名自动选择渲染器（见下文「多格式查看器」） |
| 9 | 工作区级内容搜索 | ✅ | `SearchPanel.vue` 递归搜索整个工作区文件，结果按文件分组、点击导航（只读，不含替换） |
| 10 | 单文件查找 / 替换 | ⚠️ | Monaco 原生查找/替换（ctrl+f / ctrl+h）可用; 搜索面板本身为只读 |

### P1 — AI 助手

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 11 | Agent 对话面板 | ✅ | `AgentChatB.vue`（naive-ui），支持 build / plan 双模式，Markdown + KaTeX 渲染，多会话 Tab，多 Provider 配置管理 |
| 12 | Agent 消息流式输出 (SSE) | ✅ | Server SSE + 前端 stream 解析已完整打通; 支持真实 LLM 流式响应（chunk / thinking / tool_* / done 事件） |
| 13 | Agent 工具循环执行任务 | ✅ | `@openwork/agent` 内置 7 个工具（`file_edit` / `file_write` / `read_file` / `list_dir` / `search_code` / `bash` / `delegate`），在工具循环内直接落盘，不再有独立的 `<edit>` 块解析链路 |
| 14 | Agent 上下文构建 (打开文件+光标+选区) | ✅ | `useAgent.ts` 组装 `IDESnapshot`（激活文件、其他 tab、文件树、光标/选区）随请求发送 |
| 15 | MCP 工具生态 | ✅ | 完整 MCP 客户端，支持 STDIO / HTTP / SSE 三种传输; 多服务器连接、工具发现与自动路由; 前端管理面板 |
| 16 | LLM 后端对接 (OpenAI 兼容 API) | ✅ | 基于 `openai` SDK 对接 OpenAI 兼容 API（支持 DeepSeek / Ollama / vLLM 等）; `systemPrompt` 可通过配置注入 |
| 17 | 多 Provider 配置管理 | ✅ | `LLMGateway` 提供增删改查、设为活跃、连通性/模型列表测试，持久化到 `config/llm-settings.json` |
| 18 | 会话持久化 | ✅ | 服务端将 Agent 会话（含 memory）写入工作区 `.openwork/workspace.json`，重开工作区即可恢复 |
| 19 | 子 Agent 委派 | ⚠️ | `DelegateTool` + `Session` 编排已实现（`<delegate>` 路由）; 前端无专门展示 |
| 20 | 编辑撤销 / 重做 | ⚠️ | Monaco 原生文本级撤销/重做已绑定; 文件删除后 10 秒内可撤销（`undoDelete()`）; Agent 编辑无独立撤销 API |

### P2 — 文件系统 & 工作区

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 21 | 三种文件系统实现 | ✅ | `LocalFileSystem`（server `fs/`）+ 浏览器 FSA 客户端 + REST 客户端（web `fileService.ts`） |
| 22 | 运行时环境自动检测 | ✅ | `fileService.ts` → 检测 Electron / Server / Browser |
| 23 | 文件/文件夹 重命名 / 删除 / 新建 | ✅ | 底层 API 已实现; 文件树右键菜单与 File 菜单均已集成 |
| 24 | 文件监听 / 自动刷新 | ⚠️ | `IFileSystem.watch()` 已定义, `LocalFileSystem` 实现了; 前端未消费 |
| 25 | 最近打开的项目 / 文件列表 | ❌ | |
| 26 | 前端 UI 状态持久化 (重启恢复 Tab) | ❌ | Pinia store 纯内存, 刷新即丢失（仅 LLM Provider 配置持久化到 localStorage）; 服务端工作区与 Agent 会话已持久化，前端标签状态尚未 |

### P3 — 代码编辑增强

> 代码是 OpenWork 8 种查看模式之一（Monaco Editor）；以下为代码查看器内的编辑能力。

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 27 | 代码折叠 / 大纲 | ✅ | 由 Monaco 原生支持 |
| 28 | 多光标编辑 | ✅ | 由 Monaco 原生支持 |
| 29 | 主题切换 (亮色/暗色/自定义) | ✅ | 支持 dark/light/blue 三主题，持久化到 localStorage，Monaco 主题同步 |
| 30 | 语法错误 / 诊断信息 | ❌ | 需接入 TypeScript/ESLint Language Server |
| 31 | 代码自动补全 / IntelliSense | ⚠️ | Monaco 内置基础补全; TypeScript 语言的智能补全未配置 |
| 32 | 代码片段 (Snippets) | ❌ | |
| 33 | 格式化 (Prettier 集成) | ❌ | Prettier 已安装为 devDependency 但未被调用 |

### P4 — 部署 & 分发

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 34 | 服务器部署 (Express + 静态前端) | ✅ | `SERVE_STATIC` 环境变量指向 `web/dist` |
| 35 | Electron 桌面应用 | ✅ | 支持 dev/prod 模式, IPC 文件操作, 文件对话框, 多窗口 |
| 36 | Electron 原生菜单栏 | ✅ | File/Edit/Help 菜单含快捷键，`main.ts` 和 `main-server.ts` 均已实现 |
| 37 | Electron 打包 / 安装程序 (electron-builder) | ⚠️ | `package.json` 已配置 `build` 字段 (appId, productName, win NSIS / linux AppImage+deb, 图标); 打包未在 CI 中验证 |
| 38 | 路径遍历防护 | ✅ | Server file routes 已做 `resolve` → `startsWith` 校验 |
| 39 | 认证 / 鉴权 (Bearer Token) | ✅ | `authMiddleware` 已挂载到 `/api/*`；设置 `AUTH_TOKEN` 环境变量即启用 Bearer 校验（本地未设置则放行，远程部署必须设置） |
| 40 | Docker 部署 | ❌ | |
| 41 | CI/CD (GitHub Actions) | ❌ | |

### P5 — 体验 & 工程化

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 42 | 自适应布局 (可拖拽分隔条) | ✅ | `MainLayout.vue` — 侧边栏宽度可调 |
| 43 | 状态栏 (光标位置、语言、编码) | ✅ | 自定义 `StatusBar.vue`，显示语言、实时行列位置、工作区模式 |
| 44 | 右键上下文菜单 | ✅ | 文件树右键菜单（`NewFileTree` 内建 naive-ui 菜单），支持打开/重命名/删除/新建/剪切/复制/粘贴/复制路径/刷新 |
| 45 | 错误/通知提示 (Toast) | ❌ | `useFileSystem.error` 有定义但未被任何 UI 渲染 |
| 46 | 加载状态 / 骨架屏 | ⚠️ | 文件树及 Agent 面板已有文本型 "Loading..." 提示; 无骨架屏/动画 |
| 47 | 国际化 (i18n) | ✅ | 中/英文通过 vue-i18n 实现，持久化到 localStorage，覆盖所有 UI 文本 |
| 48 | 响应式 / 移动端适配 | ❌ | 仅有 `<meta viewport>` 标签, 无 @media 查询 |
| 49 | 自动化测试 | ⚠️ | `@openwork/agent` 已有 vitest 单测（16 个用例: SessionMemory / createDefaultTools / maskApiKey）; web / server 尚无测试 |
| 50 | ESLint / Prettier 配置 | ❌ | 依赖已安装, 无配置文件 (lint 命令执行会失败) |

### 统计

| 状态 | 数量 |
|------|------|
| ✅ 已完成 | 31 |
| ⚠️ 框架就绪 | 9 |
| ❌ 未开始 | 10 |
| **合计** | **50** |

## 多格式查看器

每个标签页根据文件扩展名自动选择渲染器（`getViewModeFromPath()`，定义于 `stores/editor.ts`）：

| 格式 | 渲染器 | 技术实现 |
|------|--------|----------|
| 代码 (ts/js/json/py/rs/go/…) | `MonacoEditor.vue` | Monaco Editor，语法高亮、折叠、多光标、vs-dark 主题 |
| Word (docx) | `DocxViewer.vue` | `docx-preview`，支持缩放 / 适应宽度 / 页眉页脚 / 脚注（旧 `.doc` 格式不支持） |
| Excel (xlsx/xls) | `ExcelViewer.vue` | `@vue-office/excel` |
| PowerPoint (pptx/ppt) | `PptxViewer.vue` | `@vue-office/pptx` |
| PDF | `PdfViewer.vue` | `<embed>` 内嵌渲染 |
| Markdown (md/mdx) | `MarkdownViewer.vue` | markdown-it + KaTeX 数学公式 |
| HTML | `HtmlViewer.vue` | iframe 实时预览 |
| 图片 (png/jpg/gif/svg/webp/bmp/ico/tiff) | `ImageViewer.vue` | 原生 `<img>` |

## 架构文档

### 1. 包依赖关系

> 箭头方向：`A --> B` 表示 B 依赖 A（A 是被依赖方）

```mermaid
graph TD
    agent["@openwork/agent<br/>AI Agent 框架<br/><br/>· AgentRuntime（统一入口）<br/>· Agent / Session / ToolRegistry<br/>· LLMGateway / MCP Client (STDIO/HTTP/SSE)<br/>· 7 个默认工具（file_edit 等）"]
    server["@openwork/server<br/>Express 后端<br/><br/>· /api/files·agent·workspace·llm·mcp<br/>· LocalFileSystem（内置 fs/）<br/>· WorkspaceManager / 路径遍历防护"]
    web["@openwork/web<br/>Vue 3 前端<br/><br/>· Monaco Editor 封装 + 多格式查看器<br/>· AgentChatB 聊天 UI<br/>· useAgent / useFileSystem<br/>· agentService SSE 客户端"]
    electron["openwork-desktop<br/>Electron 桌面壳<br/><br/>· IPC 桥接 (preload.ts)<br/>· 原生文件对话框 / 菜单<br/>· main.ts / main-server.ts 双入口"]

    agent --> server
    agent --> web
    agent --> electron
    server --> electron
```

> 当前为 **4 个工作区包**（`agent` / `server` / `web` / `electron`），不存在 `@openwork/core`。

**架构要点**：
- **`@openwork/agent`** 是核心模块，对外统一入口为 `AgentRuntime`；不依赖任何工作区包，通过 `IAgentFileSystem` 接口与平台解耦
- **文件系统实现内聚在使用方**：`LocalFileSystem`/`FileEntry` 位于 `@openwork/server` 的 `fs/`；浏览器 FSA 客户端与 REST 客户端位于 `@openwork/web` 的 `fileService.ts`；标签类型（`EditorTab`，含 `viewMode` 渲染器选择）位于 `@openwork/web` 的 Pinia store
- **`@openwork/server`** 依赖 `@openwork/agent`，提供文件 / Agent / 工作区 / LLM / MCP 全套 REST·SSE API
- **`openwork-desktop`**（Electron）可内嵌 `@openwork/server`（`main-server.ts`），或仅用 IPC 文件操作（`main.ts`）

### 2. 架构图 — 包依赖与部署拓扑

```mermaid
graph TB
    subgraph Packages["npm Workspace 包"]
        agent["@openwork/agent<br/>AI Agent 框架 · AgentRuntime · LLM/MCP · 工具循环"]
        server["@openwork/server<br/>Express · REST/SSE · LocalFileSystem · 工作区"]
        web["@openwork/web<br/>Vue 3 · Vite · Monaco · naive-ui"]
        electron["openwork-desktop<br/>Electron 壳 · IPC 桥接 · 内嵌服务端"]
    end

    subgraph Runtime["运行时环境"]
        browser["Browser<br/>File System Access API"]
        node_srv["Node.js 服务器<br/>本地 / 远程文件"]
        desktop["Electron 桌面<br/>原生 fs 对话框"]
    end

    agent --> server
    agent --> web
    agent --> electron
    server --> electron
    web -.->|dev proxy /api → :20385| server
    electron -->|加载 web/dist 或 Vite dev URL| web
    server -->|SERVE_STATIC 时提供| web
    electron -->|IPC invoke / 内嵌 startServer| desktop
    server -->|fs 操作| node_srv
    web -->|File System Access API| browser
```

**说明**：`@openwork/agent` 是独立的 AI Agent 框架，对外统一入口为 `AgentRuntime`，提供 LLM Provider 管理、多轮工具循环、MCP 客户端与文件操作执行。`@openwork/server` 依赖 agent，并自带 `LocalFileSystem`（`fs/`）与工作区管理。前端 `web` 在开发时通过 Vite proxy 将 `/api` 转发到 `server`；Electron 模式下前端由 Electron 窗口加载，文件操作通过 `preload.ts` 暴露的 IPC 桥接到主进程，或由 `main-server.ts` 内嵌的 Express 服务端提供。

### 3. 流程图

#### 3.1 运行时环境检测与文件服务选择

```mermaid
flowchart TD
    A["应用启动"] --> B{"window.electronAPI<br/>是否存在?"}
    B -->|是| C["env = 'electron'<br/>使用 Electron IPC 客户端"]
    B -->|否| D{"window.showDirectoryPicker<br/>是否存在?"}
    D -->|是| E["env = 'browser'<br/>使用 File System Access API"]
    D -->|否| F["env = 'server'<br/>使用 REST API 客户端"]
    C --> G["fileService.ts 返回对应 FileServiceClient"]
    E --> G
    F --> G
    G --> H["useFileSystem() 初始化<br/>暴露 client / error / env"]
```

**说明**：`detectEnvironment()` 在 `fileService.ts` 中按 `electron → browser → server` 顺序一次性检测并缓存运行时环境，后续所有文件操作通过统一的 `FileServiceClient` 接口执行，上层组件不感知底层差异。

#### 3.2 Agent 对话与任务执行流程

```mermaid
flowchart TD
    U["用户输入消息"] --> M{"模式?"}
    M -->|plan| PL["AgentRuntime 直接调用 LLM<br/>流式输出文本"]
    M -->|build| BD["AgentRuntime + Session<br/>多轮工具循环（read_file / file_edit / bash / MCP / …）"]
    PL --> SSE["Server SSE：chunk / thinking / tool_* 事件"]
    BD --> SSE
    SSE --> DONE["done 事件"]
    DONE --> REF["前端刷新编辑器 Tab + 文件树"]
```

**说明**：Agent 逻辑全部在 `@openwork/agent` 的 `AgentRuntime` 中执行（服务端持有实例）。`plan` 模式直接流式调用 LLM；`build` 模式运行多轮工具循环。文件编辑由 agent 内建工具（`FileEditTool` / `FileWriteTool`）在循环内直接写入文件系统（有 read 前置校验），完成后由前端刷新 UI。

### 4. 时序图 — 工作区打开与 Agent 会话持久化

```mermaid
sequenceDiagram
    actor User
    participant Web as Web (fileService)
    participant Server as Server (/api/workspace)
    participant WM as WorkspaceManager
    participant Disk as .openwork/workspace.json

    User->>Web: 打开文件夹
    Web->>Server: POST /api/workspace/open { rootPath }
    Server->>WM: 创建/复用 AgentRuntime
    WM->>Disk: 读取持久化的工作区与 Agent 会话
    Disk-->>WM: WorkspaceData
    WM-->>Server: workspaceId + 会话列表
    Server-->>Web: WorkspaceData

    User->>Web: 与 Agent 对话
    Web->>Server: POST /api/agent/stream { workspaceId }
    Server-->>Web: SSE 流式事件
    Web->>Server: POST /api/workspace/sessions { session }
    Server->>WM: 保存会话
    WM->>Disk: 立即写盘

    User->>Web: 关闭工作区
    Web->>Server: POST /api/workspace/close
    Server->>WM: 持久化数据，释放 Runtime / MCP 连接
```

**说明**：服务端通过 `workspaceId` 复用 `AgentRuntime`（含 MCP 连接），Agent 对话历史随工作区数据持久化到工作区目录下的 `.openwork/workspace.json`，关闭后重新打开即可恢复会话。

### 5. 核心类型概览

**文件系统抽象层：**

| 接口/类 | 所在包 | 说明 |
|----------|--------|------|
| `IAgentFileSystem` | `@openwork/agent` | 最小化文件系统接口（readFile / writeFile / exists / readDir） |
| `IFileSystem` / `LocalFileSystem` | `@openwork/server` | 服务端文件系统接口与 Node.js `fs/promises` 实现（`fs/`） |
| `FileServiceClient` | `@openwork/web` | 前端统一文件客户端接口（Electron IPC / Server REST / Browser FSA 三实现） |

**Agent / AI 层（均在 `@openwork/agent`）：**

| 接口/类 | 说明 |
|----------|------|
| `AgentRuntime` | **对外统一入口**：plan/build 模式、会话管理、MCP 集成、文件操作执行 |
| `Agent` | 单 Agent 多轮工具调用循环 |
| `Session` | 主 Agent + 子 Agent 编排，`<delegate>` 路由，流式 |
| `ToolRegistry` / `ITool` | 工具注册表与工具接口（7 个默认工具） |
| `McpManager` | 多 MCP 服务器连接管理，工具发现与路由 |
| `LLMGateway` | LLM 提供商配置管理与持久化 |
| `SessionMemory` | 会话记忆：消息、工具调用记录、Token 预算管理 |

**标签页与编辑器状态：**

| 接口/类 | 所在包 | 说明 |
|----------|--------|------|
| `AgentContext` | `@openwork/agent` | Agent 上下文（openFiles / fileTree / cursorPosition 等） |
| `ChatResult` / `AgentResult` | `@openwork/agent` | 对话结果（文本、工具调用记录） |
| `EditorTab` / `ViewMode` | `@openwork/web` | 标签页（含 viewMode 渲染器选择，定义于 `stores/editor.ts`） |
| `EditorStore` | `@openwork/web` | Pinia store —— 前端唯一状态源（tabs / fileTree / workspace） |

## 服务端 API

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/files/list?path=&root=` | 列出目录内容 |
| GET | `/api/files/read?path=&root=` | 读取文件内容 |
| GET | `/api/files/read-buffer?path=&root=` | 读取文件为 base64（二进制文件） |
| POST | `/api/files/write` | 写入文件 `{ path, content, root }` |
| DELETE | `/api/files/delete?path=&root=` | 删除文件 |
| POST | `/api/files/mkdir` | 创建目录 `{ path, root }` |
| DELETE | `/api/files/rmdir?path=&root=` | 删除目录 |
| GET | `/api/files/exists?path=&root=` | 检查路径是否存在 |
| GET | `/api/files/stat?path=&root=` | 获取文件/目录元数据 |
| POST | `/api/files/rename` | 重命名 `{ oldPath, newPath, root }` |
| POST | `/api/agent/chat` | 发送消息给 Agent |
| POST | `/api/agent/stream` | 流式返回 Agent 响应 (SSE) |
| GET/POST | `/api/workspace/open·info·update·close` | 工作区生命周期管理 |
| GET/POST/DELETE | `/api/workspace/sessions` | Agent 会话持久化（增删查） |
| GET | `/api/workspace/roots·browse` | 系统根目录列表 / 浏览文件系统 |
| GET/POST/PUT/DELETE | `/api/llm/providers` | LLM 提供商 CRUD + 设为活跃 + 连通性测试 |
| GET/POST/PUT/DELETE | `/api/mcp/servers` | MCP 服务器 CRUD + `/test` + `/tools` |
| GET | `/api/config/:filename` | 读取配置文件 |
| PUT | `/api/config/:filename` | 写入配置文件 |
| GET | `/api/health` | 健康检查 |

> 完整的请求/响应字段与示例见 [`packages/server/README.md`](packages/server/README.md)。

## MCP (Model Context Protocol) 支持

OpenWork 内置完整的 MCP 客户端，支持通过标准协议接入外部工具。

**传输模式：**

| 模式 | 使用场景 |
|------|----------|
| **STDIO** | 本地 MCP 服务器（子进程启动） |
| **HTTP** | 远程 MCP 服务器（HTTP POST，无状态） |
| **SSE** | 远程 MCP 服务器（Server-Sent Events，自动提取 `Mcp-Session-Id`） |

**核心类：**
- `McpManager` — 多服务器生命周期管理：连接、发现工具、自动路由调用
- `MCPClient` — 单服务器连接（initialize → `tools/list` → `tools/call`）
- `MCPToolAdapter` — 将 MCP `tools/call` 桥接为 `ITool` 接口，含参数类型自动转换
- `ToolCatalog` — 只读扁平工具元数据存储，用于展示/CLI 输出

**使用示例（多服务器）：**
```ts
const manager = new McpManager();
await manager.connectAll({
  mcpServers: {
    filesystem: { type: 'stdio', command: 'npx', args: ['-y', '@anthropic/mcp-server-filesystem'] },
    remote: { type: 'sse', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer xxx' } },
  },
});
const tools = await manager.discoverAndCreateAdapters();
tools.forEach(t => agent.registerTool(t));
```

**集成点：**
- Server SSE 端点（`routes/agent.ts`）从请求体读取 `mcpConfig`，连接服务器并将工具注册到 Agent
- CLI（`cli.ts`）支持交互式 MCP 工具调用
- 前端 `McpSettingsPanel.vue` 管理 MCP 服务器配置

## 环境变量

| 变量 | 使用者 | 说明 | 默认值 |
|------|--------|------|--------|
| `LLM_API_URL` | `openai-client.ts` | LLM Provider API 地址 | `https://api.openai.com/v1` |
| `LLM_API_KEY` | `openai-client.ts` | LLM Provider API 密钥 | (空) |
| `LLM_MODEL` | `openai-client.ts` | LLM 模型名称 | `gpt-4o` |
| `SERVER_PORT` / `PORT` | `server/run.ts`, `electron/main-server.ts` | 服务端口 | `20385`（`app-config.json`） |
| `SERVE_STATIC` | `server/run.ts` | 静态前端文件路径（生产模式） | (空) |
| `VITE_DEV_SERVER_URL` | `electron/main.ts`, `electron/main-server.ts` | Vite 开发服务器 URL | `http://localhost:5173` |
| `AUTH_TOKEN` | `middleware/auth.ts` | Bearer Token；已挂载到 `/api/*`，设置后启用校验（本地默认放行） | (空) |
| `OPENWORK_ENABLE_BASH` | `tools/index.ts` | 设为 `0`/`false` 时不注册 agent 的 bash 工具（远程部署建议关闭） | (空) |
| `ELECTRON_MIRROR` | npm install | Electron 二进制下载镜像（国内使用） | (空) |

配置优先级：显式传入参数 > 环境变量 > 默认值

## 项目结构

仓库为 npm workspace，含 **4 个包**（每个包都有自己的 README，下表仅为概览）：

| 包 | 角色 | 关键内容 | 详细文档 |
|----|------|----------|----------|
| `@openwork/agent` | AI Agent 框架 | `AgentRuntime`（统一入口）、`Agent`/`Session`、7 个默认工具（file_edit/file_write/read_file/list_dir/search_code/bash/delegate）、`McpManager`、`LLMGateway`、`SessionMemory`、`parseToolCalls`、结构化日志、CLI | [packages/agent/README.md](packages/agent/README.md) |
| `@openwork/server` | Express 后端 | `createApp`/`startServer`、`fs/`（`LocalFileSystem`）、`routes/`（files·agent·workspace·llm·mcp·config）、`WorkspaceManager`、请求日志与 Bearer 鉴权中间件 | [packages/server/README.md](packages/server/README.md) |
| `@openwork/web` | Vue 3 前端 | `MonacoEditor` + 7 种文档/图片/预览查看器、`AgentChatB` 聊天面板、文件树、MCP/设置面板、`composables/`、`services/`（`fileService` 等）、`stores/`（editor/sessions/settings）、i18n | [packages/web/README.md](packages/web/README.md) |
| `openwork-desktop` | Electron 桌面壳 | `main.ts`/`main-server.ts` 双入口、`preload.ts`（`window.electronAPI`）、`ipc/file-handler.ts`、原生菜单、`openwork://` 协议 | [packages/electron/README.md](packages/electron/README.md) |

> 说明：早期文档中的 `@openwork/core` 已不存在 —— 文件系统实现（`LocalFileSystem`/`FileEntry`）已并入 `@openwork/server` 的 `fs/`，标签类型已并入 `@openwork/web` 的 Pinia store。

---

> 贡献者指南详见 [CONTRIBUTING.md](CONTRIBUTING.md) —— 包含脚本参考、分支/提交流程与开发约定。
