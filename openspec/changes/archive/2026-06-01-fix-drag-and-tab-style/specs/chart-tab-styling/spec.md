## MODIFIED Requirements

### Requirement: 页面切换tab使用显眼的固定样式
系统 SHALL 使用固定颜色和明显的视觉效果，确保页面切换tab在所有主题下都可见。

#### Scenario: 默认状态
- **WHEN** 用户查看页面切换tab
- **THEN** 非活动tab使用深灰色背景（#3c3c3c）和白色文字（#ffffff），带有圆角和内边距

#### Scenario: 悬停状态
- **WHEN** 用户将鼠标悬停在tab上
- **THEN** tab背景色变浅（#505050），文字变为亮白色

#### Scenario: 活动状态
- **WHEN** tab处于活动状态
- **THEN** tab使用蓝色背景（#007acc）和白色文字（#ffffff），带有底部高亮条

#### Scenario: 添加按钮样式
- **WHEN** 用户查看添加页面按钮
- **THEN** 按钮使用与tab一致的样式，带有"+"图标
