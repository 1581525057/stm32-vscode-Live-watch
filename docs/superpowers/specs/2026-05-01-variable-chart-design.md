# 变量图表查看模块设计文档

## 概述

为 STM32 Live Watch 扩展新增第三个模块——变量图表查看（Variable Chart）。用户可以从监视面板选择变量或手动输入变量名，将其绘制在底部面板的实时折线图中，用于观察变量随时间的变化趋势，辅助 PID 调参、信号分析等调试场景。

## 需求总结

| 项目 | 决策 |
|------|------|
| 图表类型 | 实时折线图（多线叠加） |
| 面板位置 | 底部面板 WebviewView |
| 数据窗口 | 固定时间窗口，默认 10 秒，可选 5s/10s/30s/60s |
| 添加变量 | 右键菜单 "Add to Chart" + 图表面板内手动输入 |
| 刷新频率 | 图表独立刷新通道，可配置（50ms/100ms/250ms），默认 100ms |
| 交互功能 | 悬停显示精确值 + 鼠标滚轮缩放时间轴 + 清除历史 + 暂停/继续 |
| 渲染库 | Chart.js |
| 后端修改 | 无，复用现有 ServerClient.readPaths() |

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────┐
│           VS Code 扩展层 (TypeScript)                │
│                                                     │
│  VariableTreeDataProvider   OperationsTreeDataProvider│
│  (监视面板，已有)            (操作面板，已有)           │
│                                                     │
│  ChartManager ★ 新增                                 │
│  - 管理图表变量列表                                    │
│  - 独立 setInterval 数据采集                          │
│  - 调用 ServerClient.readPaths()                     │
│  - 通过 postMessage 发送数据给 Webview                │
│                                                     │
│  ServerClient (已有，不修改)                          │
│  - JSON stdin/stdout IPC                             │
│  - readPaths() 批量读取变量值                         │
└──────────────────────┬──────────────────────────────┘
                       │ postMessage (JSON)
┌──────────────────────┴──────────────────────────────┐
│           Webview 层 (底部面板)                       │
│                                                     │
│  ChartPanel (WebviewView) ★ 新增                     │
│  - Chart.js 折线图渲染                               │
│  - 工具栏：Add / Pause / Clear / Window / Interval   │
│  - 图例：变量名 + 当前值 + 删除按钮                    │
│  - 交互：悬停 tooltip + 滚轮缩放                      │
│  - 接收扩展侧数据，维护本地时间序列缓存                 │
└──────────────────────┬──────────────────────────────┘
                       │ ServerClient.readPaths()
┌──────────────────────┴──────────────────────────────┐
│           后端层 (已有，不修改)                        │
│                                                     │
│  server.py → OpenOCD TCL RPC → STM32 目标板内存       │
└─────────────────────────────────────────────────────┘
```

### 数据流

```
用户操作                扩展侧                    Webview 侧
─────────────────────────────────────────────────────────────
右键变量 "Add to Chart"  → ChartManager.addVariable()
                          → 发送 {type:'addVariable', info} → Chart.js 添加数据集
                          → 启动/继续定时器

定时器触发 (100ms)       → ChartManager.collectData()
                          → ServerClient.readPaths(paths)
                          → 返回 ReadResult[]
                          → 发送 {type:'dataUpdate', data} → Chart.js 追加数据点
                                                            → 超出窗口的旧点自动丢弃

用户点击 Pause           → postMessage {type:'pause'}    → ChartManager 暂停定时器
用户点击 Clear           → postMessage {type:'clear'}    → Chart.js 清空所有数据
用户调整 Window          → postMessage {type:'window', value:30} → 调整时间窗口
用户点击图例 ✕           → postMessage {type:'remove', path}     → ChartManager 移除变量
```

## 新增文件

### 1. `src/chartManager.ts` — 图表数据管理器

职责：
- 管理图表变量列表（增删查）
- 独立定时器，按配置间隔调用 `ServerClient.readPaths()`
- 将读取结果通过 `WebviewView.webview.postMessage()` 发送给 Webview
- 监听 Webview 回传的用户操作消息
- 持久化图表变量列表到 `workspaceState`

核心接口：

```typescript
class ChartManager {
    // 变量管理
    addVariable(path: string): Promise<void>
    removeVariable(path: string): void
    getChartedVariables(): string[]

    // 数据采集
    startCollecting(interval: number): void
    stopCollecting(): void
    updateInterval(interval: number): void

    // Webview 通信
    attachWebview(webviewView: vscode.WebviewView): void
    detachWebview(): void
}
```

### 2. `src/chartPanel.ts` — WebviewView Provider

职责：
- 实现 `WebviewViewProvider` 接口，注册为底部面板
- 创建 Webview HTML 内容（Chart.js + 自定义 UI）
- 处理 Webview 的 `resolveWebviewView` 生命周期
- 配置 Webview 的 `options`（enableScripts, localResourceRoots）

核心接口：

```typescript
class ChartViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'stm32-debug-chart-panel'

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: WebviewViewResolveContext,
        token: CancellationToken
    ): void
}
```

### 3. `src/webview/chart.js` — Webview 侧 Chart.js 渲染

职责：
- 初始化 Chart.js 折线图实例
- 监听 `message` 事件接收扩展侧数据
- 维护本地时间序列数据数组（每个变量一个数组）
- 实现悬停 tooltip、滚轮缩放
- 向扩展侧发送用户操作消息

### 4. `resources/chart.html` — Webview HTML 模板

包含：
- Chart.js CDN 引用（打包到扩展内，不依赖外部网络）
- 工具栏 HTML
- 图例区域
- Canvas 元素
- chart.js 脚本引用

## 修改文件

### 1. `package.json`

新增贡献点：

```json
{
    "commands": [
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
    ],
    "views": {
        "stm32-debug-panel": [
            // ... 已有两个 view
        ]
    },
    "viewsContainers": {
        "panel": [
            {
                "id": "stm32-chart-container",
                "title": "STM32 Chart",
                "icon": "resources/icon.svg"
            }
        ]
    },
    "menus": {
        "view/item/context": [
            {
                "command": "stm32-live-watch.addToChart",
                "when": "view == stm32-debug-variables-panel && viewItem =~ /^rootVariable/",
                "group": "navigation"
            }
        ]
    },
    "configuration": {
        "properties": {
            "stm32LiveWatch.chartRefreshInterval": {
                "type": "number",
                "default": 100,
                "minimum": 50,
                "description": "Chart refresh interval in milliseconds (minimum 50ms)"
            },
            "stm32LiveWatch.chartTimeWindow": {
                "type": "number",
                "default": 10,
                "description": "Chart time window in seconds"
            }
        }
    }
}
```

### 2. `src/extension.ts`

新增：
- 实例化 `ChartManager` 和 `ChartViewProvider`
- 注册 `addToChart` 命令（从右键菜单添加变量到图表）
- 注册 `showChartPanel` 命令
- 将 `ChartManager` 传递给 `ChartViewProvider`
- 在 `deactivate` 中清理图表资源
- 监听 `chartRefreshInterval` 配置变化

### 3. `src/variableTreeDataProvider.ts`

新增：
- 在 `VariableTreeItem` 的 `contextValue` 中确保 rootVariable 类型可以被 `addToChart` 命令匹配

## 颜色方案

Chart.js 数据集自动分配颜色，使用 Catppuccin 调色板与 VS Code 深色主题一致：

```typescript
const CHART_COLORS = [
    '#89b4fa', // blue
    '#a6e3a1', // green
    '#f9e2af', // yellow
    '#f38ba8', // red
    '#cba6f7', // purple
    '#94e2d5', // teal
    '#fab387', // peach
    '#74c7ec', // sapphire
    '#f5c2e7', // pink
    '#b4befe', // lavender
];
```

## 性能考虑

- **批量读取**：复用 `ServerClient.readPaths()` 一次性读取所有图表变量，避免多次 IPC
- **数据裁剪**：Webview 侧维护固定长度数组，超出时间窗口的数据点自动 shift
- **增量更新**：每次只发送新增的数据点，不重传全部历史
- **postMessage 频率**：100ms 间隔，每次消息体约 100-500 bytes，无性能瓶颈
- **Chart.js 配置**：禁用动画（`animation: false`）以适配高频更新；使用 `decimation` 降低渲染点数

## 测试策略

1. **单元测试**：`ChartManager` 的变量增删、定时器启停逻辑
2. **集成测试**：手动在 VS Code 中启动扩展，验证：
   - 右键变量 "Add to Chart" 是否正常
   - 图表面板是否正确显示折线
   - Pause/Resume/Clear 是否工作
   - 时间窗口切换是否正确裁剪数据
   - 悬停 tooltip 和缩放是否正常
3. **性能测试**：同时图表 5+ 个变量，100ms 刷新，观察 CPU 和内存占用

## 实现顺序

1. `src/chartPanel.ts` + `resources/chart.html` + `src/webview/chart.js` — 基础 Webview 框架 + Chart.js 渲染
2. `src/chartManager.ts` — 数据采集 + Webview 通信
3. `package.json` 修改 — 注册命令、面板、配置
4. `src/extension.ts` 修改 — 集成 ChartManager 和 ChartViewProvider
5. `src/variableTreeDataProvider.ts` 修改 — 右键菜单 "Add to Chart"
6. Chart.js 打包 — 将 chart.min.js 复制到 resources/ 目录
7. 测试 + 调优
