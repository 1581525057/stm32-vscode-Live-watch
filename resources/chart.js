// resources/chart.js
// Webview 侧的 Chart.js 渲染 + 消息处理
// 方案 B：相对时间轴 + 平滑滑动窗口

(function () {
    const vscode = acquireVsCodeApi();

    // Catppuccin 调色板
    const COLORS = [
        '#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8', '#cba6f7',
        '#94e2d5', '#fab387', '#74c7ec', '#f5c2e7', '#b4befe'
    ];

    // 状态
    let paused = false;
    let timeWindow = 10; // 秒
    let colorIndex = 0;
    const datasets = new Map(); // path -> { index, color }

    // 相对时间基准：首次收到数据时记录，后续所有时间相对于此
    let startTime = 0;
    let elapsed = 0; // 当前已流逝的毫秒数

    // Chart.js 实例
    const ctx = document.getElementById('chartCanvas').getContext('2d');
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
                        color: '#6c7086',
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
                    grid: { color: '#313244' },
                    min: 0,
                    max: 10000 // 初始值，会被动态更新
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
        chart.data.datasets.forEach(function (ds) { ds.data = []; });
        startTime = 0;
        elapsed = 0;
        updateAxisRange();
        chart.update('none');
        vscode.postMessage({ type: 'clear' });
    });

    selWindow.addEventListener('change', function () {
        timeWindow = parseInt(this.value, 10);
        updateAxisRange();
        trimOldData();
        chart.update('none');
        vscode.postMessage({ type: 'setWindow', value: timeWindow });
    });

    selInterval.addEventListener('change', function () {
        vscode.postMessage({ type: 'setInterval', value: parseInt(this.value, 10) });
    });

    // 更新 X 轴范围：始终显示 [elapsed - windowMs, elapsed]
    function updateAxisRange() {
        var windowMs = timeWindow * 1000;
        var xMin = elapsed - windowMs;
        var xMax = elapsed;
        // 保证最小范围，避免图表为空时轴塌缩
        if (xMin < 0) xMin = 0;
        if (xMax < windowMs) xMax = windowMs;
        chart.options.scales.x.min = xMin;
        chart.options.scales.x.max = xMax;
    }

    // 裁剪超出窗口的旧数据
    function trimOldData() {
        var cutoff = elapsed - timeWindow * 1000;
        chart.data.datasets.forEach(function (ds) {
            while (ds.data.length > 0 && ds.data[0].x < cutoff) {
                ds.data.shift();
            }
        });
    }

    // 渲染图例
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

        points.forEach(function (point) {
            var info = datasets.get(point.path);
            if (info === undefined) return;

            var ds = chart.data.datasets[info.index];
            ds.data.push({ x: elapsed, y: point.value });

            // 裁剪超出窗口的数据
            var cutoff = elapsed - windowMs;
            while (ds.data.length > 0 && ds.data[0].x < cutoff) {
                ds.data.shift();
            }
        });

        // 更新 X 轴范围，平滑滑动
        updateAxisRange();
        chart.update('none');
        renderLegend();
    }

    // 设置时间窗口
    function setTimeWindow(seconds) {
        timeWindow = seconds;
        updateAxisRange();
        trimOldData();
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
                chart.data.datasets.forEach(function (ds) { ds.data = []; });
                startTime = 0;
                elapsed = 0;
                updateAxisRange();
                chart.update('none');
                renderLegend();
                break;
            default:
                break;
        }
    });

    // 通知扩展侧 Webview 已就绪
    vscode.postMessage({ type: 'ready' });
})();
