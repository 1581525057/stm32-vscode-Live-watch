// src/chartManager.ts
// 图表数据管理器：变量列表、统一轮询调度器、Webview 通信

import * as vscode from 'vscode';
import { getConfigValue } from './config';
import { ServerClient } from './serverClient';
import { ReadResult } from './models/variable';
import { PollScheduler } from './pollScheduler';
import { ChartViewProvider } from './chartPanel';
import { ChartPage, loadChartPages, persistChartPages, MAX_PAGES, MAX_PAGE_NAME_LENGTH, createDefaultChartPage } from './models/page';

// 高对比度调色板 - 与 chart.js 中保持一致
const CHART_COLORS = [
    '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7',
    '#06b6d4', '#f97316', '#8b5cf6', '#ec4899', '#14b8a6'
];

export class ChartManager {
    private pages: ChartPage[] = [];
    private activePageIndex = 0;
    private collectInterval = 100;
    private paused = false;
    private colorIndex = 0;
    private webviewProvider: ChartViewProvider | undefined;

    constructor(
        private serverClient: ServerClient,
        private workspaceState: vscode.Memento,
        private pollScheduler: PollScheduler
    ) {
        this.collectInterval = getConfigValue<number>('chartRefreshInterval', 100);
    }

    public attachWebview(provider: ChartViewProvider): void {
        this.webviewProvider = provider;
    }

    public detachWebview(): void {
        this.webviewProvider = undefined;
    }

    // 当前活动页面快捷访问
    get activePage(): ChartPage {
        return this.pages[this.activePageIndex] || this.pages[0];
    }

    get pageCount(): number {
        return this.pages.length;
    }

    get activePageIndexValue(): number {
        return this.activePageIndex;
    }

    async switchToPage(index: number): Promise<void> {
        if (index < 0 || index >= this.pages.length || index === this.activePageIndex) {
            return;
        }
        this.activePageIndex = index;
        await persistChartPages(this.workspaceState, this.pages, this.activePage.id);

        // 通知 webview 切换页面
        this.webviewProvider?.postMessage({
            type: 'switchPage',
            pageIndex: index,
            pages: this.pages.map(p => ({ id: p.id, name: p.name }))
        });

        // 重新同步当前页面的变量
        this.syncVariablesToWebview();
    }

    async addPage(): Promise<void> {
        if (this.pages.length >= MAX_PAGES) {
            vscode.window.showWarningMessage(`最多支持 ${MAX_PAGES} 个页面`);
            return;
        }

        const name = await vscode.window.showInputBox({
            prompt: '输入图表页面名称',
            placeHolder: '例如: Motor, Sensor',
            validateInput: (value) => {
                if (!value.trim()) return '名称不能为空';
                if (value.trim().length > MAX_PAGE_NAME_LENGTH) return `名称最长 ${MAX_PAGE_NAME_LENGTH} 个字符`;
                return null;
            }
        });

        if (!name) return;

        const newPage = createDefaultChartPage(name.trim());
        this.pages.push(newPage);
        this.activePageIndex = this.pages.length - 1;
        await persistChartPages(this.workspaceState, this.pages, newPage.id);

        this.webviewProvider?.postMessage({
            type: 'switchPage',
            pageIndex: this.activePageIndex,
            pages: this.pages.map(p => ({ id: p.id, name: p.name }))
        });
    }

    async renamePage(): Promise<void> {
        const page = this.activePage;
        const name = await vscode.window.showInputBox({
            prompt: '输入新的图表页面名称',
            value: page.name,
            validateInput: (value) => {
                if (!value.trim()) return '名称不能为空';
                if (value.trim().length > MAX_PAGE_NAME_LENGTH) return `名称最长 ${MAX_PAGE_NAME_LENGTH} 个字符`;
                return null;
            }
        });

        if (!name || name.trim() === page.name) return;

        page.name = name.trim();
        await persistChartPages(this.workspaceState, this.pages, page.id);

        this.webviewProvider?.postMessage({
            type: 'updatePageList',
            pages: this.pages.map(p => ({ id: p.id, name: p.name }))
        });
    }

    async deletePage(pageIndex?: number): Promise<void> {
        if (this.pages.length <= 1) {
            vscode.window.showWarningMessage('至少保留一个图表页面');
            return;
        }

        const targetIndex = pageIndex !== undefined ? pageIndex : this.activePageIndex;
        if (targetIndex < 0 || targetIndex >= this.pages.length) {
            return;
        }

        const page = this.pages[targetIndex];
        const confirm = await vscode.window.showWarningMessage(
            `确定删除图表页面 "${page.name}" 及其所有变量？`,
            '删除', '取消'
        );

        if (confirm !== '删除') return;

        this.pages.splice(targetIndex, 1);
        if (this.activePageIndex >= this.pages.length) {
            this.activePageIndex = this.pages.length - 1;
        } else if (this.activePageIndex > targetIndex) {
            this.activePageIndex--;
        }
        await persistChartPages(this.workspaceState, this.pages, this.activePage.id);

        this.webviewProvider?.postMessage({
            type: 'switchPage',
            pageIndex: this.activePageIndex,
            pages: this.pages.map(p => ({ id: p.id, name: p.name }))
        });
    }

    public async addVariable(path: string): Promise<void> {
        const page = this.activePage;
        if (page.variablePaths.includes(path)) {
            return;
        }

        // 验证变量存在
        try {
            await this.serverClient.describe(path);
        } catch (error) {
            vscode.window.showErrorMessage(`Variable not found: ${path}`);
            return;
        }

        page.variablePaths.push(path);

        const color = CHART_COLORS[this.colorIndex % CHART_COLORS.length];
        this.colorIndex++;
        page.colorMap[path] = color;

        await persistChartPages(this.workspaceState, this.pages, page.id);

        this.webviewProvider?.postMessage({
            type: 'addVariable',
            path: path,
            color: color
        });

        this.startCollecting();
    }

    public removeVariable(path: string): void {
        const page = this.activePage;
        page.variablePaths = page.variablePaths.filter(p => p !== path);
        delete page.colorMap[path];

        void persistChartPages(this.workspaceState, this.pages, page.id);

        if (page.variablePaths.length === 0) {
            this.stopCollecting();
        }
    }

    public getChartedVariables(): string[] {
        return [...this.activePage.variablePaths];
    }

    /**
     * 注册图表轮询源并启动调度器
     */
    public startCollecting(): void {
        if (this.activePage.variablePaths.length === 0) return;

        this.pollScheduler.registerSource({
            name: 'chart',
            getPaths: () => this.getPathsToCollect(),
            interval: this.collectInterval,
            onResults: (results) => this.processCollectedData(results)
        });
        this.pollScheduler.start();
    }

    /**
     * 注销图表轮询源
     */
    public stopCollecting(): void {
        this.pollScheduler.unregisterSource('chart');
    }

    public updateInterval(interval: number): void {
        this.collectInterval = interval;
        this.pollScheduler.updateInterval('chart', interval);
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
                void this.restoreVariables().then(() => {
                    this.syncVariablesToWebview();
                });
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
            case 'switchPage':
                void this.switchToPage(msg.pageIndex);
                break;
            case 'addPage':
                void this.addPage();
                break;
            case 'renamePage':
                void this.renamePage();
                break;
            case 'deletePage':
                void this.deletePage(msg.pageIndex);
                break;
            default:
                break;
        }
    }

    public async restoreVariables(): Promise<void> {
        const { pages, activeId } = loadChartPages(this.workspaceState);
        this.pages = pages;
        this.activePageIndex = pages.findIndex(p => p.id === activeId);
        if (this.activePageIndex < 0) this.activePageIndex = 0;

        this.colorIndex = 0;
        for (const page of this.pages) {
            this.colorIndex += page.variablePaths.length;
        }

        // 通知 webview 页面列表
        this.webviewProvider?.postMessage({
            type: 'updatePageList',
            pages: this.pages.map(p => ({ id: p.id, name: p.name })),
            activeIndex: this.activePageIndex
        });
    }

    public notifyThemeChanged(): void {
        this.webviewProvider?.postMessage({ type: 'themeChanged' });
    }

    public dispose(): void {
        this.stopCollecting();
    }

    /**
     * 获取当前需要采集的变量路径列表
     * 暂停、服务器未运行、面板不可见时返回空数组
     */
    private getPathsToCollect(): string[] {
        if (this.paused || !this.serverClient.isRunning()) {
            return [];
        }
        if (!this.webviewProvider?.isVisible()) {
            return [];
        }
        return [...this.activePage.variablePaths];
    }

    /**
     * 处理采集到的数据并发送给 webview
     */
    private processCollectedData(results: ReadResult[]): void {
        if (results.length === 0) {
            return;
        }
        const data = results.map(r => ({
            path: r.path,
            value: typeof r.value === 'number' ? r.value : parseFloat(r.value) || 0
        }));
        this.webviewProvider?.postMessage({
            type: 'dataUpdate',
            data: data
        });
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

    private syncVariablesToWebview(): void {
        const page = this.activePage;
        // 先通知 webview 清除旧数据
        this.webviewProvider?.postMessage({ type: 'clearPage' });

        for (let i = 0; i < page.variablePaths.length; i++) {
            const path = page.variablePaths[i];
            const color = page.colorMap[path] || CHART_COLORS[i % CHART_COLORS.length];
            this.webviewProvider?.postMessage({
                type: 'addVariable',
                path: path,
                color: color
            });
        }
    }
}
