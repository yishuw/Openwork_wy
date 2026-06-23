import { ref } from 'vue';
import { createAgentService } from '../services/agentService';
import type { AgentConfig, StreamEvent } from '../services/agentService';
import type { ProviderConfig } from './useLLMSettings';
import type { IDESnapshot, DisplayMessage } from '@vibeeditor/agent';
import { useEditorStore } from '../stores/editor';
import { getEditorInstance } from '../services/editorInstance';
import { webAgentLog } from '../services/logger';

/**
 * buildAgentSnapshot —— 从当前 IDE 状态构造 IDESnapshot。
 *
 * 与旧的 buildAgentContext 的关键差异:
 * - 只发激活文件的完整内容;其他打开 tab 仅发路径列表
 * - 不再带 conversationHistory(记忆完全由后端 SessionMemory 管)
 */
export function buildAgentSnapshot(activeFilePath?: string): IDESnapshot {
  const store = useEditorStore();
  const editor = getEditorInstance();

  // 激活文件内容(若有)
  let activeFile: IDESnapshot['activeFile'] | undefined;
  const activeTab = activeFilePath
    ? store.tabs.find(t => t.path === activeFilePath)
    : store.activeTab;
  if (activeTab) {
    activeFile = {
      path: activeTab.path,
      content: activeTab.content,
    };
  }

  // 其他打开 tab 仅路径
  const openFilePaths = store.tabs
    .map(t => t.path)
    .filter(p => p !== activeFile?.path);

  // 文件树(扁平路径列表,与旧版一致)
  const fileTree = collectFileTreePaths(store.fileTreeNodes, '');

  // 光标 / 选区
  let cursorPosition: IDESnapshot['cursorPosition'];
  let selection: IDESnapshot['selection'];
  if (editor) {
    const file = activeFilePath || '';
    const pos = editor.getPosition();
    if (pos) {
      cursorPosition = { file, line: pos.lineNumber, column: pos.column };
    }
    const sel = editor.getSelection();
    if (sel && !sel.isEmpty()) {
      const model = editor.getModel();
      const text = model ? model.getValueInRange(sel) : '';
      selection = {
        file,
        text,
        startLine: sel.startLineNumber,
        endLine: sel.endLineNumber,
      };
    }
  }

  return {
    activeFile,
    openFilePaths,
    fileTree,
    cursorPosition,
    selection,
  };
}

function collectFileTreePaths(entries: any[], basePath: string): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const full = basePath ? `${basePath}/${entry.name}` : entry.name;
    paths.push(full);
  }
  return paths;
}

/**
 * Agent 流驱动器(无状态)。
 *
 * 不再持有 messages ref——展示消息由 useSessionMessages 从后端拉取。
 * 这里只负责构造请求 → 触发流式 → 把 live 消息通过 onLiveUpdate 回调上抛给 UI 层。
 *
 * useAgent 不绑定 sessionId;sessionId 在 streamMessage 调用时显式传入,
 * 同一个 useAgent 实例可复用于不同 session(只要不同时并发)。
 *
 * 用法(详见 AgentPanel):
 *   const { streamMessage, cancelStream, isProcessing, liveMessage } = useAgent();
 *   await streamMessage(sessionId, text, provider, activeFilePath, {
 *     onChunk: () => scheduleScroll(),
 *     onLiveUpdate: (msg) => { liveMsg.value = msg; },
 *     onDone: () => sessionMessages.refresh(),
 *   });
 */
export function useAgent() {
  const isProcessing = ref(false);
  const config = ref<AgentConfig>({ mode: 'build' });
  const service = createAgentService();
  const liveMessage = ref<DisplayMessage | null>(null);
  let activeAbortController: AbortController | null = null;

  function buildRequestConfig(provider?: ProviderConfig | null): AgentConfig {
    return {
      ...config.value,
      providerId: provider?.id || undefined,
    };
  }

  async function streamMessage(
    sessionId: string,
    content: string,
    provider: ProviderConfig | null | undefined,
    activeFilePath: string | undefined,
    callbacks: {
      onChunk?: () => void;
      onLiveUpdate?: (msg: DisplayMessage | null) => void;
      onDone?: () => void;
      onError?: (err: Error) => void;
    },
  ) {
    isProcessing.value = true;

    // live 消息初始化
    const liveId = `live_${Date.now()}`;
    liveMessage.value = {
      id: liveId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      blocks: [],
      live: true,
    };
    callbacks.onLiveUpdate?.(liveMessage.value);

    // 取消上一个在途请求
    if (activeAbortController) {
      activeAbortController.abort();
    }
    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;

    // 流式 block 状态机(同旧 useAgent,但更新的是 liveMessage 而非 messages 数组)
    // 用 LiveBlock 显式类型,避免 TS control-flow 在赋值后误判类型窄化
    type LiveBlock = DisplayMessage['blocks'][number];
    let activeBlock: LiveBlock | null = null;
    let blockIdCounter = 0;
    const nextBlockId = () => `${liveId}_blk${blockIdCounter++}`;

    function finishBlock() {
      if (activeBlock) {
        if (activeBlock.type === 'tool_call') activeBlock.completed = true;
        if (activeBlock.type === 'thinking') activeBlock.completed = true;
        activeBlock = null;
      }
    }

    function pushBlock(b: LiveBlock) {
      activeBlock = b;
      liveMessage.value?.blocks.push(b);
    }

    function ensureResponseBlock() {
      if (activeBlock && activeBlock.type === 'response') return;
      finishBlock();
      pushBlock({ id: nextBlockId(), type: 'response', content: '' });
    }

    function ensureThinkingBlock() {
      if (activeBlock && activeBlock.type === 'thinking') return;
      finishBlock();
      pushBlock({ id: nextBlockId(), type: 'thinking', content: '', completed: false });
    }

    function startToolCallBlock(toolType: string, toolLabel: string) {
      finishBlock();
      pushBlock({
        id: nextBlockId(),
        type: 'tool_call',
        toolType,
        toolLabel,
        params: {},
        result: '',
        durationMs: 0,
        completed: false,
      });
    }

    // 内容缓冲(50ms,与旧版一致,降低 markdown 重渲染频率)
    const contentBuffer: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const FLUSH_INTERVAL = 50;
    function flushContent() {
      if (contentBuffer.length === 0) return;
      const text = contentBuffer.join('');
      contentBuffer.length = 0;
      if (activeBlock && activeBlock.type === 'response') {
        activeBlock.content += text;
      }
      if (liveMessage.value) liveMessage.value.content += text;
      callbacks.onChunk?.();
    }
    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(() => { flushTimer = null; flushContent(); }, FLUSH_INTERVAL);
    }

    try {
      const store = useEditorStore();
      const ideSnapshot = buildAgentSnapshot(activeFilePath);

      await service.streamMessage(
        content,
        {
          ideSnapshot,
          workspaceRoot: store.workspaceRoot || undefined,
          workspaceId: store.activeWorkspaceId || undefined,
          sessionId,
        },
        buildRequestConfig(provider),
        (type: 'thinking' | 'content', text: string) => {
          if (!liveMessage.value) return;
          if (type === 'thinking') {
            ensureThinkingBlock();
            if (activeBlock && activeBlock.type === 'thinking') {
              activeBlock.content += text;
            }
            liveMessage.value.thinking = (liveMessage.value.thinking || '') + text;
          } else {
            ensureResponseBlock();
            contentBuffer.push(text);
            scheduleFlush();
          }
          callbacks.onChunk?.();
        },
        (event: StreamEvent) => {
          if (!liveMessage.value) return;
          if (event.type === 'tool_start') {
            const match = (event.message || '').match(/^🔍\s*(\S+):?\s*(.*)/);
            const toolType = match ? match[1] : (event.message || 'tool');
            const toolLabel = match ? match[2] : '';
            startToolCallBlock(toolType, toolLabel);
          } else if (event.type === 'tool_end') {
            finishBlock();
          } else if (event.type === 'tool_result') {
            const resultText = event.content || '';
            // 若当前块不是 tool_call,强制开一个
            if (!activeBlock || activeBlock.type !== 'tool_call') {
              startToolCallBlock('tool', '');
            }
            // 此时 activeBlock 必为 tool_call —— 用类型断言以避开 TS control-flow 残留窄化
            const tc = activeBlock as Extract<LiveBlock, { type: 'tool_call' }> | null;
            if (tc) {
              tc.result = tc.result ? tc.result + resultText : resultText;
            }
          } else if (event.type === 'thinking_start') {
            ensureThinkingBlock();
          } else if (event.type === 'thinking_end') {
            finishBlock();
          }
        },
        { signal }
      );

      // 流正常结束:让 UI 知道 live 消息即将被后端权威数据替代
      flushContent();
      finishBlock();
    } catch (e: any) {
      webAgentLog.error(`streamMessage error: ${e.name} ${e.message}`, { name: e.name, message: e.message });
      if (e.name === 'AbortError') {
        if (liveMessage.value) liveMessage.value.content += '\n\n*[已取消]*';
      } else {
        if (liveMessage.value) {
          liveMessage.value.error = true;
          liveMessage.value.content = `Error: ${e.message}`;
        }
        callbacks.onError?.(e);
      }
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      flushContent();
      activeAbortController = null;
      finishBlock();
      isProcessing.value = false;
      // onDone 触发上层 refresh(从后端拉权威数据覆盖 live)
      callbacks.onDone?.();
      // 短暂保留 live 消息,等 refresh 完成后由上层清空
      // (上层在 onDone 里调 sessionMessages.refresh(),刷新后 live 置 null)
    }
  }

  function cancelStream() {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    isProcessing.value = false;
  }

  function clearLive() {
    liveMessage.value = null;
  }

  function setMode(mode: AgentConfig['mode']) {
    config.value.mode = mode;
  }

  return {
    isProcessing,
    config,
    liveMessage,
    streamMessage,
    cancelStream,
    clearLive,
    setMode,
  };
}
