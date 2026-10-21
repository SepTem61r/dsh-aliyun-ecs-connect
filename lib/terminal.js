/**
 * Where the SSH session opens.
 *
 * - auto / wt / cmd: a detached window on the Windows desktop, exactly like
 *   typing the command in cmd by hand.
 * - dsh: no window; the command is copied to the clipboard so the user can
 *   paste it into the DSH right-sidebar terminal.
 * - none: only report the command.
 */
import { spawn } from 'node:child_process'

/** Modes a user may configure or pass per call. */
export const TERMINAL_MODES = ['auto', 'wt', 'cmd', 'dsh', 'none']

/**
 * Normalize one user-provided mode, accepting a few friendly aliases.
 * @param {unknown} value - configured or per-call mode.
 * @returns {string | undefined} canonical mode, or undefined when unknown.
 */
export function normalizeTerminalMode(value) {
  const mode = String(value ?? '').trim().toLowerCase()
  if (mode.length === 0) return 'auto'
  if (mode === 'auto' || mode === 'wt' || mode === 'cmd' || mode === 'dsh' || mode === 'none') return mode
  if (mode === 'windows-terminal' || mode === 'windowsterminal') return 'wt'
  if (mode === 'external' || mode === 'window') return 'auto'
  if (mode === 'clipboard' || mode === 'copy') return 'dsh'
  if (mode === 'off' || mode === 'silent') return 'none'
  return undefined
}

/**
 * Build the ssh argv (without the `ssh` executable itself).
 * @param {object} config - resolved plugin configuration.
 * @param {string} ip - current public address.
 * @returns {string[]} ssh arguments.
 */
export function buildSshArgv(config, ip) {
  return [
    '-i',
    config.identityFile,
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ConnectTimeout=15',
    '-p',
    String(config.sshPort ?? 22),
    `${config.sshUser ?? 'root'}@${ip}`,
  ]
}

/**
 * Quote one argv element for display and for `cmd.exe`.
 * @param {string} argument - raw argument.
 * @returns {string} printable argument.
 */
function quote(argument) {
  return /[\s"]/.test(argument) ? `"${argument.replaceAll('"', '\\"')}"` : argument
}

/**
 * The equivalent shell command line, for display and copy/paste.
 * @param {object} config - resolved plugin configuration.
 * @param {string} ip - current public address.
 * @returns {string} printable ssh command.
 */
export function formatSshCommand(config, ip) {
  return ['ssh', ...buildSshArgv(config, ip)].map(quote).join(' ')
}

/**
 * Spawn a detached window and report whether the executable started.
 * @param {string} command - executable.
 * @param {string[]} args - arguments.
 * @returns {Promise<number | undefined>} child pid, or undefined when spawn failed.
 */
function tryLaunch(command, args) {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false })
    } catch {
      resolve(undefined)
      return
    }
    let settled = false
    const settle = value => {
      if (settled) return
      settled = true
      resolve(value)
    }
    child.once('error', () => settle(undefined))
    child.once('spawn', () => {
      try {
        child.unref()
      } catch {
        // The window is already running; unreferencing is best effort.
      }
      settle(child.pid)
    })
  })
}

/**
 * Put text on the Windows clipboard through `clip.exe`.
 * @param {string} text - text to copy.
 * @returns {Promise<boolean>} true when clip.exe exited successfully.
 */
export function copyToClipboard(text) {
  return new Promise(resolve => {
    let child
    try {
      child = spawn('clip.exe', [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
    } catch {
      resolve(false)
      return
    }
    let settled = false
    const settle = value => {
      if (settled) return
      settled = true
      resolve(value)
    }
    child.once('error', () => settle(false))
    child.once('close', code => settle(code === 0))
    try {
      child.stdin.end(text, 'utf8')
    } catch {
      settle(false)
    }
  })
}

/**
 * Open a terminal window running ssh to the instance.
 * @param {object} config - resolved plugin configuration.
 * @param {string} ip - current public address.
 * @param {string} [requestedMode] - per-call mode overriding the configured one.
 * @returns {Promise<{kind: string, pid: number | undefined}>} how the window was opened.
 */
export async function launchTerminal(config, ip, requestedMode) {
  const argv = buildSshArgv(config, ip)
  const mode = normalizeTerminalMode(requestedMode ?? config.terminal) ?? 'auto'

  if (mode === 'auto' || mode === 'wt') {
    const pid = await tryLaunch('wt.exe', ['ssh', ...argv])
    if (pid !== undefined) return { kind: 'wt', pid }
    if (mode === 'wt') {
      throw new Error('没有找到 Windows Terminal（wt.exe）；可以把 terminal 改成 "cmd"，或安装 Windows Terminal')
    }
  }

  const pid = await tryLaunch('cmd.exe', ['/c', 'start', '', 'ssh', ...argv])
  if (pid !== undefined) return { kind: 'cmd', pid }
  throw new Error('无法打开终端窗口：wt.exe 和 cmd.exe 都启动失败')
}
