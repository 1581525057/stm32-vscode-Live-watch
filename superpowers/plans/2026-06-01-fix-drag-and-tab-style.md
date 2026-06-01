<!-- hyperspec change: fix-drag-and-tab-style -->

# 实现计划：fix-drag-and-tab-style

## 项目信息

- **变更名**: fix-drag-and-tab-style
- **技术栈**: typescript + vscode-extension + chart.js
- **构建工具**: npm
- **编译命令**: npm run compile

## File Structure

- `src/variableTreeDataProvider.ts` - 变量树数据提供者（拖拽逻辑）
- `resources/chart.html` - 图表 Webview HTML（页面切换tab样式）

## 实现步骤

## 1. 移除拖拽限制

- [x] **Step 1.1: 删除 hasChildren 检查（Task 1.1）**
  - 删除 `handleDrop` 方法中的 `hasChildren` 检查
  - 允许拖出任何类型的变量

## 2. 改进页面切换tab样式

- [x] **Step 2.1: 修改 page-tab 默认样式（Task 2.1）**
  - 使用固定颜色：背景 #3c3c3c，文字 #ffffff
  - 添加圆角和边框

- [x] **Step 2.2: 修改 page-tab 悬停样式（Task 2.2）**
  - 背景 #505050，文字 #ffffff

- [x] **Step 2.3: 修改 page-tab 活动样式（Task 2.3）**
  - 背景 #007acc，文字 #ffffff

- [x] **Step 2.4: 修改添加按钮样式（Task 2.4）**
  - 与tab保持一致的样式

## 3. 验证

- [x] **Step 3.1: 编译验证（Task 3.1）**
  - 运行 `npm run compile` 验证编译通过

- [ ] **Step 3.2: 功能验证（Task 3.2-3.5）**
  - 测试拖出结构体功能
  - 测试拖出类功能
  - 测试拖出数组功能
  - 测试页面切换tab样式是否可见
