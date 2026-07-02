<template>
  <n-modal
    v-model:show="showModal"
    preset="card"
    :title="appInfo.name"
    style="width: 380px"
    @after-leave="emit('close')"
  >
    <n-space vertical>
      <n-text depth="2">{{ $t('about.description') }}</n-text>
      <n-descriptions label-placement="left" :column="1" size="small">
        <n-descriptions-item :label="$t('about.version')">v{{ appInfo.version }}</n-descriptions-item>
        <n-descriptions-item :label="$t('about.author')">
          <template v-for="(author, index) in appInfo.authors" :key="author.github">
            <n-a :href="author.github" target="_blank">{{ author.name }}</n-a>
            <template v-if="index < appInfo.authors.length - 1">、</template>
          </template>
        </n-descriptions-item>
        <n-descriptions-item :label="$t('about.repo')">
          <n-a href="https://github.com/zbeeeeeeeeee/OpenWork" target="_blank">github.com/zbeeeeeeeeee/OpenWork</n-a>
        </n-descriptions-item>
      </n-descriptions>
    </n-space>
    <template #footer>
      <n-button type="primary" @click="emit('close')">OK</n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { NModal, NButton, NText, NSpace, NDescriptions, NDescriptionsItem, NA } from 'naive-ui'

const appInfo = __APP_INFO__

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const showModal = ref(props.visible)
watch(() => props.visible, (v) => { showModal.value = v })
</script>
