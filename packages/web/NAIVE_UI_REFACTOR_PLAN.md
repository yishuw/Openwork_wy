# Naive UI 重构方案

> ⚠️ **历史文档**：本方案写于 naive-ui 迁移早期，文中提到的部分组件（如 `AgentPanel.vue`、旧文件树 `FileTree.vue`/`TreeNode.vue`、`SettingsDialog.vue`）已被移除或替换（现为 `AgentChatB.vue`、`NewFileTree`、`SettingsModal`）。仅供了解迁移思路，实际以代码为准。

## 当前状态概述

- 30 个 Vue 组件，全部为纯手写 HTML + scoped CSS，无任何第三方 UI 库
- 3 套主题（dark/light/blue），通过 `data-theme` CSS 自定义属性驱动
- VS Code 式布局：活动栏 + 侧边栏 + 编辑区 + 右侧面板 + 状态栏
- 重构策略：**分阶段渐进式**，文件树用 `n-tree` 替换

---

## Phase 1 — 基础设施搭建

### 1.1 安装依赖

```bash
npm install naive-ui @vicons/ionicons5
```

### 1.2 改造 `App.vue` Provider 层

在 `App.vue` 中用 Naive UI Provider 包裹应用：

```vue
<n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="naiveLocale">
  <n-message-provider>
    <n-dialog-provider>
      <n-notification-provider>
        <n-modal-provider>
          <MainLayout />
        </n-modal-provider>
      </n-notification-provider>
    </n-dialog-provider>
  </n-message-provider>
</n-config-provider>
```

### 1.3 主题映射

根据 `useSettingsStore().theme` 响应式计算 `naiveTheme`：

| 当前主题 | Naive UI 方案 |
|----------|--------------|
| `dark` | `darkTheme`（内置） |
| `light` | `lightTheme`（内置） |
| `blue` | `lightTheme` + `themeOverrides`（主要覆盖 `common.primaryColor` 等） |

### 1.4 验证

- 3 套主题正常切换
- 现有功能不受影响（Provider 层在此阶段仅做包装）

---

## Phase 2 — 基础组件替换

按文件逐个替换，以下是每个组件需要用到的 Naive 组件清单：

| 当前文件 | 主要替换内容 | 用到的 Naive 组件 |
|----------|-------------|-------------------|
| `components/toolbar/Toolbar.vue` | 手写按钮 + 手写 dropdown | `NButton`, `NDropdown` |
| `components/layout/ActivityBar.vue` | 手写按钮 + emoji 图标 | `NButton`, `NIcon` |
| `components/layout/RightToolbar.vue` | 同上 | `NButton`, `NIcon` |
| `components/settings/SettingDropdown.vue` | 手写嵌套 dropdown + Teleport | `NDropdown`（嵌套 children） |
| `components/agent/ModeSelector.vue` | 手写滑动切换 | `NButtonGroup` + `NButton` |
| `components/agent/ProviderSelect.vue` | 手写下拉选择 | `NSelect` |
| `components/agent/SettingsDialog.vue` | 手写 modal + 手写 form | `NModal`, `NForm`, `NFormItem`, `NInput`, `NCheckboxGroup`, `NButton` |
| `components/mcp/McpEditDialog.vue` | 手写 modal + 手写 form + 类型选择 | `NModal`, `NForm`, `NFormItem`, `NInput`, `NSelect`, `NButton` |
| `components/mcp/McpServerItem.vue` | 手写卡片 + badge + 开关 | `NCard`, `NTag`, `NSwitch` |
| `components/mcp/McpToolList.vue` | 手写列表 | `NList`, `NListItem` |
| `components/SaveDialog.vue` | 手写 modal + input | `NModal`, `NInput`, `NButton` |
| `components/layout/AboutDialog.vue` | 手写 modal | `NModal` |
| `components/dialogs/OpenFolderDialog.vue` | 手写 modal + 目录树 | `NModal`, `NTree` |
| `components/dialogs/OpenFileDialog.vue` | 手写 modal + 文件选择 | `NModal`, `NTree` |
| `components/SearchPanel.vue` | 手写搜索输入框 | `NInput`（clearable） |
| `components/StatusBar.vue` | 保持手写，最小改动 | — |

### Phase 2 验收标准

- 所有按钮、输入框、弹窗、下拉菜单已替换为 Naive UI
- 功能行为不变（对话框可打开/关闭，表单可提交，菜单可选择）
- 3 套主题颜色正确

---

## Phase 3 — 布局与复杂组件

### 3.1 主布局 `MainLayout.vue`

手写 flexbox + resize handles → Naive UI 布局组件：

```
<n-layout>
  ├── <n-layout-header>                         → Toolbar (32px)
  └── <n-layout has-sider>
        ├── <n-layout-sider>                    → ActivityBar (48px, collapse-mode="transform")
        ├── <n-split>                           → Sidebar | Editor | RightPanel 之间的可拖拽分割
        │     ├── <n-layout-sider>              → SideBar (260px)
        │     │     ├── <n-tabs>                → Explorer / Search 切换
        │     │     │     ├── FileTree
        │     │     │     └── SearchPanel
        │     ├── <n-layout-content>            → Editor Area
        │     │     ├── <n-tabs>                → 文件 Tab Bar（closable, addable）
        │     │     │     └── Viewer Router     → MonacoEditor / MarkdownViewer / ... 
        │     └── <n-layout-sider>              → Right Panel
        │           ├── <n-tabs>                → AgentPanel / McpSettingsPanel 切换
        ├── <n-layout-sider>                    → RightToolbar (48px)
```

用到的 Naive 组件：

| 组件 | 用途 |
|------|------|
| `NLayout`, `NLayoutHeader`, `NLayoutSider`, `NLayoutContent` | 整体布局框架 |
| `NSplit` | 替代手写 resize handles，实现侧边栏/编辑区/右侧面板拖拽调整宽度 |
| `NTabs` | 替代手写 tab bar（文件 tabs + Agent session tabs + 右侧面板 tabs） |

### 3.2 Agent Session Tabs

`AgentPanel.vue` 中手写 session tab bar → `<n-tabs>`（closable, addable, type="card"）

### 3.3 文件树 (`FileTree.vue` + `TreeNode.vue`) → `<n-tree>`

```vue
<n-tree
  :data="treeData"
  :selected-keys="[activeFile]"
  :render-label="renderLabel"
  :render-prefix="renderPrefix"
  :render-suffix="renderSuffix"
  :node-props="nodeProps"
  draggable
  @update:selected-keys="onSelect"
  @drop="onDrop"
/>
```

插槽说明：

| 插槽 | 内容 |
|------|------|
| `renderLabel` | 文件名显示 + 双击触发 inline rename（`<n-input>`） |
| `renderPrefix` | 文件夹/文件图标（`<n-icon>`） |
| `renderSuffix` | hover 时显示 delete 按钮（`<n-button>`） |
| `nodeProps` | 绑定右击事件，触发 `<n-dropdown>` 右键菜单 |

右键菜单 `useFileTreeContextMenu.ts` → `<n-dropdown>`（trigger="manual" + contextmenu）

### Phase 3 验收标准

- 布局与当前一致（侧边栏展开/收起，面板大小可拖拽调整）
- Tab 切换、关闭、新建正常
- 文件树展开/折叠、选中、双击重命名、右键菜单、拖拽移动正常

---

## Phase 4 — 反馈与细节打磨

| 替换项 | 用到的 Naive 组件 | 涉及文件 / 场景 |
|--------|-------------------|----------------|
| 操作成功/失败提示 | `useMessage()` | `useFileSystem`（保存/删除）, `useAgent`（发送/取消） |
| 全局 loading 状态 | `NSpin` | MainLayout, AgentPanel |
| Agent thinking 进度条 | `NProgress` | AgentPanel（替代手写动画条） |
| hover 文字提示 | `NTooltip` | 各处按钮/tab/操作图标 |
| 空状态占位 | `NEmpty` | AgentPanel（无会话）, McpSettingsPanel（无服务器）, SearchPanel（无结果） |
| 表单验证 | `NForm` rules | SettingsDialog, McpEditDialog |

### Phase 4 验收标准

- 完整的功能测试通过
- 所有操作提供 Naive UI 反馈（message/notification）
- 移除所有不再需要的自定义 scoped CSS

---

## 保持不变的部分

以下组件**不需要** Naive UI 替换：

| 组件 | 原因 |
|------|------|
| `components/editor/MonacoEditor.vue` | Monaco 编辑器封装，Naive 无可替代组件 |
| `components/editor/MarkdownViewer.vue` | 自定义 split-view markdown 渲染 |
| `components/editor/HtmlViewer.vue` | 自定义 split-view HTML iframe 预览 |
| `components/editor/ImageViewer.vue` | 自定义 zoom/pan 图片查看器 |
| `components/editor/PdfViewer.vue` | PDF 专用查看器 |
| `components/editor/DocxViewer.vue` | DOCX 专用查看器 |
| `components/editor/ExcelViewer.vue` | Excel 专用查看器 |
| `components/editor/PptxViewer.vue` | PPTX 专用查看器 |
| `services/editorInstance.ts` | 纯逻辑服务，非 UI 组件 |
| `services/markdown.ts` | markdown-it 渲染，非 UI 组件 |
| `services/editParser.ts` | LLM 输出解析，非 UI 组件 |

---

## 关键参考

### 导入模式（按需引入，tree-shakeable）

```ts
import { NButton, NInput, NModal, NDropdown, NTree, NTabs } from 'naive-ui'
import { darkTheme, lightTheme } from 'naive-ui'
import { Document16Filled, Folder16Filled, Search16Regular } from '@vicons/ionicons5'
```

### 主题 Overrides 示例（blue 主题）

```ts
const blueThemeOverrides = {
  common: {
    primaryColor: '#2080f0',
    primaryColorHover: '#4098fc',
    borderRadius: '4px',
    fontSize: '14px',
  },
  Button: {
    colorPrimary: '#2080f0',
    borderRadiusSmall: '3px',
  },
  Input: {
    borderRadius: '4px',
    borderHover: '#2080f0',
    borderFocus: '#2080f0',
  },
}
```

### 图标替换对照

| 当前 emoji | 含义 | `@vicons/ionicons5` 替代 |
|-----------|------|--------------------------|
| 🗋 | 文件 | `Document16Filled` / `DocumentOutline` |
| 📁 | 文件夹 | `Folder16Filled` / `FolderOpenOutline` |
| 🔍 | 搜索 | `SearchOutline` |
| 🤖 | AI 助手 | `ChatbubblesOutline` |
| 🔌 | MCP 插件 | `HardwareChipOutline` |
| ⚙ | 设置 | `SettingsOutline` |
| × | 关闭 | `CloseOutline` |
| ＋ | 新增 | `AddOutline` |
| ▶ | 展开 | `ChevronForwardOutline` |
| ▼ | 折叠 | `ChevronDownOutline` |

---

## 协作注意事项

1. **每次只改一个 Phase**，改完验证后再继续下一个
2. 每个文件重构后执行 `npm run typecheck` 确保类型无误
3. 每个 Phase 完成后在本地启动 `npm run dev:all` 做视觉回归测试
4. 提交时按 Phase 拆分 commit，方便回溯
5. 移除旧 scoped CSS 时先确认对应组件已无引用
