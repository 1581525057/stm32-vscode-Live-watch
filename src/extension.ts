import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { affectsLiveWatchConfig, getConfigValue, getLiveWatchConfig } from './config';
import { generateElfFromEideAxf, resolveElfPathWithAxf, ResolveElfResult } from './elfResolver';
import { ServerClient } from './serverClient';
import { PollScheduler } from './pollScheduler';
import { OperationsTreeDataProvider, VariableTreeDataProvider, VariableTreeItem } from './variableTreeDataProvider';
import { ChartManager } from './chartManager';
import { ChartViewProvider } from './chartPanel';
import { AxfWatcher } from './axfWatcher';

let serverClient: ServerClient;
let pollScheduler: PollScheduler;
let variableTreeDataProvider: VariableTreeDataProvider;
let operationsTreeDataProvider: OperationsTreeDataProvider;
let autoStartInProgress: Promise<void> | undefined;
let chartManager: ChartManager;

export function activate(context: vscode.ExtensionContext) {
    console.log('STM32 Live Watch is now active!');

    // 初始化服务器运行状态（防止窗口重载后 context 残留）
    vscode.commands.executeCommand('setContext', 'stm32LiveWatch.serverRunning', false);

    const serverScriptPath = resolveServerScriptPath(context.extensionPath);
    serverClient = new ServerClient(serverScriptPath);
    // 统一轮询调度器：合并变量树和图表的 readPaths 请求
    pollScheduler = new PollScheduler(serverClient);
    // 服务器进程意外退出时重置 UI 状态
    serverClient.onClose(() => {
        variableTreeDataProvider.stopAutoRefresh();
        vscode.commands.executeCommand('setContext', 'stm32LiveWatch.serverRunning', false);
        variableTreeDataProvider.refresh();
    });
    variableTreeDataProvider = new VariableTreeDataProvider(serverClient, context.workspaceState, pollScheduler);
    operationsTreeDataProvider = new OperationsTreeDataProvider();
    const chartManagerInstance = new ChartManager(serverClient, context.workspaceState, pollScheduler);
    chartManager = chartManagerInstance;
    const chartViewProvider = new ChartViewProvider(context.extensionUri, (msg) => chartManagerInstance.handleWebviewMessage(msg));
    chartManagerInstance.attachWebview(chartViewProvider);
    const axfWatcher = new AxfWatcher(
        { isRunning: () => serverClient.isRunning() },
        async (elfPath: string) => {
            if (serverClient.isRunning()) {
                // 服务器正在运行，重启以加载新 ELF
                variableTreeDataProvider.stopAutoRefresh();
                await serverClient.stopAsync();
                try {
                    const host = getConfigValue<string>('openocdHost', '127.0.0.1');
                    const port = getConfigValue<number>('openocdPort', 50001);
                    await serverClient.start(elfPath, host, port);
                    // 等待服务器就绪
                    let pingSuccess = false;
                    for (let i = 0; i < 10; i++) {
                        try {
                            await serverClient.ping();
                            pingSuccess = true;
                            break;
                        } catch {
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    }
                    if (!pingSuccess) {
                        throw new Error('Server failed to respond after 10 ping attempts');
                    }
                    await variableTreeDataProvider.loadRootVariables();
                    vscode.commands.executeCommand('setContext', 'stm32LiveWatch.serverRunning', true);
                    vscode.window.showInformationMessage(
                        `ELF 已自动更新，服务器已重启加载新调试信息`
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `ELF 更新后服务器重启失败: ${error}。请手动重新启动 Live Watch。`
                    );
                    vscode.commands.executeCommand('setContext', 'stm32LiveWatch.serverRunning', false);
                }
            }
        }
    );
    let panelTreeView: vscode.TreeView<vscode.TreeItem> | undefined;
    let lastSelectedVariableItem: VariableTreeItem | undefined;

    const startServerCommand = vscode.commands.registerCommand('stm32-live-watch.startServer', async () => {
        try {
            await ensureServerRunning(true);
        } catch (error) {
            showStartServerError(error);
        }
    });

    const stopServerCommand = vscode.commands.registerCommand('stm32-live-watch.stopServer', () => {
        variableTreeDataProvider.stopAutoRefresh();
        serverClient.stop();
        vscode.commands.executeCommand('setContext', 'stm32LiveWatch.serverRunning', false);
        vscode.window.showInformationMessage('STM32 Live Watch server stopped');
    });

    const generateElfCommand = vscode.commands.registerCommand('stm32-live-watch.generateElf', async () => {
        try {
            const config = getLiveWatchConfig();
            const result = generateElfFromEideAxf(
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                getConfigValue<string>('fromelfPath', '')
            );

            await applyResolvedElfPath(config, result);
            if (!result.elfPath) {
                showResolveElfError(result);
                return;
            }

            vscode.window.showInformationMessage(`ELF generated: ${result.elfPath}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to generate ELF: ${error}`);
        }
    });

    const configureElfPathCommand = vscode.commands.registerCommand('stm32-live-watch.configureElfPath', async () => {
        const selectedFiles = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                ELF: ['elf'],
                All: ['*']
            },
            openLabel: 'Use ELF'
        });

        const elfPath = selectedFiles?.[0]?.fsPath;
        if (!elfPath) {
            return;
        }

        const config = getLiveWatchConfig();
        await config.update('elfPath', elfPath, vscode.ConfigurationTarget.Workspace);
        variableTreeDataProvider.stopAutoRefresh();
        serverClient.stop();
        vscode.window.showInformationMessage(`ELF path configured: ${elfPath}`);
        variableTreeDataProvider.refresh();
    });

    const refreshVariablesCommand = vscode.commands.registerCommand('stm32-live-watch.refreshVariables', async () => {
        variableTreeDataProvider.clearValueCache();
    });

    const dumpDwarfVarsCommand = vscode.commands.registerCommand('stm32-live-watch.dumpDwarfVars', async () => {
        if (!serverClient.isRunning()) {
            vscode.window.showErrorMessage('Server not running. Start a debug session first.');
            return;
        }
        try {
            const vars = await serverClient.dumpDwarfVars();
            const output = vscode.window.createOutputChannel('STM32 Live Watch - DWARF Vars');
            output.clear();
            output.appendLine(`=== ELF DWARF Variables (${vars.length} total) ===\n`);
            const collected = vars.filter((v: any) => v.in_root_vars);
            const skipped = vars.filter((v: any) => !v.in_root_vars);
            output.appendLine(`--- Collected (${collected.length}) ---`);
            for (const v of collected) {
                output.appendLine(`  ${v.name}  type=${v.has_type}  loc=${v.has_loc}(${v.loc_form})`);
            }
            output.appendLine(`\n--- SKIPPED (${skipped.length}) ---`);
            for (const v of skipped) {
                output.appendLine(`  ${v.name}  type=${v.has_type}  loc=${v.has_loc}(${v.loc_form}, ${v.loc_value_type})`);
            }
            output.show();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to dump DWARF vars: ${error}`);
        }
    });

    const addVariableCommand = vscode.commands.registerCommand('stm32-live-watch.addVariable', async () => {
        const input = await vscode.window.showInputBox({
            placeHolder: 'Enter variable name (e.g., counter, myStruct.value)',
            prompt: 'Enter the variable name to add',
            value: getSelectedEditorText() ?? ''
        });

        if (input && input.trim()) {
            await addVariableExpression(input.trim());
        }
    });

    const addSelectedVariableCommand = vscode.commands.registerCommand('stm32-live-watch.addSelectedVariable', async () => {
        const selectedText = getSelectedEditorText();
        if (!selectedText) {
            void vscode.commands.executeCommand('stm32-live-watch.addVariable');
            return;
        }

        await addVariableExpression(selectedText);
    });

    const editVariableCommand = vscode.commands.registerCommand('stm32-live-watch.editVariable', async (item?: VariableTreeItem) => {
        const targetItem = getSelectedVariableItem(item, panelTreeView, lastSelectedVariableItem);
        if (!targetItem) {
            vscode.window.showInformationMessage('Please select a variable to edit.');
            return;
        }
        await variableTreeDataProvider.editVariableValue(targetItem);
    });

    const renameVariableCommand = vscode.commands.registerCommand('stm32-live-watch.renameVariable', async (item?: VariableTreeItem) => {
        const targetItem = getSelectedVariableItem(item, panelTreeView, lastSelectedVariableItem);
        if (!targetItem) {
            vscode.window.showInformationMessage('Please select a root variable to rename.');
            return;
        }
        await variableTreeDataProvider.renameVariable(targetItem);
    });

    const deleteVariableCommand = vscode.commands.registerCommand('stm32-live-watch.deleteVariable', async (item?: VariableTreeItem) => {
        const targetItem = getSelectedVariableItem(item, panelTreeView, lastSelectedVariableItem);
        if (!targetItem) {
            vscode.window.showInformationMessage('Please select a root variable to delete.');
            return;
        }
        await variableTreeDataProvider.deleteVariable(targetItem);
    });

    const showBottomPanelCommand = vscode.commands.registerCommand('stm32-live-watch.showBottomPanel', () => {
        void vscode.commands.executeCommand('stm32-debug-variables-panel.focus');
    });

    const addToChartCommand = vscode.commands.registerCommand('stm32-live-watch.addToChart', async (item?: VariableTreeItem) => {
        const targetItem = getSelectedVariableItem(item, panelTreeView, lastSelectedVariableItem);
        if (!targetItem) {
            // 无选中项，打开输入框
            await chartManagerInstance.addVariable('');
            return;
        }
        await chartManagerInstance.addVariable(targetItem.variableInfo.path);
    });

    const showChartPanelCommand = vscode.commands.registerCommand('stm32-live-watch.showChartPanel', () => {
        void vscode.commands.executeCommand('stm32-debug-chart-panel.focus');
    });

    // 更多操作菜单
    const moreActionsCommand = vscode.commands.registerCommand('stm32-live-watch.moreActions', async () => {
        interface ActionItem extends vscode.QuickPickItem { id: string; }
        const items: ActionItem[] = [
            { id: 'refresh',       label: '$(refresh) 刷新变量', description: '清除缓存并强制刷新' },
            { id: '',              label: '', kind: vscode.QuickPickItemKind.Separator },
            { id: 'addPage',       label: '$(add) 新建页面', description: '添加 Watch Page' },
            { id: 'renamePage',    label: '$(edit) 重命名页面', description: '重命名当前页面' },
            { id: 'deletePage',    label: '$(trash) 删除页面', description: '删除当前页面' },
            { id: '',              label: '', kind: vscode.QuickPickItemKind.Separator },
            { id: 'showChart',     label: '$(graph) 打开图表面板', description: '跳转到变量图表视图' },
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '更多操作',
            title: 'Live Watch'
        });

        if (!selected) return;

        const commandMap: Record<string, string> = {
            refresh:    'stm32-live-watch.refreshVariables',
            addPage:    'stm32-live-watch.addWatchPage',
            renamePage: 'stm32-live-watch.renameWatchPage',
            deletePage: 'stm32-live-watch.deleteWatchPage',
            showChart:  'stm32-live-watch.showChartPanel',
        };

        const cmd = commandMap[selected.id];
        if (cmd) {
            void vscode.commands.executeCommand(cmd);
        }
    });

    // 变量树页面管理命令
    const addWatchPageCommand = vscode.commands.registerCommand('stm32-live-watch.addWatchPage', async () => {
        await variableTreeDataProvider.addPage();
    });

    const renameWatchPageCommand = vscode.commands.registerCommand('stm32-live-watch.renameWatchPage', async () => {
        await variableTreeDataProvider.renamePage();
    });

    const deleteWatchPageCommand = vscode.commands.registerCommand('stm32-live-watch.deleteWatchPage', async () => {
        await variableTreeDataProvider.deletePage();
    });

    const prevWatchPageCommand = vscode.commands.registerCommand('stm32-live-watch.prevWatchPage', async () => {
        await variableTreeDataProvider.switchToPrevPage();
    });

    const nextWatchPageCommand = vscode.commands.registerCommand('stm32-live-watch.nextWatchPage', async () => {
        await variableTreeDataProvider.switchToNextPage();
    });

    // 图表页面管理命令
    const addChartPageCommand = vscode.commands.registerCommand('stm32-live-watch.addChartPage', async () => {
        await chartManagerInstance.addPage();
    });

    const renameChartPageCommand = vscode.commands.registerCommand('stm32-live-watch.renameChartPage', async () => {
        await chartManagerInstance.renamePage();
    });

    const deleteChartPageCommand = vscode.commands.registerCommand('stm32-live-watch.deleteChartPage', async () => {
        await chartManagerInstance.deletePage();
    });

    panelTreeView = vscode.window.createTreeView('stm32-debug-variables-panel', {
        treeDataProvider: variableTreeDataProvider,
        dragAndDropController: variableTreeDataProvider,
        showCollapseAll: true
    });
    const operationsTreeView = vscode.window.createTreeView('stm32-debug-operations-panel', {
        treeDataProvider: operationsTreeDataProvider,
        showCollapseAll: false
    });
    const chartViewDisposable = vscode.window.registerWebviewViewProvider(
        ChartViewProvider.viewType,
        chartViewProvider
    );

    const selectionDisposable = panelTreeView.onDidChangeSelection((event) => {
        const selectedItem = event.selection[0];
        if (selectedItem instanceof VariableTreeItem) {
            lastSelectedVariableItem = selectedItem;
        }
    });

    const debugStartDisposable = vscode.debug.onDidStartDebugSession((session) => {
        if (session.type !== 'cortex-debug') {
            return;
        }
        void ensureServerRunning(false).then(() => {
            void chartManagerInstance.restoreVariables().then(() => {
                chartManagerInstance.startCollecting();
            });
        });
    });

    // 调试会话结束时停止数据采集，避免对已断开的 OpenOCD 连续超时
    const debugTerminateDisposable = vscode.debug.onDidTerminateDebugSession((session) => {
        if (session.type !== 'cortex-debug') {
            return;
        }
        chartManagerInstance.stopCollecting();
    });

    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
        if (affectsLiveWatchConfig(event, 'refreshInterval')) {
            const newInterval = getConfigValue<number>('refreshInterval', 250);
            variableTreeDataProvider.updateRefreshInterval(newInterval);
        }
        if (affectsLiveWatchConfig(event, 'chartRefreshInterval')) {
            const newInterval = getConfigValue<number>('chartRefreshInterval', 100);
            chartManagerInstance.updateInterval(newInterval);
        }
    });

    const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(() => {
        chartManagerInstance.notifyThemeChanged();
    });

    context.subscriptions.push(
        pollScheduler,
        startServerCommand,
        stopServerCommand,
        generateElfCommand,
        configureElfPathCommand,
        refreshVariablesCommand,
        dumpDwarfVarsCommand,
        addVariableCommand,
        addSelectedVariableCommand,
        editVariableCommand,
        renameVariableCommand,
        deleteVariableCommand,
        showBottomPanelCommand,
        addToChartCommand,
        showChartPanelCommand,
        panelTreeView,
        operationsTreeView,
        chartViewDisposable,
        selectionDisposable,
        debugStartDisposable,
        debugTerminateDisposable,
        configChangeDisposable,
        themeChangeDisposable,
        moreActionsCommand,
        addWatchPageCommand,
        renameWatchPageCommand,
        deleteWatchPageCommand,
        prevWatchPageCommand,
        nextWatchPageCommand,
        addChartPageCommand,
        renameChartPageCommand,
        deleteChartPageCommand,
        axfWatcher
    );
}

function resolveServerScriptPath(extensionPath: string): string {
    const candidates = [
        path.join(extensionPath, 'server.py'),
        path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', 'server.py')
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return path.join(extensionPath, 'server.py');
}

function getSelectedVariableItem(
    item: VariableTreeItem | undefined,
    treeView: vscode.TreeView<vscode.TreeItem> | undefined,
    lastSelectedVariableItem: VariableTreeItem | undefined
): VariableTreeItem | undefined {
    if (item instanceof VariableTreeItem) {
        return item;
    }

    const selectedItem = treeView?.selection[0];
    return selectedItem instanceof VariableTreeItem ? selectedItem : lastSelectedVariableItem;
}

function getSelectedEditorText(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
        return undefined;
    }

    const selectedText = editor.document.getText(editor.selection).trim();
    if (!selectedText || selectedText.includes('\n') || selectedText.includes('\r')) {
        return undefined;
    }

    return selectedText;
}

async function addVariableExpression(expression: string): Promise<void> {
    if (!serverClient.isRunning()) {
        try {
            await ensureServerRunning(false);
        } catch (error) {
            vscode.window.showErrorMessage(`Server not running: ${error}`);
            return;
        }
    }

    await variableTreeDataProvider.addVariable(expression);
}

async function ensureServerRunning(showSuccessMessage: boolean): Promise<void> {
    if (serverClient.isRunning()) {
        await variableTreeDataProvider.loadRootVariables();
        if (showSuccessMessage) {
            vscode.window.showInformationMessage('STM32 Live Watch server already running');
        }
        return;
    }

    if (autoStartInProgress) {
        await autoStartInProgress;
        return;
    }

    autoStartInProgress = (async () => {
        const config = getLiveWatchConfig();
        const host = getConfigValue<string>('openocdHost', '127.0.0.1');
        const port = getConfigValue<number>('openocdPort', 50001);
        const elfResult = await resolveElfPath();
        const elfPath = elfResult.elfPath;

        if (!elfPath) {
            if (elfResult.missingFromelf) {
                throw new Error('No fromelf.exe found. Configure stm32LiveWatch.fromelfPath or install Keil fromelf.exe');
            }
            throw new Error('No ELF found. Expected build/*.elf, configured stm32LiveWatch.elfPath, or EIDE AXF output');
        }

        await applyResolvedElfPath(config, elfResult);

        await serverClient.start(elfPath, host, port);
        // 重试 ping 直到服务器就绪，而非固定等待 500ms
        let pingSuccess = false;
        for (let i = 0; i < 5; i++) {
            try {
                await serverClient.ping();
                pingSuccess = true;
                break;
            } catch {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        if (!pingSuccess) {
            throw new Error('Server failed to respond to ping after 5 attempts');
        }
        await variableTreeDataProvider.loadRootVariables();
        vscode.commands.executeCommand('setContext', 'stm32LiveWatch.serverRunning', true);

        if (showSuccessMessage) {
            vscode.window.showInformationMessage('STM32 Live Watch server started successfully');
        }
    })();

    try {
        await autoStartInProgress;
    } catch (e) {
        autoStartInProgress = undefined;
        throw e;
    }
    autoStartInProgress = undefined;
    // 确认服务器确实已启动，防止竞态条件
    if (!serverClient.isRunning()) {
        throw new Error('Server failed to start');
    }
}

async function resolveElfPath(): Promise<ResolveElfResult> {
    return resolveElfPathWithAxf({
        configuredElfPath: getConfigValue<string>('elfPath', ''),
        configuredFromelfPath: getConfigValue<string>('fromelfPath', ''),
        workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    });
}

async function applyResolvedElfPath(config: vscode.WorkspaceConfiguration, result: ResolveElfResult): Promise<void> {
    if (result.elfPath) {
        const currentConfigElfPath = config.get<string>('elfPath', '');
        if (currentConfigElfPath !== result.elfPath) {
            await config.update('elfPath', result.elfPath, vscode.ConfigurationTarget.Workspace);
        }
    }

    if (result.fromelfPath) {
        const currentFromelfPath = config.get<string>('fromelfPath', '');
        if (currentFromelfPath !== result.fromelfPath) {
            await config.update('fromelfPath', result.fromelfPath, vscode.ConfigurationTarget.Workspace);
        }
    }
}

function showResolveElfError(result: ResolveElfResult): void {
    if (result.missingFromelf) {
        vscode.window.showErrorMessage('Found EIDE AXF, but no fromelf.exe was found. Configure stm32LiveWatch.fromelfPath.');
        return;
    }

    void vscode.window.showErrorMessage('No EIDE AXF found. Build the EIDE project first or configure an ELF path manually.', 'Configure ELF Path')
        .then(selection => {
            if (selection === 'Configure ELF Path') {
                void vscode.commands.executeCommand('stm32-live-watch.configureElfPath');
            }
        });
}

function showStartServerError(error: unknown): void {
    const message = String(error);
    if (!message.includes('No ELF found')) {
        vscode.window.showErrorMessage(`Failed to start server: ${error}`);
        return;
    }

    void vscode.window.showErrorMessage(`Failed to start server: ${error}`, 'Configure ELF Path')
        .then(selection => {
            if (selection === 'Configure ELF Path') {
                void vscode.commands.executeCommand('stm32-live-watch.configureElfPath');
            }
        });
}

export function deactivate() {
    if (variableTreeDataProvider) {
        variableTreeDataProvider.dispose();
    }
    if (operationsTreeDataProvider) {
        operationsTreeDataProvider.dispose();
    }
    if (serverClient) {
        serverClient.stop();
    }
    if (chartManager) {
        chartManager.dispose();
    }
}
