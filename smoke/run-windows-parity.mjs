#!/usr/bin/env node
/**
 * Optional real-harness parity probe for the inverted shell composition.
 *
 * `smoke/run-smoke.mjs` proves the forward case on this POSIX checkout: a soul
 * declaring `pwsh` spawns when the live session registers `bash`. This probe
 * covers the mirror image without a Windows machine: it boots a real
 * `dsh --profile headless` run whose profile disables the `tool-bash` row and
 * mounts a tiny test-only plugin that registers a stand-in `pwsh` tool, then
 * publishes a soul declaring `bash`. The real spawn validation and apply path
 * must resolve the counterpart and hand the child the live `pwsh` tool.
 *
 * The scripted LLM adapter, the profile bundle order, and the isolated
 * `DSH_HOME` scaffolding are the same shapes `smoke/run-smoke.mjs` uses; only
 * the shell rows, the fake tool plugin, and the assertions differ. It is a
 * development verification harness, not shipped plugin code.
 *
 * Usage:
 *   node smoke/run-windows-parity.mjs
 *   DSH_CHECKOUT=/path/to/deepseek-harness node smoke/run-windows-parity.mjs
 *
 * Run it only while no other headless DSH boot is active.
 */

import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { childEnvironment, seedEnvironmentCanaries } from './run-smoke.mjs'

const smokeDir = dirname(fileURLToPath(import.meta.url))
const pluginDir = resolve(smokeDir, '..')
const checkout = resolve(process.env.DSH_CHECKOUT ?? '/Users/zosyn/LLM/deepseek-harness')
const cliBin = join(checkout, 'apps/cli/src/bin.ts')
const tsconfigPath = join(checkout, 'tsconfig.json')

/** `tsx` is only needed for the real CLI boot, so keep module import cheap. */
let cachedTsxLoader
function tsxLoaderUrl() {
  if (cachedTsxLoader === undefined) {
    cachedTsxLoader = pathToFileURL(createRequire(join(checkout, 'package.json')).resolve('tsx')).href
  }
  return cachedTsxLoader
}

/** Print one assertion outcome; fail on the first failure. */
const checks = []
function check(name, condition, detail = '') {
  const ok = Boolean(condition)
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) throw new Error(`parity assertion failed: ${name}${detail === '' ? '' : ` (${detail})`}`)
}

/**
 * Return one composed-config row by id, up to the next row (or bundle banner).
 * The dump interleaves bundle banners with the composed rows, so a row-scoped
 * check is the only way to prove this profile's patch actually won.
 * @param {string} dump
 * @param {string} id
 * @returns {string | null}
 */
function configRow(dump, id) {
  const lines = dump.split('\n')
  const index = lines.findIndex(line => line === `- id: ${id}`)
  if (index === -1) return null
  const block = []
  for (let cursor = index; cursor < lines.length; cursor += 1) {
    if (cursor > index && (lines[cursor].startsWith('- id:') || lines[cursor].startsWith('# =='))) break
    block.push(lines[cursor])
  }
  return block.join('\n')
}

/** Refuse to boot beside another live headless run (best effort; pgrep is POSIX). */
function assertNoActiveHeadlessBoot() {
  /** @type {string} */
  let listing
  try {
    listing = execFileSync('pgrep', ['-fl', 'dsh --profile headless'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return
  }
  const others = listing.split('\n').map(line => line.trim()).filter(line => line !== '')
  if (others.length > 0) {
    throw new Error(`another headless DSH boot is active: ${others.join(' | ')}`)
  }
}

/** Read a JSON Lines observation file, tolerating a missing file. */
async function readObservations(path) {
  try {
    const text = await readFile(path, 'utf8')
    return text.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

/**
 * Publish the bash-declaring soul this probe needs. The fixture mirrors
 * `smoke/run-smoke.mjs`'s primary probe soul except for the shell spelling.
 */
async function writeSoul(root) {
  const dir = join(root, '.dsh', 'agents')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'probe.md'), `---
name: probe
description: Probes the Agent Soul runtime on a composition that registers pwsh instead of bash.
tools:
  - bash
  - read
  - grep
  - glob
model: deepseek-v4-pro
user-invocable: false
context: fresh
---

## Role Definition

You are the soul probe. Report the facts of your runtime; do not change anything. SOUL_PROBE_MARKER

## Inputs You Will See

The Lead tells you to report persona, tools, and model.

## Hard Rules

- Use only the tools the session grants you.
- Do not modify files.

## Output Format

One short report through send_message.
`, 'utf8')
}

/**
 * Write the test-only tool plugin that stands in for DSH's Windows shell tool.
 * It registers a global `pwsh` definition so the live session exposes the same
 * model-facing name a Windows composition would.
 */
async function writeFakePwshPlugin(root) {
  const file = join(root, 'fake-pwsh-tool.mjs')
  await writeFile(file, `/**
 * Test-only stand-in for the Windows shell tool (portable shell alias parity).
 *
 * It registers a global \`pwsh\` tool so a POSIX checkout can exercise the
 * inverted composition: a soul declaring \`bash\` must resolve to this name.
 * The scripted model never calls the tool, so execution is inert.
 */
export const name = 'shell-alias-fake-pwsh'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({
    name: 'pwsh',
    description: 'Test-only pwsh stand-in for the portable shell alias parity probe.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['command'],
      properties: {
        command: { type: 'string', description: 'The simulated pwsh command.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: { kind: { type: 'string', const: 'simulated-pwsh' } },
      },
      render: () => [],
    },
    async execute() {
      return { kind: 'simulated-pwsh' }
    },
  })
}
`, 'utf8')
  return file
}

/**
 * Write a headless profile with the same bundle order as `run-smoke.mjs`, the
 * shipped `tool-bash` row disabled, and the fake `pwsh` plugin inserted.
 */
async function writeProfile(home, fakePluginUrl) {
  const profileDir = join(home, 'profiles', 'headless')
  const packageDir = join(profileDir, 'node_modules', '@local', 'dsh-agent-soul')
  await mkdir(dirname(packageDir), { recursive: true })
  await symlink(pluginDir, packageDir, process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-headless',
    private: true,
    dependencies: {
      '@deepseek-ai/dsh-experimental-agent-team-profile': 'workspace:^',
      '@local/dsh-agent-soul': `file:${pluginDir}`,
    },
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-headless',
          '@deepseek-ai/dsh-experimental-agent-team-profile',
          '@local/dsh-agent-soul',
        ],
      },
    },
  }, undefined, 2)}\n`, 'utf8')
  const fixtureUrl = pathToFileURL(join(smokeDir, 'soul-llm.ts')).href
  await writeFile(join(profileDir, 'cordis.patch.yml'), [
    '# The selected local bundle supplies its real cordis.patch.yml and agent-soul-team row.',
    '- id: llm-deepseek',
    '  disabled: true',
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: '${join(home, 'sessions')}'`,
    '    compression: none',
    '# Invert the composition: the POSIX shell row is off and the fake pwsh plugin is the only shell.',
    '- id: tool-bash',
    '  disabled: true',
    '- insert:',
    '    - id: shell-alias-fake-pwsh',
    `      name: '${fakePluginUrl}'`,
    '    - id: soul-smoke-llm',
    `      name: '${fixtureUrl}'`,
    '',
  ].join('\n'), 'utf8')
}

/**
 * Run one CLI invocation in the isolated parity environment.
 * @param {string} observationsSink - where the scripted adapter appends its
 *   JSON Lines observations; the dump-config call never reaches the adapter.
 */
async function runCli(home, root, args, observationsSink = join(home, 'dump-observations.jsonl')) {
  const child = spawn(process.execPath, ['--import', tsxLoaderUrl(), cliBin, ...args], {
    cwd: root,
    env: childEnvironment(home, observationsSink),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 240_000)
  const exitCode = await new Promise(resolveExit => child.on('close', code => resolveExit(code)))
  clearTimeout(timeout)
  return { exitCode, stdout, stderr }
}

async function main() {
  for (const path of [cliBin, tsconfigPath]) {
    try {
      await readFile(path)
    } catch {
      throw new Error(`DSH checkout is missing ${path}; set DSH_CHECKOUT to the deepseek-harness checkout`)
    }
  }
  assertNoActiveHeadlessBoot()
  const canaries = seedEnvironmentCanaries()
  const root = await mkdtemp(join(tmpdir(), 'dsh-soul-pwsh-parity-'))
  const home = join(root, '.dsh')
  const observationsPath = join(root, 'observations.jsonl')
  const bindingsPath = join(root, '.dsh', 'agent-soul', 'bindings.json')
  try {
    const fakePlugin = await writeFakePwshPlugin(root)
    await writeSoul(root)
    await writeProfile(home, pathToFileURL(fakePlugin).href)
    console.log(`checking the inverted profile in ${root}`)
    const dump = await runCli(home, root, ['--profile', 'headless', '--dump-config'])
    check('inverted profile dump exits 0', dump.exitCode === 0, dump.stderr.slice(0, 400))
    const bashRow = configRow(dump.stdout, 'tool-bash')
    check(
      'the composed profile disables the shipped bash tool row',
      bashRow !== null
        && bashRow.includes("name: '@deepseek-ai/dsh-tool-bash'")
        && /^  disabled: true$/m.test(bashRow),
      bashRow ?? '(row missing)',
    )
    const pwshRow = configRow(dump.stdout, 'tool-pwsh')
    const pwshDisabled = pwshRow !== null
      && (/^  disabled$/m.test(pwshRow)
        || /^  disabled: true$/m.test(pwshRow)
        || /^  disabled: !!js process\.platform !== 'win32'$/m.test(pwshRow))
    check(
      'the composed profile keeps the real pwsh row disabled on POSIX',
      pwshDisabled,
      pwshRow ?? '(row missing)',
    )
    const fakePluginRow = configRow(dump.stdout, 'shell-alias-fake-pwsh')
    check(
      'the composed profile mounts the fake pwsh tool plugin',
      fakePluginRow !== null,
      fakePluginRow ?? '(row missing)',
    )

    console.log(`booting dsh in ${root}`)
    const run = await runCli(home, root, [
      '--profile', 'headless',
      'SOUL_SMOKE: spawn the probe soul teammate and wait for its report.',
    ], observationsPath)
    const output = `${run.stdout}\n${run.stderr}`
    if (run.exitCode !== 0 || !run.stdout.includes('SOUL_SMOKE_OK')) {
      console.error('--- dsh stdout ---\n' + run.stdout)
      console.error('--- dsh stderr ---\n' + run.stderr)
    }
    check('dsh run exits 0', run.exitCode === 0, `exit ${run.exitCode}`)
    check('Lead final output contains SOUL_SMOKE_OK', run.stdout.includes('SOUL_SMOKE_OK'), output.slice(0, 300))

    const observations = await readObservations(observationsPath)
    const teammate = observations.find(entry => entry.kind === 'teammate')
    check('the bash-declaring soul spawned on the pwsh-only composition', teammate !== undefined)
    check('teammate system prompt carries the soul persona', teammate?.personaOk === true)
    check('soul body marker reached the teammate prompt', teammate?.markerOk === true)
    check(
      'the child inherited the live pwsh tool',
      Array.isArray(teammate?.tools) && teammate.tools.includes('pwsh'),
      JSON.stringify(teammate?.tools),
    )
    check(
      'the child never advertises the absent bash spelling',
      Array.isArray(teammate?.tools) && !teammate.tools.includes('bash'),
      JSON.stringify(teammate?.tools),
    )
    check('teammate model is routed', teammate?.modelOk === true, String(teammate?.model))

    const bindings = JSON.parse(await readFile(bindingsPath, 'utf8'))
    const binding = Object.values(bindings.bindings ?? {})[0]
    check('durable soul binding was written', binding !== undefined)
    check(
      'the binding keeps the portable bash declaration',
      JSON.stringify(binding?.tools) === JSON.stringify(['bash', 'read', 'grep', 'glob']),
      JSON.stringify(binding?.tools),
    )

    console.log(`\nparity probe passed: ${checks.filter(entry => entry.ok).length}/${checks.length} checks`)
  } finally {
    canaries.restore()
    await rm(root, { recursive: true, force: true })
  }
}

/** Whether this module is the process entry point (import-safe for tests). */
async function isDirectInvocation() {
  if (process.argv[1] === undefined) return false
  try {
    const [entry, self] = await Promise.all([
      realpath(resolve(process.argv[1])),
      realpath(fileURLToPath(import.meta.url)),
    ])
    return entry === self
  } catch {
    return false
  }
}

if (await isDirectInvocation()) {
  main().catch((error) => {
    console.error(`\nparity probe failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
