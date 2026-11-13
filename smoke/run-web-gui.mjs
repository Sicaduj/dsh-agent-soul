#!/usr/bin/env node
/**
 * Isolated Web GUI harness for the Agent Soul port.
 *
 * Boots a real `dsh web` process from the DSH source checkout with a temporary
 * DSH_HOME, the Web bundle, the scripted soul adapter, and this package, then
 * prints the authenticated `/ui/?token=...` URL. The harness keeps running
 * until SIGINT/SIGTERM so Computer Use can drive the real Settings > Agent Soul
 * page and the scripted spawn flow.
 *
 * It is a development harness: no credentials, no paid provider, and no
 * mutation of the live profile. The fixture is smoke/soul-llm.ts.
 *
 * Usage:
 *   node smoke/run-web-gui.mjs
 *   DSH_CHECKOUT=/path/to/deepseek-harness node smoke/run-web-gui.mjs
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const smokeDir = dirname(fileURLToPath(import.meta.url))
const pluginDir = resolve(smokeDir, '..')
const checkout = resolve(process.env.DSH_CHECKOUT ?? '/Users/zosyn/LLM/deepseek-harness')
const cliBin = join(checkout, 'apps/cli/src/bin.ts')
const tsconfigPath = join(checkout, 'tsconfig.json')
const evidenceDir = join(pluginDir, 'smoke', 'evidence', 'gui-022')

/** Write one soul definition the scripted Lead can spawn. */
async function writeSouls(root) {
  const dir = join(root, '.dsh', 'agents')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'probe.md'), `---
name: probe
description: Probes the Agent Soul runtime and reports its persona, tool permission matrix, and routed model. Use only for the smoke test.
tools:
  - read
  - grep
  - glob
model: deepseek-v4-pro
user-invocable: false
context: fresh
---

## Role Definition

You are the soul probe. Report the facts of your runtime; do not change anything. SOUL_PROBE_MARKER

## Hard Rules

- Use only the read, grep, and glob tools.

## Output Format

One short report through send_message.
`, 'utf8')
  await writeFile(join(dir, 'probe-cli.md'), `---
name: probe-cli
description: User-invocable probe soul used by the smoke run to verify slash-command registration and execution.
tools:
  - pwsh
  - read
model: deepseek-flash
user-invocable: true
context: fresh
---

## Role Definition

You are the command-line probe. COMMAND_SOUL_MARKER

## Hard Rules

- Use only the read tool and the session shell tool.

## Output Format

One short sentence.
`, 'utf8')
}

/** Write the isolated web profile. */
async function writeProfile(home) {
  const profileDir = join(home, 'profiles', 'web')
  const packageDir = join(profileDir, 'node_modules', '@local', 'dsh-agent-soul')
  await mkdir(dirname(packageDir), { recursive: true })
  await symlink(pluginDir, packageDir, process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-web-gui-smoke',
    private: true,
    dependencies: {
      '@local/dsh-agent-soul': `file:${pluginDir}`,
    },
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-web-app',
          '@local/dsh-agent-soul',
        ],
      },
    },
  }, undefined, 2)}\n`, 'utf8')
  const fixtureUrl = pathToFileURL(join(smokeDir, 'soul-llm.ts')).href
  await writeFile(join(profileDir, 'cordis.patch.yml'), [
    '# The base bundle supplies the enabled tool-agent-team row; this plugin adds the soul surface.',
    '- id: llm-deepseek',
    '  disabled: true',
    '- id: llm-deepseek-account',
    '  disabled: true',
    '- id: deepseek-account',
    '  disabled: true',
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: '${join(home, 'sessions')}'`,
    '    compression: none',
    '- id: agent-team',
    '  config:',
    '    maxTasks: 256',
    '    defaultEnabled: true',
    '# Keep the default workspace inside the disposable root, never the user Documents tree.',
    '- id: workspace-controller',
    '  config:',
    `    documentsDirectory: '${join(dirname(home), 'Documents')}'`,
    '- insert:',
    '    - id: soul-smoke-llm',
    `      name: '${fixtureUrl}'`,
    '',
  ].join('\n'), 'utf8')
}

/** The isolated child environment: no inherited loaders, proxies, or credentials. */
function childEnvironment(home) {
  const allowed = [
    'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP',
    'USERPROFILE', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'LANG', 'LC_ALL',
  ]
  const env = {}
  for (const key of allowed) if (typeof process.env[key] === 'string') env[key] = process.env[key]
  Object.assign(env, {
    TSX_TSCONFIG_PATH: tsconfigPath,
    DSH_HOME: home,
    DSH_AGENTS_HOME: join(home, '.agents'),
    DSH_TELEMETRY_DISABLED: '1',
    DEEPSEEK_API_KEY: '',
    SOUL_PROBE_OUT: join(home, 'observations.jsonl'),
    NODE_OPTIONS: '--disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
  })
  return env
}

/** Start the CLI from source with the checkout's tsx loader. */
async function main() {
  for (const path of [cliBin, tsconfigPath]) await readFile(path)
  const tsxLoaderUrl = pathToFileURL(createRequire(join(checkout, 'package.json')).resolve('tsx')).href
  const root = await mkdtemp(join(tmpdir(), 'dsh-soul-web-gui-'))
  const home = join(root, '.dsh')
  await mkdir(home, { recursive: true })
  await writeSouls(root)
  await writeProfile(home)
  await mkdir(evidenceDir, { recursive: true })
  const child = spawn(process.execPath, [
    '--import', tsxLoaderUrl,
    cliBin,
    '--profile', 'web',
    '--port', '0',
    '--no-open',
  ], {
    cwd: root,
    env: childEnvironment(home),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk) })
  child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk) })

  const url = await new Promise((resolveUrl, rejectUrl) => {
    const timeout = setTimeout(() => rejectUrl(new Error(`dsh web did not print a URL within 120s\nstdout: ${stdout}\nstderr: ${stderr}`)), 120_000)
    const inspect = () => {
      const match = /(https?:\/\/[^\s]+(?:\/ui\/[^\s]*|\?token=[^\s]+))/u.exec(stdout)
      if (match === null) return false
      clearTimeout(timeout)
      resolveUrl(match[1])
      return true
    }
    const timer = setInterval(() => {
      if (inspect()) clearInterval(timer)
    }, 50)
    child.once('exit', code => {
      clearInterval(timer)
      clearTimeout(timeout)
      rejectUrl(new Error(`dsh web exited ${String(code)} before printing a URL\nstdout: ${stdout}\nstderr: ${stderr}`))
    })
    inspect()
  })
  const server = { url, home, root, pid: child.pid, startedAt: new Date().toISOString() }
  await writeFile(join(evidenceDir, 'server.json'), `${JSON.stringify(server, null, 2)}\n`, 'utf8')
  await writeFile(join(evidenceDir, 'url.txt'), `${url}\n`, 'utf8')
  console.log(`\nAGENT-SOUL-WEB-GUI-READY ${url}`)

  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const code = await new Promise(resolveExit => child.once('close', resolveExit))
  process.exitCode = code ?? 0
}

await main().catch(error => {
  console.error(`web GUI smoke failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
