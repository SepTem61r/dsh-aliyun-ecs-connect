/**
 * Standalone smoke test for the connect flow, runnable without installing the
 * bundle. Reads the same settings and credential files the plugin reads, and
 * never prints the AccessKey.
 *
 *   node test/smoke.mjs --status                    # query only (uses settings file)
 *   node test/smoke.mjs --open                      # full flow + open a terminal
 *   node test/smoke.mjs --mode dsh                  # copy the ssh command instead of opening a window
 *   node test/smoke.mjs --stop                      # stop the instance
 *   node test/smoke.mjs --status --instance i-xxxx --key "D:\key.pem"   # override settings
 */
import { parseArgs } from 'node:util'
import { connectToInstance } from '../lib/flow.js'
import { describeInstance, stopInstance } from '../lib/ecs.js'
import { loadCredentials, readSettings, resolveConfig } from '../lib/config.js'

const { values } = parseArgs({
  options: {
    instance: { type: 'string' },
    key: { type: 'string' },
    region: { type: 'string' },
    user: { type: 'string' },
    settings: { type: 'string' },
    mode: { type: 'string' },
    open: { type: 'boolean', default: false },
    status: { type: 'boolean', default: false },
    stop: { type: 'boolean', default: false },
  },
})

const row = values.settings === undefined ? {} : { settingsFile: values.settings }
const { settings, file, error } = readSettings(row)
if (error !== undefined) {
  console.error(`[smoke] ${error}`)
  process.exitCode = 1
} else {
  const overrides = {}
  if (values.instance !== undefined) overrides.instanceId = values.instance
  if (values.key !== undefined) overrides.identityFile = values.key
  if (values.region !== undefined) overrides.regionId = values.region
  if (values.user !== undefined) overrides.sshUser = values.user

  const config = resolveConfig({ ...settings, ...overrides })
  const log = message => console.log(`[smoke] ${message}`)
  log(`settings=${file} instance=${config.instanceId || '(unset)'} region=${config.regionId}`)

  try {
    const credentials = loadCredentials(config)
    if (values.stop) {
      await stopInstance(config, credentials)
      log('stop request accepted')
    } else if (values.status) {
      const info = await describeInstance(config, credentials)
      log(`${info.instanceId} ${info.status} ip=${info.ip || '(none)'} region=${info.regionId}`)
    } else {
      const result = await connectToInstance({
        config,
        credentials,
        openTerminal: values.open,
        mode: values.mode,
        log,
      })
      log(`instance=${result.instanceId} status=${result.status} ip=${result.ip}`)
      log(`ssh=${result.sshCommand}`)
      log(`sshReady=${result.sshReady} terminal=${result.terminal || '(not opened)'} clipboard=${result.clipboard}`)
    }
    log(`credential source: ${credentials.source}`)
  } catch (caught) {
    console.error(`[smoke] FAILED: ${caught instanceof Error ? caught.message : String(caught)}`)
    process.exitCode = 1
  }
}
