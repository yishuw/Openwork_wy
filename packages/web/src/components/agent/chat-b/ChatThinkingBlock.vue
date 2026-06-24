<template>
  <n-collapse-item :name="block.id" class="chat-thinking">
    <template #header>
      <n-tag type="warning" size="small" :bordered="false">💭 {{ $t('agent.reasoning') }}</n-tag>
    </template>
    <div class="thinking-content" v-html="renderedHtml"></div>
  </n-collapse-item>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NCollapseItem, NTag } from 'naive-ui';
import { renderMarkdown } from '../../../services/markdown';
import type { DisplayBlock } from '@vibeeditor/agent';

const props = defineProps<{
  block: DisplayBlock & { type: 'thinking' };
}>();

const renderedHtml = computed(() => renderMarkdown(props.block.content));
</script>

<style scoped>
.chat-thinking {
  --n-title-text-color: #b8952e;
}
.thinking-content {
  font-size: 12px;
  line-height: 1.5;
  color: #b8952e;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 0 4px;
}
</style>
