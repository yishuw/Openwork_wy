<template>
  <n-modal
    v-model:show="showModal"
    preset="card"
    :title="isEdit ? $t('mcp.editServer') : $t('mcp.addServer')"
    style="width: 460px"
    @after-leave="$emit('close')"
  >
    <n-form ref="formRef" :model="form" label-placement="top" size="small">
      <n-form-item :label="$t('mcp.name')" required>
        <n-input v-model:value="form.name" :placeholder="$t('mcp.name')" />
        <span v-if="errors.name" class="form-error">{{ errors.name }}</span>
      </n-form-item>

      <n-form-item :label="$t('mcp.description')">
        <n-input v-model:value="form.description" :placeholder="$t('mcp.description')" />
      </n-form-item>

      <n-form-item :label="$t('mcp.type')" required>
        <n-select v-model:value="form.type" :options="typeOptions" />
        <span v-if="errors.type" class="form-error">{{ errors.type }}</span>
      </n-form-item>

      <template v-if="form.type === 'stdio'">
        <n-form-item :label="$t('mcp.command')" required>
          <n-input v-model:value="form.command" placeholder="npx" />
          <span v-if="errors.command" class="form-error">{{ errors.command }}</span>
        </n-form-item>
        <n-form-item :label="$t('mcp.args')">
          <n-input v-model:value="form.args" :placeholder="'-y, @scope/server, --option'" />
        </n-form-item>
        <n-form-item :label="$t('mcp.env')">
          <n-input v-model:value="form.env" type="textarea" :autosize="{ minRows: 2 }" placeholder="KEY1=value1&#10;KEY2=value2" />
        </n-form-item>
        <n-form-item :label="$t('mcp.cwd')">
          <n-input v-model:value="form.cwd" placeholder="/path/to/project" />
        </n-form-item>
      </template>

      <template v-if="form.type === 'http' || form.type === 'sse'">
        <n-form-item :label="$t('mcp.url')" required>
          <n-input v-model:value="form.url" placeholder="http://localhost:3000/mcp" />
          <span v-if="errors.url" class="form-error">{{ errors.url }}</span>
        </n-form-item>
        <n-form-item :label="$t('mcp.headers')">
          <n-input v-model:value="form.headers" type="textarea" :autosize="{ minRows: 2 }" placeholder="Authorization=Bearer token&#10;X-Custom=value" />
        </n-form-item>
        <n-form-item v-if="form.type === 'http'" :label="$t('mcp.sessionId')">
          <n-input v-model:value="form.sessionId" placeholder="session-id" />
        </n-form-item>
      </template>

      <div v-if="resultMsg" class="result-msg" :class="{ success: resultSuccess, error: !resultSuccess }">
        {{ resultMsg }}
      </div>
    </n-form>

    <template #footer>
      <n-button type="primary" :loading="testing" @click="handleSave">
        {{ testing ? $t('mcp.testing') : $t('mcp.testAndSave') }}
      </n-button>
      <n-button :disabled="testing" @click="handleCancel">
        {{ $t('mcp.cancel') }}
      </n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NModal, NButton, NForm, NFormItem, NInput, NSelect } from 'naive-ui'
import type { McpServerConfig, McpToolInfo } from '@openwork/agent'
import type { McpServerUI } from '../../types/mcp-ui'
import { getMcpService } from '../../services/mcpService'

const { t } = useI18n()
const mcpService = getMcpService()

const props = defineProps<{
  visible: boolean
  server: McpServerUI | null
}>()

const emit = defineEmits<{
  close: []
  saved: [id: string, config: McpServerConfig, name: string, description: string, tools: McpToolInfo[]]
}>()

const showModal = ref(props.visible)
watch(() => props.visible, (v) => { showModal.value = v })

const isEdit = computed(() => !!props.server)

const typeOptions = [
  { value: 'stdio', label: 'STDIO' },
  { value: 'http', label: 'HTTP Streamable' },
  { value: 'sse', label: 'SSE' },
]

interface FormState {
  name: string; description: string; type: string
  command: string; args: string; env: string; cwd: string
  url: string; headers: string; sessionId: string
}

const emptyForm = (): FormState => ({
  name: '', description: '', type: 'stdio',
  command: '', args: '', env: '', cwd: '',
  url: '', headers: '', sessionId: '',
})

const form = reactive<FormState>(emptyForm())
const errors = reactive<Record<string, string>>({})
const testing = ref(false)
const resultMsg = ref('')
const resultSuccess = ref(false)

watch(() => props.visible, (v) => {
  if (v) {
    resultMsg.value = ''
    resultSuccess.value = false
    Object.keys(errors).forEach(k => delete errors[k])
    if (props.server) {
      const s = props.server
      form.name = s.name
      form.description = s.description || ''
      form.type = s.config.type
      form.command = s.config.type === 'stdio' ? (s.config as any).command || '' : ''
      form.args = s.config.type === 'stdio' ? ((s.config as any).args || []).join(', ') : ''
      form.env = s.config.type === 'stdio' && (s.config as any).env ? objectToLines((s.config as any).env) : ''
      form.cwd = s.config.type === 'stdio' ? (s.config as any).cwd || '' : ''
      form.url = (s.config.type === 'http' || s.config.type === 'sse') ? (s.config as any).url || '' : ''
      form.headers = (s.config.type === 'http' || s.config.type === 'sse') && (s.config as any).headers ? objectToLines((s.config as any).headers) : ''
      form.sessionId = s.config.type === 'http' ? (s.config as any).sessionId || '' : ''
    } else {
      Object.assign(form, emptyForm())
    }
  }
})

function clearErrors() { Object.keys(errors).forEach(k => delete errors[k]) }

function objectToLines(obj: Record<string, string>): string {
  return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n')
}

function parseKeyValue(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!text.trim()) return result
  for (const line of text.split('\n').map(l => l.trim()).filter(Boolean)) {
    const eqIdx = line.indexOf('=')
    const colonIdx = line.indexOf(':')
    const sepIdx = eqIdx >= 0 ? eqIdx : colonIdx
    if (sepIdx >= 0) {
      const key = line.slice(0, sepIdx).trim()
      const value = line.slice(sepIdx + 1).trim()
      if (key) result[key] = value
    }
  }
  return result
}

function parseArgs(text: string): string[] {
  return text.split(',').map(s => s.trim()).filter(Boolean)
}

function validate(): boolean {
  clearErrors()
  if (!form.name.trim()) errors.name = 'Name is required'
  if (!form.type || !typeOptions.some(o => o.value === form.type)) errors.type = 'Invalid type'
  if (form.type === 'stdio' && !form.command.trim()) errors.command = 'Command is required'
  if (form.type === 'http' || form.type === 'sse') {
    if (!form.url.trim()) errors.url = 'URL is required'
    else if (!/^https?:\/\/.+/.test(form.url.trim())) errors.url = 'URL must start with http:// or https://'
  }
  return Object.keys(errors).length === 0
}

function buildConfig(): McpServerConfig {
  if (form.type === 'stdio') {
    return {
      type: 'stdio', name: form.name.trim(),
      command: form.command.trim(), args: parseArgs(form.args),
      env: parseKeyValue(form.env), cwd: form.cwd.trim() || undefined,
    } as McpServerConfig
  }
  if (form.type === 'sse') {
    return {
      type: 'sse', name: form.name.trim(),
      url: form.url.trim(), headers: parseKeyValue(form.headers),
    } as McpServerConfig
  }
  return {
    type: 'http', name: form.name.trim(),
    url: form.url.trim(), headers: parseKeyValue(form.headers),
    sessionId: form.sessionId.trim() || undefined,
  } as McpServerConfig
}

async function handleSave() {
  if (!validate()) return
  testing.value = true
  resultMsg.value = ''
  resultSuccess.value = false

  try {
    const config = buildConfig()
    const name = form.name.trim()
    const description = form.description.trim()

    let serverId: string
    if (isEdit.value && props.server) {
      await mcpService.updateServer(props.server.id, { config, name, description, enabled: props.server.enabled })
      serverId = props.server.id
    } else {
      const entry = await mcpService.addServer({ config, name, description, enabled: true })
      serverId = entry.id
    }

    const result = await mcpService.testServer(serverId)

    if (result.success && result.tools) {
      resultMsg.value = t('mcp.testSuccess', { n: result.tools.length })
      resultSuccess.value = true
      setTimeout(() => {
        emit('saved', serverId, config, name, description, result.tools!)
      }, 600)
    } else {
      resultMsg.value = `${t('mcp.testFailed')}: ${result.error || 'Unknown error'}`
      resultSuccess.value = false
    }
  } catch (err) {
    resultMsg.value = `${t('mcp.testFailed')}: ${err instanceof Error ? err.message : String(err)}`
    resultSuccess.value = false
  } finally {
    testing.value = false
  }
}

function handleCancel() {
  if (testing.value) return
  emit('close')
}
</script>

<style scoped>
.form-error {
  display: block;
  font-size: 10px;
  color: #f44336;
  margin-top: 3px;
}
.result-msg {
  font-size: 11px;
  padding: 6px 8px;
  border-radius: 4px;
  margin-top: 6px;
}
.result-msg.success {
  background: rgba(76, 175, 80, 0.1);
  color: #4caf50;
}
.result-msg.error {
  background: rgba(244, 67, 54, 0.1);
  color: #f44336;
}
</style>
