# @openwork/web

> [English](README_EN.md)

OpenWork 前端 —— 基于 Vue 3 + Vite + Monaco Editor + Pinia 的 AI 辅助代码编辑器，使用 naive-ui 组件库与 vue-i18n 国际化。

## 技术栈

| 技术 | 用途 |
|------|------|
| Vue 3（Composition API） | UI 框架 |
| Vite | 构建 / 开发服务器（端口 5173，`/api` 代理到 `:20385`） |
| Monaco Editor | 代码编辑器 |
| Pinia | 状态管理 |
| naive-ui | UI 组件库 |
| vue-i18n | 中 / 英文国际化 |
| markdown-it + KaTeX | Agent 消息 Markdown / 数学公式渲染 |
| `@vue-office/*` / docx-preview | Excel / PPTX / Word 文档预览 |
| `@imengyu/vue3-context-menu` | 文件树右键菜单 |

> 唯一的工作区依赖是 **`@openwork/agent`**（用于类型与 `parseEditsFromText` 等工具函数）。前端不直接执行 Agent 循环，而是通过 SSE 调用服务端。

## 目录结构

```
src/
├── main.ts                       # 应用入口（createApp + Pinia + i18n + naive-ui）
├── App.vue                       # 根组件
├── env.d.ts                      # 类型声明（.vue 模块、window.electronAPI、FSA API）
├── components/
│   ├── layout/
│   │   ├── MainLayout.vue         # 核心编排组件：布局、标签页、拖拽分隔、键盘事件
│   │   ├── SideBar.vue            # 侧边面板容器
│   │   ├── RightToolbar.vue       # 右侧工具栏（Agent / MCP 切换）
│   │   └── AboutDialog.vue        # 关于对话框
│   ├── toolbar/Toolbar.vue        # 顶部工具栏（File 菜单、窗口控制）
│   ├── editor/
│   │   ├── MonacoEditor.vue       # Monaco 编辑器封装（主题感知）
│   │   ├── ImageViewer.vue        # 图片查看（png/jpg/gif/svg/webp…）
│   │   ├── PdfViewer.vue          # PDF 渲染
│   │   ├── DocxViewer.vue         # Word 文档查看
│   │   ├── ExcelViewer.vue        # Excel 表格查看
│   │   ├── PptxViewer.vue         # PowerPoint 查看
│   │   ├── MarkdownViewer.vue     # Markdown 渲染（含 KaTeX）
│   │   └── HtmlViewer.vue         # HTML 实时预览
│   ├── file-tree/
│   │   ├── FileTree.vue           # 文件树视图
│   │   ├── TreeNode.vue           # 递归树节点
│   │   └── contextMenu.ts         # 右键菜单构建
│   ├── new-file-tree/             # 新版文件树（NewFileTree / NewFileTreeMenu / types）
│   ├── agent/
│   │   ├── AgentPanel.vue         # AI 对话面板（消息、流式输出、工具状态）
│   │   ├── ModeSelector.vue       # build / plan 模式切换
│   │   ├── ProviderSelect.vue     # LLM Provider 选择
│   │   └── SettingsDialog.vue     # Provider 配置对话框
│   ├── mcp/                       # MCP 管理（McpSettingsPanel / McpServerItem / McpEditDialog / McpToolList）
│   ├── settings/                  # 设置弹窗（SettingsModal / GeneralSettings / ProviderSettingsSection / McpSettingsContent）
│   ├── dialogs/                   # 打开文件 / 文件夹对话框（OpenFileDialog / OpenFolderDialog）
│   ├── SearchPanel.vue            # 搜索面板（结果按文件分组）
│   ├── SearchPopup.vue            # 搜索弹层
│   ├── StatusBar.vue              # 底部状态栏（语言、行列位置、工作区模式）
│   ├── SaveDialog.vue             # 保存确认 / 另存为对话框
│   └── NewItemDialog.vue          # 新建文件 / 文件夹对话框
├── composables/
│   ├── useFileSystem.ts           # 文件操作 + 全局键盘快捷键
│   ├── useFileClipboard.ts        # 文件剪切 / 复制 / 粘贴
│   ├── useFileTreeContextMenu.ts  # 文件树右键菜单集成
│   ├── useEditor.ts               # Monaco 实例管理、文件打开
│   ├── useAgent.ts                # Agent 状态、流式输出、上下文组装
│   ├── useProviderSettings.ts     # LLM Provider 配置（持久化）
│   ├── useLLMSettings.ts          # 服务端 LLM 设置交互
│   ├── useMcpSettings.ts          # MCP 服务器列表
│   ├── useNaiveTheme.ts           # naive-ui 主题（dark/light/blue）映射
│   └── useWindowResize.ts         # 无边框窗口拖拽调整
├── services/
│   ├── fileService.ts             # 运行时环境检测 + 三模式文件客户端 + 工作区 API
│   ├── agentService.ts            # Agent REST / SSE 客户端
│   ├── configService.ts           # 配置 CRUD（Electron IPC / REST / localStorage）
│   ├── llmService.ts              # LLM Provider REST 客户端（/api/llm/*）
│   ├── mcpService.ts              # MCP 服务器 REST 客户端（/api/mcp/*）
│   ├── editParser.ts              # 重导出 @openwork/agent 的 parseEditsFromText
│   ├── editorInstance.ts          # Monaco 编辑器单例持有
│   ├── markdown.ts                # Markdown 渲染（markdown-it + KaTeX）
│   └── logger.ts                  # 前端结构化日志
├── stores/
│   ├── editor.ts                  # Pinia：标签页、文件树、工作区、ViewMode
│   ├── sessions.ts                # Pinia：多会话 Agent 聊天管理
│   └── settings.ts                # Pinia：语言 + 主题
├── locales/                       # vue-i18n（en / zh / index）
└── types/mcp-ui.ts               # MCP UI 相关类型
```

## 架构与数据流

```
用户交互 → Vue 组件（展示层）
            │ emit / 调用方法
            ▼
        MainLayout.vue（编排层）
            │ 调用 composable / store
            ▼
   Composables + Pinia Store（逻辑 + 响应式状态）
            │ 调用 service
            ▼
        Services（I/O + API）
            │
            ▼
   外部世界（Electron IPC / 服务端 REST·SSE / 浏览器 FSA）
```

- **状态唯一来源**：Pinia `useEditorStore`（标签页、文件树、工作区），`useSessionsStore`（Agent 会话），`useSettingsStore`（语言 / 主题）
- **编辑器单例**：`editorInstance.ts` 在组件间共享 Monaco 实例
- **Agent**：统一通过 `agentService` 调用服务端 `/api/agent/stream`（SSE），前端不再内置本地 Agent 循环

## Store 层 —— `stores/editor.ts`

| 状态 | 说明 |
|------|------|
| `tabs` / `activeTabId` / `activeTab` | 已打开标签页与当前活动标签 |
| `fileTreeNodes` | 文件树节点 |
| `workspaceRoots` / `workspaceRoot` | 工作区根（支持多根，`workspaceRoot` 取首个） |
| `workspaceMode` | 工作区模式（`'local'` / `'server'`） |
| `activeWorkspaceId` | 当前服务端工作区 ID |
| `isSingleFile` | 单文件模式标记 |

每个 `EditorTab` 含 `viewMode`（`code` / `image` / `docx` / `excel` / `pptx` / `pdf` / `html` / `markdown`），由文件扩展名决定使用哪个渲染器。
操作：`openFile`、`newUntitled`、`closeTab`、`updateContent`、`saveTab`、`setActiveTab`、`setTabPath`、`addWorkspaceRoot`、`enterSingleFileMode` / `exitSingleFileMode`。

## 运行时环境适配 —— `services/fileService.ts`

`detectEnvironment()` 按 **electron → browser → server** 的顺序一次性检测并缓存，所有文件操作通过统一的 `FileServiceClient` 接口执行，上层组件无需感知底层差异。

| 环境 | 检测条件 | 文件系统实现 |
|------|----------|--------------|
| Electron | `window.electronAPI` 存在 | `createElectronClient()` —— IPC 桥接主进程 |
| Browser | `window.showDirectoryPicker` 存在 | `createBrowserLocalClient()` —— File System Access API（含 2 秒目录缓存） |
| Server | 以上均无 | `createServerClient()` —— HTTP `/api/files/*` |

`FileServiceClient` 同时定义工作区相关方法（`openWorkspace` / `updateWorkspace` / `getWorkspaceSessions` 等），用于服务端模式下的工作区与 Agent 会话持久化。

## 开发与构建

```bash
npm run dev -w packages/web        # Vite 开发服务器（http://localhost:5173）
npm run build -w packages/web      # 构建到 packages/web/dist/
npm run typecheck -w packages/web  # vue-tsc -b 类型检查
```

> 注意：本包为 `"type": "module"` 且 `tsconfig` 设置了 `noEmit`，类型检查使用 `vue-tsc`（而非 `tsc`）。Vite 配置中 `@` 别名指向 `src/`，`monaco-editor` 已加入 `optimizeDeps.include`。
