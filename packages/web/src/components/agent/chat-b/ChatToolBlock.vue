<template>
  <n-collapse-item :name="block.id" class="chat-tool">
    <template #header>
      <n-space align="center" :size="6">
        <span class="tool-icon">{{ block.completed ? '✅' : '⏳' }}</span>
        <n-tag type="info" size="small" :bordered="false">{{ block.toolType }}</n-tag>
        <span v-if="block.toolLabel" class="tool-label">{{ block.toolLabel }}</span>
        <span v-if="block.durationMs" class="tool-duration">{{ block.durationMs }}ms</span>
      </n-space>
    </template>
    <div v-if="block.result" class="tool-result">
      <pre>{{ block.result }}</pre>
    </div>
  </n-collapse-item>
</template>

<script setup lang="ts">
import { NCollapseItem, NTag, NSpace } from 'naive-ui';
import type { DisplayBlock } from '@vibeeditor/agent';

defineProps<{
  block: DisplayBlock & { type: 'tool_call' };
}>();
</script>

<style scoped>
.chat-tool {
  --n-title-text-color: #4ec9b0;
}
.tool-icon {
  font-size: 12px;
}
.tool-label {
  color: var(--text-secondary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
.tool-duration {
  color: var(--text-secondary);
  font-size: 10px;
  opacity: 0.7;
  font-family: 'Consolas', 'Courier New', monospace;
}
.tool-result {
  margin-top: 4px;
}
.tool-result pre {
  margin: 0;
  padding: 6px 10px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Consolas', 'Courier New', monospace;
  background: rgba(78, 201, 176, 0.04);
  border-radius: 4px;
  max-height: 400px;
  overflow-y: auto;
}
</style>
