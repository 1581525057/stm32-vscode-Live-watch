import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { VariableInfo, ReadResult, ServerResponse } from './models/variable';
import { getConfigValue } from './config';

export class ServerClient {
    private process: ChildProcess | null = null;
    private buffer = '';
    private activeRequest: { resolve: Function; reject: Function } | null = null;
    private requestQueue: Promise<any> = Promise.resolve();

    constructor(private readonly serverScriptPath: string) {}

    private getServerExecutable(): string | null {
        const platform = process.platform;
        let exeName;

        if (platform === 'win32') {
            exeName = 'server-windows.exe';
        } else if (platform === 'darwin') {
            exeName = 'server-macos';
        } else if (platform === 'linux') {
            exeName = 'server-linux';
        } else {
            return null;
        }
        
        const possiblePaths = [
            path.join(__dirname, '..', 'bin', exeName),
            path.join(__dirname, exeName),
            path.join(__dirname, 'bin', exeName),
        ];

        for (const exePath of possiblePaths) {
            if (fs.existsSync(exePath)) {
                console.log(`Found server executable: ${exePath}`);
                return exePath;
            }
        }

        console.log(`Server executable not found, will use Python`);
        return null;
    }

    async start(elfPath: string, host: string = '127.0.0.1', port: number = 50001): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.process) {
                resolve();
                return;
            }

            const serverExe = this.getServerExecutable();
            const useExecutable = serverExe !== null;

            let pythonPath = getConfigValue<string>('pythonPath', 'python3');
            if (process.platform === 'win32' && pythonPath === 'python3') {
                pythonPath = 'python';
            }

            if (!useExecutable) {
                if (!fs.existsSync(this.serverScriptPath)) {
                    reject(new Error(`server.py not found: ${this.serverScriptPath}`));
                    return;
                }
            }

            const cwd = path.dirname(elfPath);
            const command = useExecutable ? serverExe! : pythonPath;
            const args = useExecutable 
                ? ['--elf', elfPath, '--host', host, '--port', port.toString()]
                : [this.serverScriptPath, '--elf', elfPath, '--host', host, '--port', port.toString()];

            console.log(`Starting server: ${command} ${args.join(' ')}`);
            console.log(`Working directory: ${cwd}`);
            console.log(`Using executable: ${useExecutable}`);

            this.process = spawn(
                command,
                args,
                {
                    cwd,
                    shell: false
                }
            );

            this.process.stdout?.on('data', (data: Buffer) => {
                console.log('Server stdout:', data.toString());
                this.buffer += data.toString();
                this.processBuffer();
            });

            this.process.stderr?.on('data', (data: Buffer) => {
                console.error('Server stderr:', data.toString());
            });

            this.process.on('error', (error) => {
                console.error('Failed to start server:', error);
                reject(error);
            });

            this.process.on('close', (code) => {
                console.log('Server closed with code:', code);
                if (this.activeRequest) {
                    this.activeRequest.reject(new Error(`Server closed with code: ${code}`));
                    this.activeRequest = null;
                }
                this.process = null;
            });

            setTimeout(() => resolve(), 50);
        });
    }

    private processBuffer(): void {
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) {
                continue;
            }

            try {
                const response: ServerResponse = JSON.parse(line);
                const pending = this.activeRequest;
                if (pending) {
                    this.activeRequest = null;
                    if (response.ok) {
                        pending.resolve(response.result);
                    } else {
                        pending.reject(new Error(response.error));
                    }
                }
                // 后续行可能是服务器诊断输出，跳过
            } catch (error) {
                // 非 JSON 行（服务器诊断日志），静默跳过
                // 只有当有活跃请求且该行看起来像错误时才释放
                const pending = this.activeRequest;
                if (pending && line.includes('Error')) {
                    this.activeRequest = null;
                    pending.reject(new Error(`Server error: ${line.substring(0, 100)}`));
                }
            }
        }
    }

    private sendRequest(command: string, params: any = {}): Promise<any> {
        const runRequest = () => new Promise((resolve, reject) => {
            if (!this.process || !this.process.stdin) {
                reject(new Error('Server not running'));
                return;
            }

            if (this.activeRequest) {
                reject(new Error('Another request is still in progress'));
                return;
            }

            // 每个请求设置 10 秒超时，防止永久挂起
            const timeout = setTimeout(() => {
                if (this.activeRequest) {
                    this.activeRequest = null;
                    reject(new Error(`Request '${command}' timed out after 10s`));
                }
            }, 10000);

            const request = JSON.stringify({ command, ...params });
            this.activeRequest = {
                resolve: (v: any) => { clearTimeout(timeout); resolve(v); },
                reject: (e: any) => { clearTimeout(timeout); reject(e); }
            };
            this.process.stdin.write(request + '\n');
        });

        const queuedRequest = this.requestQueue.then(runRequest, runRequest);
        this.requestQueue = queuedRequest.catch((err) => {
            console.error('Request queue error:', err);
        });
        return queuedRequest;
    }

    async ping(): Promise<any> {
        return this.sendRequest('ping');
    }

    async dumpDwarfVars(): Promise<any> {
        return this.sendRequest('list_all_dwarf_vars');
    }

    async listRoots(): Promise<VariableInfo[]> {
        return this.sendRequest('list_roots');
    }

    async describe(path: string): Promise<VariableInfo> {
        return this.sendRequest('describe', { path });
    }

    async listChildren(path: string): Promise<VariableInfo[]> {
        return this.sendRequest('list_children', { path });
    }

    async readPaths(paths: string[]): Promise<ReadResult[]> {
        return this.sendRequest('read_paths', { paths });
    }

    async writeValue(path: string, value: string): Promise<any> {
        return this.sendRequest('write', { path, value });
    }

    stop(): void {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        // 拒绝当前活跃请求，防止调用方 Promise 永久挂起
        if (this.activeRequest) {
            this.activeRequest.reject(new Error('Server stopped'));
            this.activeRequest = null;
        }
        this.buffer = '';
        this.requestQueue = Promise.resolve();
    }

    isRunning(): boolean {
        return this.process !== null;
    }
}
