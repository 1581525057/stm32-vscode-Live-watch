<!-- hyperspec change: chart-ui-improvements -->

# 实现计划：chart-ui-improvements

## 项目信息

- **变更名**: chart-ui-improvements
- **技术栈**: typescript + vscode-extension + chart.js
- **构建工具**: npm
- **编译命令**: npm run compile

## File Structure

- `resources/chart.html` - 图表 Webview HTML（CSS 样式、下拉菜单选项）
- `resources/chart.js` - 图表 Webview JavaScript（调色板、默认值）
- `src/variableTreeDataProvider.ts` - 变量树数据提供者（子变量删除逻辑）
- `src/chartManager.ts` - 图表管理器（调色板一致性）

## 实现步骤

## 1. 页面切换 tab 样式优化

- [x] **Step 1.1: 修改 page-tab 默认样式（Task 1.1）**
  - 修改 `resources/chart.html` 中 `.page-tab` 的 CSS
  - 将 `color` 从 `var(--vscode-descriptionForeground, #999)` 改为 `var(--vscode-foreground, #cccccc)`
  - 将 `font-weight` 改为 `500`
  - 添加 `transition: all 0.15s ease`

- [x] **Step 1.2: 修改 page-tab 悬停样式（Task 1.2）**
  - 修改 `.page-tab:hover` 样式
  - 将 `color` 改为 `var(--vscode-foreground, #ffffff)`
  - 将 `background` 改为 `var(--vscode-list-hoverBackground, rgba(255,255,255,0.08))`

- [x] **Step 1.3: 修改 page-tab 活动样式（Task 1.3）**
  - 修改 `.page-tab.active` 样式
  - 将 `color` 改为 `var(--vscode-foreground, #ffffff)`
  - 将 `font-weight` 改为 `600`
  - 添加 `background: var(--vscode-list-activeSelectionBackground, rgba(0,122,204,0.15))`

- [x] **Step 1.4: 修改添加按钮样式（Task 1.4）**
  - 修改 `.page-tab-add` 样式
  - 将 `color` 改为 `var(--vscode-foreground, #cccccc)`
  - 修改 `.page-tab-add:hover` 将 `color` 改为 `var(--vscode-foreground, #ffffff)`

## 2. 子变量删除支持

- [x] **Step 2.1: 添加 findParentPath 方法（Task 2.1）**
  - 在 `src/variableTreeDataProvider.ts` 中添加 `findParentPath` 方法
  - 通过路径前缀匹配找到父变量路径
  - 支持 `parentPath.member` 和 `parentPath[index]` 格式

- [x] **Step 2.2: 修改 deleteVariable 方法（Task 2.2）**
  - 修改 `deleteVariable` 方法，允许删除子变量
  - 调用 `findParentPath` 找到父变量
  - 从 `childrenCache` 和 `allVariables` 中移除子变量
  - 显示删除成功消息

## 3. 图表时间窗口扩展

- [x] **Step 3.1: 添加 120s 时间窗口选项（Task 3.1）**
  - 修改 `resources/chart.html` 中 `#selWindow` 下拉菜单
  - 添加 `<option value="120">120s</option>` 选项

## 4. 图表高频刷新支持

- [x] **Step 4.1: 添加 20ms 刷新频率选项（Task 4.1）**
  - 修改 `resources/chart.html` 中 `#selInterval` 下拉菜单
  - 添加 `<option value="20" selected>20ms</option>` 选项并设为默认

- [x] **Step 4.2: 修改默认刷新频率（Task 4.2）**
  - 修改 `resources/chart.js` 中 `collectInterval` 默认值为 `20`

## 5. 调色板优化

- [x] **Step 5.1: 修改 chart.js 调色板（Task 5.1）**
  - 修改 `resources/chart.js` 中 `COLORS` 数组
  - 使用高对比度调色板：`['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#f97316', '#8b5cf6', '#ec4899', '#14b8a6']`

- [x] **Step 5.2: 修改 chartManager.ts 调色板（Task 5.2）**
  - 修改 `src/chartManager.ts` 中 `CHART_COLORS` 数组
  - 保持与 `chart.js` 一致

## 6. 验证

- [x] **Step 6.1: 编译验证（Task 6.1）**
  - 运行 `npm run compile` 验证编译通过

- [ ] **Step 6.2: 功能验证（Task 6.2-6.6）**
  - 测试页面切换 tab 样式是否符合预期
  - 测试子变量删除功能是否正常
  - 测试 120s 时间窗口是否正常工作
  - 测试 20ms 刷新频率是否正常工作
  - 测试新调色板是否显示正确
