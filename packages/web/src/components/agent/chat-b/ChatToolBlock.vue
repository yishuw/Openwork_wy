<template>
  <div class="chat-tool-line">
    <span class="tool-icon">{{ block.completed ? '✅' : '⏳' }}</span>
    <n-tag type="info" size="small" :bordered="false">{{ block.toolType }}</n-tag>
    <span v-if="block.toolLabel" class="tool-label">{{ block.toolLabel }}</span>
    <span v-if="block.durationMs" class="tool-duration">{{ block.durationMs }}ms</span>
  </div>
</template>

<script setup lang="ts">
import { NTag } from 'naive-ui';
import type { DisplayBlock } from '@openwork/agent';

defineProps<{
  block: DisplayBlock & { type: 'tool_call' };
}>();
</script>

<style scoped>
.chat-tool-line {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 12px;
  opacity: 0.8;
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
  max-width: 240px;
}
.tool-duration {
  color: var(--text-secondary);
  font-size: 10px;
  opacity: 0.6;
  font-family: 'Consolas', 'Courier New', monospace;
  margin-left: auto;
}
</style>
