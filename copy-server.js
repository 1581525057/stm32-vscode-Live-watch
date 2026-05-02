const fs = require('fs');
const path = require('path');

const platform = process.platform;
let exeName;

if (platform === 'win32') {
    exeName = 'server-windows.exe';
} else if (platform === 'darwin') {
    exeName = 'server-macos';
} else if (platform === 'linux') {
    exeName = 'server-linux';
} else {
    console.error(`Unsupported platform: ${platform}`);
    process.exit(1);
}

const binDir = path.join(__dirname, 'bin');
const src = path.join(binDir, exeName);
const destDir = path.join(__dirname, 'out', 'bin');

if (!fs.existsSync(src)) {
    console.error(`Server executable not found: ${src}`);
    process.exit(1);
}

if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
}

const dest = path.join(destDir, exeName);
fs.copyFileSync(src, dest);
console.log(`Copied ${exeName} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)}MB)`);
