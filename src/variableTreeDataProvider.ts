import * as vscode from 'vscode';
import * as path from 'path';
import { getConfigValue } from './config';
import { VariableInfo, ReadResult } from './models/variable';
import { ServerClient, ConnectionState } from './serverClient';
import { PollScheduler } from './pollScheduler';
import { WatchPage, loadWatchPages, persistWatchPages, MAX_PAGES, MAX_PAGE_NAME_LENGTH, createDefaultWatchPage } from './models/page';

// 拖拽功能：自定义 MIME 类型和数据格式
const DRAG_MIME_TYPE = 'application/vnd.stm32livewatch.variable';

interface DragData {
    path: string;
    isRoot: boolean;
    sourceIndex: number;
}

interface StaleValue {
    value: any;
    timestamp: number;
}

export class VariableTreeItem extends vscode.TreeItem {
    constructor(
        public readonly variableInfo: VariableInfo,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly isRoot: boolean,
        public readonly value?: any,
        public readonly isStale: boolean = false,
        public readonly staleTimestamp?: number
    ) {
        super(VariableTreeItem.buildLabel(variableInfo, value, isRoot, isStale), collapsibleState);

        this.description = this.buildDescription();
        this.tooltip = this.buildTooltip();
        this.contextValue = this.buildContextValue();
        this.command = this.buildCommand();
        this.iconPath = VariableTreeItem.buildIcon(variableInfo, isStale);
    }

    // 容器符号映射：不同类型使用不同括号
    private static containerSymbols: Record<string, [string, string]> = {
        struct: ['{', '}'],
        class:  ['{', '}'],
        array:  ['[', ']'],
        union:  ['{', '}'],
    };

    // 使用自定义 SVG 图标（resources/icons/），带语义化形状和配色
    private static buildIcon(info: VariableInfo, isStale: boolean): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
        const iconsRoot = path.join(__dirname, '..', 'resources', 'icons');
        const iconMap: Record<string, string> = {
            struct: 'struct.svg', class: 'class.svg', array: 'array.svg',
            union:  'union.svg',  string: 'string.svg', enum: 'enum.svg',
        };

        // 过时数据使用灰色图标
        if (isStale) {
            return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground'));
        }

        if (info.hasChildren) {
            const file = iconMap[info.type] || 'misc.svg';
            return {
                light: vscode.Uri.file(path.join(iconsRoot, file)),
                dark:  vscode.Uri.file(path.join(iconsRoot, file)),
            };
        }
        if (info.type === 'string' || info.type === 'enum') {
            return {
                light: vscode.Uri.file(path.join(iconsRoot, iconMap[info.type])),
                dark:  vscode.Uri.file(path.join(iconsRoot, iconMap[info.type])),
            };
        }
        return {
            light: vscode.Uri.file(path.join(iconsRoot, 'variable.svg')),
            dark:  vscode.Uri.file(path.join(iconsRoot, 'variable.svg')),
        };
    }

    private static buildLabel(variableInfo: VariableInfo, value: any, isRoot: boolean, isStale: boolean): string {
        // 提取的子变量（路径含 '.'）显示完整路径，原始根变量用短名称
        const displayName = (isRoot && variableInfo.path.includes('.'))
            ? variableInfo.path
            : variableInfo.name;

        if (variableInfo.hasChildren) {
            const [open, close] = VariableTreeItem.containerSymbols[variableInfo.type] || ['{', '}'];
            return `${displayName} ${open} ··· ${close}`;
        }

        if (value !== undefined && value !== null) {
            const valueText = variableInfo.type === 'string' ? `"${value}"` : String(value);
            const staleIndicator = isStale ? ' [过时]' : '';
            return `${displayName} = ${valueText}${staleIndicator}`;
        }

        if (isStale) {
            return `${displayName} = 未连接`;
        }

        return `${displayName} = ?`;
    }

    // 描述区域：类型名 + Badge 标签（struct / array / class / union）
    private buildDescription(): string {
        const typeName = this.variableInfo.typeName || '';

        if (!this.variableInfo.hasChildren) {
            if (this.isStale) {
                return typeName ? `${typeName} [过时]` : '[过时]';
            }
            return typeName;
        }

        const badge = this.variableInfo.type ? this.variableInfo.type.toUpperCase() : '';
        const staleBadge = this.isStale ? ' [过时]' : '';
        return typeName && badge ? `${typeName}  ${badge}${staleBadge}` : typeName || badge;
    }

    /** 格式化相对时间 */
    private formatRelativeTime(timestamp: number): string {
        const now = Date.now();
        const diff = now - timestamp;

        if (diff < 60000) {
            return `${Math.floor(diff / 1000)}秒前`;
        } else if (diff < 3600000) {
            return `${Math.floor(diff / 60000)}分钟前`;
        } else {
            return `${Math.floor(diff / 3600000)}小时前`;
        }
    }

    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${this.variableInfo.name}**\n\n`);
        md.appendMarkdown(`- **Path:** \`${this.variableInfo.path}\`\n`);
        md.appendMarkdown(`- **Type:** \`${this.variableInfo.typeName || this.variableInfo.type}\`\n`);
        md.appendMarkdown(`- **Address:** \`${this.variableInfo.address}\`\n`);
        md.appendMarkdown(`- **Size:** \`${this.variableInfo.size} bytes\`\n`);

        if (this.value !== undefined) {
            md.appendMarkdown(`- **Value:** \`${this.value}\`\n`);
        }

        if (this.isStale && this.staleTimestamp) {
            const relativeTime = this.formatRelativeTime(this.staleTimestamp);
            md.appendMarkdown(`- **Status:** ⚠️ 过时数据 (最后更新于 ${relativeTime})\n`);
        }

        return md;
    }

    private buildContextValue(): string {
        // 如果是字符串类型，无论是否有子节点，都赋予专门的标识符
        const typeSuffix = this.variableInfo.type === 'string' ? 'String' : '';
        
        if (this.isRoot) {
            return this.variableInfo.hasChildren 
                ? `rootVariableWithChildren${typeSuffix}` 
                : 'rootVariable';
        }
        return this.variableInfo.hasChildren 
            ? `variableWithChildren${typeSuffix}` 
            : 'variable';
    }

    private buildCommand(): vscode.Command | undefined {
        if (this.variableInfo.hasChildren && this.variableInfo.type !== 'string') {
            return undefined;
        }

        return {
            command: 'stm32-live-watch.editVariable',
            title: 'Edit Variable Value',
            arguments: [this]
        };
    }
}

export class WaitingTreeItem extends vscode.TreeItem {
    constructor() {
        super('Waiting for debug session...', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('debug-pause');
        this.contextValue = 'waitingForDebugSession';
    }
}

export class AddVariableTreeItem extends vscode.TreeItem {
    constructor() {
        super('+ Add Variable to Watch', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('add');
        this.contextValue = 'addVariable';
        this.command = {
            command: 'stm32-live-watch.addVariable',
            title: 'Add Variable'
        };
    }
}

export class OperationTreeItem extends vscode.TreeItem {
    constructor(label: string, icon: string, command: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'operation';
        this.iconPath = new vscode.ThemeIcon(icon);
        this.command = {
            command,
            title: label
        };
    }
}

export class InfoTreeItem extends vscode.TreeItem {
    constructor(label: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'info';
        this.iconPath = new vscode.ThemeIcon('info');
    }
}

export class VariableTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.TreeDragAndDropController<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // TreeDragAndDropController 接口实现
    readonly dragMimeTypes = [DRAG_MIME_TYPE];
    readonly dropMimeTypes = [DRAG_MIME_TYPE];

    private rootVariables: VariableInfo[] = [];
    private allVariables: Map<string, VariableInfo> = new Map();
    private valueCache: Map<string, any> = new Map();
    private childrenCache: Map<string, VariableInfo[]> = new Map(); // 缓存 listChildren 结果，避免每 250ms 重复 RPC
    private staleValueCache: Map<string, StaleValue> = new Map(); // 过时数据缓存
    private cachedPathsToRead: string[] = []; // 缓存的可读路径列表，避免每轮重新计算
    private pathsDirty = true; // 路径缓存是否需要重建

    // 缓存容量上限，防止无限增长
    private static readonly MAX_STALE_CACHE_SIZE = 500;
    private static readonly MAX_CHILDREN_CACHE_SIZE = 200;

    // 多页面状态
    private pages: WatchPage[] = [];
    private activePageIndex = 0;

    private refreshInterval = 250;
    private _disposed = false;

    constructor(
        private serverClient: ServerClient,
        private workspaceState: vscode.Memento,
        private pollScheduler: PollScheduler
    ) {
        this.refreshInterval = getConfigValue<number>('refreshInterval', 250);

        // 监听连接状态变化
        this.serverClient.onConnectionStateChanged(() => {
            this.refresh();
        });
    }

    // 获取当前活动页面
    get activePage(): WatchPage {
        return this.pages[this.activePageIndex] || this.pages[0];
    }

    get pageCount(): number {
        return this.pages.length;
    }

    get activePageDisplay(): string {
        return `${this.activePageIndex + 1}/${this.pages.length}`;
    }

    // 切换到指定页面
    async switchToPage(index: number): Promise<void> {
        if (index < 0 || index >= this.pages.length || index === this.activePageIndex) {
            return;
        }
        this.activePageIndex = index;
        await this.loadCurrentPageVariables();
        await persistWatchPages(this.workspaceState, this.pages, this.activePage.id);
    }

    async switchToPrevPage(): Promise<void> {
        if (this.activePageIndex > 0) {
            await this.switchToPage(this.activePageIndex - 1);
        }
    }

    async switchToNextPage(): Promise<void> {
        if (this.activePageIndex < this.pages.length - 1) {
            await this.switchToPage(this.activePageIndex + 1);
        }
    }

    // 添加新页面
    async addPage(): Promise<void> {
        if (this.pages.length >= MAX_PAGES) {
            vscode.window.showWarningMessage(`最多支持 ${MAX_PAGES} 个页面`);
            return;
        }

        const name = await vscode.window.showInputBox({
            prompt: '输入页面名称',
            placeHolder: '例如: Motor, Sensor, PID',
            validateInput: (value) => {
                if (!value.trim()) return '名称不能为空';
                if (value.trim().length > MAX_PAGE_NAME_LENGTH) return `名称最长 ${MAX_PAGE_NAME_LENGTH} 个字符`;
                return null;
            }
        });

        if (!name) return;

        const newPage = createDefaultWatchPage(name.trim());
        this.pages.push(newPage);
        this.activePageIndex = this.pages.length - 1;
        this.rootVariables = [];
        this.allVariables.clear();
        this.valueCache.clear();
        this.childrenCache.clear();
        this.stopAutoRefresh();
        await persistWatchPages(this.workspaceState, this.pages, newPage.id);
        this.refresh();
    }

    // 重命名当前页面
    async renamePage(): Promise<void> {
        const page = this.activePage;
        const name = await vscode.window.showInputBox({
            prompt: '输入新的页面名称',
            value: page.name,
            validateInput: (value) => {
                if (!value.trim()) return '名称不能为空';
                if (value.trim().length > MAX_PAGE_NAME_LENGTH) return `名称最长 ${MAX_PAGE_NAME_LENGTH} 个字符`;
                return null;
            }
        });

        if (!name || name.trim() === page.name) return;

        page.name = name.trim();
        await persistWatchPages(this.workspaceState, this.pages, page.id);
        this.refresh();
    }

    // 删除当前页面
    async deletePage(): Promise<void> {
        if (this.pages.length <= 1) {
            vscode.window.showWarningMessage('至少保留一个页面');
            return;
        }

        const page = this.activePage;
        const confirm = await vscode.window.showWarningMessage(
            `确定删除页面 "${page.name}" 及其所有监视变量？`,
            '删除', '取消'
        );

        if (confirm !== '删除') return;

        this.pages.splice(this.activePageIndex, 1);
        if (this.activePageIndex >= this.pages.length) {
            this.activePageIndex = this.pages.length - 1;
        }
        await this.loadCurrentPageVariables();
        await persistWatchPages(this.workspaceState, this.pages, this.activePage.id);
    }

    // 加载当前页面的变量
    private async loadCurrentPageVariables(): Promise<void> {
        const page = this.activePage;
        this.rootVariables = [];
        this.allVariables.clear();
        this.valueCache.clear();
        this.childrenCache.clear();

        if (page.watchedPaths.length === 0) {
            this.stopAutoRefresh();
            this.refresh();
            return;
        }

        // 并行调用 describe
        const results = await Promise.allSettled(
            page.watchedPaths.map(p => this.serverClient.describe(p))
        );

        for (let i = 0; i < page.watchedPaths.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled' && result.value) {
                this.rootVariables.push(result.value);
                this.registerVariables([result.value]);
            }
        }

        if (this.rootVariables.length > 0) {
            this.startAutoRefresh();
        } else {
            this.stopAutoRefresh();
        }

        this.refresh();
    }

    refresh(): void {
        if (this._disposed) {
            return;
        }
        this._onDidChangeTreeData.fire();
    }

    handleDrag(source: readonly vscode.TreeItem[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void {
        const item = source[0];
        if (!(item instanceof VariableTreeItem)) {
            return;
        }

        const isRoot = item.isRoot;
        const sourceIndex = isRoot
            ? this.rootVariables.findIndex(v => v.path === item.variableInfo.path)
            : -1;

        const dragData: DragData = {
            path: item.variableInfo.path,
            isRoot,
            sourceIndex
        };

        dataTransfer.set(DRAG_MIME_TYPE, new vscode.DataTransferItem(JSON.stringify(dragData)));
    }

    async handleDrop(target: vscode.TreeItem | undefined, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
        const item = dataTransfer.get(DRAG_MIME_TYPE);
        if (!item) {
            return;
        }

        let dragData: DragData;
        try {
            dragData = JSON.parse(await item.value) as DragData;
        } catch {
            return;
        }

        // 计算目标插入位置
        let targetIndex = this.rootVariables.length; // 默认追加到末尾
        if (target instanceof VariableTreeItem && target.isRoot) {
            targetIndex = this.rootVariables.findIndex(v => v.path === target.variableInfo.path);
            if (targetIndex === -1) {
                targetIndex = this.rootVariables.length;
            }
        }

        if (dragData.isRoot) {
            // 排序：移动根变量
            this.moveRootVariable(dragData.sourceIndex, targetIndex);
        } else {
            // 提取：将子成员添加为新的根变量（支持任何类型，包括结构体、类、数组）
            await this.extractAsRootVariable(dragData.path, targetIndex);
        }
    }

    private moveRootVariable(fromIndex: number, toIndex: number): void {
        if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= this.rootVariables.length) {
            return;
        }

        const [moved] = this.rootVariables.splice(fromIndex, 1);
        // 调整目标索引：如果从前面移到后面，索引需要减 1
        const insertIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
        this.rootVariables.splice(insertIndex, 0, moved);

        void this.persistWatchedPaths();
        this.refresh();
    }

    private async extractAsRootVariable(path: string, insertIndex: number): Promise<void> {
        // 检查是否已存在
        if (this.rootVariables.some(v => v.path === path)) {
            vscode.window.showInformationMessage(`Variable already watched: ${path}`);
            return;
        }

        try {
            const variableInfo = await this.serverClient.describe(path);
            if (variableInfo) {
                this.rootVariables.splice(insertIndex, 0, variableInfo);
                this.registerVariables([variableInfo]);
                await this.persistWatchedPaths();

                this.startAutoRefresh();
                this.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add variable: ${error}`);
        }
    }

    updateRefreshInterval(interval: number): void {
        this.refreshInterval = interval;
        this.pollScheduler.updateInterval('variableTree', interval);
    }

    clearValueCache(): void {
        this.valueCache.clear();
        this.refresh();
    }

    /**
     * 注册轮询源并启动调度器
     */
    startAutoRefresh(): void {
        this.pollScheduler.registerSource({
            name: 'variableTree',
            getPaths: () => this.getPathsToRead(),
            interval: this.refreshInterval,
            onResults: (results) => this.processReadResults(results)
        });
        this.pollScheduler.start();
    }

    /**
     * 注销轮询源
     */
    stopAutoRefresh(): void {
        this.pollScheduler.unregisterSource('variableTree');
    }

    /**
     * 获取当前需要读取的变量路径列表
     * 只返回可直接读写的普通变量（非结构体/数组容器）
     */
    private getPathsToRead(): string[] {
        if (!this.serverClient.isRunning() || this.allVariables.size === 0) {
            return [];
        }
        // 仅在变量列表变化时重建路径缓存
        if (this.pathsDirty) {
            const paths: string[] = [];
            for (const [path, variable] of this.allVariables) {
                if (!variable.hasChildren) {
                    paths.push(path);
                }
            }
            this.cachedPathsToRead = paths;
            this.pathsDirty = false;
        }
        return this.cachedPathsToRead;
    }

    /**
     * 处理读取结果：更新缓存并在值变化时触发 UI 重绘
     */
    private processReadResults(results: ReadResult[]): void {
        let hasChanges = false;
        const now = Date.now();

        for (const result of results) {
            const previousValue = this.valueCache.get(result.path);
            if (result.value === null || result.value === undefined) {
                // 读取失败：移除缓存条目，下轮轮询自动重试
                if (this.valueCache.has(result.path)) {
                    this.valueCache.delete(result.path);
                    hasChanges = true;
                }
            } else {
                if (previousValue !== result.value) {
                    hasChanges = true;
                }
                this.valueCache.set(result.path, result.value);

                // 更新过时数据缓存（排除 N/A），超过上限时清理最旧的一半
                if (result.value !== undefined && result.value !== null && result.value !== 'N/A') {
                    if (this.staleValueCache.size >= VariableTreeDataProvider.MAX_STALE_CACHE_SIZE) {
                        const evictCount = VariableTreeDataProvider.MAX_STALE_CACHE_SIZE / 2;
                        let evicted = 0;
                        for (const key of this.staleValueCache.keys()) {
                            if (evicted >= evictCount) break;
                            this.staleValueCache.delete(key);
                            evicted++;
                        }
                    }
                    this.staleValueCache.set(result.path, {
                        value: result.value,
                        timestamp: now
                    });
                }
            }
        }

        if (hasChanges) {
            this.refresh();
        }
    }

    /**
     * 一次性手动刷新（用于写入值后验证等场景）
     */
    private async refreshValues(): Promise<void> {
        if (!this.serverClient.isRunning() || this.allVariables.size === 0) {
            return;
        }

        const pathsToRead = this.getPathsToRead();
        if (pathsToRead.length === 0) {
            return;
        }

        try {
            const results = await this.serverClient.readPaths(pathsToRead);
            this.processReadResults(results);
        } catch (error) {
            console.warn('Manual refresh failed:', error);
        }
    }

    /** 获取过时数据（包含时间戳） */
    getStaleValue(path: string): StaleValue | undefined {
        return this.staleValueCache.get(path);
    }

    /** 清除过时数据缓存 */
    clearStaleValueCache(): void {
        this.staleValueCache.clear();
    }

    private registerVariables(variables: VariableInfo[]): void {
        for (const variable of variables) {
            this.allVariables.set(variable.path, variable);
        }
        this.pathsDirty = true;
    }

    private rebuildVariableIndex(): void {
        this.allVariables.clear();
        this.registerVariables(this.rootVariables);
    }

    private getWatchedPaths(): string[] {
        return this.rootVariables.map(variable => variable.path);
    }

    private async persistWatchedPaths(): Promise<void> {
        // 将当前根变量路径同步到活动页面
        this.activePage.watchedPaths = this.rootVariables.map(v => v.path);
        await persistWatchPages(this.workspaceState, this.pages, this.activePage.id);
    }

    private isRootVariablePath(path: string): boolean {
        return this.rootVariables.some(variable => variable.path === path);
    }

    /**
     * 查找子变量的父变量路径
     * 子变量路径格式：parentPath.member 或 parentPath[index]
     */
    private findParentPath(childPath: string): string | null {
        // 尝试匹配根变量路径前缀
        for (const rootVar of this.rootVariables) {
            const rootPath = rootVar.path;
            // 检查 childPath 是否以 rootPath 开头，且后面跟着 . 或 [
            if (childPath.startsWith(rootPath)) {
                const rest = childPath.slice(rootPath.length);
                if (rest.startsWith('.') || rest.startsWith('[')) {
                    return rootPath;
                }
            }
        }
        // 如果找不到根变量，尝试在 allVariables 中查找
        for (const [path, info] of this.allVariables) {
            if (info.hasChildren && childPath.startsWith(path)) {
                const rest = childPath.slice(path.length);
                if (rest.startsWith('.') || rest.startsWith('[')) {
                    return path;
                }
            }
        }
        return null;
    }

    async loadRootVariables(): Promise<void> {
        // 加载页面数据（含旧版迁移）
        const { pages, activeId } = loadWatchPages(this.workspaceState);
        this.pages = pages;
        this.activePageIndex = pages.findIndex(p => p.id === activeId);
        if (this.activePageIndex < 0) this.activePageIndex = 0;

        await this.loadCurrentPageVariables();
    }

    async addVariable(path: string): Promise<void> {
        const normalizedPath = path.trim();
        if (!normalizedPath) return;

        if (this.isRootVariablePath(normalizedPath)) {
            vscode.window.showInformationMessage(`Variable already being watched: ${normalizedPath}`);
            return;
        }

        try {
            const variableInfo = await this.serverClient.describe(normalizedPath);
            if (variableInfo) {
                this.rootVariables.push(variableInfo);
                this.registerVariables([variableInfo]);
                await this.persistWatchedPaths();

                // 添加成功后启动刷新（幂等，重复调用安全）
                this.startAutoRefresh();
                this.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add variable: ${error}`);
        }
    }

    async editVariableValue(item: VariableTreeItem): Promise<void> {
        // 【安全检查】：禁止编辑结构体或数组容器本身
        if (item.variableInfo.hasChildren && item.variableInfo.type !== 'string') {
            vscode.window.showWarningMessage('Cannot directly edit a structure or array. Please edit its members.');
            return;
        }

        const currentValue = this.valueCache.get(item.variableInfo.path);
        let initialValue = currentValue !== undefined ? String(currentValue) : '';

        // 🔥 修复点：正则匹配 "78 ('N')" 这种格式，剔除提示字符，只保留纯数字
        const charMatch = initialValue.match(/^(\-?\d+)\s*\('.*'\)$/);
        if (charMatch) {
            initialValue = charMatch[1];
        }

        const input = await vscode.window.showInputBox({
            placeHolder: 'e.g., 42, 0x2A, 3.14',
            prompt: `Set new value for ${item.variableInfo.path}`,
            value: initialValue // 使用剥离后的纯数字
        });

        if (input === undefined || input.trim() === '') return;

        try {
            await this.serverClient.writeValue(item.variableInfo.path, input.trim());
            // 乐观更新 UI (如果是 char，下次刷新会自动带上新字符，不用担心)
            this.valueCache.set(item.variableInfo.path, input.trim());
            this.refresh();
            
            // 稍微延迟后主动刷新一次确保底层真正写入成功
            setTimeout(() => {
                void this.refreshValues();
            }, 200);
        } catch (error) {
            vscode.window.showErrorMessage(`Write failed for ${item.variableInfo.path}: ${error}`);
        }
    }

    async renameVariable(item: VariableTreeItem): Promise<void> {
        if (!item.isRoot) {
            vscode.window.showInformationMessage('Only root variables can be renamed.');
            return;
        }

        const input = await vscode.window.showInputBox({
            placeHolder: 'Enter new variable name or path',
            prompt: `Edit expression for ${item.variableInfo.path}`,
            value: item.variableInfo.path
        });

        if (input === undefined) return;
        const nextPath = input.trim();
        if (!nextPath || nextPath === item.variableInfo.path) return;

        if (this.isRootVariablePath(nextPath)) {
            vscode.window.showErrorMessage(`Variable already exists: ${nextPath}`);
            return;
        }

        try {
            const variableInfo = await this.serverClient.describe(nextPath);
            if (!variableInfo) {
                vscode.window.showErrorMessage(`Variable not found in ELF: ${nextPath}`);
                return;
            }

            this.rootVariables = this.rootVariables.map(variable =>
                variable.path === item.variableInfo.path ? variableInfo : variable
            );

            // 重新构建索引以防内存泄漏
            this.rebuildVariableIndex();
            this.valueCache.delete(item.variableInfo.path);
            this.childrenCache.delete(item.variableInfo.path);
            await this.persistWatchedPaths();
            this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Rename failed: ${error}`);
        }
    }

    async deleteVariable(item: VariableTreeItem): Promise<void> {
        if (!item.isRoot) {
            // 对于子变量，找到其父变量并移除
            const childPath = item.variableInfo.path;
            // 查找父变量：子变量路径格式为 parentPath.member 或 parentPath[index]
            const parentPath = this.findParentPath(childPath);
            if (parentPath) {
                // 从父变量的缓存中移除该子变量
                this.childrenCache.delete(parentPath);
                // 从 allVariables 中移除
                this.allVariables.delete(childPath);
                this.valueCache.delete(childPath);
                this.refresh();
                vscode.window.showInformationMessage(`Removed child variable: ${childPath}`);
            }
            return;
        }

        this.rootVariables = this.rootVariables.filter(variable => variable.path !== item.variableInfo.path);

        // 清除子节点缓存：精确匹配路径或匹配子路径
        for (const key of this.childrenCache.keys()) {
            if (key === item.variableInfo.path || key.startsWith(item.variableInfo.path + '.') || key.startsWith(item.variableInfo.path + '[')) {
                this.childrenCache.delete(key);
            }
        }

        this.rebuildVariableIndex();

        // 清理值缓存：精确匹配路径或匹配子路径（以 '.' 或 '[' 分隔）
        for (const key of this.valueCache.keys()) {
            if (key === item.variableInfo.path || key.startsWith(item.variableInfo.path + '.') || key.startsWith(item.variableInfo.path + '[')) {
                this.valueCache.delete(key);
            }
        }

        // 清理过时数据缓存
        for (const key of this.staleValueCache.keys()) {
            if (key === item.variableInfo.path || key.startsWith(item.variableInfo.path + '.') || key.startsWith(item.variableInfo.path + '[')) {
                this.staleValueCache.delete(key);
            }
        }

        await this.persistWatchedPaths();

        if (this.rootVariables.length === 0) {
            this.stopAutoRefresh();
        }

        this.refresh();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!element) {
            if (!this.serverClient.isRunning()) {
                return [new WaitingTreeItem()];
            }

            const items: vscode.TreeItem[] = [];

            // 页面信息项（多页时显示，VS Code 原生风格）
            if (this.pages.length > 1) {
                // 圆点指示器：当前页用实心圆，其他页用空心圆
                const dots = this.pages.map((_, i) =>
                    i === this.activePageIndex ? '●' : '○'
                ).join('');
                const varCount = this.activePage.watchedPaths.length;
                const pageInfo = new vscode.TreeItem(
                    this.activePage.name,
                    vscode.TreeItemCollapsibleState.None
                );
                pageInfo.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.foreground'));
                pageInfo.contextValue = 'pageInfo';
                pageInfo.description = `${dots}  ${this.activePageIndex + 1}/${this.pages.length} · ${varCount}`;
                pageInfo.tooltip = new vscode.MarkdownString(
                    `**${this.activePage.name}**\n\n` +
                    `- 页面: ${this.activePageIndex + 1} / ${this.pages.length}\n` +
                    `- 变量: ${varCount}\n` +
                    `- 状态: 活动中`
                );
                items.push(pageInfo);
            }

            if (this.rootVariables.length === 0) {
                items.push(new InfoTreeItem('No watched variables'));
            } else {
                items.push(...await this.createTreeItems(this.rootVariables, true));
            }

            return items;
        }

        if (element instanceof VariableTreeItem) {
            const path = element.variableInfo.path;
            // 优先使用缓存，避免每 250ms 刷新时重复 RPC
            let children = this.childrenCache.get(path);
            if (!children) {
                children = await this.serverClient.listChildren(path);
                if (children && children.length > 0) {
                    // 超过上限时清理最旧的一半
                    if (this.childrenCache.size >= VariableTreeDataProvider.MAX_CHILDREN_CACHE_SIZE) {
                        const evictCount = VariableTreeDataProvider.MAX_CHILDREN_CACHE_SIZE / 2;
                        let evicted = 0;
                        for (const key of this.childrenCache.keys()) {
                            if (evicted >= evictCount) break;
                            this.childrenCache.delete(key);
                            evicted++;
                        }
                    }
                    this.childrenCache.set(path, children);
                }
            }
            if (children && children.length > 0) {
                this.registerVariables(children);
                return this.createTreeItems(children, false);
            }
        }

        return [];
    }

    private async createTreeItems(variables: VariableInfo[], isRootLevel: boolean): Promise<VariableTreeItem[]> {
        const items: VariableTreeItem[] = [];
        const pathsToRead: string[] = [];

        // 【关键修复 3】：只在初次展开时，主动读取可直接显示的普通变量值。
        for (const variable of variables) {
            if (!variable.hasChildren && !this.valueCache.has(variable.path)) {
                pathsToRead.push(variable.path);
            }
        }

        if (pathsToRead.length > 0) {
            try {
                const results = await this.serverClient.readPaths(pathsToRead);
                for (const result of results) {
                    // null/undefined 表示读取失败，不缓存以免污染
                    if (result.value !== null && result.value !== undefined) {
                        this.valueCache.set(result.path, result.value);
                        // 更新过时缓存
                        this.staleValueCache.set(result.path, {
                            value: result.value,
                            timestamp: Date.now()
                        });
                    }
                }
            } catch (error) {
                console.warn('Failed to pre-fetch values for newly expanded items:', error);
            }
        }

        const isConnected = this.serverClient.getConnectionState() === ConnectionState.Connected;

        for (const variable of variables) {
            const collapsibleState = variable.hasChildren
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;

            const value = this.valueCache.get(variable.path);
            const staleValue = this.staleValueCache.get(variable.path);

            // 判断是否为过时数据
            const isStale = !isConnected && staleValue !== undefined;
            const displayValue = isConnected ? value : staleValue?.value;
            const staleTimestamp = isStale ? staleValue?.timestamp : undefined;

            items.push(new VariableTreeItem(variable, collapsibleState, isRootLevel, displayValue, isStale, staleTimestamp));
        }

        return items;
    }

    async updateValue(path: string, newValue: any): Promise<void> {
        this.valueCache.set(path, newValue);
        this.refresh();
    }

    dispose(): void {
        this._disposed = true;
        this.stopAutoRefresh();
        this._onDidChangeTreeData.dispose();
    }
}

export class OperationsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // 当前连接状态
    private connectionState: ConnectionState = ConnectionState.Disconnected;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /** 更新连接状态并刷新树 */
    updateConnectionState(state: ConnectionState): void {
        if (this.connectionState !== state) {
            this.connectionState = state;
            this.refresh();
        }
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
        if (element) {
            return [];
        }

        // 顶部状态行
        const statusItem = this.buildStatusItem();

        return [
            statusItem,
            new OperationTreeItem('Configure ELF Path', 'file-code', 'stm32-live-watch.configureElfPath'),
            new OperationTreeItem('Generate ELF from AXF', 'tools', 'stm32-live-watch.generateElf')
        ];
    }

    private buildStatusItem(): vscode.TreeItem {
        const item = new vscode.TreeItem('连接状态', vscode.TreeItemCollapsibleState.None);
        item.contextValue = 'connectionStatus';

        switch (this.connectionState) {
            case ConnectionState.Connected:
                item.label = '$(circle-filled) 已连接';
                item.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
                item.description = 'OpenOCD';
                break;
            case ConnectionState.Reconnecting:
                item.label = '$(sync~spin) 重连中...';
                item.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('testing.iconQueued'));
                item.description = '';
                break;
            case ConnectionState.Disconnected:
            default:
                item.label = '$(circle-outline) 未连接';
                item.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconFailed'));
                item.description = '';
                break;
        }

        // 点击触发重连
        item.command = {
            command: 'stm32-live-watch.reconnectServer',
            title: '重新连接'
        };

        return item;
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}
