# Changelog

本项目变更记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本化遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 文档全面更新：产品定位从「AI 辅助代码编辑器」修正为「通用 AI 办公辅助工作台」（多格式文档查看 + AI 助手），README 系列（根 / agent / server / web / electron，中英双语）、`docs/architecture.drawio` 与各包 `package.json` 描述同步更新
- 文档事实修正：认证中间件已挂载（`AUTH_TOKEN`）、LLM 调用基于 `openai` SDK、`/api/agent` 为 2 个端点、工作区级内容搜索已实现、agent 包 vitest 单测已存在、`ChatResult`/`AgentResult` 取代过时的 `AgentEditResult`、Electron 协议为 `openwork://` 等

### Changed

- 安全加固：`AUTH_TOKEN` 中间件挂载到 `/api/*`（设置环境变量后启用 Bearer 校验，本地未设置则放行；`packages/server/src/index.ts`）
- agent bash 工具开关：`OPENWORK_ENABLE_BASH=0` 时不再注册 `bash` 工具（远程部署建议关闭；`AgentConfig.enableBash`）
- 单测基建：vitest（`packages/agent/test/`，16 个用例：SessionMemory / createDefaultTools / maskApiKey），`npm test`
- 协作基建：CONTRIBUTING.md、Issue/PR 模板（`.github/`）、CHANGELOG.md
- workspace 依赖协议：server/web/electron 的 `@openwork/agent` 改为 `*` + `predev`/`prebuild` 自动构建；electron 补声明缺失的 `@openwork/agent` 依赖
- Electron 打包：win/linux 目标拆分（`pack:electron:win/linux`、`dist:electron:win/linux`）、Linux AppImage/deb 目标、图标资源

### Changed

- 移除已取代的双轨 UI 组件：旧文件树（`file-tree/`）与旧 Agent 面板（`AgentPanel` 及其子组件、`SettingsDialog`）；`NewFileTree` 与 `AgentChatB` 成为唯一路径
- `@imengyu/vue3-context-menu` 依赖移除（文件树菜单内建于 NewFileTree）
- 文档与现状对齐：README 系列（7 个默认工具、`parseToolCalls`、编辑工具链路、删除不存在的 `/api/agent/apply-edits` 文档等）

### Fixed

- web 类型错误零新增（验证：与 master 对比 error 集合一致或减少；预先存在的 vue-tsc 错误未在本次处理）

### Removed

- 服务端 `apply-edits` 相关文档（端点已不存在，编辑由 agent 内建工具完成）
