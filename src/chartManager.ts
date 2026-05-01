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
