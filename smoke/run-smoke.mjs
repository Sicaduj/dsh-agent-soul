#!/usr/bin/env node
/**
 * Keyless end-to-end smoke run for the Agent Soul bundle.
 *
 * It boots a real `dsh --profile headless` run in a temporary DSH_HOME with the
 * Agent Teams bundle plus this workspace's plugin, using a scripted LLM adapter
 * (`soul-llm.ts`). The Lead spawns a soul teammate; the adapter records
 * the teammate's real system prompt, tool list, and routed model, then the run
 * exits. The runner asserts on those observations, on the durable binding
 * document, and on the child session's recorded model selection.
 *
 * This is a development verification harness, not shipped plugin code. It needs
 * the DSH source checkout (tsx + TypeScript paths), because the run boots the
 * CLI from source exactly like the repository's own loader smoke tests.
 *
 * Usage:
 *   node smoke/run-smoke.mjs
 *   DSH_CHECKOUT=/path/to/deepseek-harness node smoke/run-smoke.mjs
 */

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expectedSoulTools } from './contract.mjs'
import { BUNDLED_SOULS_DIR, createCatalog } from '../lib/soul.js'
import { readOrchestrator } from '../lib/orchestrator.js'
import {
  createDocument,
  deleteDocument,
  duplicateDocument,
  listDocuments,
  readDocument,
  saveDocumentSource,
} from '../lib/admin.js'

const smokeDir = dirname(fileURLToPath(import.meta.url))
const pluginDir = resolve(smokeDir, '..')
const checkout = resolve(process.env.DSH_CHECKOUT ?? '/Users/zosyn/LLM/deepseek-harness')
const cliBin = join(checkout, 'apps/cli/src/bin.ts')
const tsconfigPath = join(checkout, 'tsconfig.json')
const tsxLoader = pathToFileURL(createRequire(join(checkout, 'package.json')).resolve('tsx')).href

/** Captured dsh output, dumped when a later assertion fails. */
const transcript = { stdout: '', stderr: '' }

/** Print one assertion outcome; fail the run on the first failure. */
const checks = []
function check(name, condition, detail = '') {
  const ok = Boolean(condition)
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) throw new Error(`smoke assertion failed: ${name}${detail === '' ? '' : ` (${detail})`}`)
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

/** Publish the smoke soul definition into the workspace watched by the run. */
async function writeSoul(root) {
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

## Inputs You Will See

The Lead tells you to report persona, tools, and model.

## Hard Rules

- Use only the read, grep, and glob tools.
- Do not modify files.

## Output Format

One short report through send_message.
`, 'utf8')
}

/**
 * Publish the user-invocable soul used to verify slash-command registration
 * and execution through the real commands service.
 */
async function writeCommandSoul(root) {
  const dir = join(root, '.dsh', 'agents')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'probe-cli.md'), `---
name: probe-cli
description: User-invocable probe soul used by the smoke run to verify slash-command registration and execution.
tools:
  - read
model: deepseek-flash
user-invocable: true
context: fresh
---

## Role Definition

You are the command-line probe. COMMAND_SOUL_MARKER

## Hard Rules

- Use only the read tool.

## Output Format

One short sentence.
`, 'utf8')
}

/** Write a temporary profile that loads the real bundle manifest and patch. */
async function writeProfile(home) {
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
    '- insert:',
    '    - id: soul-smoke-llm',
    `      name: '${fixtureUrl}'`,
    '',
  ].join('\n'), 'utf8')
}

/** Find the child Session log that recorded one exact model route. */
async function findRoutedSession(sessionsDir) {
  const files = (await readdir(sessionsDir, { recursive: true })).filter(file => file.endsWith('.jsonl'))
  for (const file of files) {
    const lines = (await readFile(join(sessionsDir, file), 'utf8')).split('\n').filter(Boolean)
    const selection = lines.map(line => {
      try { return JSON.parse(line) } catch { return undefined }
    }).find(record => record?.type === 'model/selection')
    if (selection?.data?.model === 'deepseek-v4-pro') return { file, selection: selection.data }
  }
  return undefined
}

/** Build a credential-free child environment without inherited loaders or proxies. */
function childEnvironment(home, observationsPath) {
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
    SOUL_PROBE_OUT: observationsPath,
    NODE_OPTIONS: '--disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
  })
  return env
}

/**
 * Run one CLI invocation in the isolated smoke environment and collect output.
 * @param {string} home - temporary DSH_HOME.
 * @param {string} root - workspace directory (CLI cwd).
 * @param {string[]} args - CLI arguments after the bin path.
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
async function runCli(home, root, args) {
  const child = spawn(process.execPath, ['--import', tsxLoader, cliBin, ...args], {
    cwd: root,
    env: childEnvironment(home, join(home, 'dump-observations.jsonl')),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 120_000)
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
  const root = await mkdtemp(join(tmpdir(), 'dsh-soul-smoke-'))
  const home = join(root, '.dsh')
  const observationsPath = join(root, 'observations.jsonl')
  const bindingsPath = join(root, '.dsh', 'agent-soul', 'bindings.json')
  try {
    await writeSoul(root)
    await writeCommandSoul(root)
    await writeProfile(home)

    // Bundled defaults are workspace-independent: a brand-new workspace with no
    // plugin files at all must already see the shipped catalog and doctrine.
    const emptyWorkspace = join(root, 'empty-workspace')
    await mkdir(emptyWorkspace, { recursive: true })
    const looseConfig = { dirs: ['.dsh/agents'], bindingsFile: '.dsh/agent-soul/bindings.json', bundled: true }
    const looseCatalog = createCatalog({ dirs: looseConfig.dirs, bundled: true })
    const looseSnapshot = await looseCatalog.refresh(emptyWorkspace)
    check(
      'bundled soul catalog is available in an empty workspace',
      looseSnapshot.definitions.some(definition => definition.name === 'generalist'),
      JSON.stringify(looseSnapshot.definitions.map(definition => definition.name)),
    )
    const looseOrchestrator = await readOrchestrator({ config: looseConfig, root: emptyWorkspace })
    check(
      'bundled orchestrator doctrine fills a missing workspace definition',
      looseOrchestrator.ok === true && looseOrchestrator.orchestrator.configured === true
        && looseOrchestrator.orchestrator.bundled === true && looseOrchestrator.orchestrator.valid === true,
      looseOrchestrator.ok ? JSON.stringify(looseOrchestrator.orchestrator.diagnostics) : looseOrchestrator.message,
    )
    const strictOrchestrator = await readOrchestrator({ config: { ...looseConfig, bundled: false }, root: emptyWorkspace })
    check(
      'config.bundled=false keeps the strict workspace-only behavior',
      strictOrchestrator.ok === true && strictOrchestrator.orchestrator.configured === false,
      strictOrchestrator.ok ? JSON.stringify(strictOrchestrator.orchestrator.configured) : strictOrchestrator.message,
    )

    // Filesystem safety of the document layer, checked directly against temp
    // workspaces: the implicit soul-directory creation must not follow a
    // symlinked ancestor, and the packaged catalog must stay read-only however a
    // configuration aliases it. The packaged file is restored in `finally`, so a
    // regression here reports a failure instead of leaving the checkout mutated.
    const probeRoot = join(root, 'module-probes')
    const bundledFile = join(BUNDLED_SOULS_DIR, 'generalist.md')
    const bundledSource = await readFile(bundledFile, 'utf8')
    try {
      await mkdir(probeRoot, { recursive: true })
      const escapeRoot = join(probeRoot, 'escape')
      const escapeWorkspace = join(escapeRoot, 'workspace')
      const escapeOutside = join(escapeRoot, 'outside')
      await mkdir(escapeWorkspace, { recursive: true })
      await mkdir(escapeOutside, { recursive: true })
      await symlink(escapeOutside, join(escapeWorkspace, '.dsh'), process.platform === 'win32' ? 'junction' : 'dir')
      const escapeConfig = { dirs: ['.dsh/agents'], bindingsFile: '.dsh/agent-soul/bindings.json', bundled: true }
      const escapedCreate = await createDocument({ config: escapeConfig, root: escapeWorkspace, name: 'escaped-soul' })
      check(
        'symlinked .dsh cannot auto-create a soul outside the workspace',
        escapedCreate.ok === false,
        escapedCreate.ok ? escapedCreate.document.file : escapedCreate.code,
      )
      check(
        'refused auto-create leaves the outside directory empty',
        (await readdir(escapeOutside)).length === 0,
        JSON.stringify(await readdir(escapeOutside)),
      )
      const escapedDuplicate = await duplicateDocument({
        config: escapeConfig,
        root: escapeWorkspace,
        file: bundledFile,
        name: 'escaped-copy',
      })
      check(
        'symlinked .dsh cannot duplicate a bundled soul outside the workspace',
        escapedDuplicate.ok === false,
        escapedDuplicate.ok ? escapedDuplicate.document.file : escapedDuplicate.code,
      )
      check(
        'refused duplicate leaves the outside directory empty',
        (await readdir(escapeOutside)).length === 0,
        JSON.stringify(await readdir(escapeOutside)),
      )

      const aliasWorkspace = join(probeRoot, 'alias-workspace')
      await mkdir(aliasWorkspace, { recursive: true })
      await symlink(BUNDLED_SOULS_DIR, join(aliasWorkspace, 'agents-alias'), process.platform === 'win32' ? 'junction' : 'dir')
      const absoluteConfig = { dirs: [BUNDLED_SOULS_DIR], bindingsFile: '.dsh/agent-soul/bindings.json', bundled: true }
      const symlinkConfig = { dirs: ['agents-alias'], bindingsFile: '.dsh/agent-soul/bindings.json', bundled: true }
      const mutatedSource = `${bundledSource}\n`
      const directSave = await saveDocumentSource({
        config: absoluteConfig,
        root: aliasWorkspace,
        file: bundledFile,
        source: mutatedSource,
      })
      check(
        'a configured absolute alias of the packaged directory refuses saveDocumentSource',
        directSave.ok === false,
        directSave.ok ? directSave.file : directSave.code,
      )
      const directDelete = await deleteDocument({ config: absoluteConfig, root: aliasWorkspace, file: bundledFile })
      check(
        'a configured absolute alias of the packaged directory refuses deleteDocument',
        directDelete.ok === false,
        directDelete.ok ? directDelete.file : directDelete.code,
      )
      const aliasFile = join(aliasWorkspace, 'agents-alias', 'generalist.md')
      const symlinkSave = await saveDocumentSource({
        config: symlinkConfig,
        root: aliasWorkspace,
        file: aliasFile,
        source: mutatedSource,
      })
      check(
        'a symlink alias of the packaged directory refuses saveDocumentSource',
        symlinkSave.ok === false,
        symlinkSave.ok ? symlinkSave.file : symlinkSave.code,
      )
      const symlinkDelete = await deleteDocument({ config: symlinkConfig, root: aliasWorkspace, file: aliasFile })
      check(
        'a symlink alias of the packaged directory refuses deleteDocument',
        symlinkDelete.ok === false,
        symlinkDelete.ok ? symlinkDelete.file : symlinkDelete.code,
      )
      const packagedAfterWrites = await readFile(bundledFile, 'utf8').catch(() => '')
      check(
        'refused bundled writes leave the packaged file unchanged',
        packagedAfterWrites === bundledSource,
      )
      const aliasListing = await listDocuments({ config: symlinkConfig, root: aliasWorkspace })
      const aliasRows = aliasListing.documents.filter(row => row.name === 'generalist')
      check(
        'a configured alias of the packaged directory lists its souls as bundled',
        aliasRows.length === 1 && aliasRows[0].bundled === true,
        JSON.stringify(aliasRows.map(row => ({ name: row.name, bundled: row.bundled }))),
      )
      const aliasDetail = await readDocument({ config: symlinkConfig, root: aliasWorkspace, file: aliasFile })
      check(
        'read detail classifies an aliased bundled soul as bundled',
        aliasDetail.ok === true && aliasDetail.document.bundled === true,
        aliasDetail.ok ? String(aliasDetail.document.bundled) : aliasDetail.message,
      )

      const duplicateWorkspace = join(probeRoot, 'duplicate-workspace')
      await mkdir(duplicateWorkspace, { recursive: true })
      const defaultConfig = { dirs: ['.dsh/agents'], bindingsFile: '.dsh/agent-soul/bindings.json', bundled: true }
      const duplicated = await duplicateDocument({
        config: defaultConfig,
        root: duplicateWorkspace,
        file: bundledFile,
        name: 'generalist-copy',
      })
      check(
        'duplicating a bundled soul into a fresh workspace succeeds',
        duplicated.ok === true,
        duplicated.ok ? duplicated.document.file : duplicated.message,
      )
      const duplicateFile = join(duplicateWorkspace, '.dsh', 'agents', 'generalist-copy.md')
      const duplicateText = await readFile(duplicateFile, 'utf8').catch(() => '')
      check(
        'the bundled-soul duplicate lands under the workspace soul directory',
        duplicated.ok === true && duplicated.document.file === duplicateFile && duplicateText.includes('name: generalist-copy'),
        duplicated.ok ? duplicated.document.file : duplicateFile,
      )
    } finally {
      let current = null
      try {
        current = await readFile(bundledFile, 'utf8')
      } catch {
        current = null
      }
      if (current !== bundledSource) await writeFile(bundledFile, bundledSource, 'utf8')
    }

    // The plugin's own patch must replace the shipped Team tool row in a fresh
    // profile whose bundle order is the documented one: the Agent Teams bundle
    // first, this bundle last. This is the portable fix, independent of any
    // per-machine profile patch.
    console.log(`checking the composed profile in ${root}`)
    const dump = await runCli(home, root, ['--profile', 'headless', '--dump-config'])
    check('composed fresh profile dump exits 0', dump.exitCode === 0, dump.stderr.slice(0, 400))
    check(
      'fresh profile composition disables the shipped Team tool row',
      /- id: tool-agent-team\n\s+name: '@deepseek-ai\/dsh-experimental-tool-agent-team'[\s\S]{0,300}?\n\s+disabled: true/.test(dump.stdout),
      dump.stdout.slice(0, 400),
    )
    check('fresh profile mounts the soul-aware Team row', /^- id: agent-soul-team$/m.test(dump.stdout))
    check(
      'fresh profile composes exactly one tool-agent-team row',
      (dump.stdout.match(/- id: tool-agent-team\b/g) ?? []).length === 1,
      String((dump.stdout.match(/- id: tool-agent-team\b/g) ?? []).length),
    )

    console.log(`booting dsh in ${root}`)
    const child = spawn(process.execPath, [
      '--import', tsxLoader,
      cliBin,
      '--profile', 'headless',
      'SOUL_SMOKE: spawn the probe soul teammate and wait for its report.',
    ], {
      cwd: root,
      env: childEnvironment(home, observationsPath),
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
    const output = `${stdout}\n${stderr}`
    transcript.stdout = stdout
    transcript.stderr = stderr
    if (exitCode !== 0 || !stdout.includes('SOUL_SMOKE_OK')) {
      console.error('--- dsh stdout ---\n' + stdout)
      console.error('--- dsh stderr ---\n' + stderr)
    }
    check('dsh run exits 0', exitCode === 0, `exit ${exitCode}`)
    check('Lead final output contains SOUL_SMOKE_OK', stdout.includes('SOUL_SMOKE_OK'), output.slice(0, 300))

    const observations = await readObservations(observationsPath)
    const lead = observations.find(entry => entry.kind === 'lead')
    const teammate = observations.find(entry => entry.kind === 'teammate')
    check('Lead prompt carries the soul catalog', lead?.catalogInPrompt === true)
    check('spawn_teammate schema exposes agent_type', lead?.spawnHasAgentType === true)
    check('list_agent_souls is registered', lead?.hasListSouls === true)
    check('child environment excludes inherited credentials, proxies, and loader flags', lead?.environmentScrubbed === true)
    check('teammate system prompt carries the soul persona', teammate?.personaOk === true)
    check('soul body marker reached the teammate prompt', teammate?.markerOk === true)
    const expectedProbeTools = expectedSoulTools('read', 'grep', 'glob')
    check(
      'teammate tool matrix is enforced',
      JSON.stringify([...(teammate?.tools ?? [])].sort()) === JSON.stringify(expectedProbeTools),
      JSON.stringify(teammate?.tools),
    )
    check('teammate model is routed', teammate?.modelOk === true, String(teammate?.model))

    const command = observations.find(entry => entry.kind === 'command')
    check('user-invocable soul registers a slash command', command?.registered === true, JSON.stringify(command?.commands ?? []))
    check('slash command executes successfully', command?.executed?.kind === 'success', JSON.stringify(command?.executed ?? command?.error))
    const commandTeammate = observations.find(entry => entry.kind === 'teammate-command')
    check('command-spawned teammate gets its persona', commandTeammate?.personaOk === true)
    check('command-spawned teammate gets its body marker', commandTeammate?.markerOk === true)
    const expectedCommandTools = expectedSoulTools('read')
    check('command-spawned teammate tool matrix is enforced', JSON.stringify([...(commandTeammate?.tools ?? [])].sort()) === JSON.stringify(expectedCommandTools), JSON.stringify(commandTeammate?.tools))

    const bindings = JSON.parse(await readFile(bindingsPath, 'utf8'))
    const binding = Object.values(bindings.bindings ?? {})[0]
    check('durable soul binding was written', binding !== undefined)
    check('binding records the soul name', binding?.name === 'probe', String(binding?.name))
    check('binding records the route', binding?.model?.model === 'deepseek-v4-pro')
    check('binding records the tool matrix', JSON.stringify(binding?.tools) === JSON.stringify(['read', 'grep', 'glob']))
    const bindingNames = Object.values(bindings.bindings ?? {}).map(entry => entry.name).sort()
    check('both soul bindings were recorded', bindingNames.includes('probe') && bindingNames.includes('probe-cli'), JSON.stringify(bindingNames))

    const routed = await findRoutedSession(join(home, 'sessions'))
    check('child Session log records the routed model selection', routed !== undefined, routed?.file ?? 'not found')

    console.log(`\nsmoke passed: ${checks.filter(entry => entry.ok).length}/${checks.length} checks`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`\nsmoke failed: ${error instanceof Error ? error.message : String(error)}`)
  console.error('--- dsh stdout ---\n' + transcript.stdout)
  console.error('--- dsh stderr ---\n' + transcript.stderr)
  process.exitCode = 1
})
