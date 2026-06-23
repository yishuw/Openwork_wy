import { ref, watch, type Ref } from 'vue';
import { createFileServiceClient } from '../services/fileService';
import type { DisplayMessage } from '@vibeeditor/agent';
import { webAgentLog } from '../services/logger';

/**
 * 从后端拉取指定 session 的展示消息列表。
 *
 * 用法:
 *   const { messages, refresh, loading } = useSessionMessages(
 *     () => store.activeWorkspaceId,
 *     () => sessionStore.activeSessionId,
 *   );
 *
 * - workspaceId 或 sessionId 变化时自动 refresh
 * - 流式结束后调用方应主动调用 refresh() 以拉取最新落盘数据
 */
export function useSessionMessages(
  workspaceIdGetter: () => string | null | undefined,
  sessionIdGetter: () => string | null | undefined,
) {
  const messages = ref<DisplayMessage[]>([]);
  const loading = ref(false);
  let activeWorkspaceId: string | null = null;
  let activeSessionId: string | null = null;

  async function refresh() {
    const wid = workspaceIdGetter();
    const sid = sessionIdGetter();
    if (!wid || !sid) {
      messages.value = [];
      return;
    }
    loading.value = true;
    try {
      const client = createFileServiceClient();
      messages.value = await client.getSessionMessages(wid, sid);
    } catch (e: any) {
      webAgentLog.error(`useSessionMessages.refresh failed: ${e.message}`, { workspaceId: wid, sessionId: sid });
    } finally {
      loading.value = false;
    }
  }

  // 两个 getter 都用 watch 监听,任一变化触发 refresh
  watch(workspaceIdGetter, () => {
    activeWorkspaceId = workspaceIdGetter() ?? null;
    refresh();
  }, { immediate: true });

  watch(sessionIdGetter, () => {
    activeSessionId = sessionIdGetter() ?? null;
    refresh();
  }, { immediate: true });

  void activeWorkspaceId; void activeSessionId;

  return { messages, loading, refresh };
}
