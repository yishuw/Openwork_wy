<template>
  <!-- 输入区域拖拽手柄 -->
  <div class="input-resize-handle" @mousedown="startInputResize"></div>

  <!-- 输入区域 -->
  <div class="agent-input-area" :style="{ height: inputHeight + 'px' }">
    <textarea
      :value="modelValue"
      class="agent-input"
      :placeholder="t('agent.askAgent')"
      rows="2"
      @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @keydown.enter.exact.prevent="$emit('send')"
      @keydown.ctrl.enter.prevent="$emit('send')"
      @keydown.meta.enter.prevent="$emit('send')"
    ></textarea>
    <button
      v-if="isProcessing"
      class="agent-stop-btn"
      @click="$emit('stop')"
    >
      {{ t('agent.stop') }}
    </button>
    <button
      v-else
      class="agent-send-btn"
      @click="$emit('send')"
      :disabled="!modelValue.trim()"
    >
      {{ t('agent.send') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

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

const inputHeight = ref(90);
let isResizingInput = false;

function startInputResize(e: MouseEvent) {
  e.preventDefault();
  isResizingInput = true;
  const startY = e.clientY;
  const startHeight = inputHeight.value;

  document.body.style.cursor = 'row-resize';
  document.body.style.userSelect = 'none';

  const onMove = (ev: MouseEvent) => {
    if (!isResizingInput) return;
    inputHeight.value = Math.max(60, Math.min(320, startHeight - (ev.clientY - startY)));
  };

  const onUp = () => {
    isResizingInput = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('blur', onUp);
  };

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('blur', onUp);
}
</script>

<style scoped>
.agent-input-area {
  display: flex;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
  overflow: hidden;
}
.input-resize-handle {
  height: 3px;
  cursor: row-resize;
  background: var(--border-color);
  flex-shrink: 0;
  transition: background 0.15s;
}
.input-resize-handle:hover {
  background: var(--accent-color);
}
.agent-input {
  flex: 1;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  padding: 6px 8px;
  font-size: 13px;
  resize: none;
  border-radius: 4px;
  font-family: inherit;
}
.agent-input:focus {
  outline: none;
  border-color: var(--accent-color);
}
.agent-send-btn {
  background: var(--accent-color);
  border: none;
  color: #fff;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
  align-self: flex-end;
}
.agent-send-btn:hover {
  background: var(--accent-hover);
}
.agent-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.agent-stop-btn {
  background: #f44747;
  border: none;
  color: #fff;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
  align-self: flex-end;
  animation: stop-pulse 1.5s ease-in-out infinite;
}
.agent-stop-btn:hover {
  background: #d63030;
}
@keyframes stop-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
</style>
