## MODIFIED Requirements

### Requirement: 页面切换 tab 样式优化
系统 SHALL 使用高对比度颜色和字重，使页面切换 tab 更易识别。

#### Scenario: 默认状态
- **WHEN** 用户查看页面切换 tab
- **THEN** 非活动 tab 使用 `var(--vscode-foreground, #cccccc)` 颜色，字重为 `500`

#### Scenario: 悬停状态
- **WHEN** 用户将鼠标悬停在 tab 上
- **THEN** tab 颜色变为 `var(--vscode-foreground, #ffffff)`，背景色变为 `var(--vscode-list-hoverBackground, rgba(255,255,255,0.08))`

#### Scenario: 活动状态
- **WHEN** tab 处于活动状态
- **THEN** tab 颜色为 `var(--vscode-foreground, #ffffff)`，字重为 `600`，底部边框颜色为 `var(--vscode-focusBorder, #007acc)`，背景色为 `var(--vscode-list-activeSelectionBackground, rgba(0,122,204,0.15))`

#### Scenario: 添加按钮样式
- **WHEN** 用户查看添加页面按钮
- **THEN** 按钮使用 `var(--vscode-foreground, #cccccc)` 颜色，悬停时变为 `var(--vscode-foreground, #ffffff)`
