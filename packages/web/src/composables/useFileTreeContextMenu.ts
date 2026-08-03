import { ref } from 'vue';

/**
 * 文件树"重命名 / 新建"的内联编辑状态与确认处理。
 * 右键菜单动作由 NewFileTree 的 @menu-action 事件驱动(MainLayout.handleNewMenuAction)。
 */
export function useFileTreeContextMenu(
  fs: any,
  store: any,
  _t: (key: string) => string,
  _callbacks: {
    clearDirState: () => void;
    handleExpandDir: (path: string) => void;
  },
) {
  const renamingPath = ref<string | null>(null);
  const creatingInDir = ref<{ path: string; type: 'file' | 'folder' } | null>(null);
  const creatingNodeKey = ref(0);

  async function handleConfirmRename(oldPath: string, newName: string) {
    renamingPath.value = null;
    if (newName === oldPath.replace(/^.*[/\\]/, '')) return;
    await fs.renameFile(oldPath, newName);
  }

  async function handleConfirmCreate(parentPath: string, name: string, type: 'file' | 'folder') {
    creatingInDir.value = null;
    creatingNodeKey.value++;
    if (type === 'folder') {
      await fs.createDirInPath(parentPath, name);
    } else {
      await fs.createFileInDir(parentPath, name);
    }
  }

  function handleCancelCreate() {
    creatingInDir.value = null;
    creatingNodeKey.value++;
  }

  return {
    renamingPath,
    creatingInDir,
    creatingNodeKey,
    handleConfirmRename,
    handleConfirmCreate,
    handleCancelCreate,
  };
}
