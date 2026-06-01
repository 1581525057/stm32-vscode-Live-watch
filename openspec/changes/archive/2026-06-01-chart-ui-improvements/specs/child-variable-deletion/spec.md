## ADDED Requirements

### Requirement: 用户可以直接删除子变量
系统 SHALL 允许用户直接删除子变量，无需先删除父变量。

#### Scenario: 删除结构体成员
- **WHEN** 用户右键点击结构体成员（如 `motor.pid.kp`）并选择删除
- **THEN** 系统从缓存中移除该子变量，下次刷新时不再显示

#### Scenario: 删除数组元素
- **WHEN** 用户右键点击数组元素（如 `sensor.data[0]`）并选择删除
- **THEN** 系统从缓存中移除该子变量，下次刷新时不再显示

#### Scenario: 父变量保持不变
- **WHEN** 用户删除子变量
- **THEN** 父变量及其其他子变量保持不变，仍正常显示
