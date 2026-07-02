<template>
  <!-- 无提供商时的引导页面 -->
  <div v-if="!hasProviders" class="agent-guide">
    <div class="guide-icon"><n-icon size="36" :component="SettingsOutline" /></div>
    <div class="guide-title">{{ t('agent.guideTitle') }}</div>
    <div class="guide-desc">
      {{ t('agent.guideDesc1') }}<br />
      {{ t('agent.guideDesc2') }}
    </div>
    <button class="guide-cta" @click="$emit('open-settings')">{{ t('agent.addProvider') }}</button>
  </div>

  <!-- 无工作区时的提示（仅 server 模式且确实无工作区时） -->
  <div v-else-if="!hasWorkspace" class="agent-guide">
    <div class="guide-icon"><n-icon size="36" :component="FolderOpenOutline" /></div>
    <div class="guide-title">{{ t('agent.noWorkspaceTitle') }}</div>
    <div class="guide-desc">{{ t('agent.noWorkspaceDesc') }}</div>
  </div>

  <!-- 无活跃会话时的提示 -->
  <div v-else-if="!hasSession" class="agent-guide">
    <div class="guide-icon"><n-icon size="36" :component="AddOutline" /></div>
    <div class="guide-title">{{ t('agent.noSessionPrompt') }}</div>
    <button class="guide-cta" @click="$emit('create-session')">{{ t('agent.newSession') }}</button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { NIcon } from 'naive-ui';
import { SettingsOutline, FolderOpenOutline, AddOutline } from '@vicons/ionicons5';

defineProps<{
  hasProviders: boolean;
  hasWorkspace: boolean;
  hasSession: boolean;
}>();

defineEmits<{
  'open-settings': [];
  'create-session': [];
}>();

const { t } = useI18n();
</script>

<style scoped>
.agent-guide {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 24px;
  user-select: none;
}
.guide-icon {
  font-size: 40px;
  color: var(--text-secondary);
  opacity: 0.35;
  margin-bottom: 14px;
}
.guide-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 6px;
}
.guide-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 22px;
  line-height: 1.5;
}
.guide-cta {
  background: var(--accent-color);
  color: #fff;
  border: none;
  padding: 8px 24px;
  font-size: 13px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  margin-bottom: 8px;
}
.guide-cta:hover {
  background: var(--accent-hover);
}
</style>
