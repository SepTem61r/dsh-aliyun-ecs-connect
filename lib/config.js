/**
 * Configuration defaults, user settings, AccessKey discovery, and fail-fast
 * validation.
 *
 * Nothing personal lives in this package: the instance identity and SSH paths
 * come from a user-owned settings file, and the AccessKey comes from a separate
 * user-owned credential file. Both are read on every operation, so rotated keys
 * reach the next call without restarting the harness.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Defaults for every documented row field. */
export const DEFAULT_CONFIG = {
  regionId: 'cn-hongkong',
  instanceId: '',
  sshUser: 'root',
  identityFile: '',
  sshPort: 22,
  terminal: 'auto',
  autoConnect: false,
  autoConnectDelayMs: 2500,
  startTimeoutMs: 180_000,
  pollIntervalMs: 3_000,
  sshReadyTimeoutMs: 90_000,
  credentialsFile: '',
  settingsFile: '',
  endpoint: '',
}

/** Template text that must not survive as a real credential. */
const PLACEHOLDER = /在这里|贴这里|把 ?AccessKey|your[-_ ]?access/i

/**
 * Render one thrown value as a message.
 * @param {unknown} error - thrown value.
 * @returns {string} message.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Overlay one object layer onto resolved configuration, ignoring empty values.
 * @param {Record<string, unknown>} target - object being written.
 * @param {unknown} layer - source layer.
 * @returns {void}
 */
function overlay(target, layer) {
  if (layer === null || typeof layer !== 'object' || Array.isArray(layer)) return
  for (const [key, value] of Object.entries(layer)) {
    if (value !== undefined && value !== null) target[key] = value
  }
}

/**
 * Merge defaults, the bundle row, and the user settings file.
 * Later layers win, so a user's settings file overrides the shipped row.
 * @param {unknown} [row] - raw row config from the bundle patch.
 * @param {Record<string, unknown>} [settings] - user settings file content.
 * @returns {object} resolved configuration.
 */
export function resolveConfig(row, settings) {
  const merged = { ...DEFAULT_CONFIG }
  overlay(merged, row)
  overlay(merged, settings)
  return merged
}

/**
 * Where the AccessKey file lives.
 * @param {object} config - resolved configuration.
 * @returns {string} absolute credentials path.
 */
export function resolveCredentialsPath(config) {
  const configured = typeof config?.credentialsFile === 'string' ? config.credentialsFile.trim() : ''
  return configured.length > 0 ? configured : join(homedir(), '.dsh', 'aliyun-ecs.json')
}

/**
 * Where the instance settings file lives.
 * @param {object} config - resolved configuration.
 * @returns {string} absolute settings path.
 */
export function resolveSettingsPath(config) {
  const configured = typeof config?.settingsFile === 'string' ? config.settingsFile.trim() : ''
  return configured.length > 0 ? configured : join(homedir(), '.dsh', 'aliyun-ecs-settings.json')
}

/**
 * Read the user settings file. A missing file is normal (defaults apply), while
 * a malformed one is reported instead of thrown so plugin activation survives.
 * @param {object} [config] - row config, for the optional settingsFile override.
 * @returns {{settings: Record<string, unknown>, file: string, error: string | undefined}} read result.
 */
export function readSettings(config) {
  const file = resolveSettingsPath(config)
  if (!existsSync(file)) return { settings: {}, file, error: undefined }
  let raw
  try {
    raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim()
  } catch (error) {
    return { settings: {}, file, error: `读取设置文件失败：${messageOf(error)}` }
  }
  if (raw.length === 0) return { settings: {}, file, error: undefined }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { settings: {}, file, error: `设置文件不是合法 JSON：${file}` }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { settings: {}, file, error: `设置文件必须是 JSON 对象：${file}` }
  }
  const settings = {}
  overlay(settings, parsed)
  return { settings, file, error: undefined }
}

/**
 * Load the RAM user AccessKey from the environment, then from the credential file.
 * @param {object} config - resolved configuration.
 * @returns {{accessKeyId: string, accessKeySecret: string, source: string}} credentials.
 * @throws when no usable credential exists.
 */
export function loadCredentials(config) {
  const envId = typeof process.env.ALIYUN_ACCESS_KEY_ID === 'string' ? process.env.ALIYUN_ACCESS_KEY_ID.trim() : ''
  const envSecret = typeof process.env.ALIYUN_ACCESS_KEY_SECRET === 'string' ? process.env.ALIYUN_ACCESS_KEY_SECRET.trim() : ''
  if (envId.length > 0 && envSecret.length > 0) {
    return { accessKeyId: envId, accessKeySecret: envSecret, source: '环境变量' }
  }

  const file = resolveCredentialsPath(config)
  if (!existsSync(file)) {
    throw new Error(`找不到 AccessKey 文件：${file}（需要写入 accessKeyId 与 accessKeySecret）`)
  }
  const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`AccessKey 文件不是合法 JSON：${file}`)
  }
  const accessKeyId = String(parsed?.accessKeyId ?? parsed?.AccessKeyId ?? '').trim()
  const accessKeySecret = String(parsed?.accessKeySecret ?? parsed?.AccessKeySecret ?? '').trim()
  if (accessKeyId.length === 0 || accessKeySecret.length === 0) {
    throw new Error(`AccessKey 文件缺少 accessKeyId 或 accessKeySecret：${file}`)
  }
  if (PLACEHOLDER.test(accessKeyId) || PLACEHOLDER.test(accessKeySecret)) {
    throw new Error(`AccessKey 文件里还是模板占位内容，请填入真实值：${file}`)
  }
  return { accessKeyId, accessKeySecret, source: file }
}

/**
 * Require the fields needed to talk to the instance.
 * @param {object} config - resolved configuration.
 * @returns {void}
 */
export function assertInstanceConfig(config) {
  if (typeof config.instanceId !== 'string' || config.instanceId.trim().length === 0) {
    throw new Error('缺少 instanceId：请在设置文件里写入实例 ID（形如 i-xxxxxxxxxxxxxxxxx）')
  }
  if (typeof config.regionId !== 'string' || config.regionId.trim().length === 0) {
    throw new Error('缺少 regionId：请在设置文件里写地域（形如 cn-hongkong）')
  }
}

/**
 * Require the fields needed to build the ssh command.
 * @param {object} config - resolved configuration.
 * @returns {void}
 */
export function assertSshConfig(config) {
  if (typeof config.sshUser !== 'string' || config.sshUser.trim().length === 0) {
    throw new Error('缺少 sshUser：请在设置文件里写 SSH 用户（例如 root）')
  }
  if (typeof config.identityFile !== 'string' || config.identityFile.trim().length === 0) {
    throw new Error('缺少 identityFile：请在设置文件里写 pem 私钥路径')
  }
  if (!existsSync(config.identityFile)) {
    throw new Error(`找不到 SSH 私钥文件：${config.identityFile}`)
  }
}

/**
 * Require everything the connect flow needs.
 * @param {object} config - resolved configuration.
 * @returns {void}
 */
export function assertRunnableConfig(config) {
  assertInstanceConfig(config)
  assertSshConfig(config)
}
