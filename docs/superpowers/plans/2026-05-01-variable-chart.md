# 变量图表查看模块实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 STM32 Live Watch 扩展添加底部面板实时折线图，支持从监视面板右键或手动输入添加变量，独立刷新通道（可配置 50ms/100ms/250ms），悬停精确值 + 滚轮缩放 + 暂停/清除。

**Architecture:** ChartManager（扩展侧）负责数据采集，通过 postMessage 发送给 ChartViewProvider 的 Webview，Webview 内 Chart.js 渲染折线图。复用现有 ServerClient.readPaths()，不修改后端。

**Tech Stack:** TypeScript, Chart.js 4.x, VS Code WebviewView API, HTML/CSS/JS

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `package.json` | 修改 | 添加 chart.js 依赖 |
| `resources/chart.min.js` | 新增 | Chart.js 库文件（从 node_modules 复制） |
| `resources/chart.html` | 新增 | Webview HTML 模板 |
| `resources/chart.js` | 新增 | Webview 侧 Chart.js 渲染 + 消息处理 |
| `src/chartPanel.ts` | 新增 | WebviewViewProvider，创建 Webview |
| `src/chartManager.ts` | 新增 | 数据采集、变量管理、Webview 通信 |
| `src/extension.ts` | 修改 | 集成 ChartManager + ChartViewProvider |
| `src/variableTreeDataProvider.ts` | 修改 | 右键菜单 "Add to Chart" |
| `src/elfResolver.test.ts` | 不改 | — |
| `resources/server.py` | 不改 | — |
| `src/serverClient.ts` | 不改 | — |

---

### Task 1: 安装 Chart.js 并复制到 resources

**Files:**
- Modify: `package.json`
- Create: `resources/chart.min.js`

- [ ] **Step 1: 安装 chart.js 依赖**

```bash
cd D:\Stm32ProjectNEW\stm32-vscode-Live-watch
npm install chart.js
```

- [ ] **Step 2: 复制 chart.min.js 到 resources 目录**

```bash
copy node_modules\chart.js\dist\chart.umd.js resources\chart.min.js
```

- [ ] **Step 3: 验证文件存在**

```bash
dir resources\chart.min.js
```

Expected: 文件存在，约 200KB

- [ ] **Step 4: 提交**

```bash
git add package.json package-lock.json resources/chart.min.js
git commit -m "deps: 添加 chart.js 依赖并复制到 resources"
```

---

### Task 2: 创建 Webview HTML 模板

**Files:**
- Create: `resources/chart.html`

- [ ] **Step 1: 创建 chart.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
    <title>STM32 Variable Chart</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--vscode-foreground, #cccccc);
            background: var(--vscode-editor-background, #1e1e1e);
            overflow: hidden;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            background: var(--vscode-sideBar-background, #252526);
            border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
            flex-shrink: 0;
        }

        .toolbar button {
            background: var(--vscode-button-secondaryBackground, #3c3c3c);
            color: var(--vscode-button-secondaryForeground, #cccccc);
            border: none;
            border-radius: 4px;
            padding: 4px 10px;
            font-size: 12px;
            cursor: pointer;
            white-space: nowrap;
        }

        .toolbar button:hover {
            background: var(--vscode-button-secondaryHoverBackground, #45494e);
        }

        .toolbar button.primary {
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, #ffffff);
        }

        .toolbar button.primary:hover {
            background: var(--vscode-button-hoverBackground, #1177bb);
        }

        .toolbar select {
            background: var(--vscode-dropdown-background, #3c3c3c);
            color: var(--vscode-dropdown-foreground, #cccccc);
            border: 1px solid var(--vscode-dropdown-border, #3c3c3c);
            border-radius: 3px;
            padding: 2px 6px;
            font-size: 11px;
        }

        .toolbar .spacer { flex: 1; }

        .toolbar label {
            color: var(--vscode-descriptionForeground, #999);
            font-size: 11px;
        }

        .legend {
            display: flex;
            gap: 12px;
            padding: 4px 12px;
            background: var(--vscode-sideBar-background, #252526);
            border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
            flex-shrink: 0;
            flex-wrap: wrap;
            min-height: 28px;
            align-items: center;
        }

        .legend:empty::before {
            content: 'No variables plotted — click + Add or right-click a variable in the watch panel';
            color: var(--vscode-descriptionForeground, #999);
            font-size: 11px;
            font-style: italic;
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            cursor: default;
        }

        .legend-color {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            display: inline-block;
            flex-shrink: 0;
        }

        .legend-name { font-weight: 500; }

        .legend-value {
            color: var(--vscode-descriptionForeground, #999);
            font-size: 10px;
        }

        .legend-remove {
            color: var(--vscode-descriptionForeground, #999);
            cursor: pointer;
            font-size: 10px;
            margin-left: 2px;
        }

        .legend-remove:hover {
            color: var(--vscode-errorForeground, #f44747);
        }

        .chart-container {
            flex: 1;
            position: relative;
            padding: 4px;
            min-height: 0;
        }

        .chart-container canvas {
            width: 100% !important;
            height: 100% !important;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button class="primary" id="btnAdd" title="Add variable to chart">+ Add</button>
        <button id="btnPause" title="Pause / Resume">⏸ Pause</button>
        <button id="btnClear" title="Clear all data">🗑 Clear</button>
        <div class="spacer"></div>
        <label>Window:</label>
        <select id="selWindow">
            <option value="5">5s</option>
            <option value="10" selected>10s</option>
            <option value="30">30s</option>
            <option value="60">60s</option>
        </select>
        <label>Interval:</label>
        <select id="selInterval">
            <option value="50">50ms</option>
            <option value="100" selected>100ms</option>
            <option value="250">250ms</option>
        </select>
    </div>
    <div class="legend" id="legend"></div>
    <div class="chart-container">
        <canvas id="chartCanvas"></canvas>
    </div>
    <script nonce="${nonce}" src="${chartJsUri}"></script>
    <script nonce="${nonce}" src="${chartScriptUri}"></script>
</body>
</html>
```

- [ ] **Step 2: 提交**

```bash
git add resources/chart.html
git commit -m "feat: 添加图表面板 Webview HTML 模板"
```

---

### Task 3: 创建 Webview 侧 Chart.js 渲染脚本

**Files:**
- Create: `resources/chart.js`

- [ ] **Step 1: 创建 resources/chart.js**

```javascript
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
```

- [ ] **Step 2: 验证语法无误**

在浏览器中打开 chart.html（临时去掉 CSP），确认无 JS 报错。

- [ ] **Step 3: 提交**

```bash
git add resources/chart.js
git commit -m "feat: 添加 Webview 侧 Chart.js 渲染脚本"
```

---

### Task 4: 创建 ChartViewProvider（WebviewView Provider）

**Files:**
- Create: `src/chartPanel.ts`

- [ ] **Step 1: 创建 chartPanel.ts**

```typescript
// src/chartPanel.ts
// WebviewView Provider：底部图表面板

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

export class ChartViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'stm32-debug-chart-panel';

    private webviewView: vscode.WebviewView | undefined;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly onMessage: (msg: any) => void
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.webviewView = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            (msg) => this.onMessage(msg),
            undefined
        );

        webviewView.onDidDispose(() => {
            this.webviewView = undefined;
        });
    }

    public postMessage(message: any): void {
        if (this.webviewView) {
            this.webviewView.webview.postMessage(message);
        }
    }

    public isVisible(): boolean {
        return this.webviewView?.visible ?? false;
    }

    private getHtmlContent(webview: vscode.Webview): string {
        const htmlPath = path.join(this.extensionUri.fsPath, 'resources', 'chart.html');
        let html = fs.readFileSync(htmlPath, 'utf-8');

        const nonce = crypto.randomBytes(16).toString('hex');
        const chartJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'resources', 'chart.min.js')
        );
        const chartScriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'resources', 'chart.js')
        );

        html = html.replace(/\$\{nonce\}/g, nonce);
        html = html.replace(/\$\{chartJsUri\}/g, chartJsUri.toString());
        html = html.replace(/\$\{chartScriptUri\}/g, chartScriptUri.toString());

        return html;
    }
}
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit src/chartPanel.ts
```

Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/chartPanel.ts
git commit -m "feat: 添加 ChartViewProvider 底部面板"
```

---

### Task 5: 创建 ChartManager（数据管理器）

**Files:**
- Create: `src/chartManager.ts`

- [ ] **Step 1: 创建 chartManager.ts**

```typescript
// src/chartManager.ts
// 图表数据管理器：变量列表、独立定时器、Webview 通信

import * as vscode from 'vscode';
import { ServerClient } from './serverClient';
import { ChartViewProvider } from './chartPanel';

const CHART_VARIABLES_KEY = 'stm32LiveWatch.chartVariables';

const CHART_COLORS = [
    '#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8', '#cba6f7',
    '#94e2d5', '#fab387', '#74c7ec', '#f5c2e7', '#b4befe'
];

export class ChartManager {
    private chartVariables: string[] = [];
    private collectTimer: NodeJS.Timeout | null = null;
    private collectInterval = 100;
    private paused = false;
    private isCollecting = false;
    private colorIndex = 0;
    private webviewProvider: ChartViewProvider | undefined;

    constructor(
        private serverClient: ServerClient,
        private workspaceState: vscode.Memento
    ) {
        this.collectInterval = vscode.workspace.getConfiguration('stm32LiveWatch').get<number>('chartRefreshInterval', 100);
    }

    public attachWebview(provider: ChartViewProvider): void {
        this.webviewProvider = provider;
    }

    public detachWebview(): void {
        this.webviewProvider = undefined;
    }

    public async addVariable(path: string): Promise<void> {
        if (this.chartVariables.includes(path)) {
            return;
        }

        // 验证变量存在
        try {
            await this.serverClient.describe(path);
        } catch (error) {
            vscode.window.showErrorMessage(`Variable not found: ${path}`);
            return;
        }

        this.chartVariables.push(path);
        await this.persistVariables();

        const color = CHART_COLORS[this.colorIndex % CHART_COLORS.length];
        this.colorIndex++;

        this.webviewProvider?.postMessage({
            type: 'addVariable',
            path: path,
            color: color
        });

        this.startCollecting();
    }

    public removeVariable(path: string): void {
        this.chartVariables = this.chartVariables.filter(p => p !== path);
        void this.persistVariables();

        if (this.chartVariables.length === 0) {
            this.stopCollecting();
        }
    }

    public getChartedVariables(): string[] {
        return [...this.chartVariables];
    }

    public startCollecting(): void {
        if (this.chartVariables.length === 0) return;

        this.stopCollecting();
        this.collectTimer = setInterval(() => {
            void this.collectData();
        }, this.collectInterval);
    }

    public stopCollecting(): void {
        if (this.collectTimer) {
            clearInterval(this.collectTimer);
            this.collectTimer = null;
        }
    }

    public updateInterval(interval: number): void {
        this.collectInterval = interval;
        if (this.collectTimer) {
            this.startCollecting();
        }
    }

    public setPaused(paused: boolean): void {
        this.paused = paused;
    }

    public clearData(): void {
        // Webview 侧处理清空
    }

    public setTimeWindow(_seconds: number): void {
        // Webview 侧处理时间窗口
    }

    public handleWebviewMessage(msg: any): void {
        switch (msg.type) {
            case 'ready':
                // Webview 就绪，同步当前变量列表
                this.syncVariablesToWebview();
                break;
            case 'addVariable':
                void this.addVariableFromInput();
                break;
            case 'removeVariable':
                this.removeVariable(msg.path);
                break;
            case 'pause':
                this.setPaused(true);
                break;
            case 'resume':
                this.setPaused(false);
                break;
            case 'clear':
                this.clearData();
                break;
            case 'setInterval':
                this.updateInterval(msg.value);
                break;
            default:
                break;
        }
    }

    public async restoreVariables(): Promise<void> {
        this.chartVariables = this.workspaceState.get<string[]>(CHART_VARIABLES_KEY, []);
    }

    public dispose(): void {
        this.stopCollecting();
    }

    private async collectData(): Promise<void> {
        if (this.isCollecting || this.paused || !this.serverClient.isRunning()) {
            return;
        }
        if (this.chartVariables.length === 0) {
            return;
        }

        this.isCollecting = true;

        try {
            const results = await this.serverClient.readPaths(this.chartVariables);
            const data = results.map(r => ({
                path: r.path,
                value: typeof r.value === 'number' ? r.value : parseFloat(r.value) || 0
            }));

            this.webviewProvider?.postMessage({
                type: 'dataUpdate',
                data: data
            });
        } catch (error) {
            console.warn('Chart data collection failed:', error);
        } finally {
            this.isCollecting = false;
        }
    }

    private async addVariableFromInput(): Promise<void> {
        if (!this.serverClient.isRunning()) {
            vscode.window.showErrorMessage('Server not running. Start debug session first.');
            return;
        }

        const input = await vscode.window.showInputBox({
            placeHolder: 'Enter variable name (e.g., pid_output, sensor.temperature)',
            prompt: 'Enter the variable name to plot'
        });

        if (input && input.trim()) {
            await this.addVariable(input.trim());
        }
    }

    private async persistVariables(): Promise<void> {
        await this.workspaceState.update(CHART_VARIABLES_KEY, this.chartVariables);
    }

    private syncVariablesToWebview(): void {
        for (let i = 0; i < this.chartVariables.length; i++) {
            const path = this.chartVariables[i];
            const color = CHART_COLORS[i % CHART_COLORS.length];
            this.webviewProvider?.postMessage({
                type: 'addVariable',
                path: path,
                color: color
            });
        }
    }
}
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit src/chartManager.ts
```

Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/chartManager.ts
git commit -m "feat: 添加 ChartManager 数据管理器"
```

---

### Task 6: 修改 package.json — 注册命令、面板、配置

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 在 commands 数组末尾添加两个新命令**

在 `"stm32-live-watch.showBottomPanel"` 之后添加：

```json
{
    "command": "stm32-live-watch.addToChart",
    "title": "STM32 Live Watch: Add to Chart",
    "icon": "$(graph)"
},
{
    "command": "stm32-live-watch.showChartPanel",
    "title": "STM32 Live Watch: Show Chart Panel",
    "icon": "$(graph)"
}
```

- [ ] **Step 2: 在 contributes 中添加 viewsContainers.panel**

在 `"viewsContainers"` 中添加 `"panel"` 数组：

```json
"viewsContainers": {
    "activitybar": [
        {
            "id": "stm32-debug-panel",
            "title": "STM32 Live Watch",
            "icon": "resources/icon.svg"
        }
    ],
    "panel": [
        {
            "id": "stm32-chart-container",
            "title": "STM32 Variable Chart",
            "icon": "resources/icon.svg"
        }
    ]
}
```

- [ ] **Step 3: 在 views 中添加图表面板**

```json
"views": {
    "stm32-debug-panel": [
        {
            "id": "stm32-debug-variables-panel",
            "name": "1. stm32livewatch实时变量查看",
            "icon": "resources/icon.svg"
        },
        {
            "id": "stm32-debug-operations-panel",
            "name": "2. 操作",
            "icon": "resources/icon.svg"
        }
    ],
    "stm32-chart-container": [
        {
            "type": "webview",
            "id": "stm32-debug-chart-panel",
            "name": "Variable Chart"
        }
    ]
}
```

- [ ] **Step 4: 在 menus.view/item/context 中添加 addToChart 菜单项**

在已有的 context 菜单数组末尾添加：

```json
{
    "command": "stm32-live-watch.addToChart",
    "when": "view == stm32-debug-variables-panel && viewItem =~ /^rootVariable/",
    "group": "navigation"
}
```

- [ ] **Step 5: 在 menus.view/title 中添加图表面板工具栏按钮**

```json
{
    "command": "stm32-live-watch.addToChart",
    "when": "view == stm32-debug-chart-panel",
    "group": "navigation@1"
}
```

- [ ] **Step 6: 在 configuration.properties 中添加图表配置**

```json
"stm32LiveWatch.chartRefreshInterval": {
    "type": "number",
    "default": 100,
    "minimum": 50,
    "description": "Chart data refresh interval in milliseconds (minimum 50ms)"
},
"stm32LiveWatch.chartTimeWindow": {
    "type": "number",
    "default": 10,
    "minimum": 5,
    "description": "Chart time window in seconds"
}
```

- [ ] **Step 7: 验证 package.json 语法正确**

```bash
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 8: 提交**

```bash
git add package.json
git commit -m "feat: 注册图表面板命令、视图容器和配置项"
```

---

### Task 7: 修改 extension.ts — 集成图表模块

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: 添加 import**

在文件顶部 import 区域添加：

```typescript
import { ChartManager } from './chartManager';
import { ChartViewProvider } from './chartPanel';
```

- [ ] **Step 2: 在 activate 函数中创建 ChartManager 和 ChartViewProvider**

在 `const operationsTreeDataProvider = new OperationsTreeDataProvider();` 之后添加：

```typescript
const chartManager = new ChartManager(serverClient, context.workspaceState);
const chartViewProvider = new ChartViewProvider(context.extensionUri, (msg) => chartManager.handleWebviewMessage(msg));
chartManager.attachWebview(chartViewProvider);
```

- [ ] **Step 3: 注册 WebviewView Provider**

在 `const operationsTreeView = ...` 之后添加：

```typescript
const chartViewDisposable = vscode.window.registerWebviewViewProvider(
    ChartViewProvider.viewType,
    chartViewProvider
);
```

- [ ] **Step 4: 注册 addToChart 命令**

在 `const showBottomPanelCommand = ...` 之后添加：

```typescript
const addToChartCommand = vscode.commands.registerCommand('stm32-live-watch.addToChart', async (item?: VariableTreeItem) => {
    const targetItem = getSelectedVariableItem(item, panelTreeView, lastSelectedVariableItem);
    if (!targetItem) {
        // 无选中项，打开输入框
        await chartManager.addVariable('');
        return;
    }
    await chartManager.addVariable(targetItem.variableInfo.path);
});

const showChartPanelCommand = vscode.commands.registerCommand('stm32-live-watch.showChartPanel', () => {
    vscode.commands.executeCommand('stm32-debug-chart-panel.focus');
});
```

- [ ] **Step 5: 在 debug 启动时恢复图表变量**

在 `debugStartDisposable` 的回调中，`ensureServerRunning` 之后添加：

```typescript
const debugStartDisposable = vscode.debug.onDidStartDebugSession((session) => {
    if (session.type !== 'cortex-debug') {
        return;
    }
    void ensureServerRunning(false).then(() => {
        void chartManager.restoreVariables().then(() => {
            chartManager.startCollecting();
        });
    });
});
```

- [ ] **Step 6: 监听图表配置变化**

在 `configChangeDisposable` 中添加图表配置监听：

```typescript
const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (affectsLiveWatchConfig(event, 'refreshInterval')) {
        const newInterval = getConfigValue<number>('refreshInterval', 250);
        variableTreeDataProvider.updateRefreshInterval(newInterval);
    }
    if (affectsLiveWatchConfig(event, 'chartRefreshInterval')) {
        const newInterval = getConfigValue<number>('chartRefreshInterval', 100);
        chartManager.updateInterval(newInterval);
    }
});
```

- [ ] **Step 7: 添加到 subscriptions**

在 `context.subscriptions.push(...)` 中添加：

```typescript
chartViewDisposable,
addToChartCommand,
showChartPanelCommand,
```

- [ ] **Step 8: 在 deactivate 中清理**

```typescript
export function deactivate() {
    if (serverClient) {
        serverClient.stop();
    }
    if (chartManager) {
        chartManager.dispose();
    }
}
```

注意：需要将 `chartManager` 提升到模块级变量。

- [ ] **Step 9: 编译验证**

```bash
npm run compile
```

Expected: 无错误

- [ ] **Step 10: 提交**

```bash
git add src/extension.ts
git commit -m "feat: 集成 ChartManager 和 ChartViewProvider 到扩展入口"
```

---

### Task 8: 修改 variableTreeDataProvider.ts — 右键菜单支持

**Files:**
- Modify: `src/variableTreeDataProvider.ts`

- [ ] **Step 1: 确认 contextValue 已匹配 addToChart 的 when 条件**

检查 `VariableTreeItem` 的 `buildContextValue()` 方法。当前逻辑：

```typescript
if (this.isRoot) {
    return this.variableInfo.hasChildren 
        ? `rootVariableWithChildren${typeSuffix}` 
        : 'rootVariable';
}
```

`package.json` 中 `addToChart` 的 when 条件是 `viewItem =~ /^rootVariable/`。

`rootVariable` 和 `rootVariableWithChildren` 都以 `rootVariable` 开头，正则匹配通过。无需修改。

- [ ] **Step 2: 验证编译通过**

```bash
npm run compile
```

Expected: 无错误

- [ ] **Step 3: 提交（如有修改）**

如果无需修改，跳过此步骤。

---

### Task 9: 端到端测试与调优

- [ ] **Step 1: 启动 VS Code 扩展开发宿主**

按 F5 启动 Extension Development Host。

- [ ] **Step 2: 验证面板注册**

确认底部面板区域出现 "STM32 Variable Chart" 标签页，内有 "+ Add" / "⏸ Pause" / "🗑 Clear" 按钮和下拉框。

- [ ] **Step 3: 验证右键菜单**

在监视面板中右键一个 rootVariable 类型的变量，确认菜单中出现 "Add to Chart" 选项。

- [ ] **Step 4: 验证手动添加**

点击图表面板的 "+ Add" 按钮，输入变量名，确认图例中出现该变量。

- [ ] **Step 5: 验证数据采集**

启动 Cortex-Debug 调试会话，确认图表面板开始绘制折线。

- [ ] **Step 6: 验证交互功能**

- 悬停图表，确认 tooltip 显示精确值
- 滚轮缩放时间轴
- 点击 "⏸ Pause"，确认图表冻结
- 点击 "▶ Resume"，确认图表恢复
- 点击 "🗑 Clear"，确认数据清空
- 切换 Window 下拉框，确认时间窗口变化
- 切换 Interval 下拉框，确认刷新频率变化
- 点击图例 ✕，确认变量移除

- [ ] **Step 7: 性能验证**

添加 5 个变量，100ms 刷新，观察 CPU 占用是否合理（应 < 5%）。

- [ ] **Step 8: 最终提交**

```bash
git add -A
git commit -m "feat: 变量图表查看模块完成，支持实时折线图、悬停、缩放、暂停"
```
