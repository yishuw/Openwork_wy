# @openwork/agent

> [English](README_EN.md)

OpenWork 独立 AI Agent 框架 —— 提供统一的 Agent 运行时、LLM 提供商管理、多轮工具调用循环、MCP 客户端与文件操作/任务执行能力。它是 OpenWork 通用 AI 办公辅助工作台的核心：Agent 通过工具读写文件、执行命令、调用外部 MCP 工具，完成用户以自然语言下达的任务。

## 设计原则

- **平台无关**：通过 `IAgentFileSystem` 接口（`readFile` / `writeFile` / `exists` / `readDir`）解耦文件系统，可在 Node.js 服务端或 Electron 主进程中运行
- **零工作区依赖**：不依赖任何其它 `@openwork/*` 包，仅依赖 `openai` SDK 与 MCP SDK
- **统一入口**：对外只暴露 `AgentRuntime` 等少量公共 API，内部实现（`Agent` / `Session` / 工具等）不直接暴露

## 依赖

| 包 | 用途 |
|----|------|
| `openai` (v6) | OpenAI 兼容 Chat Completions 调用 |
| `@modelcontextprotocol/sdk` | MCP 客户端（STDIO / SSE / HTTP 传输） |

## 目录结构

```
src/
├── index.ts            # 公共 API 统一导出入口
├── runtime.ts          # AgentRuntime —— 对外统一入口（plan/build、会话管理、MCP）
├── agent.ts            # Agent —— 单 Agent 多轮工具调用循环
├── session.ts          # Session —— 主/子 Agent 编排、<delegate> 委派、流式
├── tool-registry.ts    # ToolRegistry —— 工具注册、查找、系统提示生成
├── parser.ts           # parseToolCalls() —— 解析 LLM 回复中的工具调用（XML 块）
├── openai-client.ts    # createOpenAILLMProvider() / buildMessages() / resolveLLMConfig()
├── logger.ts           # createLogger() / runWithContext() —— 结构化日志
├── log-categories.ts   # LOG_CATEGORY 日志分类常量
├── cli.ts              # 交互式 CLI Agent（支持 MCP 工具）
├── tools/              # 7 个默认工具（每个工具一个目录：实现 + prompt + 导出）
│   ├── index.ts        # createDefaultTools() —— 默认工具集工厂
│   ├── file-edit/      # FileEditTool —— 修改现有文件（diff 语义）
│   ├── file-write/     # FileWriteTool —— 新建或整文件重写
│   ├── file-read/      # FileReadTool —— 读取文件
│   ├── list-dir/       # ListDirTool —— 列目录
│   ├── search-code/    # SearchCodeTool —— 正则搜索文件内容
│   ├── bash/           # BashTool —— 执行 shell 命令（可关闭）
│   ├── delegate/       # DelegateTool —— 委派子 Agent
│   └── _shared/path.ts # 工具间共享的路径工具函数
├── mcp/
│   ├── manager.ts      # McpManager —— 多服务器生命周期、工具发现与路由
│   ├── client.ts       # MCPClient  —— 单服务器连接（initialize/list/call）
│   ├── adapter.ts      # MCPToolAdapter —— 将 MCP 工具桥接为 ITool
│   ├── config.ts       # McpConfig / McpServerConfig / McpServerEntry 类型
│   ├── tool-catalog.ts # ToolCatalog —— 只读工具元数据存储
│   └── utils.ts        # MCP 结果格式化、XML usage 构建
├── llm/
│   ├── index.ts        # 重导出 LLMGateway 等
│   └── gateway.ts      # LLMGateway —— LLM 提供商 CRUD + 持久化（llm-settings.json）
├── memory/
│   ├── SessionMemory.ts # SessionMemory —— 会话记忆（消息 / 工具调用记录 / Token 预算）
│   ├── types.ts        # MemoryEntry / ToolCallRecord / IDESnapshot / DisplayMessage 等类型
│   └── index.ts        # 重导出
└── types/              # 类型定义（agent / message / filesystem / tool / provider）
```

## 公共 API（`index.ts`）

| 导出 | 来源 | 说明 |
|------|------|------|
| `AgentRuntime` | `runtime.ts` | **统一入口**：封装 plan/build 模式、会话管理与 MCP |
| `AgentRuntimeConfig` / `AgentRuntimeEvent` / `ChatResult` | `runtime.ts` | Runtime 配置与流式事件类型 |
| `parseToolCalls` / `ParsedTool` | `parser.ts` | 从 LLM 回复中解析工具调用块 |
| `LLMGateway` / `maskApiKey` / `LLMProvider` / `LLMSettings` | `llm/gateway.ts` | LLM 提供商配置管理（持久化） |
| `createOpenAILLMProvider` / `buildMessages` / `resolveLLMConfig` | `openai-client.ts` | OpenAI 兼容 Provider 工厂与消息构建 |
| `McpManager` / `McpToolInfo` | `mcp/manager.ts` | MCP 多服务器连接管理 |
| MCP 配置类型 | `mcp/config.ts` | `McpServerConfig` / `McpConfig` / `McpServerEntry` 等 |
| `SessionMemory` 及其类型 | `memory/` | 会话记忆：`MemoryEntry` / `ToolCallRecord` / `IDESnapshot` / `DisplayMessage` 系列 |
| `CHARS_PER_TOKEN` / `DEFAULT_MEMORY_TOKEN_BUDGET` | `memory/` | Token 预算常量 |
| `createLogger` / `runWithContext` / `Logger` | `logger.ts` | 结构化日志 |
| `LOG_CATEGORY` / `LogCategory` | `log-categories.ts` | 日志分类 |
| 核心类型 | `types/*` | `AgentContext` / `AgentResult` / `SessionMessage` / `IAgentFileSystem` / `ITool` 等 |

> 未列在 `index.ts` 中的导出（`Agent`、`Session`、`ToolRegistry`、各 `Tool` 等）属于内部实现，不应被外部直接引用。

## 核心模块

### AgentRuntime（`runtime.ts`）

对外的唯一推荐入口。一个 `AgentRuntime` 实例绑定一个工作区根目录，内部按 `sessionId` 缓存多个 `Session`。

| 能力 | 说明 |
|------|------|
| `chat()` / `chatStream()` | 一次性 / SSE 流式对话 |
| **plan 模式** | 直接调用 LLM（`createOpenAILLMProvider` + `buildMessages`），不调用工具，默认 `maxTurns=10` |
| **build 模式** | 创建 `Agent` + `Session`，多轮自主工具调用循环，默认 `maxTurns=20` |
| MCP | `build` 模式下按 `mcpServers` 连接 MCP 服务器并把工具注入 Agent；支持 `reinitialize()` 热更新 |
| 会话管理 | `getSessionMessages` / `restoreSession` / `getSessionIds` / `deleteSession` |
| 文件系统 | 未显式传入 `fileSystem` 时，按 `workspaceRoot` 创建带路径穿越防护的默认实现 |
| 默认文件系统 | 内置 `IAgentFileSystem`，对路径做 `resolve → startsWith` 越权校验 |

**流式事件**（`AgentRuntimeEvent.type`）：`chunk` / `thinking` / `tool_start` / `tool_end` / `tool_result` / `done` / `error`。

### Agent + Session（`agent.ts` / `session.ts`）

- `Agent`：单个智能体的多轮循环 —— 构建系统提示词 → 调用 LLM → 解析工具调用 → 执行工具 → 反馈结果 → 下一轮，直至无工具调用或达到 `maxTurns`。
- `Session`：编排主 Agent，并通过 `<delegate>` 标签把子任务委派给子 Agent；提供 `start()` / `startStream()`。

### 默认工具（`tools/`）

`createDefaultTools()` 返回 7 个工具（`enableBash: false` 时不注册 bash）。工具顺序即注册顺序，也即系统提示词中呈现给 LLM 的顺序——高频/首选工具靠前：

| 工具 | 标签 | 说明 |
|------|------|------|
| `FileEditTool` | `<file_edit path="...">` | 修改现有文件（diff 语义，需先 `read_file`） |
| `FileWriteTool` | `<file_write path="...">` | 新建文件或整文件重写（覆盖已有文件需先 `read_file`） |
| `FileReadTool` | `<read_file path="..."/>` | 读取文件（编辑类工具的前置校验依据） |
| `ListDirTool` | `<list_dir path="..."/>` | 列出目录内容 |
| `SearchCodeTool` | `<search_code pattern="..."/>` | 按正则递归搜索文件内容（跳过 node_modules/.git/dist/.openwork） |
| `BashTool` | `<bash>...</bash>` | 执行 shell 命令（可通过 `enableBash` / `OPENWORK_ENABLE_BASH=0` 关闭） |
| `DelegateTool` | `<delegate>...</delegate>` | 委派子 Agent（由 Session 拦截并实际启动） |

### SessionMemory（`memory/`）

会话记忆模块：记录消息与工具调用记录（`MemoryEntry` / `ToolCallRecord`），按 `CHARS_PER_TOKEN` 估算 Token 用量并受 `DEFAULT_MEMORY_TOKEN_BUDGET` 预算约束，提供 `IDESnapshot`（打开文件、文件树、光标/选区）与面向 UI 的 `DisplayMessage` 系列展示类型。

### LLM Gateway（`llm/gateway.ts`）

`LLMGateway` 管理 LLM 提供商配置（`LLMProvider`），支持增删改查、设置活跃提供商、连通性/模型列表测试，并持久化到 `configDir/llm-settings.json`。`maskApiKey()` 用于在返回时脱敏 API Key。

### MCP 客户端（`mcp/`）

| 类 | 说明 |
|----|------|
| `McpManager` | 多服务器生命周期管理：`connectAll` → `discoverAndCreateAdapters` → 路由调用 → `disconnectAll` |
| `MCPClient` | 单服务器连接（initialize / `tools/list` / `tools/call`） |
| `MCPToolAdapter` | 将 MCP `tools/call` 桥接为 `ITool`，含参数类型自动转换 |
| `ToolCatalog` | 只读扁平工具元数据存储，用于展示 / CLI 输出 |

传输模式：**STDIO**（本地子进程）/ **HTTP**（无状态 POST）/ **SSE**（自动提取 `Mcp-Session-Id`）。

## 使用示例

```typescript
import { AgentRuntime } from '@openwork/agent';

// 1. 创建 Runtime（build 模式：多轮工具循环）
const runtime = new AgentRuntime({
  mode: 'build',
  provider: { apiUrl: 'https://api.openai.com/v1', apiKey: 'sk-...', model: 'gpt-4o' },
  workspaceRoot: '/path/to/project',
  // mcpServers: [...]  // 可选，build 模式下连接 MCP
});

// 2. 流式对话
const result = await runtime.chatStream(
  '帮我实现登录功能',
  { openFiles: [{ path: 'src/app.ts', content: '...' }], fileTree: '...' },
  (event) => {
    if (event.type === 'chunk') process.stdout.write(event.text ?? '');
  }
);
```

## 技术细节

- **TypeScript 严格模式**，编译目标 ES2022，生成声明文件与 Source Map
- 通过 `package.json` 的 `exports` 字段同时支持 ESM 与 CJS 引用
- 构建：`npm run build -w packages/agent`（`tsc`）；监听：`npm run dev -w packages/agent`
- CLI：根目录 `npm run cli`；通过 `npm run cli -- --url <apiUrl> --model <model> --key <apiKey>` 传入待测模型（也可用环境变量 `LLM_API_URL`/`LLM_MODEL`/`LLM_API_KEY`）
- 测试：vitest（`packages/agent/test/`，`npm test`）—— SessionMemory / createDefaultTools / maskApiKey 共 16 个用例
