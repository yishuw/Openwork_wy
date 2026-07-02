<template>
  <div class="tool-list">
    <n-list v-if="tools.length > 0" :show-divider="false" class="tool-list-inner">
      <n-list-item v-for="tool in tools" :key="tool.name">
        <div class="tool-item">
          <n-text code class="tool-name">{{ tool.name }}</n-text>
          <n-text depth="3" class="tool-desc">{{ tool.description }}</n-text>
        </div>
      </n-list-item>
    </n-list>
    <n-empty v-else description="No tools discovered" size="small" />
  </div>
</template>

<script setup lang="ts">
import { NList, NListItem, NText, NEmpty } from 'naive-ui'
import type { McpToolInfo } from '@openwork/agent'

defineProps<{
  tools: McpToolInfo[]
}>()
</script>

<style scoped>
.tool-list {
  padding-top: 4px;
}
.tool-list-inner {
  max-height: 160px;
  overflow-y: auto;
}
.tool-item {
  display: flex;
  flex-direction: column;
  padding: 2px 0;
}
.tool-name {
  font-size: 12px;
}
.tool-desc {
  font-size: 11px;
  line-height: 1.4;
  margin-top: 1px;
}
</style>
