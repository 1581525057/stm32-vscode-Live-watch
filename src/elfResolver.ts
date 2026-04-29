import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type FromelfRunner = (command: string, args: string[]) => void;

export interface ResolveElfOptions {
    configuredElfPath?: string;
    workspaceFolder?: string;
    configuredFromelfPath?: string;
}

export interface ResolveElfResult {
    elfPath?: string;
    generated: boolean;
    axfPath?: string;
    missingFromelf?: boolean;
    fromelfPath?: string;
}

export interface FromelfSearchOptions {
    configuredFromelfPath?: string;
    envPath?: string;
    candidatePaths?: string[];
    searchRoots?: string[];
}

export function resolveElfPathWithAxf(options: ResolveElfOptions): ResolveElfResult {
    const configuredElfPath = options.configuredElfPath?.trim();
    if (configuredElfPath && fs.existsSync(configuredElfPath)) {
        return { elfPath: configuredElfPath, generated: false };
    }

    const workspaceFolder = options.workspaceFolder;
    if (!workspaceFolder) {
        return { generated: false };
    }

    const existingElfPath = findExistingNonEideElfPath(workspaceFolder);
    if (existingElfPath) {
        return { elfPath: existingElfPath, generated: false };
    }

    // 启动服务时优先复用可用 ELF；没有 ELF 时才进入 EIDE AXF 转换流程。
    return resolveEideElfFromAxf(workspaceFolder, options.configuredFromelfPath, false);
}

export function generateElfFromEideAxf(workspaceFolder: string | undefined, configuredFromelfPath?: string): ResolveElfResult {
    if (!workspaceFolder) {
        return { generated: false };
    }

    return resolveEideElfFromAxf(workspaceFolder, configuredFromelfPath, true);
}

export function findExistingNonEideElfPath(workspaceFolder: string): string | undefined {
    const debugDir = path.join(workspaceFolder, 'build');
    const debugElfPath = findFirstFileByExtension(debugDir, '.elf', false);
    if (debugElfPath) {
        return debugElfPath;
    }

    return findFirstFileByExtension(workspaceFolder, '.elf', false);
}

function resolveEideElfFromAxf(workspaceFolder: string, configuredFromelfPath: string | undefined, forceGenerate: boolean): ResolveElfResult {
    const axfPath = findEideAxfFiles(workspaceFolder)[0];
    if (!axfPath) {
        return { generated: false };
    }

    const elfPath = getElfPathForAxf(axfPath);
    if (!forceGenerate && fs.existsSync(elfPath) && fs.statSync(elfPath).mtimeMs >= fs.statSync(axfPath).mtimeMs) {
        return { elfPath, generated: false, axfPath };
    }

    const fromelfPath = resolveFromelfPath({ configuredFromelfPath });
    if (!fromelfPath) {
        return { generated: false, axfPath, missingFromelf: true };
    }

    const generatedElfPath = convertAxfToElf(axfPath, fromelfPath);
    return { elfPath: generatedElfPath, generated: true, axfPath, fromelfPath };
}

export function findExistingElfPath(workspaceFolder: string): string | undefined {
    const existingElfPath = findExistingNonEideElfPath(workspaceFolder);
    if (existingElfPath) {
        return existingElfPath;
    }

    const eideAxfPath = findEideAxfFiles(workspaceFolder)[0];
    if (eideAxfPath) {
        const eideElfPath = getElfPathForAxf(eideAxfPath);
        if (fs.existsSync(eideElfPath)) {
            return eideElfPath;
        }
    }

    const eideElfPath = findEideElfFiles(workspaceFolder)[0];
    if (eideElfPath) {
        return eideElfPath;
    }

    return undefined;
}

export function findEideElfFiles(workspaceFolder: string): string[] {
    return findEideOutputFiles(workspaceFolder, '.elf');
}

export function findEideAxfFiles(workspaceFolder: string): string[] {
    return findEideOutputFiles(workspaceFolder, '.axf');
}

export function getElfPathForAxf(axfPath: string): string {
    const parsedPath = path.parse(axfPath);
    return path.join(parsedPath.dir, `${parsedPath.name}.elf`);
}

export function resolveFromelfPath(options: FromelfSearchOptions = {}): string | undefined {
    const configuredPath = options.configuredFromelfPath?.trim();
    if (configuredPath && fs.existsSync(configuredPath)) {
        return configuredPath;
    }

    const pathExecutable = findFromelfInPath(options.envPath ?? process.env.PATH ?? '');
    if (pathExecutable) {
        return pathExecutable;
    }

    const candidatePaths = options.candidatePaths ?? [
        'D:\\Keil5\\ARM\\ARMCLANG\\bin\\fromelf.exe',
        'D:\\Keil5\\ARM\\ARMCC\\bin\\fromelf.exe',
        'C:\\Keil_v5\\ARM\\ARMCLANG\\bin\\fromelf.exe',
        'C:\\Keil_v5\\ARM\\ARMCC\\bin\\fromelf.exe'
    ];

    const candidatePath = candidatePaths.find(candidate => fs.existsSync(candidate));
    if (candidatePath) {
        return candidatePath;
    }

    return findFromelfUnderSearchRoots(options.searchRoots ?? getDefaultFromelfSearchRoots());
}

export function convertAxfToElf(axfPath: string, fromelfPath: string, runner: FromelfRunner = runFromelf): string {
    const elfPath = getElfPathForAxf(axfPath);
    const args = ['--elf', '--output', elfPath, axfPath];

    runner(fromelfPath, args);

    if (!fs.existsSync(elfPath)) {
        throw new Error(`fromelf did not generate ELF: ${elfPath}`);
    }

    return elfPath;
}

function runFromelf(command: string, args: string[]): void {
    execFileSync(command, args, { stdio: 'pipe' });
}

function findFromelfInPath(envPath: string): string | undefined {
    const pathDirs = envPath.split(path.delimiter).filter(Boolean);
    for (const dir of pathDirs) {
        const candidate = path.join(dir, process.platform === 'win32' ? 'fromelf.exe' : 'fromelf');
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

function findFromelfUnderSearchRoots(searchRoots: string[]): string | undefined {
    for (const root of searchRoots) {
        if (!fs.existsSync(root)) {
            continue;
        }

        for (const keilDir of findKeilLikeDirs(root)) {
            const candidates = [
                path.join(keilDir, 'ARM', 'ARMCLANG', 'bin', 'fromelf.exe'),
                path.join(keilDir, 'ARM', 'ARMCC', 'bin', 'fromelf.exe')
            ];
            const foundPath = candidates.find(candidate => fs.existsSync(candidate));
            if (foundPath) {
                return foundPath;
            }
        }
    }

    return undefined;
}

function findKeilLikeDirs(root: string): string[] {
    const dirs = readChildDirs(root)
        .filter(dirPath => /^keil/i.test(path.basename(dirPath)));

    if (/^keil/i.test(path.basename(root))) {
        dirs.unshift(root);
    }

    return dirs.sort((left, right) => left.localeCompare(right));
}

function getDefaultFromelfSearchRoots(): string[] {
    if (process.platform !== 'win32') {
        return [];
    }

    return ['C:\\', 'D:\\', 'E:\\', 'F:\\'];
}

function findEideOutputFiles(workspaceFolder: string, extension: string): string[] {
    const projectRoots = findEideProjectRoots(workspaceFolder);
    const outputFiles: string[] = [];

    for (const projectRoot of projectRoots) {
        // 只读取 EIDE 的 outDir 输出目录，避免误扫 MDK-ARM 或其他构建目录。
        const outputDir = path.join(projectRoot, readEideOutDir(projectRoot));
        outputFiles.push(...findFirstLevelAndRecursiveFiles(outputDir, extension));
    }

    return sortFilesByTimeThenName(outputFiles);
}

function findEideProjectRoots(workspaceFolder: string): string[] {
    const projectRoots: string[] = [];
    const pendingDirs = [workspaceFolder];

    while (pendingDirs.length > 0) {
        const currentDir = pendingDirs.shift()!;
        const eideConfigPath = path.join(currentDir, '.eide', 'eide.yml');

        if (fs.existsSync(eideConfigPath)) {
            projectRoots.push(currentDir);
            continue;
        }

        for (const childDir of readChildDirs(currentDir)) {
            if (shouldSkipDir(childDir)) {
                continue;
            }
            pendingDirs.push(childDir);
        }
    }

    return projectRoots.sort((left, right) => left.localeCompare(right));
}

function readEideOutDir(projectRoot: string): string {
    const eideConfigPath = path.join(projectRoot, '.eide', 'eide.yml');
    const content = fs.readFileSync(eideConfigPath, 'utf8');
    const match = content.match(/^\s*outDir:\s*(.+?)\s*$/m);

    if (!match) {
        // EIDE 未显式声明 outDir 时使用常见默认值 build。
        return 'build';
    }

    const rawValue = match[1].split('#')[0].trim();
    const unquotedValue = rawValue.replace(/^['"]|['"]$/g, '');
    return unquotedValue || 'build';
}

function findFirstFileByExtension(dirPath: string, extension: string, recursive: boolean): string | undefined {
    const files = recursive ? findFirstLevelAndRecursiveFiles(dirPath, extension) : findFirstLevelFiles(dirPath, extension);
    return sortFilesByName(files)[0];
}

function findFirstLevelAndRecursiveFiles(dirPath: string, extension: string): string[] {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    const result: string[] = [];
    const pendingDirs = [dirPath];

    while (pendingDirs.length > 0) {
        const currentDir = pendingDirs.shift()!;
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const entryPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                pendingDirs.push(entryPath);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
                result.push(entryPath);
            }
        }
    }

    return result;
}

function findFirstLevelFiles(dirPath: string, extension: string): string[] {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    return fs.readdirSync(dirPath, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
        .map(entry => path.join(dirPath, entry.name));
}

function readChildDirs(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    return fs.readdirSync(dirPath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(dirPath, entry.name));
}

function shouldSkipDir(dirPath: string): boolean {
    const name = path.basename(dirPath).toLowerCase();
    return ['.git', 'node_modules', 'mdk-arm', 'build', 'out', 'bin'].includes(name);
}

function sortFilesByName(files: string[]): string[] {
    return [...files].sort((left, right) => left.localeCompare(right));
}

function sortFilesByTimeThenName(files: string[]): string[] {
    return [...files].sort((left, right) => {
        const timeDiff = fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
        if (timeDiff !== 0) {
            return timeDiff;
        }
        return left.localeCompare(right);
    });
}
