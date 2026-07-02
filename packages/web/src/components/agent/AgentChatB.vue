<template>
  <div class="agent-chat-b">
    <!-- 会话标签栏 -->
    <ChatSessionTabs
      :sessions="sessionStore.sessions"
      :activeSessionId="sessionStore.activeSessionId"
      :visible="!!(editorStore.activeWorkspaceId || providerSettings.providers.value.length > 0)"
      @update:activeSessionId="sessionStore.setActiveSession($event)"
      @close="sessionStore.closeSession($event)"
      @add="createNewSession"
    />

    <!-- 流式处理时的加载提示 -->
    <div v-if="agentCtrl.isProcessing.value" class="b-thinking-bar">
      <n-spin size="small" />
      <span class="b-thinking-text">{{ t('agent.reasoning') }}...</span>
    </div>

    <!-- 引导/空状态 -->
    <template v-if="showGuide">
      <ChatEmptyState
        v-if="!hasProviders"
        :description="t('agent.guideTitle')"
        :actionLabel="t('agent.addProvider')"
        @action="$emit('open-settings')"
      />
      <ChatEmptyState
        v-else-if="!hasWorkspace"
        :description="t('agent.noWorkspaceDesc')"
      />
      <ChatEmptyState
        v-else-if="!hasSession"
        :description="t('agent.noSessionPrompt')"
        :actionLabel="t('agent.newSession')"
        @action="createNewSession"
      />
    </template>

    <!-- 正常聊天界面 -->
    <template v-else>
      <!-- 消息列表 -->
      <div v-if="visibleMessages.length === 0" class="b-empty-chat">
        <ChatEmptyState :description="t('agent.emptyChat')" />
      </div>
      <div v-else class="b-messages" ref="messagesContainer">
        <ChatMessageItem
          v-for="msg in visibleMessages"
          :key="msg.id"
          :message="msg"
        />
      </div>

      <!-- 输入区域 -->
      <ChatInputArea
        v-model="input"
        :isProcessing="agentCtrl.isProcessing.value"
        @send="send"
        @stop="stopStream"
      />

      <!-- 底部栏 -->
      <ChatFooter
        :providers="providerSettings.providers.value"
        :activeProviderId="providerSettings.activeId.value"
        :currentMode="currentMode"
        @select-provider="providerSettings.setActive($event)"
        @update:currentMode="agentCtrl.config.value.mode = $event"
        @open-settings="$emit('open-settings')"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { NSpin } from 'naive-ui';
import { useSessionStore } from '../../stores/sessions';
import { useLLMSettings } from '../../composables/useLLMSettings';
import { useEditorStore } from '../../stores/editor';
import { useAgent } from '../../composables/useAgent';
import { useSessionMessages } from '../../composables/useSessionMessages';
import type { DisplayMessage } from '@openwork/agent';
import ChatSessionTabs from './chat-b/ChatSessionTabs.vue';
import ChatEmptyState from './chat-b/ChatEmptyState.vue';
import ChatMessageItem from './chat-b/ChatMessageItem.vue';
import ChatInputArea from './chat-b/ChatInputArea.vue';
import ChatFooter from './chat-b/ChatFooter.vue';
import { webAgentLog } from '../../services/logger';

defineEmits<{
  'open-settings': [];
}>();

const { t } = useI18n();
const sessionStore = useSessionStore();
const providerSettings = useLLMSettings();
const editorStore = useEditorStore();
const input = ref('');

const agentCtrl = useAgent();

const { messages: persistedMessages, refresh: refreshMessages } = useSessionMessages(
  () => editorStore.activeWorkspaceId,
  () => sessionStore.activeSessionId,
  () => editorStore.workspaceRoot,
);

// 引导页判定
const hasProviders = computed(() => providerSettings.providers.value.length > 0);
const hasWorkspace = computed(() => !!editorStore.activeWorkspaceId || editorStore.workspaceRoots.length > 0);
const hasSession = computed(() => !!sessionStore.activeSessionId);
const showGuide = computed(() => !hasProviders.value || !hasWorkspace.value || !hasSession.value);

// 消息列表
const pendingUserMessage = ref<DisplayMessage | null>(null);
const visibleMessages = computed<DisplayMessage[]>(() => {
  const result = [...persistedMessages.value];
  if (agentCtrl.liveMessage.value) {
    if (pendingUserMessage.value) result.push(pendingUserMessage.value);
    result.push(agentCtrl.liveMessage.value);
  }
  return result;
});

watch(() => sessionStore.activeSessionId, () => {
  pendingUserMessage.value = null;
  agentCtrl.clearLive();
});

const currentMode = computed({
  get: () => agentCtrl.config.value.mode,
  set: (val) => { agentCtrl.config.value.mode = val; },
});

async function createNewSession() {
  await sessionStore.createSession();
}

// ===== 自动滚动 =====
const messagesContainer = ref<HTMLElement>();
let scrollRafId = 0;

function scrollToBottom() {
  const el = messagesContainer.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function scheduleScroll(_force = false) {
  cancelAnimationFrame(scrollRafId);
  scrollRafId = requestAnimationFrame(() => scrollToBottom());
}

onMounted(() => {
  providerSettings.reload();
});

onUnmounted(() => {
  cancelAnimationFrame(scrollRafId);
});

async function send() {
  if (!sessionStore.activeSessionId) {
    await sessionStore.createSession();
  }
  const sessionId = sessionStore.activeSessionId;
  if (!sessionId) return;

  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const tempUserMsg: DisplayMessage = {
    id: `pending_user_${Date.now()}`,
    role: 'user',
    content: text,
    timestamp: Date.now(),
    blocks: [{ id: `pending_user_${Date.now()}_r`, type: 'response', content: text }],
  };
  pendingUserMessage.value = tempUserMsg;

  if (sessionStore.activeSession && !sessionStore.activeSession.nameAutoGenerated) {
    sessionStore.autoNameFromFirstMessage(sessionStore.activeSession.id, text);
  }

  const activeFilePath = editorStore.activeTab?.path;
  webAgentLog.info('send(B): starting streamMessage');

  const streamPromise = agentCtrl.streamMessage(
    sessionId,
    text,
    providerSettings.activeProvider.value,
    activeFilePath,
    {
      onChunk: () => scheduleScroll(false),
      onDone: async () => {
        webAgentLog.info('send(B): streamMessage completed, refreshing from backend');
        await refreshMessages();
        pendingUserMessage.value = null;
        agentCtrl.clearLive();
        scrollToBottom();
      },
      onError: (err) => {
        webAgentLog.error(`send(B): streamMessage failed: ${err.message}`, { name: err.name, message: err.message });
      },
    },
  );

  await nextTick();
  scrollToBottom();

  try {
    await streamPromise;
  } catch (e: any) {
    webAgentLog.error(`send(B): streamPromise rejected: ${e.message}`, { name: e.name, message: e.message });
  }
}

function stopStream() {
  agentCtrl.cancelStream();
}
</script>

<style scoped>
.agent-chat-b {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
  overflow: hidden;
}

.b-thinking-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.b-thinking-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.b-empty-chat {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.b-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
</style>
