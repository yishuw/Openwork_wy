<template>
  <n-empty :description="description" class="chat-empty">
    <template #extra>
      <n-button v-if="actionLabel" type="primary" size="small" @click="$emit('action')">
        {{ actionLabel }}
      </n-button>
    </template>
  </n-empty>
</template>

<script setup lang="ts">
import { NEmpty, NButton } from 'naive-ui';

defineProps<{
  description: string;
  actionLabel?: string;
}>();

defineEmits<{
  action: [];
}>();
</script>

<style scoped>
.chat-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
