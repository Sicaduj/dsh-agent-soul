#!/usr/bin/env node
/** Standalone focused real headless CLI regressions; all mutable state is run-owned. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const smokeDir = dirname(fileURLToPath(import.meta.url))
const candidate = resolve(smokeDir, '..')
const runRoot = process.env.QAS_RUN_ROOT === undefined
  ? await mkdtemp(join(tmpdir(), 'agent-soul-remediation-'))
  : resolve(process.env.QAS_RUN_ROOT)
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback
const target = option('--target', 'candidate')
const only = option('--only', 'all')
if (!['baseline', 'candidate'].includes(target) || !['all', 'concurrency', 'read'].includes(only)) throw new Error('use --target baseline|candidate --only all|concurrency|read')
if (target === 'baseline' && process.env.QAS_BASELINE_DIR === undefined) {
  throw new Error('QAS_BASELINE_DIR must identify an archived original plugin; never use the live installation')
}
const pluginDir = target === 'baseline' ? resolve(process.env.QAS_BASELINE_DIR) : candidate
const checkout = resolve(process.env.DSH_CHECKOUT ?? '/Users/zosyn/LLM/deepseek-harness')
const tsxLoader = pathToFileURL(createRequire(join(checkout, 'package.json')).resolve('tsx')).href
const cliBin = join(checkout, 'apps/cli/src/bin.ts')
const adapterUrl = pathToFileURL(join(smokeDir, 'remediation-runtime-adapter.ts')).href
const workBase = join(runRoot, 'runtime-focused')
const evidenceBase = join(runRoot, 'evidence', 'runtime-focused')
await mkdir(workBase, { recursive: true }); await mkdir(evidenceBase, { recursive: true })
const work = await mkdtemp(join(workBase, `${target}-${only}-`))
const evidence = join(evidenceBase, basename(work))
await mkdir(evidence)
const startedAt = new Date().toISOString()
const inputDigests = Object.fromEntries(await Promise.all([
  join(pluginDir, 'index.js'), join(pluginDir, 'lib', 'bindings.js'), join(pluginDir, 'lib', 'admin-tool.js'),
  fileURLToPath(import.meta.url), join(smokeDir, 'remediation-runtime-adapter.ts'),
].map(async path => [path, await digest(path)])))
const checks = []
const processes = []
const active = new Set()
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
const commandText = (args, cwd) => `(cd ${quote(cwd)} && ${[process.execPath, ...args].map(quote).join(' ')})`
async function json(path, value) { await writeFile(path, JSON.stringify(value, null, 2) + '\n') }
function check(id, expected, actual, pass = JSON.stringify(expected) === JSON.stringify(actual)) {
  const row = { id, expected, actual, verdict: pass ? 'PASS' : 'FAIL', tier: 'runner-file-process' }
  checks.push(row); console.log(`${row.verdict} ${id}`)
  if (!pass) throw new Error(`assertion failed: ${id}`)
}
async function rows(path) {
  try { return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
async function tree(root) {
  const result = {}
  async function scan(path) {
    let files
    try { files = await readdir(path, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = join(path, file.name)
      if (file.isDirectory()) await scan(name)
      else if (file.isFile()) result[relative(root, name)] = createHash('sha256').update(await readFile(name)).digest('hex')
      else result[relative(root, name)] = 'nonregular'
    }
  }
  await scan(root)
  return result
}
async function digest(path) { return createHash('sha256').update(await readFile(path)).digest('hex') }
function childEnv(home, out, mode, rootLabel, extra) {
  // Deliberately do not inherit HOME, provider credentials, DSH_PROFILE*, proxies, NODE_OPTIONS, or arbitrary DSH env.
  const env = {}
  for (const key of ['PATH', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key]
  }
  return { ...env, HOME: home, USERPROFILE: home, TMPDIR: join(work, 'tmp'), TMP: join(work, 'tmp'), TEMP: join(work, 'tmp'),
    DSH_HOME: home, DSH_AGENTS_HOME: join(home, '.agents'), DSH_TELEMETRY_DISABLED: '1',
    TSX_TSCONFIG_PATH: join(checkout, 'tsconfig.json'),
    NODE_OPTIONS: '--disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    QAS_OUT: out, QAS_MODE: mode, QAS_ROOT_LABEL: rootLabel, QAS_EXPECTATION: target, QAS_PLUGIN_DIR: pluginDir, ...extra }
}
async function startCli({ name, home, workspace, mode, label, sessionId, extra = {} }) {
  const out = join(evidence, `${name}.jsonl`)
  await writeFile(out, '')
  const args = ['--import', tsxLoader, cliBin, '--profile', 'headless', ...sessionId ? ['--session-id', sessionId] : [], `REMEDIATION_${mode}`]
  const command = commandText(args, workspace)
  const env = childEnv(home, out, mode, label, extra)
  const child = spawn(process.execPath, args, { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] })
  active.add(child)
  let stdout = '', stderr = '', timedOut = false
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stdout.on('data', data => { stdout += data }); child.stderr.on('data', data => { stderr += data })
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 150000)
  const done = new Promise((resolveDone, reject) => {
    child.once('error', reject)
    child.once('close', async (exitCode, signal) => {
      clearTimeout(timer); active.delete(child)
      const record = { name, command, pid: child.pid, exitCode, signal, timedOut, markerSeen: stdout.includes('REMEDIATION_OK'),
        envKeys: Object.keys(env).sort(), stdout, stderr }
      processes.push(record)
      try { await json(join(evidence, `${name}-process.json`), record); resolveDone({ out, rows: await rows(out), ...record }) }
      catch (error) { reject(error) }
    })
  })
  return { child, out, done }
}
async function finishCli(started) {
  const result = await started.done
  if (result.exitCode !== 0 || result.timedOut || !result.markerSeen) {
    console.error(`${result.name}: ${JSON.stringify({ exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut })}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  check(`${result.name}.exit`, 0, result.exitCode, result.exitCode === 0 && !result.timedOut)
  check(`${result.name}.marker`, true, result.markerSeen)
  const assertions = result.rows.filter(row => row.kind === 'assertion')
  check(`${result.name}.nonempty-assertions`, true, assertions.length > 0)
  check(`${result.name}.adapter-assertions`, [], assertions.filter(row => row.verdict !== 'PASS'))
  const environment = result.rows.find(row => row.kind === 'root-start')
  check(`${result.name}.sanitized-env`, { canaryAbsent: true, providerKeysAbsent: [], proxyAbsent: true }, environment?.sanitized)
  check(`${result.name}.scripted-routes-only`, ['deepseek-official', 'scripted-alt'], environment?.providers?.sort())
  return result
}
async function runCli(options) { return finishCli(await startCli(options)) }
async function profile(home, bindingsFile) {
  const dir = join(home, 'profiles', 'headless')
  const packagePath = join(dir, 'node_modules', '@local', 'dsh-agent-soul')
  await mkdir(dirname(packagePath), { recursive: true })
  await symlink(pluginDir, packagePath, process.platform === 'win32' ? 'junction' : 'dir')
  await json(join(dir, 'package.json'), { name: 'qas-focused-disposable', private: true,
    dependencies: { '@deepseek-ai/dsh-experimental-agent-team-profile': 'workspace:^', '@local/dsh-agent-soul': `file:${pluginDir}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@deepseek-ai/dsh-experimental-agent-team-profile', '@local/dsh-agent-soul'] } } })
  await writeFile(join(dir, 'cordis.patch.yml'), [
    '- id: llm-deepseek', '  disabled: true', '- id: llm-deepseek-account', '  disabled: true', '- id: deepseek-account', '  disabled: true',
    '- id: session-persistence-jsonl', '  config:', `    root: ${JSON.stringify(join(home, 'sessions'))}`, '    compression: none',
    '- id: agent-team', '  config:', '    maxMembers: 8', '    maxTasks: 8', '    disposalTimeoutMs: 5000',
    '- id: agent-soul-team', '  config:', '    freshProvider: spawn', '    forkProvider: fork', '    claimTeamToolRow: false',
    '    bundled: true', `    bindingsFile: ${JSON.stringify(bindingsFile)}`,
    '- id: tool-subagent', '  disabled: false', '- id: tool-subagent-fork', '  disabled: false',
    '- insert:', '    - id: remediation-runtime-scripted-llm', `      name: ${JSON.stringify(adapterUrl)}`, '',
  ].join('\n'))
}
async function soul(workspace, label, version) {
  await mkdir(join(workspace, '.dsh', 'agents'), { recursive: true })
  const model = version === 1 ? (label === 'A' ? 'deepseek-v4-pro' : 'scripted-alt/alt-only') : 'deepseek-flash'
  const tool = version === 1 ? (label === 'A' ? 'read' : 'grep') : 'glob'
  await writeFile(join(workspace, '.dsh', 'agents', 'qas-shared.md'),
    `---\nname: qas-shared\ndescription: run-owned ${label} V${version}\ntools:\n  - ${tool}\nmodel: ${model}\ncontext: fresh\nuser-invocable: false\n---\n\n## Role Definition\n\nQAS_ROOT_${label}_V${version}\n\n## Hard Rules\n\n- Deterministic no-provider probe only.\n\n## Output Format\n\nOne completion.\n`)
}
async function waitFiles(paths, running) {
  const until = Date.now() + 100000
  while (Date.now() < until) {
    const observations = await Promise.all(paths.map(async path => { try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }))
    if (observations.every(Boolean)) return observations
    if (running.some(r => r.child.exitCode !== null || r.child.signalCode !== null)) throw new Error('CLI exited before both real stores primed; inspect process evidence')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('timed out waiting for both primed CLI processes')
}
async function modelLogProof(config, childId, expectedModel, phase) {
  const files = await readdir(join(config.home, 'sessions'), { recursive: true })
  const records = []
  for (const file of files.filter(f => f.endsWith('.jsonl') && f.includes(childId))) {
    for (const record of await rows(join(config.home, 'sessions', file))) {
      if (['model/selection', 'request/header', 'request/context'].includes(record.type)) records.push({ file, type: record.type, data: record.data })
    }
  }
  await json(join(evidence, `${phase}-${config.label}-model-events.json`), records)
  const selections = records.filter(r => r.type === 'model/selection')
  check(`${phase}.${config.label}.durable-model-selection`, true, selections.length > 0 && selections.every(r => r.data?.model === expectedModel))
}
async function concurrency() {
  const shared = join(work, 'shared')
  await mkdir(shared)
  const bindingsFile = join(shared, 'bindings.json')
  const configs = []
  for (const label of ['A', 'B']) {
    const home = join(work, `home-${label}`), workspace = join(work, `root-${label}`)
    await mkdir(workspace, { recursive: true }); await profile(home, bindingsFile); await soul(workspace, label, 1)
    const config = { home, workspace, label }
    const boot = await runCli({ ...config, name: `bootstrap-${label}`, mode: 'bootstrap' })
    config.leadId = boot.rows.find(r => r.kind === 'accepted-worker')?.leadSessionId
    check(`bootstrap.${label}.lead-id`, true, typeof config.leadId === 'string')
    configs.push(config)
  }
  await json(join(evidence, 'bootstrap-bindings.json'), JSON.parse(await readFile(bindingsFile, 'utf8')))
  // Run-owned fixture reset: cold primer refusals load the same empty anchor in both real plugin stores.
  await json(bindingsFile, { version: 1, bindings: {} })
  const ready = configs.map(c => join(shared, `ready-${c.label}.json`)), go = join(shared, 'go')
  const running = await Promise.all(configs.map((config, i) => startCli({ ...config, name: `concurrent-${config.label}`, mode: 'concurrent',
    sessionId: config.leadId, extra: { QAS_READY: ready[i], QAS_GO: go } })))
  const primed = await waitFiles(ready, running)
  check('F002.two-distinct-primed-processes', 2, new Set(primed.map(r => r.pid)).size)
  check('F002.before-first-writes-empty-anchor', {}, JSON.parse(await readFile(bindingsFile, 'utf8')).bindings)
  await json(join(evidence, 'priming-barrier.json'), { primed, sharedAbsoluteBindingsFile: bindingsFile, anchorBeforeRelease: JSON.parse(await readFile(bindingsFile, 'utf8')), releaseAt: new Date().toISOString() })
  await writeFile(go, 'release both already-primed real stores\n')
  const completed = await Promise.all(running.map(finishCli))
  for (const [i, result] of completed.entries()) configs[i].childId = result.rows.find(r => r.kind === 'accepted-worker')?.memberSessionId
  const anchor = JSON.parse(await readFile(bindingsFile, 'utf8'))
  await json(join(evidence, 'after-concurrent-bindings.json'), anchor)
  check('F002.accepted-worker-session-ids', true, configs.every(c => typeof c.childId === 'string' && c.childId.length > 0))
  check('F002.two-accepted-distinct-workers', 2, new Set(configs.map(c => c.childId)).size)
  const retained = configs.filter(c => Object.hasOwn(anchor.bindings, c.childId))
  check(target === 'baseline' ? 'F002.baseline-loss-reproduced' : 'F002.candidate-both-retained', target === 'baseline' ? 1 : 2, retained.length)
  for (const config of configs) {
    await soul(config.workspace, config.label, 2)
    const missing = !Object.hasOwn(anchor.bindings, config.childId)
    const resumed = await runCli({ ...config, name: `cold-${config.label}`, mode: 'cold', sessionId: config.leadId,
      extra: { QAS_EXPECT_REFUSAL: missing ? '1' : '0' } })
    const coldPid = resumed.rows.find(r => r.kind === 'adapter-ready')?.pid
    check(`F002.${config.label}.actual-process-recreation`, true, Number.isSafeInteger(coldPid) && coldPid !== completed[configs.indexOf(config)].pid)
    check(`F002.${config.label}.exact-durable-roster-child`, config.childId, resumed.rows.find(r => r.kind === 'cold-complete')?.memberSessionId)
    const coldRequests = resumed.rows.filter(row => row.kind === 'child-request')
    check(`F002.${config.label}.completed-process-child-request-count`, missing ? 0 : 1, coldRequests.length)
    await modelLogProof(config, config.childId, config.label === 'A' ? 'deepseek-v4-pro' : 'alt-only', 'cold')
  }
  // Independently prove repaired persistence never weakens missing-binding admission.
  if (target === 'candidate') {
    const missing = JSON.parse(JSON.stringify(anchor)); delete missing.bindings[configs[0].childId]
    await json(bindingsFile, missing)
    const refused = await runCli({ ...configs[0], name: 'missing-A', mode: 'missing', sessionId: configs[0].leadId, extra: { QAS_EXPECT_REFUSAL: '1' } })
    check('F002.missing-A.completed-process-no-child-request', 0, refused.rows.filter(row => row.kind === 'child-request').length)
    await json(bindingsFile, anchor)
    await runCli({ ...configs[0], name: 'recovered-A', mode: 'cold', sessionId: configs[0].leadId, extra: { QAS_EXPECT_REFUSAL: '0' } })
  }
  await json(join(evidence, 'shared-anchor-result.json'), { target, bindingsFile, configs, retained: retained.map(c => c.label),
    actualProcessRecreation: true, concurrency: 'two independent real CLI processes, both empty stores primed before first accepted writes' })
}
async function readVariants() {
  const bundledSource = await readFile(join(pluginDir, 'defaults', 'orchestrator.md'), 'utf8')
  for (const label of ['bundled', 'valid', 'invalid']) {
    const home = join(work, `read-home-${label}`), workspace = join(work, `read-root-${label}`)
    await mkdir(workspace, { recursive: true }); await profile(home, '.dsh/agent-soul/bindings.json')
    if (label !== 'bundled') {
      await mkdir(join(workspace, '.dsh', 'agent-soul'), { recursive: true })
      await writeFile(join(workspace, '.dsh', 'agent-soul', 'orchestrator.md'), label === 'valid' ? bundledSource : '---\nname: orchestrator\nmodel: [invalid\n---\n\nQAS_INVALID_SOURCE\n')
    }
    const before = { workspace: await tree(workspace), defaults: await tree(join(pluginDir, 'defaults')),
      profilePatch: await digest(join(home, 'profiles', 'headless', 'cordis.patch.yml')) }
    const result = await runCli({ name: `read-${label}`, home, workspace, mode: 'read', label })
    if (target === 'candidate') {
      const value = result.rows.find(row => row.kind === 'tool-invocation' && row.name === 'manage_agent_souls')?.outcome?.value
      const workspacePath = join(workspace, '.dsh', 'agent-soul', 'orchestrator.md')
      const sourcePath = label === 'bundled' ? join(pluginDir, 'defaults', 'orchestrator.md') : workspacePath
      check(`F001.${label}.exact-source`, await readFile(sourcePath, 'utf8'), value?.source)
      check(`F001.${label}.workspace-file-path`, workspacePath, value?.file)
      check(`F001.${label}.exact-source-path`, sourcePath, value?.sourcePath)
    }
    const after = { workspace: await tree(workspace), defaults: await tree(join(pluginDir, 'defaults')),
      profilePatch: await digest(join(home, 'profiles', 'headless', 'cordis.patch.yml')) }
    await json(join(evidence, `read-${label}-digests.json`), { algorithm: 'sha256', before, after,
      writes: result.rows.find(r => r.kind === 'read-operation-writes')?.writes })
    check(`F001.${label}.digests-identical`, before, after)
  }
}
let error
try {
  await mkdir(join(work, 'tmp'))
  console.log(`WORK=${work}\nEVIDENCE=${evidence}`)
  if (only === 'all' || only === 'concurrency') await concurrency()
  if (only === 'all' || only === 'read') await readVariants()
} catch (caught) {
  error = { name: caught.name, message: caught.message, stack: caught.stack }
  console.error(caught)
  process.exitCode = 1
} finally {
  for (const child of active) child.kill('SIGKILL')
  // Observe completion of run-owned children even after a failed barrier/driver check.
  while (active.size) await new Promise(resolve => setTimeout(resolve, 10))
  const all = [...checks]
  for (const file of (await readdir(evidence)).filter(f => f.endsWith('.jsonl'))) all.push(...(await rows(join(evidence, file))).filter(r => r.kind === 'assertion'))
  await json(join(evidence, 'summary.json'), { target, only, startedAt, finishedAt: new Date().toISOString(), work, evidence, pluginDir, checkout, inputDigests,
    runnerCommand: commandText([fileURLToPath(import.meta.url), ...process.argv.slice(2)], process.cwd()),
    counts: all.reduce((counts, row) => ({ ...counts, [row.verdict]: (counts[row.verdict] ?? 0) + 1 }), {}),
    error: error ?? null, processes: processes.map(({ stdout, stderr, ...p }) => p), checks,
    limits: ['Scripted adapter: no real-model quality claim or paid-provider I/O.', 'CLI tools executor + tools/result typed pipeline, not rendered browser evidence.',
      'Builtin mutation monitoring is scoped to get_orchestrator execution; SHA-256 trees cover workspace and bundled defaults before/after each CLI.'] })
  console.log(`SUMMARY=${join(evidence, 'summary.json')}`)
}
