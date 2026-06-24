<template>
  <div v-if="visible" class="chat-session-tabs">
    <n-tabs
      v-model:value="activeModel"
      type="card"
      closable
      addable
      tab-style="min-width: 60px; max-width: 150px; user-select: none;"
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
          <span class="tab-name" :title="s.name">{{ s.name }}</span>
        </template>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NTabs, NTabPane } from 'naive-ui';
import type { WorkspaceAgentSession } from '../../../services/fileService';

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
.chat-session-tabs {
  flex-shrink: 0;
  user-select: none;
}
.chat-session-tabs :deep(.n-tabs-nav) {
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
}
.chat-session-tabs :deep(.n-tabs-tab--active) {
  background: var(--bg-secondary);
}
.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>
