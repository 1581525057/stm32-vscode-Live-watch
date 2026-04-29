import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { generateElfFromEideAxf, resolveElfPathWithAxf, ResolveElfResult } from './elfResolver';
import { ServerClient } from './serverClient';
import { VariableTreeDataProvider, VariableTreeItem } from './variableTreeDataProvider';

let serverClient: ServerClient;
let variableTreeDataProvider: VariableTreeDataProvider;
let autoStartInProgress: Promise<void> | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('STM32 Debug Helper is now active!');

    const serverScriptPath = resolveServerScriptPath(context.extensionPath);
    serverClient = new ServerClient(serverScriptPath);
    variableTreeDataProvider = new VariableTreeDataProvider(serverClient, context.workspaceState);

    const helloWorldCommand = vscode.commands.registerCommand('stm32-debug-helper.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from STM32 Debug Helper!');
    });

    const startServerCommand = vscode.commands.registerCommand('stm32-debug-helper.startServer', async () => {
        try {
            await ensureServerRunning(true);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start server: ${error}`);
        }
    });

    const stopServerCommand = vscode.commands.registerCommand('stm32-debug-helper.stopServer', () => {
        variableTreeDataProvider.stopAutoRefresh();
        serverClient.stop();
        vscode.window.showInformationMessage('STM32 Debug Server stopped');
    });

    const generateElfCommand = vscode.commands.registerCommand('stm32-debug-helper.generateElf', async () => {
        try {
            const config = vscode.workspace.getConfiguration('stm32DebugHelper');
            const result = generateElfFromEideAxf(
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                config.get<string>('fromelfPath', '')
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

    const refreshVariablesCommand = vscode.commands.registerCommand('stm32-debug-helper.refreshVariables', async () => {
        variableTreeDataProvider.clearValueCache();
    });

    const addVariableCommand = vscode.commands.registerCommand('stm32-debug-helper.addVariable', async () => {
        if (!serverClient.isRunning()) {
            try {
                await ensureServerRunning(false);
            } catch (error) {
                vscode.window.showErrorMessage(`Server not running: ${error}`);
                return;
            }
        }

        const input = await vscode.window.showInputBox({
            placeHolder: 'Enter variable name (e.g., counter, myStruct.value)',
            prompt: 'Enter the variable name to add'
        });

        if (input && input.trim()) {
            await variableTreeDataProvider.addVariable(input.trim());
        }
    });

    const editVariableCommand = vscode.commands.registerCommand('stm32-debug-helper.editVariable', async (item?: VariableTreeItem) => {
        if (!item) {
            return;
        }
        await variableTreeDataProvider.editVariableValue(item);
    });

    const renameVariableCommand = vscode.commands.registerCommand('stm32-debug-helper.renameVariable', async (item?: VariableTreeItem) => {
        if (!item) {
            return;
        }
        await variableTreeDataProvider.renameVariable(item);
    });

    const deleteVariableCommand = vscode.commands.registerCommand('stm32-debug-helper.deleteVariable', async (item?: VariableTreeItem) => {
        if (!item) {
            return;
        }
        await variableTreeDataProvider.deleteVariable(item);
    });

    const showBottomPanelCommand = vscode.commands.registerCommand('stm32-debug-helper.showBottomPanel', () => {
        void vscode.commands.executeCommand('stm32-debug-variables-panel.focus');
    });

    const panelTreeView = vscode.window.createTreeView('stm32-debug-variables-panel', {
        treeDataProvider: variableTreeDataProvider,
        showCollapseAll: true
    });

    const debugStartDisposable = vscode.debug.onDidStartDebugSession((session) => {
        if (session.type !== 'cortex-debug') {
            return;
        }
        void ensureServerRunning(false);
    });

    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('stm32DebugHelper.refreshInterval')) {
            const config = vscode.workspace.getConfiguration('stm32DebugHelper');
            const newInterval = config.get<number>('refreshInterval', 250);
            variableTreeDataProvider.updateRefreshInterval(newInterval);
        }
    });

    context.subscriptions.push(
        helloWorldCommand,
        startServerCommand,
        stopServerCommand,
        generateElfCommand,
        refreshVariablesCommand,
        addVariableCommand,
        editVariableCommand,
        renameVariableCommand,
        deleteVariableCommand,
        showBottomPanelCommand,
        panelTreeView,
        debugStartDisposable,
        configChangeDisposable
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

    return candidates[0] ?? 'server.py';
}

async function ensureServerRunning(showSuccessMessage: boolean): Promise<void> {
    if (serverClient.isRunning()) {
        await variableTreeDataProvider.loadRootVariables();
        if (showSuccessMessage) {
            vscode.window.showInformationMessage('STM32 Debug Server already running');
        }
        return;
    }

    if (autoStartInProgress) {
        await autoStartInProgress;
        return;
    }

    autoStartInProgress = (async () => {
        const config = vscode.workspace.getConfiguration('stm32DebugHelper');
        const host = config.get<string>('openocdHost', '127.0.0.1');
        const port = config.get<number>('openocdPort', 50001);
        const elfResult = await resolveElfPath(config);
        const elfPath = elfResult.elfPath;

        if (!elfPath) {
            if (elfResult.missingFromelf) {
                throw new Error('No fromelf.exe found. Configure stm32DebugHelper.fromelfPath or install Keil fromelf.exe');
            }
            throw new Error('No ELF found. Expected build/*.elf, configured stm32DebugHelper.elfPath, or EIDE AXF output');
        }

        await applyResolvedElfPath(config, elfResult);

        await serverClient.start(elfPath, host, port);
        await new Promise(resolve => setTimeout(resolve, 500));
        await serverClient.ping();
        await variableTreeDataProvider.loadRootVariables();

        if (showSuccessMessage) {
            vscode.window.showInformationMessage('STM32 Debug Server started successfully');
        }
    })();

    try {
        await autoStartInProgress;
    } finally {
        autoStartInProgress = undefined;
    }
}

async function resolveElfPath(config: vscode.WorkspaceConfiguration): Promise<ResolveElfResult> {
    return resolveElfPathWithAxf({
        configuredElfPath: config.get<string>('elfPath', ''),
        configuredFromelfPath: config.get<string>('fromelfPath', ''),
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
        vscode.window.showErrorMessage('Found EIDE AXF, but no fromelf.exe was found. Configure stm32DebugHelper.fromelfPath.');
        return;
    }

    vscode.window.showErrorMessage('No EIDE AXF found. Build the EIDE project first.');
}

export function deactivate() {
    if (serverClient) {
        serverClient.stop();
    }
}
