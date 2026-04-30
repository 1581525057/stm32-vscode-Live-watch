# STM32 Live Watch

发布者：yezi  
版本：2.1.0  
适用场景：VS Code + EIDE + Cortex-Debug + OpenOCD 的 STM32 实时变量观察

`stm32-vscode-Live-watch` 是一个面向 STM32 调试阶段的 VS Code 扩展。它不会替代调试器，而是在现有 EIDE、Cortex-Debug、OpenOCD 工作流旁边增加一个更直接的实时变量观察界面：你编译工程、启动调试、添加变量，扩展负责从 ELF 调试信息里解析变量地址，并通过 OpenOCD 读取目标板内存。

2.1.0 重点优化了变量显示可读性和文档表述：

- 变量名和值放到 TreeView 主文本区域，不再都挤在灰色说明文字里。
- 文档中统一使用“可直接读写的普通变量”这类用户容易理解的说法。
- 沿用双面板界面结构：`1. stm32livewatch实时变量查看` 和 `2. 操作` 是左侧栏里的两个同级面板。
- 继续支持 C++ class/struct 展开，例如 `PID pid_yaw;` 可以展开到 public 成员。

## 它解决什么问题

很多 STM32 工程在 EIDE 中编译后得到 `.axf`，而实时变量解析需要 ELF 调试信息。手动找文件、转换 ELF、配置路径、启动后端服务，会打断调试节奏。

这个扩展把流程串起来：

1. 从当前 VS Code 工作区识别 EIDE 工程。
2. 从 `.eide/eide.yml` 读取 EIDE 输出目录。
3. 在 EIDE 输出目录中寻找 `.axf`。
4. 使用 Keil `fromelf.exe` 生成 `.elf`。
5. 把生成后的 ELF 路径写入工作区配置。
6. 启动后端变量服务。
7. 通过 OpenOCD TCL RPC 读取目标板内存。
8. 在 VS Code 左侧栏实时刷新变量值。

## 为什么使用 EIDE

本扩展选择 EIDE 作为工程基础，主要有以下两点原因。

### 1. EIDE 支持 Keil 工程兼容，便于旧项目平滑迁移

EIDE 具有较好的 Keil 工程兼容能力，能够在较大程度上复用原有 Keil MDK 工程中的代码结构、头文件路径、启动文件、宏定义和编译配置，从而实现旧项目向 VS Code 开发环境的平滑迁移。这种兼容性降低了工程迁移成本，使已有代码能够继续使用，同时结合 VS Code 的插件生态、代码补全、Git 管理和调试扩展，提高了嵌入式项目的开发与维护效率。

### 2. 支持 ARMClang 和 GCC 编译器，开发选择更加灵活

EIDE 支持 ARMClang、ARMCC 和 GCC 等多种编译器工具链，开发者可以根据工程需求灵活选择编译环境。对于原有 Keil 项目，可以继续使用 ARMClang 以保证较高的代码兼容性；对于希望使用开源生态或跨平台开发的项目，也可以选择 GCC 工具链。这种多编译器支持增强了工程的适配能力，使嵌入式开发不再局限于单一 IDE 或单一工具链，提升了项目的灵活性、可移植性和可维护性。

## 工作原理

扩展由三层组成：

```text
VS Code 扩展界面
  ↓ 命令 / TreeView / 配置
TypeScript 扩展主进程
  ↓ JSON stdin/stdout
Python 后端服务 / server-windows.exe
  ↓ OpenOCD TCL RPC
OpenOCD
  ↓ 读取目标板内存
STM32 目标板
```

### 1. ELF 调试信息解析

后端使用 `pyelftools` 读取 ELF/DWARF 信息。它会扫描全局变量 DIE，解析变量名、类型、地址和成员结构，然后构建一棵变量树。

支持的典型类型：

- 基础整数和浮点类型：`int`、`uint8_t`、`float`、`double` 等。
- 枚举：显示数值，并在能匹配时显示枚举名。
- 数组：按 `[0]`、`[1]` 形式展开。
- 字符数组：作为字符串读取。
- C 结构体：按成员展开。
- C++ class：按可见成员展开，支持常见的 `DW_AT_specification`、`DW_AT_abstract_origin` 间接引用。

示例：

```cpp
PID pid_yaw;
```

添加 `pid_yaw` 后，变量树会显示：

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

### 2. 地址解析

后端优先读取变量 DIE 里的 `DW_AT_location`。如果位置属性不可用，会尝试从符号表 `.symtab` 中匹配变量名。

这对 C++ 很重要，因为 C++ 全局变量可能有符号修饰名。例如源码变量叫：

```cpp
PID pid_yaw;
```

符号表中可能是被修饰后的名字。扩展会用变量原名做后缀和包含匹配，尽量找到真实地址。

### 3. 内存读取

可直接读写的普通变量会被批量读取：

- 普通 1/2/4 字节值使用 OpenOCD `mdw` 批量读。
- 8 字节整数和 `double` 使用字节读取。
- 字符串使用 `mdb` 读取字节并按 `\0` 截断。
- 结构体和数组本身不直接读值，只展开内部成员。

这样可以减少频繁刷新时的 OpenOCD 调用次数。

### 4. 自动刷新

扩展会按照 `stm32LiveWatch.refreshInterval` 定时刷新可直接读写的普通变量。默认间隔是 `250ms`。只有值发生变化时才触发界面刷新，减少 VS Code UI 重绘压力。

## 界面说明

安装后，左侧活动栏会出现 `STM32 Live Watch` 图标。进入后有两个同级面板。

### 1. stm32livewatch实时变量查看

这个面板只放变量树。

常用按钮在面板标题栏右侧：

| 图标/命令 | 用途 |
| --- | --- |
| `Start Server` | 启动变量监视后端 |
| `Stop Server` | 停止变量监视后端 |
| `Add Variable` | 添加变量到监视列表 |
| `Refresh Variables` | 清空缓存并手动刷新变量 |

变量树中的交互：

| 操作 | 行为 |
| --- | --- |
| 点击可展开变量 | 展开结构体、class、数组成员 |
| 点击普通变量或成员变量 | 编辑变量值 |
| 右键根变量 | 可重命名或删除根变量 |
| 右键普通变量或成员变量 | 可编辑值 |

说明：

- 根变量是你主动添加的表达式，例如 `pid_yaw`。
- 成员变量是扩展解析出来的子节点，例如 `pid_yaw.pid.Kp`。
- 删除和重命名只作用于根变量，成员变量不需要单独删除。
- 结构体、class、数组本身不能直接写值，需要展开后编辑里面的普通成员。

### 2. 操作

这个面板放不常用但重要的工程操作。

| 操作 | 用途 |
| --- | --- |
| `Configure ELF Path` | 手动选择 `.elf` 文件，并写入 `stm32LiveWatch.elfPath` |
| `Generate ELF from AXF` | 从 EIDE `.axf` 手动生成 `.elf` |

`2. 操作` 是独立面板，不是变量树的子节点。变量树内容很多时，`1. stm32livewatch实时变量查看` 自己滚动，`2. 操作` 仍保持在左侧栏下面，方便随时展开使用。

## 使用流程

### 推荐流程

1. 用 EIDE 正常编译 STM32 工程。
2. 确认输出目录里有 `.axf`。
3. 启动 OpenOCD，并确保 TCL RPC 端口可用。
4. 在 VS Code 中启动 Cortex-Debug 调试。
5. 打开左侧 `STM32 Live Watch`。
6. 点击 `Start Server`。
7. 点击 `Add Variable`，输入变量名。
8. 展开变量，观察成员和值。
9. 需要修改值时，点击可直接编辑的普通变量或成员变量，并输入新值。

### 从编辑器右键添加变量

在 C/C++ 代码中选中变量名，例如：

```cpp
pid_yaw
```

右键选择：

```text
STM32 Live Watch: Add Selected Variable
```

扩展会直接把选中的变量名加入监视列表。如果服务还没启动，会先尝试启动服务。

### 添加 C++ class 变量

要添加对象实例名，不要添加类型名。

例如源码是：

```cpp
PID pid_yaw;
```

应该添加：

```text
pid_yaw
```

不应该添加：

```text
PID
```

添加后可以继续展开 public 成员：

```text
pid_yaw.pid.Kp
pid_yaw.pid.Ki
pid_yaw.pid.Kd
```

### 手动配置 ELF

如果扩展没有自动找到 ELF：

1. 展开 `2. 操作`。
2. 点击 `Configure ELF Path`。
3. 选择当前固件对应的 `.elf` 文件。
4. 再点击 `Start Server`。

### 手动从 AXF 生成 ELF

如果刚重新编译了 EIDE 工程，可以手动执行：

```text
Generate ELF from AXF
```

扩展会在 EIDE 输出目录中查找 `.axf`，并执行类似命令：

```bash
fromelf.exe --elf --output build/app.elf build/app.axf
```

生成成功后会更新 `stm32LiveWatch.elfPath`。

## AXF 转 ELF 规则

扩展只面向 EIDE 工程自动查找 AXF：

1. 从当前工作区向下查找 `.eide/eide.yml`。
2. 读取 EIDE 配置里的 `outDir`。
3. 如果没有 `outDir`，默认使用 `build`。
4. 只在 EIDE 输出目录中寻找 `.axf`。
5. 不主动读取 `MDK-ARM` 目录中的 `.axf`，避免误用其他工程产物。
6. 如果 `.axf` 比同名 `.elf` 更新，会重新转换。
7. 转换成功后写回工作区配置。

## 安装

### 方法一：从 GitHub Releases 下载 VSIX 安装（推荐）

1. 打开 [Releases 页面](https://github.com/1581525057/stm32-vscode-Live-watch/releases)。
2. 下载最新版本的 `.vsix` 文件，例如 `stm32-vscode-Live-watch-2.1.0.vsix`。
3. 打开 VS Code。
4. 按 `Ctrl+Shift+P`，输入 `vsix`，选择 `Extensions: Install from VSIX...`。
5. 在文件选择窗口中，找到刚才下载的 `.vsix` 文件，点击打开。
6. 安装完成后，左侧活动栏会出现 `STM32 Live Watch` 图标，表示安装成功。

### 方法二：从源码构建 VSIX

如果你熟悉命令行，也可以自己打包：

1. 克隆本仓库：
   ```bash
   git clone https://github.com/1581525057/stm32-vscode-Live-watch.git
   cd stm32-vscode-Live-watch
   ```

2. 安装依赖并打包：
   ```bash
   npm install
   npm run compile
   npx vsce package
   ```

3. 执行完毕后，当前目录下会生成 `.vsix` 文件。

4. 回到 VS Code，按 `Ctrl+Shift+P` → `Extensions: Install from VSIX...` → 选择刚生成的 `.vsix` 文件即可。

## 使用前准备

需要准备：

- VS Code 1.85.0 或更高版本。
- EIDE 工程，工程目录包含 `.eide/eide.yml`。
- OpenOCD，TCL RPC 端口可访问。
- Cortex-Debug，推荐用于启动 STM32 调试会话。
- Keil `fromelf.exe`，用于把 `.axf` 转成 `.elf`。

如果 `fromelf.exe` 不在系统 PATH 中，可以手动配置 `stm32LiveWatch.fromelfPath`。

## 配置项

在 VS Code 设置中搜索 `STM32 Live Watch`。

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `stm32LiveWatch.elfPath` | 空 | 手动指定 ELF 文件路径 |
| `stm32LiveWatch.fromelfPath` | 空 | 手动指定 Keil `fromelf.exe` 路径 |
| `stm32LiveWatch.openocdHost` | `127.0.0.1` | OpenOCD TCL RPC 地址 |
| `stm32LiveWatch.openocdPort` | `50001` | OpenOCD TCL RPC 端口 |
| `stm32LiveWatch.refreshInterval` | `250` | 变量刷新间隔，单位毫秒 |
| `stm32LiveWatch.pythonPath` | `python3` | 未使用可执行后端时的 Python 路径 |

## 命令列表

| 命令 | 说明 |
| --- | --- |
| `STM32 Live Watch: Start Server` | 启动变量监视服务 |
| `STM32 Live Watch: Stop Server` | 停止变量监视服务 |
| `STM32 Live Watch: Add Variable` | 添加变量到监视列表 |
| `STM32 Live Watch: Add Selected Variable` | 添加编辑器中选中的变量 |
| `STM32 Live Watch: Refresh Variables` | 手动刷新变量值 |
| `STM32 Live Watch: Generate ELF from AXF` | 从 EIDE `.axf` 生成 `.elf` |
| `STM32 Live Watch: Configure ELF Path` | 手动配置 `.elf` 文件 |
| `STM32 Live Watch: Edit Variable Value` | 修改当前选中变量的值 |
| `STM32 Live Watch: Rename Variable Expression` | 重命名根变量表达式 |
| `STM32 Live Watch: Delete Variable` | 删除根变量 |
| `STM32 Live Watch: Show Variables` | 聚焦变量面板 |

## 构建和测试

编译 TypeScript：

```bash
npm run compile
```

测试 AXF/ELF 路径解析：

```bash
npm run test:elf
```

测试 C++ 变量展开后端：

```bash
python -m unittest tests.test_server_cpp
```

打包 VS Code 扩展：

```bash
npx vsce package
```

打包后端服务：

```bash
npm run package:server
```

## 常见问题

### 找不到 AXF

确认工程里存在 `.eide/eide.yml`，并检查 `outDir` 指向的目录中是否真的有 `.axf`。

### 找不到 fromelf.exe

在 VS Code 设置中配置：

```text
stm32LiveWatch.fromelfPath = D:\Keil5\ARM\ARMCLANG\bin\fromelf.exe
```

也可以把 `fromelf.exe` 所在目录加入系统 `PATH`。

### 能启动服务，但变量没有值

检查三件事：

- ELF 是否对应当前烧录到目标板的固件。
- OpenOCD 是否正在运行。
- 目标板是否处于可读取内存的调试状态。

### C++ class 展不开

优先确认添加的是对象实例名，不是类名。

正确：

```text
pid_yaw
```

错误：

```text
PID
```

如果仍然展不开，检查编译选项是否保留调试信息。建议调试阶段使用 `-g`，并降低优化等级。

### 修改变量失败

结构体、class、数组容器本身不能直接写入。请展开后修改里面的普通成员，例如：

```text
pid_yaw.pid.Kp
```

### 不想自动转换 AXF

直接配置 `stm32LiveWatch.elfPath` 到固定 ELF 文件。只要该文件存在，扩展会优先使用它。

## 注意事项

- AXF 自动转换只面向 EIDE 工程。
- 高优化等级可能导致变量被优化掉，调试时建议保留调试信息。
- ELF 必须与当前目标板固件一致，否则变量地址和值可能不正确。
- OpenOCD TCL RPC 端口默认是 `50001`，需要与配置保持一致。
- 实时刷新会读取目标板内存，刷新间隔过低可能增加调试链路压力。

## 项目结构

```text
stm32-vscode-Live-watch/
├─ src/
│  ├─ extension.ts                 # 扩展入口、命令、视图和自动启动逻辑
│  ├─ elfResolver.ts               # EIDE AXF 查找、fromelf 定位和 ELF 生成
│  ├─ serverClient.ts              # VS Code 扩展与后端服务通信
│  ├─ variableTreeDataProvider.ts  # 变量视图和操作视图
│  ├─ config.ts                    # 配置读取和兼容旧配置
│  └─ models/
├─ resources/
│  ├─ icon.jpg
│  ├─ icon.svg
│  └─ server.py                    # 后端变量读取服务
├─ bin/                            # 后端可执行文件
├─ tests/                          # Python 后端测试
├─ package.json                    # 扩展清单、命令、视图、配置和脚本
└─ README.md
```

## 发布信息

- 扩展名：`stm32-vscode-Live-watch`
- 发布者：`yezi`
- 版本：`2.1.0`
- 仓库：<https://github.com/1581525057/stm32-vscode-Live-watch>

## 致谢

本项目参考了 [stm32-debug-helper](https://github.com/ZEALHT001/stm32-debug-helper)，感谢作者提供的思路。
