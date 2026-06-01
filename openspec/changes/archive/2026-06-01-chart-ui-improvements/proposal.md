## Why

当前 STM32 Live Watch 图表界面存在以下用户体验问题：
1. 页面切换 tab 字体颜色使用 `#999`，在深色主题下不够显眼，用户难以快速识别当前活动页面
2. 子变量无法直接删除，必须先删除父变量，操作繁琐
3. 图表时间窗口最大仅支持 60s，无法满足长时间观察需求（如 2 分钟趋势分析）
4. 图表刷新频率最低仅 100ms（10Hz），无法满足高频采样需求（如 50Hz 实时监控）

## What Changes

- **页面切换 tab 样式优化**：使用更高对比度的颜色（`#cccccc` → `#ffffff`）、增加字重（`500` → `600`）、添加背景色高亮活动状态
- **子变量删除支持**：新增 `findParentPath` 方法，允许直接删除子变量而无需先删除父变量
- **图表时间窗口扩展**：添加 120s（2 分钟）选项，满足长时间观察需求
- **图表刷新频率扩展**：添加 20ms（50Hz）选项并设为默认，满足高频采样需求
- **调色板优化**：使用更高对比度的颜色方案（从 Catppuccin 柔和色系改为高饱和度色系）

## Capabilities

### New Capabilities
- `child-variable-deletion`: 支持直接删除子变量，无需先删除父变量
- `extended-time-window`: 图表时间窗口支持 120s（2 分钟）
- `high-frequency-refresh`: 图表刷新频率支持 20ms（50Hz）

### Modified Capabilities
- `chart-ui-styling`: 页面切换 tab 样式优化，使用更显眼的颜色和字重
- `color-palette`: 调色板从柔和色系改为高对比度色系

## Impact

- **前端文件**：`resources/chart.html`（CSS 样式）、`resources/chart.js`（调色板和默认值）
- **后端文件**：`src/variableTreeDataProvider.ts`（子变量删除逻辑）、`src/chartManager.ts`（调色板一致性）
- **用户体验**：页面切换更易识别、变量管理更灵活、图表观察能力增强
- **性能**：50Hz 刷新频率可能增加 CPU 使用率，但已在代码中优化（批量更新、增量 Y 轴计算）
