# @openwork/agent

> [English](README_EN.md)

OpenWork 独立 AI Agent 框架 —— 提供统一的 Agent 运行时、LLM 提供商管理、多轮工具调用循环、MCP 客户端与编辑执行能力。

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
├── tools/
│   ├── index.ts        # createDefaultTools() —— 5 个默认工具
│   ├── read-file.ts    # <read_file>   读取文件
│   ├── list-dir.ts     # <list_dir>    列目录
│   ├── search-code.ts  # <search_code> 搜索代码
│   ├── bash.ts         # <bash>        执行 shell 命令
│   └── delegate.ts     # <delegate>    委派子 Agent
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
├── openai-client.ts    # createOpenAILLMProvider() / buildMessages() / resolveLLMConfig()
├── executor.ts         # executeEdits() / revertEdits() —— 编辑应用与回滚
├── parser.ts           # parseEditsFromText() —— 解析 <edit path="...">…</edit>
├── logger.ts           # createLogger() / runWithContext() —— 结构化日志
├── log-categories.ts   # LOG_CATEGORY 日志分类常量
├── cli.ts              # 交互式 CLI Agent（支持 MCP 工具）
└── types/              # 类型定义（agent / message / filesystem / tool / provider / edit）
```

## 公共 API（`index.ts`）

| 导出 | 来源 | 说明 |
|------|------|------|
| `AgentRuntime` | `runtime.ts` | **统一入口**：封装 plan/build 模式、会话管理与 MCP |
| `AgentRuntimeConfig` / `AgentRuntimeEvent` / `ChatResult` | `runtime.ts` | Runtime 配置与流式事件类型 |
| `executeEdits` / `revertEdits` / `ExecutionResult` | `executor.ts` | 批量应用 / 回滚 AI 生成的文件编辑 |
| `parseEditsFromText` / `ParsedEdit` | `parser.ts` | 从 LLM 回复中解析 `<edit>` 块 |
| `LLMGateway` / `maskApiKey` / `LLMProvider` / `LLMSettings` | `llm/gateway.ts` | LLM 提供商配置管理（持久化） |
| `McpManager` / `McpToolInfo` | `mcp/manager.ts` | MCP 多服务器连接管理 |
| MCP 配置类型 | `mcp/config.ts` | `McpServerConfig` / `McpConfig` / `McpServerEntry` 等 |
| `createLogger` / `runWithContext` / `Logger` | `logger.ts` | 结构化日志 |
| `LOG_CATEGORY` / `LogCategory` | `log-categories.ts` | 日志分类 |
| 核心类型 | `types/*` | `AgentContext` / `SessionMessage` / `AgentEditResult` / `IAgentFileSystem` / `ITool` 等 |

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
| `applyEdits()` | 通过 `executeEdits` 将编辑写入文件系统 |
| 默认文件系统 | 内置 `IAgentFileSystem`，对路径做 `resolve → startsWith` 越权校验 |

**流式事件**（`AgentRuntimeEvent.type`）：`chunk` / `thinking` / `tool_start` / `tool_end` / `tool_result` / `done` / `error`。

### Agent + Session（`agent.ts` / `session.ts`）

- `Agent`：单个智能体的多轮循环 —— 构建系统提示词 → 调用 LLM → 解析工具调用 → 执行工具 → 反馈结果 → 下一轮，直至无工具调用或达到 `maxTurns`。
- `Session`：编排主 Agent，并通过 `<delegate>` 标签把子任务委派给子 Agent；提供 `start()` / `startStream()`。

### 默认工具（`tools/`）

`createDefaultTools()` 返回 5 个工具：

| 工具 | 标签 | 说明 |
|------|------|------|
| `ReadFileTool` | `<read_file path="..."/>` | 读取文件 |
| `ListDirTool` | `<list_dir path="..."/>` | 列出目录内容 |
| `SearchCodeTool` | `<search_code pattern="..."/>` | 搜索代码 |
| `BashTool` | `<bash>...</bash>` | 执行 shell 命令 |
| `DelegateTool` | `<delegate>...</delegate>` | 委派子 Agent |

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
import { AgentRuntime, executeEdits } from '@openwork/agent';

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

// 3. 应用解析出的编辑
if (result.edits.length > 0) {
  await runtime.applyEdits(
    result.edits.map(e => ({ path: e.path, operation: 'modify', content: e.content }))
  );
}
```

## 技术细节

- **TypeScript 严格模式**，编译目标 ES2022，生成声明文件与 Source Map
- 通过 `package.json` 的 `exports` 字段同时支持 ESM 与 CJS 引用
- 构建：`npm run build -w packages/agent`（`tsc`）；监听：`npm run dev -w packages/agent`
- CLI：根目录 `npm run cli`；通过 `npm run cli -- --url <apiUrl> --model <model> --key <apiKey>` 传入待测模型（也可用环境变量 `LLM_API_URL`/`LLM_MODEL`/`LLM_API_KEY`）
