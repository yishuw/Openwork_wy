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
    <n-collapse v-if="message.blocks && message.blocks.length > 0" :default-expanded-names="defaultExpanded">
      <template v-for="block in message.blocks" :key="block.id">
        <ChatThinkingBlock
          v-if="block.type === 'thinking'"
          :block="block"
        />
        <ChatToolBlock
          v-else-if="block.type === 'tool_call'"
          :block="block"
        />
        <div v-else-if="block.type === 'response'" class="msg-response-wrapper">
          <ChatResponseBlock :content="block.content" />
        </div>
      </template>
    </n-collapse>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NCollapse, NAlert } from 'naive-ui';
import type { DisplayMessage } from '@vibeeditor/agent';
import ChatThinkingBlock from './ChatThinkingBlock.vue';
import ChatToolBlock from './ChatToolBlock.vue';
import ChatResponseBlock from './ChatResponseBlock.vue';

const props = defineProps<{
  message: DisplayMessage;
}>();

// 只默认展开 response 块,thinking/tool 默认折叠
const defaultExpanded = computed(() => {
  if (!props.message.blocks) return [];
  return props.message.blocks
    .filter(b => b.type === 'response')
    .map(b => b.id);
});
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
