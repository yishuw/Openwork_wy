# @openwork/agent

> [中文](README.md)

Standalone AI agent framework for OpenWork — a unified agent runtime, LLM provider management, multi-turn tool-calling loop, MCP client, and edit execution.

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
├── tools/              # 7 default tools (file_edit, file_write, read_file, list_dir, search_code, bash, delegate)
├── mcp/                # McpManager, MCPClient, MCPToolAdapter, ToolCatalog, config
├── llm/                # LLMGateway — provider CRUD + persistence (llm-settings.json)
├── openai-client.ts    # createOpenAILLMProvider() / buildMessages() / resolveLLMConfig()
├── parser.ts           # parseToolCalls() — parses tool-call blocks from an LLM reply
├── logger.ts           # createLogger() / runWithContext()
├── log-categories.ts   # LOG_CATEGORY constants
├── cli.ts              # Interactive CLI agent (MCP-aware)
└── types/              # Type definitions (agent / message / filesystem / tool / provider / edit)
```

## Public API (`index.ts`)

| Export | Source | Purpose |
|--------|--------|---------|
| `AgentRuntime` | `runtime.ts` | **Unified entry**: wraps plan/build modes, session management, and MCP |
| `AgentRuntimeConfig` / `AgentRuntimeEvent` / `ChatResult` | `runtime.ts` | Runtime config and streaming event types |
| `parseToolCalls` / `ParsedTool` | `parser.ts` | Parse tool-call blocks from an LLM reply |
| `LLMGateway` / `maskApiKey` / `LLMProvider` / `LLMSettings` | `llm/gateway.ts` | LLM provider configuration management (persisted) |
| `McpManager` / `McpToolInfo` | `mcp/manager.ts` | MCP multi-server connection management |
| MCP config types | `mcp/config.ts` | `McpServerConfig` / `McpConfig` / `McpServerEntry`, etc. |
| `createLogger` / `runWithContext` / `Logger` | `logger.ts` | Structured logging |
| `LOG_CATEGORY` / `LogCategory` | `log-categories.ts` | Log categories |
| Core types | `types/*` | `AgentContext` / `SessionMessage` / `AgentEditResult` / `IAgentFileSystem` / `ITool`, etc. |

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

`createDefaultTools()` returns 5 tools:

| Tool | Tag | Purpose |
|------|-----|---------|
| `ReadFileTool` | `<read_file path="..."/>` | Read a file |
| `ListDirTool` | `<list_dir path="..."/>` | List directory contents |
| `SearchCodeTool` | `<search_code pattern="..."/>` | Search code |
| `BashTool` | `<bash>...</bash>` | Run a shell command |
| `DelegateTool` | `<delegate>...</delegate>` | Delegate to a sub-agent |

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
