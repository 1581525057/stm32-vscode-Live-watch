<!-- hyperspec change: enhance-page-indicator-style -->

# 实现计划：enhance-page-indicator-style

## 项目信息

- **变更名**: enhance-page-indicator-style
- **技术栈**: typescript + vscode-extension
- **构建工具**: npm
- **编译命令**: npm run compile

## File Structure

- `src/variableTreeDataProvider.ts` - 变量树数据提供者（页面指示器）

## 实现步骤

## 1. 增强页面指示器样式

- [x] **Step 1.1: 修改 pageInfo 创建逻辑（Task 1.1）**
  - 修改 `getChildren` 方法中的 pageInfo 创建
  - 使用 `layers` 图标并设置 `charts.foreground` 主题色

- [x] **Step 1.2: 修改 label 格式（Task 1.2）**
  - label 显示 `━━━ 页面名称 ━━━` 格式

- [x] **Step 1.3: 修改 description 格式（Task 1.3）**
  - description 显示 `Page X/Y • N vars` 格式

- [x] **Step 1.4: 设置 tooltip（Task 1.4）**
  - tooltip 显示详细的 Markdown 格式信息

## 2. 验证

- [x] **Step 2.1: 编译验证（Task 2.1）**
  - 运行 `npm run compile` 验证编译通过

- [ ] **Step 2.2: 功能验证（Task 2.2）**
  - 测试页面指示器显示效果
