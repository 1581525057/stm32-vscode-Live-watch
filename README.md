<div align="center">

# 🔬 STM32 Live Watch

**Real-time Variable Monitor & Chart Visualization for VS Code**

[![Version](https://img.shields.io/badge/version-4.0.3-blue?style=flat-square)](https://github.com/1581525057/stm32-vscode-Live-watch/releases)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85.0+-007ACC?style=flat-square&logo=visual-studio-code)](https://code.visualstudio.com/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Win32-lightgrey?style=flat-square)](https://github.com/1581525057/stm32-vscode-Live-watch)

**中文** | [English](README_EN.md)

---

![STM32 Live Watch Demo](resources/icon.jpg)

</div>

## 📖 Overview

`stm32-vscode-Live-watch` is a VS Code extension designed for STM32 debugging. It provides a real-time variable monitoring interface alongside your existing EIDE, Cortex-Debug, and OpenOCD workflow.

<div align="center">

### 🎯 What It Does

```
┌─────────────────────────────────────────────────────────────┐
│  VS Code Extension UI                                       │
│  ├── 📊 Real-time Variable Tree                             │
│  ├── 📈 Live Chart Visualization                            │
│  └── ⚡ Quick Variable Editing                              │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Python Backend Service                                     │
│  ├── 🔍 ELF/DWARF Parser                                    │
│  └── 🔌 OpenOCD TCL RPC Client                              │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  STM32 Target Board                                         │
│  └── 💾 Memory Read/Write via Debug Interface               │
└─────────────────────────────────────────────────────────────┘
```

</div>

## ✨ Key Features

<div align="center">

| Feature | Description |
|:-------:|:-----------|
| 🔍 | **Real-time Variable Monitoring** - Watch variables update live at 250ms intervals |
| 📈 | **Live Chart Visualization** - Plot multiple variables with customizable time windows |
| ✏️ | **Quick Value Editing** - Modify variable values directly from the tree view |
| 🔄 | **Auto AXF→ELF Conversion** - Seamless integration with EIDE build system |
| 🎨 | **VS Code Theme Integration** - Adapts to your current VS Code theme |
| 📊 | **Multi-page Support** - Organize variables across multiple watch pages |
| 🚀 | **High Performance** - Optimized polling scheduler and batch memory reads |

</div>

## 🚀 Quick Start

### Installation

<div align="center">

#### Option 1: Install from GitHub Releases (Recommended)

[![Download VSIX](https://img.shields.io/badge/📥_Download-v4.0.3-blue?style=for-the-badge&logo=github)](https://github.com/1581525057/stm32-vscode-Live-watch/releases/tag/v4.0.3)

</div>

1. Download the latest `.vsix` file from [Releases](https://github.com/1581525057/stm32-vscode-Live-watch/releases)
2. Open VS Code
3. Press `Ctrl+Shift+P`, type `vsix`, select `Extensions: Install from VSIX...`
4. Select the downloaded `.vsix` file

#### Option 2: Build from Source

```bash
# Clone the repository
git clone https://github.com/1581525057/stm32-vscode-Live-watch.git
cd stm32-vscode-Live-watch

# Install dependencies and build
npm install
npm run compile
npx vsce package
```

### Prerequisites

<div align="center">

| Requirement | Version | Purpose |
|:-----------:|:-------:|:-------:|
| ![VS Code](https://img.shields.io/badge/VS_Code-1.85.0+-007ACC?style=flat-square&logo=visual-studio-code) | 1.85.0+ | IDE |
| ![Node.js](https://img.shields.io/badge/Node.js-16+-339933?style=flat-square&logo=node.js) | 16+ | Build Tool |
| ![EIDE](https://img.shields.io/badge/EIDE-Latest-FF6B35?style=flat-square) | Latest | Project Management |
| ![OpenOCD](https://img.shields.io/badge/OpenOCD-Any-00599C?style=flat-square) | Any | Debug Interface |

</div>

## 📸 Screenshots

<div align="center">

### Variable Tree View
```
┌─────────────────────────────────────┐
│ 📊 ━━━ Watch1 ━━━     Page 1/2 • 3 │
├─────────────────────────────────────┤
│ ▸ pid_yaw { ··· }                   │
│   ├─ Kp = 1.5                       │
│   ├─ Ki = 0.3                       │
│   └─ Kd = 0.1                       │
│ ▸ sensor_data { ··· }               │
│   ├─ temperature = 25.6             │
│   └─ humidity = 60.2                │
└─────────────────────────────────────┘
```

### Live Chart
```
┌─────────────────────────────────────┐
│ ⏸ Pause │ 🗑 Clear │ Window: 10s   │
├─────────────────────────────────────┤
│    ╭──╮                            │
│ ───╯  ╰─────╮                      │
│              ╰──────                │
│ ● Kp: 1.5  ● Ki: 0.3  ● Kd: 0.1  │
└─────────────────────────────────────┘
```

</div>

## 🎮 Usage

### Basic Workflow

```
1️⃣  Build your EIDE project
      ↓
2️⃣  Start OpenOCD with TCL RPC
      ↓
3️⃣  Launch Cortex-Debug session
      ↓
4️⃣  Open STM32 Live Watch panel
      ↓
5️⃣  Click "Start Server"
      ↓
6️⃣  Add variables to watch
      ↓
7️⃣  Monitor & Analyze!
```

### Adding Variables

**Method 1: Manual Input**
- Click `+ Add Variable` button
- Enter variable name (e.g., `pid_yaw`)

**Method 2: From Editor**
- Select variable name in C/C++ code
- Right-click → `STM32 Live Watch: Add Selected Variable`

### Chart Controls

| Control | Action |
|:-------:|:-------|
| `+ Add` | Add variable to chart |
| `⏸ Pause` | Freeze chart for inspection |
| `▶ Resume` | Resume data collection |
| `🗑 Clear` | Clear all chart data |
| `Window` | Set time window (10s/30s/60s/120s) |
| `Interval` | Set refresh rate (20ms/50ms/100ms/250ms) |

## ⚙️ Configuration

<div align="center">

| Setting | Default | Description |
|:-------:|:-------:|:-----------:|
| `stm32LiveWatch.elfPath` | `""` | Manual ELF file path |
| `stm32LiveWatch.fromelfPath` | `""` | Keil fromelf.exe path |
| `stm32LiveWatch.openocdHost` | `127.0.0.1` | OpenOCD host |
| `stm32LiveWatch.openocdPort` | `50001` | OpenOCD TCL RPC port |
| `stm32LiveWatch.refreshInterval` | `250` | Variable refresh (ms) |
| `stm32LiveWatch.chartRefreshInterval` | `100` | Chart refresh (ms) |
| `stm32LiveWatch.chartTimeWindow` | `10` | Chart time window (s) |

</div>

## 📋 Commands

<div align="center">

| Command | Description |
|:-------:|:-----------:|
| `Start Server` | Start variable monitoring service |
| `Stop Server` | Stop variable monitoring service |
| `Add Variable` | Add variable to watch list |
| `Add Selected Variable` | Add selected variable from editor |
| `Refresh Variables` | Manual refresh variable values |
| `Generate ELF from AXF` | Convert EIDE AXF to ELF |
| `Configure ELF Path` | Manual ELF file configuration |
| `Edit Variable Value` | Modify variable value |
| `Add to Chart` | Add variable to chart visualization |

</div>

## 🔧 Supported Types

```
✅ Basic Types
   ├── int, uint8_t, float, double, etc.
   └── Enum: displays value and name

✅ Composite Types
   ├── Struct: expandable members
   ├── Class: public members
   ├── Array: indexed elements [0], [1], ...
   └── Union: shared memory members

✅ Special Types
   ├── String: char arrays
   └── Pointer: address display
```

## 📁 Project Structure

```
stm32-vscode-Live-watch/
├── 📂 src/
│   ├── 📄 extension.ts              # Extension entry point
│   ├── 📄 elfResolver.ts            # ELF/DWARF parser
│   ├── 📄 serverClient.ts           # Backend communication
│   ├── 📄 pollScheduler.ts          # Polling scheduler
│   ├── 📄 variableTreeDataProvider.ts # Variable tree UI
│   ├── 📄 chartPanel.ts             # Chart webview
│   ├── 📄 chartManager.ts           # Chart data management
│   └── 📄 axfWatcher.ts             # AXF file watcher
├── 📂 resources/
│   ├── 🖼️ icon.jpg                  # Extension icon
│   ├── 📄 chart.html                # Chart webview template
│   └── 📄 chart.js                  # Chart rendering script
├── 📂 bin/                          # Backend executables
├── 📂 tests/                        # Test files
└── 📄 package.json                  # Extension manifest
```

## 🐛 Troubleshooting

<details>
<summary><b>❓ Cannot find AXF file</b></summary>

- Ensure your project has `.eide/eide.yml`
- Check if `outDir` contains `.axf` files
- Verify EIDE build completed successfully

</details>

<details>
<summary><b>❓ Cannot find fromelf.exe</b></summary>

Configure in VS Code settings:
```
stm32LiveWatch.fromelfPath = D:\Keil5\ARM\ARMCLANG\bin\fromelf.exe
```
Or add `fromelf.exe` directory to system PATH.

</details>

<details>
<summary><b>❓ Variables show no value</b></summary>

Check:
- ELF matches current firmware on target board
- OpenOCD is running and accessible
- Target board is in debug state (halted)

</details>

<details>
<summary><b>❓ C++ class won't expand</b></summary>

- Add object instance name, not class name
- ✅ Correct: `pid_yaw`
- ❌ Wrong: `PID`
- Ensure debug info is enabled (`-g` flag)

</details>

## 📊 Version History

<div align="center">

| Version | Date | Highlights |
|:-------:|:----:|:-----------|
| `4.0.3` | 2026-06-01 | Enhanced page indicator with decorative separators |
| `4.0.2` | 2026-06-01 | Watch page indicator UI improvements |
| `4.0.1` | 2026-06-01 | Remove drag restrictions for struct/class/array |
| `4.0.0` | 2026-06-01 | Chart UI improvements, 120s window, 50Hz refresh |
| `3.7.0` | 2026-05-11 | Unified poll scheduler, DWARF cache, SVG icons |
| `3.5.0` | 2026-05-05 | AC5/AC6 compiler compatibility, performance optimization |
| `3.3.0` | 2026-05-04 | Bug fixes, union support, enum fixes |
| `3.1.0` | 2026-05-03 | Chart theme adaptation, statistics, export |
| `3.0.0` | 2026-05-02 | Variable chart visualization module |
| `2.1.0` | 2026-05-01 | Variable display optimization |

</div>

## 🙏 Acknowledgments

This project references [stm32-debug-helper](https://github.com/ZEALHT001/stm32-debug-helper). Thanks to the author for the source code ideas.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Made with ❤️ by [ciyueYe](https://github.com/1581525057)**

![GitHub Stars](https://img.shields.io/github/stars/1581525057/stm32-vscode-Live-watch?style=social)
![GitHub Forks](https://img.shields.io/github/forks/1581525057/stm32-vscode-Live-watch?style=social)

</div>
