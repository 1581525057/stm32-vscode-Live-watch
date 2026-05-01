// resources/chart.js
// Webview 侧的 Chart.js 渲染 + 消息处理

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
    const datasets = new Map(); // path -> { dataset index, label, color }

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
                            const diff = (value - Date.now()) / 1000;
                            return diff.toFixed(0) + 's';
                        },
                        maxTicksLimit: 8,
                        stepSize: 1000
                    },
                    grid: { color: '#313244' }
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
                            const diff = (items[0].parsed.x - Date.now()) / 1000;
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
    const legendEl = document.getElementById('legend');
    const btnAdd = document.getElementById('btnAdd');
    const btnPause = document.getElementById('btnPause');
    const btnClear = document.getElementById('btnClear');
    const selWindow = document.getElementById('selWindow');
    const selInterval = document.getElementById('selInterval');

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
        chart.update('none');
        vscode.postMessage({ type: 'clear' });
    });

    selWindow.addEventListener('change', function () {
        timeWindow = parseInt(this.value, 10);
        vscode.postMessage({ type: 'setWindow', value: timeWindow });
    });

    selInterval.addEventListener('change', function () {
        vscode.postMessage({ type: 'setInterval', value: parseInt(this.value, 10) });
    });

    // 渲染图例
    function renderLegend() {
        legendEl.innerHTML = '';
        chart.data.datasets.forEach(function (ds, i) {
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
        datasets.forEach(function (val, key) {
            val.index = idx++;
        });

        chart.update('none');
        renderLegend();
        vscode.postMessage({ type: 'removeVariable', path: path });
    }

    // 追加数据点
    function appendData(points) {
        var now = Date.now();
        var cutoff = now - timeWindow * 1000;

        points.forEach(function (point) {
            var info = datasets.get(point.path);
            if (info === undefined) return;

            var ds = chart.data.datasets[info.index];
            ds.data.push({ x: now, y: point.value });

            // 裁剪超出窗口的数据
            while (ds.data.length > 0 && ds.data[0].x < cutoff) {
                ds.data.shift();
            }
        });

        chart.update('none');
        renderLegend();
    }

    // 设置时间窗口
    function setTimeWindow(seconds) {
        timeWindow = seconds;
        var cutoff = Date.now() - timeWindow * 1000;
        chart.data.datasets.forEach(function (ds) {
            while (ds.data.length > 0 && ds.data[0].x < cutoff) {
                ds.data.shift();
            }
        });
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
