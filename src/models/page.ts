// src/models/page.ts
// 多页面数据模型与迁移逻辑

import * as vscode from 'vscode';
import * as crypto from 'crypto';

export interface WatchPage {
    id: string;
    name: string;
    watchedPaths: string[];
}

export interface ChartPage {
    id: string;
    name: string;
    variablePaths: string[];
    colorMap: Record<string, string>;
}

const WATCH_PAGES_KEY = 'stm32LiveWatch.watchPages';
const ACTIVE_WATCH_PAGE_KEY = 'stm32LiveWatch.activeWatchPageId';
const CHART_PAGES_KEY = 'stm32LiveWatch.chartPages';
const ACTIVE_CHART_PAGE_KEY = 'stm32LiveWatch.activeChartPageId';

// 旧版存储 key
const LEGACY_WATCHED_VARIABLES_KEY = 'stm32LiveWatch.watchedVariables';
const LEGACY_WATCHED_VARIABLES_KEY_OLD = 'stm32DebugHelper.watchedVariables';
const LEGACY_CHART_VARIABLES_KEY = 'stm32LiveWatch.chartVariables';

export const MAX_PAGES = 10;
export const MAX_PAGE_NAME_LENGTH = 20;

export function generatePageId(): string {
    return crypto.randomBytes(8).toString('hex');
}

export function createDefaultWatchPage(name = 'Watch'): WatchPage {
    return { id: generatePageId(), name, watchedPaths: [] };
}

export function createDefaultChartPage(name = 'Chart'): ChartPage {
    return { id: generatePageId(), name, variablePaths: [], colorMap: {} };
}

// 加载监视页面，自动迁移旧版数据
export function loadWatchPages(state: vscode.Memento): { pages: WatchPage[]; activeId: string } {
    const pages = state.get<WatchPage[]>(WATCH_PAGES_KEY);
    if (pages && pages.length > 0) {
        const activeId = state.get<string>(ACTIVE_WATCH_PAGE_KEY, pages[0].id);
        const validActive = pages.some(p => p.id === activeId) ? activeId : pages[0].id;
        return { pages, activeId: validActive };
    }

    // 迁移旧版数据
    const legacyPaths = state.get<string[]>(
        LEGACY_WATCHED_VARIABLES_KEY,
        state.get<string[]>(LEGACY_WATCHED_VARIABLES_KEY_OLD, [])
    );
    const defaultPage = createDefaultWatchPage();
    defaultPage.watchedPaths = legacyPaths;
    return { pages: [defaultPage], activeId: defaultPage.id };
}

// 加载图表页面，自动迁移旧版数据
export function loadChartPages(state: vscode.Memento): { pages: ChartPage[]; activeId: string } {
    const pages = state.get<ChartPage[]>(CHART_PAGES_KEY);
    if (pages && pages.length > 0) {
        const activeId = state.get<string>(ACTIVE_CHART_PAGE_KEY, pages[0].id);
        const validActive = pages.some(p => p.id === activeId) ? activeId : pages[0].id;
        return { pages, activeId: validActive };
    }

    // 迁移旧版数据
    const legacyPaths = state.get<string[]>(LEGACY_CHART_VARIABLES_KEY, []);
    const defaultPage = createDefaultChartPage();
    defaultPage.variablePaths = legacyPaths;
    return { pages: [defaultPage], activeId: defaultPage.id };
}

// 持久化
export async function persistWatchPages(state: vscode.Memento, pages: WatchPage[], activeId: string): Promise<void> {
    await state.update(WATCH_PAGES_KEY, pages);
    await state.update(ACTIVE_WATCH_PAGE_KEY, activeId);
}

export async function persistChartPages(state: vscode.Memento, pages: ChartPage[], activeId: string): Promise<void> {
    await state.update(CHART_PAGES_KEY, pages);
    await state.update(ACTIVE_CHART_PAGE_KEY, activeId);
}
