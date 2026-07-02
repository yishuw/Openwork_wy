<template>
  <div class="mcp-content">
    <div class="mcp-toolbar">
      <n-button size="small" type="primary" @click="openAddDialog">
        <template #icon><n-icon :component="AddOutline" /></template>
        {{ $t('mcp.addServer') }}
      </n-button>
    </div>

    <div class="mcp-body">
      <div v-if="settings.servers.value.length === 0" class="mcp-empty">
        <n-empty :description="$t('mcp.noServersDesc')">
          <template #header>
            <span class="empty-title">{{ $t('mcp.noServers') }}</span>
          </template>
        </n-empty>
      </div>

      <McpServerItem
        v-for="server in settings.servers.value"
        :key="server.id"
        :server="server"
        @edit="openEditDialog(server)"
        @delete="handleDelete(server)"
        @toggle="settings.toggleServer(server.id)"
      />
    </div>

    <McpEditDialog
      :visible="dialogVisible"
      :server="editingServer"
      @close="dialogVisible = false"
      @saved="handleSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NIcon, NEmpty } from 'naive-ui'
import { AddOutline } from '@vicons/ionicons5'
import type { McpServerConfig, McpToolInfo } from '@openwork/agent'
import type { McpServerUI } from '../../types/mcp-ui'
import { useMcpSettings } from '../../composables/useMcpSettings'
import McpServerItem from '../mcp/McpServerItem.vue'
import McpEditDialog from '../mcp/McpEditDialog.vue'

const { t } = useI18n()
const settings = useMcpSettings()

const dialogVisible = ref(false)
const editingServer = ref<McpServerUI | null>(null)

function openAddDialog() {
  editingServer.value = null
  dialogVisible.value = true
}

function openEditDialog(server: McpServerUI) {
  editingServer.value = server
  dialogVisible.value = true
}

function handleSaved(id: string, config: McpServerConfig, name: string, description: string, tools: McpToolInfo[]) {
  if (editingServer.value) {
    settings.setTools(id, tools)
  } else {
    settings.addLocal(id, config, name, description, tools)
  }
  dialogVisible.value = false
  editingServer.value = null
}

function handleDelete(server: McpServerUI) {
  if (window.confirm(t('mcp.deleteConfirm'))) {
    settings.removeServer(server.id)
  }
}
</script>

<style scoped>
.mcp-content {
  display: flex;
  flex-direction: column;
}
.mcp-toolbar {
  margin-bottom: 12px;
}
.mcp-body {
  max-height: 300px;
  overflow-y: auto;
}
.mcp-empty {
  text-align: center;
  padding: 16px 0;
}
.empty-title {
  font-size: 13px;
  font-weight: 600;
}
</style>
