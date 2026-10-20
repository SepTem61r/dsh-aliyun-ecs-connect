/**
 * Minimal Alibaba Cloud ECS OpenAPI client (RPC style, SignatureVersion 1.0).
 *
 * Node built-ins only: the bundle installs with no dependency tree, so these
 * requests are signed by hand with node:crypto.
 */
import { createHmac, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const API_VERSION = '2014-05-26'
const REQUEST_TIMEOUT_MS = 20_000

/** Status-related ECS error codes that mean "the request is already in flight". */
const IN_PROGRESS_CODES = new Set([
  'IncorrectInstanceStatus',
  'IncorrectInstanceStatus.Initializing',
  'InvalidInstanceStatus',
  'InvalidInstanceStatus.NotStopped',
  'OperationConflict',
  'LastTokenProcessing',
  'InstanceLockedForOperation',
])

/** One failed ECS OpenAPI call, carrying the service error code. */
export class EcsApiError extends Error {
  /**
   * @param {string} action - OpenAPI action name.
   * @param {string} code - service error code or transport marker.
   * @param {string} [detail] - human readable service message.
   * @param {string} [requestId] - Aliyun request id for support.
   */
  constructor(action, code, detail, requestId) {
    super(`阿里云 ${action} 调用失败：${code}${detail ? `（${detail}）` : ''}${requestId ? ` RequestId=${requestId}` : ''}`)
    this.name = 'EcsApiError'
    this.action = action
    this.code = code
    this.requestId = requestId
  }
}

/**
 * Percent-encode one parameter the way Alibaba Cloud RPC signing requires.
 * @param {unknown} value - raw parameter value.
 * @returns {string} RFC 3986 encoding.
 */
export function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/**
 * Canonicalized query string: keys sorted, every key and value encoded.
 * @param {Record<string, unknown>} params - parameters without Signature.
 * @returns {string} the canonicalized query.
 */
export function canonicalQuery(params) {
  return Object.keys(params)
    .sort()
    .map(key => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&')
}

/**
 * Sign one RPC request.
 * @param {Record<string, unknown>} params - parameters excluding Signature.
 * @param {string} accessKeySecret - RAM user secret.
 * @returns {string} base64 HMAC-SHA1 signature.
 */
export function signRequest(params, accessKeySecret) {
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonicalQuery(params))}`
  return createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64')
}

/**
 * Call one ECS OpenAPI action.
 * @param {string} action - action name, such as DescribeInstances.
 * @param {Record<string, unknown>} params - action parameters.
 * @param {object} config - resolved plugin configuration.
 * @param {object} credentials - accessKeyId and accessKeySecret.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<any>} parsed JSON body.
 */
export async function callEcs(action, params, config, credentials, signal) {
  const common = {
    Action: action,
    Format: 'JSON',
    Version: API_VERSION,
    AccessKeyId: credentials.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: randomUUID().replaceAll('-', ''),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    RegionId: config.regionId,
    ...params,
  }
  const endpoint = config.endpoint || `ecs.${config.regionId}.aliyuncs.com`
  const signature = signRequest(common, credentials.accessKeySecret)
  const url = `https://${endpoint}/?${canonicalQuery(common)}&Signature=${percentEncode(signature)}`

  const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)]
  if (signal !== undefined) signals.unshift(signal)

  let response
  try {
    response = await fetch(url, { signal: AbortSignal.any(signals), headers: { accept: 'application/json' } })
  } catch (error) {
    if (signal !== undefined && signal.aborted) throw error
    throw new EcsApiError(action, 'NetworkError', error instanceof Error ? error.message : String(error))
  }

  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new EcsApiError(action, `HTTP ${response.status}`, text.slice(0, 300))
  }
  if (body !== null && typeof body === 'object' && body.Code !== undefined) {
    throw new EcsApiError(action, String(body.Code), body.Message, body.RequestId)
  }
  if (!response.ok) throw new EcsApiError(action, `HTTP ${response.status}`, '', body?.RequestId)
  return body
}

/**
 * Read the first non-empty IP out of an array-or-string address field.
 * @param {unknown} value - PublicIpAddress.IpAddress or EipAddress.IpAddress.
 * @returns {string} the address, or an empty string.
 */
function firstAddress(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.find(item => typeof item === 'string') ?? ''
  return ''
}

/**
 * Project the fields this plugin needs out of one DescribeInstances record.
 * @param {any} instance - raw instance record.
 * @returns {{instanceId: string, name: string, status: string, ip: string, regionId: string}} normalized view.
 */
export function parseInstanceInfo(instance) {
  return {
    instanceId: String(instance?.InstanceId ?? ''),
    name: String(instance?.InstanceName ?? ''),
    status: String(instance?.Status ?? 'Unknown'),
    ip: firstAddress(instance?.EipAddress?.IpAddress) || firstAddress(instance?.PublicIpAddress?.IpAddress),
    regionId: String(instance?.RegionId ?? ''),
  }
}

/**
 * Describe exactly one instance, including its current public address.
 * @param {object} config - resolved plugin configuration.
 * @param {object} credentials - accessKeyId and accessKeySecret.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{instanceId: string, name: string, status: string, ip: string, regionId: string}>} instance view.
 */
export async function describeInstance(config, credentials, signal) {
  const body = await callEcs(
    'DescribeInstances',
    { InstanceIds: JSON.stringify([config.instanceId]) },
    config,
    credentials,
    signal,
  )
  const records = body?.Instances?.Instance
  const list = Array.isArray(records) ? records : records ? [records] : []
  const instance = list.find(item => item?.InstanceId === config.instanceId) ?? list[0]
  if (instance === undefined) {
    throw new EcsApiError(
      'DescribeInstances',
      'InstanceNotFound',
      `实例 ${config.instanceId} 在 ${config.regionId} 下不存在，或当前 AccessKey 没有权限查看`,
    )
  }
  return parseInstanceInfo(instance)
}

/**
 * Whether an error means the instance is already changing state.
 * @param {unknown} error - thrown value.
 * @returns {boolean} true when the caller should keep polling instead of failing.
 */
export function isInProgressError(error) {
  return error instanceof EcsApiError && IN_PROGRESS_CODES.has(error.code)
}

/**
 * Start one stopped instance.
 * @param {object} config - resolved plugin configuration.
 * @param {object} credentials - accessKeyId and accessKeySecret.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<void>} resolves once the request is accepted.
 */
export async function startInstance(config, credentials, signal) {
  await callEcs('StartInstance', { InstanceId: config.instanceId }, config, credentials, signal)
}

/**
 * Stop one instance, preferring the billing-stopping mode of pay-as-you-go instances.
 * @param {object} config - resolved plugin configuration.
 * @param {object} credentials - accessKeyId and accessKeySecret.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<void>} resolves once the request is accepted.
 */
export async function stopInstance(config, credentials, signal) {
  try {
    await callEcs(
      'StopInstance',
      { InstanceId: config.instanceId, StoppedMode: 'StopCharging' },
      config,
      credentials,
      signal,
    )
  } catch (error) {
    const unsupported = error instanceof EcsApiError
      && /^(InvalidParameter|InvalidStoppedMode|OperationDenied|NotSupported|IncorrectInstanceStatus)/.test(error.code)
    if (!unsupported) throw error
    await callEcs('StopInstance', { InstanceId: config.instanceId }, config, credentials, signal)
  }
}

/**
 * Poll until the instance is running with a public address.
 * @param {object} config - resolved plugin configuration.
 * @param {object} credentials - accessKeyId and accessKeySecret.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @param {(info: object) => void} [onPoll] - progress callback for every observation.
 * @returns {Promise<object>} the final instance view.
 */
export async function waitForInstanceRunning(config, credentials, signal, onPoll) {
  const startTimeoutMs = Number(config.startTimeoutMs) || 180_000
  const pollIntervalMs = Number(config.pollIntervalMs) || 3_000
  const deadline = Date.now() + startTimeoutMs
  for (;;) {
    const info = await describeInstance(config, credentials, signal)
    onPoll?.(info)
    if (info.status === 'Running' && info.ip.length > 0) return info
    if (Date.now() >= deadline) {
      throw new Error(
        `等待实例运行超时（${Math.round(startTimeoutMs / 1000)} 秒）：当前状态 ${info.status}，公网 IP ${info.ip || '暂无'}`,
      )
    }
    await delay(pollIntervalMs, undefined, { signal })
  }
}
