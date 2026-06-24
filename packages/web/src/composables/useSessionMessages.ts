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

  async function refresh() {
    const wid = workspaceIdGetter();
    const sid = sessionIdGetter();
    if (!wid || !sid) {
      // wid/sid 为 null 时不清空已有消息 —— 避免流结束后 refresh 因为
      // workspaceId 暂时不可用而把内容全清掉。session 切换时的清空
      // 由 watch 中的 refresh 调用自然处理(新 session 本来就没数据)。
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
  // session/workspace 切换时先清空再 refresh,避免新 session 显示旧数据
  watch(workspaceIdGetter, () => {
    messages.value = [];
    refresh();
  }, { immediate: true });

  watch(sessionIdGetter, () => {
    messages.value = [];
    refresh();
  });

  return { messages, loading, refresh };
}
