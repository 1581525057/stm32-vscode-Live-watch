import * as vscode from 'vscode';
import { ServerClient } from './serverClient';
import { ReadResult } from './models/variable';

/**
 * 轮询源接口：每个需要定时读取变量的组件注册一个 source
 */
export interface PollSource {
    /** 源名称，用于注册/注销 */
    name: string;
    /** 返回本次需要读取的变量路径（返回空数组则跳过本轮） */
    getPaths: () => string[];
    /** 轮询间隔（毫秒） */
    interval: number;
    /** 结果回调 */
    onResults: (results: ReadResult[]) => void;
}

/**
 * 统一轮询调度器
 *
 * 将多个组件的定时 readPaths 请求合并为一次 RPC，避免串行阻塞。
 * 基准 tick 间隔默认 100ms，各 source 按自身 interval 周期性触发。
 */
export class PollScheduler implements vscode.Disposable {
    private sources = new Map<string, PollSource>();
    private baseInterval = 100;
    private timer: NodeJS.Timeout | null = null;
    private tickCount = 0;
    private isTicking = false;
    /** 代次计数器：stop/start 时递增，用于使旧 tick 闭包失效 */
    private generation = 0;

    constructor(private serverClient: ServerClient) {}

    /**
     * 注册一个轮询源（重复注册同名源会覆盖）
     */
    registerSource(source: PollSource): void {
        this.sources.set(source.name, source);
    }

    /**
     * 注销一个轮询源，如果没有剩余源则停止定时器
     */
    unregisterSource(name: string): void {
        this.sources.delete(name);
        // 没有活跃源时停止定时器，避免空转
        if (this.sources.size === 0) {
            this.stop();
        }
    }

    /**
     * 启动基准定时器（幂等，重复调用安全）
     */
    start(): void {
        if (this.timer) {
            return;
        }
        // 递增代次，使 stop 前启动的旧 tick 闭包失效
        this.generation++;
        const gen = this.generation;
        this.timer = setInterval(() => {
            if (!this.isTicking) {
                this.isTicking = true;
                void this.tick(gen).finally(() => {
                    // 仅当前代次的 tick 完成时才重置标志
                    if (this.generation === gen) {
                        this.isTicking = false;
                    }
                });
            }
        }, this.baseInterval);
    }

    /**
     * 停止基准定时器
     */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        // 递增代次使旧 tick 闭包失效，重置标志允许新 start 立即调度
        this.generation++;
        this.isTicking = false;
    }

    /**
     * 动态更新指定源的轮询间隔
     */
    updateInterval(name: string, interval: number): void {
        const source = this.sources.get(name);
        if (source) {
            source.interval = interval;
        }
    }

    /**
     * 核心 tick：收集所有到期 source 的 paths，合并为一次 readPaths，再分发结果
     */
    private async tick(gen?: number): Promise<void> {
        // 如果代次不匹配（stop/start 后），直接返回，不执行旧 tick
        if (gen !== undefined && gen !== this.generation) {
            return;
        }
        if (this.sources.size === 0) {
            return;
        }

        // 检查服务器是否在运行，未运行则跳过本轮
        if (!this.serverClient.isRunning()) {
            return;
        }

        this.tickCount++;

        // 收集本 tick 需要读取的 source 及其 paths
        const activeSources: Array<{ source: PollSource; paths: string[] }> = [];
        const pathsToRead = new Set<string>();

        for (const source of this.sources.values()) {
            const divisor = Math.round(source.interval / this.baseInterval);
            if (divisor <= 0 || this.tickCount % divisor === 0) {
                const paths = source.getPaths();
                if (paths.length > 0) {
                    activeSources.push({ source, paths });
                    for (const p of paths) {
                        pathsToRead.add(p);
                    }
                }
            }
        }

        if (pathsToRead.size === 0) {
            return;
        }

        // 一次 readPaths 请求（合并所有 source 的 paths）
        const paths = Array.from(pathsToRead);
        try {
            const results = await this.serverClient.readPaths(paths);

            // 分发给所有活跃的 source
            for (const { source, paths: sourcePaths } of activeSources) {
                const filtered = results.filter(r => sourcePaths.includes(r.path));
                source.onResults(filtered);
            }
        } catch (_error) {
            // 静默跳过，下次 tick 重试
        }
    }

    dispose(): void {
        this.stop();
    }
}
