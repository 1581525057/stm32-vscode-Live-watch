# stm32-vscode-Live-watch

发布者：yezi  
版本：1.0.0  
类型：VS Code STM32 实时变量监视插件

`stm32-vscode-Live-watch` 是一个面向 STM32 开发调试的 VS Code 扩展。它通过 OpenOCD 的 TCL RPC 接口读取目标板内存，并结合 ELF 文件中的调试符号，把全局变量、结构体、数组等数据以树形视图展示在 VS Code 中，方便在调试时实时观察和修改变量值。

## 用途说明

这个插件主要解决 STM32 调试时“变量观察不直观、刷新不方便、复杂结构展开麻烦”的问题。适合使用 VS Code、Cortex-Debug、OpenOCD、GCC/ARM 工具链进行 STM32 开发的场景。

它的核心用途包括：

- 实时查看 STM32 目标板中的全局变量值。
- 通过 ELF 调试信息自动解析变量类型和地址。
- 支持结构体、数组、基础整型、浮点型等常见嵌入式数据。
- 支持手动添加变量表达式，并持久保存监视列表。
- 支持在 VS Code 中直接修改变量值，减少切换调试工具的成本。

## 工作原理

插件由两部分组成：

- VS Code 扩展端：负责界面、命令、变量树、用户交互和配置读取。
- 后端服务端：负责解析 ELF 文件、连接 OpenOCD、读取或写入目标板内存。

数据链路如下：

```text
VS Code 插件界面
    |
    | JSON 消息
    v
本地后端服务
    |
    | OpenOCD TCL RPC
    v
OpenOCD
    |
    | SWD / JTAG
    v
STM32 目标板
```

插件本身不直接烧录程序，也不替代 Cortex-Debug。它负责在已有调试环境上增加实时变量监视能力。

## 功能特点

### 实时变量监视

- 自动刷新变量值，默认刷新间隔为 250ms。
- 支持手动刷新全部变量。
- 支持变量树展开，便于查看结构体和数组成员。
- 监视列表会保存在工作区配置中，重新打开工程后可以继续使用。

### ELF 符号解析

- 自动读取 ELF 文件中的全局变量信息。
- 支持配置固定 ELF 路径。
- 当未配置 ELF 路径时，会尝试查找 `build/*.elf`。
- 通过调试信息判断变量类型、大小和成员布局。

### OpenOCD 通信

- 默认连接 `127.0.0.1:50001`。
- 使用 OpenOCD TCL RPC 读取目标板内存。
- 支持批量读取连续内存，减少通信开销。

### 变量操作

- 添加变量监视。
- 编辑变量值。
- 重命名变量显示表达式。
- 删除不需要的变量。
- 展开结构体或数组子项。

## 环境要求

使用前需要准备：

- VS Code 1.85.0 或更高版本。
- OpenOCD，并确认 TCL RPC 端口可用。
- Cortex-Debug 扩展，推荐配合使用。
- 带调试信息的 ELF 文件。
- 如果不使用已打包的后端可执行文件，需要 Python 3.8+ 和 `pyelftools`。

## 安装方式

### 从 VSIX 安装

1. 获取插件 `.vsix` 文件。
2. 打开 VS Code。
3. 按 `Ctrl+Shift+P`。
4. 执行 `Extensions: Install from VSIX...`。
5. 选择 `.vsix` 文件完成安装。

### 从源码构建

```bash
git clone https://github.com/1581525057/stm32-vscode-Live-watch.git
cd stm32-vscode-Live-watch
npm install
npm run compile
npx vsce package
```

## 使用步骤

### 1. 启动 OpenOCD

根据芯片型号和调试器选择对应配置，例如：

```bash
openocd -f interface/stlink.cfg -f target/stm32f4x.cfg
```

需要确认 OpenOCD 的 TCL RPC 端口已经开启。插件默认使用端口 `50001`。

### 2. 启动 VS Code 调试

建议通过 Cortex-Debug 启动调试会话。目标板进入调试状态后，插件可以更稳定地读取变量。

### 3. 启动插件服务

在命令面板执行：

```text
STM32 Debug: Start Server
```

如果服务启动成功，插件会尝试连接 OpenOCD 并加载 ELF 调试信息。

### 4. 添加变量

在变量视图中点击添加按钮，或在命令面板执行：

```text
STM32 Debug: Add Variable
```

可以输入：

```text
counter
motorSpeed
pidStatus.kp
adcBuffer
```

### 5. 查看和修改变量

- 变量值会按刷新间隔自动更新。
- 双击变量或右键菜单可以编辑变量值。
- 结构体和数组可以展开查看子项。
- 不再需要的变量可以右键删除。

## 配置项

在 VS Code 设置中搜索 `STM32 Debug Helper`，可以修改以下配置：

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `stm32DebugHelper.pythonPath` | string | `python3` | Python 解释器路径，仅在使用脚本服务时需要 |
| `stm32DebugHelper.elfPath` | string | 空 | ELF 文件路径，留空时尝试自动检测 |
| `stm32DebugHelper.openocdHost` | string | `127.0.0.1` | OpenOCD TCL RPC 主机地址 |
| `stm32DebugHelper.openocdPort` | number | `50001` | OpenOCD TCL RPC 端口 |
| `stm32DebugHelper.refreshInterval` | number | `250` | 变量刷新间隔，单位毫秒 |

## 命令列表

| 命令 | 用途 |
| --- | --- |
| `STM32 Debug: Start Server` | 启动后端服务 |
| `STM32 Debug: Stop Server` | 停止后端服务 |
| `STM32 Debug: Refresh Variables` | 手动刷新全部变量 |
| `STM32 Debug: Add Variable` | 添加变量监视 |
| `STM32 Debug: Show Variables` | 显示变量面板 |

## 构建说明

常用构建命令：

```bash
npm install
npm run compile
```

打包 VS Code 插件：

```bash
npx vsce package
```

打包后端服务：

```bash
npm run package:server
```

后端可执行文件会放在 `bin/` 目录：

- Windows：`bin/server-windows.exe`
- macOS：`bin/server-macos`
- Linux：`bin/server-linux`

## 项目结构

```text
stm32-vscode-Live-watch/
├─ src/                         # VS Code 扩展源码
│  ├─ extension.ts              # 插件入口，注册命令和视图
│  ├─ serverClient.ts           # 后端服务通信封装
│  ├─ variableTreeDataProvider.ts # 变量树视图数据提供器
│  └─ models/                   # 变量数据模型
├─ resources/
│  ├─ server.py                 # 后端服务脚本
│  ├─ icon.jpg                  # 插件图标
│  └─ icon.svg                  # 活动栏图标
├─ bin/                         # 已打包的后端可执行文件
├─ build_server.py              # 后端服务打包脚本
├─ copy-server.js               # 发布前复制后端文件
├─ package.json                 # VS Code 插件清单
└─ README.md                    # 使用说明
```

## 常见问题

### 服务无法启动

- 确认插件目录中存在对应平台的后端可执行文件。
- 如果使用 Python 模式，确认 Python 和 `pyelftools` 已安装。
- 查看 VS Code 输出面板中的插件日志。

### 连接不上 OpenOCD

- 确认 OpenOCD 正在运行。
- 确认 `openocdHost` 和 `openocdPort` 配置正确。
- 使用 `telnet 127.0.0.1 50001` 检查 TCL RPC 端口是否可访问。

### 变量显示为 N/A

- 确认目标板程序和 ELF 文件匹配。
- 确认变量是全局变量或可被 ELF 调试信息解析。
- 确认目标板处于可读状态，必要时在断点处暂停。

### 结构体无法正确展开

- 确认编译时保留了调试信息，例如使用 `-g`。
- 避免使用被编译器优化掉的变量。
- 如开启高等级优化，建议调试阶段降低优化等级。

## 发布信息

- 插件名：`stm32-vscode-Live-watch`
- 发布者：`yezi`
- 当前版本：`1.0.0`
- 远程仓库：<https://github.com/1581525057/stm32-vscode-Live-watch>

## 许可证

本项目使用 MIT License，详见 [LICENSE.md](LICENSE.md)。
