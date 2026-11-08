/**
 * Regression tests for the STOR-02 storage fixes:
 *
 * - D02: a corrupt, unsupported, or partially malformed binding document is
 *   never rewritten by a mutation, so unrelated valid records survive a
 *   `set`/`delete` that follows the damage;
 * - D03: a delete whose trash directory cannot be created, or whose no-replace
 *   trash move fails, preserves the source and returns a failure instead of
 *   falling back to an irreversible unlink;
 * - D05: binding reads keep typed failures, distinguish missing from
 *   unreadable/corrupt/unsupported documents, revalidate the durable document
 *   before every answer (so a plan cached before the document became corrupt,
 *   partially malformed, or unreadable is never served or admitted), re-read on
 *   every access so an external write or repair becomes visible, and define the
 *   one in-memory exception: an unpersisted local set/delete mutation; admission
 *   refuses with an actionable, typed reason;
 * - D06: a packaged soul cannot be renamed onto another packaged soul's name
 *   (`bundledEditable`), while a local soul may still take a packaged name and
 *   shadow it; the catalog reports a duplicate packaged name instead of silently
 *   dropping a definition, and the Lead tool cannot bypass the guard;
 * - D11: a workspace-relative `bindingsFile` that escapes its root lexically or
 *   through a symbolic link is refused by config normalization, by the store
 *   before any I/O, and by the delete/restore trash fence, while an absolute
 *   `bindingsFile` remains intentional shared state shared by every workspace
 *   (consistent with the preferences and orchestrator documents);
 * - D15b: the missing-default warning describes the live catalog instead of
 *   claiming the fallback soul had to be bundled.
 *
 * Every case imports the real modules and injects real filesystem faults in a
 * disposable directory under the OS temporary directory: no live Host, profile,
 * credential, or network is involved. The packaged-catalog cases (`bundledEditable`)
 * work on a throwaway COPY of `lib/`, `agents/`, `defaults/`, and the manifest, so
 * the real package files are never written. The copy deliberately excludes the
 * user-owned `agents/adversarial-red-team-verifier.md` document.
 *
 * Run with: `node --test smoke/storage-fixes.test.mjs`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REAL_PACKAGE = fileURLToPath(new URL('..', import.meta.url))
const admin = await import(new URL('../lib/admin.js', import.meta.url).href)
const adminTool = await import(new URL('../lib/admin-tool.js', import.meta.url).href)
const apply = await import(new URL('../lib/apply.js', import.meta.url).href)
const bindings = await import(new URL('../lib/bindings.js', import.meta.url).href)
const index = await import(new URL('../index.js', import.meta.url).href)
const preferences = await import(new URL('../lib/preferences.js', import.meta.url).href)

/** Logger that never writes to the test output. */
const SILENT_LOGGER = Object.freeze({ warn() {} })

/** Running as root bypasses directory permissions, so the chmod fault cannot be injected. */
const RUNNING_AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0

/** Collect warnings for assertions about diagnostic-only failures. */
function warningSink() {
  const warnings = []
  return { warnings, logger: { warn: message => warnings.push(String(message)) } }
}

/** Create one disposable directory under the OS temp directory and clean it up. */
function tempDir(t, label) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `agent-soul-storage-${label}-`)))
  t.after(() => {
    assert.equal(dirname(dir), realpathSync(tmpdir()), 'cleanup only removes the fixture under the OS temp directory')
    assert.ok(dir.includes(`agent-soul-storage-${label}-`), 'cleanup only removes this fixture')
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

/** One durable binding record with the exact shape the store validates. */
function recordOf(name, savedAt) {
  return {
    name,
    persona: `persona-${name}`,
    tools: ['read'],
    model: { provider: 'test', model: name },
    context: 'fresh',
    sourceLabel: '',
    savedAt,
  }
}

/** One SoulSnapshot-shaped plan for a store mutation. */
function planOf(name) {
  return {
    name,
    persona: `persona-${name}`,
    tools: ['read'],
    model: { provider: 'test', model: name },
    context: 'fresh',
  }
}

/** Serialize one supported bindings document. */
function documentOf(entries) {
  return `${JSON.stringify({ version: 1, bindings: entries }, null, 2)}\n`
}

/** Sorted binding ids of one on-disk document. */
function bindingIds(path) {
  return Object.keys(JSON.parse(readFileSync(path, 'utf8')).bindings).sort()
}

/** Temp files and lock directories the store would leave behind. */
function leftovers(dir) {
  return readdirSync(dir).filter(name => /\.(tmp|lock)$/.test(name))
}

/** One valid soul document source. */
function soulSource(name) {
  return `---\nname: ${name}\ndescription: Storage fixture soul for the delete-safety regression.\n---\n\n## Role Definition\n\nFixture body.\n`
}

/** Seed one valid workspace soul and return its path and source. */
function seedSoul(workspace, name) {
  mkdirSync(join(workspace, '.dsh', 'agents'), { recursive: true })
  const file = join(workspace, '.dsh', 'agents', `${name}.md`)
  const source = soulSource(name)
  writeFileSync(file, source)
  return { file, source }
}

/** Normalized config for workspace-only document tests (no packaged catalog scan). */
function workspaceConfig() {
  return { dirs: ['.dsh/agents'], bundled: false, bindingsFile: '.dsh/agent-soul/bindings.json' }
}

/**
 * Install one `manage_agent_souls` implementation for a workspace and expose it.
 *
 * The installer is a parameter because the packaged-catalog cases must install
 * the copy's tool, whose own module URLs resolve the copy's packaged directory.
 *
 * @param {(agent: object, scope: object, deps: object) => () => void} installer
 * @param {string} workspace
 * @param {object} config
 * @returns {(args: object) => Promise<object>}
 */
function installToolWith(installer, workspace, config) {
  const registered = []
  const sink = warningSink()
  installer({ id: 'lead-storage' }, {
    tools: { register(tool) { registered.push(tool); return () => {} } },
  }, {
    ctx: { get: () => undefined },
    config,
    logger: sink.logger,
    rootOf: () => workspace,
    resolveModel: async () => undefined,
    composition: { inspect: () => null, repair: async () => ({ ok: false }) },
    syncSouls: async () => {},
  })
  assert.equal(registered.length, 1, 'installSoulAdminTool registers exactly one tool')
  return async args => await registered[0].execute(args, { agent: { id: 'lead-storage' } })
}

/** Install the real `manage_agent_souls` tool for one workspace. */
function installTool(workspace, config) {
  return installToolWith(adminTool.installSoulAdminTool, workspace, config)
}

/**
 * Create an isolated package copy plus workspace for packaged-catalog cases.
 *
 * The copy is imported through its own file URLs so BUNDLED_SOULS_DIR resolves
 * inside it. The user-owned `adversarial-red-team-verifier.md` document is
 * deliberately not copied: no test in this file reads or needs it.
 */
function packageFixture(t, label) {
  const root = tempDir(t, label)
  const pkg = join(root, 'pkg')
  const workspace = join(root, 'workspace')
  mkdirSync(pkg)
  mkdirSync(workspace)
  for (const entry of ['lib', 'defaults']) cpSync(join(REAL_PACKAGE, entry), join(pkg, entry), { recursive: true })
  for (const file of ['index.js', 'package.json']) cpSync(join(REAL_PACKAGE, file), join(pkg, file))
  mkdirSync(join(pkg, 'agents'))
  const packaged = ['generalist.md', 'researcher.md', 'scribe.md', 'software-engineer.md']
  for (const file of packaged) cpSync(join(REAL_PACKAGE, 'agents', file), join(pkg, 'agents', file))
  return { pkg, workspace, agents: join(pkg, 'agents'), packaged }
}

/** Import one module from a package copy. */
async function importCopied(pkg, entry) {
  return await import(pathToFileURL(join(pkg, entry)).href)
}

test('D02 a corrupt binding document refuses mutation and stays byte-identical', async t => {
  const dir = tempDir(t, 'corrupt')
  const fileSpec = join(dir, 'bindings.json')
  const damaged = '{ "version": 1, "bindings": { "a": '
  writeFileSync(fileSpec, damaged)
  const { warnings, logger } = warningSink()
  const store = bindings.createBindingStore({ fileSpec, logger })

  // The mutation must resolve (writes stay diagnostic-only) but write nothing.
  await store.set(dir, 'new', planOf('new'))
  assert.equal(readFileSync(fileSpec, 'utf8'), damaged, 'the corrupt document is byte-identical after the mutation')
  assert.deepEqual(leftovers(dir), [], 'a refused transaction leaves no temp file or lock directory')
  assert.ok(
    warnings.some(message => message.includes('cannot persist binding store')),
    'the refusal is reported through the store warning',
  )
  await assert.rejects(
    store.get(dir, 'a'),
    error => error.code === bindings.BINDING_CORRUPT && error.message.includes(fileSpec),
    'reading a corrupt document reports corruption instead of a missing binding',
  )

  // An external repair is visible without constructing a new store.
  writeFileSync(fileSpec, documentOf({ a: recordOf('a', 1), b: recordOf('b', 2) }))
  assert.equal((await store.get(dir, 'a')).name, 'a', 'the same store retries a failed load')
  // The retained mutation merges into the repaired document instead of replacing it.
  await store.set(dir, 'c', planOf('c'))
  assert.deepEqual(bindingIds(fileSpec), ['a', 'b', 'c', 'new'], 'the repaired records and local mutations all survive')
})

test('D02 unsupported and partially malformed documents are never rewritten', async t => {
  const dir = tempDir(t, 'unsupported')
  const fileSpec = join(dir, 'bindings.json')
  const { warnings, logger } = warningSink()
  const store = bindings.createBindingStore({ fileSpec, logger })
  const unsupported = `${JSON.stringify({ version: 99, bindings: { a: recordOf('a', 1) } })}\n`
  writeFileSync(fileSpec, unsupported)

  await store.set(dir, 'new', planOf('new'))
  await store.delete(dir, 'a')
  assert.equal(readFileSync(fileSpec, 'utf8'), unsupported, 'set and delete both refuse an unsupported envelope')
  assert.ok(warnings.some(message => message.includes('unsupported version')), 'the unsupported version is named')
  // A pending local delete is this process's newest intent for that child, so it
  // is answered even while the durable document is unusable; every other child
  // reports the typed document failure instead of a missing binding.
  assert.equal(await store.get(dir, 'a'), undefined, 'a pending local delete is served while the document is unusable')
  await assert.rejects(
    store.get(dir, 'b'),
    error => error.code === bindings.BINDING_UNSUPPORTED,
    'an unsupported document is not reported as a missing binding',
  )

  // One malformed record beside valid ones keeps the document from being rewritten,
  // so the unrelated valid record and the malformed bytes are both preserved.
  const mixed = `${JSON.stringify({ version: 1, bindings: { a: recordOf('a', 1), junk: { name: 42 } } })}\n`
  writeFileSync(fileSpec, mixed)
  const reader = bindings.createBindingStore({ fileSpec })
  // get is the admission path: a document with any malformed record is refused
  // even when the requested child's own record is intact on disk.
  await assert.rejects(
    reader.get(dir, 'a'),
    error => error.code === bindings.BINDING_CORRUPT,
    'a partially malformed document is refused by get (fail-closed admission)',
  )
  await assert.rejects(
    reader.get(dir, 'missing'),
    error => error.code === bindings.BINDING_CORRUPT,
    'a miss under partial corruption reports the corruption, not "never written"',
  )
  await reader.set(dir, 'b', planOf('b'))
  assert.equal(readFileSync(fileSpec, 'utf8'), mixed, 'the malformed record is preserved instead of dropped')

  // Repair by removing the malformed record: merging resumes and keeps the record.
  writeFileSync(fileSpec, documentOf({ a: recordOf('a', 1) }))
  await reader.set(dir, 'b', planOf('b'))
  assert.deepEqual(bindingIds(fileSpec), ['a', 'b'], 'the unrelated record survives the repaired merge')
})

test('D02 the store refuses a snapshot it would later reject as a malformed record', async t => {
  const dir = tempDir(t, 'invalid-snapshot')
  const fileSpec = join(dir, 'bindings.json')
  const { logger } = warningSink()
  const store = bindings.createBindingStore({ fileSpec, logger })
  // The Lead's stale-binding probe fixture omitted the required persona field.
  // Writing it would poison the document that a revalidated read must refuse.
  await assert.rejects(
    store.set(dir, 'child', { name: 'generalist', tools: null, model: null, context: 'fresh', savedAt: Date.now() }),
    error => error.code === bindings.BINDING_INVALID_RECORD,
    'a malformed snapshot is refused before it can corrupt the document',
  )
  assert.equal(existsSync(fileSpec), false, 'no document is created for a refused snapshot')
  assert.equal(await store.get(dir, 'child'), undefined, 'nothing is retained for the refused snapshot')
  await store.set(dir, 'good', planOf('good'))
  assert.equal((await store.get(dir, 'good')).name, 'good', 'a valid snapshot still persists normally')
  assert.deepEqual(bindingIds(fileSpec), ['good'])
})

test('D05 missing, unreadable, and corrupt binding documents are distinguished', async t => {
  const dir = tempDir(t, 'distinguish')

  const missing = bindings.createBindingStore({ fileSpec: join(dir, 'missing', 'bindings.json') })
  assert.equal(await missing.get(dir, 'child'), undefined, 'a never-written document is a missing binding')
  assert.deepEqual(await missing.list(dir), [], 'a missing document lists no rows')
  assert.equal(await missing.size(dir), 0, 'a missing document has size zero')

  // A directory at the document path is an unreadable document, not an empty one.
  const unreadablePath = join(dir, 'unreadable', 'bindings.json')
  mkdirSync(unreadablePath, { recursive: true })
  writeFileSync(join(unreadablePath, 'sentinel.txt'), 'preserve')
  const unreadable = bindings.createBindingStore({ fileSpec: unreadablePath })
  const isUnreadable = error => error.code === bindings.BINDING_UNREADABLE && error.message.includes(unreadablePath)
  await assert.rejects(unreadable.get(dir, 'child'), isUnreadable, 'an unreadable document has its own typed code')
  await assert.rejects(unreadable.list(dir), isUnreadable, 'list rejects an unreadable document instead of reporting []')
  await assert.rejects(unreadable.size(dir), isUnreadable, 'size rejects instead of reporting a misleading zero')
  assert.equal(readFileSync(join(unreadablePath, 'sentinel.txt'), 'utf8'), 'preserve', 'the unreadable path is untouched')

  const corruptPath = join(dir, 'corrupt.json')
  writeFileSync(corruptPath, 'not json')
  const corrupt = bindings.createBindingStore({ fileSpec: corruptPath })
  const isCorrupt = error => error.code === bindings.BINDING_CORRUPT && error.message.includes(corruptPath)
  await assert.rejects(corrupt.get(dir, 'child'), isCorrupt, 'malformed JSON has its own typed code and names the document')
  await assert.rejects(corrupt.list(dir), isCorrupt, 'list reports a malformed document instead of an empty store')
  await assert.rejects(corrupt.size(dir), isCorrupt, 'size reports a malformed document instead of zero')
})

test('D05 a cached miss re-reads so another process write or repair is visible', async t => {
  const dir = tempDir(t, 'external')
  const fileSpec = join(dir, 'bindings.json')
  const reader = bindings.createBindingStore({ fileSpec })
  assert.equal(await reader.get(dir, 'child'), undefined, 'the first read starts from an absent document')

  const writer = bindings.createBindingStore({ fileSpec })
  await writer.set(dir, 'child', planOf('child'))
  assert.equal((await reader.get(dir, 'child')).name, 'child', 'a miss is re-read before answering')

  await writer.set(dir, 'second', planOf('second'))
  assert.equal((await reader.size(dir)), 2, 'size refreshes the snapshot when no local mutation is pending')
  assert.deepEqual((await reader.list(dir)).map(row => row.name).sort(), ['child', 'second'], 'list sees the external rows')
})

test('D05 admission refusals keep typed reasons and actionable repair text', async t => {
  const dir = tempDir(t, 'admission')
  const pending = apply.createPendingSpawns()
  const membership = { root: dir, name: 'teammate-x' }
  const agent = { id: 'child-1', session: { header: { cwd: dir } } }
  const depsFor = store => ({
    pending,
    pendingKey: (root, name) => `${root}\u0000${name}`,
    rootOf: () => dir,
    bindings: store,
    logger: SILENT_LOGGER,
  })
  const rejection = async (store, assertion) => {
    await assert.rejects(
      apply.applyTeammateSoul(agent, membership, depsFor(store)),
      error => {
        assert.equal(error instanceof apply.SoulPlanUnavailableError, true, 'admission fails with SoulPlanUnavailableError')
        assert.equal(error.code, 'SOUL_PLAN_UNAVAILABLE', 'the stable admission code is preserved')
        assertion(error)
        return true
      },
    )
  }

  await rejection(bindings.createBindingStore({ fileSpec: join(dir, 'missing', 'bindings.json') }), error => {
    assert.equal(error.reason, 'missing-binding')
    assert.match(error.message, /no pending or durable Agent Soul plan/)
  })

  const corruptPath = join(dir, 'corrupt.json')
  writeFileSync(corruptPath, '{')
  await rejection(bindings.createBindingStore({ fileSpec: corruptPath }), error => {
    assert.equal(error.reason, 'corrupt-binding')
    assert.match(error.message, /not valid JSON/)
    assert.match(error.message, /Repair or remove the bindings document/)
  })

  const unsupportedPath = join(dir, 'unsupported.json')
  writeFileSync(unsupportedPath, `${JSON.stringify({ version: 99, bindings: {} })}\n`)
  await rejection(bindings.createBindingStore({ fileSpec: unsupportedPath }), error => {
    assert.equal(error.reason, 'unsupported-binding')
    assert.match(error.message, /unsupported version/)
  })

  const unreadablePath = join(dir, 'unreadable', 'bindings.json')
  mkdirSync(unreadablePath, { recursive: true })
  await rejection(bindings.createBindingStore({ fileSpec: unreadablePath }), error => {
    assert.equal(error.reason, 'unreadable-binding')
    assert.match(error.message, /cannot read the binding store/)
  })

  await rejection(bindings.createBindingStore({ fileSpec: '../escape-bindings.json' }), error => {
    assert.equal(error.reason, 'unsafe-binding-path')
    assert.match(error.message, /escapes its workspace/)
  })

  // A plan cached while the document was healthy must not be admitted after the
  // durable document becomes corrupt...
  const warmCorruptPath = join(dir, 'warm-corrupt.json')
  const warmCorrupt = bindings.createBindingStore({ fileSpec: warmCorruptPath })
  await warmCorrupt.set(dir, 'child-1', planOf('generalist'))
  assert.equal((await warmCorrupt.get(dir, 'child-1')).name, 'generalist', 'the binding is cached while the document is healthy')
  writeFileSync(warmCorruptPath, '{broken json')
  await rejection(warmCorrupt, error => {
    assert.equal(error.reason, 'corrupt-binding')
    assert.match(error.message, /not valid JSON/)
  })

  // ... and likewise when it becomes unreadable.
  const warmUnreadablePath = join(dir, 'warm-unreadable.json')
  const warmUnreadable = bindings.createBindingStore({ fileSpec: warmUnreadablePath })
  await warmUnreadable.set(dir, 'child-1', planOf('generalist'))
  assert.equal((await warmUnreadable.get(dir, 'child-1')).name, 'generalist')
  rmSync(warmUnreadablePath)
  mkdirSync(warmUnreadablePath)
  await rejection(warmUnreadable, error => {
    assert.equal(error.reason, 'unreadable-binding')
    assert.match(error.message, /cannot read the binding store/)
  })

  // ... and when an unrelated record in the same document becomes malformed
  // while this child's own record is still intact.
  const warmPartialPath = join(dir, 'warm-partial.json')
  const warmPartial = bindings.createBindingStore({ fileSpec: warmPartialPath })
  await warmPartial.set(dir, 'child-1', planOf('generalist'))
  assert.equal((await warmPartial.get(dir, 'child-1')).name, 'generalist')
  writeFileSync(
    warmPartialPath,
    `${JSON.stringify({ version: 1, bindings: { 'child-1': recordOf('generalist', 1), junk: { name: 42 } } })}\n`,
  )
  await rejection(warmPartial, error => {
    assert.equal(error.reason, 'corrupt-binding')
    assert.match(error.message, /malformed record/)
  })
})

test('D05 a binding cached while healthy is revalidated and rejects after corruption', async t => {
  const dir = tempDir(t, 'revalidate-corrupt')
  const fileSpec = join(dir, 'bindings.json')
  const store = bindings.createBindingStore({ fileSpec })
  await store.set(dir, 'child', planOf('child'))
  assert.equal((await store.get(dir, 'child')).name, 'child', 'the warm read returns the durable plan')
  const damaged = '{broken json'
  writeFileSync(fileSpec, damaged)
  const isCorrupt = error => error.code === bindings.BINDING_CORRUPT && error.message.includes(fileSpec)
  await assert.rejects(store.get(dir, 'child'), isCorrupt, 'a cached plan is not served after the document becomes corrupt')
  await assert.rejects(store.list(dir), isCorrupt, 'list reports the corrupt document')
  await assert.rejects(store.size(dir), isCorrupt, 'size reports the corrupt document')
  assert.equal(readFileSync(fileSpec, 'utf8'), damaged, 'revalidation never rewrites the corrupt document')
  // Same-store repair visibility: no new store is needed.
  writeFileSync(fileSpec, documentOf({ child: recordOf('child', 1) }))
  assert.equal((await store.get(dir, 'child')).name, 'child', 'a repaired document is visible to the same store')
  assert.equal(await store.size(dir), 1)
})

test('D05 a binding cached while healthy is not served after the document becomes unreadable', async t => {
  const dir = tempDir(t, 'revalidate-unreadable')
  const fileSpec = join(dir, 'bindings.json')
  const store = bindings.createBindingStore({ fileSpec })
  await store.set(dir, 'child', planOf('child'))
  assert.equal((await store.get(dir, 'child')).name, 'child')
  rmSync(fileSpec)
  mkdirSync(fileSpec)
  writeFileSync(join(fileSpec, 'sentinel.txt'), 'preserve')
  const isUnreadable = error => error.code === bindings.BINDING_UNREADABLE && error.message.includes(fileSpec)
  await assert.rejects(store.get(dir, 'child'), isUnreadable, 'a cached plan is not served when the document is unreadable')
  await assert.rejects(store.list(dir), isUnreadable)
  await assert.rejects(store.size(dir), isUnreadable)
  assert.equal(readFileSync(join(fileSpec, 'sentinel.txt'), 'utf8'), 'preserve', 'the unreadable path is untouched')
  rmSync(fileSpec, { recursive: true })
  writeFileSync(fileSpec, documentOf({ child: recordOf('child', 1) }))
  assert.equal((await store.get(dir, 'child')).name, 'child', 'the repaired document is visible to the same store')
})

test('D05 an unpersisted local mutation is the only in-memory value served while the document is unusable', async t => {
  const dir = tempDir(t, 'pending-intent')
  const fileSpec = join(dir, 'bindings.json')
  const damaged = '{broken json'
  writeFileSync(fileSpec, damaged)
  const { logger } = warningSink()
  const store = bindings.createBindingStore({ fileSpec, logger })
  await store.set(dir, 'new-child', planOf('new-child'))
  await store.delete(dir, 'deleted-child')
  assert.equal(readFileSync(fileSpec, 'utf8'), damaged, 'refused writes never rewrite the document')
  assert.equal((await store.get(dir, 'new-child')).name, 'new-child', 'a pending set is local intent and is served')
  assert.equal(await store.get(dir, 'deleted-child'), undefined, 'a pending delete is local intent and is served')
  await assert.rejects(store.get(dir, 'other'), error => error.code === bindings.BINDING_CORRUPT, 'no cached durable plan is served')
  await assert.rejects(store.list(dir), error => error.code === bindings.BINDING_CORRUPT, 'list still reports the unusable document')
  await assert.rejects(store.size(dir), error => error.code === bindings.BINDING_CORRUPT)
})

test('D03 a trash creation failure preserves the source and returns a failure', async t => {
  const workspace = tempDir(t, 'trash-create')
  const config = workspaceConfig()
  const { file, source } = seedSoul(workspace, 'keeper')
  // A regular file where the state directory belongs makes <state>/trash impossible.
  writeFileSync(join(workspace, '.dsh', 'agent-soul'), 'not a directory')

  const result = await admin.deleteDocument({ config, root: workspace, file })
  assert.equal(result.ok, false, 'the delete is a failure, not a success without Undo')
  assert.equal(result.code, 'invalid-request', 'the failure is an actionable request error')
  assert.match(result.message, /trash/)
  assert.match(result.message, /not deleted/)
  assert.equal(result.trashedFile, undefined, 'no trashedFile is reported for a document that was not moved')
  assert.equal(existsSync(file), true, 'the source document still exists')
  assert.equal(readFileSync(file, 'utf8'), source, 'the source document is byte-identical')
})

test('D03 a trash move failure preserves the source and returns a failure', {
  skip: RUNNING_AS_ROOT ? 'root ignores the read-only trash-directory mode' : false,
}, async t => {
  const workspace = tempDir(t, 'trash-move')
  const config = workspaceConfig()
  const { file, source } = seedSoul(workspace, 'keeper')
  const trashDir = join(workspace, '.dsh', 'agent-soul', 'trash')
  mkdirSync(trashDir, { recursive: true })
  chmodSync(trashDir, 0o500)
  try {
    const result = await admin.deleteDocument({ config, root: workspace, file })
    assert.equal(result.ok, false, 'a failed trash move is a failure, not a silent hard delete')
    assert.equal(result.code, 'invalid-request')
    assert.match(result.message, /trash/)
    assert.equal(result.trashedFile, undefined)
    assert.equal(existsSync(file), true, 'the source document still exists')
    assert.equal(readFileSync(file, 'utf8'), source, 'the source document is byte-identical')
    assert.deepEqual(readdirSync(trashDir), [], 'no partial trash entry is left behind')
  } finally {
    chmodSync(trashDir, 0o755)
  }
  // The recoverable path still works once the trash is writable again.
  const removed = await admin.deleteDocument({ config, root: workspace, file })
  assert.equal(removed.ok, true, 'a healthy trash move still succeeds')
  assert.ok(String(removed.trashedFile).startsWith(trashDir), 'success reports the trash path for Undo')
  assert.equal(existsSync(file), false)
})

test('D03 manage_agent_souls delete reports a trash failure instead of claiming deletion', async t => {
  const workspace = tempDir(t, 'trash-tool')
  const config = workspaceConfig()
  const { file, source } = seedSoul(workspace, 'keeper')
  writeFileSync(join(workspace, '.dsh', 'agent-soul'), 'not a directory')
  const call = installTool(workspace, config)

  const result = await call({ action: 'delete', file: join('.dsh', 'agents', 'keeper.md') })
  assert.equal(result.ok, false, 'the model-facing tool reports the failure')
  assert.equal(result.action, 'delete')
  assert.match(result.message, /trash/)
  assert.equal(existsSync(file), true, 'the source is preserved')
  assert.equal(readFileSync(file, 'utf8'), source, 'the source is byte-identical')
})

test('D06 a packaged rename onto another packaged name is refused while local shadowing stays legal', async t => {
  const { pkg, workspace, agents, packaged } = packageFixture(t, 'rename')
  const copiedAdmin = await importCopied(pkg, 'lib/admin.js')
  const copiedSoul = await importCopied(pkg, 'lib/soul.js')
  const config = {
    dirs: ['.dsh/agents'],
    bundled: true,
    bundledEditable: true,
    bindingsFile: '.dsh/agent-soul/bindings.json',
  }
  const generalistFile = join(agents, 'generalist.md')
  const researcherFile = join(agents, 'researcher.md')
  const original = readFileSync(generalistFile, 'utf8')
  const researcherOriginal = readFileSync(researcherFile, 'utf8')
  const split = copiedAdmin.splitDocument(original)
  const renamed = copiedAdmin.composeDocument({ fields: { ...split.fields, name: 'researcher' }, sections: split.sections })
  assert.equal(renamed.valid, true, 'the renamed fixture is a valid document')

  // The direct raw-save API (also the Lead tool's path) refuses the rename.
  const refused = await copiedAdmin.saveDocumentSource({
    config, root: workspace, file: generalistFile, source: renamed.source, expectedHash: copiedAdmin.documentHash(original),
  })
  assert.equal(refused.ok, false, 'a packaged document cannot claim another packaged name')
  assert.equal(refused.code, 'invalid')
  assert.match(refused.message, /another soul named "researcher" already exists/)
  assert.equal(readFileSync(generalistFile, 'utf8'), original, 'the refused rename leaves the packaged source unchanged')
  assert.equal(readFileSync(researcherFile, 'utf8'), researcherOriginal, 'the competing packaged document is unchanged')

  // The GUI form path is guarded by the shared document layer too.
  const formRefused = await copiedAdmin.saveDocument({
    config,
    root: workspace,
    file: generalistFile,
    fields: { ...split.fields, name: 'scribe' },
    sections: split.sections,
    expectedHash: copiedAdmin.documentHash(original),
  })
  assert.equal(formRefused.ok, false, 'the composed-document save path applies the same packaged-name guard')
  assert.match(formRefused.message, /another soul named "scribe" already exists/)

  // The model-facing tool cannot bypass the guard (installed from the copy so
  // its packaged directory is the copy's catalog).
  const copiedTool = await importCopied(pkg, 'lib/admin-tool.js')
  const call = installToolWith(copiedTool.installSoulAdminTool, workspace, config)
  const toolRefused = await call({ action: 'save', file: generalistFile, source: renamed.source })
  assert.equal(toolRefused.ok, false, 'manage_agent_souls save refuses the packaged duplicate')
  assert.match(toolRefused.message, /another soul named "researcher" already exists/)
  assert.equal(readFileSync(generalistFile, 'utf8'), original)

  // The effective catalog still serves every packaged soul.
  const catalog = copiedSoul.createCatalog({ dirs: [], bundled: true })
  const snapshot = await catalog.refresh(workspace)
  const expectedNames = packaged.map(file => file.replace(/\.md$/, '')).sort()
  assert.deepEqual(snapshot.definitions.map(definition => definition.name).sort(), expectedNames)
  assert.deepEqual(snapshot.diagnostics, [], 'the packaged catalog has no duplicate diagnostics')

  // Renaming the packaged document to its own name remains allowed.
  const selfEdit = copiedAdmin.composeDocument({
    fields: split.fields,
    sections: { ...split.sections, role: `${split.sections.role}\n\nPackaged self-edit written by the storage regression.\n` },
  })
  const allowed = await copiedAdmin.saveDocumentSource({
    config, root: workspace, file: generalistFile, source: selfEdit.source, expectedHash: copiedAdmin.documentHash(original),
  })
  assert.equal(allowed.ok, true, 'a packaged document may still be edited under its own name')

  // A local workspace soul may still take a packaged name and shadow it.
  const local = await copiedAdmin.createDocument({ config, root: workspace, name: 'researcher', source: researcherOriginal })
  assert.equal(local.ok, true, 'a local soul may take a packaged soul name (shadowing)')
  assert.equal(local.document.packageOwned, false, 'the shadowing soul is a workspace document')

  // A local soul may also rename itself onto a packaged name: it only shadows.
  const localSplit = copiedAdmin.splitDocument(researcherOriginal)
  const localRenamed = copiedAdmin.composeDocument({ fields: { ...localSplit.fields, name: 'scribe' }, sections: localSplit.sections })
  const localRenamedResult = await copiedAdmin.saveDocumentSource({
    config, root: workspace, file: local.document.file, source: localRenamed.source, expectedHash: copiedAdmin.documentHash(researcherOriginal),
  })
  assert.equal(localRenamedResult.ok, true, 'a workspace soul may claim a packaged name')
  assert.equal(localRenamedResult.document.packageOwned, false)

  // The catalog still resolves one definition per name, with the renamed local
  // soul shadowing its packaged copy and the now-unshadowed packaged soul back.
  const after = await catalog.refresh(workspace)
  assert.deepEqual(after.definitions.map(definition => definition.name).sort(),
    ['generalist', 'researcher', 'scribe', 'software-engineer'])
  const visible = await copiedAdmin.listDocuments({ config, root: workspace })
  const scribe = visible.documents.filter(row => row.name === 'scribe')
  assert.equal(scribe.length, 1, 'the renamed local soul shadows the packaged scribe')
  assert.equal(scribe[0].file, local.document.file, 'the visible scribe row is the workspace document')
  const researcher = visible.documents.filter(row => row.name === 'researcher')
  assert.equal(researcher.length, 1, 'the packaged researcher is visible again once the local soul renames away')
  assert.equal(researcher[0].packageOwned, true, 'the visible researcher row is the packaged document')

  // A packaged catalog that really does duplicate a name is reported instead of
  // silently collapsing the later definition into nothing.
  cpSync(generalistFile, join(agents, 'generalist-copy.md'))
  const duplicated = await catalog.refresh(workspace)
  assert.equal(
    duplicated.definitions.filter(definition => definition.name === 'generalist').length,
    1,
    'exactly one packaged generalist definition is retained',
  )
  assert.ok(
    duplicated.diagnostics.some(diagnostic => /duplicate packaged soul name "generalist"/.test(diagnostic.message)),
    'the duplicate packaged name is reported through the catalog diagnostics',
  )
})

test('D11 relative binding escapes are refused while absolute shared state stays supported', async t => {
  const root = tempDir(t, 'paths')
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)

  assert.throws(
    () => index.normalizeConfig({ bindingsFile: '../escape-bindings.json' }, SILENT_LOGGER),
    TypeError,
    'config normalization refuses a relative binding escape',
  )
  assert.throws(
    () => index.normalizeConfig({ bindingsFile: 'nested/../../escape-bindings.json' }, SILENT_LOGGER),
    TypeError,
    'config normalization refuses a normalized relative escape',
  )
  assert.equal(
    index.normalizeConfig({ bindingsFile: '.dsh/agent-soul/bindings.json' }, SILENT_LOGGER).bindingsFile,
    '.dsh/agent-soul/bindings.json',
    'a workspace-relative binding path is still accepted',
  )

  // The store refuses a direct escape too and writes nothing outside its root.
  const outside = join(root, 'escape-bindings.json')
  const { warnings, logger } = warningSink()
  const escaping = bindings.createBindingStore({ fileSpec: '../escape-bindings.json', logger })
  assert.throws(
    () => escaping.filePath(workspace),
    error => error.code === bindings.BINDING_UNSAFE_PATH,
    'the store names the unsafe relative binding path',
  )
  await escaping.set(workspace, 'child', planOf('child'))
  assert.equal(existsSync(outside), false, 'the refused transaction writes nothing outside the workspace')
  assert.ok(warnings.some(message => message.includes('escapes its workspace')))
  await assert.rejects(
    escaping.get(workspace, 'other'),
    error => error.code === bindings.BINDING_UNSAFE_PATH,
    'a read through the refused path reports the unsafe path',
  )

  // The sibling preference document refuses the same relative escape.
  const escapeConfig = { bindingsFile: '../escape-bindings.json' }
  const escapeRead = await preferences.readPreferences({ config: escapeConfig, root: workspace })
  assert.equal(escapeRead.ok, false)
  assert.equal(escapeRead.code, 'unsafe-path', 'the preferences document refuses the escape like the bindings store')
  const escapeSave = await preferences.savePreferences({ config: escapeConfig, root: workspace, selected: 'generalist' })
  assert.equal(escapeSave.ok, false)
  assert.equal(escapeSave.code, 'unsafe-path')
  assert.equal(existsSync(outside), false, 'no refused sibling state document is created')

  // An absolute bindings file is intentional shared state: one document serves
  // several roots, and both the store and the preferences document follow it.
  const shared = join(root, 'shared', 'bindings.json')
  const sharedConfig = { bindingsFile: shared }
  assert.equal(index.normalizeConfig({ bindingsFile: shared }, SILENT_LOGGER).bindingsFile, shared)
  const otherRoot = join(root, 'other')
  mkdirSync(otherRoot)
  const storeA = bindings.createBindingStore({ fileSpec: shared })
  const storeB = bindings.createBindingStore({ fileSpec: shared })
  await storeA.set(workspace, 'a', planOf('a'))
  await storeB.set(otherRoot, 'b', planOf('b'))
  assert.equal(storeA.filePath(workspace), shared, 'every root resolves the absolute shared document')
  assert.equal(storeB.filePath(otherRoot), shared)
  assert.deepEqual(bindingIds(shared), ['a', 'b'], 'the shared document keeps both roots records')
  assert.equal((await storeA.get(workspace, 'b')).name, 'b', 'shared durable state is visible across roots')

  const saved = await preferences.savePreferences({ config: sharedConfig, root: workspace, selected: 'generalist' })
  assert.equal(saved.ok, true, 'an absolute bindings file keeps the preferences document beside it')
  assert.equal(saved.preferences.path, join(root, 'shared', 'preferences.json'))
  const otherPreferences = await preferences.readPreferences({ config: sharedConfig, root: otherRoot })
  assert.equal(otherPreferences.ok, true)
  assert.equal(otherPreferences.preferences.selected, 'generalist', 'the shared preference document serves every root')
})

test('D11 workspace-relative binding state is fenced to the real workspace through symlinks', async t => {
  const root = tempDir(t, 'state-fence')
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  mkdirSync(workspace)
  mkdirSync(outside)
  // `.dsh` itself is a symbolic link outside the workspace: the lexical path
  // looks workspace-owned but every real I/O target is outside.
  symlinkSync(outside, join(workspace, '.dsh'), 'dir')
  const display = bindings.createBindingStore()
  assert.equal(
    display.filePath(workspace),
    join(workspace, '.dsh', 'agent-soul', 'bindings.json'),
    'the configured display path stays lexical',
  )
  const isUnsafe = error => error.code === bindings.BINDING_UNSAFE_PATH && /symbolic link/.test(error.message)
  const reader = bindings.createBindingStore()
  await assert.rejects(reader.get(workspace, 'child'), isUnsafe, 'a read through the symlinked state path is refused')
  await assert.rejects(reader.list(workspace), isUnsafe, 'list refuses the symlinked state path')
  await assert.rejects(reader.size(workspace), isUnsafe, 'size refuses the symlinked state path')
  assert.equal(existsSync(join(outside, 'agent-soul')), false, 'a refused read creates nothing outside the workspace')

  const { warnings, logger } = warningSink()
  const writer = bindings.createBindingStore({ logger })
  await writer.set(workspace, 'child', planOf('child'))
  assert.equal(existsSync(join(outside, 'agent-soul')), false, 'a refused write creates nothing outside the workspace')
  assert.ok(warnings.some(message => message.includes('escapes its real workspace')), 'the refusal is reported through the store warning')
  assert.equal((await writer.get(workspace, 'child')).name, 'child', 'the pending local intent stays answerable')

  // Only `.dsh/agent-soul` escapes (`.dsh` itself is real).
  const workspaceTwo = join(root, 'workspace-two')
  mkdirSync(join(workspaceTwo, '.dsh'), { recursive: true })
  const outsideState = join(root, 'outside-state')
  mkdirSync(outsideState)
  symlinkSync(outsideState, join(workspaceTwo, '.dsh', 'agent-soul'), 'dir')
  const storeTwo = bindings.createBindingStore()
  await assert.rejects(storeTwo.get(workspaceTwo, 'child'), isUnsafe, 'a symlinked agent-soul directory is refused')
  await storeTwo.set(workspaceTwo, 'child', planOf('child'))
  assert.deepEqual(readdirSync(outsideState), [], 'nothing is written into the escaping state directory')

  // A dangling state symlink is refused and never created or followed.
  const workspaceThree = join(root, 'workspace-three')
  mkdirSync(workspaceThree)
  const missingTarget = join(root, 'missing-state-target')
  symlinkSync(missingTarget, join(workspaceThree, '.dsh'), 'dir')
  const storeThree = bindings.createBindingStore()
  await assert.rejects(storeThree.get(workspaceThree, 'child'), isUnsafe, 'a dangling state symlink is refused')
  await storeThree.set(workspaceThree, 'child', planOf('child'))
  assert.equal(existsSync(missingTarget), false, 'a dangling state symlink target is never created')

  // A state alias that resolves inside the real workspace remains supported.
  const workspaceFour = join(root, 'workspace-four')
  mkdirSync(workspaceFour)
  mkdirSync(join(workspaceFour, 'state'))
  symlinkSync(join(workspaceFour, 'state'), join(workspaceFour, '.dsh'), 'dir')
  const storeFour = bindings.createBindingStore()
  await storeFour.set(workspaceFour, 'child', planOf('child'))
  assert.equal((await storeFour.get(workspaceFour, 'child')).name, 'child', 'an in-workspace state alias still works')
  assert.equal(
    existsSync(join(workspaceFour, 'state', 'agent-soul', 'bindings.json')),
    true,
    'the document lands in the real in-workspace state directory',
  )

  // An absolute spec is intentional shared state, even when its own path is aliased.
  const realShared = join(root, 'shared-real')
  mkdirSync(realShared)
  const sharedAlias = join(root, 'shared-alias')
  symlinkSync(realShared, sharedAlias, 'dir')
  const sharedStore = bindings.createBindingStore({ fileSpec: join(sharedAlias, 'bindings.json') })
  await sharedStore.set(workspaceFour, 'shared-child', planOf('shared-child'))
  assert.equal(existsSync(join(realShared, 'bindings.json')), true, 'an absolute shared document is written through its alias')
  assert.equal((await sharedStore.get(workspaceFour, 'shared-child')).name, 'shared-child')

  // A document that is itself a symlink to an outside file is refused, too.
  const workspaceFive = join(root, 'workspace-five')
  mkdirSync(join(workspaceFive, '.dsh', 'agent-soul'), { recursive: true })
  const outsideDocument = join(root, 'outside-bindings.json')
  writeFileSync(outsideDocument, documentOf({ child: recordOf('child', 1) }))
  const outsideDocumentSource = readFileSync(outsideDocument, 'utf8')
  symlinkSync(outsideDocument, join(workspaceFive, '.dsh', 'agent-soul', 'bindings.json'))
  const storeFive = bindings.createBindingStore()
  await assert.rejects(storeFive.get(workspaceFive, 'child'), isUnsafe, 'a document symlink to an outside file is refused')
  await storeFive.set(workspaceFive, 'child', planOf('child'))
  assert.equal(readFileSync(outsideDocument, 'utf8'), outsideDocumentSource, 'the outside document is never written through the symlink')
})

test('D11 delete and restore refuse a symlinked state path and never move a soul outside the workspace', async t => {
  const root = tempDir(t, 'trash-fence')
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  mkdirSync(workspace)
  mkdirSync(outside)
  const config = workspaceConfig()
  const { file, source } = seedSoul(workspace, 'keeper')
  // `.dsh` is real (it holds the soul) but the state directory escapes.
  symlinkSync(outside, join(workspace, '.dsh', 'agent-soul'), 'dir')
  const result = await admin.deleteDocument({ config, root: workspace, file })
  assert.equal(result.ok, false, 'the escaping trash path is refused')
  assert.equal(result.code, 'unsafe-path')
  assert.match(result.message, /symbolic link/)
  assert.equal(existsSync(file), true, 'the source document still exists')
  assert.equal(readFileSync(file, 'utf8'), source, 'the source document is byte-identical')
  assert.deepEqual(readdirSync(outside), [], 'no escaping trash directory or entry is created')

  // Restore refuses the same state path before adopting a trashed file.
  const outsideTrash = join(outside, 'trash')
  mkdirSync(outsideTrash)
  const trashed = join(outsideTrash, '20260101T000000000Z-keeper.md')
  writeFileSync(trashed, source)
  const restoreTarget = join(workspace, '.dsh', 'agents', 'restored.md')
  const restored = await admin.restoreDocument({ config, root: workspace, trashedFile: trashed, file: restoreTarget })
  assert.equal(restored.ok, false)
  assert.equal(restored.code, 'unsafe-path')
  assert.equal(existsSync(trashed), true, 'the fenced restore leaves the trashed file in place')
  assert.equal(existsSync(restoreTarget), false, 'the fenced restore creates no target')

  // The Lead tool reports the refusal and keeps the source.
  const call = installTool(workspace, config)
  const toolResult = await call({ action: 'delete', file: join('.dsh', 'agents', 'keeper.md') })
  assert.equal(toolResult.ok, false)
  assert.match(toolResult.message, /symbolic link/)
  assert.equal(existsSync(file), true)

  // A symlinked `.dsh` itself is refused before any trash I/O.
  const workspaceTwo = join(root, 'workspace-two')
  const outsideTwo = join(root, 'outside-two')
  mkdirSync(workspaceTwo)
  mkdirSync(join(outsideTwo, 'agents'), { recursive: true })
  symlinkSync(outsideTwo, join(workspaceTwo, '.dsh'), 'dir')
  const soulTwo = join(outsideTwo, 'agents', 'keeper-two.md')
  const sourceTwo = soulSource('keeper-two')
  writeFileSync(soulTwo, sourceTwo)
  const resultTwo = await admin.deleteDocument({ config, root: workspaceTwo, file: join(workspaceTwo, '.dsh', 'agents', 'keeper-two.md') })
  assert.equal(resultTwo.ok, false)
  assert.equal(resultTwo.code, 'unsafe-path')
  assert.equal(existsSync(soulTwo), true, 'the source outside the workspace is preserved')
  assert.equal(readFileSync(soulTwo, 'utf8'), sourceTwo)
  assert.equal(existsSync(join(outsideTwo, 'agent-soul')), false, 'no trash is created through the symlinked .dsh')

  // A trash directory that is itself a symlink outside the real state directory
  // is refused before anything is moved into it.
  const workspaceThree = join(root, 'workspace-three')
  mkdirSync(join(workspaceThree, '.dsh', 'agent-soul'), { recursive: true })
  const outsideTrashTarget = join(root, 'outside-trash-target')
  mkdirSync(outsideTrashTarget)
  symlinkSync(outsideTrashTarget, join(workspaceThree, '.dsh', 'agent-soul', 'trash'), 'dir')
  const soulThree = seedSoul(workspaceThree, 'keeper-three')
  const resultThree = await admin.deleteDocument({ config, root: workspaceThree, file: soulThree.file })
  assert.equal(resultThree.ok, false, 'a trash directory symlinked outside is refused')
  assert.equal(resultThree.code, 'unsafe-path')
  assert.equal(existsSync(soulThree.file), true, 'the source survives the refused trash symlink')
  assert.equal(readFileSync(soulThree.file, 'utf8'), soulThree.source)
  assert.deepEqual(readdirSync(outsideTrashTarget), [], 'no entry is moved into the escaping trash target')

  // An absolute bindings file keeps its recoverable trash beside the shared state.
  const shared = join(root, 'shared', 'bindings.json')
  const sharedConfig = { ...config, bindingsFile: shared }
  const sharedSoul = seedSoul(workspace, 'shared-keeper')
  const removed = await admin.deleteDocument({ config: sharedConfig, root: workspace, file: sharedSoul.file })
  assert.equal(removed.ok, true, 'absolute shared state keeps a working recoverable delete')
  assert.ok(String(removed.trashedFile).startsWith(join(root, 'shared', 'trash')), 'the trash sits beside the absolute shared document')
  assert.equal(existsSync(sharedSoul.file), false)
})

test('D11 the preferences document mirrors the symlink fence for its state path', async t => {
  const root = tempDir(t, 'prefs-fence')
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  mkdirSync(workspace)
  mkdirSync(outside)
  symlinkSync(outside, join(workspace, '.dsh'), 'dir')
  const config = { bindingsFile: '.dsh/agent-soul/bindings.json' }
  const saved = await preferences.savePreferences({ config, root: workspace, selected: 'generalist' })
  assert.equal(saved.ok, false)
  assert.equal(saved.code, 'unsafe-path')
  const read = await preferences.readPreferences({ config, root: workspace })
  assert.equal(read.ok, false)
  assert.equal(read.code, 'unsafe-path')
  assert.deepEqual(readdirSync(outside), [], 'no preferences document is written outside the workspace')
})

test('D15b the missing-default warning describes the live catalog, not bundled provenance', () => {
  const workspaceGeneralist = {
    name: 'generalist',
    description: 'Workspace-only generalist without bundled provenance.',
    bundled: false,
    source: 'workspace',
    persona: 'workspace persona',
  }
  const resolved = preferences.resolveDefaultSoul({ definitions: [workspaceGeneralist] })
  assert.equal(resolved.ok, true, 'a workspace-only generalist fills the default slot')
  assert.equal(resolved.name, 'generalist')
  assert.equal(resolved.source, 'builtin', 'the fallback is reported as the builtin slot, not bundled provenance')

  const described = preferences.describePreferences({ selected: null, definitions: [workspaceGeneralist] })
  assert.equal(described.valid, true)
  assert.equal(described.effective, 'generalist')
  assert.equal(described.warning, null)

  const missing = preferences.resolveDefaultSoul({ definitions: [{ name: 'other' }] })
  assert.equal(missing.ok, false)
  assert.match(missing.warning, /live catalog has no "generalist" soul/)
  assert.doesNotMatch(missing.warning, /bundled/, 'the diagnostic does not require a bundled origin')

  const selectedMissing = preferences.resolveDefaultSoul({ selected: 'absent', definitions: [] })
  assert.equal(selectedMissing.ok, false)
  assert.match(selectedMissing.warning, /is not in the live catalog/)
})
