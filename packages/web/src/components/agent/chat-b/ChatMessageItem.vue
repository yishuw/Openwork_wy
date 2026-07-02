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
    <template v-if="message.blocks && message.blocks.length > 0">
      <!-- 思考块: 可折叠组 -->
      <n-collapse v-if="thinkingBlocks.length > 0">
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
    </template>
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
</style>
