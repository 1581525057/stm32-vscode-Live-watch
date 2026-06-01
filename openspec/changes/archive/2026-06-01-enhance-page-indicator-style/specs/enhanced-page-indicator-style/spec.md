## ADDED Requirements

### Requirement: 页面指示器使用醒目的样式
系统 SHALL 使用彩色图标、装饰字符和清晰的信息展示来增强页面指示器的视觉效果。

#### Scenario: 单页面模式
- **WHEN** 用户只有一个 Watch 页面
- **THEN** 不显示页面指示器（与当前行为一致）

#### Scenario: 多页面模式
- **WHEN** 用户有多个 Watch 页面
- **THEN** 显示页面指示器，包含：
  - 使用 `layers` 图标并设置 `charts.foreground` 主题色
  - label 显示 `━━━ 页面名称 ━━━` 格式，带装饰字符
  - description 显示 `Page X/Y • N vars` 格式
  - tooltip 显示详细的 Markdown 格式信息

#### Scenario: 视觉效果
- **WHEN** 用户查看页面指示器
- **THEN** 指示器应明显区别于普通变量项：
  - 图标使用主题色（通常是醒目的颜色）
  - label 使用装饰字符增强视觉效果
  - description 提供清晰的页面信息
  - 整体视觉层次清晰

#### Scenario: 页面切换
- **WHEN** 用户切换到不同的 Watch 页面
- **THEN** 页面指示器更新为新页面的名称和位置

#### Scenario: 变量数量显示
- **WHEN** 用户查看页面指示器
- **THEN** description 显示当前页面监视的变量数量
