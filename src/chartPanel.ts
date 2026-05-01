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
