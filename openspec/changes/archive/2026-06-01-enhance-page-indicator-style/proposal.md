## Why

用户反馈当前页面指示器 UI 太丑，希望使用更醒目的样式。用户选择了"方案4：渐变高亮"风格，但 VS Code TreeView 无法直接使用 CSS 渐变。

需要在 VS Code TreeView 的限制下实现最接近的效果：
1. 使用更醒目的图标（带颜色的 ThemeIcon）
2. 使用 Unicode 装饰字符增强视觉效果
3. 使用 description 显示更多信息
4. 保持与 VS Code 原生风格一致

## What Changes

- **增强页面指示器视觉效果** - 使用更醒目的图标、装饰字符、高对比度颜色
- **优化信息展示** - description 显示 "Page X/Y • N variables" 格式
- **使用主题色** - 利用 VS Code 主题变量保持一致性

## Capabilities

### New Capabilities
- `enhanced-page-indicator-style`: 页面指示器使用更醒目的样式

## Impact

- `src/variableTreeDataProvider.ts` - 修改页面指示器的创建逻辑
