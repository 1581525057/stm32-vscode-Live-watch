## Context

VS Code TreeView 的样式能力有限，无法直接使用 CSS。但可以通过以下方式增强视觉效果：
1. 使用更具辨识度的图标
2. 在 label 中添加装饰性字符（如 ━━━ 分隔线）
3. 使用 description 显示额外信息
4. 设置 tooltip 提供详细说明
5. 使用 ThemeIcon 的 id 和 color 属性

## Goals / Non-Goals

**Goals:**
- 让页面指示器更显眼
- 用户一眼能看出当前页面名称
- 保持与 VS Code 原生风格一致

**Non-Goals:**
- 不修改 TreeView 的基础结构
- 不添加自定义 CSS（VS Code TreeView 不支持）

## Decisions

### 1. 使用更具辨识度的图标

**决策**: 使用 `layers` 或 `symbol-folder` 图标替代 `list-flat`

**理由**: 
- `layers` 图标有堆叠感，暗示多页面
- `symbol-folder` 图标有文件夹感，暗示分组
- 选择 `layers` 更符合"页面层叠"的概念

### 2. 在 label 中添加装饰

**决策**: 使用 Unicode 字符添加视觉分隔

**理由**:
- 使用 `━━━` 或 `───` 作为分隔线
- 或者使用 `📄` 等表情符号
- 保持简洁，不过度装饰

### 3. 使用 description 显示页面信息

**决策**: 将页面计数移到 description

**理由**:
- label 保持简洁（仅页面名称）
- description 显示 "Page 1 of 2" 更清晰
- 符合 VS Code TreeView 的最佳实践

## Risks / Trade-offs

### 风险1: 装饰性字符可能在某些字体下显示异常

**缓解措施**: 使用通用 Unicode 字符，避免使用罕见字符

### 风险2: 过度装饰可能影响简洁性

**缓解措施**: 保持适度装饰，不过度设计
