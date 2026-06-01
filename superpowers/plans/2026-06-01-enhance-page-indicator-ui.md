<!-- hyperspec change: enhance-page-indicator-ui -->

# 实现计划：enhance-page-indicator-ui

## 项目信息

- **变更名**: enhance-page-indicator-ui
- **技术栈**: typescript + vscode-extension
- **构建工具**: npm
- **编译命令**: npm run compile

## File Structure

- `src/variableTreeDataProvider.ts` - 变量树数据提供者（页面指示器）

## 实现步骤

## 1. 改进页面指示器

- [x] **Step 1.1: 修改 pageInfo 创建逻辑（Task 1.1）**
  - 修改 `getChildren` 方法中的 pageInfo 创建
  - 使用 `layers` 图标替代 `list-flat`
  - 添加表情符号 `📄` 到 label

- [x] **Step 1.2: 设置 description（Task 1.2）**
  - description 显示 "Page X of Y" 格式

- [x] **Step 1.3: 设置 tooltip（Task 1.3）**
  - tooltip 显示详细信息

- [x] **Step 1.4: 设置图标颜色（Task 1.4）**
  - 使用 ThemeIcon 的 color 属性设置图标颜色为 `charts.foreground`

## 2. 验证

- [x] **Step 2.1: 编译验证（Task 2.1）**
  - 运行 `npm run compile` 验证编译通过

- [ ] **Step 2.2: 功能验证（Task 2.2）**
  - 测试页面指示器显示效果
