<template>
  <n-modal
    v-model:show="showModal"
    preset="card"
    :title="$t('openDialog.selectFolder')"
    style="width: 680px; max-width: calc(100vw - 48px); min-width: 480px; max-height: 80vh"
    @after-leave="$emit('cancel')"
  >
    <div class="folder-picker">
      <div class="picker-path-area">
        <div v-if="!editingPath" class="breadcrumbs">
          <button
            v-for="crumb in displayBreadcrumbs"
            :key="crumb.path"
            class="breadcrumb"
            @click="navigateToPath(crumb.path)"
          >
            {{ crumb.name || crumb.path }}
          </button>
          <button class="path-edit-btn" :title="$t('openDialog.editPath')" @click="beginEditPath">
            <n-icon size="14" :component="PencilOutline" />
          </button>
        </div>
        <input
          v-else
          ref="pathInputRef"
          v-model="pathInput"
          class="path-editor"
          type="text"
          :placeholder="$t('openDialog.pathPlaceholder')"
          @keydown.enter.prevent="submitPath"
          @keydown.esc.prevent="cancelEditPath"
        />
      </div>

      <div v-if="error" class="picker-error">{{ error }}</div>

      <div class="columns">
        <div class="column">
          <div class="column-header">{{ $t('openDialog.currentDirectory') }}</div>
          <div class="column-list">
            <n-spin v-if="currentLoading && currentEntries.length === 0" size="small" class="column-state" />
            <template v-else>
              <button
                v-for="entry in visibleCurrentEntries"
                :key="entry.path"
                class="dir-row"
                :class="{ selected: selectedPath === entry.path }"
                @click="selectCurrent(entry)"
              >
                <n-icon size="16" :component="selectedPath === entry.path ? FolderOpenOutline : FolderOutline" />
                <span class="dir-name">{{ entry.name }}</span>
                <n-icon size="14" class="dir-chevron" :component="ChevronForwardOutline" />
              </button>
              <div v-if="!currentLoading && visibleCurrentEntries.length === 0" class="column-state">
                {{ currentPath ? $t('openDialog.emptyFolder') : $t('openDialog.loading') }}
              </div>
            </template>
          </div>
          <div v-if="truncated" class="truncated-hint">{{ $t('openDialog.truncated') }}</div>
        </div>

        <div v-if="selectedPath" class="column">
          <div class="column-header">{{ selectedPath }}</div>
          <div class="column-list">
            <n-spin v-if="childLoading && childEntries.length === 0" size="small" class="column-state" />
            <template v-else>
              <button
                v-for="entry in visibleChildEntries"
                :key="entry.path"
                class="dir-row"
                @click="selectChild(entry)"
              >
                <n-icon size="16" :component="FolderOutline" />
                <span class="dir-name">{{ entry.name }}</span>
                <n-icon size="14" class="dir-chevron" :component="ChevronForwardOutline" />
              </button>
              <div v-if="childError" class="column-state">{{ childError }}</div>
              <div v-else-if="!childLoading && visibleChildEntries.length === 0" class="column-state">
                {{ $t('openDialog.emptyFolder') }}
              </div>
            </template>
          </div>
          <div v-if="childTruncated" class="truncated-hint">{{ $t('openDialog.truncated') }}</div>
        </div>
      </div>

      <div class="picker-footer">
        <button class="footer-btn" :disabled="!selectedPath && !currentPath" @click="openNewFolderDialog">
          <n-icon size="14" :component="CreateOutline" />
          <span>{{ $t('openDialog.newFolder') }}</span>
        </button>
        <label class="show-hidden">
          <input v-model="showHidden" type="checkbox" />
          <n-icon size="14" :component="showHidden ? EyeOutline : EyeOffOutline" />
          <span>{{ $t('openDialog.showHidden') }}</span>
        </label>
        <div class="footer-spacer"></div>
        <n-button size="small" @click="$emit('cancel')">{{ $t('openDialog.cancel') }}</n-button>
        <n-button size="small" type="primary" :disabled="!selectedPath && !currentPath" @click="confirm">
          {{ $t('openDialog.open') }}
        </n-button>
      </div>
    </div>

    <n-modal
      v-model:show="newFolderVisible"
      preset="card"
      :title="$t('openDialog.newFolderTitle')"
      style="width: 400px"
    >
      <n-text depth="3">{{ newFolderParent }}</n-text>
      <n-input
        ref="newFolderInputRef"
        v-model:value="newFolderName"
        :placeholder="$t('openDialog.folderName')"
        :status="newFolderError ? 'error' : undefined"
        @keydown.enter.prevent="submitNewFolder"
        @keydown.esc.prevent="cancelNewFolder"
        @input="newFolderError = ''"
      />
      <div v-if="newFolderError" class="new-folder-error">{{ newFolderError }}</div>
      <template #footer>
        <n-button size="small" :disabled="creating" @click="cancelNewFolder">{{ $t('openDialog.cancel') }}</n-button>
        <n-button size="small" type="primary" :loading="creating" :disabled="!newFolderName.trim()" @click="submitNewFolder">
          {{ $t('openDialog.create') }}
        </n-button>
      </template>
    </n-modal>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NIcon, NInput, NModal, NSpin, NText } from 'naive-ui';
import {
  ChevronForwardOutline,
  CreateOutline,
  EyeOffOutline,
  EyeOutline,
  FolderOpenOutline,
  FolderOutline,
  PencilOutline,
} from '@vicons/ionicons5';
import {
  createFileServiceClient,
  type DirectoryEntry,
  type FileServiceClient,
} from '../../services/fileService';

const { t } = useI18n();

const emit = defineEmits<{
  confirm: [rootPath: string];
  cancel: [];
}>();

const client: FileServiceClient = createFileServiceClient();

const showModal = ref(true);
const currentPath = ref<string | null>(null);
const selectedPath = ref<string | null>(null);
const currentEntries = ref<DirectoryEntry[]>([]);
const childEntries = ref<DirectoryEntry[]>([]);
const breadcrumbs = ref<DirectoryEntry[]>([]);
const childBreadcrumbs = ref<DirectoryEntry[]>([]);
const currentLoading = ref(false);
const childLoading = ref(false);
const error = ref('');
const childError = ref('');
const truncated = ref(false);
const childTruncated = ref(false);
const showHidden = ref(false);
const editingPath = ref(false);
const pathInput = ref('');
const pathInputRef = ref<HTMLInputElement | null>(null);

const newFolderVisible = ref(false);
const newFolderParent = ref<string | null>(null);
const newFolderName = ref('');
const newFolderError = ref('');
const newFolderInputRef = ref<{ focus: () => void } | null>(null);
const creating = ref(false);

let currentNavRequest = 0;
let childNavRequest = 0;

const visibleCurrentEntries = computed(() => filterHidden(currentEntries.value));
const visibleChildEntries = computed(() => filterHidden(childEntries.value));
const displayBreadcrumbs = computed(() => {
  if (breadcrumbs.value.length > 0) return breadcrumbs.value;
  const fallbackPath = selectedPath.value || currentPath.value;
  if (!fallbackPath) return [];
  return [{ name: fallbackPath, path: fallbackPath, isDirectory: true }];
});

function filterHidden(entries: DirectoryEntry[]): DirectoryEntry[] {
  if (showHidden.value) return entries;
  return entries.filter((entry) => !entry.hidden);
}

async function loadCurrent(path?: string) {
  const requestId = ++currentNavRequest;
  childNavRequest++;
  currentLoading.value = true;
  error.value = '';
  try {
    const result = await client.listDirectories?.(path);
    if (!result || requestId !== currentNavRequest) return;
    currentPath.value = result.path;
    currentEntries.value = result.entries;
    breadcrumbs.value = result.breadcrumbs;
    truncated.value = result.truncated;
    selectedPath.value = null;
    childEntries.value = [];
    childBreadcrumbs.value = [];
    childTruncated.value = false;
    childError.value = '';
    editingPath.value = false;
    pathInput.value = result.path;
  } catch (err) {
    if (requestId !== currentNavRequest) return;
    error.value = err instanceof Error ? err.message : t('openDialog.permissionDenied');
  } finally {
    if (requestId === currentNavRequest) currentLoading.value = false;
  }
}

async function loadChild(path: string) {
  const requestId = ++childNavRequest;
  childLoading.value = true;
  childError.value = '';
  try {
    const result = await client.listDirectories?.(path);
    if (!result || requestId !== childNavRequest) return;
    if (selectedPath.value !== path) return;
    childEntries.value = result.entries;
    childBreadcrumbs.value = result.breadcrumbs;
    childTruncated.value = result.truncated;
  } catch (err) {
    if (requestId !== childNavRequest) return;
    childError.value = err instanceof Error ? err.message : t('openDialog.permissionDenied');
  } finally {
    if (requestId === childNavRequest) childLoading.value = false;
  }
}

function selectCurrent(entry: DirectoryEntry) {
  selectedPath.value = entry.path;
  void loadChild(entry.path);
}

function selectChild(entry: DirectoryEntry) {
  if (!selectedPath.value) return;
  currentPath.value = selectedPath.value;
  currentEntries.value = childEntries.value;
  breadcrumbs.value = childBreadcrumbs.value;
  truncated.value = childTruncated.value;
  selectedPath.value = entry.path;
  void loadChild(entry.path);
}

function navigateToPath(path: string) {
  if (!path) return;
  editingPath.value = false;
  void loadCurrent(path);
}

function beginEditPath() {
  pathInput.value = currentPath.value || selectedPath.value || '';
  editingPath.value = true;
  nextTick(() => pathInputRef.value?.focus());
}

function submitPath() {
  const input = pathInput.value.trim();
  if (!input) return;
  void loadCurrent(input);
}

function cancelEditPath() {
  editingPath.value = false;
  pathInput.value = currentPath.value || '';
}

function openNewFolderDialog() {
  const parent = selectedPath.value || currentPath.value;
  if (!parent) return;
  newFolderParent.value = parent;
  newFolderName.value = '';
  newFolderError.value = '';
  newFolderVisible.value = true;
  nextTick(() => newFolderInputRef.value?.focus());
}

function validateNewFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return t('openDialog.emptyFolderName');
  if (trimmed === '.' || trimmed === '..') return t('openDialog.invalidFolderName');
  if (trimmed.includes('/') || trimmed.includes('\\')) return t('openDialog.invalidFolderName');
  return null;
}

async function submitNewFolder() {
  const name = newFolderName.value.trim();
  const validationError = validateNewFolderName(name);
  if (validationError) {
    newFolderError.value = validationError;
    return;
  }
  const parent = newFolderParent.value;
  if (!parent) return;

  creating.value = true;
  newFolderError.value = '';
  try {
    const entry = await client.createDirectory?.(parent, name);
    if (!entry) throw new Error(t('openDialog.createFolderFailed'));
    newFolderVisible.value = false;

    if (parent === currentPath.value) {
      await loadCurrent(parent);
      selectedPath.value = entry.path;
      await loadChild(entry.path);
    } else if (parent === selectedPath.value) {
      const parentPath = parent;
      await loadChild(parentPath);
      currentPath.value = parentPath;
      currentEntries.value = childEntries.value;
      breadcrumbs.value = childBreadcrumbs.value;
      truncated.value = childTruncated.value;
      selectedPath.value = entry.path;
      await loadChild(entry.path);
    }
  } catch (err) {
    newFolderError.value = err instanceof Error ? err.message : t('openDialog.createFolderFailed');
  } finally {
    creating.value = false;
  }
}

function cancelNewFolder() {
  newFolderVisible.value = false;
  newFolderName.value = '';
  newFolderError.value = '';
}

function confirm() {
  const path = selectedPath.value || currentPath.value;
  if (path) emit('confirm', path);
}

onMounted(() => {
  void loadCurrent();
});
</script>

<style scoped>
.folder-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.picker-path-area {
  min-height: 28px;
  display: flex;
  align-items: center;
}

.breadcrumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.breadcrumb {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-sm);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.breadcrumb:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}

.path-edit-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.path-edit-btn:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}

.path-editor {
  width: 100%;
  height: 28px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--font-sm);
  padding: 0 var(--space-2);
  outline: none;
}

.path-editor:focus {
  border-color: var(--accent);
}

.picker-error {
  font-size: var(--font-sm);
  color: var(--danger);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--surface-1);
}

.columns {
  display: flex;
  gap: var(--space-2);
  min-height: 280px;
  max-height: 360px;
}

.column {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.column-header {
  padding: var(--space-2) var(--space-3);
  font-size: var(--font-xs);
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}

.column-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-1);
}

.dir-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 32px;
  padding: 0 var(--space-2);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.dir-row:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.dir-row.selected {
  background: var(--surface-selected);
  color: var(--text-primary);
}

.dir-name {
  flex: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dir-chevron {
  color: var(--text-muted);
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.dir-row:hover .dir-chevron,
.dir-row.selected .dir-chevron {
  opacity: 1;
}

.column-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 120px;
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.truncated-hint {
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-xs);
  color: var(--text-muted);
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.picker-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.footer-btn {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  height: 28px;
  padding: 0 var(--space-2);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.footer-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.footer-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.show-hidden {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-sm);
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.footer-spacer {
  flex: 1;
}

.new-folder-error {
  color: var(--danger);
  font-size: var(--font-sm);
  margin-top: var(--space-2);
}
</style>
