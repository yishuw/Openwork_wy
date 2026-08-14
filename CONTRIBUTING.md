# CONTRIBUTING

> 中文 | [English](#english)

## 开发命令

| 命令 | 说明 |
|------|------|
| `npm run typecheck` | **唯一可靠的静态检查**（`tsc -b`），提交前必须通过 |
| `npm test` | agent 包 vitest 单测（`packages/agent/test/`），提交前必须通过 |
| `npm run cli` | 交互式 Agent CLI，无需构建；需 `--key sk-...` 或 `LLM_API_KEY` |
| `npm run dev:server` / `dev:web` / `dev:electron` / `dev:all` | 各端开发模式（自动先构建 agent） |
| `npm run lint` | **已坏，勿运行**：仓库无 ESLint 配置，执行必然失败 |

### 注意

- **先构建 agent 再开发其他包**：`server` / `web` / `electron` 通过 `@openwork/agent` 的 `dist/` 消费它（workspace 依赖 `*`）。直接 `npm run dev -w packages/web` 前，`packages/agent` 的 `predev` 钩子会自动先构建；改了 agent 代码但没重新构建，跑的是旧代码。
- **`npm run typecheck -w packages/web`（vue-tsc）已知失败**：仓库存在一批预先存在的类型错误（SaveDialog / SearchPanel / AgentChatB / NewFileTree / McpSettings 等）。判定标准以根 `npm run typecheck` 为准；修改 web 代码时**不要引入新的错误**（可用 `git stash` 前后对比 error 集合）。
- 无测试框架之外的测试基建：**没有 CI**。提交质量靠 typecheck + test + 人工 review 把关。
- 运行时数据 `.openwork/workspace.json`、用户配置 `config/`（可能含 API Key）均不入库。

## 分支与提交流程

### 分支命名

```
<type>/<描述>_<日期>_<作者缩写>
# 例：feature/security_hardening_20260803_zjh
#     bugfix/拖拽粘鼠标修复_0531_sf
```

- `<type>`：`feature` / `bugfix` / `refactor` / `release` / `docs` / `chore`
- `<日期>`：`YYYYMMDD`
- 从 `master` 切出，合并回 `master`。

### Commit 规范

- 推荐 Conventional Commits 前缀：`feat:` `fix:` `refactor:` `docs:` `test:` `chore:`（历史 commit 混用中文描述，不强求迁移）。
- 描述用中文或英文均可，一行内写清楚"做了什么、为什么"；复杂改动在正文列出要点。
- 一次 commit 只做一件事；代码 + 对应文档/测试同 commit。

### PR 流程

1. 从 `master` 切分支 → 实现 → 本地验证（`npm run typecheck` + `npm test`）→ 提交。
2. 推送分支，开 PR 到 `master`，模板见 `.github/PULL_REQUEST_TEMPLATE.md`。
3. 至少 1 人 review 通过后合并；合并后删除分支。
4. 涉及跨包改动（agent API 变更）时，在 PR 描述中列出影响面与验证方式。

### 分支保护（仓库设置，需管理员操作）

在 GitHub Settings → Branches → `master` 上开启：

- [ ] Require a pull request before merging（至少 1 个 review）
- [ ] Require status checks 通过（等 CI 接入后绑定；当前无 CI，先靠 review）
- [ ] Require conversation resolution
- [ ] Do not allow bypassing the above settings

## 安全约定

- **不要向代码提交 API Key / token**。配置从 `config/`（gitignored）或环境变量注入（`LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL`）。
- 服务端 `AUTH_TOKEN` 环境变量：设置了即对 `/api/*` 开启 Bearer 校验（本地不设置则放行）。远程部署必须设置。
- `OPENWORK_ENABLE_BASH`：远程部署建议 `0`/`false` 关闭 agent 的 bash 工具（默认开启，仅限本地可信环境）。
- 改动 `packages/server/src/routes/files.ts` 时保持 `resolve → startsWith` 路径穿越防护逻辑。

## 风格约定

- 文本保持中英双语：`packages/web/src/locales/zh.ts` / `en.ts`（vue-i18n）。
- **产品定位统一口径**：OpenWork 是「通用 AI 办公辅助工作台」（多格式文档查看 + AI 助手），不是纯代码编辑器。文档与 UI 文案中避免使用「AI 辅助代码编辑器」这类收窄定位的表述；代码查看只是 8 种查看模式之一。
- web 前端：新组件使用 naive-ui + `useNaiveTheme`；naive-ui 迁移进度见 `packages/web/NAIVE_UI_REFACTOR_PLAN.md`（历史文档，部分内容已被取代）。
- 不添加与代码无关的注释；改动遵循所在文件既有风格。

## 测试

- `packages/agent/test/`（vitest）：新增/修改 agent 逻辑（尤其 SessionMemory、MCP 配置、工具注册）时补充用例。
- 尚未换框架前，不要为即将被替换的模块（`parseToolCalls`、工具循环、`agent.ts`/`session.ts`）投入大量测试。

---

## English

### Commands

| Command | Notes |
|---------|-------|
| `npm run typecheck` | The only reliable static check (`tsc -b`); must pass before committing |
| `npm test` | vitest suite in `packages/agent/test/`; must pass before committing |
| `npm run cli` | Interactive agent CLI, no build needed; requires `--key` or `LLM_API_KEY` |
| `npm run dev:server` / `dev:web` / `dev:electron` / `dev:all` | Dev modes (auto-build agent first) |
| `npm run lint` | **Broken by design** — no ESLint config in this repo; do not run |

Notes:

- Build `@openwork/agent` before working on other packages — server/web/electron consume it via its `dist/`. The `predev` hooks handle this; a stale `dist` silently runs stale code.
- `npm run typecheck -w packages/web` (vue-tsc) **is known to fail** with pre-existing errors. The root `npm run typecheck` is the gate; do not add *new* errors (compare error sets with `git stash` if unsure).
- No CI exists yet; quality is enforced by typecheck + tests + review.

### Branching & PR

- Branch: `<type>/<description>_<YYYYMMDD>_<initials>` (type: feature/bugfix/refactor/release/docs/chore), cut from and merged back to `master`.
- Commits: Conventional Commits prefixes (`feat:` `fix:` `refactor:` `docs:` `test:` `chore:`); one thing per commit; keep code + docs/tests together.
- PR: at least 1 review required before merging; delete branch after merge.
- Enable branch protection on `master` (admin action, GitHub Settings): require PR + 1 review + conversation resolution.

### Security

- Never commit API keys; config comes from gitignored `config/` or env vars.
- Set `AUTH_TOKEN` on remote deployments (enables Bearer check on `/api/*`; unset = open).
- Set `OPENWORK_ENABLE_BASH=0` on remote deployments (disables the agent's bash tool).
- Preserve the `resolve → startsWith` traversal guard when touching `routes/files.ts`.
