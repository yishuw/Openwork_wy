<template>
  <div v-if="visible" class="session-tabs-wrapper">
    <n-tabs
      v-model:value="activeModel"
      type="card"
      closable
      addable
      tab-style="min-width: 60px; max-width: 150px; user-select: none;"
      class="session-tabs"
      @close="$emit('close', $event)"
      @add="$emit('add')"
    >
      <n-tab-pane
        v-for="s in sessions"
        :key="s.id"
        :name="s.id"
        display-directive="show"
      >
        <template #tab>
          <span class="session-tab-name-text" :title="s.name">{{ s.name }}</span>
        </template>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NTabs, NTabPane } from 'naive-ui';
import type { WorkspaceAgentSession } from '../../services/fileService';

const props = defineProps<{
  sessions: WorkspaceAgentSession[];
  activeSessionId: string | null;
  visible: boolean;
}>();

const emit = defineEmits<{
  'update:activeSessionId': [id: string];
  'close': [id: string];
  'add': [];
}>();

const activeModel = computed<string | undefined>({
  get: () => props.activeSessionId ?? undefined,
  set: (val) => { if (val) emit('update:activeSessionId', val); },
});
</script>

<style scoped>
.session-tabs {
  flex-shrink: 0;
  user-select: none;
}
.session-tabs :deep(.n-tabs-pane-wrapper) {
  display: none;
}
.session-tabs :deep(.n-tabs-nav) {
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
}
.session-tabs :deep(.n-tabs-tab) {
  background: transparent;
  border-right: 1px solid var(--border-color);
}
.session-tabs :deep(.n-tabs-tab__label) {
  overflow: hidden;
  min-width: 0;
}
.session-tabs :deep(.n-tabs-tab--active) {
  background: var(--bg-secondary);
}
.session-tabs :deep(.n-tabs-tab:hover) {
  background: var(--bg-hover);
}
.session-tab-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>
