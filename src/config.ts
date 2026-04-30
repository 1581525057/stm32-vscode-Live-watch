import * as vscode from 'vscode';

export const CONFIG_SECTION = 'stm32LiveWatch';
export const LEGACY_CONFIG_SECTION = 'stm32DebugHelper';

export function getLiveWatchConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

export function getConfigValue<T>(key: string, defaultValue: T): T {
    const config = getLiveWatchConfig();
    if (hasConfiguredValue(config, key)) {
        return config.get<T>(key, defaultValue);
    }

    return vscode.workspace.getConfiguration(LEGACY_CONFIG_SECTION).get<T>(key, defaultValue);
}

export function affectsLiveWatchConfig(event: vscode.ConfigurationChangeEvent, key: string): boolean {
    return event.affectsConfiguration(`${CONFIG_SECTION}.${key}`)
        || event.affectsConfiguration(`${LEGACY_CONFIG_SECTION}.${key}`);
}

function hasConfiguredValue(config: vscode.WorkspaceConfiguration, key: string): boolean {
    const inspected = config.inspect(key);
    return inspected !== undefined && (
        inspected.globalValue !== undefined
        || inspected.workspaceValue !== undefined
        || inspected.workspaceFolderValue !== undefined
        || inspected.globalLanguageValue !== undefined
        || inspected.workspaceLanguageValue !== undefined
        || inspected.workspaceFolderLanguageValue !== undefined
    );
}
