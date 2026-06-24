<template>
  <div class="agent-footer">
    <div class="footer-left">
      <ProviderSelect
        :providers="providers"
        :activeId="activeProviderId"
        @select="$emit('select-provider', $event)"
      />
      <button class="settings-btn" :title="t('agent.providerSettings')" @click="$emit('open-settings')">&#9881;</button>
    </div>
    <ModeSelector v-model="modeModel" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ProviderSelect from './ProviderSelect.vue';
import ModeSelector from './ModeSelector.vue';
import type { ProviderConfig } from '../../composables/useLLMSettings';

const props = defineProps<{
  providers: ProviderConfig[];
  activeProviderId: string | null;
  currentMode: string;
}>();

const emit = defineEmits<{
  'select-provider': [id: string];
  'update:currentMode': [mode: string];
  'open-settings': [];
}>();

const modeModel = computed({
  get: () => props.currentMode as 'build' | 'plan',
  set: (val) => emit('update:currentMode', val),
});

const { t } = useI18n();
</script>

<style scoped>
.agent-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-top: 1px solid var(--border-color);
  gap: 8px;
  flex-shrink: 0;
}
.footer-left {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.settings-btn {
  background: none;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
  line-height: 1;
  flex-shrink: 0;
}
.settings-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent-color);
}
</style>
