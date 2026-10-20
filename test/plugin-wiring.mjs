/**
 * Wiring test: apply the plugin against a stub context and assert exactly what
 * it registers. Runs without the harness:
 *
 *   node test/plugin-wiring.mjs
 */
import { apply, inject, name } from '../index.js'

/**
 * Build a stub Cordis context that records effects, commands, and tools.
 * @returns {object} stub context plus recording arrays.
 */
function makeContext() {
  const commands = []
  const tools = []
  const labels = []
  const disposers = []
  return {
    commands,
    tools,
    labels,
    disposers,
    ctx: {
      effect(fn, label) {
        labels.push(String(label))
        if (fn.constructor.name === 'GeneratorFunction') {
          const iterator = fn()
          for (let step = iterator.next(); !step.done; step = iterator.next()) {
            // Command registrations are yielded; the stub needs no cleanup.
          }
          const cleanup = iterator.next().value
          if (typeof cleanup === 'function') disposers.push(cleanup)
        } else {
          const cleanup = fn()
          if (typeof cleanup === 'function') disposers.push(cleanup)
        }
        return () => {}
      },
      commands: {
        register(definition) {
          commands.push(definition)
          return () => {}
        },
      },
      tools: {
        register(definition) {
          tools.push(definition)
          return () => {}
        },
      },
    },
  }
}

const failures = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}

const baseConfig = {
  // Point the plugin at paths that cannot exist, so a developer's real settings
  // file, instance, and key never leak into the test.
  settingsFile: 'C:\\no-such-dir\\aliyun-ecs-settings.json',
  regionId: 'cn-hongkong',
  instanceId: 'i-test0000000000000',
  sshUser: 'root',
  identityFile: 'C:\\no-such-dir\\key.pem',
}

const wiring = makeContext()
apply(wiring.ctx, { ...baseConfig, autoConnect: false })

check(name === 'aliyun-ecs-connect', `name export: ${name}`)
check(
  Array.isArray(inject) && inject.includes('commands') && inject.includes('tools'),
  'inject declares commands and tools',
)
check(
  wiring.commands.map(entry => entry.name).sort().join(',') === 'connect,ecs-status,ecs-stop',
  `commands: ${wiring.commands.map(entry => entry.name).join(',')}`,
)
check(
  wiring.commands.every(entry => typeof entry.handler === 'function' && entry.description.length > 0),
  'every command has a handler and description',
)
check(
  wiring.tools.map(entry => entry.name).join(',') === 'ecs_connect',
  `tools: ${wiring.tools.map(entry => entry.name).join(',')}`,
)
const tool = wiring.tools[0]
check(tool?.parameters?.type === 'object', 'tool parameters are an object schema')
check(typeof tool?.output?.render === 'function', 'tool output render is a function')
check(typeof tool?.execute === 'function', 'tool execute is a function')
check(
  wiring.labels.includes('aliyun-ecs-connect commands') && wiring.labels.includes('aliyun-ecs-connect tool'),
  `effect labels: ${wiring.labels.join(' | ')}`,
)

// The auto-connect branch runs in the background and must report, not throw,
// when a credential or key path is missing.
const auto = makeContext()
const logged = []
const originalLog = console.log
console.log = (...parts) => {
  logged.push(parts.join(' '))
}
apply(auto.ctx, {
  ...baseConfig,
  autoConnect: true,
  autoConnectDelayMs: 30,
  credentialsFile: 'C:\\no-such-dir\\credentials.json',
})
await new Promise(resolve => setTimeout(resolve, 500))
console.log = originalLog

check(
  logged.some(line => line.includes('自动连接失败')),
  `auto connect failure is logged: ${JSON.stringify(logged)}`,
)

if (failures.length > 0) {
  console.error('WIRING FAILURES:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exitCode = 1
} else {
  console.log('wiring ok: 3 commands, ecs_connect tool, auto-connect branch')
}
