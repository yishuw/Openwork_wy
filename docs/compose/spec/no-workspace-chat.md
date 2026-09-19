---
feature: no-workspace-chat
status: delivered
updated: 2026-09-19
branch: feature/下一阶段-智能体IDE体验
commits: 92da5fa..591ea4e
---

# 无工作区纯聊天

## Report

**What was built** — 打开软件后若已配置 LLM Provider、但未打开工作区，Agent 输入框可用，可做通用问答；文件类工具仍注册，调用时统一返回「当前未打开工作区…」友好错误。Server 在无有效 `workspaceRoot` 时不再回退 `process.cwd()`（含仅有 `workspaceId` 的路径）。系统提示（build/plan）在空 root 时说明文件工具不可用。前端空状态提供「打开工作区」入口。

**Verification** — `packages/agent` `npm run build` + `npm test`：**121/121 PASS**（含 `no-workspace-chat.test.ts`）；`packages/server` `npx tsc --noEmit`：**PASS**。评审指出的 cwd 残留与 plan 模式提示词已修复后重跑通过。web `vue-tsc` 仅存量问题（`__SERVER_PORT__`、mode 类型等），与本功能无关。

**Journey log** — 1) 对话本不依赖「已打开文件」，挡输入的是无 Provider/无工作区引导页。2) 产品决策：无工作区可聊天；工具保留但调用报错。3) 评审：`workspaceId` 有值但 root 为空时仍 cwd 兜底并 cache runtime → 已改为永不 cwd。4) plan 模式曾漏用 `resolveEffectiveSystemPrompt` → 已补。5) 真机验证 401 时 UI 无回复 → 补充流错误中文提示与 error 消息渲染，刷新时保留 live 错误。Workspace 使用当前仓库目录。

## [S1] Problem
打开软件后 Agent 主界面已默认展示，但未打开工作区时引导页会挡住输入框，用户无法直接提问。需要「无工作区也能纯聊天」：仅依赖已配置的 LLM Provider；文件类工具仍注册，调用时返回友好错误。

## [S2] Design
### 前端门禁
- `AgentChatB` 仅在 **无 Provider** 时整页引导。
- **无工作区** 时：轻量空状态（可打开工作区），**输入框始终可用**。
- `send()`：无 session 时自动 `createSession()`；无 workspace 时 id/root 为空。
- `MainLayout` → `AgentChatB` 增加 `open-folder`。

### 运行时 / Server
- `workspaceRoot` 无效（空/空白）时一律传 `''`，**禁止 `process.cwd()` 兜底**（含仅有 `workspaceId` 的 getRuntime 兜底路径）。
- `resolveEffectiveSystemPrompt`：空 root 时在 build（createAgent）与 plan（chat/chatStream）路径追加中英 Workspace 说明。
- `createDefaultFS` 对空 root 不因 `undefined` 抛错；实际文件操作由工具闸门拦截。

### 工具契约
`list_dir` / `read_file` / `file_write` / `file_edit` / `bash` / `search_code` / `delegate` 在 `workspaceRoot` 空时返回：
```
Error: 当前未打开工作区，文件工具不可用。请先在左侧打开工作区，或直接用通用知识回答。
```

### 错误与边界
- 无 Provider：整页引导（原行为）。
- 无工作区 + 模型调文件工具：友好 Error；应改用通用知识。
- 无 workspaceId 时不持久化会话到 workspace.json。

### 测试边界
- Agent：空/undefined root 下工具 Error + system prompt 文案（含空白 root）。
- Server：`tsc` 通过；root 解析逻辑以实现为准（无独立 server 单测）。

## [S3] Out of Scope
- 无工作区 + 临时目录 bash
- MCP 无工作区特殊策略
- 已打开工作区时的行为变更

## Tasks
- [x] T1: agent 工具无 workspaceRoot 时返回友好错误 — acceptance: 单测断言 list_dir/read_file/bash/file_write 在空 root 下返回含「未打开工作区」 (covers: S2)
- [x] T2: runtime/server 空 root 与 system prompt — acceptance: 空 root 提示文件工具不可用；server 不 cwd 兜底；plan/build 均生效 (covers: S2; depends: T1)
- [x] T3: 前端无工作区可发送 — acceptance: 仅有 Provider 时输入框可用；空状态可打开工作区 (covers: S2; depends: T2)
- [x] T4: 回归验证 — acceptance: agent 121/121；server tsc OK (covers: S2; depends: T1, T2, T3)
