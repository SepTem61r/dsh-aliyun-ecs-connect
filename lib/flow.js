/**
 * The connect flow: idempotent start, wait for the running instance and its
 * public address, wait for sshd, then hand the session to a terminal window.
 */
import { connect } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { describeInstance, isInProgressError, startInstance, waitForInstanceRunning } from './ecs.js'
import { formatSshCommand, launchTerminal } from './terminal.js'

/**
 * One TCP reachability probe.
 * @param {string} host - address to probe.
 * @param {number} port - port to probe.
 * @param {number} [timeoutMs] - per-probe timeout.
 * @returns {Promise<boolean>} true when the port accepted a connection.
 */
export function probeTcp(host, port, timeoutMs = 3_000) {
  return new Promise(resolve => {
    const socket = connect({ host, port })
    let settled = false
    const settle = value => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs, () => settle(false))
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
  })
}

/**
 * Wait until sshd listens, polling once per 1.5 seconds.
 * @param {string} host - public address.
 * @param {number} port - ssh port.
 * @param {number} timeoutMs - total budget.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<boolean>} false when the budget ran out.
 */
export async function waitForSshPort(host, port, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await probeTcp(host, port)) return true
    if (Date.now() >= deadline) return false
    await delay(1_500, undefined, { signal })
  }
}

/**
 * Bring the instance up and connect to it.
 * @param {object} options - flow inputs.
 * @param {object} options.config - resolved configuration.
 * @param {object} options.credentials - accessKeyId and accessKeySecret.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {(message: string) => void} [options.log] - progress sink.
 * @param {boolean} [options.openTerminal] - whether to open a window.
 * @returns {Promise<{instanceId: string, name: string, status: string, ip: string, regionId: string, sshCommand: string, sshReady: boolean, terminal: string}>} outcome.
 */
export async function connectToInstance({ config, credentials, signal, log = () => {}, openTerminal = true }) {
  log(`查询实例 ${config.instanceId}（${config.regionId}）…`)
  let info = await describeInstance(config, credentials, signal)

  if (info.status === 'Stopped') {
    log('实例已停止，正在启动…')
    try {
      await startInstance(config, credentials, signal)
      log('启动请求已提交')
    } catch (error) {
      if (!isInProgressError(error)) throw error
      log('实例已在启动流程中，继续等待')
    }
  }

  if (info.status !== 'Running' || info.ip.length === 0) {
    info = await waitForInstanceRunning(config, credentials, signal, next => {
      log(`状态 ${next.status}${next.ip ? `，公网 IP ${next.ip}` : ''}`)
    })
  }
  log(`实例已运行，公网 IP：${info.ip}`)

  const sshPort = Number(config.sshPort) || 22
  const sshReady = await waitForSshPort(
    info.ip,
    sshPort,
    Number(config.sshReadyTimeoutMs) || 90_000,
    signal,
  )
  if (!sshReady) log('SSH 端口暂时还没有响应，仍会打开终端（系统可能还需要几十秒）')

  const sshCommand = formatSshCommand(config, info.ip)
  let terminal = ''
  if (openTerminal) {
    const opened = await launchTerminal(config, info.ip)
    terminal = opened.kind
    log(`已打开终端（${terminal}）：${sshCommand}`)
  }

  return { ...info, sshCommand, sshReady, terminal }
}
