<template>
  <div class="chat-footer">
    <n-space align="center" :size="6">
      <ProviderSelect
        :providers="providers"
        :activeId="activeProviderId"
        @select="$emit('select-provider', $event)"
      />
      <n-button text size="tiny" @click="$emit('open-settings')" :title="t('agent.providerSettings')">
        &#9881;
      </n-button>
    </n-space>
    <ModeSelector v-model="modeModel" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NSpace } from 'naive-ui';
import ProviderSelect from '../ProviderSelect.vue';
import ModeSelector from '../ModeSelector.vue';
import type { ProviderConfig } from '../../../composables/useLLMSettings';

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
.chat-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}
</style>
