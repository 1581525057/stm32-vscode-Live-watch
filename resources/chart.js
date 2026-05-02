// resources/chart.js
// Webview 侧的 Chart.js 渲染 + 消息处理
// 方案 B：相对时间轴 + 平滑滑动窗口

(function () {
    const vscode = acquireVsCodeApi();

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

    // Catppuccin 调色板
    const COLORS = [
        '#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8', '#cba6f7',
        '#94e2d5', '#fab387', '#74c7ec', '#f5c2e7', '#b4befe'
    ];

    // 二分查找第一个 >= cutoff 的位置（数据已按时间排序，O(log n)）
    function findCutoffIndex(data, cutoff) {
        var lo = 0, hi = data.length;
        while (lo < hi) {
            var mid = (lo + hi) >> 1;
            if (data[mid].x < cutoff) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    // 状态
    let paused = false;
    let timeWindow = 10; // 秒
    let colorIndex = 0;
    const datasets = new Map(); // path -> { index, color, valueEl }
    // 增量追踪 Y 轴 min/max，避免全量扫描
    let yMin = Infinity, yMax = -Infinity;
    let trimCount = 0; // 裁剪计数器，用于延迟重算 Y 轴范围

    // 相对时间基准：首次收到数据时记录，后续所有时间相对于此
    let startTime = 0;
    let elapsed = 0; // 当前已流逝的毫秒数

    // Chart.js 实例
    const ctx = document.getElementById('chartCanvas').getContext('2d');
    var initColors = getThemeColors();
    const chart = new Chart(ctx, {
        type: 'line',
        data: { datasets: [] },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: false },
                    ticks: {
                        color: initColors.tickColor,
                        font: { size: 10 },
                        callback: function (value) {
                            // value 是相对于 startTime 的毫秒数
                            // 显示相对于 "现在" 的秒数
                            var diff = (value - elapsed) / 1000;
                            if (diff > -0.5) return 'now';
                            return diff.toFixed(0) + 's';
                        },
                        maxTicksLimit: 8,
                        stepSize: 1000
                    },
                    grid: { color: initColors.gridColor },
                    min: 0,
                    max: 10000 // 初始值，会被动态更新
                },
                y: {
                    ticks: { color: initColors.tickColor, font: { size: 10 } },
                    grid: { color: initColors.gridColor }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: initColors.tooltipBg,
                    titleColor: initColors.tooltipText,
                    bodyColor: initColors.tooltipText,
                    borderColor: initColors.tooltipBorder,
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
        }
    });

    // DOM 元素
    var legendEl = document.getElementById('legend');
    var btnAdd = document.getElementById('btnAdd');
    var btnPause = document.getElementById('btnPause');
    var btnClear = document.getElementById('btnClear');
    var btnExport = document.getElementById('btnExport');
    var selWindow = document.getElementById('selWindow');
    var selInterval = document.getElementById('selInterval');

    // 工具栏事件
    btnAdd.addEventListener('click', function () {
        vscode.postMessage({ type: 'addVariable' });
    });

    btnPause.addEventListener('click', function () {
        paused = !paused;
        btnPause.textContent = paused ? '▶ Resume' : '⏸ Pause';
        vscode.postMessage({ type: paused ? 'pause' : 'resume' });
    });

    btnClear.addEventListener('click', function () {
        resetChart();
        vscode.postMessage({ type: 'clear' });
    });

    selWindow.addEventListener('change', function () {
        timeWindow = parseInt(this.value, 10);
        updateAxisRange();
        trimOldData();
        recalcYRange();
        updateYAxisRange();
        chart.update('none');
        vscode.postMessage({ type: 'setWindow', value: timeWindow });
    });

    selInterval.addEventListener('change', function () {
        vscode.postMessage({ type: 'setInterval', value: parseInt(this.value, 10) });
    });

    // CSV 导出：收集所有数据点，按时间戳对齐，生成 CSV 文件下载
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

        // 为每个数据集建立 x -> y 的索引，避免 O(T*D*P) 嵌套查找
        var dsIndex = chart.data.datasets.map(function (ds) {
            var map = new Map();
            ds.data.forEach(function (pt) {
                map.set(pt.x, pt.y);
            });
            return map;
        });

        // 构建数据行
        var rows = [header];
        timestamps.forEach(function (ts) {
            var row = (ts / 1000).toFixed(3);
            chart.data.datasets.forEach(function (ds, i) {
                var found = dsIndex[i].get(ts);
                row += ',' + (found !== undefined ? found.toFixed(3) : '');
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
        var csvContent = '﻿' + rows.join('\n');
        var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    });

    // 更新 X 轴范围：始终显示 [elapsed - windowMs, elapsed + padding]
    function updateAxisRange() {
        var windowMs = timeWindow * 1000;
        var padding = windowMs * 0.05; // 5% 右边距，避免数据线贴着右边缘
        var xMin = elapsed - windowMs;
        var xMax = elapsed + padding;
        // 保证最小范围，避免图表为空时轴塌缩
        if (xMin < 0) xMin = 0;
        if (xMax < windowMs + padding) xMax = windowMs + padding;
        chart.options.scales.x.min = xMin;
        chart.options.scales.x.max = xMax;
    }

    // 裁剪超出窗口的旧数据（二分查找 O(log n) + 批量 splice）
    function trimOldData() {
        var cutoff = elapsed - timeWindow * 1000;
        chart.data.datasets.forEach(function (ds) {
            if (ds.data.length === 0 || ds.data[0].x >= cutoff) return;
            var removeCount = findCutoffIndex(ds.data, cutoff);
            if (removeCount > 0) {
                ds.data.splice(0, removeCount);
            }
        });
    }

    // Y 轴自动缩放：使用增量追踪的 yMin/yMax，避免全量扫描
    function updateYAxisRange() {
        if (yMin === Infinity) {
            chart.options.scales.y.min = undefined;
            chart.options.scales.y.max = undefined;
            return;
        }

        var range = yMax - yMin;
        if (range < 1) range = 1;
        var padding = range * 0.1;

        chart.options.scales.y.min = yMin - padding;
        chart.options.scales.y.max = yMax + padding;
    }

    // 从所有数据集中重新计算 yMin/yMax（仅在删除变量或清空时调用）
    function recalcYRange() {
        yMin = Infinity;
        yMax = -Infinity;
        chart.data.datasets.forEach(function (ds) {
            for (var i = 0; i < ds.data.length; i++) {
                var v = ds.data[i].y;
                if (v < yMin) yMin = v;
                if (v > yMax) yMax = v;
            }
        });
    }

    // 完整重建图例 DOM（仅在添加/删除变量时调用）
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
            value.setAttribute('data-label', ds.label);
            var lastPoint = ds.data.length > 0 ? ds.data[ds.data.length - 1] : null;
            value.textContent = lastPoint ? lastPoint.y.toFixed(3) : '?';
            // 缓存 DOM 引用，避免每 250ms querySelectorAll
            var dsInfo = datasets.get(ds.label);
            if (dsInfo) { dsInfo.valueEl = value; }

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
            item.appendChild(remove);
            legendEl.appendChild(item);
        });
    }

    // 只更新图例的值文本，不重建 DOM（高频调用时使用）
    function updateLegendValues() {
        datasets.forEach(function (info, label) {
            if (!info.valueEl) return;
            var ds = chart.data.datasets[info.index];
            if (ds && ds.data.length > 0) {
                info.valueEl.textContent = ds.data[ds.data.length - 1].y.toFixed(3);
            }
        });
    }

    // 添加变量
    function addVariable(path, color) {
        if (datasets.has(path)) return;

        var c = color || COLORS[colorIndex % COLORS.length];
        colorIndex++;

        var dsIndex = chart.data.datasets.length;
        chart.data.datasets.push({
            label: path,
            data: [],
            borderColor: c,
            backgroundColor: c + '33',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.1,
            fill: false
        });
        datasets.set(path, { index: dsIndex, color: c });
        chart.update('none');
        renderLegend();
    }

    // 移除变量
    function removeVariable(path) {
        var info = datasets.get(path);
        if (info === undefined) return;

        chart.data.datasets.splice(info.index, 1);
        datasets.delete(path);

        // 重建索引
        var idx = 0;
        datasets.forEach(function (val) {
            val.index = idx++;
        });

        // 重算 Y 轴范围（被移除的数据集可能包含 yMin/yMax）
        recalcYRange();
        updateYAxisRange();
        chart.update('none');
        renderLegend();
        vscode.postMessage({ type: 'removeVariable', path: path });
    }

    // 追加数据点（核心改动：使用相对时间）
    function appendData(points) {
        // 首次收到数据时初始化时间基准
        if (startTime === 0) {
            startTime = Date.now();
        }

        // 更新已流逝时间
        elapsed = Date.now() - startTime;
        var windowMs = timeWindow * 1000;
        var cutoff = elapsed - windowMs;
        var trimmed = false;

        points.forEach(function (point) {
            var info = datasets.get(point.path);
            if (info === undefined) return;

            var ds = chart.data.datasets[info.index];
            var v = point.value;
            ds.data.push({ x: elapsed, y: v });

            // 增量更新 Y 轴范围
            if (v < yMin) yMin = v;
            if (v > yMax) yMax = v;

            // 批量裁剪超出窗口的数据（二分查找 O(log n) + 一次 splice）
            if (ds.data.length > 0 && ds.data[0].x < cutoff) {
                var removeCount = findCutoffIndex(ds.data, cutoff);
                if (removeCount > 0) {
                    ds.data.splice(0, removeCount);
                    trimmed = true;
                }
            }
        });

        // 裁剪后延迟重算 Y 轴范围（避免每次 250ms 都全量扫描）
        // 增量追踪已覆盖新数据，这里只处理被驱逐的极值点
        if (trimmed) {
            trimCount++;
            if (trimCount >= 10) {
                recalcYRange();
                trimCount = 0;
            }
        }

        // 更新 X 轴范围，平滑滑动
        updateAxisRange();
        // Y 轴自动居中
        updateYAxisRange();
        chart.update('none');
        updateLegendValues();
    }

    // 重置图表数据和状态
    function resetChart() {
        chart.data.datasets.forEach(function (ds) { ds.data = []; });
        startTime = 0;
        elapsed = 0;
        yMin = Infinity;
        yMax = -Infinity;
        trimCount = 0;
        updateAxisRange();
        updateYAxisRange();
        chart.update('none');
    }

    // 设置时间窗口
    function setTimeWindow(seconds) {
        timeWindow = seconds;
        updateAxisRange();
        trimOldData();
        recalcYRange();
        updateYAxisRange();
        chart.update('none');
    }

    // 监听扩展侧消息
    window.addEventListener('message', function (event) {
        var msg = event.data;
        switch (msg.type) {
            case 'addVariable':
                addVariable(msg.path, msg.color);
                break;
            case 'removeVariable':
                removeVariable(msg.path);
                break;
            case 'dataUpdate':
                if (!paused) {
                    appendData(msg.data);
                }
                break;
            case 'setTimeWindow':
                setTimeWindow(msg.value);
                break;
            case 'clear':
                resetChart();
                renderLegend();
                break;
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
            default:
                break;
        }
    });

    // 通知扩展侧 Webview 已就绪
    vscode.postMessage({ type: 'ready' });
})();
