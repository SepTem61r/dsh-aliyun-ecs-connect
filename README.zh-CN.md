# 阿里云 ECS 一键连接（DSH 插件）

按需启动阿里云 ECS 实例 → 查出**当前**公网 IP → 等 SSH 就绪 → 在本机弹一个终端窗口执行 `ssh -i ...`。

不用再进控制台点"启动"、等半天、复制新 IP、再手敲一遍命令。

[English](README.md)

```
/connect
  → 查询实例（状态 + 公网 IP）
  → 已停止则调用 StartInstance
  → 每 3 秒轮询，直到 Running 且拿到公网 IP
  → TCP 探测 22 端口（sshd 比系统晚几十秒）
  → 打开终端：ssh -i <key> -o StrictHostKeyChecking=accept-new root@<ip>
```

## 功能

| 入口 | 作用 |
|---|---|
| `/connect` | 完整流程：按需开机、取 IP、等 SSH、弹终端窗口 |
| `/ecs-status` | 只看状态和当前公网 IP，绝不启动实例 |
| `/ecs-stop` | 停机（按量付费实例优先用节省停机模式） |
| `ecs_connect` 工具 | 让模型也能调用；`openTerminal: false` 时只返回 ssh 命令 |
| 自动连接 | 默认关闭；打开后 DSH 启动时自动走一遍流程 |

所有操作都是幂等的：实例已经运行时再执行，只会取 IP 并开窗口，不会重复开机。

## 环境要求

- 装有 profile 的 DSH（Web 版即可）
- Windows 10/11 —— 开窗口用 `wt.exe`，失败退回 `cmd.exe /c start`
- `ssh.exe`（Windows 自带 OpenSSH 客户端）和一把 `.pem` / 私钥
- 推荐但不强制安装 Windows Terminal
- 一台 ECS 实例，以及一个带 `ecs:DescribeInstances`、`ecs:StartInstance`、`ecs:StopInstance` 权限的 RAM AccessKey

## 安装

```powershell
git clone https://github.com/SepTem61r/dsh-aliyun-ecs-connect.git
cd dsh-aliyun-ecs-connect
```

1. 把这个目录作为本地 bundle 安装：用 DSH 的插件管理器（`install_bundle` 指向本目录），或直接让你的 DSH agent 帮你装
2. 建好设置文件和密钥文件（见下）
3. 重启 DSH

这个 bundle 没有任何三方依赖，只用 Node 内置模块，因此没有构建步骤、也没有 `node_modules`。

## 配置

### 设置文件 — `~/.dsh/aliyun-ecs-settings.json`

```json
{
  "regionId": "cn-hongkong",
  "instanceId": "i-xxxxxxxxxxxxxxxxx",
  "sshUser": "root",
  "identityFile": "C:\\Users\\you\\.ssh\\your-key.pem",
  "sshPort": 22,
  "terminal": "auto",
  "autoConnect": false
}
```

参考 [`examples/aliyun-ecs-settings.example.json`](examples/aliyun-ecs-settings.example.json)。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `regionId` | `cn-hongkong` | 地域 |
| `instanceId` | — | 实例 ID（`i-` 开头） |
| `sshUser` | `root` | SSH 用户 |
| `identityFile` | — | 私钥路径 |
| `sshPort` | `22` | SSH 端口 |
| `terminal` | `auto` | `auto`（先 Windows Terminal 再 cmd）、`wt`、`cmd` |
| `autoConnect` | `false` | DSH 启动时是否自动连接 |
| `autoConnectDelayMs` | `2500` | 自动连接的延迟 |
| `startTimeoutMs` | `180000` | 等待运行 + IP 的总超时 |
| `pollIntervalMs` | `3000` | 轮询间隔 |
| `sshReadyTimeoutMs` | `90000` | 等待 22 端口的预算 |
| `credentialsFile` | `~/.dsh/aliyun-ecs.json` | 覆盖密钥文件路径 |
| `settingsFile` | `~/.dsh/aliyun-ecs-settings.json` | 覆盖本文件路径 |
| `endpoint` | `ecs.<regionId>.aliyuncs.com` | 覆盖 API 域名 |

bundle 行（`cordis.patch.yml`）里写的值会被本文件覆盖。设置在插件激活时读取，改完请重启 DSH。

### 密钥文件 — `~/.dsh/aliyun-ecs.json`

```json
{ "accessKeyId": "LTAI...", "accessKeySecret": "..." }
```

环境变量 `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` 优先级更高。密钥每次操作时读取，永远不会打印到日志。

请用 **RAM 子账号**，不要用主账号。最小权限策略（把占位符换掉后绑定给子账号）：

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

参考 [`examples/aliyun-ram-policy.example.json`](examples/aliyun-ram-policy.example.json)。

## 为什么不需要弹性公网 IP（EIP）

按量付费 + 节省停机模式的实例，停机时公网 IP 会被回收，每次开机重新分配 —— 这就是地址一直变的原因。插件每次开机后现查地址，所以**不需要**为固定 EIP 付保留费。只有需要稳定地址做域名解析或白名单时，才值得上 EIP。

## 计费提醒

- 插件只负责开机/停机，不改变计费方式
- 只有"按量付费 + 节省停机模式"的实例，停机才真的省钱
- 停机后云盘、EIP 等仍可能计费，以控制台为准
- 阿里云控制台自带的定时开关机任务在你电脑关机时也生效；`/ecs-stop` 只在 DSH 运行时有效

## 故障排查

| 现象 | 原因 |
|---|---|
| `缺少 instanceId` / `找不到 SSH 私钥文件` | 设置文件缺失或写错 |
| `找不到 AccessKey 文件` / 占位内容 | 密钥文件缺失或还是模板 |
| `Forbidden.RAM` | RAM 策略没绑定，或资源范围不匹配 |
| `InstanceNotFound` | 实例 ID / 地域不对，或密钥不属于该账号 |
| `等待实例运行超时` | 实例启动卡住，去控制台看状态 |
| 窗口开了但连不上 | 安全组没放行 22 端口，或 sshd 还没起好 |

## 开发

零依赖、无构建步骤。

```powershell
node test/plugin-wiring.mjs   # 命令/工具注册 + 自动连接分支
node test/smoke.mjs --status  # 用真实设置文件查询实例
node test/smoke.mjs --open    # 完整流程，开窗口
```

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
