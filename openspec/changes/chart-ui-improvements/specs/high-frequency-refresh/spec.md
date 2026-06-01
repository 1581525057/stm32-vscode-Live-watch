## ADDED Requirements

### Requirement: 图表支持 50Hz 高频刷新
系统 SHALL 提供 20 毫秒（50Hz）的刷新频率选项，满足高频采样需求。

#### Scenario: 选择 20ms 刷新频率
- **WHEN** 用户在刷新频率下拉菜单中选择 "20ms"
- **THEN** 图表以 50Hz 频率更新数据，每 20 毫秒采集一次变量值

#### Scenario: 默认刷新频率
- **WHEN** 用户首次打开图表面板
- **THEN** 刷新频率默认设置为 20ms（50Hz）

#### Scenario: 性能优化
- **WHEN** 刷新频率设置为 20ms
- **THEN** 系统使用批量更新、增量 Y 轴计算等优化措施，保持流畅性能

#### Scenario: 用户可切换频率
- **WHEN** 用户从下拉菜单选择其他频率（50ms、100ms、250ms）
- **THEN** 图表立即切换到新的刷新频率
