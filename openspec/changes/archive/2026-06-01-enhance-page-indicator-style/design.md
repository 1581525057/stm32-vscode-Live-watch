## Context

VS Code TreeView 的样式限制：
- 无法使用自定义 CSS
- 无法使用 CSS 渐变、阴影等效果
- 只能通过 ThemeIcon 和基本 TreeItem 属性设置样式

用户期望的效果是"渐变高亮"风格，需要在限制下实现最接近的效果。

## Goals / Non-Goals

**Goals:**
- 让页面指示器尽可能醒目
- 保持与 VS Code 原生风格一致
- 提供清晰的视觉层次

**Non-Goals:**
- 不修改 TreeView 的基础结构
- 不使用外部 CSS 或 JavaScript

## Decisions

### 1. 使用彩色 ThemeIcon

**决策**: 使用 `layers` 图标并设置 `charts.foreground` 主题色

**理由**:
- ThemeIcon 支持 color 属性
- `charts.foreground` 是 VS Code 内置的图表前景色，通常是醒目的颜色
- 保持与 VS Code 主题的一致性

### 2. 使用 Unicode 装饰字符

**决策**: 在 label 中使用 `━━━` 分隔线装饰

**理由**:
- Unicode 字符在所有平台上都能显示
- 分隔线可以增强视觉层次感
- 不依赖 CSS 样式

### 3. 优化 description 格式

**决策**: 显示 "Page X/Y • N vars" 格式

**理由**:
- 简洁明了
- 提供关键信息
- 使用 • 分隔符增强可读性

### 4. 使用 tooltip 提供详细信息

**决策**: tooltip 显示完整的页面信息

**理由**:
- tooltip 支持 Markdown 格式
- 可以显示更详细的信息
- 不占用主界面空间

## Risks / Trade-offs

### 风险1: Unicode 字符可能在某些字体下显示异常

**缓解措施**: 使用常见的 Unicode 字符，避免使用罕见字符

### 风险2: 主题色可能在某些主题下不够醒目

**缓解措施**: 使用 VS Code 内置的主题变量，确保在大多数主题下都能正常显示
