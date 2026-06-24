<template>
  <div class="agent-messages" ref="messagesContainer">
    <div v-if="messages.length === 0" class="agent-empty">
      {{ t('agent.emptyChat') }}
    </div>

    <template v-for="msg in messages" :key="msg.id">
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
                  <span class="tl-thinking-label">💭 {{ t('agent.reasoning') }}</span>
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
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { renderMarkdown } from '../../services/markdown';
import type { DisplayMessage } from '@vibeeditor/agent';

defineProps<{
  messages: DisplayMessage[];
}>();

const { t } = useI18n();

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
const messagesContainer = ref<HTMLElement>();
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

onMounted(() => {
  messagesContainer.value?.addEventListener('scroll', onMessagesScroll);
  setupObserver();
});

onUnmounted(() => {
  cancelAnimationFrame(scrollRafId);
  observer?.disconnect();
  messagesContainer.value?.removeEventListener('scroll', onMessagesScroll);
});

defineExpose({ scrollToBottom, scheduleScroll });
</script>

<style scoped>
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
</style>
