<template>
  <div class="agent-panel">
    <!-- 会话标签栏：仅在有工作区或有提供商时显示 -->
    <div v-if="editorStore.activeWorkspaceId || providerSettings.providers.value.length > 0">
      <n-tabs
        v-model:value="activeSessionValue"
        type="card"
        closable
        addable
        tab-style="min-width: 60px; max-width: 150px; user-select: none;"
        class="session-tabs"
        @close="handleSessionTabClose"
        @add="createNewSession"
      >
        <n-tab-pane
          v-for="s in sessionStore.sessions"
          :key="s.id"
          :name="s.id"
          display-directive="show"
        >
          <template #tab>
            <span class="session-tab-name-text" :title="s.name">{{ s.name }}</span>
          </template>
        </n-tab-pane>
      </n-tabs>
    </div>

    <!-- 思考进度条 —— 处理时在面板最上方滚动 -->
    <div v-if="agentCtrl.isProcessing.value" class="thinking-progress">
      <div class="thinking-progress-bar"></div>
    </div>

    <!-- 无提供商时的引导页面 -->
    <div v-if="providerSettings.providers.value.length === 0" class="agent-guide">
      <div class="guide-icon"><n-icon size="36" :component="SettingsOutline" /></div>
      <div class="guide-title">{{ $t('agent.guideTitle') }}</div>
      <div class="guide-desc">
        {{ $t('agent.guideDesc1') }}<br />
        {{ $t('agent.guideDesc2') }}
      </div>
      <button class="guide-cta" @click="$emit('open-settings')">{{ $t('agent.addProvider') }}</button>
    </div>

    <!-- 无工作区时的提示（仅 server 模式且确实无工作区时） -->
    <div v-else-if="!editorStore.activeWorkspaceId && editorStore.workspaceRoots.length === 0" class="agent-guide">
      <div class="guide-icon"><n-icon size="36" :component="FolderOpenOutline" /></div>
      <div class="guide-title">{{ $t('agent.noWorkspaceTitle') }}</div>
      <div class="guide-desc">{{ $t('agent.noWorkspaceDesc') }}</div>
    </div>

    <!-- 无活跃会话时的提示 -->
    <div v-else-if="!sessionStore.activeSessionId" class="agent-guide">
      <div class="guide-icon"><n-icon size="36" :component="AddOutline" /></div>
      <div class="guide-title">{{ $t('agent.noSessionPrompt') }}</div>
      <button class="guide-cta" @click="createNewSession">{{ $t('agent.newSession') }}</button>
    </div>

    <!-- 有提供商且有活跃会话时显示正常的聊天界面 -->
    <template v-else>
      <!-- 消息列表 —— 时间轴布局 -->
      <div class="agent-messages" ref="messagesContainer">
        <div v-if="visibleMessages.length === 0" class="agent-empty">
          {{ $t('agent.emptyChat') }}
        </div>

        <template v-for="msg in visibleMessages" :key="msg.id">
          <!-- 用户消息 —— 右对齐，不在时间轴上 -->
          <div v-if="msg.role === 'user'" class="user-msg-row">
            <div class="user-msg-bubble">
              <div class="user-msg-content" v-html="renderMarkdown(msg.content)"></div>
            </div>
          </div>

          <!-- 助手消息：按 blocks 顺序渲染，在时间轴上 -->
          <div v-if="msg.role === 'assistant'" class="timeline">
            <template v-if="msg.blocks && msg.blocks.length > 0">
              <div
                v-for="block in msg.blocks"
                :key="block.id"
                v-memo="[Math.floor(blockLen(block) / 200), blockDone(block)]"
                class="tl-node"
                :class="{
                  'tl-thinking': block.type === 'thinking',
                  'tl-response': block.type === 'response',
                  'tl-tool': block.type === 'tool_call',
                  'tl-tool-running': block.type === 'tool_call' && !blockDone(block),
                  'tl-tool-done': block.type === 'tool_call' && blockDone(block),
                }"
              >
                <!-- 思考块 -->
                <template v-if="block.type === 'thinking'">
                  <div class="tl-dot tl-dot-thinking"></div>
                  <div class="tl-body">
                    <div class="tl-thinking-header" @click="toggleBlock(block.id)">
                      <span class="tl-thinking-label">💭 {{ $t('agent.reasoning') }}</span>
                      <span class="tl-thinking-toggle">{{ expandedState[block.id] ? '▾' : '▸' }}</span>
                    </div>
                    <div class="tl-thinking-body" :class="{ expanded: expandedState[block.id] }">
                      <div class="tl-thinking-content" v-html="renderMarkdown(block.content)"></div>
                    </div>
                  </div>
                </template>

                <!-- 工具调用块 —— 默认折叠 -->
                <template v-else-if="block.type === 'tool_call'">
                  <div class="tl-dot tl-dot-tool"></div>
                  <div class="tl-body">
                    <div class="tl-tool-header" @click="toggleBlock(block.id)">
                      <span class="tl-tool-icon">{{ block.completed ? '✅' : '⏳' }}</span>
                      <span class="tl-tool-type">{{ block.toolType }}</span>
                      <span v-if="block.toolLabel" class="tl-tool-label">{{ block.toolLabel }}</span>
                      <span v-if="block.durationMs" class="tl-tool-duration">{{ block.durationMs }}ms</span>
                      <span class="tl-tool-toggle">{{ expandedState[block.id] ? '▾' : '▸' }}</span>
                    </div>
                    <div v-if="block.result" class="tl-tool-result" :class="{ expanded: expandedState[block.id] }">
                      <pre>{{ block.result }}</pre>
                    </div>
                  </div>
                </template>

                <!-- 回复块 -->
                <template v-else-if="block.type === 'response'">
                  <div class="tl-dot tl-dot-response"></div>
                  <div class="tl-body">
                    <div class="tl-content" v-html="renderMarkdown(block.content)"></div>
                  </div>
                </template>
              </div>
            </template>
          </div>

          <!-- 系统消息（错误等） -->
          <div v-if="msg.role === 'system'" class="timeline">
            <div class="tl-node tl-system">
              <div class="tl-dot tl-dot-system"></div>
              <div class="tl-body">
                <div class="tl-content" v-html="renderMarkdown(msg.content)"></div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 输入区域拖拽手柄 -->
      <div class="input-resize-handle" @mousedown="startInputResize"></div>

      <!-- 输入区域 -->
      <div class="agent-input-area" :style="{ height: inputHeight + 'px' }">
        <textarea
          v-model="input"
          class="agent-input"
          :placeholder="$t('agent.askAgent')"
          rows="2"
          @keydown.enter.exact.prevent="send"
          @keydown.ctrl.enter.prevent="send"
          @keydown.meta.enter.prevent="send"
        ></textarea>
        <button
          v-if="agentCtrl.isProcessing.value"
          class="agent-stop-btn"
          @click="stopStream"
        >
          {{ $t('agent.stop') }}
        </button>
        <button
          v-else
          class="agent-send-btn"
          @click="send"
          :disabled="!input.trim()"
        >
          {{ $t('agent.send') }}
        </button>
      </div>

      <!-- 提供商选择 + 模式切换 -->
      <div class="agent-footer">
        <div class="footer-left">
          <ProviderSelect
            :providers="providerSettings.providers.value"
            :activeId="providerSettings.activeId.value"
            @select="providerSettings.setActive($event)"
          />
          <button class="settings-btn" :title="$t('agent.providerSettings')" @click="$emit('open-settings')">&#9881;</button>
        </div>
        <ModeSelector v-model="currentMode" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { NTabs, NTabPane, NIcon } from 'naive-ui';
import { useSessionStore } from '../../stores/sessions';
import { useLLMSettings } from '../../composables/useLLMSettings';
import { useEditorStore } from '../../stores/editor';
import { useAgent } from '../../composables/useAgent';
import { useSessionMessages } from '../../composables/useSessionMessages';
import { renderMarkdown } from '../../services/markdown';
import type { DisplayMessage } from '@vibeeditor/agent';
import ModeSelector from './ModeSelector.vue';
import ProviderSelect from './ProviderSelect.vue';
import { webAgentLog } from '../../services/logger';
import { SettingsOutline, FolderOpenOutline, AddOutline } from '@vicons/ionicons5';

const props = defineProps<{}>();

const emit = defineEmits<{
  'open-settings': []
}>();

const sessionStore = useSessionStore();
const providerSettings = useLLMSettings();
const editorStore = useEditorStore();
const input = ref('');
const messagesContainer = ref<HTMLElement>();
const inputHeight = ref(90);
let isResizingInput = false;

// 使用当前活跃 sessionId 驱动 useAgent(无状态,sessionId 在 streamMessage 时再传)
const agentCtrl = useAgent();

// 从后端拉取展示消息(监听 workspaceId / sessionId 变化自动 refresh)
// 用 editorStore.activeWorkspaceId 而非 sessionStore.boundWorkspaceId,
// 与 useAgent.streamMessage 的 workspaceId 保持一致
const { messages: persistedMessages, refresh: refreshMessages } = useSessionMessages(
  () => editorStore.activeWorkspaceId,
  () => sessionStore.activeSessionId,
  () => editorStore.workspaceRoot,
);

// 最终展示列表:已落盘消息 + 当前 pending + live 消息(流式期间)
// pending 与 live 绑定生命周期:一问一答紧邻,pending 在 live 之前
// (send 期间不能发新消息,所以 pending 只会是 0 或 1 个)
const pendingUserMessage = ref<DisplayMessage | null>(null);
const visibleMessages = computed<DisplayMessage[]>(() => {
  const result = [...persistedMessages.value];
  if (agentCtrl.liveMessage.value) {
    if (pendingUserMessage.value) result.push(pendingUserMessage.value);
    result.push(agentCtrl.liveMessage.value);
  }
  return result;
});

// 切换 session 时清空 pending 和 live
watch(() => sessionStore.activeSessionId, () => {
  pendingUserMessage.value = null;
  agentCtrl.clearLive();
});

// ModeSelector:activeSession 切换时同步 mode(目前全局 mode,后续可改为 per-session)
const currentMode = computed({
  get: () => agentCtrl.config.value.mode,
  set: (val) => { agentCtrl.config.value.mode = val; },
});

// ===== 会话标签栏切换 =====
const activeSessionValue = computed<string | undefined>({
  get: () => sessionStore.activeSessionId ?? undefined,
  set: (val) => { if (val) sessionStore.setActiveSession(val); },
});
function handleSessionTabClose(name: string) {
  sessionStore.closeSession(name);
}

async function createNewSession() {
  await sessionStore.createSession();
}

// --- 块展开/折叠状态 ---
const expandedState = reactive<Record<string, boolean>>({});

function toggleBlock(blockId: string) {
  expandedState[blockId] = !expandedState[blockId];
}

// 帮助函数:适配 DisplayBlock union 类型,模板里调用
function blockLen(block: DisplayMessage['blocks'][number]): number {
  if (block.type === 'tool_call') return block.result.length;
  return block.content.length;
}
function blockDone(block: DisplayMessage['blocks'][number]): boolean {
  if (block.type === 'tool_call' || block.type === 'thinking') return block.completed;
  return true; // response 块永远视为完成
}

// ===== 自动滚动控制 =====
const userScrolledUp = ref(false);
let scrollRafId = 0;
let observer: MutationObserver | null = null;

function isNearBottom(): boolean {
  const el = messagesContainer.value;
  if (!el) return false;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 50;
}

function scrollToBottom() {
  const el = messagesContainer.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function scheduleScroll(force = false) {
  cancelAnimationFrame(scrollRafId);
  scrollRafId = requestAnimationFrame(() => {
    if (force || !userScrolledUp.value) {
      scrollToBottom();
    }
  });
}

function onMessagesScroll() {
  userScrolledUp.value = !isNearBottom();
}

function setupObserver() {
  const el = messagesContainer.value;
  if (!el) return;
  observer = new MutationObserver(() => {
    scheduleScroll(false);
  });
  observer.observe(el, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

async function send() {
  if (!sessionStore.activeSessionId) {
    // 没活跃 session,先创建
    await sessionStore.createSession();
  }
  const sessionId = sessionStore.activeSessionId;
  if (!sessionId) return;

  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  userScrolledUp.value = false;

  // 插入 pending 用户消息(立即显示,不等 refresh)
  const tempUserMsg: DisplayMessage = {
    id: `pending_user_${Date.now()}`,
    role: 'user',
    content: text,
    timestamp: Date.now(),
    blocks: [{ id: `pending_user_${Date.now()}_r`, type: 'response', content: text }],
  };
  pendingUserMessage.value = tempUserMsg;

  // 自动从首条消息命名会话
  if (sessionStore.activeSession && !sessionStore.activeSession.nameAutoGenerated) {
    sessionStore.autoNameFromFirstMessage(sessionStore.activeSession.id, text);
  }

  const activeFilePath = editorStore.activeTab?.path;
  webAgentLog.info('send: starting streamMessage');

  const streamPromise = agentCtrl.streamMessage(
    sessionId,
    text,
    providerSettings.activeProvider.value,
    activeFilePath,
    {
      onChunk: () => scheduleScroll(false),
      onDone: async () => {
        webAgentLog.info('send: streamMessage completed, refreshing from backend');
        // 后端在发送 done SSE 事件之前已完成 persistSessionMemory,
        // 所以 refresh 一定能拿到最新落盘数据。
        // 如果 refresh 失败(网络等),useSessionMessages 内部已 catch 并保留旧数据,
        // 此时清空 live 会让用户暂时看不到最新回复,但不会丢历史——下次切换 session
        // 再切回时会重新拉取。相比保留 live 导致 streaming error 被掩盖,
        // 清空 live 是更安全的默认行为。
        await refreshMessages();
        pendingUserMessage.value = null;
        agentCtrl.clearLive();
        scheduleScroll(true);
      },
      onError: (err) => {
        webAgentLog.error(`send: streamMessage failed: ${err.message}`, { name: err.name, message: err.message });
      },
    },
  );

  await nextTick();
  scrollToBottom();

  try {
    await streamPromise;
  } catch (e: any) {
    webAgentLog.error(`send: streamPromise rejected: ${e.message}`, { name: e.name, message: e.message });
  }
}

function stopStream() {
  agentCtrl.cancelStream();
}

function startInputResize(e: MouseEvent) {
  e.preventDefault();
  isResizingInput = true;
  const startY = e.clientY;
  const startHeight = inputHeight.value;

  document.body.style.cursor = 'row-resize';
  document.body.style.userSelect = 'none';

  const onMove = (ev: MouseEvent) => {
    if (!isResizingInput) return;
    inputHeight.value = Math.max(60, Math.min(320, startHeight - (ev.clientY - startY)));
  };

  const onUp = () => {
    isResizingInput = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('blur', onUp);
  };

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('blur', onUp);
}

onMounted(() => {
  providerSettings.reload();
  messagesContainer.value?.addEventListener('scroll', onMessagesScroll);
  setupObserver();
});

onUnmounted(() => {
  cancelAnimationFrame(scrollRafId);
  observer?.disconnect();
  messagesContainer.value?.removeEventListener('scroll', onMessagesScroll);
});
</script>

<style scoped>
.agent-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
  position: relative;
  overflow: hidden;
}

/* ===== 会话标签栏 ===== */
.session-tabs {
  flex-shrink: 0;
  user-select: none;
}
.session-tabs :deep(.n-tabs-pane-wrapper) {
  display: none;
}
.session-tabs :deep(.n-tabs-nav) {
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
}
.session-tabs :deep(.n-tabs-tab) {
  background: transparent;
  border-right: 1px solid var(--border-color);
}
.session-tabs :deep(.n-tabs-tab__label) {
  overflow: hidden;
  min-width: 0;
}
.session-tabs :deep(.n-tabs-tab--active) {
  background: var(--bg-secondary);
}
.session-tabs :deep(.n-tabs-tab:hover) {
  background: var(--bg-hover);
}
.session-tab-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* ===== 思考进度条 ===== */
.thinking-progress {
  position: absolute;
  top: 32px;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 10;
  overflow: hidden;
  background: transparent;
}

.thinking-progress-bar {
  width: 40%;
  height: 100%;
  background: linear-gradient(90deg, transparent, var(--accent-color), transparent);
  animation: progress-scroll 1.2s ease-in-out infinite;
  border-radius: 2px;
}

@keyframes progress-scroll {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(350%);
  }
}

/* ===== 时间轴布局（每个助手消息一条时间轴） ===== */
.timeline {
  position: relative;
  padding-left: 24px;
  margin-bottom: 16px;
}

/* 贯穿该消息所有块的竖线 */
.timeline::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--border-color);
  border-radius: 1px;
}

/* ===== 时间轴节点 ===== */
.tl-node {
  position: relative;
  margin-bottom: 12px;
}

.tl-dot {
  position: absolute;
  left: -22px;
  top: 6px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  z-index: 1;
  border: 2px solid var(--bg-secondary);
}

/* 用户 — 蓝色 */
.tl-dot-user {
  background: #569cd6;
  box-shadow: 0 0 0 2px rgba(86, 156, 214, 0.3);
}

/* 思考 — 琥珀色 */
.tl-dot-thinking {
  background: #d4a017;
  box-shadow: 0 0 0 2px rgba(212, 160, 23, 0.3);
}

/* 工具 — 绿色（完成）/ 动画（运行中） */
.tl-dot-tool {
  background: #4ec9b0;
  box-shadow: 0 0 0 2px rgba(78, 201, 176, 0.3);
}
.tl-tool-running .tl-dot-tool {
  animation: tl-pulse 1s ease-in-out infinite;
}

/* 回复 — 白色 */
.tl-dot-response {
  background: #a0a0a0;
  box-shadow: 0 0 0 2px rgba(160, 160, 160, 0.3);
}

/* 系统 — 红色 */
.tl-dot-system {
  background: #f44747;
  box-shadow: 0 0 0 2px rgba(244, 71, 71, 0.3);
}

@keyframes tl-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(78, 201, 176, 0.3); }
  50% { box-shadow: 0 0 0 6px rgba(78, 201, 176, 0.1); }
}

/* ===== 节点内容体 ===== */
.tl-body {
  padding: 4px 0;
}

.tl-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
}
.tl-content :deep(p) {
  margin: 4px 0;
}
.tl-content :deep(h1) {
  font-size: 16px;
  font-weight: 600;
  margin: 8px 0 4px;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 4px;
}
.tl-content :deep(h2) {
  font-size: 14px;
  font-weight: 600;
  margin: 8px 0 4px;
}
.tl-content :deep(h3) {
  font-size: 13px;
  font-weight: 600;
  margin: 6px 0 2px;
}
.tl-content :deep(pre) {
  background: #0d1117;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 8px 10px;
  margin: 6px 0;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.4;
}
.tl-content :deep(code) {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 12px;
}
.tl-content :deep(:not(pre) > code) {
  background: var(--bg-tertiary);
  padding: 1px 4px;
  border-radius: 3px;
  color: #e06c75;
}
.tl-content :deep(strong) {
  font-weight: 600;
  color: #fff;
}
.tl-content :deep(em) {
  font-style: italic;
}
.tl-content :deep(ul),
.tl-content :deep(ol) {
  margin: 4px 0;
  padding-left: 20px;
}
.tl-content :deep(li) {
  margin: 2px 0;
}
.tl-content :deep(a) {
  color: var(--accent-color);
  text-decoration: none;
}
.tl-content :deep(a:hover) {
  text-decoration: underline;
}
.tl-content :deep(blockquote) {
  border-left: 3px solid var(--accent-color);
  margin: 6px 0;
  padding: 4px 10px;
  color: var(--text-secondary);
  background: rgba(255,255,255,0.03);
}
.tl-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 8px 0;
}

/* ===== 思考节点 ===== */
.tl-thinking-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  color: #b8952e;
}
.tl-thinking-header:hover {
  color: #d4a017;
}

.tl-thinking-label {
  font-weight: 500;
}

.tl-thinking-toggle {
  font-size: 10px;
  opacity: 0.7;
}

.tl-thinking-body {
  margin-top: 4px;
  padding: 0;
  border-left: 2px solid rgba(212, 160, 23, 0.3);
  background: rgba(255, 200, 50, 0.04);
  border-radius: 0 4px 4px 0;
  /* 默认折叠：显示约 2 行预览，底部对齐以展示最新内容 */
  max-height: 2.8em;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  transition: max-height 0.2s ease;
}
.tl-thinking-body.expanded {
  max-height: 3000px;
  display: block;
}

.tl-thinking-content {
  font-size: 12px;
  line-height: 1.4;
  color: #b8952e;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 4px 10px;
}

/* ===== 工具调用节点 ===== */
.tl-tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 12px;
  color: #4ec9b0;
  cursor: pointer;
  user-select: none;
}
.tl-tool-header:hover {
  color: #6fdcc0;
}

.tl-tool-icon {
  font-size: 12px;
}

.tl-tool-type {
  font-weight: 600;
  font-family: 'Consolas', 'Courier New', monospace;
}

.tl-tool-label {
  color: var(--text-secondary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tl-tool-duration {
  color: var(--text-secondary);
  font-size: 10px;
  opacity: 0.7;
  font-family: 'Consolas', 'Courier New', monospace;
  margin-left: auto;
}

.tl-tool-toggle {
  font-size: 10px;
  opacity: 0.7;
}

.tl-tool-running .tl-tool-type {
  opacity: 0.8;
}

.tl-tool-result {
  margin-top: 4px;
  border-left: 2px solid rgba(78, 201, 176, 0.3);
  background: rgba(78, 201, 176, 0.04);
  border-radius: 0 4px 4px 0;
  /* 默认折叠 */
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.2s ease;
}
.tl-tool-result.expanded {
  max-height: 600px;
  overflow-y: auto;
}
.tl-tool-result pre {
  margin: 0;
  padding: 6px 10px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Consolas', 'Courier New', monospace;
}

/* ===== Footer ===== */
.agent-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-top: 1px solid var(--border-color);
  gap: 8px;
  flex-shrink: 0;
}
.footer-left {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.settings-btn {
  background: none;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
  line-height: 1;
  flex-shrink: 0;
}
.settings-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent-color);
}
.agent-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
.agent-empty {
  color: var(--text-secondary);
  font-size: 13px;
  text-align: center;
  padding: 40px 0;
  user-select: none;
}

/* ===== 用户消息 —— 右对齐，不在时间轴上 ===== */
.user-msg-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}

.user-msg-bubble {
  max-width: 80%;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 12px 12px 4px 12px;
  padding: 10px 14px;
}

.user-msg-content {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
}
.user-msg-content :deep(p) {
  margin: 4px 0;
}
.user-msg-content :deep(pre) {
  background: #0d1117;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 8px 10px;
  margin: 6px 0;
  overflow-x: auto;
  font-size: 12px;
}
.user-msg-content :deep(code) {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 12px;
}
.user-msg-content :deep(:not(pre) > code) {
  background: rgba(255,255,255,0.08);
  padding: 1px 4px;
  border-radius: 3px;
  color: var(--agent-code-accent);
}
.agent-input-area {
  display: flex;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
  overflow: hidden;
}
.input-resize-handle {
  height: 3px;
  cursor: row-resize;
  background: var(--border-color);
  flex-shrink: 0;
  transition: background 0.15s;
}
.input-resize-handle:hover {
  background: var(--accent-color);
}
.agent-input {
  flex: 1;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  padding: 6px 8px;
  font-size: 13px;
  resize: none;
  border-radius: 4px;
  font-family: inherit;
}
.agent-input:focus {
  outline: none;
  border-color: var(--accent-color);
}
.agent-send-btn {
  background: var(--accent-color);
  border: none;
  color: #fff;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
  align-self: flex-end;
}
.agent-send-btn:hover {
  background: var(--accent-hover);
}
.agent-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.agent-stop-btn {
  background: #f44747;
  border: none;
  color: #fff;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
  align-self: flex-end;
  animation: stop-pulse 1.5s ease-in-out infinite;
}
.agent-stop-btn:hover {
  background: #d63030;
}
@keyframes stop-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

/* ---- 无提供商引导页 ---- */
.agent-guide {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 24px;
  user-select: none;
}
.guide-icon {
  font-size: 40px;
  color: var(--text-secondary);
  opacity: 0.35;
  margin-bottom: 14px;
}
.guide-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 6px;
}
.guide-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 22px;
  line-height: 1.5;
}
.guide-cta {
  background: var(--accent-color);
  color: #fff;
  border: none;
  padding: 8px 24px;
  font-size: 13px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  margin-bottom: 8px;
}
.guide-cta:hover {
  background: var(--accent-hover);
}
</style>
