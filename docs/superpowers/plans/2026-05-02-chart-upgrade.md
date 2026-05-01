# 图表系统升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐图表系统的 4 项功能：主题适配、数据统计、Y 轴范围切换、CSV 导出

**Architecture:** 所有改动集中在 Webview 侧（chart.js + chart.html），扩展侧仅增加主题变化事件转发。不改动后端和数据采集逻辑。

**Tech Stack:** Chart.js 4.x, VS Code Webview API, CSS 变量

---

## 涉及文件

| 文件 | 职责 |
|------|------|
| `resources/chart.js` | 图表渲染、统计计算、范围切换、CSV 导出、主题读取 |
| `resources/chart.html` | 增加 Export/Auto 按钮、统计样式、主题 CSS 变量 |
| `src/chartManager.ts` | 主题变化事件监听，转发到 Webview |
| `src/chartPanel.ts` | 主题变化消息传递（可能不需要改动） |

---

### Task 1: 主题适配 — CSS 变量读取与图表初始化

**Files:**
- Modify: `resources/chart.js:8-85`（Chart.js 初始化配置）
- Modify: `resources/chart.html`（CSS 变量引用）

- [ ] **Step 1: 在 chart.js 顶部添加主题读取函数**

在 `resources/chart.js` 的 IIFE 内、`const vscode` 之后添加：

```javascript
    // 读取 VS Code 主题 CSS 变量
    function getThemeColors() {
        var style = getComputedStyle(document.body);
        return {
            gridColor: style.getPropertyValue('--vscode-panel-border').trim() || '#3c3c3c',
            tickColor: style.getPropertyValue('--vscode-descriptionForeground').trim() || '#999',
            tooltipBg: style.getPropertyValue('--vscode-editorHoverWidget-background').trim() || '#252526',
            tooltipBorder: style.getPropertyValue('--vscode-editorHoverWidget-border').trim() || '#45475a',
            tooltipText: style.getPropertyValue('--vscode-editorHoverWidget-foreground').trim() || '#cccccc'
        };
    }
```

- [ ] **Step 2: 替换 Chart.js 初始化中的硬编码颜色**

将 `resources/chart.js` 中 Chart 初始化的 `options.scales` 和 `options.plugins.tooltip` 部分替换为使用 `getThemeColors()`。

原代码（约第 38-84 行）：

```javascript
            scales: {
                x: {
                    type: 'linear',
                    title: { display: false },
                    ticks: {
                        color: '#6c7086',
                        font: { size: 10 },
                        // ... callback 不变
                    },
                    grid: { color: '#313244' },
                    min: 0,
                    max: 10000
                },
                y: {
                    ticks: { color: '#6c7086', font: { size: 10 } },
                    grid: { color: '#313244' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#313244',
                    titleColor: '#cdd6f4',
                    bodyColor: '#cdd6f4',
                    borderColor: '#45475a',
                    borderWidth: 1,
                    // ... callbacks 不变
                }
            }
```

替换为：

```javascript
            scales: {
                x: {
                    type: 'linear',
                    title: { display: false },
                    ticks: {
                        color: getThemeColors().tickColor,
                        font: { size: 10 },
                        callback: function (value) {
                            var diff = (value - elapsed) / 1000;
                            if (diff > -0.5) return 'now';
                            return diff.toFixed(0) + 's';
                        },
                        maxTicksLimit: 8,
                        stepSize: 1000
                    },
                    grid: { color: getThemeColors().gridColor },
                    min: 0,
                    max: 10000
                },
                y: {
                    ticks: { color: getThemeColors().tickColor, font: { size: 10 } },
                    grid: { color: getThemeColors().gridColor }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: getThemeColors().tooltipBg,
                    titleColor: getThemeColors().tooltipText,
                    bodyColor: getThemeColors().tooltipText,
                    borderColor: getThemeColors().tooltipBorder,
                    borderWidth: 1,
                    callbacks: {
                        title: function (items) {
                            if (!items.length) return '';
                            var diff = (items[0].parsed.x - elapsed) / 1000;
                            if (diff > -0.5) return 'now';
                            return diff.toFixed(1) + 's ago';
                        },
                        label: function (item) {
                            return item.dataset.label + ': ' + item.parsed.y.toFixed(3);
                        }
                    }
                }
            }
```

- [ ] **Step 3: 添加主题变化消息处理**

在 `resources/chart.js` 的 `window.addEventListener('message', ...)` 的 switch 中添加 case：

```javascript
            case 'themeChanged':
                var colors = getThemeColors();
                chart.options.scales.x.ticks.color = colors.tickColor;
                chart.options.scales.x.grid.color = colors.gridColor;
                chart.options.scales.y.ticks.color = colors.tickColor;
                chart.options.scales.y.grid.color = colors.gridColor;
                chart.options.plugins.tooltip.backgroundColor = colors.tooltipBg;
                chart.options.plugins.tooltip.titleColor = colors.tooltipText;
                chart.options.plugins.tooltip.bodyColor = colors.tooltipText;
                chart.options.plugins.tooltip.borderColor = colors.tooltipBorder;
                chart.update('none');
                break;
```

- [ ] **Step 4: 在 chartManager.ts 中监听主题变化**

在 `src/chartManager.ts` 的 `ChartManager` 类中添加方法：

```typescript
    public notifyThemeChanged(): void {
        this.webviewProvider?.postMessage({ type: 'themeChanged' });
    }
```

在 `src/extension.ts` 的 `configChangeDisposable` 旁边添加主题监听：

```typescript
    const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(() => {
        chartManagerInstance.notifyThemeChanged();
    });
```

并将 `themeChangeDisposable` 添加到 `context.subscriptions.push(...)` 中。

- [ ] **Step 5: 手动验证**

在 VS Code 中切换亮色/暗色主题（`Ctrl+Shift+P` → `Color Theme`），确认图表网格线、刻度、tooltip 颜色随之变化。

- [ ] **Step 6: 提交**

```bash
git add resources/chart.js resources/chart.html src/chartManager.ts src/extension.ts
git commit -m "feat: 图表主题适配，自动读取 VS Code 主题 CSS 变量"
```

---

### Task 2: 数据统计 — 图例显示 min/max/avg

**Files:**
- Modify: `resources/chart.js:178-211`（renderLegend 函数）
- Modify: `resources/chart.js:256-286`（appendData 函数）
- Modify: `resources/chart.html`（统计样式）

- [ ] **Step 1: 在 chart.html 的 `.legend-value` 样式后添加统计样式**

在 `resources/chart.html` 的 `<style>` 中，`.legend-remove:hover` 之后添加：

```css
        .legend-stats {
            color: var(--vscode-descriptionForeground, #999);
            font-size: 10px;
            margin-left: 8px;
            font-family: var(--vscode-editor-font-family, monospace);
        }

        .legend-stats span {
            margin-right: 6px;
        }
```

- [ ] **Step 2: 添加统计计算函数**

在 `resources/chart.js` 的 `renderLegend` 函数之前添加：

```javascript
    // 计算数据集的统计信息（基于当前可见数据）
    function computeStats(ds) {
        if (!ds.data || ds.data.length === 0) {
            return null;
        }
        var min = Infinity, max = -Infinity, sum = 0;
        for (var i = 0; i < ds.data.length; i++) {
            var y = ds.data[i].y;
            if (y < min) min = y;
            if (y > max) max = y;
            sum += y;
        }
        return {
            min: min,
            max: max,
            avg: sum / ds.data.length,
            cur: ds.data[ds.data.length - 1].y
        };
    }
```

- [ ] **Step 3: 修改 renderLegend 显示统计信息**

将 `resources/chart.js` 中的 `renderLegend` 函数替换为：

```javascript
    function renderLegend() {
        legendEl.innerHTML = '';
        chart.data.datasets.forEach(function (ds) {
            var item = document.createElement('span');
            item.className = 'legend-item';

            var color = document.createElement('span');
            color.className = 'legend-color';
            color.style.backgroundColor = ds.borderColor;

            var name = document.createElement('span');
            name.className = 'legend-name';
            name.textContent = ds.label;

            var value = document.createElement('span');
            value.className = 'legend-value';
            var lastPoint = ds.data.length > 0 ? ds.data[ds.data.length - 1] : null;
            value.textContent = lastPoint ? lastPoint.y.toFixed(3) : '?';

            var stats = computeStats(ds);
            var statsEl = document.createElement('span');
            statsEl.className = 'legend-stats';
            if (stats) {
                statsEl.innerHTML =
                    '<span>max:' + stats.max.toFixed(3) + '</span>' +
                    '<span>min:' + stats.min.toFixed(3) + '</span>' +
                    '<span>avg:' + stats.avg.toFixed(3) + '</span>';
            }

            var remove = document.createElement('span');
            remove.className = 'legend-remove';
            remove.textContent = '✕';
            remove.title = 'Remove from chart';
            remove.addEventListener('click', function () {
                removeVariable(ds.label);
            });

            item.appendChild(color);
            item.appendChild(name);
            item.appendChild(value);
            item.appendChild(statsEl);
            item.appendChild(remove);
            legendEl.appendChild(item);
        });
    }
```

- [ ] **Step 4: 手动验证**

添加变量到图表，确认图例区域显示 `max: xxx | min: xxx | avg: xxx`。暂停后确认统计值不再更新。

- [ ] **Step 5: 提交**

```bash
git add resources/chart.js resources/chart.html
git commit -m "feat: 图例区域显示数据统计（最大、最小、均值）"
```

---

### Task 3: Y 轴范围切换 — 双击固定/自动

**Files:**
- Modify: `resources/chart.js`（updateYAxisRange 函数、renderLegend 函数、状态变量）
- Modify: `resources/chart.html`（Auto 按钮）

- [ ] **Step 1: 添加 Y 轴固定状态变量**

在 `resources/chart.js` 的状态区域（`let paused = false;` 之后）添加：

```javascript
    let yFixed = false;     // Y 轴是否固定范围
    let yFixedMin = 0;
    let yFixedMax = 100;
```

- [ ] **Step 2: 修改 updateYAxisRange 支持固定模式**

将 `resources/chart.js` 中的 `updateYAxisRange` 函数替换为：

```javascript
    function updateYAxisRange() {
        if (yFixed) {
            chart.options.scales.y.min = yFixedMin;
            chart.options.scales.y.max = yFixedMax;
            return;
        }

        var allMin = Infinity, allMax = -Infinity;
        chart.data.datasets.forEach(function (ds) {
            ds.data.forEach(function (pt) {
                if (pt.y < allMin) allMin = pt.y;
                if (pt.y > allMax) allMax = pt.y;
            });
        });

        if (allMin === Infinity) {
            chart.options.scales.y.min = undefined;
            chart.options.scales.y.max = undefined;
            return;
        }

        var range = allMax - allMin;
        if (range < 1) range = 1;
        var padding = range * 0.1;

        chart.options.scales.y.min = allMin - padding;
        chart.options.scales.y.max = allMax + padding;
    }
```

- [ ] **Step 3: 在 chart.html 工具栏添加 Auto 按钮**

在 `resources/chart.html` 的 `<button id="btnClear"` 之后添加：

```html
        <button id="btnAutoY" title="Reset Y-axis to auto scale">Auto Y</button>
```

- [ ] **Step 4: 绑定 Auto 按钮事件和双击图例事件**

在 `resources/chart.js` 的 DOM 元素获取区域添加：

```javascript
    var btnAutoY = document.getElementById('btnAutoY');
```

在工具栏事件区域添加：

```javascript
    btnAutoY.addEventListener('click', function () {
        yFixed = false;
        btnAutoY.style.fontWeight = 'normal';
        updateYAxisRange();
        chart.update('none');
    });
```

- [ ] **Step 5: 在 renderLegend 中为图例名称添加双击事件**

修改 `renderLegend` 函数中 `name` 的创建部分，在 `name.textContent = ds.label;` 之后添加：

```javascript
            name.title = 'Double-click to fix Y-axis range';
            name.style.cursor = 'pointer';
            name.addEventListener('dblclick', function () {
                // 计算当前数据范围并固定
                var stats = computeStats(ds);
                if (!stats) return;
                var range = stats.max - stats.min;
                if (range < 1) range = 1;
                var padding = range * 0.1;
                yFixedMin = stats.min - padding;
                yFixedMax = stats.max + padding;
                yFixed = true;
                btnAutoY.style.fontWeight = 'bold';
                updateYAxisRange();
                chart.update('none');
            });
```

- [ ] **Step 6: 手动验证**

添加两个不同量程的变量（如温度 25-40 和 PWM 0-10000），双击温度的图例名，确认 Y 轴固定到温度范围。点击 `Auto Y` 按钮恢复自动缩放。

- [ ] **Step 7: 提交**

```bash
git add resources/chart.js resources/chart.html
git commit -m "feat: Y 轴支持双击固定范围和 Auto Y 按钮恢复自动缩放"
```

---

### Task 4: CSV 导出 — Export 按钮

**Files:**
- Modify: `resources/chart.js`（添加导出函数和按钮事件）
- Modify: `resources/chart.html`（Export 按钮）

- [ ] **Step 1: 在 chart.html 工具栏添加 Export 按钮**

在 `resources/chart.html` 的 `<button id="btnAutoY"` 之后添加：

```html
        <button id="btnExport" title="Export data to CSV">Export</button>
```

- [ ] **Step 2: 在 chart.js 中添加 DOM 元素引用**

在 `resources/chart.js` 的 DOM 元素获取区域添加：

```javascript
    var btnExport = document.getElementById('btnExport');
```

- [ ] **Step 3: 添加 CSV 导出函数**

在 `resources/chart.js` 的工具栏事件区域添加：

```javascript
    btnExport.addEventListener('click', function () {
        if (chart.data.datasets.length === 0) {
            return;
        }

        // 收集所有时间戳并排序
        var allTimestamps = new Set();
        chart.data.datasets.forEach(function (ds) {
            ds.data.forEach(function (pt) {
                allTimestamps.add(pt.x);
            });
        });
        var timestamps = Array.from(allTimestamps).sort(function (a, b) { return a - b; });

        // 构建 CSV 头
        var header = 'timestamp_s';
        chart.data.datasets.forEach(function (ds) {
            header += ',' + ds.label;
        });

        // 构建数据行
        var rows = [header];
        timestamps.forEach(function (ts) {
            var row = (ts / 1000).toFixed(3);
            chart.data.datasets.forEach(function (ds) {
                var found = null;
                for (var i = 0; i < ds.data.length; i++) {
                    if (ds.data[i].x === ts) {
                        found = ds.data[i].y;
                        break;
                    }
                }
                row += ',' + (found !== null ? found.toFixed(3) : '');
            });
            rows.push(row);
        });

        // 生成文件名
        var now = new Date();
        var filename = 'chart_data_' +
            now.getFullYear() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') + '_' +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0') +
            String(now.getSeconds()).padStart(2, '0') +
            '.csv';

        // 触发下载
        var csvContent = rows.join('\n');
        var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    });
```

- [ ] **Step 4: 手动验证**

添加变量到图表，等待有数据后点击 `Export` 按钮。确认下载了 CSV 文件，用 Excel 打开确认格式正确：第一列为时间戳（秒），后续列为各变量值。

- [ ] **Step 5: 提交**

```bash
git add resources/chart.js resources/chart.html
git commit -m "feat: 图表数据 CSV 一键导出"
```

---

### Task 5: 最终集成验证

**Files:**
- None（仅验证）

- [ ] **Step 1: 编译 TypeScript 确认无错误**

```bash
cd D:\Stm32ProjectNEW\stm32-vscode-Live-watch && npm run compile
```

Expected: 无错误输出

- [ ] **Step 2: 打包扩展**

```bash
cd D:\Stm32ProjectNEW\stm32-vscode-Live-watch && npx vsce package
```

Expected: 生成 `.vsix` 文件

- [ ] **Step 3: 安装并手动测试全流程**

1. 安装 `.vsix` 到 VS Code
2. 启动调试会话，添加变量到图表
3. 切换亮色/暗色主题，确认图表颜色适配
4. 确认图例显示 max/min/avg 统计
5. 双击图例变量名，确认 Y 轴固定；点击 Auto Y 恢复
6. 点击 Export，确认 CSV 下载正确
7. 确认暂停、清除、时间窗口、采集间隔等原有功能正常

- [ ] **Step 4: 提交版本号更新**

更新 `package.json` 中的 `version` 为 `3.1.0`，更新 `README.md` 中的版本号和新功能说明。

```bash
git add package.json README.md
git commit -m "release: 发布 3.1.0 版本，图表系统升级（主题适配、统计、范围切换、CSV 导出）"
```
