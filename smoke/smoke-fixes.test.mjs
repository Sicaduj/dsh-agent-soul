/**
 * Focused regressions for the smoke-harness fixes (D04, D17, D18).
 *
 * D04: packaged-document write-refusal probes must run against an isolated
 * package copy. The real (fixture "real") package is snapshot-only here; a
 * simulated concurrent external edit must be preserved, never restored from
 * captured bytes.
 * D17: the runner seeds removable credential/proxy/loader canaries and the
 * allowlisted child environment must drop all of them; /orchestrate presence is
 * an explicit command-surface assertion.
 * D18: symlink-prefixed QAS run roots canonicalize before expected paths are
 * derived, and summary reporting distinguishes incomplete/unexecuted suites
 * from a complete pass.
 *
 * The probe cases work on throwaway package copies under the OS temporary
 * directory. The real package is only a copy source and is never written; no
 * credentials, network, DSH profile, or live Host are involved.
 *
 * Run with: node --test smoke/smoke-fixes.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkCommandSurface,
  childEnvironment,
  probeBundledDocumentSafety,
  seedEnvironmentCanaries,
} from './run-smoke.mjs'
import { canonicalizeRunRoot, invocationStatus, readReadyObservation } from './remediation-runtime.mjs'

/** The real package root, used only as a copy source. */
const REAL_PACKAGE = fileURLToPath(new URL('..', import.meta.url))

/** Incremented by every assertion helper below, so the run can report a count. */
const tally = { assertions: 0 }

/** Assert one truthy condition and count it. */
function ok(value, message) {
  tally.assertions += 1
  assert.ok(value, message)
  return value
}

/** Assert one strict equality and count it. */
function equal(actual, expected, message) {
  tally.assertions += 1
  assert.equal(actual, expected, message)
}

/** Assert one deep equality and count it. */
function deepEqual(actual, expected, message) {
  tally.assertions += 1
  assert.deepEqual(actual, expected, message)
}

/** Assert one synchronous throw and count it. */
function throws(fn, expected, message) {
  tally.assertions += 1
  assert.throws(fn, expected, message)
}

/** Create one temporary directory with fixture-safety cleanup. */
function tempDir(label, t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-soul-smoke-fixes-' + label + '-')))
  t.after(() => {
    equal(dirname(dir), realpathSync(tmpdir()), 'cleanup only removes fixtures under the OS temp directory')
    ok(dir.includes('agent-soul-smoke-fixes-' + label), 'cleanup only removes this fixture')
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

/**
 * Copy the package files the document layer needs into a throwaway package.
 * The copy is imported through its own file URL, so BUNDLED_SOULS_DIR resolves
 * inside the copy.
 */
function packageCopy(label, t) {
  const dir = tempDir(label, t)
  const pkg = join(dir, 'plugin')
  mkdirSync(pkg)
  for (const entry of ['lib', 'agents', 'defaults']) {
    cpSync(join(REAL_PACKAGE, entry), join(pkg, entry), { recursive: true })
  }
  for (const file of ['index.js', 'package.json']) {
    cpSync(join(REAL_PACKAGE, file), join(pkg, file))
  }
  return { dir, pkg }
}

/** Collect assertion rows exactly like the smoke runner, throwing on failure. */
function collector() {
  const rows = []
  const report = (name, condition, detail = '') => {
    const row = { name, ok: Boolean(condition), detail }
    rows.push(row)
    if (!row.ok) throw new Error('smoke harness assertion failed: ' + name + (detail === '' ? '' : ' (' + detail + ')'))
  }
  return { rows, report }
}

test('D04 packaged write probes use an isolated copy and leave the real package bytes unchanged', async t => {
  const { dir, pkg } = packageCopy('d04-unchanged', t)
  const realBundled = join(pkg, 'agents', 'generalist.md')
  const before = readFileSync(realBundled)
  const { rows, report } = collector()
  const result = await probeBundledDocumentSafety({
    root: join(dir, 'run'),
    sourcePackage: pkg,
    realBundledFile: realBundled,
    check: report,
  })

  equal(rows.every(row => row.ok), true, JSON.stringify(rows.filter(row => !row.ok)))
  equal(result.concurrentExternalEdit, false)
  equal(result.realAfter.hash, result.realBefore.hash)
  ok(result.isolatedPackage.startsWith(join(dir, 'run')), result.isolatedPackage)
  ok(result.isolatedPackage !== pkg)
  ok(result.isolatedBundledFile.startsWith(result.isolatedPackage))
  deepEqual(readFileSync(realBundled), before, 'the real packaged source bytes are unchanged')
  equal(readFileSync(result.isolatedBundledFile, 'utf8').includes('SMOKE_REFUSED_WRITE_CANARY'), false)
  equal(result.realAfter.text.includes('SMOKE_REFUSED_WRITE_CANARY'), false)
  ok(rows.some(row => /real packaged soul file hash is unchanged/.test(row.name)))
  ok(rows.some(row => /isolated packaged file unchanged/.test(row.name)))
  ok(rows.some(row => /duplicate lands under the workspace soul directory/.test(row.name)))
  // Nothing runs after the probe function returns, so no deferred restoration
  // can rewrite the source even when a caller changed it meanwhile.
  writeFileSync(realBundled, before.toString('utf8') + '\nSMOKE_EXTERNAL_AFTER_RETURN\n')
  ok(readFileSync(realBundled, 'utf8').includes('SMOKE_EXTERNAL_AFTER_RETURN'))
})

test('D04 a concurrent external edit of the packaged source is preserved, not restored', async t => {
  const { dir, pkg } = packageCopy('d04-concurrent', t)
  const realBundled = join(pkg, 'agents', 'generalist.md')
  const external = readFileSync(realBundled, 'utf8') + '\nSMOKE_EXTERNAL_CONCURRENT_EDIT\n'
  const { rows, report } = collector()
  const result = await probeBundledDocumentSafety({
    root: join(dir, 'run'),
    sourcePackage: pkg,
    realBundledFile: realBundled,
    check: report,
    afterProbes: async () => { writeFileSync(realBundled, external) },
  })

  equal(rows.every(row => row.ok), true, JSON.stringify(rows.filter(row => !row.ok)))
  equal(result.concurrentExternalEdit, true)
  equal(result.realAfter.text, external, 'the concurrent external edit wins')
  equal(readFileSync(realBundled, 'utf8'), external, 'captured bytes were not restored over the edit')
  equal(readFileSync(realBundled, 'utf8').includes('SMOKE_REFUSED_WRITE_CANARY'), false)
  equal(readFileSync(result.isolatedBundledFile, 'utf8').includes('SMOKE_EXTERNAL_CONCURRENT_EDIT'), false)
  ok(rows.some(row => /retains a concurrent external edit/.test(row.name)))
  equal(rows.some(row => /real packaged soul file hash is unchanged/.test(row.name)), false)
})

test('D17 seeded credential, proxy, and loader canaries are removed from the child environment', t => {
  const seeded = seedEnvironmentCanaries()
  t.after(() => seeded.restore())

  equal(process.env.SMOKE_CANARY_CREDENTIAL, seeded.markers.credential)
  equal(process.env.SMOKE_CANARY_SECRET, seeded.markers.credential)
  equal(process.env.DEEPSEEK_API_KEY, seeded.markers.credential)
  equal(process.env.HTTP_PROXY, seeded.markers.proxy)
  equal(process.env.HTTPS_PROXY, seeded.markers.proxy)
  ok(String(process.env.NODE_OPTIONS).includes(seeded.markers.loader))
  ok(String(process.env.DYLD_INSERT_LIBRARIES).includes(seeded.markers.loader))

  const env = childEnvironment('/tmp/agent-soul-smoke-home', '/tmp/agent-soul-smoke-observations.jsonl')
  for (const key of ['SMOKE_CANARY_CREDENTIAL', 'SMOKE_CANARY_SECRET', 'HTTP_PROXY', 'HTTPS_PROXY', 'DYLD_INSERT_LIBRARIES']) {
    equal(env[key], undefined, key + ' must be dropped')
  }
  equal(env.DEEPSEEK_API_KEY, '', 'the provider credential is replaced by an empty override')
  equal(String(env.NODE_OPTIONS).includes('SMOKE_CANARY'), false, 'the loader canary flag is dropped')
  ok(String(env.NODE_OPTIONS).includes('--disable-warning=ExperimentalWarning'))
  ok(String(env.NODE_OPTIONS).includes('--disable-warning=MODULE_TYPELESS_PACKAGE_JSON'))
  equal(env.DSH_HOME, '/tmp/agent-soul-smoke-home')
})

test('D17 /orchestrate registration is an explicit command-surface assertion', () => {
  const present = collector()
  checkCommandSurface({ registered: true, orchestrateRegistered: true, executed: { kind: 'success' } }, present.report)
  equal(present.rows.every(row => row.ok), true)
  ok(present.rows.some(row => /the \/orchestrate command is registered/.test(row.name)))

  const missing = collector()
  throws(
    () => checkCommandSurface({ registered: true, orchestrateRegistered: false, executed: { kind: 'success' } }, missing.report),
    /\/orchestrate command is registered/,
  )

  // The real child records this observation from runtime.commands.list(lead).
  const adapter = readFileSync(new URL('./soul-llm.ts', import.meta.url), 'utf8')
  ok(adapter.includes("observation.orchestrateRegistered = names.includes('orchestrate')"), 'the adapter emits the explicit orchestrate observation')
})

test('D18 symlink-prefixed run roots canonicalize before expected paths are derived', async t => {
  const base = tempDir('d18-canonical', t)
  const real = join(base, 'real')
  const link = join(base, 'link')
  mkdirSync(real)
  symlinkSync(real, link, 'dir')

  const canonical = await canonicalizeRunRoot(real)
  const viaLink = await canonicalizeRunRoot(link)
  equal(canonical, viaLink)
  equal(canonical, realpathSync(real))

  const nestedViaLink = await canonicalizeRunRoot(join(link, 'nested', 'run'))
  equal(nestedViaLink, join(realpathSync(real), 'nested', 'run'))
  ok(join(link, 'nested', 'run') !== nestedViaLink, 'the lexical symlink prefix differs from the canonical identity')
})

test('D18 readiness barriers tolerate partial JSON and publish atomically', async t => {
  const dir = tempDir('d18-ready', t)
  const ready = join(dir, 'ready-A.json')
  equal(await readReadyObservation(ready), null, 'a missing barrier is not ready')

  for (const partial of ['', ' ', '{"pid":', '{"pid":18143,"leadSessionId":"sess']) {
    writeFileSync(ready, partial)
    equal(await readReadyObservation(ready), null, 'a partially written barrier is retried, not fatal')
  }
  const complete = { pid: 18143, leadSessionId: 'session-1' }
  writeFileSync(ready, JSON.stringify(complete))
  deepEqual(await readReadyObservation(ready), complete)

  // Atomic publisher pattern used by the adapter: the barrier path only names
  // the complete document after the temporary file is renamed into place.
  const atomic = join(dir, 'ready-B.json')
  const temporary = atomic + '.' + process.pid + '.tmp'
  writeFileSync(temporary, '{"pid":')
  equal(await readReadyObservation(atomic), null)
  writeFileSync(temporary, JSON.stringify({ pid: 42, leadSessionId: 'session-2' }))
  equal(await readReadyObservation(atomic), null, 'the final path stays absent while only the temp file is complete')
  renameSync(temporary, atomic)
  deepEqual(await readReadyObservation(atomic), { pid: 42, leadSessionId: 'session-2' })

  // The real adapter uses publishReady (write temp then rename), not a
  // truncating write that can expose partial JSON to the runner.
  const adapter = readFileSync(new URL('./remediation-runtime-adapter.ts', import.meta.url), 'utf8')
  ok(adapter.includes('async function publishReady(path: string, value: unknown)'))
  ok(adapter.includes('await rename(temporary, path)'))
  ok(adapter.includes('await publishReady(process.env.QAS_READY!'))
})

test('D18 reporting distinguishes incomplete or unexecuted suites from a complete pass', () => {
  deepEqual(
    invocationStatus({ error: null, plannedSuites: ['concurrency', 'read'], completedSuites: ['concurrency', 'read'] }),
    { status: 'PASS', complete: true, incompleteSuites: [], unexecutedSuites: [] },
  )
  deepEqual(
    invocationStatus({ error: { message: 'boom' }, plannedSuites: ['concurrency', 'read'], completedSuites: ['concurrency'], currentSuite: 'read' }),
    { status: 'FAIL', complete: false, incompleteSuites: ['read'], unexecutedSuites: [] },
  )
  deepEqual(
    invocationStatus({ error: { message: 'boom' }, plannedSuites: ['concurrency', 'read'], completedSuites: [], currentSuite: 'concurrency' }),
    { status: 'FAIL', complete: false, incompleteSuites: ['concurrency'], unexecutedSuites: ['read'] },
  )
  const skipped = invocationStatus({ error: null, plannedSuites: ['concurrency', 'read'], completedSuites: ['concurrency'] })
  equal(skipped.status, 'FAIL')
  deepEqual(skipped.unexecutedSuites, ['read'])
  deepEqual(
    invocationStatus({ error: null, plannedSuites: ['read'], completedSuites: ['read'] }),
    { status: 'PASS', complete: true, incompleteSuites: [], unexecutedSuites: [] },
  )
})

process.on('exit', () => {
  if (process.env.AGENT_SOUL_ASSERTION_TALLY === '1') {
    console.log('smoke-fixes assertions: ' + tally.assertions)
  }
})
