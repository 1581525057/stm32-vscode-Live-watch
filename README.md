# stm32-vscode-Live-watch

发布者：yezi  
版本：1.1  
适用场景：VS Code + EIDE + Cortex-Debug + OpenOCD 的 STM32 实时变量观察

`stm32-vscode-Live-watch` 是一个用于 STM32 调试阶段的 VS Code 插件。它的目标不是替代调试器，而是在已有调试流程上增加一个更顺手的实时变量监视面板：工程编译出 `.axf` 后，插件可以自动生成 `.elf`，再通过 ELF 调试信息和 OpenOCD 读取目标板变量。

## 这个插件解决什么问题

很多 STM32 工程在 VS Code/EIDE 中编译后产物是 `.axf`，而实时变量解析通常更依赖 ELF 调试信息。手动找文件、手动转换、手动配置路径会打断调试节奏。

这个插件把这套流程串起来：

1. 找到当前工作区里的 EIDE 工程。
2. 只从 EIDE 配置的输出目录里寻找 `.axf`。
3. 使用 Keil `fromelf` 把 `.axf` 转成 `.elf`。
4. 自动把生成的 `.elf` 写回 `stm32DebugHelper.elfPath`。
5. 启动后端服务，读取全局变量并在 VS Code 面板中实时刷新。

## 主要功能

- 实时查看 STM32 全局变量。
- 支持添加、删除、重命名监视变量。
- 支持结构体、数组和基础类型的树形展示。
- 支持变量值自动刷新和手动刷新。
- 支持通过 OpenOCD TCL RPC 读取目标板内存。
- 支持 EIDE `.axf` 自动转换 `.elf`。
- 支持手动执行 `Generate ELF from AXF`。
- 支持自动写回生成后的 ELF 路径，减少重复配置。

## AXF 转 ELF 机制

1. 插件会从 VS Code 当前工作区开始扫描 EIDE 工程。
2. 只有包含 `.eide/eide.yml` 的目录会被认为是 EIDE 工程目录。
3. 插件读取 `.eide/eide.yml` 中的 `outDir`。
4. 如果没有配置 `outDir`，默认使用 `build`。
5. 插件只在 EIDE 输出目录中查找 `.axf`。
6. 插件不会读取 `MDK-ARM` 目录里的 `.axf`，避免误用 MDK 工程产物。
7. 找到 `.axf` 后，插件会在同目录生成同名 `.elf`。

示例：

```text
你的工程/
├─ .eide/
│  └─ eide.yml
├─ build/
│  └─ app.axf
└─ build/
   └─ app.elf
```

转换命令等价于：

```bash
fromelf.exe --elf --output build/app.elf build/app.axf
```

插件会优先使用已经配置的 `stm32DebugHelper.fromelfPath`。如果没有配置，会尝试从系统 `PATH` 和常见 Keil 安装目录中寻找 `fromelf.exe`。

## 自动启动流程

启动调试或执行启动命令时，插件会按下面顺序寻找 ELF：

1. 如果 `stm32DebugHelper.elfPath` 已配置且文件存在，直接使用。
2. 如果工作区已有可用 `.elf`，优先复用。
3. 如果没有可用 `.elf`，查找 EIDE 输出目录中的 `.axf`。
4. 如果 `.axf` 比同名 `.elf` 更新，自动重新转换。
5. 转换成功后，把 `.elf` 路径写回工作区配置。
6. 使用最终 ELF 启动变量监视服务。

这个流程的目的很简单：你只需要正常编译 EIDE 工程，然后启动调试，插件会尽量自动补齐 ELF 路径。

## 面板按钮

在 `STM32 Variables` 面板右上角可以看到 `Generate ELF from AXF` 按钮。它适合在以下情况手动使用：

- 刚刚重新编译 EIDE 工程。
- 想立即刷新 `.elf` 文件。
- 自动启动前想先确认 AXF 转 ELF 是否能正常执行。
- 修改了 `fromelf.exe` 路径后想手动验证。

## 安装

### 从 VSIX 安装

1. 获取 `stm32-vscode-Live-watch-1.1.0.vsix`。
2. 打开 VS Code。
3. 按 `Ctrl+Shift+P`。
4. 执行 `Extensions: Install from VSIX...`。
5. 选择 VSIX 文件安装。

### 从源码构建

```bash
git clone https://github.com/1581525057/stm32-vscode-Live-watch.git
cd stm32-vscode-Live-watch
npm install
npm run compile
npx vsce package
```

## 使用前准备

需要准备：

- VS Code 1.85.0 或更高版本。
- EIDE 工程，并且工程目录包含 `.eide/eide.yml`。
- OpenOCD，可通过 TCL RPC 端口访问。
- Cortex-Debug，推荐用于启动 STM32 调试会话。
- Keil `fromelf.exe`，用于把 `.axf` 转成 `.elf`。

如果 `fromelf.exe` 不在系统路径中，可以手动配置。

## 配置项

在 VS Code 设置中搜索 `stm32-vscode-Live-watch` 或 `STM32 Debug Helper`。

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `stm32DebugHelper.elfPath` | 空 | 手动指定 ELF 文件路径 |
| `stm32DebugHelper.fromelfPath` | 空 | 手动指定 Keil `fromelf.exe` 路径 |
| `stm32DebugHelper.openocdHost` | `127.0.0.1` | OpenOCD TCL RPC 地址 |
| `stm32DebugHelper.openocdPort` | `50001` | OpenOCD TCL RPC 端口 |
| `stm32DebugHelper.refreshInterval` | `250` | 变量刷新间隔，单位毫秒 |
| `stm32DebugHelper.pythonPath` | `python3` | 使用 Python 后端脚本时的解释器路径 |

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `STM32 Debug: Generate ELF from AXF` | 从 EIDE `.axf` 生成 `.elf` |
| `STM32 Debug: Start Server` | 启动变量监视服务 |
| `STM32 Debug: Stop Server` | 停止变量监视服务 |
| `STM32 Debug: Add Variable` | 添加一个变量到监视列表 |
| `STM32 Debug: Refresh Variables` | 手动刷新变量值 |
| `STM32 Debug: Show Variables` | 显示变量面板 |

## 推荐使用流程

1. 用 EIDE 正常编译 STM32 工程。
2. 确认输出目录里生成了 `.axf`。
3. 启动 OpenOCD。
4. 在 VS Code 中启动 Cortex-Debug 调试。
5. 打开 `STM32 Variables` 面板。
6. 如果需要，点击 `Generate ELF from AXF`。
7. 执行 `STM32 Debug: Start Server`。
8. 添加要观察的变量名。

变量示例：

```text
counter
robotState
motor.speed
pidLoop.kp
adcBuffer
```

## 构建和测试

编译 TypeScript：

```bash
npm run compile
```

测试 AXF/ELF 路径解析逻辑：

```bash
npm run test:elf
```

打包 VS Code 插件：

```bash
npx vsce package
```

后端服务打包：

```bash
npm run package:server
```

## 项目结构

```text
stm32-vscode-Live-watch/
├─ src/
│  ├─ extension.ts              # 插件入口，注册命令、视图和自动启动逻辑
│  ├─ elfResolver.ts            # EIDE AXF 查找、fromelf 定位和 ELF 生成逻辑
│  ├─ elfResolver.test.ts       # AXF/ELF 解析逻辑测试
│  ├─ serverClient.ts           # VS Code 扩展与后端服务通信
│  ├─ variableTreeDataProvider.ts # 变量树视图和刷新逻辑
│  └─ models/
├─ resources/
│  ├─ icon.jpg                  # 插件展示图标
│  ├─ icon.svg                  # VS Code 活动栏图标
│  └─ server.py                 # 后端变量读取服务
├─ bin/                         # 后端可执行文件
├─ package.json                 # 插件清单、命令、配置项和脚本
└─ README.md                    # 当前说明文档
```

## 注意事项

- AXF 自动转换只面向 EIDE 工程。
- 插件不会主动读取 `MDK-ARM` 目录。
- 如果 EIDE 的 `outDir` 配错，插件也会跟着找错目录。
- 如果找不到 `fromelf.exe`，需要配置 `stm32DebugHelper.fromelfPath`。
- 如果变量显示异常，先确认 ELF 和当前烧录到板子的程序一致。
- 如果启用了高等级编译优化，部分变量可能被优化掉，调试阶段建议保留调试信息并降低优化等级。

## 常见问题

### 找不到 AXF

确认工程里存在 `.eide/eide.yml`，并检查 `outDir` 指向的目录中是否真的有 `.axf`。

### 找不到 fromelf.exe

可以在 VS Code 设置中配置：

```text
stm32DebugHelper.fromelfPath = D:\Keil5\ARM\ARMCLANG\bin\fromelf.exe
```

也可以把 `fromelf.exe` 所在目录加入系统 `PATH`。

### 生成了 ELF 但变量没有值

检查三件事：

- ELF 是否对应当前目标板程序。
- OpenOCD 是否正在运行。
- 目标板是否处于可读取调试状态。

### 不想自动转换 AXF

直接配置 `stm32DebugHelper.elfPath` 到一个固定 ELF 文件即可。只要该文件存在，插件会优先使用它。

## 致谢

感谢以下项目和工具提供基础能力与思路参考：

- [pyelftools](https://github.com/eliben/pyelftools) - ELF 文件解析。
- [OpenOCD](https://openocd.org/) - 片上调试工具。
- [Cortex-Debug](https://github.com/Marus/cortex-debug) - ARM Cortex 调试扩展。
- `stm32-debug-helper` - 实时变量监视插件的思路程序参考。

## 发布信息

- 插件名：`stm32-vscode-Live-watch`
- 发布者：`yezi`
- 版本：`1.1`
- 仓库：<https://github.com/1581525057/stm32-vscode-Live-watch>
- 许可证：MIT，详见 [LICENSE.md](LICENSE.md)
