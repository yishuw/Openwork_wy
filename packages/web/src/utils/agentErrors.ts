/** 把 Agent 流式/LLM 错误转成用户可读文案（优先中文） */
export function formatAgentStreamError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  const msg = raw || 'unknown error';
  if (/401|Authentication Fails|invalid api key|api key.*invalid/i.test(msg)) {
    return '认证失败：API Key 无效或已过期。请在「设置 → 模型服务」中更新密钥后重试。';
  }
  if (/429|rate limit|quota/i.test(msg)) {
    return '请求过于频繁或额度不足，请稍后再试，或检查服务商配额。';
  }
  if (/404|model.*not/i.test(msg)) {
    return '模型不存在或不可用，请在设置中检查模型名称。';
  }
  if (/ECONNREFUSED|fetch failed|network/i.test(msg)) {
    return '无法连接模型服务，请检查网络或本地 Agent 服务是否已启动。';
  }
  return `Agent 请求失败：${msg}`;
}
