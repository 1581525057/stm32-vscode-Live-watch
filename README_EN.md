# STM32 Live Watch

[中文](README.md) | **English**

Publisher: yezi
Version: 3.3.0
Use case: Real-time variable monitoring and chart visualization for VS Code + EIDE + Cortex-Debug + OpenOCD

`stm32-vscode-Live-watch` is a VS Code extension for STM32 debugging. It doesn't replace your debugger — it adds a real-time variable monitoring interface alongside your existing EIDE, Cortex-Debug, and OpenOCD workflow. Compile your project, start debugging, add variables, and the extension resolves variable addresses from ELF debug info and reads target memory via OpenOCD.

## Background

This project originated from the practical needs of Lab 1034 at Shenzhen Technology University (sztu1034). During embedded development, debugging variables often requires multiple external tools — Keil Watch windows, logic analyzers, serial plotter tools, and standalone host software. Frequent tool switching and繁琐 configuration is especially burdensome for PID tuning, sensor data observation, and other scenarios requiring real-time waveform visualization.

This extension integrates these capabilities into VS Code, enabling developers to write code, monitor variables, and observe waveforms within a single editor — eliminating complex toolchain setup and extra development work for graphical monitoring.

The concept and design were conceived by the author over a long period, with AI-assisted implementation during the 2026 May Day holiday. From coding to releasing v3.0.0 took only 3 days. AI provided efficient assistance in architecture implementation, code writing, and documentation, turning a long-incubated idea into a working product.

## What Problem It Solves

Many STM32 projects compile to `.axf` in EIDE, but real-time variable parsing requires ELF debug info. Manually finding files, converting ELF, configuring paths, and starting the backend service interrupts the debugging flow.

This extension streamlines the process:

1. Detects EIDE project from the current VS Code workspace.
2. Reads EIDE output directory from `.eide/eide.yml`.
3. Searches for `.axf` in the EIDE output directory.
4. Uses Keil `fromelf.exe` to generate `.elf`.
5. Writes the generated ELF path to workspace configuration.
6. Starts the backend variable service.
7. Reads target memory via OpenOCD TCL RPC.
8. Refreshes variable values in the VS Code sidebar in real time.

## Why EIDE

### 1. Keil Project Compatibility for Smooth Migration

EIDE offers strong compatibility with Keil projects, reusing code structure, header paths, startup files, macros, and build configurations from existing Keil MDK projects. This lowers migration cost while combining VS Code's extension ecosystem, IntelliSense, Git integration, and debug extensions for improved development efficiency.

### 2. ARMClang and GCC Compiler Support

EIDE supports ARMClang, ARMCC, and GCC toolchains. Developers can choose the build environment that fits their project — ARMClang for Keil compatibility, or GCC for open-source ecosystem and cross-platform development.

## How It Works

The extension has three layers:

```text
VS Code Extension UI
  ↓ commands / TreeView / configuration
TypeScript Extension Host
  ↓ JSON stdin/stdout
Python Backend / server-windows.exe
  ↓ OpenOCD TCL RPC
OpenOCD
  ↓ memory read
STM32 Target
```

### 1. ELF Debug Info Parsing

The backend uses `pyelftools` to read ELF/DWARF info. It scans global variable DIEs, resolves variable names, types, addresses, and member structures, then builds a variable tree.

Supported types:

- Integer and float types: `int`, `uint8_t`, `float`, `double`, etc.
- Enumerations: displays value and enum name when matched.
- Arrays: expands as `[0]`, `[1]`, etc.
- Character arrays: read as strings.
- C structs: expands by members.
- C++ classes: expands visible members, supports `DW_AT_specification` and `DW_AT_abstract_origin` indirect references.

Example:

```cpp
PID pid_yaw;
```

After adding `pid_yaw`, the variable tree shows:

```text
pid_yaw
└─ pid
   ├─ max_out
   ├─ intergral_limit
   ├─ deadband
   ├─ Kp
   ├─ Ki
   ├─ Kd
   ├─ output_fiter_factor
   └─ improve
```

### 2. Address Resolution

The backend first reads `DW_AT_location` from the variable DIE. If unavailable, it falls back to matching the variable name in the `.symtab` symbol table.

This is important for C++ because global variables may have mangled symbol names. The extension uses suffix and substring matching to find the actual address.

### 3. Memory Reading

Directly readable variables are batch-read:

- 1/2/4-byte values use OpenOCD `mdw` batch reads.
- 8-byte integers and `double` use byte-level reads.
- Strings use `mdb` byte reads with `\0` termination.
- Structs and arrays are not read directly — only their leaf members.

This minimizes OpenOCD calls during frequent refreshes.

### 4. Auto Refresh

The extension refreshes readable variables at the `stm32LiveWatch.refreshInterval` interval (default `250ms`). UI updates only trigger when values change, reducing VS Code redraw overhead.

## Interface

After installation, a `STM32 Live Watch` icon appears in the activity bar. It contains two side-by-side panels, plus a Variable Chart panel in the bottom panel area.

### 1. Variable Monitor

This panel contains the variable tree.

Toolbar buttons (right side of panel title bar):

| Button | Purpose |
| --- | --- |
| `Start Server` | Start the variable monitoring backend |
| `Stop Server` | Stop the variable monitoring backend |
| `Add Variable` | Add a variable to the watch list |
| `Refresh Variables` | Clear cache and manually refresh variables |

Variable tree interactions:

| Action | Behavior |
| --- | --- |
| Click expandable variable | Expand struct, class, or array members |
| Click a leaf variable | Edit variable value |
| Right-click root variable | Rename or delete root variable |
| Right-click leaf variable | Edit value |

Notes:

- Root variables are expressions you manually add, e.g. `pid_yaw`.
- Member variables are child nodes resolved by the extension, e.g. `pid_yaw.pid.Kp`.
- Delete and rename only apply to root variables.
- Structs, classes, and arrays cannot be written directly — expand and edit their leaf members.

### 2. Operations

This panel contains less-frequently-used but important project operations.

| Action | Purpose |
| --- | --- |
| `Configure ELF Path` | Manually select an `.elf` file and write to `stm32LiveWatch.elfPath` |
| `Generate ELF from AXF` | Manually generate `.elf` from EIDE `.axf` |

### 3. Variable Chart

A real-time line chart in the bottom panel area for observing variable trends over time. Ideal for PID tuning, signal analysis, etc.

Toolbar buttons:

| Button | Purpose |
| --- | --- |
| `+ Add` | Open input box to add a variable to the chart |
| `⏸ Pause` | Pause data collection, freeze chart for history review |
| `▶ Resume` | Resume data collection |
| `🗑 Clear` | Clear all history data |
| `Window` dropdown | Adjust time window: 5s / 10s / 30s / 60s |
| `Interval` dropdown | Adjust collection interval: 50ms / 100ms / 250ms |

Legend area:

- Shows color, name, and current value for each variable.
- Click `✕` to remove a variable from the chart.

Chart interactions:

| Action | Behavior |
| --- | --- |
| Hover | Show precise value tooltip |
| Mouse wheel | Zoom time axis |
| Right-click variable in monitor panel | Select "Add to Chart" |

## Usage

### Recommended Workflow

1. Compile your STM32 project with EIDE.
2. Confirm `.axf` exists in the output directory.
3. Start OpenOCD and ensure the TCL RPC port is accessible.
4. Start Cortex-Debug in VS Code.
5. Open `STM32 Live Watch` from the activity bar.
6. Click `Start Server`.
7. Click `Add Variable` and enter the variable name.
8. Expand the variable to view members and values.
9. To modify a value, click a leaf variable and enter the new value.

### Add Variable from Editor

Select a variable name in C/C++ code, e.g.:

```cpp
pid_yaw
```

Right-click and select:

```text
STM32 Live Watch: Add Selected Variable
```

The extension adds the selected variable to the watch list. If the server isn't running, it will attempt to start it.

### Using the Variable Chart

1. Add variables in the monitor panel and confirm they have values.
2. Switch to the `Variable Chart` tab in the bottom panel.
3. Right-click a variable in the monitor panel and select `Add to Chart`, or click `+ Add` in the chart panel.
4. The chart starts plotting in real time. Hover to see precise values.
5. Use the `Window` dropdown to adjust the time range, scroll wheel to zoom.
6. Click `⏸ Pause` to freeze the chart for history review.
7. Click `✕` in the legend to remove unwanted variables.

### Adding C++ Class Variables

Add the object instance name, not the type name.

Source code:

```cpp
PID pid_yaw;
```

Correct:

```text
pid_yaw
```

Wrong:

```text
PID
```

After adding, you can expand public members:

```text
pid_yaw.pid.Kp
pid_yaw.pid.Ki
pid_yaw.pid.Kd
```

### Manual ELF Configuration

If the extension doesn't automatically find the ELF:

1. Expand `2. Operations`.
2. Click `Configure ELF Path`.
3. Select the `.elf` file for your current firmware.
4. Click `Start Server`.

### Generate ELF from AXF

After recompiling an EIDE project, manually run:

```text
Generate ELF from AXF
```

The extension searches for `.axf` in the EIDE output directory and runs a command like:

```bash
fromelf.exe --elf --output build/app.elf build/app.axf
```

On success, `stm32LiveWatch.elfPath` is updated.

## AXF to ELF Conversion Rules

The extension only auto-detects AXF for EIDE projects:

1. Searches downward from the workspace for `.eide/eide.yml`.
2. Reads `outDir` from EIDE config.
3. Defaults to `build` if `outDir` is not set.
4. Only searches the EIDE output directory for `.axf`.
5. Does not read `MDK-ARM` directory `.axf` files to avoid using artifacts from other projects.
6. Re-converts if `.axf` is newer than the corresponding `.elf`.
7. Writes the result back to workspace configuration.

## Installation

### Method 1: Download VSIX from GitHub Releases (Recommended)

1. Open the [Releases page](https://github.com/1581525057/stm32-vscode-Live-watch/releases).
2. Download the latest `.vsix` file, e.g. `stm32-vscode-Live-watch-3.3.0.vsix`.
3. Open VS Code.
4. Press `Ctrl+Shift+P`, type `vsix`, select `Extensions: Install from VSIX...`.
5. Select the downloaded `.vsix` file.
6. After installation, the `STM32 Live Watch` icon appears in the activity bar.

### Method 2: Build VSIX from Source

1. Clone the repository:
   ```bash
   git clone https://github.com/1581525057/stm32-vscode-Live-watch.git
   cd stm32-vscode-Live-watch
   ```

2. Install dependencies and package:
   ```bash
   npm install
   npm run compile
   npx vsce package
   ```

3. A `.vsix` file will be generated in the current directory.

4. In VS Code: `Ctrl+Shift+P` → `Extensions: Install from VSIX...` → select the generated file.

## Prerequisites

- VS Code 1.85.0 or later.
- EIDE project with `.eide/eide.yml` in the project directory.
- OpenOCD with accessible TCL RPC port.
- Cortex-Debug (recommended for starting STM32 debug sessions).
- Keil `fromelf.exe` for converting `.axf` to `.elf`.

If `fromelf.exe` is not in your system PATH, configure `stm32LiveWatch.fromelfPath` manually.

## Configuration

Search `STM32 Live Watch` in VS Code settings.

| Setting | Default | Purpose |
| --- | --- | --- |
| `stm32LiveWatch.elfPath` | empty | Manually specify ELF file path |
| `stm32LiveWatch.fromelfPath` | empty | Manually specify Keil `fromelf.exe` path |
| `stm32LiveWatch.openocdHost` | `127.0.0.1` | OpenOCD TCL RPC address |
| `stm32LiveWatch.openocdPort` | `50001` | OpenOCD TCL RPC port |
| `stm32LiveWatch.refreshInterval` | `250` | Variable refresh interval in milliseconds |
| `stm32LiveWatch.pythonPath` | `python3` | Python path when not using the executable backend |
| `stm32LiveWatch.chartRefreshInterval` | `100` | Chart data collection interval in ms (min 50) |
| `stm32LiveWatch.chartTimeWindow` | `10` | Chart time window in seconds |

## Commands

| Command | Description |
| --- | --- |
| `STM32 Live Watch: Start Server` | Start variable monitoring service |
| `STM32 Live Watch: Stop Server` | Stop variable monitoring service |
| `STM32 Live Watch: Add Variable` | Add variable to watch list |
| `STM32 Live Watch: Add Selected Variable` | Add selected variable from editor |
| `STM32 Live Watch: Refresh Variables` | Manually refresh variable values |
| `STM32 Live Watch: Generate ELF from AXF` | Generate `.elf` from EIDE `.axf` |
| `STM32 Live Watch: Configure ELF Path` | Manually configure `.elf` file |
| `STM32 Live Watch: Edit Variable Value` | Edit selected variable value |
| `STM32 Live Watch: Rename Variable Expression` | Rename root variable expression |
| `STM32 Live Watch: Delete Variable` | Delete root variable |
| `STM32 Live Watch: Show Variables` | Focus variable panel |
| `STM32 Live Watch: Add to Chart` | Add variable to chart (also via right-click) |
| `STM32 Live Watch: Show Chart Panel` | Focus chart panel |

## Build and Test

Compile TypeScript:

```bash
npm run compile
```

Test AXF/ELF path resolution:

```bash
npm run test:elf
```

Package VS Code extension:

```bash
npx vsce package
```

## Troubleshooting

### AXF Not Found

Confirm `.eide/eide.yml` exists in the project and check that `outDir` contains an `.axf` file.

### fromelf.exe Not Found

Configure in VS Code settings:

```text
stm32LiveWatch.fromelfPath = D:\Keil5\ARM\ARMCLANG\bin\fromelf.exe
```

Or add the directory containing `fromelf.exe` to your system `PATH`.

### Server Starts But Variables Show No Value

Check three things:

- The ELF matches the firmware currently flashed to the target.
- OpenOCD is running.
- The target is in a debug state that allows memory reading.

### C++ Class Won't Expand

Make sure you added the object instance name, not the class name.

Correct: `pid_yaw`
Wrong: `PID`

If it still won't expand, check that debug info is preserved in compilation. Use `-g` and lower optimization levels during debugging.

### Variable Write Failed

Structs, classes, and arrays cannot be written directly. Expand and edit their leaf members, e.g.:

```text
pid_yaw.pid.Kp
```

### Don't Want Auto AXF Conversion

Configure `stm32LiveWatch.elfPath` to a fixed ELF file. As long as the file exists, the extension will use it preferentially.

## Notes

- AXF auto-conversion only works for EIDE projects.
- High optimization levels may optimize out variables. Keep debug info during debugging.
- The ELF must match the current firmware on the target, otherwise addresses and values may be incorrect.
- OpenOCD TCL RPC port defaults to `50001` — keep it consistent with your configuration.
- Real-time refresh reads target memory. Very low intervals may increase debug link pressure.

## Project Structure

```text
stm32-vscode-Live-watch/
├─ src/
│  ├─ extension.ts                 # Extension entry, commands, views, auto-start logic
│  ├─ elfResolver.ts               # EIDE AXF lookup, fromelf location, ELF generation
│  ├─ serverClient.ts              # Communication between extension and backend
│  ├─ variableTreeDataProvider.ts  # Variable view and operations view
│  ├─ chartPanel.ts                # Chart panel WebviewView Provider
│  ├─ chartManager.ts              # Chart data collection and variable management
│  ├─ config.ts                    # Configuration reading and legacy config compat
│  └─ models/
├─ resources/
│  ├─ icon.jpg
│  ├─ icon.svg
│  ├─ server.py                    # Backend variable reading service
│  ├─ chart.html                   # Chart panel Webview HTML template
│  ├─ chart.js                     # Chart panel Chart.js rendering script
│  └─ chart.min.js                 # Chart.js library
├─ bin/                            # Backend executables
├─ package.json                    # Extension manifest, commands, views, config
└─ README.md
```

## Release Info

- Extension: `stm32-vscode-Live-watch`
- Publisher: `yezi`
- Version: `3.3.0`
- Repository: <https://github.com/1581525057/stm32-vscode-Live-watch>

## Acknowledgments

This project references [stm32-debug-helper](https://github.com/ZEALHT001/stm32-debug-helper). Thanks to the author for the source code inspiration.
