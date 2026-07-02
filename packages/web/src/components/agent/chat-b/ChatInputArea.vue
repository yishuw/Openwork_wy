<template>
  <div class="chat-input-area">
    <n-input
      :value="modelValue"
      type="textarea"
      :placeholder="t('agent.askAgent')"
      :autosize="{ minRows: 2, maxRows: 6 }"
      :disabled="isProcessing"
      @update:value="$emit('update:modelValue', $event)"
      @keydown.enter.exact.prevent="$emit('send')"
    />
    <n-button
      v-if="isProcessing"
      type="error"
      size="small"
      @click="$emit('stop')"
    >
      {{ t('agent.stop') }}
    </n-button>
    <n-button
      v-else
      type="primary"
      size="small"
      :disabled="!modelValue.trim()"
      @click="$emit('send')"
    >
      {{ t('agent.send') }}
    </n-button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { NInput, NButton } from 'naive-ui';

defineProps<{
  modelValue: string;
  isProcessing: boolean;
}>();

defineEmits<{
  'update:modelValue': [value: string];
  'send': [];
  'stop': [];
}>();

const { t } = useI18n();
</script>

<style scoped>
.chat-input-area {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
  align-items: flex-end;
}
.chat-input-area :deep(.n-input) {
  flex: 1;
}
</style>
