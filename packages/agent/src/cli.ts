/**
 * Agent 命令行测试工具
 *
 * 用法:
 *   npx tsx cli.ts                          # Agent 对话模式（流式输出）
 *   npx tsx cli.ts --mcp                    # MCP 手动工具调用模式
 *   npx tsx cli.ts --list                   # 列出所有可用工具
 *   npx tsx cli.ts --no-mcp                 # 跳过 MCP，仅使用内置工具
 *   npx tsx cli.ts --config mcp-config.json # 指定 MCP 配置文件
 *   npx tsx cli.ts --root /path/to/project  # 设置工作目录
 *   npx tsx cli.ts --url <apiUrl> --model <model> --key <apiKey> # 指定 LLM 模型信息
 *
 * LLM 配置优先级: 命令行参数 (--url/--model/--key) > 环境变量 (LLM_API_URL/LLM_MODEL/LLM_API_KEY) > 内置默认值
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { AgentRuntime, type AgentRuntimeEvent, type AgentRuntimeConfig } from './runtime';
import type { AgentContext } from './types/agent';
import { McpManager } from './mcp/manager';
import { ToolCatalog } from './mcp/tool-catalog';
import type { McpConfig, McpServerEntry } from './mcp/config';
import type { McpToolInfo } from './mcp/manager';

// ====================== LLM 配置 ======================

interface ProviderConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

const DEFAULT_PROVIDER: ProviderConfig = {
  apiUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-v4-flash',
};

function resolveProviderConfig(args: CliArgs): ProviderConfig {
  const apiUrl = args.apiUrl || process.env.LLM_API_URL || DEFAULT_PROVIDER.apiUrl;
  const apiKey = args.apiKey || process.env.LLM_API_KEY || DEFAULT_PROVIDER.apiKey;
  const model = args.model || process.env.LLM_MODEL || DEFAULT_PROVIDER.model;

  if (!apiKey) {
    console.error('\n❌ 缺少 API Key。请通过 --key <apiKey> 传入，或设置环境变量 LLM_API_KEY。');
    console.error('   示例: npm run cli -- --url https://api.deepseek.com/v1 --model deepseek-v4-flash --key sk-xxx\n');
    process.exit(1);
  }

  return { apiUrl, apiKey, model };
}

function buildRuntimeConfig(provider: ProviderConfig, workDir: string, mcpServers?: McpServerEntry[]): AgentRuntimeConfig {
  return {
    mode: 'build',
    provider,
    workspaceRoot: workDir,
    mcpServers,
  };
}

// ====================== MCP 集成 ======================

function findConfigPath(explicitPath?: string): string | null {
  if (explicitPath) return fs.existsSync(explicitPath) ? explicitPath : null;

  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'mcp-config.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadMcpServers(configPath?: string): McpServerEntry[] {
  const resolvedPath = findConfigPath(configPath);
  if (!resolvedPath) return [];

  const raw = fs.readFileSync(resolvedPath, 'utf-8');
  const config: McpConfig = JSON.parse(raw);
  console.log(`[MCP] Using config: ${resolvedPath}`);

  return Object.entries(config.mcpServers).map(([id, cfg]) => ({
    id,
    name: cfg.name || id,
    enabled: true,
    config: cfg,
  }));
}

async function createMcpManager(entries: McpServerEntry[]): Promise<{ manager: McpManager; tools: McpToolInfo[] } | null> {
  if (entries.length === 0) return null;
  const mcpConfig: McpConfig = { mcpServers: {} };
  for (const e of entries) mcpConfig.mcpServers[e.id] = e.config;

  const manager = new McpManager();
  await manager.connectAll(mcpConfig);
  const tools = await manager.collectTools();
  return { manager, tools };
}

// ====================== Agent 对话模式 ======================

function buildContext(): AgentContext {
  return {
    openFiles: [],
    fileTree: [],
    conversationHistory: [],
    cursorPosition: { file: '', line: 0, column: 0 },
  };
}

async function runAgentLoop(provider: ProviderConfig, mcpManager: McpManager | null, mcpServers: McpServerEntry[], workDir: string): Promise<void> {
  const runtime = new AgentRuntime(buildRuntimeConfig(provider, workDir, mcpServers));
  await runtime.initialize();

  const mcpStatus = runtime.mcpStatus;

  console.log(`\n🤖 Model: ${provider.model}`);
  console.log(`🌐 API: ${provider.apiUrl}`);
  console.log(`🔧 Tools: 5 (built-in)${mcpStatus.serverCount ? ` + ${mcpStatus.serverCount} MCP server(s), ${mcpStatus.toolCount} tool(s)` : ''}`);
  console.log(`📁 Work dir: ${workDir}`);
  console.log('Commands: /exit, /clear, /tools\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n🧑 You> ',
  });
  rl.prompt();

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }

    if (trimmed === '/exit' || trimmed === '/quit') {
      console.log('\nDisconnecting...');
      if (mcpManager) await mcpManager.disconnectAll();
      await runtime.dispose();
      rl.close();
      return;
    }

    if (trimmed === '/clear') {
      console.log('🔄 Session cleared.');
      rl.prompt();
      return;
    }

    if (trimmed === '/tools') {
      printBuiltInTools();
      printMCPTools(mcpManager);
      rl.prompt();
      return;
    }

    process.stdout.write('\n🤖 AI> ');
    const startTime = Date.now();

    let thinking = false;
    const clearThinking = () => {
      if (thinking) {
        process.stdout.write('\r\x1b[K');
        thinking = false;
      }
    };

    try {
      const result = await runtime.chatStream(trimmed, buildContext(), (e: AgentRuntimeEvent) => {
        switch (e.type) {
          case 'thinking':
            if (!thinking) {
              process.stdout.write('\n💭 思考中...');
              thinking = true;
            }
            break;
          case 'chunk':
            if (e.text) {
              clearThinking();
              process.stdout.write(e.text);
            }
            break;
          case 'tool_start':
            clearThinking();
            process.stdout.write(`\n\n🔧 [${e.toolName}]${e.toolLabel ? ' ' + e.toolLabel : ''} `);
            break;
          case 'tool_end':
            process.stdout.write(`✅`);
            break;
          case 'error':
            clearThinking();
            process.stdout.write(`\n❌ ${e.error || 'unknown error'}`);
            break;
        }
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      // 编辑已下沉为 agent 内建工具(FileWriteTool/FileEditTool),done 后无需再统计 edits。
      console.log(`\n\n[${elapsed}s] | ${result.toolCalls.length} tool call(s)`);
    } catch (e: any) {
      console.log(`\n❌ Error: ${e.message}`);
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    await runtime.dispose();
    console.log('Goodbye.');
    process.exit(0);
  });
}

function printBuiltInTools(): void {
  console.log('\n--- Built-in Tools ---');
  const tools = ['read_file', 'list_dir', 'search_code', 'bash', 'delegate'];
  const descs: Record<string, string> = {
    read_file: 'Read a file not currently in context',
    list_dir: 'List directory contents',
    search_code: 'Search code with regex pattern',
    bash: 'Execute a shell command',
    delegate: 'Delegate a task to a sub-agent',
  };
  for (const name of tools) {
    console.log(`  <${name}/> — ${descs[name] || ''}`);
  }
  console.log('');
}

function printMCPTools(mcpManager: McpManager | null): void {
  if (!mcpManager || mcpManager.serverCount === 0) return;
  const mcpTools = mcpManager.getTools();
  if (mcpTools.length === 0) return;
  console.log('--- MCP Tools ---');
  const catalog = new ToolCatalog();
  catalog.addFromManager(mcpTools);
  catalog.printAll();
  console.log('');
}

// ====================== MCP 手动模式 ======================

async function runMcpManualLoop(manager: McpManager, tools: McpToolInfo[]): Promise<void> {
  const catalog = new ToolCatalog();
  catalog.addFromManager(tools);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\nMCP> ',
  });

  console.log('\nCommands: <tool> <json>, tools, servers, help, exit');
  rl.prompt();

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }

    if (trimmed === 'exit' || trimmed === 'quit') {
      await manager.disconnectAll();
      rl.close();
      return;
    }
    if (trimmed === 'tools') { catalog.printAll(); rl.prompt(); return; }
    if (trimmed === 'servers') {
      console.log(`Connected (${manager.serverCount}): ${manager.getServerIds().join(', ')}`);
      rl.prompt();
      return;
    }
    if (trimmed === 'help') {
      console.log('  <tool> <json>  — call a tool\n  tools/servers/help/exit');
      rl.prompt();
      return;
    }

    const spaceIdx = trimmed.indexOf(' ');
    const toolName = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
    const argsStr = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : '{}';

    let args: Record<string, unknown>;
    try { args = JSON.parse(argsStr); } catch {
      console.log(`Invalid JSON: ${argsStr}`);
      rl.prompt(); return;
    }

    try {
      const start = Date.now();
      const result = await manager.callTool(toolName, args);
      console.log(`\n${result}\n[${Date.now() - start}ms]`);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
    }
    rl.prompt();
  });

  rl.on('close', () => { console.log('Goodbye.'); process.exit(0); });
}

// ====================== 主入口 ======================

function printBanner(): void {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     Agent CLI — VibeEditor              ║');
  console.log('╚══════════════════════════════════════════╝');
}

interface CliArgs {
  mode: 'agent' | 'mcp' | 'list';
  configPath?: string;
  noMcp: boolean;
  workDir: string;
  apiUrl?: string;
  apiKey?: string;
  model?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = { mode: 'agent', noMcp: false, workDir: process.cwd() };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--mcp':
        result.mode = 'mcp';
        break;
      case '--list':
        result.mode = 'list';
        break;
      case '--no-mcp':
        result.noMcp = true;
        break;
      case '--config':
        result.configPath = argv[++i];
        break;
      case '--root':
        result.workDir = path.resolve(argv[++i]);
        break;
      case '--url':
        result.apiUrl = argv[++i];
        break;
      case '--key':
        result.apiKey = argv[++i];
        break;
      case '--model':
        result.model = argv[++i];
        break;
      default:
        if (!argv[i].startsWith('--') && !result.configPath) {
          result.configPath = argv[i];
        }
    }
  }

  return result;
}

async function main(): Promise<void> {
  printBanner();

  const args = parseArgs(process.argv.slice(2));

  const mcpServers = args.noMcp ? [] : loadMcpServers(args.configPath);

  switch (args.mode) {
    case 'list': {
      printBuiltInTools();
      if (mcpServers.length > 0) {
        try {
          const mcpResult = await createMcpManager(mcpServers);
          if (mcpResult) {
            printMCPTools(mcpResult.manager);
            await mcpResult.manager.disconnectAll();
          }
        } catch (e: any) {
          console.error(`MCP connection failed: ${e.message}`);
        }
      }
      break;
    }

    case 'mcp': {
      if (mcpServers.length === 0) {
        console.log('No MCP servers configured. Use --config to specify a config file.');
        process.exit(1);
      }
      try {
        const mcpResult = await createMcpManager(mcpServers);
        if (!mcpResult) {
          console.log('No MCP servers connected.');
          process.exit(1);
        }
        await runMcpManualLoop(mcpResult.manager, mcpResult.tools);
      } catch (e: any) {
        console.error(`MCP connection failed: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case 'agent':
    default: {
      const provider = resolveProviderConfig(args);
      let mcpManager: McpManager | null = null;
      let activeServers = mcpServers;
      if (!args.noMcp && mcpServers.length > 0) {
        try {
          const result = await createMcpManager(mcpServers);
          if (result) {
            mcpManager = result.manager;
          }
        } catch (e: any) {
          console.error(`MCP connection failed: ${e.message}`);
          console.error('Continuing with built-in tools only.\n');
        }
      }
      await runAgentLoop(provider, mcpManager, activeServers, args.workDir);
      break;
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
