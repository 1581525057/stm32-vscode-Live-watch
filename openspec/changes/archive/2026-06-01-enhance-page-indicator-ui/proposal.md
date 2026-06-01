## Why

当前 "LIVE WATCH 实时变量" 面板中的页面指示器（如 "watch1 (2/2)"）UI 表现太弱：
- 字体小、颜色偏灰
- 没有明显背景、边框或标题样式
- 看起来像普通变量列表中的一行
- 用户容易忽略当前正在查看的页面名称

## What Changes

- **改进页面指示器样式** - 使用更显眼的图标、加粗描述、高对比度颜色
- **添加分隔线效果** - 通过 description 和 tooltip 提供更多信息
- **优化图标选择** - 使用更具辨识度的图标

## Capabilities

### New Capabilities
- `enhanced-page-indicator`: 页面指示器使用更显眼的样式

## Impact

- `src/variableTreeDataProvider.ts` - 修改 pageInfo 的创建逻辑
