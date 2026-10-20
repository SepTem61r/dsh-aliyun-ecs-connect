# Aliyun ECS Quick Connect (DSH plugin)

Start an Alibaba Cloud ECS instance on demand, read its **current** public IP, and open an SSH terminal — instead of clicking *Start* in the console, waiting, copying the new IP, and retyping `ssh -i ... root@<ip>`.

Built as a plugin bundle for DeepSeek Harness (DSH).

[中文说明](README.zh-CN.md)

```
/connect
  → DescribeInstances (status + public IP)
  → StartInstance when stopped
  → poll every 3 s until Running with a public IP
  → TCP probe port 22 (sshd comes up after the OS)
  → open a terminal: ssh -i <key> -o StrictHostKeyChecking=accept-new root@<ip>
```

## Features

| Entry point | What it does |
|---|---|
| `/connect` | Full flow: start if needed, resolve the IP, wait for SSH, open a terminal window |
| `/ecs-status` | Status and current public IP only — never starts the instance |
| `/ecs-stop` | Stop the instance (pay-as-you-go instances use the billing-stopping mode) |
| `ecs_connect` tool | Model-callable; `openTerminal: false` returns the ssh command only |
| auto connect | Optional, off by default: run the flow automatically when the harness starts |

Everything is idempotent: running it while the instance is already up just resolves the IP and opens a window.

## Requirements

- DSH with a profile (the web app works)
- Windows 10/11 — the terminal launch uses `wt.exe` with a `cmd.exe /c start` fallback
- `ssh.exe` (OpenSSH client, bundled with Windows) and a `.pem` / private key
- Windows Terminal recommended, not required
- An Alibaba Cloud ECS instance and a RAM AccessKey with `ecs:DescribeInstances`, `ecs:StartInstance`, `ecs:StopInstance`

## Install

```powershell
git clone https://github.com/SepTem61r/dsh-aliyun-ecs-connect.git
cd dsh-aliyun-ecs-connect
```

1. Install the cloned directory as a local bundle — through the DSH plugin manager (`install_bundle` with this directory) or by asking your DSH agent to do it.
2. Create the settings file and the credential file (below).
3. Restart DSH.

The bundle declares no dependencies: it uses only Node built-ins, so there is no build step and no `node_modules`.

## Configuration

### Settings file — `~/.dsh/aliyun-ecs-settings.json`

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

See [`examples/aliyun-ecs-settings.example.json`](examples/aliyun-ecs-settings.example.json).

| Key | Default | Meaning |
|---|---|---|
| `regionId` | `cn-hongkong` | ECS region |
| `instanceId` | — | Instance ID (`i-...`) |
| `sshUser` | `root` | SSH user |
| `identityFile` | — | Private key path |
| `sshPort` | `22` | SSH port |
| `terminal` | `auto` | `auto` (Windows Terminal, then cmd), `wt`, or `cmd` |
| `autoConnect` | `false` | Run the connect flow when the harness boots |
| `autoConnectDelayMs` | `2500` | Delay before that boot-time connect |
| `startTimeoutMs` | `180000` | How long to wait for Running + IP |
| `pollIntervalMs` | `3000` | Polling interval |
| `sshReadyTimeoutMs` | `90000` | How long to wait for port 22 |
| `credentialsFile` | `~/.dsh/aliyun-ecs.json` | Override the credential path |
| `settingsFile` | `~/.dsh/aliyun-ecs-settings.json` | Override this file's path |
| `endpoint` | `ecs.<regionId>.aliyuncs.com` | Override the API endpoint |

A value written in the bundle row (`cordis.patch.yml`) is overridden by this file. Changes are read when the plugin activates, so restart DSH after editing.

### Credential file — `~/.dsh/aliyun-ecs.json`

```json
{ "accessKeyId": "LTAI...", "accessKeySecret": "..." }
```

The environment variables `ALIYUN_ACCESS_KEY_ID` and `ALIYUN_ACCESS_KEY_SECRET` take priority. The key is read per operation and never logged.

Use a **RAM sub-account**, not the primary account. Minimal policy — replace the placeholders and attach it to the sub-account:

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

See [`examples/aliyun-ram-policy.example.json`](examples/aliyun-ram-policy.example.json).

## Why it does not need an EIP

A pay-as-you-go instance in billing-stopping mode releases its public IP on stop and gets a new one on every start — that is why the address keeps changing. This plugin resolves the address after every start, so a fixed EIP (and its idle fee) is unnecessary. Use an EIP only when you need a stable address for DNS or an allowlist.

## Billing notes

- The plugin only starts and stops an instance; it does not change the billing method.
- Stopping only saves money on instances billed **pay-as-you-go with the billing-stopping mode**.
- Disks and EIPs may still bill while the instance is stopped — check the console.
- Alibaba Cloud's own scheduled start/stop tasks still work when your PC is off; the `/ecs-stop` command only works while DSH is running.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `缺少 instanceId` / `找不到 SSH 私钥文件` | Settings file missing or wrong |
| `找不到 AccessKey 文件` / placeholder content error | Credential file missing or still a template |
| `Forbidden.RAM` | The RAM policy is missing or its resource scope does not match |
| `InstanceNotFound` | Wrong instance ID / region, or the key belongs to another account |
| `等待实例运行超时` | The instance is stuck starting — check it in the console |
| Window opens but the connection fails | Security group does not allow port 22, or sshd is not up yet |

## Development

No dependencies and no build step.

```powershell
node test/plugin-wiring.mjs   # command/tool registration and the auto-connect branch
node test/smoke.mjs --status  # query the instance using the real settings file
node test/smoke.mjs --open    # full flow, opens a terminal
```

## License

MIT — see [LICENSE](LICENSE).
