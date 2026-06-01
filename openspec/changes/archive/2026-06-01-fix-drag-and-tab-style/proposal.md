## Why

当前存在两个用户体验问题：
1. **结构体/类/数组无法拖出** - 代码中明确禁止了 `hasChildren` 的变量被提取为根变量，导致用户无法将结构体、类或数组从父变量中拖出来单独监视
2. **页面切换tab颜色不显眼** - 虽然之前修改了CSS使用 `var(--vscode-foreground)` 变量，但在某些VS Code主题下该变量可能解析为白色或浅色，导致tab不可见

## What Changes

- **移除拖拽限制** - 允许将结构体、类、数组等容器类型拖出作为独立的根变量
- **页面切换tab样式改进** - 使用更显眼的UI设计，不依赖CSS变量，使用固定颜色和更明显的视觉效果

## Capabilities

### New Capabilities
- `unrestricted-variable-drag`: 允许拖出任何类型的变量（包括结构体、类、数组）

### Modified Capabilities
- `chart-tab-styling`: 使用更显眼的固定颜色和视觉效果

## Impact

- `src/variableTreeDataProvider.ts` - 移除拖拽限制
- `resources/chart.html` - 改进页面切换tab样式
