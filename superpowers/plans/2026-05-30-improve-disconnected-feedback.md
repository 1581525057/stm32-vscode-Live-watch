<!-- hyperspec change: improve-disconnected-feedback -->
# Improve Disconnected Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复变量显示 N/A 的问题，当服务器未连接时显示最后已知值并标注为过时数据，同时实现自动+手动结合的重连机制

**Architecture:** 在 ServerClient 中添加连接状态管理和自动重连逻辑，在 VariableTreeDataProvider 中添加过时数据缓存和显示逻辑，通过事件机制驱动 UI 更新

**Tech Stack:** TypeScript, VSCode Extension API, Node.js Timer

---

## File Structure

- `src/serverClient.ts` - 添加连接状态枚举、状态事件、自动重连逻辑
- `src/variableTreeDataProvider.ts` - 添加过时数据缓存、修改显示逻辑
- `src/extension.ts` - 注册重连命令、状态栏按钮
- `package.json` - 添加重连命令和配置项

---

### Task 1: 连接状态枚举和事件定义

**Files:**
- Modify: `src/serverClient.ts`

- [x] **Step 1: 添加连接状态枚举（Task 1）**

在 `src/serverClient.ts` 文件顶部添加连接状态枚举：

```typescript
export enum ConnectionState {
    Disconnected = 'disconnected',
    Connected = 'connected',
    Reconnecting = 'reconnecting'
}
```

- [x] **Step 2: 添加状态变化事件接口（Task 1）**

在 ServerClient 类中添加事件定义：

```typescript
export class ServerClient {
    private process: ChildProcess | null = null;
    private buffer = '';
    private activeRequest: { resolve: Function; reject: Function } | null = null;
    private requestQueue: Promise<any> = Promise.resolve();
    private _onClose: (() => void) | null = null;
    private stoppingIntentionally = false;

    // 新增：连接状态和事件
    private _connectionState: ConnectionState = ConnectionState.Disconnected;
    private _onConnectionStateChanged: vscode.EventEmitter<ConnectionState> = new vscode.EventEmitter<ConnectionState>();
    readonly onConnectionStateChanged: vscode.Event<ConnectionState> = this._onConnectionStateChanged.event;
```

- [x] **Step 3: 添加状态查询方法（Task 1）**

在 ServerClient 类中添加状态查询方法：

```typescript
    /** 获取当前连接状态 */
    getConnectionState(): ConnectionState {
        return this._connectionState;
    }

    /** 更新连接状态并触发事件 */
    private updateConnectionState(state: ConnectionState): void {
        if (this._connectionState !== state) {
            this._connectionState = state;
            this._onConnectionStateChanged.fire(state);
        }
    }
```

- [x] **Step 4: 修改 start 方法更新状态（Task 1）**

修改 `start` 方法，在成功启动时更新状态：

```typescript
    async start(elfPath: string, host: string = '127.0.0.1', port: number = 50001): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.process) {
                resolve();
                return;
            }

            // ... 现有代码 ...

            setTimeout(() => {
                this.updateConnectionState(ConnectionState.Connected);
                resolve();
            }, 50);
        });
    }
```

- [x] **Step 5: 修改 stop 方法更新状态（Task 1）**

修改 `stopAsync` 方法，在停止时更新状态：

```typescript
    stopAsync(): Promise<void> {
        return new Promise<void>((resolve) => {
            const proc = this.process;
            if (!proc) {
                this.cleanupAfterStop();
                this.updateConnectionState(ConnectionState.Disconnected);
                resolve();
                return;
            }

            // ... 现有代码 ...

            proc.once('close', () => {
                clearTimeout(timeoutId);
                this.process = null;
                this.cleanupAfterStop();
                this.stoppingIntentionally = false;
                this.updateConnectionState(ConnectionState.Disconnected);
                resolve();
            });

            proc.kill();
        });
    }
```

- [x] **Step 6: 修改 close 回调更新状态（Task 1）**

修改 `process.on('close')` 回调：

```typescript
            this.process.on('close', (code) => {
                console.log('Server closed with code:', code);
                if (this.activeRequest) {
                    this.activeRequest.reject(new Error(`Server closed with code: ${code}`));
                    this.activeRequest = null;
                }
                this.process = null;
                this.updateConnectionState(ConnectionState.Disconnected);
                // 仅在非主动停止时触发关闭回调
                if (!this.stoppingIntentionally && this._onClose) {
                    this._onClose();
                }
            });
```

- [x] **Step 7: 编译验证（Task 1）**

运行编译命令验证代码正确：

```bash
npm run compile
```

预期：编译成功，无错误

- [x] **Step 8: 提交代码（Task 1）**

```bash
git add src/serverClient.ts
git commit -m "feat: add connection state enum and events to ServerClient"
```

---

### Task 2: 自动重连机制

**Files:**
- Modify: `src/serverClient.ts`
- Modify: `package.json`

- [x] **Step 1: 添加重连配置项（Task 2）**

在 `package.json` 的 `contributes.configuration.properties` 中添加：

```json
"stm32LiveWatch.reconnectInterval": {
    "type": "number",
    "default": 5000,
    "minimum": 1000,
    "description": "Auto-reconnect interval in milliseconds (minimum 1000ms)"
}
```

- [x] **Step 2: 添加重连定时器属性（Task 2）**

在 ServerClient 类中添加重连相关属性：

```typescript
export class ServerClient {
    private process: ChildProcess | null = null;
    private buffer = '';
    private activeRequest: { resolve: Function; reject: Function } | null = null;
    private requestQueue: Promise<any> = Promise.resolve();
    private _onClose: (() => void) | null = null;
    private stoppingIntentionally = false;

    // 连接状态和事件
    private _connectionState: ConnectionState = ConnectionState.Disconnected;
    private _onConnectionStateChanged: vscode.EventEmitter<ConnectionState> = new vscode.EventEmitter<ConnectionState>();
    readonly onConnectionStateChanged: vscode.Event<ConnectionState> = this._onConnectionStateChanged.event;

    // 新增：自动重连相关
    private reconnectTimer: NodeJS.Timeout | null = null;
    private reconnectInterval: number = 5000;
    private elfPath: string = '';
    private host: string = '127.0.0.1';
    private port: number = 50001;
```

- [x] **Step 3: 添加重连配置加载方法（Task 2）**

在 ServerClient 类中添加配置加载方法：

```typescript
    /** 加载重连配置 */
    loadReconnectConfig(): void {
        const config = vscode.workspace.getConfiguration('stm32LiveWatch');
        this.reconnectInterval = Math.max(1000, config.get<number>('reconnectInterval', 5000));
    }
```

- [x] **Step 4: 修改 start 方法保存连接参数（Task 2）**

修改 `start` 方法，保存连接参数用于重连：

```typescript
    async start(elfPath: string, host: string = '127.0.0.1', port: number = 50001): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.process) {
                resolve();
                return;
            }

            // 保存连接参数用于重连
            this.elfPath = elfPath;
            this.host = host;
            this.port = port;
            this.loadReconnectConfig();

            // ... 现有代码 ...
        });
    }
```

- [x] **Step 5: 实现自动重连方法（Task 2）**

在 ServerClient 类中添加自动重连方法：

```typescript
    /** 启动自动重连定时器 */
    startAutoReconnect(): void {
        if (this.reconnectTimer || this._connectionState === ConnectionState.Connected) {
            return;
        }

        this.updateConnectionState(ConnectionState.Reconnecting);

        this.reconnectTimer = setInterval(async () => {
            if (this._connectionState === ConnectionState.Connected) {
                this.stopAutoReconnect();
                return;
            }

            try {
                console.log('Attempting to reconnect...');
                await this.start(this.elfPath, this.host, this.port);
                console.log('Reconnected successfully');
                this.stopAutoReconnect();
            } catch (error) {
                console.warn('Reconnect failed:', error);
            }
        }, this.reconnectInterval);
    }

    /** 停止自动重连定时器 */
    stopAutoReconnect(): void {
        if (this.reconnectTimer) {
            clearInterval(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /** 更新重连间隔 */
    updateReconnectInterval(interval: number): void {
        this.reconnectInterval = Math.max(1000, interval);
        // 如果正在重连，重启定时器以使用新间隔
        if (this.reconnectTimer) {
            this.stopAutoReconnect();
            this.startAutoReconnect();
        }
    }
```

- [x] **Step 6: 修改 close 回调启动自动重连（Task 2）**

修改 `process.on('close')` 回调，在非主动停止时启动自动重连：

```typescript
            this.process.on('close', (code) => {
                console.log('Server closed with code:', code);
                if (this.activeRequest) {
                    this.activeRequest.reject(new Error(`Server closed with code: ${code}`));
                    this.activeRequest = null;
                }
                this.process = null;
                this.updateConnectionState(ConnectionState.Disconnected);

                // 仅在非主动停止时触发关闭回调并启动自动重连
                if (!this.stoppingIntentionally) {
                    if (this._onClose) {
                        this._onClose();
                    }
                    // 启动自动重连
                    if (this.elfPath) {
                        this.startAutoReconnect();
                    }
                }
            });
```

- [x] **Step 7: 修改 stop 方法停止自动重连（Task 2）**

修改 `stopAsync` 方法，在主动停止时停止自动重连：

```typescript
    stopAsync(): Promise<void> {
        return new Promise<void>((resolve) => {
            // 停止自动重连
            this.stopAutoReconnect();

            const proc = this.process;
            if (!proc) {
                this.cleanupAfterStop();
                this.updateConnectionState(ConnectionState.Disconnected);
                resolve();
                return;
            }

            // ... 现有代码 ...
        });
    }
```

- [x] **Step 8: 添加 dispose 方法清理资源（Task 2）**

在 ServerClient 类中添加 dispose 方法：

```typescript
    dispose(): void {
        this.stopAutoReconnect();
        this._onConnectionStateChanged.dispose();
    }
```

- [x] **Step 9: 编译验证（Task 2）**

运行编译命令验证代码正确：

```bash
npm run compile
```

预期：编译成功，无错误

- [x] **Step 10: 提交代码（Task 2）**

```bash
git add src/serverClient.ts package.json
git commit -m "feat: add auto-reconnect mechanism to ServerClient"
```

---

### Task 3: 过时数据缓存

**Files:**
- Modify: `src/variableTreeDataProvider.ts`

- [x] **Step 1: 添加过时数据接口和缓存（Task 3）**

在 `src/variableTreeDataProvider.ts` 文件顶部添加过时数据接口：

```typescript
interface StaleValue {
    value: any;
    timestamp: number;
}
```

在 VariableTreeDataProvider 类中添加缓存：

```typescript
export class VariableTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.TreeDragAndDropController<vscode.TreeItem> {
    // ... 现有属性 ...

    // 新增：过时数据缓存
    private staleValueCache: Map<string, StaleValue> = new Map();
```

- [x] **Step 2: 修改 processReadResults 更新过时缓存（Task 3）**

修改 `processReadResults` 方法，在读取成功时更新过时缓存：

```typescript
    private processReadResults(results: ReadResult[]): void {
        let hasChanges = false;
        const now = Date.now();

        for (const result of results) {
            const previousValue = this.valueCache.get(result.path);
            if (previousValue !== result.value) {
                hasChanges = true;
            }
            this.valueCache.set(result.path, result.value);

            // 更新过时数据缓存
            if (result.value !== undefined && result.value !== null) {
                this.staleValueCache.set(result.path, {
                    value: result.value,
                    timestamp: now
                });
            }
        }

        if (hasChanges) {
            this.refresh();
        }
    }
```

- [x] **Step 3: 添加获取过时数据方法（Task 3）**

在 VariableTreeDataProvider 类中添加获取过时数据的方法：

```typescript
    /** 获取过时数据（包含时间戳） */
    getStaleValue(path: string): StaleValue | undefined {
        return this.staleValueCache.get(path);
    }

    /** 清除过时数据缓存 */
    clearStaleValueCache(): void {
        this.staleValueCache.clear();
    }
```

- [x] **Step 4: 修改 deleteVariable 清理过时缓存（Task 3）**

修改 `deleteVariable` 方法，同时清理过时缓存：

```typescript
    async deleteVariable(item: VariableTreeItem): Promise<void> {
        // ... 现有代码 ...

        // 清理值缓存：精确匹配路径或匹配子路径
        for (const key of this.valueCache.keys()) {
            if (key === item.variableInfo.path || key.startsWith(item.variableInfo.path + '.') || key.startsWith(item.variableInfo.path + '[')) {
                this.valueCache.delete(key);
            }
        }

        // 新增：清理过时数据缓存
        for (const key of this.staleValueCache.keys()) {
            if (key === item.variableInfo.path || key.startsWith(item.variableInfo.path + '.') || key.startsWith(item.variableInfo.path + '[')) {
                this.staleValueCache.delete(key);
            }
        }

        // ... 现有代码 ...
    }
```

- [x] **Step 5: 编译验证（Task 3）**

运行编译命令验证代码正确：

```bash
npm run compile
```

预期：编译成功，无错误

- [x] **Step 6: 提交代码（Task 3）**

```bash
git add src/variableTreeDataProvider.ts
git commit -m "feat: add stale value cache to VariableTreeDataProvider"
```

---

### Task 4: 过时数据显示逻辑

**Files:**
- Modify: `src/variableTreeDataProvider.ts`

- [ ] **Step 1: 添加连接状态依赖（Task 4）**

修改 VariableTreeDataProvider 构造函数，添加 ServerClient 依赖和连接状态监听：

```typescript
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
```

- [ ] **Step 2: 添加时间格式化工具方法（Task 4）**

在 VariableTreeDataProvider 类中添加时间格式化方法：

```typescript
    /** 格式化相对时间 */
    private formatRelativeTime(timestamp: number): string {
        const now = Date.now();
        const diff = now - timestamp;

        if (diff < 60000) {
            // 小于 1 分钟
            return `${Math.floor(diff / 1000)}秒前`;
        } else if (diff < 3600000) {
            // 小于 1 小时
            return `${Math.floor(diff / 60000)}分钟前`;
        } else {
            // 大于 1 小时
            return `${Math.floor(diff / 3600000)}小时前`;
        }
    }
```

- [ ] **Step 3: 修改 buildLabel 方法处理过时数据（Task 4）**

修改 VariableTreeItem 的 `buildLabel` 静态方法，添加服务器状态参数：

```typescript
    private static buildLabel(variableInfo: VariableInfo, value: any, isStale: boolean): string {
        if (variableInfo.hasChildren) {
            const [open, close] = VariableTreeItem.containerSymbols[variableInfo.type] || ['{', '}'];
            return `${variableInfo.name} ${open} ··· ${close}`;
        }

        if (value !== undefined && value !== null) {
            const valueText = variableInfo.type === 'string' ? `"${value}"` : String(value);
            const staleIndicator = isStale ? ' [过时]' : '';
            return `${variableInfo.name} = ${valueText}${staleIndicator}`;
        }

        if (isStale) {
            return `${variableInfo.name} = 未连接`;
        }

        return `${variableInfo.name} = ?`;
    }
```

- [ ] **Step 4: 修改构造函数传递过时状态（Task 4）**

修改 VariableTreeItem 构造函数，添加 isStale 参数：

```typescript
export class VariableTreeItem extends vscode.TreeItem {
    constructor(
        public readonly variableInfo: VariableInfo,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly isRoot: boolean,
        public readonly value?: any,
        public readonly isStale: boolean = false
    ) {
        super(VariableTreeItem.buildLabel(variableInfo, value, isStale), collapsibleState);

        this.description = this.buildDescription();
        this.tooltip = this.buildTooltip();
        this.contextValue = this.buildContextValue();
        this.command = this.buildCommand();
        this.iconPath = VariableTreeItem.buildIcon(variableInfo, isStale);
    }
```

- [ ] **Step 5: 修改 buildDescription 方法（Task 4）**

修改 `buildDescription` 方法，添加过时标签：

```typescript
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
```

- [ ] **Step 6: 修改 buildTooltip 方法（Task 4）**

修改 `buildTooltip` 方法，添加最后更新时间：

```typescript
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
```

需要添加 `staleTimestamp` 属性和 `formatRelativeTime` 方法到 VariableTreeItem：

```typescript
export class VariableTreeItem extends vscode.TreeItem {
    constructor(
        public readonly variableInfo: VariableInfo,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly isRoot: boolean,
        public readonly value?: any,
        public readonly isStale: boolean = false,
        public readonly staleTimestamp?: number
    ) {
        // ... 现有代码 ...
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
```

- [ ] **Step 7: 修改 buildIcon 方法（Task 4）**

修改 `buildIcon` 方法，为过时数据使用灰色图标：

```typescript
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
```

- [ ] **Step 8: 修改 createTreeItems 传递过时状态（Task 4）**

修改 `createTreeItems` 方法，传递过时状态：

```typescript
    private async createTreeItems(variables: VariableInfo[], isRootLevel: boolean): Promise<VariableTreeItem[]> {
        const items: VariableTreeItem[] = [];
        const pathsToRead: string[] = [];

        // 只在初次展开时，主动读取可直接显示的普通变量值
        for (const variable of variables) {
            if (!variable.hasChildren && !this.valueCache.has(variable.path)) {
                pathsToRead.push(variable.path);
            }
        }

        if (pathsToRead.length > 0) {
            try {
                const results = await this.serverClient.readPaths(pathsToRead);
                for (const result of results) {
                    this.valueCache.set(result.path, result.value);
                    // 更新过时缓存
                    if (result.value !== undefined && result.value !== null) {
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
```

- [ ] **Step 9: 编译验证（Task 4）**

运行编译命令验证代码正确：

```bash
npm run compile
```

预期：编译成功，无错误

- [ ] **Step 10: 提交代码（Task 4）**

```bash
git add src/variableTreeDataProvider.ts
git commit -m "feat: implement stale value display with visual indicators"
```

---

### Task 5: 重连状态显示

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: 添加状态栏变量（Task 5）**

在 `src/extension.ts` 中添加状态栏变量：

```typescript
let statusBarItem: vscode.StatusBarItem;
```

- [ ] **Step 2: 创建状态栏项（Task 5）**

在 `activate` 函数中创建状态栏项：

```typescript
export function activate(context: vscode.ExtensionContext) {
    // ... 现有代码 ...

    // 创建状态栏项
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = '$(circle-outline) STM32 Live Watch';
    statusBarItem.tooltip = 'STM32 Live Watch Status';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // ... 现有代码 ...
}
```

- [ ] **Step 3: 添加连接状态监听（Task 5）**

在 `activate` 函数中添加连接状态监听：

```typescript
    // 监听连接状态变化
    serverClient.onConnectionStateChanged((state) => {
        updateStatusBar(state);
    });
```

- [ ] **Step 4: 实现状态栏更新函数（Task 5）**

添加状态栏更新函数：

```typescript
function updateStatusBar(state: ConnectionState): void {
    switch (state) {
        case ConnectionState.Connected:
            statusBarItem.text = '$(check) STM32 Live Watch';
            statusBarItem.tooltip = 'STM32 Live Watch - Connected';
            statusBarItem.color = undefined;
            break;
        case ConnectionState.Disconnected:
            statusBarItem.text = '$(circle-outline) STM32 Live Watch';
            statusBarItem.tooltip = 'STM32 Live Watch - Disconnected';
            statusBarItem.color = new vscode.ThemeColor('disabledForeground');
            break;
        case ConnectionState.Reconnecting:
            statusBarItem.text = '$(sync) STM32 Live Watch';
            statusBarItem.tooltip = 'STM32 Live Watch - Reconnecting...';
            statusBarItem.color = new vscode.ThemeColor('warningForeground');
            break;
    }
}
```

- [ ] **Step 5: 编译验证（Task 5）**

运行编译命令验证代码正确：

```bash
npm run compile
```

预期：编译成功，无错误

- [ ] **Step 6: 提交代码（Task 5）**

```bash
git add src/extension.ts
git commit -m "feat: add connection status display in status bar"
```

---

### Task 6: 手动重连功能

**Files:**
- Modify: `package.json`
- Modify: `src/extension.ts`
- Modify: `src/variableTreeDataProvider.ts`

- [ ] **Step 1: 添加重连命令定义（Task 6）**

在 `package.json` 的 `contributes.commands` 中添加：

```json
{
    "command": "stm32-live-watch.reconnectServer",
    "title": "STM32 Live Watch: Reconnect Server",
    "icon": "$(sync)"
}
```

- [ ] **Step 2: 添加重连按钮到视图标题栏（Task 6）**

在 `package.json` 的 `contributes.menus.view/title` 中添加：

```json
{
    "command": "stm32-live-watch.reconnectServer",
    "when": "view == stm32-debug-variables-panel && stm32LiveWatch.serverDisconnected",
    "group": "navigation@0"
}
```

- [ ] **Step 3: 注册重连命令（Task 6）**

在 `src/extension.ts` 的 `activate` 函数中注册重连命令：

```typescript
    // 注册重连命令
    const reconnectCmd = vscode.commands.registerCommand('stm32-live-watch.reconnectServer', async () => {
        try {
            vscode.window.showInformationMessage('Attempting to reconnect...');
            await serverClient.start(elfPath);
            vscode.window.showInformationMessage('Reconnected successfully!');
            variableTreeDataProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Reconnect failed: ${error}`);
        }
    });
    context.subscriptions.push(reconnectCmd);
```

- [ ] **Step 4: 更新连接状态上下文（Task 6）**

在 `updateStatusBar` 函数中更新上下文变量：

```typescript
function updateStatusBar(state: ConnectionState): void {
    // 更新上下文变量，控制重连按钮显示
    vscode.commands.executeCommand('setContext', 'stm32LiveWatch.serverDisconnected', state === ConnectionState.Disconnected);

    switch (state) {
        case ConnectionState.Connected:
            statusBarItem.text = '$(check) STM32 Live Watch';
            statusBarItem.tooltip = 'STM32 Live Watch - Connected';
            statusBarItem.color = undefined;
            break;
        case ConnectionState.Disconnected:
            statusBarItem.text = '$(circle-outline) STM32 Live Watch';
            statusBarItem.tooltip = 'STM32 Live Watch - Disconnected';
            statusBarItem.color = new vscode.ThemeColor('disabledForeground');
            break;
        case ConnectionState.Reconnecting:
            statusBarItem.text = '$(sync) STM32 Live Watch';
            statusBarItem.tooltip = 'STM32 Live Watch - Reconnecting...';
            statusBarItem.color = new vscode.ThemeColor('warningForeground');
            break;
    }
}
```

- [ ] **Step 5: 添加重连按钮到变量面板（Task 6）**

在 VariableTreeDataProvider 中添加重连按钮显示逻辑。修改 `getChildren` 方法：

```typescript
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!element) {
            if (!this.serverClient.isRunning()) {
                const items: vscode.TreeItem[] = [];

                // 添加重连提示项
                if (this.serverClient.getConnectionState() === ConnectionState.Reconnecting) {
                    items.push(new InfoTreeItem('正在重连...'));
                } else {
                    items.push(new InfoTreeItem('服务器未连接'));
                    items.push(new ReconnectTreeItem());
                }

                return items;
            }

            // ... 现有代码 ...
        }

        // ... 现有代码 ...
    }
```

- [ ] **Step 6: 添加 ReconnectTreeItem 类（Task 6）**

在 `src/variableTreeDataProvider.ts` 中添加重连按钮类：

```typescript
export class ReconnectTreeItem extends vscode.TreeItem {
    constructor() {
        super('点击重新连接', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('sync');
        this.contextValue = 'reconnect';
        this.command = {
            command: 'stm32-live-watch.reconnectServer',
            title: 'Reconnect Server'
        };
    }
}
```

- [ ] **Step 7: 编译验证（Task 6）**

运行编译命令验证代码正确：

```bash
npm run compile
```

预期：编译成功，无错误

- [ ] **Step 8: 提交代码（Task 6）**

```bash
git add package.json src/extension.ts src/variableTreeDataProvider.ts
git commit -m "feat: add manual reconnect button and command"
```

---

### Task 7: 配置变化监听

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: 添加配置变化监听（Task 7）**

在 `activate` 函数中添加配置变化监听：

```typescript
    // 监听配置变化
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('stm32LiveWatch.reconnectInterval')) {
            const config = vscode.workspace.getConfiguration('stm32LiveWatch');
            const interval = config.get<number>('reconnectInterval', 5000);
            serverClient.updateReconnectInterval(interval);
        }

        if (e.affectsConfiguration('stm32LiveWatch.refreshInterval')) {
            variableTreeDataProvider.updateRefreshInterval(getConfigValue<number>('refreshInterval', 250));
        }
    }));
```

- [ ] **Step 2: 编译验证（Task 7）**

运行编译命令验证代码正确：

```bash
npm run compile
```

预期：编译成功，无错误

- [ ] **Step 3: 提交代码（Task 7）**

```bash
git add src/extension.ts
git commit -m "feat: add configuration change listener for reconnect interval"
```

---

### Task 8: 集成测试验证

**Files:**
- None (manual testing)

- [ ] **Step 1: 测试断开连接时的过时数据显示（Task 8）**

1. 启动扩展
2. 添加变量并确保有值
3. 停止 OpenOCD 服务器
4. 验证：
   - 变量显示最后读取的值
   - 显示"[过时]"标签
   - 图标变为灰色
   - tooltip 显示最后更新时间

- [ ] **Step 2: 测试自动重连机制（Task 8）**

1. 启动扩展
2. 停止 OpenOCD 服务器
3. 验证：
   - 状态栏显示"重连中..."
   - 5 秒后自动尝试重连
   - 重连成功后状态恢复正常

- [ ] **Step 3: 测试手动重连功能（Task 8）**

1. 启动扩展
2. 停止 OpenOCD 服务器
3. 点击重连按钮
4. 验证：
   - 立即尝试重连
   - 显示重连结果通知
   - 重连成功后状态恢复正常

- [ ] **Step 4: 测试配置项变化（Task 8）**

1. 修改 `stm32LiveWatch.reconnectInterval` 配置
2. 验证：
   - 自动重连使用新的间隔
   - 最小间隔为 1 秒

- [ ] **Step 5: 最终编译验证（Task 8）**

运行编译命令验证所有代码正确：

```bash
npm run compile
```

预期：编译成功，无错误

- [ ] **Step 6: 提交所有更改（Task 8）**

```bash
git add -A
git commit -m "feat: complete disconnected feedback improvement"
```

---

## Summary

本计划实现了以下功能：

1. **连接状态管理**：在 ServerClient 中添加连接状态枚举和事件通知
2. **自动重连机制**：服务器断开后自动尝试重连，可配置间隔
3. **过时数据缓存**：保存最后读取的值和时间戳
4. **过时数据显示**：显示最后已知值，标注"过时"，灰色图标
5. **重连状态显示**：状态栏显示连接状态
6. **手动重连功能**：重连按钮和命令
7. **配置变化监听**：支持动态更新重连间隔

每个 Task 完成后都会进行编译验证，确保代码正确性。
