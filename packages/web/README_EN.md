# @openwork/web

> [中文](README.md)

OpenWork frontend — an AI-assisted code editor built on Vue 3 + Vite + Monaco Editor + Pinia, using the naive-ui component library and vue-i18n for internationalization.

## Tech stack

| Tech | Purpose |
|------|---------|
| Vue 3 (Composition API) | UI framework |
| Vite | Build / dev server (port 5173, proxies `/api` to `:20385`) |
| Monaco Editor | Code editor |
| Pinia | State management |
| naive-ui | UI component library |
| vue-i18n | Chinese / English i18n |
| markdown-it + KaTeX | Agent message Markdown / math rendering |
| `@vue-office/*` / docx-preview | Excel / PPTX / Word document preview |

> The only workspace dependency is **`@openwork/agent`** (mainly for types). The frontend does not run the agent loop itself — it calls the server over SSE.

## Directory layout

```
src/
├── main.ts                       # App entry (createApp + Pinia + i18n + naive-ui)
├── App.vue                       # Root component
├── env.d.ts                      # Type decls (.vue modules, window.electronAPI, FSA API)
├── components/
│   ├── layout/                    # MainLayout (orchestrator), SideBar, RightToolbar, AboutDialog
│   ├── toolbar/Toolbar.vue        # Top toolbar (File menu, window controls)
│   ├── editor/                    # MonacoEditor + viewers: Image/Pdf/Docx/Excel/Pptx/Markdown/Html
│   ├── file-tree/                 # FileTree, TreeNode, contextMenu.ts
│   ├── new-file-tree/             # Newer file tree (NewFileTree / NewFileTreeMenu / types)
│   ├── agent/                     # AgentPanel, ModeSelector, ProviderSelect, SettingsDialog
│   ├── mcp/                       # McpSettingsPanel, McpServerItem, McpEditDialog, McpToolList
│   ├── settings/                  # SettingsModal, GeneralSettings, ProviderSettingsSection, McpSettingsContent
│   ├── dialogs/                   # OpenFileDialog, OpenFolderDialog
│   ├── SearchPanel.vue / SearchPopup.vue   # Search (results grouped by file)
│   ├── StatusBar.vue              # Status bar (language, cursor, workspace mode)
│   ├── SaveDialog.vue             # Save / Save-As dialog
│   └── NewItemDialog.vue          # New file / folder dialog
├── composables/
│   ├── useFileSystem.ts           # File operations + global keyboard shortcuts
│   ├── useFileClipboard.ts        # File cut / copy / paste
│   ├── useFileTreeContextMenu.ts  # File-tree context-menu integration
│   ├── useEditor.ts               # Monaco instance management, file opening
│   ├── useAgent.ts                # Agent state, streaming, context assembly
│   ├── useProviderSettings.ts     # LLM provider config (persisted)
│   ├── useLLMSettings.ts          # Server-side LLM settings
│   ├── useMcpSettings.ts          # MCP server list
│   ├── useNaiveTheme.ts           # naive-ui theme (dark/light/blue) mapping
│   └── useWindowResize.ts         # Frameless window drag-resize
├── services/
│   ├── fileService.ts             # Runtime detection + 3 file clients + workspace API
│   ├── agentService.ts            # Agent REST / SSE client
│   ├── configService.ts           # Config CRUD (Electron IPC / REST / localStorage)
│   ├── llmService.ts              # LLM provider REST client (/api/llm/*)
│   ├── mcpService.ts              # MCP server REST client (/api/mcp/*)
│   ├── editorInstance.ts          # Monaco editor singleton holder
│   ├── markdown.ts                # Markdown rendering (markdown-it + KaTeX)
│   └── logger.ts                  # Frontend structured logging
├── stores/
│   ├── editor.ts                  # Pinia: tabs, file tree, workspace, ViewMode
│   ├── sessions.ts                # Pinia: multi-session agent chat
│   └── settings.ts                # Pinia: language + theme
├── locales/                       # vue-i18n (en / zh / index)
└── types/mcp-ui.ts               # MCP UI types
```

## Architecture & data flow

```
User interaction → Vue components (presentation)
                     │ emit / call methods
                     ▼
                 MainLayout.vue (orchestration)
                     │ call composables / store
                     ▼
            Composables + Pinia Store (logic + reactive state)
                     │ call services
                     ▼
                 Services (I/O + API)
                     │
                     ▼
        Outside world (Electron IPC / server REST·SSE / browser FSA)
```

- **Single source of truth**: Pinia `useEditorStore` (tabs, file tree, workspace), `useSessionsStore` (agent sessions), `useSettingsStore` (language / theme)
- **Editor singleton**: `editorInstance.ts` shares the Monaco instance across components
- **Agent**: all calls go through `agentService` to the server's `/api/agent/stream` (SSE); there is no built-in local agent loop anymore

## Store layer — `stores/editor.ts`

| State | Purpose |
|-------|---------|
| `tabs` / `activeTabId` / `activeTab` | Open tabs and the active one |
| `fileTreeNodes` | File-tree nodes |
| `workspaceRoots` / `workspaceRoot` | Workspace roots (multi-root; `workspaceRoot` is the first) |
| `workspaceMode` | Workspace mode (`'local'` / `'server'`) |
| `activeWorkspaceId` | Current server workspace ID |
| `isSingleFile` | Single-file mode flag |

Each `EditorTab` carries a `viewMode` (`code` / `image` / `docx` / `excel` / `pptx` / `pdf` / `html` / `markdown`), chosen by file extension to pick the renderer.
Actions: `openFile`, `newUntitled`, `closeTab`, `updateContent`, `saveTab`, `setActiveTab`, `setTabPath`, `addWorkspaceRoot`, `enterSingleFileMode` / `exitSingleFileMode`.

## Runtime environment adaptation — `services/fileService.ts`

`detectEnvironment()` detects and caches the runtime once, in the order **electron → browser → server**. All file operations go through the uniform `FileServiceClient` interface, so upper components never branch on the environment.

| Environment | Detection | File-system implementation |
|-------------|-----------|----------------------------|
| Electron | `window.electronAPI` present | `createElectronClient()` — IPC bridge to main process |
| Browser | `window.showDirectoryPicker` present | `createBrowserLocalClient()` — File System Access API (2s dir cache) |
| Server | none of the above | `createServerClient()` — HTTP `/api/files/*` |

`FileServiceClient` also defines workspace methods (`openWorkspace` / `updateWorkspace` / `getWorkspaceSessions`, …) used for workspace and agent-session persistence in server mode.

## Develop & build

```bash
npm run dev -w packages/web        # Vite dev server (http://localhost:5173)
npm run build -w packages/web      # Build to packages/web/dist/
npm run typecheck -w packages/web  # vue-tsc -b type check
```

> Note: this package is `"type": "module"` and its `tsconfig` sets `noEmit`, so type checking uses `vue-tsc` (not plain `tsc`). The Vite config aliases `@` → `src/`, and `monaco-editor` is in `optimizeDeps.include`.
