# 阿里云 ECS 一键连接（DSH 插件）

> 给「用时才开」的学生党：**一条命令开机 → 自动拿到当前公网 IP → 弹出一个连好的 SSH 终端**。
> 不用登录控制台点「启动」，不用等开机，不用复制 IP，也不用每次重敲 `ssh -i ... root@...`。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

---

## 目录

- [5 分钟快速开始](#5-分钟快速开始)
- [它到底做了什么](#它到底做了什么)
- [功能一览](#功能一览)
- [准备工作（详细版）](#准备工作详细版)
  - [1. 确认这台服务器你能 SSH 登录](#1-确认这台服务器你能-ssh-登录)
  - [2. 创建 RAM 子账号并拿到 AccessKey](#2-创建-ram-子账号并拿到-accesskey)
  - [3. 找到实例 ID 和地域](#3-找到实例-id-和地域)
  - [4. 装好 DSH](#4-装好-dsh)
- [安装插件](#安装插件)
- [写两个配置文件](#写两个配置文件)
- [第一次运行与验证](#第一次运行与验证)
- [日常使用](#日常使用)
- [费用与省钱](#费用与省钱)
- [为什么不需要弹性公网 IP（EIP）](#为什么不需要弹性公网-ipeip)
- [安全须知](#安全须知)
- [排错手册](#排错手册)
- [常见问题 FAQ](#常见问题-faq)
- [开发与测试](#开发与测试)
- [目录结构](#目录结构)
- [许可证](#许可证)

---

## 5 分钟快速开始

> 已经着急了？照抄下面 5 步。每一步都解释了「为什么」，遇到问题跳 [排错手册](#排错手册)。

**第 0 步：准备好三样东西**

| 你需要 | 从哪来 |
|---|---|
| 实例 ID（`i-` 开头）和地域（如 `cn-hongkong`） | 阿里云控制台 → 云服务器 ECS → 实例列表 |
| `.pem` 私钥文件 | 创建实例时下载的那个文件（例：`D:\path\to\your-key.pem`） |
| AccessKey ID + Secret | 阿里云 RAM 控制台，给一个子账号创建（[下面有详细步骤](#2-创建-ram-子账号并拿到-accesskey)） |

**第 1 步：装插件**

把仓库克隆到本地（路径随意，下面用 `D:\dsh-aliyun-ecs-connect`）：

```powershell
git clone https://github.com/SepTem61r/dsh-aliyun-ecs-connect.git D:\dsh-aliyun-ecs-connect
```

然后打开 DSH，在聊天框里发这句话（让 DSH 里的 AI 帮你装，最省事）：

> 帮我把 `D:\dsh-aliyun-ecs-connect` 这个目录作为插件安装到当前 profile，装好后告诉我。

**第 2 步：写配置**（在**你自己**的 PowerShell 里执行，不是在 DSH 里）

```powershell
notepad "$env:USERPROFILE\.dsh\aliyun-ecs-settings.json"
```

把下面内容粘进去，改成你自己的值，保存：

```json
{
  "regionId": "cn-hongkong",
  "instanceId": "i-你的实例ID",
  "sshUser": "root",
  "identityFile": "D:\\path\\to\\your-key.pem",
  "sshPort": 22,
  "terminal": "auto",
  "autoConnect": false
}
```

**第 3 步：写 AccessKey**

```powershell
notepad "$env:USERPROFILE\.dsh\aliyun-ecs.json"
```

粘进去，保存：

```json
{ "accessKeyId": "LTAI你的ID", "accessKeySecret": "你的Secret" }
```

**第 4 步：重启 DSH**

关掉 DSH（终端里 `Ctrl+C` 或关窗口），再启动一次。插件和配置只在启动时读取。

**第 5 步：用**

在 DSH 输入框里打 `/`，能看到 `connect`、`ecs-status`、`ecs-stop` 就说明装好了。然后：

```text
/ecs-status     ← 先看看能不能读到实例（不会开机）
/connect        ← 开机 + 拿 IP + 弹终端
```

`/connect` 成功时，会弹出一个 Windows Terminal 窗口，里面已经连上服务器；DSH 里也会显示：

```text
✅ i-xxxxx（Running）
公网 IP：203.0.113.10
终端：windows-terminal
命令：ssh -i D:\path\to\your-key.pem ... root@203.0.113.10
```

---

## 它到底做了什么

你以前每次要连服务器，得做这些事：

1. 打开浏览器，登录阿里云
2. 找到那台实例，点「启动」
3. 等它从「已停止」变成「运行中」
4. 刷新，找「公网 IP」，复制
5. 打开 cmd，粘 `ssh -i "D:\path\to\your-key.pem" root@刚才那个IP`

这个插件把 1–5 全包了：

```text
/connect
  → 查实例状态和当前公网 IP        （DescribeInstances）
  → 如果已停止，调用开机接口       （StartInstance）
  → 每 3 秒查一次，直到运行且有 IP
  → 等 22 端口能连（sshd 比系统晚启动）
  → 打开 Windows Terminal 执行 ssh 命令
```

所以两条关键点：

- **IP 是每次现查的**，所以你不用再记、也不用担心它变。
- **幂等**：已经在运行时再执行 `/connect`，不会重复开机，只会查 IP 并开窗口（1 秒左右）。

---

## 功能一览

| 入口 | 作用 |
|---|---|
| `/connect` | 完整流程：按需开机 → 查 IP → 等 SSH → 开终端 |
| `/ecs-status` | 只看状态和当前公网 IP，**绝不启动**实例 |
| `/ecs-stop` | 停机（按量付费实例优先用「节省停机模式」，更省钱） |
| 自然语言 | 直接对 DSH 说「帮我连一下服务器」，AI 会调用 `ecs_connect` 工具 |
| 启动时自动连 | 默认**关闭**；想要就设 `autoConnect: true` |

---

## 准备工作（详细版）

### 1. 确认这台服务器你能 SSH 登录

先用自己的方式连一次，确认这三件事：

```powershell
ssh -i "D:\path\to\your-key.pem" root@你的公网IP
```

- **用户名**：一般是 `root`（Ubuntu 镜像也可能是 `ubuntu`，按你创建实例时的设置）
- **私钥文件**：`.pem` 文件必须还在（`Test-Path D:\path\to\your-key.pem` 返回 `True`）。丢了可以去 ECS 控制台「密钥对」重新创建并绑定，或者重置实例密码
- **安全组**：默认放行 22 端口。如果你改过，去 实例详情 → 安全组，确认入方向允许 `22`
- **能连上**再往下做，不然插件装好了也连不上，容易误判

### 2. 创建 RAM 子账号并拿到 AccessKey

> **为什么要这一步？** 插件要替你「点启动按钮」，就得调阿里云的 API。调 API 需要账号密码 —— 这个密码叫 **AccessKey**。
> 它跟你的登录密码、跟 `.pem` 都不是一回事：
>
> | 东西 | 用在哪 | 谁用 |
> |---|---|---|
> | 控制台登录密码 | 登录阿里云网页 | 你 |
> | `.pem` 私钥 | SSH 登录服务器 | `ssh` 命令 |
> | **AccessKey** | 调阿里云 API（开机/查 IP） | **这个插件** |

**千万不要用主账号的 AccessKey。** 建一个只有「开机这一台机器」权限的子账号：

1. 浏览器登录阿里云 → 右上角头像 → **访问控制 RAM**（或直接搜「RAM 访问控制」）
2. 左边菜单 **身份管理 → 用户 → 创建用户**
3. 登录名称填一个你记得的，比如 `dsh-ecs-connect`
4. 访问方式**只勾「使用永久 AccessKey 访问」**（不需要勾控制台登录）
5. 点确定后，页面会显示 **AccessKey ID** 和 **AccessKey Secret**。
   ⚠️ **Secret 只显示这一次**，现在立刻复制下来（可以点「下载 CSV」）。关掉就再也看不到，只能删了重建
6. 现在给它授权：
   - 左边 **权限策略 → 创建权限策略 → 脚本编辑**
   - 把下面这段粘进去，**把 `<region-id>` 和 `<instance-id>` 换成你自己的**
   - 名字填 `dsh-ecs-connect-policy`，创建

```json
{
  "Version": "1",
  "Statement": [
    { "Effect": "Allow", "Action": ["ecs:DescribeInstances"], "Resource": "*" },
    {
      "Effect": "Allow",
      "Action": ["ecs:StartInstance", "ecs:StopInstance"],
      "Resource": "acs:ecs:<region-id>:*:instance/<instance-id>"
    }
  ]
}
```

   比如你的实例是 `i-xxxxxxxxxxxxxxxxx`、地域 `cn-hongkong`，最后一行就是：

   ```json
   "Resource": "acs:ecs:cn-hongkong:*:instance/i-xxxxxxxxxxxxxxxxx"
   ```

7. 再回到 **用户 → 你的用户 → 添加权限 → 选「自定义策略」→ 勾上 `dsh-ecs-connect-policy`**

这个策略只允许三件事：查实例、启动这一台、停止这一台。**不能删机器，不能碰别的实例。**

> 授权后如果报 `Forbidden.RAM`：先检查策略是否真的绑定到了这个用户；个别账号的资源级授权需要把 `Resource` 改成 `"*"` 才能通过（只有这三个只读/开关动作，风险可控）。

### 3. 找到实例 ID 和地域

阿里云控制台 → **云服务器 ECS → 实例**：

- **实例 ID**：列表里 `i-` 开头那一串，例如 `i-xxxxxxxxxxxxxxxxx`
- **地域**：页面左上角显示，比如「中国香港」对应 `cn-hongkong`；「华东1（杭州）」对应 `cn-hangzhou`

对照表（常见几个）：

| 控制台显示 | regionId |
|---|---|
| 中国香港 | `cn-hongkong` |
| 华东1（杭州） | `cn-hangzhou` |
| 华北2（北京） | `cn-beijing` |
| 华南1（深圳） | `cn-shenzhen` |
| 新加坡 | `ap-southeast-1` |

### 4. 装好 DSH

需要 Node.js 20 以上，然后：

```powershell
npx @deepseek-ai/dsh@latest web
```

浏览器打开命令提示的地址（一般是 `http://127.0.0.1:3080`），能看到聊天界面就说明 DSH 正常。

---

## 安装插件

这个插件是 DSH 的 **bundle（插件包）**，没有第三方依赖、不需要 `npm install`、不需要编译。

### 方式 A：让 DSH 里的 AI 帮你装（推荐，新手友好）

1. 先把仓库克隆到本地：

```powershell
git clone https://github.com/SepTem61r/dsh-aliyun-ecs-connect.git D:\dsh-aliyun-ecs-connect
```

2. 在 DSH 聊天框里发：

> 帮我把 `D:\dsh-aliyun-ecs-connect` 这个目录作为插件安装到当前 profile，装好后告诉我。

AI 会调用插件管理器把它安装并激活。看到回复「已安装/已激活」即可。

### 方式 B：手动用插件管理器

在 DSH 里（或让 AI 执行）调用插件管理器的 `install_bundle`，目标指向这个目录：

```text
D:\dsh-aliyun-ecs-connect
```

安装完刷新页面，输入框打 `/` 能看到三条命令就成功了。

> 装的时候如果提示 `pnpm` 不存在：先在 PowerShell 里跑 `npm install -g pnpm`，再重装插件。
> 这个插件只用 Node 内置模块，所以 pnpm 只是**安装阶段**需要，运行时不需要。

---

## 写两个配置文件

插件**故意**不在自己的代码里存任何个人信息。你的东西放在你自己的用户目录：

| 文件 | 放什么 | 会不会被提交到 GitHub |
|---|---|---|
| `%USERPROFILE%\.dsh\aliyun-ecs-settings.json` | 实例 ID、地域、pem 路径等 | 不会（在 DSH 配置目录，不在仓库里） |
| `%USERPROFILE%\.dsh\aliyun-ecs.json` | AccessKey ID / Secret | 不会 |

两个文件都是 JSON，**用记事本就能改**。

### 设置文件 `aliyun-ecs-settings.json`

```powershell
notepad "$env:USERPROFILE\.dsh\aliyun-ecs-settings.json"
```

```json
{
  "regionId": "cn-hongkong",
  "instanceId": "i-xxxxxxxxxxxxxxxxx",
  "sshUser": "root",
  "identityFile": "D:\\path\\to\\your-key.pem",
  "sshPort": 22,
  "terminal": "auto",
  "autoConnect": false
}
```

⚠️ JSON 里 Windows 路径的 `\` 要写成 `\\`。

完整字段说明：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `regionId` | `cn-hongkong` | 地域，见上面的对照表 |
| `instanceId` | 无（必填） | 实例 ID |
| `sshUser` | `root` | SSH 用户名 |
| `identityFile` | 无（必填） | `.pem` 私钥的绝对路径 |
| `sshPort` | `22` | SSH 端口 |
| `terminal` | `auto` | `auto`＝先试 Windows Terminal、失败退回 cmd；也可强制 `wt` / `cmd` |
| `autoConnect` | `false` | `true`＝DSH 一启动就自动连；默认关 |
| `autoConnectDelayMs` | `2500` | 自动连接的延迟（毫秒） |
| `startTimeoutMs` | `180000` | 等开机 + IP 的总超时 |
| `pollIntervalMs` | `3000` | 轮询间隔 |
| `sshReadyTimeoutMs` | `90000` | 等 22 端口的预算 |
| `credentialsFile` | `~/.dsh/aliyun-ecs.json` | 自定义密钥文件路径 |
| `settingsFile` | `~/.dsh/aliyun-ecs-settings.json` | 自定义本文件路径 |
| `endpoint` | `ecs.<regionId>.aliyuncs.com` | 自定义 API 域名（一般不用改） |

### 密钥文件 `aliyun-ecs.json`

```powershell
notepad "$env:USERPROFILE\.dsh\aliyun-ecs.json"
```

```json
{ "accessKeyId": "LTAI5t...", "accessKeySecret": "..." }
```

> 也可以用环境变量 `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET`（优先级更高），但文件方式改起来最方便。
> 想把文件权限收紧成「只有你能读」可以跑（可选）：
>
> ```powershell
> $p = "$env:USERPROFILE\.dsh\aliyun-ecs.json"
> $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
> icacls $p /grant:r ($me + ':(F)')
> icacls $p /inheritance:r
> ```

---

## 第一次运行与验证

1. **重启 DSH**（配置只在启动时读）：关掉再 `npx @deepseek-ai/dsh@latest web`
2. 输入框打 `/` → 应看到 `connect` / `ecs-status` / `ecs-stop`
3. 先跑 `/ecs-status`：
   - 成功：显示 `i-xxxx Running/Stopped` 和公网 IP
   - 失败：看 [排错手册](#排错手册)，基本都是配置或权限问题
4. 再跑 `/connect`：会等 20~60 秒（开机慢的话更久），然后弹出终端窗口
5. 在那个窗口里敲 `whoami` 试试，能看到 `root` 就彻底通了

> 第一次连某个新 IP 时，`ssh` 会问 `Are you sure you want to continue connecting?` —— 插件已经加了 `StrictHostKeyChecking=accept-new`，会自动接受新主机。

---

## 日常使用

```text
/connect       开机（如果没开）+ 拿 IP + 弹终端
/ecs-status    看看现在什么状态、IP 是多少
/ecs-stop      用完停机，停止计费（按量付费实例）
```

不想记命令也行，直接说：

> 帮我连一下服务器

> 服务器现在是什么状态？

> 用完了吧，帮我把机器关了

AI 会调用对应工具完成。

**注意**：`/connect` 是「开机并连上」，它不会在你关闭终端窗口时自动关机。不用了记得 `/ecs-stop`。

---

## 费用与省钱

- 插件只负责**开机**和**停机**，不改你的计费方式。
- 只有「**按量付费 + 节省停机模式**」的实例，停机才真的省 CPU/内存钱。包年包月停机照扣。
- 停机后**云盘**仍然计费；绑了 **EIP** 的话 EIP 也可能产生保留费。
- 按量付费是开机期间按秒扣费 —— 用完就 `/ecs-stop`。
- 更彻底的兜底：阿里云控制台的**定时开关机**任务，在你电脑关机时也会执行；`/ecs-stop` 只在 DSH 运行时有效。两个可以一起用。

---

## 为什么不需要弹性公网 IP（EIP）

按量付费 + 节省停机模式的实例，**停机时公网 IP 会被回收**，下次开机重新分配 —— 这就是你以前每次 IP 都不一样的原因。

所以这个插件每次开机后**现查 IP**，根本不需要固定 IP。EIP（弹性公网 IP）是独立计费的资源，停机或未绑定时还有保留费 —— 除非你要拿 IP 去做域名解析或防火墙白名单，否则没必要买。

---

## 安全须知

### 这个插件实际会做什么

插件对阿里云只调三个接口，其他一概不碰：

| 接口 | 用途 | 影响 |
|---|---|---|
| `DescribeInstances` | 查状态和当前公网 IP | 只读 |
| `StartInstance` | 开机 | 开始计费 |
| `StopInstance` | 停机 | 中断服务 |

它不会删实例、不会重置密码、不会改安全组、不会动别的实例 —— 不是"做不到"，而是**代码里只有这三条**，而你给它的 RAM 策略也只允许这三条。

### 控制面和服务器内部，是两回事

| 层面 | 由什么决定 | 这个插件 |
|---|---|---|
| **控制面**（开机 / 停机 / 删除 / 改配置） | AccessKey 的 RAM 权限 | 只用「查询 + 开机 + 停机」 |
| **服务器内部**（敲命令、改文件） | 有没有 `.pem`、22 端口通不通 | 只帮你弹一个**你自己用**的交互终端，不代你执行命令 |

⚠️ 关键事实：**权限绑在 AccessKey 上，不绑在某个工具或某个人身上**。任何拿到这把 AK 的程序，能做同样的事。所以真正的安全边界是「AK 给多大范围」，而不是「谁来用它」。

### 密钥不会被打印或上报

- 插件每次操作时**现读**密钥，只用于计算请求签名。
- 密钥和 pem 路径都不会写进日志；插件没有任何遥测，只和 `ecs.<region>.aliyuncs.com` 通信。
- `AccessKey`、`.pem`、设置文件都在你的用户目录，**不在仓库里**（`.gitignore` 还挡了一层）。

### 想把风险再压小，可以这样做

| 做法 | 作用 |
|---|---|
| 用**临时 STS 凭证**（1 小时过期）替代长期 AK | 过期即失效，不留长期风险 |
| RAM 策略加 `acs:SourceIp` 条件 | 只有你常用 IP 能用这把 AK |
| `Resource` 锁到具体实例 ARN | 碰不到账号下的其他机器 |
| 打开 **ActionTrail 操作审计** | 每次 API 调用都有记录 |
| 危险操作前先人工确认 | 最有效的一道闸 |

> 如果你让 AI 或脚本直接使用密钥，请把「它能做什么」交给 RAM 策略限制，而不是指望它"自觉"—— 模型行为不是安全机制，权限范围才是。

---

## 排错手册

| 你看到的提示 | 原因 | 怎么修 |
|---|---|---|
| `缺少 instanceId` | 设置文件没写实例 ID | 编辑 `aliyun-ecs-settings.json`，填 `instanceId` |
| `找不到 SSH 私钥文件` | `identityFile` 路径不对 | 确认 `Test-Path "你的路径"` 返回 True；JSON 里 `\` 要写 `\\` |
| `找不到 AccessKey 文件` | 密钥文件不存在 | 按上面创建 `aliyun-ecs.json` |
| `AccessKey 文件里还是模板占位内容` | 直接复制了示例，没改值 | 换成真实的 ID / Secret |
| `设置文件不是合法 JSON` | 少了逗号/引号 | 用 JSON 校验工具检查，注意 Windows 路径转义 |
| `Forbidden.RAM` | 子账号没授权 | 重新检查策略是否绑定到该用户；必要时把 `Resource` 改成 `"*"` |
| `InstanceNotFound` | 实例 ID / 地域不对，或 AccessKey 属于别的账号 | 核对 ID、地域；确认子账号属于这个阿里云账号 |
| `等待实例运行超时` | 实例卡在启动中 | 去控制台看实例状态，通常是库存/欠费/系统问题 |
| 窗口弹出来了但连不上 | 安全组没放行 22，或 sshd 还没起完 | 检查安全组入方向规则；等 30 秒再 `/connect` |
| 输入 `/` 看不到命令 | 插件没装上，或没重启 | 重新用 `install_bundle` 安装，然后重启 DSH |
| `pnpm: command not found`（安装时） | DSH 插件安装器依赖 pnpm | `npm install -g pnpm` 后重试 |
| 端口不是 22 | 改过 SSH 端口 | 设置文件里填 `sshPort` |

排查顺序建议：先 `/ecs-status` 确认「能读到实例」，再 `/connect`；前者过不了就是配置/密钥问题，跟 ssh 无关。

---

## 常见问题 FAQ

**Q：会不会一打开 DSH 就把服务器开起来、开始扣钱？**
不会。`autoConnect` 默认是 `false`，只有你输入 `/connect` 才会开机。

**Q：改了设置文件要重启吗？**
要。插件在启动时读取配置。密钥文件（`aliyun-ecs.json`）是每次操作现读的，改密钥不用重启。

**Q：能同时管多台服务器吗？**
当前版本一份配置管一台。需要多台可以复制一份配置换个 `instanceId`（比如再装一个 profile），或者告诉我，我把多实例支持加上。

**Q：macOS / Linux 能用吗？**
目前不行：开窗口那一步用的是 Windows 的 `wt.exe` / `cmd.exe`。其他平台需要改 `lib/terminal.js`。

**Q：没装 Windows Terminal 怎么办？**
`terminal: "auto"` 会自动退回 `cmd.exe` 开窗口，功能一样，只是界面朴素一点。

**Q：服务器 IP 每次变，SSH 会不会因为 host key 变化报错？**
新 IP 对 `known_hosts` 来说是「新主机」，会自动接受。旧的记录会一直留着，不影响使用。

**Q：为什么不用 EIP 让 IP 固定？**
见[上面](#为什么不需要弹性公网-ipeip)。插件每次现查，够用且省钱。

**Q：这个插件会上传我的数据吗？**
不会。它只和 `ecs.<region>.aliyuncs.com`（阿里云 API）通信；没有遥测、没有外部服务。

---

## 开发与测试

零依赖、无构建步骤。

```powershell
node test/plugin-wiring.mjs   # 命令/工具注册 + 自动连接分支（不需要真实例）
node test/smoke.mjs --status  # 用真实设置文件查一次实例（只读）
node test/smoke.mjs --open    # 完整流程：开机 + 开窗口
node test/smoke.mjs --stop    # 停机
```

代码结构：

| 文件 | 作用 |
|---|---|
| `index.js` | 插件接线：注册 `/connect` 等命令、`ecs_connect` 工具、自动连接 |
| `lib/ecs.js` | 手写的阿里云 OpenAPI 客户端（HMAC-SHA1 签名，只用 `node:crypto`） |
| `lib/flow.js` | 编排：查状态 → 开机 → 等运行 → 等端口 → 开窗口 |
| `lib/terminal.js` | 启动 Windows Terminal（失败退回 cmd） |
| `lib/config.js` | 默认值、设置文件、密钥读取与校验 |
| `cordis.patch.yml` | bundle 补丁：把插件行插进 profile（不含任何个人信息） |

---

## 目录结构

```text
dsh-aliyun-ecs-connect/
├─ index.js                 # 插件入口（命令 / 工具 / 自动连接）
├─ lib/                     # 客户端、编排、终端、配置
├─ locale/                  # 插件页里的中英文标题和描述
├─ icon.svg                 # 插件图标
├─ cordis.patch.yml         # bundle 补丁
├─ examples/                # 设置文件与 RAM 策略的示例
├─ test/                    # wiring 测试 + smoke 测试
├─ README.md                # 本文件（中文教程）
└─ LICENSE                  # MIT
```

---

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
