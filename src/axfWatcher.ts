// src/axfWatcher.ts
// AXF 文件变更自动检测与 ELF 转换

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { convertAxfToElf, getElfPathForAxf, resolveFromelfPath } from './elfResolver';

export class AxfWatcher implements vscode.Disposable {
    private watcher: vscode.FileSystemWatcher;
    private debounceTimer: NodeJS.Timeout | null = null;
    private pendingUris = new Map<string, vscode.Uri>();

    constructor(
        private serverClient: { isRunning: () => boolean },
        private onElfUpdated?: (elfPath: string) => void
    ) {
        this.watcher = vscode.workspace.createFileSystemWatcher('**/*.axf');
        this.watcher.onDidChange(uri => this.onAxfEvent(uri));
        this.watcher.onDidCreate(uri => this.onAxfEvent(uri));
    }

    private onAxfEvent(uri: vscode.Uri): void {
        const config = vscode.workspace.getConfiguration('stm32LiveWatch');
        if (!config.get<boolean>('autoWatchAxf', true)) {
            return;
        }

        this.pendingUris.set(uri.fsPath, uri);

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            const uris = Array.from(this.pendingUris.values());
            this.pendingUris.clear();
            for (const u of uris) {
                void this.handleAxfChanged(u);
            }
        }, 500);
    }

    private async handleAxfChanged(uri: vscode.Uri): Promise<void> {
        const axfPath = uri.fsPath;
        if (!axfPath.toLowerCase().endsWith('.axf')) {
            return;
        }

        const elfPath = getElfPathForAxf(axfPath);

        // ELF 已存在且比 AXF 新，跳过
        try {
            if (fs.existsSync(elfPath)) {
                const axfStat = fs.statSync(axfPath);
                const elfStat = fs.statSync(elfPath);
                if (elfStat.mtimeMs >= axfStat.mtimeMs) {
                    return;
                }
            }
        } catch {
            // 继续转换
        }

        const config = vscode.workspace.getConfiguration('stm32LiveWatch');
        const fromelfPath = resolveFromelfPath({
            configuredFromelfPath: config.get<string>('fromelfPath', '')
        });

        if (!fromelfPath) {
            vscode.window.showErrorMessage(
                'AXF 文件已更新，但找不到 fromelf.exe。请配置 stm32LiveWatch.fromelfPath。'
            );
            return;
        }

        try {
            const generatedPath = convertAxfToElf(axfPath, fromelfPath);
            await config.update('elfPath', generatedPath, vscode.ConfigurationTarget.Workspace);

            const fileName = path.basename(axfPath);
            vscode.window.setStatusBarMessage(
                `$(check) ELF 已更新: ${path.basename(generatedPath)} (来自 ${fileName})`,
                5000
            );

            // 通知外部 ELF 已更新，用于重启服务器
            if (this.onElfUpdated) {
                try {
                    await this.onElfUpdated(generatedPath);
                } catch (error) {
                    vscode.window.showErrorMessage(`服务器重启失败: ${error}`);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`AXF 转 ELF 失败: ${error}`);
        }
    }

    dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.watcher.dispose();
    }
}
