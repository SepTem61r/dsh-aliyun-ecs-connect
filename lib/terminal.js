/**
 * Terminal launching for the SSH session.
 *
 * The plugin runs inside the Host process, so a detached child window outlives
 * this process and belongs to the user's desktop, exactly like typing the
 * command in cmd by hand.
 */
import { spawn } from 'node:child_process'

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
 * The equivalent shell command line, for display and for copy/paste.
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
 * Open a terminal window running ssh to the instance.
 * @param {object} config - resolved plugin configuration.
 * @param {string} ip - current public address.
 * @returns {Promise<{kind: string, pid: number | undefined}>} how the window was opened.
 */
export async function launchTerminal(config, ip) {
  const argv = buildSshArgv(config, ip)
  const mode = String(config.terminal ?? 'auto')

  if (mode === 'auto' || mode === 'wt' || mode === 'windows-terminal') {
    const pid = await tryLaunch('wt.exe', ['ssh', ...argv])
    if (pid !== undefined) return { kind: 'windows-terminal', pid }
    if (mode !== 'auto') {
      throw new Error('没有找到 Windows Terminal（wt.exe）；可以把 terminal 配置改成 "cmd"，或安装 Windows Terminal')
    }
  }

  const pid = await tryLaunch('cmd.exe', ['/c', 'start', '', 'ssh', ...argv])
  if (pid !== undefined) return { kind: 'cmd', pid }
  throw new Error('无法打开终端窗口：wt.exe 和 cmd.exe 都启动失败')
}
