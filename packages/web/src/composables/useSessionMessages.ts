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
 *     () => store.workspaceRoot,
 *   );
 *
 * - workspaceId 或 sessionId 变化时自动 refresh
 * - 流式结束后调用方应主动调用 refresh() 以拉取最新落盘数据
 * - 内建 generation counter,防止快速切换时旧响应覆盖新数据
 */
export function useSessionMessages(
  workspaceIdGetter: () => string | null | undefined,
  sessionIdGetter: () => string | null | undefined,
  workspaceRootGetter: () => string | null | undefined,
) {
  const messages = ref<DisplayMessage[]>([]);
  const loading = ref(false);
  let refreshGen = 0;

  async function refresh() {
    const wid = workspaceIdGetter();
    const sid = sessionIdGetter();
    if (!wid || !sid) {
      // wid/sid 为 null 时不清空已有消息 —— 避免流结束后 refresh 因为
      // workspaceId 暂时不可用而把内容全清掉。session 切换时的清空
      // 由 watch 中的 refresh 调用自然处理(新 session 本来就没数据)。
      return;
    }

    const gen = ++refreshGen;
    loading.value = true;
    try {
      const client = createFileServiceClient();
      const root = workspaceRootGetter();
      const result = await client.getSessionMessages(wid, sid, root ?? undefined);
      // 仅当没有更新的 refresh 请求时才应用结果
      if (gen === refreshGen) {
        messages.value = result;
      }
    } catch (e: any) {
      if (gen === refreshGen) {
        webAgentLog.error(`useSessionMessages.refresh failed: ${e.message}`, { workspaceId: wid, sessionId: sid });
      }
    } finally {
      if (gen === refreshGen) {
        loading.value = false;
      }
    }
  }

  // 只监听 sessionId 变化即可:workspace 切换时 sessionId 一定会变(由 bindWorkspace 设置),
  // 无需 workspaceId watcher 导致的双重 fetch。
  watch(sessionIdGetter, (_new, _old) => {
    // immediate 首次触发时(old===undefined)不清空(本来就是空的),
    // 只在真正切换 session 时清空
    if (_old !== undefined) {
      messages.value = [];
    }
    refresh();
  }, { immediate: true });

  return { messages, loading, refresh };
}
