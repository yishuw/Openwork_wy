<template>
  <div class="chat-response" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from '../../../services/markdown';

const props = defineProps<{
  content: string;
}>();

const renderedHtml = computed(() => renderMarkdown(props.content));
</script>

<style scoped>
.chat-response {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  word-break: break-word;
}
.chat-response :deep(p) { margin: 4px 0; }
.chat-response :deep(pre) {
  background: #0d1117;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 8px 10px;
  margin: 6px 0;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.4;
}
.chat-response :deep(code) {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 12px;
}
.chat-response :deep(:not(pre) > code) {
  background: var(--bg-tertiary);
  padding: 1px 4px;
  border-radius: 3px;
  color: #e06c75;
}
</style>
