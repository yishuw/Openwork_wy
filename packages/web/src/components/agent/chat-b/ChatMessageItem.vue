<template>
  <!-- 用户消息 -->
  <div v-if="message.role === 'user'" class="msg-user">
    <div class="msg-user-bubble">
      <ChatResponseBlock :content="message.content" />
    </div>
  </div>

  <!-- 系统/错误消息 -->
  <n-alert v-else-if="message.role === 'system'" type="error" :show-icon="false" class="msg-system">
    <ChatResponseBlock :content="message.content" />
  </n-alert>

  <!-- 助手消息 -->
  <div v-else-if="message.role === 'assistant'" class="msg-assistant">
    <!-- 思考块: 无正文时默认展开，避免「看起来没有输出」 -->
    <n-collapse
      v-if="thinkingBlocks.length > 0"
      :default-expanded-names="defaultThinkingNames"
    >
      <ChatThinkingBlock
        v-for="block in thinkingBlocks"
        :key="block.id"
        :block="block"
      />
    </n-collapse>
    <!-- 工具调用: 单行简讯, 不折叠 -->
    <ChatToolBlock
      v-for="block in toolBlocks"
      :key="block.id"
      :block="block"
    />
    <!-- 回复块: 正文 -->
    <div v-for="block in responseBlocks" :key="block.id" class="msg-response-wrapper">
      <ChatResponseBlock :content="block.content" />
    </div>
    <!-- 兜底: blocks 缺失/为空时仍展示 content，避免整条消息空白 -->
    <div
      v-if="showContentFallback"
      class="msg-response-wrapper msg-fallback"
    >
      <ChatResponseBlock :content="message.content || fallbackText" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NCollapse, NAlert } from 'naive-ui';
import type { DisplayMessage, DisplayBlock } from '@openwork/agent';
import ChatThinkingBlock from './ChatThinkingBlock.vue';
import ChatToolBlock from './ChatToolBlock.vue';
import ChatResponseBlock from './ChatResponseBlock.vue';

const props = defineProps<{
  message: DisplayMessage;
}>();

const thinkingBlocks = computed(() =>
  (props.message.blocks || []).filter(b => b.type === 'thinking') as (DisplayBlock & { type: 'thinking' })[]
);
const toolBlocks = computed(() =>
  (props.message.blocks || []).filter(b => b.type === 'tool_call') as (DisplayBlock & { type: 'tool_call' })[]
);
const responseBlocks = computed(() =>
  (props.message.blocks || []).filter(b => b.type === 'response') as (DisplayBlock & { type: 'response' })[]
);

/** 无正文时默认展开思考，让用户至少能看到模型在做什么 */
const defaultThinkingNames = computed(() => {
  if (responseBlocks.value.length > 0) return [];
  return thinkingBlocks.value.map(b => b.id);
});

const showContentFallback = computed(() => {
  if (responseBlocks.value.length > 0) return false;
  const c = (props.message.content || '').trim();
  return c.length > 0;
});

const fallbackText = '*[无额外正文，详见思考过程]*';
</script>

<style scoped>
.msg-user {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}
.msg-user-bubble {
  max-width: 80%;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 12px 12px 4px 12px;
  padding: 10px 14px;
}
.msg-system {
  margin-bottom: 12px;
}
.msg-assistant {
  margin-bottom: 16px;
}
.msg-response-wrapper {
  padding: 8px 12px;
}
.msg-fallback {
  color: var(--text-secondary);
  font-size: 12px;
}
</style>
