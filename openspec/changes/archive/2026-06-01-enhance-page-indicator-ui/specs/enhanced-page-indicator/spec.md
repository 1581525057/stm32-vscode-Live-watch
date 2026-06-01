## ADDED Requirements

### Requirement: 页面指示器使用显眼样式
系统 SHALL 使用更具辨识度的图标和清晰的标签显示当前页面信息。

#### Scenario: 单页面模式
- **WHEN** 用户只有一个 Watch 页面
- **THEN** 不显示页面指示器（与当前行为一致）

#### Scenario: 多页面模式
- **WHEN** 用户有多个 Watch 页面
- **THEN** 显示页面指示器，包含：
  - 使用 `layers` 图标（暗示多页面层叠）
  - label 显示当前页面名称
  - description 显示 "Page X of Y" 格式
  - tooltip 显示详细信息

#### Scenario: 页面切换
- **WHEN** 用户切换到不同的 Watch 页面
- **THEN** 页面指示器更新为新页面的名称和位置

#### Scenario: 视觉效果
- **WHEN** 用户查看页面指示器
- **THEN** 指示器应明显区别于普通变量项：
  - 图标颜色使用 `charts.foreground` 主题色
  - 字体使用 VS Code 默认的 TreeItem 样式
  - 整体视觉层次清晰
