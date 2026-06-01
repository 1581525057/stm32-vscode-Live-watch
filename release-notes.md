# v4.0.3 - 增强 Watch 页面指示器样式

## 更新内容

### 增强 Watch 页面指示器样式

- **使用装饰分隔线**：label 使用 ━━━ 分隔线装饰，增强视觉层次
- **优化 description 格式**：显示 "Page X/Y • N vars" 格式，更简洁
- **使用 Markdown tooltip**：tooltip 使用 Markdown 格式，显示更详细的信息
- **使用主题色**：图标使用 charts.foreground 主题色，保持与 VS Code 一致性

### 之前的版本更新

#### v4.0.2 - Watch 页面指示器样式优化

- 使用 layers 图标替代 list-flat，更具辨识度
- 添加 📄 表情符号到 label，增加视觉效果
- description 显示 "Page X of Y" 格式，更清晰
- tooltip 显示详细信息，包含页面名称和变量数量

#### v4.0.1 - 拖拽限制修复与页面切换 tab 样式改进

- 移除结构体/类/数组拖拽限制，允许拖出任何类型变量
- 页面切换 tab 使用固定颜色（#3c3c3c/#007acc），确保在所有主题下可见

#### v4.0.0 - 图表界面改进与用户体验优化

- 页面切换 tab 样式优化，使用高对比度颜色和字重
- 支持直接删除子变量，无需先删除父变量
- 添加 120s（2 分钟）时间窗口选项
- 添加 20ms（50Hz）刷新频率选项
- 使用高对比度调色板

## 安装方式

1. 下载 `stm32-vscode-Live-watch-4.0.3.vsix` 文件
2. 在 VS Code 中打开扩展面板
3. 点击 "..." 菜单，选择 "Install from VSIX..."
4. 选择下载的 .vsix 文件

## 系统要求

- VS Code 1.85.0 或更高版本
- Node.js 16 或更高版本
