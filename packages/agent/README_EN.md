# @openwork/agent

> [中文](README.md)

Standalone AI agent framework for OpenWork — a unified agent runtime, LLM provider management, multi-turn tool-calling loop, MCP client, and file-operation/task-execution capabilities. It is the core of the OpenWork general-purpose AI office workbench: the agent reads/writes files, runs commands, and calls external MCP tools to complete tasks given in natural language.

## Design principles

- **Platform-agnostic**: decoupled from the file system via the `IAgentFileSystem` interface (`readFile` / `writeFile` / `exists` / `readDir`), runnable inside a Node.js server or the Electron main process
- **No workspace dependencies**: depends on no other `@openwork/*` package — only the `openai` SDK and the MCP SDK
- **Single entry point**: only a small public surface (`AgentRuntime` etc.) is exported; internals (`Agent` / `Session` / tools) are not exposed directly

## Dependencies

| Package | Purpose |
|---------|---------|
| `openai` (v6) | OpenAI-compatible Chat Completions calls |
| `@modelcontextprotocol/sdk` | MCP client (STDIO / SSE / HTTP transports) |

## Directory layout

```
src/
├── index.ts            # Public API barrel
├── runtime.ts          # AgentRuntime — unified entry (plan/build, sessions, MCP)
├── agent.ts            # Agent — single-agent multi-turn tool loop
├── session.ts          # Session — main/sub-agent orchestration, <delegate>, streaming
├── tool-registry.ts    # ToolRegistry — registration, lookup, system-prompt generation
├── parser.ts           # parseToolCalls() — parses tool-call blocks from an LLM reply
├── openai-client.ts    # createOpenAILLMProvider() / buildMessages() / resolveLLMConfig()
├── logger.ts           # createLogger() / runWithContext() — structured logging
├── log-categories.ts   # LOG_CATEGORY constants
├── cli.ts              # Interactive CLI agent (MCP-aware)
├── tools/              # 7 default tools (one directory per tool: implementation + prompt + export)
│   ├── index.ts        # createDefaultTools() — default tool-set factory
│   ├── file-edit/      # FileEditTool — modify an existing file (diff semantics)
│   ├── file-write/     # FileWriteTool — create or fully rewrite a file
│   ├── file-read/      # FileReadTool — read a file
│   ├── list-dir/       # ListDirTool — list directory contents
│   ├── search-code/    # SearchCodeTool — regex search over file contents
│   ├── bash/           # BashTool — run a shell command (can be disabled)
│   ├── delegate/       # DelegateTool — delegate to a sub-agent
│   └── _shared/path.ts # Shared path utilities for tools
├── mcp/
│   ├── manager.ts      # McpManager — multi-server lifecycle, tool discovery & routing
│   ├── client.ts       # MCPClient — single-server connection (initialize/list/call)
│   ├── adapter.ts      # MCPToolAdapter — bridges an MCP tool to ITool
│   ├── config.ts       # McpConfig / McpServerConfig / McpServerEntry types
│   ├── tool-catalog.ts # ToolCatalog — read-only tool-metadata store
│   └── utils.ts        # MCP result formatting, XML usage building
├── llm/
│   ├── index.ts        # Re-exports LLMGateway etc.
│   └── gateway.ts      # LLMGateway — provider CRUD + persistence (llm-settings.json)
├── memory/
│   ├── SessionMemory.ts # SessionMemory — messages / tool-call records / token budget
│   ├── types.ts        # MemoryEntry / ToolCallRecord / IDESnapshot / DisplayMessage types
│   └── index.ts        # Re-exports
└── types/              # Type definitions (agent / message / filesystem / tool / provider)
```

## Public API (`index.ts`)

| Export | Source | Purpose |
|--------|--------|---------|
| `AgentRuntime` | `runtime.ts` | **Unified entry**: wraps plan/build modes, session management, and MCP |
| `AgentRuntimeConfig` / `AgentRuntimeEvent` / `ChatResult` | `runtime.ts` | Runtime config and streaming event types |
| `parseToolCalls` / `ParsedTool` | `parser.ts` | Parse tool-call blocks from an LLM reply |
| `LLMGateway` / `maskApiKey` / `LLMProvider` / `LLMSettings` | `llm/gateway.ts` | LLM provider configuration management (persisted) |
| `createOpenAILLMProvider` / `buildMessages` / `resolveLLMConfig` | `openai-client.ts` | OpenAI-compatible provider factory & message builder |
| `McpManager` / `McpToolInfo` | `mcp/manager.ts` | MCP multi-server connection management |
| MCP config types | `mcp/config.ts` | `McpServerConfig` / `McpConfig` / `McpServerEntry`, etc. |
| `SessionMemory` and its types | `memory/` | Session memory: `MemoryEntry` / `ToolCallRecord` / `IDESnapshot` / `DisplayMessage` family |
| `CHARS_PER_TOKEN` / `DEFAULT_MEMORY_TOKEN_BUDGET` | `memory/` | Token-budget constants |
| `createLogger` / `runWithContext` / `Logger` | `logger.ts` | Structured logging |
| `LOG_CATEGORY` / `LogCategory` | `log-categories.ts` | Log categories |
| Core types | `types/*` | `AgentContext` / `AgentResult` / `SessionMessage` / `IAgentFileSystem` / `ITool`, etc. |

> Exports not listed in `index.ts` (`Agent`, `Session`, `ToolRegistry`, individual tools, …) are internal and should not be imported directly.

## Core modules

### AgentRuntime (`runtime.ts`)

The single recommended entry point. One `AgentRuntime` instance is bound to a workspace root and caches multiple `Session`s keyed by `sessionId`.

| Capability | Notes |
|------------|-------|
| `chat()` / `chatStream()` | One-shot / SSE streaming conversation |
| **plan mode** | Calls the LLM directly (`createOpenAILLMProvider` + `buildMessages`), no tools, default `maxTurns=10` |
| **build mode** | Creates `Agent` + `Session`, runs the autonomous multi-turn tool loop, default `maxTurns=20` |
| MCP | In `build` mode connects MCP servers from `mcpServers` and injects their tools; `reinitialize()` for hot reload |
| Sessions | `getSessionMessages` / `restoreSession` / `getSessionIds` / `deleteSession` |
| File system | When no `fileSystem` is provided, a default implementation with path-traversal protection is created from `workspaceRoot` |

**Streaming events** (`AgentRuntimeEvent.type`): `chunk` / `thinking` / `tool_start` / `tool_end` / `tool_result` / `done` / `error`.

### Agent + Session (`agent.ts` / `session.ts`)

- `Agent`: a single agent's multi-turn loop — build system prompt → call LLM → parse tool calls → execute tools → feed results back → repeat, until no tool calls remain or `maxTurns` is reached.
- `Session`: orchestrates the main agent and delegates sub-tasks to sub-agents via the `<delegate>` tag; exposes `start()` / `startStream()`.

### Default tools (`tools/`)

`createDefaultTools()` returns 7 tools (bash is not registered when `enableBash: false`). The tool order is the registration order — also the order presented to the LLM in the system prompt, so high-frequency/preferred tools come first:

| Tool | Tag | Purpose |
|------|-----|---------|
| `FileEditTool` | `<file_edit path="...">` | Modify an existing file (diff semantics; requires a prior `read_file`) |
| `FileWriteTool` | `<file_write path="...">` | Create a file or fully rewrite one (overwriting requires a prior `read_file`) |
| `FileReadTool` | `<read_file path="..."/>` | Read a file (the read-first guard for edit tools) |
| `ListDirTool` | `<list_dir path="..."/>` | List directory contents |
| `SearchCodeTool` | `<search_code pattern="..."/>` | Recursively search file contents with a regex (skips node_modules/.git/dist/.openwork) |
| `BashTool` | `<bash>...</bash>` | Run a shell command (disable via `enableBash` / `OPENWORK_ENABLE_BASH=0`) |
| `DelegateTool` | `<delegate>...</delegate>` | Delegate to a sub-agent (intercepted by Session, which actually starts it) |

### SessionMemory (`memory/`)

Session memory module: records messages and tool-call records (`MemoryEntry` / `ToolCallRecord`), estimates token usage via `CHARS_PER_TOKEN` under the `DEFAULT_MEMORY_TOKEN_BUDGET` budget, and provides `IDESnapshot` (open files, file tree, cursor/selection) plus the `DisplayMessage` family of UI-facing display types.

### LLM Gateway (`llm/gateway.ts`)

`LLMGateway` manages LLM provider configurations (`LLMProvider`): CRUD, active-provider selection, connectivity/model-list testing, persisted to `configDir/llm-settings.json`. `maskApiKey()` redacts API keys in responses.

### MCP client (`mcp/`)

| Class | Purpose |
|-------|---------|
| `McpManager` | Multi-server lifecycle: `connectAll` → `discoverAndCreateAdapters` → routed calls → `disconnectAll` |
| `MCPClient` | Single-server connection (initialize / `tools/list` / `tools/call`) |
| `MCPToolAdapter` | Bridges an MCP `tools/call` to `ITool`, with automatic argument coercion |
| `ToolCatalog` | Read-only flat tool-metadata store for display / CLI output |

Transports: **STDIO** (local subprocess) / **HTTP** (stateless POST) / **SSE** (auto-extracts `Mcp-Session-Id`).

## Usage example

```typescript
import { AgentRuntime } from '@openwork/agent';

// 1. Create the runtime (build mode: multi-turn tool loop)
const runtime = new AgentRuntime({
  mode: 'build',
  provider: { apiUrl: 'https://api.openai.com/v1', apiKey: 'sk-...', model: 'gpt-4o' },
  workspaceRoot: '/path/to/project',
  // mcpServers: [...]  // optional, connected in build mode
});

// 2. Stream a conversation
const result = await runtime.chatStream(
  'Implement a login feature',
  { openFiles: [{ path: 'src/app.ts', content: '...' }], fileTree: '...' },
  (event) => {
    if (event.type === 'chunk') process.stdout.write(event.text ?? '');
  }
);
```

## Technical notes

- **TypeScript strict mode**, ES2022 target, declaration files and source maps emitted
- Supports both ESM and CJS imports via the `exports` field in `package.json`
- Build: `npm run build -w packages/agent` (`tsc`); watch: `npm run dev -w packages/agent`
- CLI: `npm run cli` from the repo root; pass the model under test via `npm run cli -- --url <apiUrl> --model <model> --key <apiKey>` (or env vars `LLM_API_URL`/`LLM_MODEL`/`LLM_API_KEY`)
- Tests: vitest (`packages/agent/test/`, `npm test`) — SessionMemory / createDefaultTools / maskApiKey, 16 cases
