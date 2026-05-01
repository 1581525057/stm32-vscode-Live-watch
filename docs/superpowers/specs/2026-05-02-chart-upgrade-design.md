# 图表系统升级设计文档

日期：2026-05-02
版本：3.0.0 → 3.1.0
范围：图表系统功能补齐

## 背景

当前图表系统（3.0.0）存在以下局限：

1. 所有变量共享单 Y 轴，不同量程的变量无法同时有效显示
2. 硬编码 Catppuccin 暗色调色板，亮色主题下对比度差
3. 无数据导出功能，无法将数据拿到 MATLAB/Excel 后处理
4. 无统计信息，调参时只能目测曲线

本次升级在不改变整体架构的前提下，补齐这 4 项功能。

## 设计目标

- 单 Y 轴 + 范围切换（自动/固定）
- 图例区域显示数据统计（当前值、最大、最小、均值）
- CSV 一键导出
- VS Code 主题自动适配

## 1. 单 Y 轴 + 范围切换

### 现状

Y 轴始终自动缩放，基于所有数据点的 min/max 加 10% padding。无法手动固定范围。

### 设计

- 默认行为保持自动缩放（不变）
- 双击图例中的变量名，将该变量的当前值范围固定为 Y 轴范围
- 固定后 Y 轴不再自动缩放，刻度显示锁定值
- 再次双击恢复自动缩放
- 工具栏增加 `Auto` 按钮，一键恢复所有变量的自动缩放

### 实现

- Chart.js `scales.y.min` / `scales.y.max` 支持动态设置
- 图例项的 `dblclick` 事件触发范围固定
- 固定时记录 `fixedMin` / `fixedMax`，后续 `updateYAxisRange` 跳过自动计算
- `Auto` 按钮清除所有固定状态

## 2. 数据统计

### 现状

图例只显示变量名和当前值。

### 设计

图例区域每个变量的统计行显示：

```
[色块] variable_name  cur: 25.3 | max: 28.1 | min: 22.0 | avg: 25.1
```

- 统计范围：当前可见时间窗口内的数据点
- 每次 `appendData` 时重新计算
- 暂停状态下统计基于已有数据，不更新

### 实现

- 新增 `computeStats(dataset)` 函数，遍历 `dataset.data` 计算 min/max/avg
- `renderLegend()` 中调用，将统计信息渲染到图例项
- `appendData()` 和 `setTimeWindow()` 后触发 `renderLegend()`

## 3. CSV 导出

### 现状

无导出功能。

### 设计

- 工具栏增加 `Export` 按钮
- 点击后在 Webview 侧生成 CSV 并触发浏览器下载
- 默认文件名：`chart_data_YYYYMMDD_HHmmss.csv`
- CSV 格式：

```csv
timestamp_s,var1,var2,var3
0.000,25.100,1024,0.987
0.100,25.200,1025,0.990
0.200,25.150,1023,0.985
```

- 时间戳为相对时间（秒），精确到毫秒
- 变量值保留 3 位小数
- 缺失数据点用空值填充

### 实现

- Webview 侧 `btnExport` 点击事件
- 从 `chart.data.datasets` 提取数据，按时间戳对齐
- 生成 CSV 字符串，创建 `Blob`，通过 `<a download>` 触发下载
- 不需要扩展侧参与

## 4. 主题适配

### 现状

硬编码 Catppuccin 暗色调色板：`#313244` 网格、`#6c7086` 刻度、`#cdd6f4` 文字。

### 设计

- 图表背景、网格线、刻度文字、tooltip 背景全部使用 VS Code CSS 变量
- 变量颜色保持 Catppuccin 10 色调色板（亮暗色下均有较好表现）
- 主题切换时自动更新，无需手动操作

### CSS 变量映射

| 图表元素 | CSS 变量 |
|---------|---------|
| 网格线 | `--vscode-panel-border` |
| 刻度文字 | `--vscode-descriptionForeground` |
| tooltip 背景 | `--vscode-editorHoverWidget-background` |
| tooltip 边框 | `--vscode-editorHoverWidget-border` |
| tooltip 文字 | `--vscode-editorHoverWidget-foreground` |

### 实现

- 通过 `getComputedStyle(document.documentElement)` 读取 CSS 变量值
- 在 Chart.js 初始化时读取，主题变化时通过 `message` 事件触发重读
- 扩展侧监听 `vscode.window.onDidChangeActiveColorTheme`，通知 Webview 更新

## 涉及文件

| 文件 | 改动 |
|------|------|
| `resources/chart.js` | 主要改动：统计计算、范围切换、CSV 导出、主题读取 |
| `resources/chart.html` | 增加 Export 按钮、Auto 按钮、统计样式 |
| `src/chartManager.ts` | 主题变化事件转发到 Webview |
| `src/chartPanel.ts` | 主题变化消息传递 |

## 不做的事

- 不做多 Y 轴（用户选择简化方案）
- 不做区域缩放（方案 B 内容）
- 不做标注/光标（方案 B 内容）
- 不做多图表布局（方案 B 内容）
- 不改变数据采集和后端逻辑

## 验证标准

1. 亮色和暗色主题下图表均清晰可读
2. 双击图例可固定 Y 轴范围，再次双击恢复自动
3. 统计值在暂停/继续/清除后正确更新
4. Export 按钮生成的 CSV 可在 Excel 中正确打开
5. 所有现有功能（暂停、清除、时间窗口、采集间隔）不受影响
