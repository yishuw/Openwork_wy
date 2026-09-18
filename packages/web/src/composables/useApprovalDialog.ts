import { ref } from 'vue';
import type { ApprovalRequiredEvent } from '../services/agentService';
import { createAgentService } from '../services/agentService';
import { webAgentLog } from './logger';
import { i18n } from '../locales';

const APPROVAL_CLIENT_TIMEOUT_MS = 55_000;

export function useApprovalDialog() {
  const pendingApproval = ref<ApprovalRequiredEvent | null>(null);
  const dialogVisible = ref(false);
  const errorMessage = ref('');
  let resolver: ((d: 'allow' | 'deny') => void) | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDecision: 'allow' | 'deny' = 'deny';
  const agentService = createAgentService();

  function openApproval(req: ApprovalRequiredEvent): Promise<'allow' | 'deny'> {
    // 若已有未完成请求，先 deny 前一个
    if (resolver) {
      webAgentLog.warn('openApproval: previous request auto-denied');
      resolver('deny');
    }

    pendingApproval.value = req;
    dialogVisible.value = true;
    errorMessage.value = '';
    lastDecision = 'deny';

    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(() => {
      webAgentLog.warn('approval client timeout, auto-deny');
      errorMessage.value = i18n.global.t('approval.timeout');
      void resolveApproval('deny');
    }, APPROVAL_CLIENT_TIMEOUT_MS);

    return new Promise<'allow' | 'deny'>((resolve) => {
      resolver = resolve;
    });
  }

  async function resolveApproval(decision: 'allow' | 'deny'): Promise<void> {
    const req = pendingApproval.value;
    if (!req || !resolver) return;

    lastDecision = decision;
    try {
      const result = await agentService.sendApproval(req.approvalId, decision);
      if (!result.success) {
        errorMessage.value = i18n.global.t('approval.alreadyResolved');
        resolver('deny');
        cleanup();
        return;
      }
      resolver(decision);
      cleanup();
    } catch (e: any) {
      // 网络错误：不 resolve，弹窗保持打开，用户可重试
      errorMessage.value = i18n.global.t('approval.networkError');
      webAgentLog.error(`sendApproval failed: ${e.message}`);
    }
  }

  async function retryApproval(): Promise<void> {
    errorMessage.value = '';
    await resolveApproval(lastDecision);
  }

  function cancelAllPending(): void {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = null;
    if (resolver) {
      resolver('deny');
    }
    cleanup();
  }

  function cleanup(): void {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = null;
    resolver = null;
    pendingApproval.value = null;
    dialogVisible.value = false;
    errorMessage.value = '';
  }

  return {
    pendingApproval,
    dialogVisible,
    errorMessage,
    openApproval,
    resolveApproval,
    retryApproval,
    cancelAllPending,
  };
}
