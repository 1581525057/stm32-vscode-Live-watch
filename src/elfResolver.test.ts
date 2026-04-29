import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { convertAxfToElf, findEideAxfFiles, getElfPathForAxf, resolveFromelfPath } from './elfResolver';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'stm32-debug-helper-'));
}

function writeFile(filePath: string, content = ''): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

function testFindsAxfOnlyInsideEideOutDir(): void {
    const root = makeTempDir();
    const eideRoot = path.join(root, 'any-name');
    const eideAxf = path.join(eideRoot, 'custom-build', 'app', 'app.axf');
    const mdkAxf = path.join(root, 'MDK-ARM', 'app', 'app.axf');

    writeFile(path.join(eideRoot, '.eide', 'eide.yml'), 'name: app\noutDir: custom-build\n');
    writeFile(eideAxf);
    writeFile(mdkAxf);

    const axfFiles = findEideAxfFiles(root);

    assert.deepStrictEqual(axfFiles, [eideAxf]);
}

function testUsesDefaultBuildDirWhenOutDirMissing(): void {
    const root = makeTempDir();
    const eideRoot = path.join(root, 'project');
    const eideAxf = path.join(eideRoot, 'build', 'app', 'app.axf');

    writeFile(path.join(eideRoot, '.eide', 'eide.yml'), 'name: app\n');
    writeFile(eideAxf);

    assert.deepStrictEqual(findEideAxfFiles(root), [eideAxf]);
}

function testGeneratesElfNextToAxf(): void {
    const axfPath = path.join('D:', 'demo', 'build', 'app', 'app.axf');

    assert.strictEqual(getElfPathForAxf(axfPath), path.join('D:', 'demo', 'build', 'app', 'app.elf'));
}

function testResolveFromelfPathUsesConfiguredPath(): void {
    const root = makeTempDir();
    const fromelfPath = path.join(root, 'tools', 'fromelf.exe');

    writeFile(fromelfPath);

    assert.strictEqual(resolveFromelfPath({ configuredFromelfPath: fromelfPath }), fromelfPath);
}

function testResolveFromelfPathUsesPathEnvironment(): void {
    const root = makeTempDir();
    const toolDir = path.join(root, 'arm-tools');
    const fromelfPath = path.join(toolDir, 'fromelf.exe');

    writeFile(fromelfPath);

    assert.strictEqual(resolveFromelfPath({ envPath: toolDir, candidatePaths: [], searchRoots: [] }), fromelfPath);
}

function testResolveFromelfPathSearchesKeilToolchainRoots(): void {
    const root = makeTempDir();
    const fromelfPath = path.join(root, 'Keil_Custom', 'ARM', 'ARMCLANG', 'bin', 'fromelf.exe');

    writeFile(fromelfPath);

    assert.strictEqual(resolveFromelfPath({ envPath: '', candidatePaths: [], searchRoots: [root] }), fromelfPath);
}

function testResolveFromelfPathDoesNotNeedPostbuildCache(): void {
    const root = makeTempDir();
    const fromelfPath = path.join(root, 'Keil5', 'ARM', 'ARMCC', 'bin', 'fromelf.exe');
    const missingCachePath = path.join(root, 'Postbuild', 'fromelf_path.cache');

    writeFile(fromelfPath);

    assert.strictEqual(fs.existsSync(missingCachePath), false);
    assert.strictEqual(resolveFromelfPath({ envPath: '', candidatePaths: [], searchRoots: [root] }), fromelfPath);
}

function testConvertAxfToElfRunsFromelfCommand(): void {
    const root = makeTempDir();
    const axfPath = path.join(root, 'build', 'app', 'app.axf');
    const fromelfPath = path.join(root, 'fromelf.exe');
    const calls: Array<{ command: string; args: string[] }> = [];

    writeFile(axfPath);
    writeFile(fromelfPath);

    const elfPath = convertAxfToElf(axfPath, fromelfPath, (command, args) => {
        calls.push({ command, args });
        writeFile(getElfPathForAxf(axfPath));
    });

    assert.strictEqual(elfPath, getElfPathForAxf(axfPath));
    assert.deepStrictEqual(calls, [{
        command: fromelfPath,
        args: ['--elf', '--output', getElfPathForAxf(axfPath), axfPath]
    }]);
}

function run(): void {
    testFindsAxfOnlyInsideEideOutDir();
    testUsesDefaultBuildDirWhenOutDirMissing();
    testGeneratesElfNextToAxf();
    testResolveFromelfPathUsesConfiguredPath();
    testResolveFromelfPathUsesPathEnvironment();
    testResolveFromelfPathSearchesKeilToolchainRoots();
    testResolveFromelfPathDoesNotNeedPostbuildCache();
    testConvertAxfToElfRunsFromelfCommand();
}

run();
