<template>
  <div class="ws-bar">
    <div class="ws-head">
      <span class="ws-title">{{ t('workspaceBar.title') }}</span>
      <n-button quaternary size="tiny" @click="$emit('open-folder')">
        {{ t('workspaceBar.open') }}
      </n-button>
    </div>
    <div v-if="roots.length === 0" class="ws-empty">
      {{ t('workspaceBar.empty') }}
    </div>
    <div v-else class="ws-list">
      <button
        v-for="root in roots"
        :key="root.path"
        type="button"
        class="ws-item"
        :class="{ active: root.path === currentPath }"
        :title="root.path"
        @click="$emit('select', root.path)"
      >
        <span class="ws-dot" />
        <span class="ws-name">{{ root.name || shortPath(root.path) }}</span>
      </button>
    </div>
    <div v-if="roots.length > 0 && currentPath" class="ws-current" :title="currentPath">
      {{ shortPath(currentPath) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NButton } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { useEditorStore } from '../../stores/editor';

const { t } = useI18n();
const store = useEditorStore();

const roots = computed(() => store.workspaceRoots);
const currentPath = computed(() => store.workspaceRoot);

defineEmits<{
  'open-folder': [];
  select: [path: string];
}>();

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || p;
}
</script>

<style scoped>
.ws-bar {
  flex-shrink: 0;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-1);
}
.ws-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
}
.ws-title {
  font-size: var(--font-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--text-muted);
}
.ws-empty {
  font-size: var(--font-sm);
  color: var(--text-muted);
  padding: var(--space-1) 0 var(--space-2);
}
.ws-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 120px;
  overflow-y: auto;
}
.ws-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-sm);
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.ws-item:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.ws-item.active {
  background: var(--surface-selected);
  color: var(--text-primary);
  font-weight: var(--weight-medium);
}
.ws-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}
.ws-item.active .ws-dot {
  background: var(--accent);
}
.ws-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-current {
  margin-top: 2px;
  font-size: var(--font-xs);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
