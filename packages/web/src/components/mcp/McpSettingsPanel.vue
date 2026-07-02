<template>
  <div class="mcp-panel">
    <div class="mcp-header">
      <span class="mcp-title">{{ $t('mcp.title') }}</span>
      <button class="add-btn" @click="openAddDialog" :title="$t('mcp.addServer')">+</button>
    </div>
    <div class="mcp-body">
      <!-- Empty state -->
      <div v-if="settings.servers.value.length === 0" class="mcp-empty">
        <span class="mcp-empty-icon">🔌</span>
        <p class="mcp-empty-title">{{ $t('mcp.noServers') }}</p>
        <p class="mcp-empty-desc">{{ $t('mcp.noServersDesc') }}</p>
        <button class="mcp-empty-cta" @click="openAddDialog">{{ $t('mcp.addServer') }}</button>
      </div>

      <!-- Server list -->
      <template v-else>
        <McpServerItem
          v-for="server in settings.servers.value"
          :key="server.id"
          :server="server"
          @edit="openEditDialog(server)"
          @delete="handleDelete(server)"
          @toggle="settings.toggleServer(server.id)"
        />
      </template>
    </div>

    <!-- Add / Edit Dialog -->
    <McpEditDialog
      :visible="dialogVisible"
      :server="editingServer"
      @close="dialogVisible = false"
      @saved="handleSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { McpServerConfig, McpToolInfo } from '@openwork/agent';
import type { McpServerUI } from '../../types/mcp-ui';
import { useMcpSettings } from '../../composables/useMcpSettings';
import McpServerItem from './McpServerItem.vue';
import McpEditDialog from './McpEditDialog.vue';

const { t } = useI18n();
const settings = useMcpSettings();

const dialogVisible = ref(false);
const editingServer = ref<McpServerUI | null>(null);

function openAddDialog() {
  editingServer.value = null;
  dialogVisible.value = true;
}

function openEditDialog(server: McpServerUI) {
  editingServer.value = server;
  dialogVisible.value = true;
}

async function handleSaved(id: string, config: McpServerConfig, name: string, description: string, tools: McpToolInfo[]) {
  if (editingServer.value) {
    settings.setTools(id, tools);
  } else {
    // 服务端已保存，直接更新本地状态（含工具列表）
    settings.addLocal(id, config, name, description, tools);
  }
  dialogVisible.value = false;
  editingServer.value = null;
}

function handleDelete(server: McpServerUI) {
  if (window.confirm(t('mcp.deleteConfirm'))) {
    settings.removeServer(server.id);
  }
}
</script>

<style scoped>
.mcp-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.mcp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.mcp-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
}
.add-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 400;
  line-height: 1;
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.add-btn:hover {
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-color: var(--text-secondary);
}
.mcp-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
/* Empty state */
.mcp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  text-align: center;
  height: 100%;
}
.mcp-empty-icon {
  font-size: 48px;
  display: block;
  margin-bottom: 16px;
  opacity: 0.4;
}
.mcp-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}
.mcp-empty-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 20px 0;
  max-width: 260px;
}
.mcp-empty-cta {
  padding: 6px 16px;
  font-size: 12px;
  background: var(--accent-color);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}
.mcp-empty-cta:hover {
  background: var(--accent-hover);
}
</style>
