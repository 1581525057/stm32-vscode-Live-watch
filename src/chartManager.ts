// src/chartManager.ts
// 图表数据管理器：变量列表、独立定时器、Webview 通信

import * as vscode from 'vscode';
import { getConfigValue } from './config';
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
    private colorMap = new Map<string, string>(); // path -> color，保证颜色分配一致
    private webviewProvider: ChartViewProvider | undefined;

    constructor(
        private serverClient: ServerClient,
        private workspaceState: vscode.Memento
    ) {
        this.collectInterval = getConfigValue<number>('chartRefreshInterval', 100);
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
        this.colorMap.set(path, color);

        this.webviewProvider?.postMessage({
            type: 'addVariable',
            path: path,
            color: color
        });

        this.startCollecting();
    }

    public removeVariable(path: string): void {
        this.chartVariables = this.chartVariables.filter(p => p !== path);
        this.colorMap.delete(path);
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
        // 同步 colorIndex，避免新添加变量时颜色与已恢复变量冲突
        this.colorIndex = this.chartVariables.length;
        // 为恢复的变量分配颜色（与 syncVariablesToWebview 一致）
        this.chartVariables.forEach((path, i) => {
            if (!this.colorMap.has(path)) {
                this.colorMap.set(path, CHART_COLORS[i % CHART_COLORS.length]);
            }
        });
    }

    public notifyThemeChanged(): void {
        this.webviewProvider?.postMessage({ type: 'themeChanged' });
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
        // 面板不可见时跳过数据采集，节省后端请求
        if (!this.webviewProvider?.isVisible()) {
            return;
        }

        this.isCollecting = true;

        try {
            // 5 秒超时，防止数据采集请求永久挂起
            let timeoutId: ReturnType<typeof setTimeout>;
            let timedOut = false;
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => { timedOut = true; reject(new Error('collectData timeout')); }, 5000);
            });
            const readPathsPromise = this.serverClient.readPaths(this.chartVariables)
                .then(r => { clearTimeout(timeoutId!); return r; })
                .catch(err => { clearTimeout(timeoutId!); if (!timedOut) { throw err; } return []; });
            const results = await Promise.race([readPathsPromise, timeoutPromise]);
            const data = results.map(r => ({
                path: r.path,
                value: typeof r.value === 'number' ? r.value : parseFloat(r.value) || 0
            }));

            this.webviewProvider?.postMessage({
                type: 'dataUpdate',
                data: data
            });
        } catch (error) {
            console.error('Chart data collection error:', error);
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
            const color = this.colorMap.get(path) || CHART_COLORS[i % CHART_COLORS.length];
            this.webviewProvider?.postMessage({
                type: 'addVariable',
                path: path,
                color: color
            });
        }
    }
}
