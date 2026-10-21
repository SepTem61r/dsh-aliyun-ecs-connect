/**
 * Aliyun ECS one-click connect.
 *
 * Three human commands (`/connect`, `/ecs-status`, `/ecs-stop`), one model tool
 * (`ecs_connect`), and an optional boot-time auto connect that opens the SSH
 * terminal as soon as this harness starts.
 *
 * No third-party imports: the bundle installs without a dependency tree, and the
 * AccessKey is read from the user's own file on every operation.
 */
import { connectToInstance } from './lib/flow.js'
import { describeInstance, stopInstance } from './lib/ecs.js'
import { normalizeTerminalMode } from './lib/terminal.js'
import {
  assertInstanceConfig,
  assertRunnableConfig,
  loadCredentials,
  readSettings,
  resolveConfig,
} from './lib/config.js'

/** Cordis plugin name. */
export const name = 'aliyun-ecs-connect'

/** Services this plugin registers into. */
export const inject = ['tools', 'commands']

/**
 * Render one thrown value as a human command result.
 * @param {unknown} error - thrown value.
 * @returns {{kind: 'error', text: string}} command result.
 */
function failure(error) {
  return { kind: 'error', text: `失败：${error instanceof Error ? error.message : String(error)}` }
}

/** One-line description of where the session ended up. */
const MODE_USAGE = '用法：/connect [auto|wt|cmd|dsh|none]（不带参数时用设置文件里的 terminal）'

/**
 * Describe the terminal outcome for a human reading the command result.
 * @param {{terminal: string, clipboard: boolean}} result - connect outcome.
 * @returns {string} description.
 */
function describeOutcome(result) {
  if (result.terminal === 'dsh') {
    return result.clipboard
      ? '已复制到剪贴板 → 切到 DSH 右侧边栏终端 Ctrl+V 即可'
      : '剪贴板不可用，请手动复制下面的命令'
  }
  if (result.terminal === 'none') return '未打开（只显示命令）'
  return `已在 ${result.terminal} 窗口打开`
}

/**
 * Register commands, the model tool, and the optional boot-time auto connect.
 * @param {object} ctx - Cordis context carrying the command and tool registries.
 * @param {object} [rowConfig] - raw row config from the bundle patch.
 */
export function apply(ctx, rowConfig) {
  // The shipped row carries no personal data: the user's settings file supplies
  // the instance identity, SSH paths, and toggles.
  const { settings, file: settingsFile, error: settingsError } = readSettings(rowConfig)
  const config = resolveConfig(rowConfig, settings)
  const log = (...parts) => {
    console.log('[aliyun-ecs-connect]', ...parts.map(part => (part instanceof Error ? part.message : String(part))))
  }

  if (settingsError !== undefined) log(settingsError)

  // Async on purpose: assertRunnableConfig/loadCredentials throw synchronously,
  // and the boot-time auto connect has no caller to catch that.
  const connect = async (signal, options = {}) => {
    assertRunnableConfig(config)
    return connectToInstance({
      config,
      credentials: loadCredentials(config),
      signal,
      log,
      mode: options.mode,
      openTerminal: options.openTerminal,
    })
  }

  log(
    `已加载：实例 ${config.instanceId || '(未配置)'}，地域 ${config.regionId}，`
    + `设置文件 ${settingsFile}，自动连接 ${config.autoConnect ? '开启' : '关闭'}`,
  )

  ctx.effect(function* registerCommands() {
    yield ctx.commands.register({
      name: 'connect',
      description: '启动阿里云 ECS（已运行则跳过），取得公网 IP 并打开 SSH 终端（可临时指定打开方式）',
      input: { hint: '[auto|wt|cmd|dsh|none]' },
      handler: async invocation => {
        try {
          const requested = invocation.rawInput.trim()
          let mode
          if (requested.length > 0) {
            mode = normalizeTerminalMode(requested)
            if (mode === undefined) return { kind: 'error', text: MODE_USAGE }
          }
          const result = await connect(invocation.signal, { mode })
          return {
            kind: 'success',
            text: [
              `✅ ${result.instanceId}（${result.status}）`,
              `公网 IP：${result.ip}`,
              `终端：${describeOutcome(result)}${result.sshReady ? '' : '（SSH 端口尚未就绪）'}`,
              `命令：${result.sshCommand}`,
            ].join('\n'),
          }
        } catch (error) {
          return failure(error)
        }
      },
    })

    yield ctx.commands.register({
      name: 'ecs-status',
      description: '查看 ECS 实例状态与当前公网 IP（不会启动实例）',
      handler: async invocation => {
        try {
          assertInstanceConfig(config)
          const info = await describeInstance(config, loadCredentials(config), invocation.signal)
          return {
            kind: 'success',
            text: [
              `${info.instanceId} ${info.status}`,
              `公网 IP：${info.ip || '暂无'}`,
              `地域：${config.regionId}`,
            ].join('\n'),
          }
        } catch (error) {
          return failure(error)
        }
      },
    })

    yield ctx.commands.register({
      name: 'ecs-stop',
      description: '停止 ECS 实例（按量付费实例优先使用节省停机模式）',
      handler: async invocation => {
        try {
          assertInstanceConfig(config)
          await stopInstance(config, loadCredentials(config), invocation.signal)
          return { kind: 'success', text: `已提交停机请求：${config.instanceId}` }
        } catch (error) {
          return failure(error)
        }
      },
    })
  }, 'aliyun-ecs-connect commands')

  ctx.effect(() => {
    try {
      return ctx.tools.register({
        name: 'ecs_connect',
        description: '启动阿里云 ECS 实例（已运行则跳过），等待公网 IP 与 SSH 就绪，并按指定方式交付会话：外部终端窗口、复制命令到剪贴板（供 DSH 右侧边栏终端粘贴），或只返回命令。',
        parameters: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              description: '打开方式：auto（默认，先 Windows Terminal 再 cmd）、wt、cmd、dsh（不开窗口，把 ssh 命令复制到剪贴板）、none（只返回命令）。',
            },
          },
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              instanceId: { type: 'string' },
              status: { type: 'string' },
              ip: { type: 'string' },
              sshCommand: { type: 'string' },
              sshReady: { type: 'boolean' },
              terminal: { type: 'string' },
              clipboard: { type: 'boolean' },
            },
          },
          render: (_args, value) => [{
            type: 'text',
            text: `${value?.instanceId ?? ''} ${value?.status ?? ''}\n${value?.sshCommand ?? ''}`,
          }],
        },
        async execute(args, exec) {
          const requested = args?.mode === undefined ? undefined : normalizeTerminalMode(args.mode)
          if (args?.mode !== undefined && requested === undefined) {
            throw new Error('mode 必须是 auto、wt、cmd、dsh 或 none')
          }
          const result = await connect(exec.signal, { mode: requested })
          return {
            instanceId: result.instanceId,
            status: result.status,
            ip: result.ip,
            sshCommand: result.sshCommand,
            sshReady: result.sshReady,
            terminal: result.terminal,
            clipboard: result.clipboard,
          }
        },
      })
    } catch (error) {
      log('注册 ecs_connect 工具失败：', error)
      return () => {}
    }
  }, 'aliyun-ecs-connect tool')

  if (config.autoConnect === true) {
    ctx.effect(() => {
      const flag = Symbol.for('dsh.aliyun-ecs-connect.auto-connected')
      if (globalThis[flag] === true) return () => {}
      globalThis[flag] = true
      const timer = setTimeout(() => {
        // The extra tick keeps a synchronous throw out of the timer callback too.
        Promise.resolve()
          .then(() => connect(undefined, {}))
          .catch(error => log('自动连接失败：', error))
      }, Number(config.autoConnectDelayMs) || 2_500)
      timer.unref?.()
      return () => clearTimeout(timer)
    }, 'aliyun-ecs-connect auto connect')
  }
}
