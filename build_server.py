import os
import platform
import shutil
import sys
import tempfile
from pathlib import Path

import PyInstaller.__main__

def build_server():
    platform_name = platform.system().lower()
    
    if platform_name == 'windows':
        exe_name = 'server-windows.exe'
    elif platform_name == 'darwin':
        exe_name = 'server-macos'
    elif platform_name == 'linux':
        exe_name = 'server-linux'
    else:
        print(f"Unsupported platform: {platform_name}")
        sys.exit(1)
    
    output_dir = Path(__file__).parent / 'bin'
    output_dir.mkdir(exist_ok=True)
    temp_root = Path(tempfile.gettempdir()) / 'stm32-debug-helper-server-build'
    if temp_root.exists():
        shutil.rmtree(temp_root)
    temp_output_dir = temp_root / 'dist'
    temp_work_dir = temp_root / 'build'
    temp_output_dir.mkdir(parents=True, exist_ok=True)
    temp_work_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"Building server for {platform_name}...")
    
    pyinstaller_args = [
        './resources/server.py',
        '--onefile',
        '--name', exe_name,
        '--distpath', str(temp_output_dir),
        '--workpath', str(temp_work_dir),
        '--hidden-import', 'elftools.elf.elffile',
        '--hidden-import', 'elftools.dwarf.dwarfinfo',
        '--hidden-import', 'elftools.dwarf.die',
        '--hidden-import', 'elftools.dwarf.dwarf_expr',
        '--hidden-import', 'elftools.dwarf.locationlists',
        '--noconfirm',
    ]
    
    PyInstaller.__main__.run(pyinstaller_args)
    
    temp_exe_path = temp_output_dir / exe_name
    exe_path = output_dir / exe_name
    if temp_exe_path.exists():
        shutil.copy2(temp_exe_path, exe_path)
    
    if exe_path.exists():
        print(f"Successfully built: {exe_path}")
        print(f"File size: {exe_path.stat().st_size / (1024 * 1024):.2f} MB")
    else:
        print(f"Failed to build: {exe_path}")
        sys.exit(1)

if __name__ == '__main__':
    build_server()
