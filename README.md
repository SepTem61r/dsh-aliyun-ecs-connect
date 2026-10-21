# Aliyun ECS Quick Connect (DSH plugin)

> One command boots your Alibaba Cloud ECS instance, reads its **current** public IP, and opens a ready-to-use SSH terminal.
> No console login, no waiting, no copying IPs, no retyping `ssh -i ... root@...` every time.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

[中文教程](README.zh-CN.md)

> 🚀 **New here?** Start with the [5-minute quick start](#5-minute-quick-start) and copy-paste your way through. The rest explains the details, money, and troubleshooting.

---

## Table of contents

- [5-minute quick start](#5-minute-quick-start)
- [What it actually does](#what-it-actually-does)
- [Features](#features)
- [Prerequisites in detail](#prerequisites-in-detail)
  - [1. Make sure you can SSH into the instance](#1-make-sure-you-can-ssh-into-the-instance)
  - [2. Create a RAM sub-account and an AccessKey](#2-create-a-ram-sub-account-and-an-accesskey)
  - [3. Find the instance ID and region](#3-find-the-instance-id-and-region)
  - [4. Install DSH](#4-install-dsh)
- [Install the plugin](#install-the-plugin)
- [Write the two configuration files](#write-the-two-configuration-files)
- [First run and verification](#first-run-and-verification)
- [Daily use](#daily-use)
- [Billing](#billing)
- [Why no EIP is needed](#why-no-eip-is-needed)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Development](#development)
- [Layout](#layout)
- [License](#license)

---

## 5-minute quick start

**Step 0 — have three things ready**

| You need | Where it comes from |
|---|---|
| Instance ID (`i-...`) and region (e.g. `cn-hongkong`) | Alibaba Cloud console → ECS → Instances |
| The `.pem` private key | The file downloaded when the instance was created (e.g. `D:\path\to\your-key.pem`) |
| AccessKey ID + Secret | RAM console, created for a sub-account ([details below](#2-create-a-ram-sub-account-and-an-accesskey)) |

**Step 1 — install the plugin**

```powershell
git clone https://github.com/SepTem61r/dsh-aliyun-ecs-connect.git D:\dsh-aliyun-ecs-connect
```

Then open DSH and send this message (the easiest path — the agent installs it for you):

> Install `D:\dsh-aliyun-ecs-connect` as a plugin into the current profile, and tell me when it is active.

**Step 2 — write the settings file** (in *your own* PowerShell, not inside DSH)

```powershell
notepad "$env:USERPROFILE\.dsh\aliyun-ecs-settings.json"
```

```json
{
  "regionId": "cn-hongkong",
  "instanceId": "i-your-instance-id",
  "sshUser": "root",
  "identityFile": "D:\\path\\to\\your-key.pem",
  "sshPort": 22,
  "terminal": "auto",
  "autoConnect": false
}
```

**Step 3 — write the AccessKey file**

```powershell
notepad "$env:USERPROFILE\.dsh\aliyun-ecs.json"
```

```json
{ "accessKeyId": "LTAI...", "accessKeySecret": "..." }
```

**Step 4 — restart DSH.** The plugin and its configuration are read at startup.

**Step 5 — use it**

Type `/` in the DSH composer. If you see `connect`, `ecs-status`, and `ecs-stop`, the plugin is live:

```text
/ecs-status     ← read the instance without starting it
/connect        ← start it if needed, resolve the IP, open a terminal
```

A successful `/connect` opens a Windows Terminal window already connected, and DSH shows:

```text
✅ i-xxxxx (Running)
Public IP: 203.0.113.10
Terminal: windows-terminal
Command: ssh -i D:\path\to\your-key.pem ... root@203.0.113.10
```

---

## What it actually does

Connecting used to mean: log into the console → find the instance → click *Start* → wait → refresh → copy the public IP → open cmd → paste `ssh -i "D:\path\to\your-key.pem" root@<ip>`.

The plugin does all of that:

```text
/connect
  → DescribeInstances        (status + current public IP)
  → StartInstance            (only when stopped)
  → poll every 3 s until Running with a public IP
  → wait until TCP port 22 accepts (sshd starts after the OS)
  → open Windows Terminal with the ssh command
```

Two consequences:

- **The IP is read fresh every time**, so you never track it.
- **It is idempotent**: running it while the instance is already up just resolves the IP and opens a window (~1 s).

---

## Features

| Entry point | What it does |
|---|---|
| `/connect` | Start if needed → resolve IP → wait for SSH → open a terminal |
| `/ecs-status` | Status and current public IP only; **never** starts the instance |
| `/ecs-stop` | Stop the instance (pay-as-you-go instances use billing-stopping mode) |
| Natural language | Say "connect me to the server" and the agent calls the `ecs_connect` tool |
| Boot-time auto connect | Off by default; set `autoConnect: true` to enable |

---

## Prerequisites in detail

### 1. Make sure you can SSH into the instance

Connect once by hand and confirm:

```powershell
ssh -i "D:\path\to\your-key.pem" root@YOUR_PUBLIC_IP
```

- **User**: usually `root` (some Ubuntu images use `ubuntu`)
- **Key file exists**: `Test-Path D:\path\to\your-key.pem` must return `True`
- **Security group** allows inbound TCP 22 (instance details → Security Groups)
- Fix any of these **before** installing the plugin, otherwise a working plugin still cannot connect

### 2. Create a RAM sub-account and an AccessKey

> **Why?** The plugin clicks *Start* for you, which means calling Alibaba Cloud APIs, which requires an **AccessKey**. It is not your console password and not your `.pem`:
>
> | Thing | Used for | Who uses it |
> |---|---|---|
> | Console password | Alibaba Cloud website | you |
> | `.pem` key | SSH login | `ssh` |
> | **AccessKey** | Alibaba Cloud API calls | **this plugin** |

Never use the primary account's AccessKey. Create a sub-account limited to this one instance:

1. Alibaba Cloud console → avatar (top right) → **RAM** (Access Control)
2. **Identities → Users → Create User**
3. Name it something like `dsh-ecs-connect`
4. Access method: check **OpenAPI AccessKey** only — console login is not needed
5. The page shows the **AccessKey ID** and **AccessKey Secret**. The secret is shown **once**; copy it now (or download the CSV)
6. Grant permissions:
   - **Permissions → Create Policy → Script editor**
   - Paste the policy below, replacing `<region-id>` and `<instance-id>`
   - Name it `dsh-ecs-connect-policy` and create it

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

   For example, instance `i-xxxxxxxxxxxxxxxxx` in `cn-hongkong`:

```json
"Resource": "acs:ecs:cn-hongkong:*:instance/i-xxxxxxxxxxxxxxxxx"
```

7. Back at **Users → your user → Add Permissions → Custom policy → `dsh-ecs-connect-policy`**

This policy allows exactly three things: describe instances, start that one instance, stop that one instance. It cannot delete anything or touch other instances.

> If you get `Forbidden.RAM` after this, first check the policy is really attached to the user. Some accounts require `"Resource": "*"` on the two action statements — with only these three actions the exposure stays small.

### 3. Find the instance ID and region

Console → **ECS → Instances**:

- **Instance ID**: the `i-...` string in the list
- **Region**: shown at the top left; the code goes in `regionId`

| Console label | regionId |
|---|---|
| Hong Kong | `cn-hongkong` |
| Hangzhou | `cn-hangzhou` |
| Beijing | `cn-beijing` |
| Shenzhen | `cn-shenzhen` |
| Singapore | `ap-southeast-1` |

### 4. Install DSH

Node.js 20 or newer, then:

```powershell
npx @deepseek-ai/dsh@latest web
```

Open the URL it prints (usually `http://127.0.0.1:3080`).

---

## Install the plugin

This is a DSH **bundle**: no third-party dependencies, no `npm install`, no build step.

```powershell
git clone https://github.com/SepTem61r/dsh-aliyun-ecs-connect.git D:\dsh-aliyun-ecs-connect
```

Then either ask the DSH agent to install that directory as a bundle, or call the plugin manager's `install_bundle` with the directory path. When the plugin manager reports the bundle as installed and applied, type `/` in the composer to confirm the three commands.

> If installation reports that `pnpm` is missing: run `npm install -g pnpm` and retry. pnpm is only needed by DSH's plugin installer — the plugin itself uses only Node built-ins.

---

## Write the two configuration files

The plugin deliberately keeps **no personal data in the repository**. Yours live in your own home directory:

| File | Contents | In the repo? |
|---|---|---|
| `%USERPROFILE%\.dsh\aliyun-ecs-settings.json` | instance ID, region, key path, toggles | no |
| `%USERPROFILE%\.dsh\aliyun-ecs.json` | AccessKey ID / Secret | no |

Both are plain JSON — Notepad is enough.

### `aliyun-ecs-settings.json`

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

Windows paths need `\\` inside JSON.

| Key | Default | Meaning |
|---|---|---|
| `regionId` | `cn-hongkong` | ECS region |
| `instanceId` | required | Instance ID |
| `sshUser` | `root` | SSH user |
| `identityFile` | required | Absolute path to the private key |
| `sshPort` | `22` | SSH port |
| `terminal` | `auto` | `auto` (Windows Terminal, then cmd), `wt`, or `cmd` |
| `autoConnect` | `false` | Connect automatically when the harness boots |
| `autoConnectDelayMs` | `2500` | Delay before that automatic connect |
| `startTimeoutMs` | `180000` | Total budget for start + IP |
| `pollIntervalMs` | `3000` | Polling interval |
| `sshReadyTimeoutMs` | `90000` | Budget for port 22 |
| `credentialsFile` | `~/.dsh/aliyun-ecs.json` | Override the credential path |
| `settingsFile` | `~/.dsh/aliyun-ecs-settings.json` | Override this file's path |
| `endpoint` | `ecs.<regionId>.aliyuncs.com` | Override the API endpoint |

### `aliyun-ecs.json`

```powershell
notepad "$env:USERPROFILE\.dsh\aliyun-ecs.json"
```

```json
{ "accessKeyId": "LTAI5t...", "accessKeySecret": "..." }
```

The environment variables `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` take priority. Optionally tighten the file ACL to yourself:

```powershell
$p = "$env:USERPROFILE\.dsh\aliyun-ecs.json"
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $p /grant:r ($me + ':(F)')
icacls $p /inheritance:r
```

---

## First run and verification

1. **Restart DSH** — configuration is read at startup.
2. Type `/` — you should see `connect`, `ecs-status`, `ecs-stop`.
3. Run `/ecs-status` first: it proves credentials and settings are right without starting anything.
4. Run `/connect`: it waits 20–60 s (longer for cold starts) and then opens the terminal.
5. Type `whoami` in that window — `root` means everything works.

New IPs are auto-accepted: the generated command uses `StrictHostKeyChecking=accept-new`.

---

## Daily use

```text
/connect       start if needed, resolve the IP, open a terminal
/ecs-status    status and current public IP
/ecs-stop      stop it when you are done
```

Or just talk to the agent: "connect me to the server", "what's the server status?", "shut it down".

`/connect` does **not** stop the instance when you close the terminal window — run `/ecs-stop` when you are done.

---

## Billing

- The plugin only starts and stops an instance; it does not change the billing method.
- Stopping only saves money on **pay-as-you-go instances in billing-stopping mode**.
- Disks still bill while stopped, and a bound EIP may bill as well.
- Pay-as-you-go is billed per second while running — `/ecs-stop` reliably.
- Alibaba Cloud's own scheduled start/stop tasks also work when your PC is off; `/ecs-stop` only works while DSH is running. Combine both if you want a safety net.

---

## Why no EIP is needed

A pay-as-you-go instance in billing-stopping mode releases its public IP when stopped and receives a new one on start — that is why the address keeps changing. The plugin resolves the address after every start, so a fixed EIP (and its idle fee) is unnecessary. Buy an EIP only when you need a stable address for DNS or an allowlist.

---

## Security notes

- Use a **RAM sub-account** with only those three actions; never a primary AccessKey.
- Never commit the AccessKey, the `.pem`, or the settings file; `.gitignore` covers them, but they live outside the repo anyway.
- The plugin uses the key only to sign requests. It never logs or reports it.
- The terminal command contains the key path; nothing writes it to a log file.

---

## Troubleshooting

| Message | Cause | Fix |
|---|---|---|
| `缺少 instanceId` | Settings file has no instance ID | Add `instanceId` |
| `找不到 SSH 私钥文件` | Wrong `identityFile` path | Check `Test-Path`; use `\\` in JSON |
| `找不到 AccessKey 文件` | Credential file missing | Create `aliyun-ecs.json` |
| `AccessKey 文件里还是模板占位内容` | Example file copied verbatim | Put the real ID / secret |
| `设置文件不是合法 JSON` | Missing comma or quote | Validate the JSON; escape Windows paths |
| `Forbidden.RAM` | Sub-account not authorized | Attach the policy; some accounts need `"Resource": "*"` |
| `InstanceNotFound` | Wrong ID / region, or another account's key | Double-check both |
| `等待实例运行超时` | Instance stuck starting | Inspect it in the console (stock, arrears, system issue) |
| Window opens but cannot connect | Security group blocks 22, or sshd not ready | Fix the rule; retry after 30 s |
| `/` shows no commands | Plugin not installed, or not restarted | Install the bundle, restart DSH |
| `pnpm: command not found` during install | DSH's installer needs pnpm | `npm install -g pnpm` |
| Non-standard SSH port | Port changed | Set `sshPort` |

Diagnose in order: `/ecs-status` first (proves settings + credentials), then `/connect`.

---

## FAQ

**Will opening DSH start the server and cost money?**
No. `autoConnect` defaults to `false`; only `/connect` starts it.

**Do I need to restart after editing the settings?**
Yes for the settings file. The credential file is read per operation, so key rotation needs no restart.

**Can it manage several instances?**
One instance per configuration today. Use a second profile with a different `instanceId`, or open an issue.

**Does it work on macOS / Linux?**
Not yet: the window launch uses `wt.exe` / `cmd.exe`. Only `lib/terminal.js` needs a port.

**No Windows Terminal installed?**
`terminal: "auto"` falls back to `cmd.exe`; functionality is identical.

**The IP changes every time — will SSH complain about the host key?**
A new IP is a new entry in `known_hosts` and is accepted automatically; old entries stay but do not interfere.

**Does the plugin send my data anywhere?**
It only talks to `ecs.<region>.aliyuncs.com`. No telemetry, no external services.

---

## Development

No dependencies, no build step.

```powershell
node test/plugin-wiring.mjs   # command/tool registration and the auto-connect branch
node test/smoke.mjs --status  # read-only query using the real settings file
node test/smoke.mjs --open    # full flow, opens a terminal
node test/smoke.mjs --stop    # stop the instance
```

| File | Role |
|---|---|
| `index.js` | Plugin wiring: commands, `ecs_connect` tool, boot-time auto connect |
| `lib/ecs.js` | Hand-written ECS OpenAPI client (HMAC-SHA1, `node:crypto`) |
| `lib/flow.js` | Orchestration: status → start → wait → port probe → terminal |
| `lib/terminal.js` | Windows Terminal launch with a `cmd.exe` fallback |
| `lib/config.js` | Defaults, settings file, credential loading and validation |
| `cordis.patch.yml` | Bundle patch that inserts the row (contains no personal data) |

---

## Layout

```text
dsh-aliyun-ecs-connect/
├─ index.js                 # plugin entry (commands / tool / auto connect)
├─ lib/                     # client, orchestration, terminal, config
├─ locale/                  # plugin page titles and descriptions
├─ icon.svg                 # plugin icon
├─ cordis.patch.yml         # bundle patch
├─ examples/                # example settings and RAM policy
├─ test/                    # wiring test + smoke test
├─ README.md                # English (this file)
├─ README.zh-CN.md          # Chinese tutorial
└─ LICENSE                  # MIT
```

---

## License

MIT — see [LICENSE](LICENSE).
