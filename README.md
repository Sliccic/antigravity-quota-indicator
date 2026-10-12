# ⚡ Antigravity Quota & Task Monitor (反重力用量与任务监控插件)

<p align="center">
  <strong>Google Antigravity 桌面客户端工作区实时模型配额与任务计时 / Token 消耗监控插件</strong><br>
  <em>Real-Time AI Model Quota, Task Duration Timer & Token/Cache Hit Monitor Widget for Google Antigravity Desktop Client</em>
</p>

<p align="center">
  <a href="https://github.com/Sliccic/antigravity-quota-indicator/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D16.0.0-brightgreen.svg?style=flat-square" alt="Node.js"></a>
  <a href="https://github.com/Sliccic/antigravity-quota-indicator"><img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-orange.svg?style=flat-square" alt="Platform"></a>
  <a href="https://github.com/Sliccic/antigravity-quota-indicator/stargazers"><img src="https://img.shields.io/github/stars/Sliccic/antigravity-quota-indicator?style=flat-square" alt="Stars"></a>
</p>

---

## 📖 痛点与简介 (Introduction)

在使用 **Google Antigravity (反重力)** 桌面客户端进行高强度 AI 配对编程时，开发者往往面临两大痛点：
1. **模型配额无法实时感知**：每次查看配额必须手动点击左下角 **Settings ⚙️ -> Models & Usage -> Quotas**，步骤繁琐且打断编程心流，无法直观预估 5 小时限额与 7 天周限额何时刷新；
2. **任务执行耗时与 Token 消耗黑盒**：当 Agent 执行复杂多步任务（如大规模重构、多工具联动）时，无法直观获知当前任务已经跑了多久、正处于哪一步、耗费了多少 Token 以及 Prompt Caching 缓存命中率。

**Antigravity Quota & Task Monitor** 专为 Google Antigravity 打造，在顶部导航栏提供轻量级无侵入的双胶囊状态栏与悬浮卡片：
- **📊 标题栏实时配额胶囊**：常驻展示 Gemini 5h 与周限额百分比及颜色预警指示灯；
- **⏱️ 标题栏任务执行计时胶囊**：实时显示当前会话任务状态（`● 执行中 13:49`），绿灯呼吸动画配合 Consolas 等宽数字；
- **🔍 任务详情与 Token / 缓存命中监控**：38px 醒目等宽秒表、当前正在执行的步骤/工具、输出 Tokens 统计与缓存命中量三列矩阵；
- **⚡ 毫秒级多窗口即时感知**：切换会话窗口 0ms 无感知即时切换，无网络轮询延迟；
- **⚙️ 独立解耦与参数设置**：配额卡片与任务卡片独立交互，支持触发方式（点击/悬停）、刷新周期与时间格式个性化配置；
- **🚀 零重启热注入**：借助 Chrome DevTools 协议，无需重启客户端即可 1 秒热生效！

---

## 🖼️ 界面效果预览 (Screenshots)

### 1. 配额用量卡片主视图 (Quota View)
支持实时查看 Gemini 共享池与 Claude/GPT 第三方模型的 5 小时限额与周限额进度，并精准计算倒计时：

![配额详情卡片](assets/preview-popover.png)

### 2. 插件参数设置视图 (Settings View)
卡片内置 `⚙️ 设置` 界面，支持个性化定制并持久保存到本地存储：

![设置面板](assets/preview-settings.png)

---

## ✨ 核心特性 (Features)

| 特性 | 说明 |
| :--- | :--- |
| ⏱️ **任务执行计时胶囊** | 吸附于顶部导航栏右侧（`● 执行中 13:49`），绿灯呼吸动态，采用 Consolas 极客等宽数字，一览即知执行耗时。 |
| 🧠 **步骤状态与工具追踪** | 展开卡片直观呈现当前正在进行的步骤（如 `🧠 Agent Thinking / Planning`、`⚡ toolAction`），知晓 AI 当前动作。 |
| 📊 **Token 与缓存命中监控** | 3 列高对比度矩阵呈现：**步骤数 (Steps)**、**输出 Tokens** 与 **Prompt Caching 缓存命中量**，成本与效率全透明。 |
| ⚡ **多窗口 0ms 无感同步** | 多任务/多会话窗口快速切换无网络延迟，同步提取活跃 DOM 与会话日志缓存，体验如丝般顺滑。 |
| 🏷️ **标题栏配额常驻胶囊** | 实时显示 Gemini 5h 与周限额百分比，带动态状态指示灯（🟢 健康 / 🟡 预警 / 🔴 见底），不遮挡聊天工作区。 |
| ⏳ **精确倒计时计算** | 5 小时限额精准格式化为 **`？小时？分钟`**（如 `4小时28分钟`）；7 天限额显示为 **`？天？小时`**（如 `5天22小时`）。 |
| ⚙️ **独立交互与设置菜单** | 配额卡片与任务卡片完全解耦，独立展开与收起；内置设置中心支持定制触发方式、刷新周期与语言风格。 |
| 👆 **灵活触发方式** | 支持在设置中随时切换：**单击展开/收起** 或 **鼠标悬停预览**（悬停时支持单击常开固定）。 |
| 🌐 **中英双语风格** | 限额倒计时支持一键切换为中文（`4小时28分钟 · 5天22小时`）或英文（`4h 28m · 5d 22h`）。 |
| ⚡ **零重启即时热加载** | 原生 RFC 6455 纯 Node.js CDP 协议客户端，1 秒内直接向活跃窗口热打补丁，无需打断当前开发。 |
| 🛡️ **更新自愈与原子暂存** | 客户端运行中自动打包为 `app.asar.staged`，关闭时通过后台守候 0.5 秒原子替换，解决文件锁占用问题。 |

---

## 🚀 快速上手 (Quick Start)

### 方式一：Windows 一键快速运行（推荐）

1. 克隆或下载本项目到本地：
   ```bash
   git clone https://github.com/Sliccic/antigravity-quota-indicator.git
   cd antigravity-quota-indicator
   ```
2. **零重启即时热生效**（推荐）：
   - 双击运行 **`hot-reload.bat`**
   - 脚本将自动连接当前打开的 Antigravity 窗口并在 1 秒内激活插件！
3. **永久安装到客户端资源包**：
   - 双击运行 **`install.bat`**
   - 自动备份出厂 ASAR，并在客户端关闭时自动完成持久化安装。

---

### 方式二：Node.js CLI 命令行

确保机器上已安装 Node.js (>= 16.0)：

```bash
# 1. 克隆仓库
git clone https://github.com/Sliccic/antigravity-quota-indicator.git
cd antigravity-quota-indicator

# 2. 零重启热加载（即时生效到当前运行窗口）
node bin/cli.js hot-reload

# 3. 永久打补丁安装
node bin/cli.js install

# 4. 如需一键卸载复原官方纯净原版
node bin/cli.js restore
```

---

### 方式三：浏览器控制台手动执行 (DevTools)

如果您希望不修改任何本地文件直接体验：
1. 在 Antigravity 客户端按快捷键 `Ctrl + Shift + I`（macOS 为 `Cmd + Option + I`）打开 DevTools 控制台；
2. 复制并粘贴 [`src/quota-widget.js`](src/quota-widget.js) 中的完整代码并回车；
3. 标题栏常驻胶囊即可立即加载完毕。

---

## 🛠️ 技术原理与架构 (Technical Architecture)

```mermaid
flowchart TD
    subgraph Antigravity Desktop Client
        TopBar["顶部标题栏 (Native Drag Region)"] -->|CSS 穿透 -webkit-app-region: no-drag| TopBarArea["顶部监控区"]
        TopBarArea --> TopPill["📊 模型余量胶囊按钮"]
        TopBarArea --> TaskPill["⏱️ 任务计时胶囊按钮"]
        
        TopPill -->|Click / Hover| QuotaPopover["毛玻璃配额详情卡片"]
        TaskPill -->|Click| TaskPopover["任务秒表 & Token 详情卡片"]

        QuotaPopover --> ViewSwitch{"视图路由"}
        ViewSwitch -->|配额模式| QuotaView["配额进度条与精确倒计时"]
        ViewSwitch -->|设置模式| SettingsView["参数设置 (触发方式/语言风格)"]
        SettingsView -->|持久化| LocalStorage[("localStorage")]

        TaskPopover --> TaskMetrics["Consolas 毫秒秒表 & 当前步骤"]
        TaskPopover --> TokenGrid["步骤数 / 输出Tokens / 缓存命中"]
    end

    subgraph Data Feeds & Sync Engine
        RPC["POST /exa.../RetrieveUserQuotaSummary"] -.->|CSRF 轮询| QuotaPopover
        FastDOM["DOM 快速探测 resolveActiveTaskFast"] -.->|0ms 窗口切换| TaskPill
        LogsCache["Transcript 日志解析 & tokenMetricsCache"] -.->|缓存加速| TokenGrid
    end

    subgraph Hot Injection Engine
        DevToolsPort["%APPDATA%/antigravity/DevToolsActivePort"] --> CDPClient["src/cdp-client.js (RFC 6455 WebSocket)"]
        CDPClient -->|Runtime.evaluate| TopBarArea
    end
```

1. **配额后端 RPC 探测与 CSRF 鉴权**：
   - 监听并复用主渲染上下文中注入的 `window.__APP_CONFIG__.csrfToken`；
   - 调用 Antigravity 本地语言服务端口 `/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`，安全获取 5h 与 weekly 的配额分片及精确 `resetTime`。
2. **任务计时与 0ms 窗口即时感知机制**：
   - **分级会话解析器**：通过 `resolveActiveTaskFast` 毫秒级探测当前活跃会话与执行状态，配合 `focus`、`visibilitychange`、`pointerup` 事件监听，杜绝多标签切换时的状态延迟与卡顿；
   - **Token 与缓存命中计算引擎**：读取会话 transcript 日志计算输出 Token 与 Prompt Caching 命中量，并采用 `tokenMetricsCache` 内存缓存，避免重复文件 I/O 带来的性能开销。
3. **Electron 顶栏拖拽区域穿透与完全解耦**：
   - Electron 默认将顶部拖拽区域设置为 `-webkit-app-region: drag`，会导致原生 OS 拦截鼠标交互。
   - 本插件对配额胶囊、任务胶囊及悬浮 Popover 显式声明 `-webkit-app-region: no-drag !important; app-region: no-drag !important;`，完美解决底层系统级拦截；
   - 配额指示器与任务计时器彻底解耦，互不干扰、独立运作。
4. **零重启热替换与冷启动退出守卫**：
   - 基于纯原生 Node.js 实现轻量级 CDP WebSocket 客户端，无需依赖巨大的 Puppeteer 库；
   - 支持向活跃窗口即时热注入，同时提供 `app.asar.staged` 暂存守卫机制，在客户端主进程安全退出瞬间完成毫秒级文件原子替换。

---

## ❓ 常见问题 (FAQ)

<details>
<summary><strong>Q: 官方客户端后续自动更新升级了，插件会消失吗？</strong></summary>

> **答**：官方大版本升级（如从 v2.21 升至 v2.22）会全量下载覆盖 `app.asar`，导致补丁被出厂文件还原。
> **解决方法**：只需重新双击项目目录下的 `hot-reload.bat` 或 `install.bat`，3 秒内即可全自动重新适配最新版本，您之前保存在 `localStorage` 中的个性化设置会依然保留！
</details>

<details>
<summary><strong>Q: 为什么之前单击胶囊没有反应？</strong></summary>

> **答**：这是 Electron 窗口标题栏的特有机制（OS 拖拽捕获）。现已通过底层 CSS 穿透与专用原生按钮封装彻底解决，同时提供了单击展开与鼠标悬停展开两种模式供自由切换。
</details>

<details>
<summary><strong>Q: 如何彻底卸载本插件？</strong></summary>

> **答**：运行 `node bin/cli.js restore`，程序将自动使用安装时保留的 `app.asar.bak` 官方备份文件替换回出厂状态。
</details>

---

## 📄 开源许可证 (License)

本项目基于 [MIT 许可证](LICENSE) 开源。

*Disclaimer: 本项目为非官方社区增强工具，与 Google 或 Antigravity 官方团队无官方从属关系。*
