/**
 * Regression tests for config.bundledEditable: packaged soul documents and the
 * packaged orchestrator doctrine become editable in place when the opt-in flag
 * is enabled, while the default configuration keeps every documented read-only
 * fence.
 *
 * Every case works on a throwaway COPY of this package (lib/, agents/, defaults/,
 * index.js, package.json) loaded through its own file URL, so
 * BUNDLED_SOULS_DIR / BUNDLED_ORCHESTRATOR_PATH resolve inside the copy and the
 * real package files are never written. Each workspace root is a separate
 * temporary directory, and both are removed afterwards; no credentials, network,
 * DSH profile, or live Host are involved.
 *
 * Covered behavior:
 * - config normalization accepts a boolean and rejects every other type; the
 *   flag is inert while bundled is false and activation warns once;
 * - default config: packaged rows are bundled:true/packageOwned:true with
 *   package-relative labels, save/delete are refused with unsafe-path, and a
 *   workspace soul may still shadow or duplicate a packaged name;
 * - bundledEditable: packaged rows are bundled:false/packageOwned:true, saves
 *   rewrite the copy atomically, a stale expectedHash is conflict, delete moves
 *   the file to the workspace trash and restore round-trips, create/duplicate
 *   still land in workspace directories, symlink aliases and escapes stay
 *   confined, and a workspace same-name soul still shadows the packaged row;
 * - bundled:false makes the flag inert (no packaged catalog, no packaged reads);
 * - GUI POST /agent-soul/document maps unsafe-path to 400 and conflict to 409;
 * - the Phase 2 orchestrator: the packaged doctrine is read/saved in place when
 *   no workspace file exists, a workspace file wins, an appearing workspace file
 *   turns the save into a conflict, and flag-off/bundled-off keep the old paths.
 *
 * Run with: node --test smoke/bundled-editable.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The real package root, used only as the copy source and for safety snapshots. */
const REAL_PACKAGE = fileURLToPath(new URL('..', import.meta.url))

/** Normalized config for the default (read-only packaged) mode. */
const BASE_CONFIG = Object.freeze({
  dirs: ['.dsh/agents'],
  bundled: true,
  bundledEditable: false,
  bindingsFile: '.dsh/agent-soul/bindings.json',
})

/** Normalized config for the opt-in in-place authoring mode. */
const IN_PLACE_CONFIG = Object.freeze({ ...BASE_CONFIG, bundledEditable: true })

/** Packaged soul files, in the order the list sorts their package-relative labels. */
const PACKAGED_LABELS = Object.freeze([
  'adversarial-red-team-verifier.md',
  'generalist.md',
  'researcher.md',
  'scribe.md',
  'software-engineer.md',
])

/** Workspace-relative orchestrator document (beside the default bindings file). */
const ORCHESTRATOR_RELATIVE = join('.dsh', 'agent-soul', 'orchestrator.md')

/** Incremented by every assertion helper below, so the run reports an exact count. */
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

/**
 * Create one isolated fixture: a canonical temporary package copy plus a
 * canonical workspace root. The real package is copied, never imported for
 * mutation, so writes can only reach the copy.
 *
 * @param {string} label - unique fixture label (also part of both directory names).
 * @param {object} t - node:test context used for cleanup.
 * @returns {{ pkg: string, ws: string, agents: string, defaults: string }}
 */
function fixture(label, t) {
  const pkg = realpathSync(mkdtempSync(join(tmpdir(), 'agent-soul-' + label + '-pkg-')))
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'agent-soul-' + label + '-ws-')))
  for (const entry of ['lib', 'agents', 'defaults']) {
    cpSync(join(REAL_PACKAGE, entry), join(pkg, entry), { recursive: true })
  }
  for (const file of ['index.js', 'package.json']) {
    cpSync(join(REAL_PACKAGE, file), join(pkg, file))
  }
  t.after(() => {
    for (const dir of [pkg, ws]) {
      assert.equal(dirname(dir), realpathSync(tmpdir()), 'cleanup only removes the fixture under the OS temp directory')
      assert.ok(dir.includes('agent-soul-' + label + '-'), 'cleanup only removes this fixture')
      rmSync(dir, { recursive: true, force: true })
    }
  })
  return { pkg, ws, agents: join(pkg, 'agents'), defaults: join(pkg, 'defaults') }
}

/**
 * Import one module from the copied tree.
 *
 * The file URL is what makes the packaged paths resolve inside the copy:
 * lib/soul.js computes BUNDLED_SOULS_DIR and lib/orchestrator.js computes
 * BUNDLED_ORCHESTRATOR_PATH from their own module URLs.
 *
 * @param {string} pkg - canonical package-copy directory.
 * @param {string} entry - package-relative module path.
 * @returns {Promise<object>} the imported module.
 */
function importCopied(pkg, entry) {
  return import(pathToFileURL(join(pkg, entry)).href)
}

/** Import the copied document layer. */
function loadAdmin(pkg) {
  return importCopied(pkg, 'lib/admin.js')
}

/** Import the copied orchestrator layer. */
function loadOrchestrator(pkg) {
  return importCopied(pkg, 'lib/orchestrator.js')
}

/** Import the copied plugin entry point (config normalization and activation). */
function loadIndex(pkg) {
  return importCopied(pkg, 'index.js')
}

/** Import the copied GUI host (route construction only). */
function loadGui(pkg) {
  return importCopied(pkg, 'lib/gui-host.js')
}

/** Read one packaged file from the copy. */
function packagedSource(pkg, label) {
  return readFileSync(join(pkg, 'agents', label), 'utf8')
}

/** Read the copy's packaged orchestrator doctrine. */
function packagedDoctrine(pkg) {
  return readFileSync(join(pkg, 'defaults', 'orchestrator.md'), 'utf8')
}

/** Temp-file leftovers of the atomic writer in one directory. */
function temporaryLeftovers(directory) {
  return readdirSync(directory).filter(name => name.includes('.tmp'))
}

/** A valid soul source derived from an existing document (used for in-place edits). */
function editedSoul(source, marker) {
  return source + '\n\n' + marker + '\n'
}

/** A valid workspace orchestrator doctrine for the precedence tests. */
const WORKSPACE_DOCTRINE = [
  '---',
  'name: workspace-conductor',
  'gate-mode: advisory',
  'max-retries: 2',
  '---',
  '',
  '## Identity & Boundaries',
  '',
  'Workspace doctrine used by the bundledEditable precedence test.',
  '',
].join('\n')

/**
 * A minimal plugin context that satisfies activation's optional-service reads.
 * Only the inert-flag warning is under test here, not a live Host composition.
 *
 * @param {string[]} warnings - sink for logger warnings.
 * @returns {object} fake Cordis-shaped context.
 */
function fakePluginContext(warnings) {
  const logger = {
    warn(message) { warnings.push(String(message)) },
    info() {},
    debug() {},
    error(message) { warnings.push(String(message)) },
  }
  return {
    logger: () => logger,
    get: () => undefined,
    agents: { list: () => [], get: () => undefined },
    agentTeams: { isEnabled: () => false },
    subagents: { rootOf: () => undefined, namesOf: () => undefined, listDescendants: async () => [] },
    inject: () => {},
    sessionProjections: { register: async () => ({ dispose() {} }) },
    on: () => {},
    effect: () => {},
  }
}

/** GUI route dependencies for one config/root, with the trust fence allowing the call. */
function guiDeps(config, root) {
  return {
    ctx: {
      connection: { requestRejection: () => undefined },
      get: () => undefined,
      agents: { list: () => [] },
    },
    config,
    catalog: { refresh: async () => [] },
    bindings: {},
    logger: { warn() {}, info() {}, debug() {}, error() {} },
    root,
    resolveModel: async () => undefined,
  }
}

/** One fake JSON POST request (the routes read the body as an async iterable). */
function jsonRequest(body) {
  const payload = JSON.stringify(body)
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(payload) },
  }
}

/** One fake GET request with no body. */
function getRequest(url) {
  return {
    method: 'GET',
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {},
  }
}

/** One capturing response: status, headers, and the JSON body text. */
function jsonResponse() {
  const chunks = []
  const res = {
    status: 0,
    headers: {},
    setHeader(name, value) { res.headers[name] = value },
    writeHead(status) { res.status = status },
    end(chunk) { if (chunk !== undefined) chunks.push(String(chunk)) },
  }
  return { res, json: () => JSON.parse(chunks.join('')) }
}

// The tally is internal bookkeeping; enable it when measuring the suite size.
if (process.env.AGENT_SOUL_ASSERTION_TALLY === '1') {
  process.once('exit', () => {
    console.log('bundled-editable smoke assertions: ' + tally.assertions)
  })
}

test('config.bundledEditable normalizes as a boolean and is inert while bundled is false', async t => {
  const { pkg, ws } = fixture('config', t)
  const [admin, index] = await Promise.all([loadAdmin(pkg), loadIndex(pkg)])

  const defaults = index.normalizeConfig({})
  equal(defaults.bundledEditable, false, 'the flag defaults to false')
  equal(defaults.bundled, true, 'the packaged catalog keeps its default')
  equal(index.normalizeConfig({ bundledEditable: true }).bundledEditable, true, 'an explicit boolean is accepted')
  equal(
    index.normalizeConfig({ bundled: false, bundledEditable: true }).bundledEditable,
    true,
    'the flag is still accepted when bundled is false (it is inert, not rejected)',
  )
  throws(() => index.normalizeConfig({ bundledEditable: 'true' }), TypeError, 'a string is rejected')
  throws(() => index.normalizeConfig({ bundledEditable: 1 }), TypeError, 'a number is rejected')
  throws(() => index.normalizeConfig({ bundledEditable: null }), TypeError, 'null is rejected')

  equal(admin.bundledEditableEnabled({ bundled: true, bundledEditable: true }), true, 'enabled with both flags on')
  equal(admin.bundledEditableEnabled({ bundled: true }), false, 'disabled by default')
  equal(admin.bundledEditableEnabled({ bundled: false, bundledEditable: true }), false, 'inert while bundled is false')
  equal(admin.bundledEditableEnabled(undefined), false, 'a missing config is disabled')

  const inertWarnings = []
  await index.apply(fakePluginContext(inertWarnings), {
    ...BASE_CONFIG,
    bundled: false,
    bundledEditable: true,
    bindingsFile: join(ws, '.dsh/agent-soul/bindings.json'),
  })
  equal(
    inertWarnings.filter(message => message.includes('config.bundledEditable is ignored while config.bundled is false')).length,
    1,
    'activation warns once when the flag cannot take effect',
  )
  const activeWarnings = []
  await index.apply(fakePluginContext(activeWarnings), {
    ...BASE_CONFIG,
    bundledEditable: true,
    bindingsFile: join(ws, '.dsh/agent-soul/bindings.json'),
  })
  equal(
    activeWarnings.filter(message => message.includes('config.bundledEditable is ignored')).length,
    0,
    'activation does not warn while the flag is effective',
  )
})

test('default config lists packaged souls as read-only and refuses in-place writes', async t => {
  const { pkg, ws, agents } = fixture('default', t)
  const admin = await loadAdmin(pkg)
  const original = packagedSource(pkg, 'generalist.md')
  const realOriginal = readFileSync(join(REAL_PACKAGE, 'agents', 'generalist.md'), 'utf8')
  const file = join(agents, 'generalist.md')

  const listed = await admin.listDocuments({ config: BASE_CONFIG, root: ws })
  equal(listed.documents.length, PACKAGED_LABELS.length, 'every packaged soul is listed')
  deepEqual(listed.documents.map(row => row.label), [...PACKAGED_LABELS], 'labels are package-relative')
  equal(listed.documents.every(row => row.bundled === true), true, 'every packaged row is bundled:true')
  equal(listed.documents.every(row => row.packageOwned === true), true, 'every packaged row is package-owned')
  equal(listed.documents.every(row => row.file.startsWith(agents + sep)), true, 'every packaged row points into the copy catalog')
  deepEqual(listed.dirs, [agents], 'the packaged catalog is the only scanned directory')

  const read = await admin.readDocument({ config: BASE_CONFIG, root: ws, file })
  equal(read.ok, true, 'a packaged soul can be read')
  equal(read.document.label, 'generalist.md', 'the read detail keeps the package-relative label')
  equal(read.document.bundled, true, 'the read detail is bundled:true')
  equal(read.document.packageOwned, true, 'the read detail is package-owned')
  equal(read.document.hash, admin.documentHash(original), 'the detail hash matches the packaged text')

  const saved = await admin.saveDocumentSource({
    config: BASE_CONFIG, root: ws, file, source: editedSoul(original, 'must not be written'),
  })
  equal(saved.ok, false, 'an in-place save of a packaged soul is refused')
  equal(saved.code, 'unsafe-path', 'the refusal carries the unsafe-path code')
  equal(packagedSource(pkg, 'generalist.md'), original, 'the copy is unchanged by the refused save')
  equal(readFileSync(join(REAL_PACKAGE, 'agents', 'generalist.md'), 'utf8'), realOriginal, 'the real package is never written')

  const removed = await admin.deleteDocument({ config: BASE_CONFIG, root: ws, file })
  equal(removed.ok, false, 'an in-place delete of a packaged soul is refused')
  equal(removed.code, 'unsafe-path', 'the delete refusal carries the unsafe-path code')
  equal(existsSync(file), true, 'the refused delete keeps the packaged file')

  const created = await admin.createDocument({ config: BASE_CONFIG, root: ws, name: 'probe-default' })
  equal(created.ok, true, 'create still works with the default config')
  equal(created.document.bundled, false, 'a created document is not bundled')
  equal(created.document.file, join(ws, '.dsh', 'agents', 'probe-default.md'), 'create targets the workspace directory')
  equal(existsSync(created.document.file), true, 'the created workspace file exists')
})

test('default config keeps workspace shadowing and same-name duplication working', async t => {
  const { pkg, ws, agents } = fixture('default-shadow', t)
  const admin = await loadAdmin(pkg)
  const file = join(agents, 'generalist.md')

  const duplicated = await admin.duplicateDocument({ config: BASE_CONFIG, root: ws, file, name: 'generalist' })
  equal(duplicated.ok, true, 'a packaged soul can be duplicated under its own name')
  equal(duplicated.document.file, join(ws, '.dsh', 'agents', 'generalist.md'), 'the duplicate lands in the workspace directory')
  equal(duplicated.document.bundled, false, 'the duplicate is editable')
  equal(duplicated.document.packageOwned, false, 'the duplicate is not package-owned')
  equal(existsSync(file), true, 'the packaged original still exists')

  const listed = await admin.listDocuments({ config: BASE_CONFIG, root: ws })
  equal(listed.documents.length, PACKAGED_LABELS.length, 'the workspace copy replaces the packaged row instead of adding a second one')
  const shadow = listed.documents.filter(row => row.name === 'generalist')
  equal(shadow.length, 1, 'exactly one generalist row is visible')
  equal(shadow[0].file, join(ws, '.dsh', 'agents', 'generalist.md'), 'the visible row is the workspace soul')
  equal(shadow[0].bundled, false, 'the visible row is editable')
  equal(shadow[0].packageOwned, false, 'the visible row is not package-owned')
  equal(shadow[0].label, join('.dsh', 'agents', 'generalist.md'), 'the workspace row keeps its workspace-relative label')
  equal(listed.documents.some(row => row.file === file), false, 'the packaged row is hidden by the shadow')

  const read = await admin.readDocument({ config: BASE_CONFIG, root: ws, file })
  equal(read.ok, true, 'the hidden packaged soul can still be read by path')
  equal(read.document.bundled, true, 'the hidden packaged soul is still bundled:true')
})

test('bundledEditable lists packaged souls as editable with package-relative labels', async t => {
  const { pkg, ws, agents } = fixture('list', t)
  const admin = await loadAdmin(pkg)

  equal(admin.bundledEditableEnabled(IN_PLACE_CONFIG), true, 'the in-place config enables the helper')

  const listed = await admin.listDocuments({ config: IN_PLACE_CONFIG, root: ws })
  equal(listed.documents.length, PACKAGED_LABELS.length, 'every packaged soul is listed')
  deepEqual(listed.documents.map(row => row.label), [...PACKAGED_LABELS], 'labels stay package-relative')
  equal(listed.documents.every(row => row.bundled === false), true, 'editable packaged rows report bundled:false')
  equal(listed.documents.every(row => row.packageOwned === true), true, 'editable packaged rows stay package-owned')
  deepEqual(listed.dirs, [agents], 'the packaged catalog is still the scanned directory')

  const read = await admin.readDocument({ config: IN_PLACE_CONFIG, root: ws, file: join(agents, 'generalist.md') })
  equal(read.document.label, 'generalist.md', 'the read detail keeps the package-relative label')
  equal(read.document.bundled, false, 'the editable read detail is bundled:false')
  equal(read.document.packageOwned, true, 'the editable read detail is package-owned')
  equal(read.document.hash, admin.documentHash(packagedSource(pkg, 'generalist.md')), 'the detail hash matches the packaged text')
})

test('bundledEditable saves in place atomically and refuses a stale expectedHash', async t => {
  const { pkg, ws, agents } = fixture('save', t)
  const admin = await loadAdmin(pkg)
  const file = join(agents, 'generalist.md')
  const original = packagedSource(pkg, 'generalist.md')
  const realOriginal = readFileSync(join(REAL_PACKAGE, 'agents', 'generalist.md'), 'utf8')
  const edited = editedSoul(original, 'In-place edit written by the bundledEditable smoke test.')

  const saved = await admin.saveDocumentSource({
    config: IN_PLACE_CONFIG,
    root: ws,
    file,
    source: edited,
    expectedHash: admin.documentHash(original),
  })
  equal(saved.ok, true, 'a packaged soul accepts an in-place save when the flag is on')
  equal(saved.file, file, 'the save reports the packaged file it wrote')
  equal(saved.document.bundled, false, 'the saved detail is editable')
  equal(saved.document.packageOwned, true, 'the saved detail stays package-owned')
  equal(packagedSource(pkg, 'generalist.md'), edited, 'the packaged copy is rewritten with the exact source')
  equal((await admin.readDocument({ config: IN_PLACE_CONFIG, root: ws, file })).document.source, edited, 'a re-read returns the saved text')
  const listed = await admin.listDocuments({ config: IN_PLACE_CONFIG, root: ws })
  equal(listed.documents.find(row => row.label === 'generalist.md').hash, admin.documentHash(edited), 'the list row hash follows the save')
  deepEqual(temporaryLeftovers(agents), [], 'the atomic write leaves no temporary file behind')
  equal(readFileSync(join(REAL_PACKAGE, 'agents', 'generalist.md'), 'utf8'), realOriginal, 'the real package file is never written')

  const stale = await admin.saveDocumentSource({
    config: IN_PLACE_CONFIG,
    root: ws,
    file,
    source: editedSoul(original, 'stale write must not land'),
    expectedHash: admin.documentHash(original),
  })
  equal(stale.ok, false, 'a stale expectedHash refuses the save')
  equal(stale.code, 'conflict', 'the stale save reports conflict (the GUI maps this to 409)')
  equal(stale.currentHash, admin.documentHash(edited), 'the conflict carries the current hash for a retry')
  ok(String(stale.message).includes('changed on disk'), 'the conflict explains the stale document')
  equal(packagedSource(pkg, 'generalist.md'), edited, 'the refused stale save writes nothing')
  equal(readFileSync(join(REAL_PACKAGE, 'agents', 'generalist.md'), 'utf8'), realOriginal, 'the real package file stays unchanged')
})

test('bundledEditable delete moves to the workspace trash and restore round-trips', async t => {
  const { pkg, ws, agents } = fixture('delete', t)
  const admin = await loadAdmin(pkg)
  const file = join(agents, 'researcher.md')
  const original = packagedSource(pkg, 'researcher.md')
  const realOriginal = readFileSync(join(REAL_PACKAGE, 'agents', 'researcher.md'), 'utf8')
  const trashDir = join(ws, '.dsh', 'agent-soul', 'trash')

  const removed = await admin.deleteDocument({ config: IN_PLACE_CONFIG, root: ws, file })
  equal(removed.ok, true, 'an editable packaged soul can be deleted')
  ok(String(removed.trashedFile).startsWith(trashDir + sep), 'the deleted file is moved under the workspace trash directory')
  ok(String(removed.trashedFile).endsWith('-researcher.md'), 'the trash file keeps the original basename')
  equal(existsSync(file), false, 'the packaged copy no longer has the deleted file')
  equal(existsSync(removed.trashedFile), true, 'the trashed file exists')
  equal(readFileSync(removed.trashedFile, 'utf8'), original, 'the trashed file preserves the original text')
  equal((await admin.listDocuments({ config: IN_PLACE_CONFIG, root: ws })).documents.length, PACKAGED_LABELS.length - 1, 'the deleted row disappears from the list')

  const restored = await admin.restoreDocument({
    config: IN_PLACE_CONFIG, root: ws, trashedFile: removed.trashedFile, file,
  })
  equal(restored.ok, true, 'the trashed soul can be restored')
  equal(restored.document.file, file, 'restore targets the original packaged path')
  equal(packagedSource(pkg, 'researcher.md'), original, 'the restored packaged file is byte-identical')
  equal(existsSync(removed.trashedFile), false, 'the trash entry is consumed by the restore')
  equal((await admin.listDocuments({ config: IN_PLACE_CONFIG, root: ws })).documents.length, PACKAGED_LABELS.length, 'the restored row is listed again')
  equal(readFileSync(join(REAL_PACKAGE, 'agents', 'researcher.md'), 'utf8'), realOriginal, 'the real package file is never moved or written')
})

test('bundledEditable create and duplicate still write only to workspace directories', async t => {
  const { pkg, ws, agents } = fixture('create', t)
  const admin = await loadAdmin(pkg)
  const original = packagedSource(pkg, 'generalist.md')

  const created = await admin.createDocument({ config: IN_PLACE_CONFIG, root: ws, name: 'probe-editable' })
  equal(created.ok, true, 'create works with the flag on')
  equal(created.document.file, join(ws, '.dsh', 'agents', 'probe-editable.md'), 'create targets the workspace directory')
  equal(created.document.bundled, false, 'the created document is editable')
  equal(created.document.packageOwned, false, 'the created document is not package-owned')

  const duplicated = await admin.duplicateDocument({
    config: IN_PLACE_CONFIG, root: ws, file: join(agents, 'generalist.md'), name: 'generalist-copy',
  })
  equal(duplicated.ok, true, 'duplicating a packaged soul works with the flag on')
  equal(duplicated.document.file, join(ws, '.dsh', 'agents', 'generalist-copy.md'), 'the duplicate lands in the workspace directory')
  equal(duplicated.document.bundled, false, 'the duplicate is editable')
  equal(duplicated.document.packageOwned, false, 'the duplicate is not package-owned')
  equal(packagedSource(pkg, 'generalist.md'), original, 'neither create nor duplicate rewrites the packaged source')

  const labels = (await admin.listDocuments({ config: IN_PLACE_CONFIG, root: ws })).documents.map(row => row.label)
  equal(labels.includes(join('.dsh', 'agents', 'probe-editable.md')), true, 'the created soul is listed as a workspace row')
  equal(labels.includes(join('.dsh', 'agents', 'generalist-copy.md')), true, 'the duplicate is listed as a workspace row')
  equal(labels.filter(label => label === 'generalist.md').length, 1, 'the packaged generalist row is still visible')

  const sameName = await admin.duplicateDocument({
    config: IN_PLACE_CONFIG, root: ws, file: join(agents, 'researcher.md'), name: 'researcher',
  })
  equal(sameName.ok, true, 'a packaged soul can still be duplicated under its own name in place mode')
  equal(sameName.document.file, join(ws, '.dsh', 'agents', 'researcher.md'), 'the same-name copy lands in the workspace directory')
  equal(sameName.document.bundled, false, 'the same-name copy is editable')
})

test('bundledEditable keeps a workspace same-name soul shadowing the packaged row', async t => {
  const { pkg, ws, agents } = fixture('shadow', t)
  const admin = await loadAdmin(pkg)
  const packagedFile = join(agents, 'generalist.md')
  const original = packagedSource(pkg, 'generalist.md')
  const shadowFile = join(ws, '.dsh', 'agents', 'generalist.md')

  const created = await admin.createDocument({ config: IN_PLACE_CONFIG, root: ws, name: 'generalist', source: original })
  equal(created.ok, true, 'a workspace soul may take a packaged soul name')
  equal(created.document.file, shadowFile, 'the workspace soul is written in the workspace directory')
  equal(created.document.bundled, false, 'the workspace soul is editable')
  equal(created.document.packageOwned, false, 'the workspace soul is not package-owned')

  const listed = await admin.listDocuments({ config: IN_PLACE_CONFIG, root: ws })
  equal(listed.documents.length, PACKAGED_LABELS.length, 'the workspace soul replaces the packaged row instead of adding one')
  const visible = listed.documents.filter(row => row.name === 'generalist')
  equal(visible.length, 1, 'exactly one generalist row is visible')
  equal(visible[0].file, shadowFile, 'the visible row is the workspace soul')
  equal(visible[0].label, join('.dsh', 'agents', 'generalist.md'), 'the workspace row keeps its workspace-relative label')
  equal(visible[0].bundled, false, 'the workspace row is editable')
  equal(listed.documents.some(row => row.file === packagedFile), false, 'the editable packaged row is hidden by the shadow')
  equal(existsSync(packagedFile), true, 'the hidden packaged file is still on disk')

  const read = await admin.readDocument({ config: IN_PLACE_CONFIG, root: ws, file: packagedFile })
  equal(read.ok, true, 'the hidden packaged soul can still be read by path')
  equal(read.document.bundled, false, 'the hidden packaged soul stays editable')
  equal(read.document.packageOwned, true, 'the hidden packaged soul stays package-owned')
})

test('bundledEditable keeps symlink aliases and escapes confined to the package copy', async t => {
  const { pkg, ws, agents } = fixture('alias', t)
  const admin = await loadAdmin(pkg)
  const alias = join(ws, 'pkg-alias')
  symlinkSync(agents, alias, 'dir')
  const aliasConfig = Object.freeze({ ...IN_PLACE_CONFIG, dirs: ['pkg-alias'] })
  const aliasFile = join(alias, 'scribe.md')
  const original = packagedSource(pkg, 'scribe.md')
  const realOriginal = readFileSync(join(REAL_PACKAGE, 'agents', 'scribe.md'), 'utf8')

  equal(lstatSync(alias).isSymbolicLink(), true, 'the fixture alias is a directory symlink')
  const listed = await admin.listDocuments({ config: aliasConfig, root: ws })
  deepEqual(listed.dirs, [alias], 'the alias is scanned once, without listing the same catalog twice')
  equal(listed.documents.length, PACKAGED_LABELS.length, 'the aliased catalog lists every packaged soul once')
  equal(listed.documents.every(row => row.packageOwned === true), true, 'aliased rows keep their package ownership')
  equal(listed.documents.every(row => row.bundled === false), true, 'aliased rows are editable in place')
  deepEqual(listed.documents.map(row => row.label), [...PACKAGED_LABELS], 'aliased rows keep package-relative labels')

  const saved = await admin.saveDocumentSource({
    config: aliasConfig, root: ws, file: aliasFile, source: editedSoul(original, 'Alias write stays in the package copy.'),
    expectedHash: admin.documentHash(original),
  })
  equal(saved.ok, true, 'a write through the alias is allowed in place')
  equal(lstatSync(alias).isSymbolicLink(), true, 'the alias itself is not replaced by the write')
  equal(packagedSource(pkg, 'scribe.md'), editedSoul(original, 'Alias write stays in the package copy.'), 'the write lands in the aliased package copy')
  equal(readFileSync(join(REAL_PACKAGE, 'agents', 'scribe.md'), 'utf8'), realOriginal, 'the real package file is never written through the alias')

  const outside = join(ws, 'outside.md')
  writeFileSync(outside, '---\nname: outside\ndescription: outside document used by the escape fence test\n---\n\nOutside body.\n')
  const outsideOriginal = readFileSync(outside, 'utf8')
  const escape = join(agents, 'escape.md')
  symlinkSync(outside, escape, 'file')
  const escapeRead = await admin.readDocument({ config: IN_PLACE_CONFIG, root: ws, file: escape })
  equal(escapeRead.code, 'unsafe-path', 'reading a packaged symlink that escapes the catalog is refused')
  const escapeSave = await admin.saveDocumentSource({
    config: IN_PLACE_CONFIG, root: ws, file: escape, source: editedSoul(outsideOriginal, 'escape write must not land'),
  })
  equal(escapeSave.code, 'unsafe-path', 'writing through a packaged symlink that escapes the catalog is refused')
  const escapeDelete = await admin.deleteDocument({ config: IN_PLACE_CONFIG, root: ws, file: escape })
  equal(escapeDelete.code, 'unsafe-path', 'deleting through a packaged symlink that escapes the catalog is refused')
  equal(readFileSync(outside, 'utf8'), outsideOriginal, 'the escape target file is untouched')
  equal(lstatSync(escape).isSymbolicLink(), true, 'the refused operations leave the symlink in place')
})

test('bundled:false makes bundledEditable inert and removes the packaged catalog', async t => {
  const { pkg, ws, agents } = fixture('inert', t)
  const admin = await loadAdmin(pkg)
  const config = Object.freeze({ ...BASE_CONFIG, bundled: false, bundledEditable: true })
  const file = join(agents, 'generalist.md')
  const original = packagedSource(pkg, 'generalist.md')
  const realOriginal = readFileSync(join(REAL_PACKAGE, 'agents', 'generalist.md'), 'utf8')

  equal(admin.bundledEditableEnabled(config), false, 'the flag is inert while bundled is false')
  const listed = await admin.listDocuments({ config, root: ws })
  deepEqual(listed.dirs, [], 'no packaged catalog directory is scanned')
  deepEqual(listed.documents, [], 'no packaged soul is listed')

  const read = await admin.readDocument({ config, root: ws, file })
  equal(read.code, 'unsafe-path', 'a packaged soul cannot be read while bundled is false')
  const saved = await admin.saveDocumentSource({ config, root: ws, file, source: editedSoul(original, 'inert save') })
  equal(saved.code, 'unsafe-path', 'a packaged soul cannot be saved while bundled is false')
  const removed = await admin.deleteDocument({ config, root: ws, file })
  equal(removed.code, 'unsafe-path', 'a packaged soul cannot be deleted while bundled is false')
  equal(packagedSource(pkg, 'generalist.md'), original, 'the packaged copy is unchanged by the inert run')
  equal(readFileSync(join(REAL_PACKAGE, 'agents', 'generalist.md'), 'utf8'), realOriginal, 'the real package file is unchanged')

  const created = await admin.createDocument({ config, root: ws, name: 'probe-inert' })
  equal(created.ok, true, 'workspace-only mode still creates workspace souls')
  equal(created.document.bundled, false, 'the workspace soul is editable')
  equal((await admin.listDocuments({ config, root: ws })).documents.length, 1, 'only the workspace soul is listed')
})

test('GUI document route maps unsafe-path to 400 and stale saves to 409', async t => {
  const { pkg, ws, agents } = fixture('route', t)
  const [admin, gui] = await Promise.all([loadAdmin(pkg), loadGui(pkg)])
  const file = join(agents, 'generalist.md')
  const original = packagedSource(pkg, 'generalist.md')
  const realOriginal = readFileSync(join(REAL_PACKAGE, 'agents', 'generalist.md'), 'utf8')

  const readOnlyRoutes = gui.createGuiRoutes(guiDeps(BASE_CONFIG, ws))
  const readOnlySave = readOnlyRoutes.find(route => route.method === 'POST' && route.path === '/agent-soul/document')
  ok(readOnlySave !== undefined, 'the document POST route is registered')
  const refused = jsonResponse()
  await readOnlySave.handler(jsonRequest({ file, source: editedSoul(original, 'refused route save') }), refused.res)
  equal(refused.res.status, 400, 'a read-only in-place save is 400')
  equal(refused.json().code, 'unsafe-path', 'the read-only refusal carries the unsafe-path code')
  equal(packagedSource(pkg, 'generalist.md'), original, 'the refused route save writes nothing')

  const routes = gui.createGuiRoutes(guiDeps(IN_PLACE_CONFIG, ws))
  const saveRoute = routes.find(route => route.method === 'POST' && route.path === '/agent-soul/document')
  ok(saveRoute !== undefined, 'the in-place document POST route is registered')
  const current = admin.documentHash(original)
  const stale = jsonResponse()
  await saveRoute.handler(jsonRequest({
    file, source: editedSoul(original, 'stale route save'), expectedHash: 'a'.repeat(64),
  }), stale.res)
  equal(stale.res.status, 409, 'a stale expectedHash is 409')
  equal(stale.json().code, 'conflict', 'the 409 body carries the conflict code')
  equal(stale.json().currentHash, current, 'the 409 body carries the current hash')
  equal(packagedSource(pkg, 'generalist.md'), original, 'the stale route save writes nothing')

  const overviewRoute = routes.find(route => route.method === 'GET' && route.path === '/agent-soul/overview')
  ok(overviewRoute !== undefined, 'the overview route is registered')
  const overview = jsonResponse()
  await overviewRoute.handler(getRequest('/agent-soul/overview'), overview.res)
  equal(overview.res.status, 200, 'the overview route answers')
  equal(overview.json().settings.bundledEditable, true, 'the overview exposes the in-place flag')
  equal(overview.json().settings.bundledDir, agents, 'the overview names the packaged catalog')
  equal(overview.json().documents.length, PACKAGED_LABELS.length, 'the overview lists the packaged souls')

  const edited = editedSoul(original, 'Route save written in place.')
  const saved = jsonResponse()
  await saveRoute.handler(jsonRequest({ file, source: edited, expectedHash: current }), saved.res)
  equal(saved.res.status, 200, 'a fresh in-place route save succeeds')
  equal(saved.json().ok, true, 'the route reports success')
  equal(saved.json().document.bundled, false, 'the saved detail is editable')
  equal(saved.json().document.packageOwned, true, 'the saved detail stays package-owned')
  equal(packagedSource(pkg, 'generalist.md'), edited, 'the route save rewrites the packaged copy')
  equal(readFileSync(join(REAL_PACKAGE, 'agents', 'generalist.md'), 'utf8'), realOriginal, 'the real package file is never written')
})

test('bundledEditable orchestrator reads and saves the packaged doctrine in place', async t => {
  const { pkg, ws, defaults } = fixture('orchestrator-in-place', t)
  const orchestrator = await loadOrchestrator(pkg)
  const packagedPath = join(defaults, 'orchestrator.md')
  const workspacePath = join(ws, ORCHESTRATOR_RELATIVE)
  const original = packagedDoctrine(pkg)
  const realOriginal = readFileSync(join(REAL_PACKAGE, 'defaults', 'orchestrator.md'), 'utf8')
  const savedSource = editedSoul(original, 'Packaged doctrine edited in place by the bundledEditable test.')

  const read = await orchestrator.readOrchestrator({ config: IN_PLACE_CONFIG, root: ws })
  equal(read.ok, true, 'the packaged doctrine is readable')
  equal(read.orchestrator.path, packagedPath, 'the effective path is the packaged defaults file')
  equal(read.orchestrator.configured, true, 'the packaged doctrine is configured')
  equal(read.orchestrator.bundled, false, 'the packaged doctrine is reported editable')
  equal(read.orchestrator.sourcePath, packagedPath, 'the source path is the packaged defaults file')
  equal(read.orchestrator.source, original, 'the read returns the packaged text')
  equal(read.orchestrator.valid, true, 'the packaged doctrine is valid')
  deepEqual(read.orchestrator.diagnostics, [], 'the packaged doctrine has no diagnostics')

  const summary = await orchestrator.orchestratorSummary({ config: IN_PLACE_CONFIG, root: ws })
  equal(summary.path, packagedPath, 'the overview summary names the packaged path')
  equal(summary.bundled, false, 'the overview summary reports it as editable')

  const saved = await orchestrator.saveOrchestrator({ config: IN_PLACE_CONFIG, root: ws, source: savedSource })
  equal(saved.ok, true, 'saving writes the packaged doctrine in place')
  equal(saved.orchestrator.path, packagedPath, 'the save result reports the packaged path')
  equal(existsSync(workspacePath), false, 'no workspace orchestrator.md is created')
  equal(existsSync(join(ws, '.dsh')), false, 'no workspace state directory is created')
  equal(packagedDoctrine(pkg), savedSource, 'the packaged copy is rewritten with the exact source')
  deepEqual(temporaryLeftovers(defaults), [], 'the atomic write leaves no temporary file behind')
  equal(readFileSync(join(REAL_PACKAGE, 'defaults', 'orchestrator.md'), 'utf8'), realOriginal, 'the real doctrine is never written')
})

test('bundledEditable lets a workspace orchestrator definition win for reads and saves', async t => {
  const { pkg, ws, defaults } = fixture('orchestrator-workspace', t)
  const orchestrator = await loadOrchestrator(pkg)
  const packagedPath = join(defaults, 'orchestrator.md')
  const workspacePath = join(ws, ORCHESTRATOR_RELATIVE)
  const packagedOriginal = packagedDoctrine(pkg)
  const realOriginal = readFileSync(join(REAL_PACKAGE, 'defaults', 'orchestrator.md'), 'utf8')
  mkdirSync(dirname(workspacePath), { recursive: true })
  writeFileSync(workspacePath, WORKSPACE_DOCTRINE)

  const read = await orchestrator.readOrchestrator({ config: IN_PLACE_CONFIG, root: ws })
  equal(read.orchestrator.path, workspacePath, 'an existing workspace definition wins the read')
  equal(read.orchestrator.bundled, false, 'the workspace definition is editable')
  equal(read.orchestrator.source, WORKSPACE_DOCTRINE, 'the workspace text is returned')

  const savedSource = editedSoul(WORKSPACE_DOCTRINE, 'Workspace doctrine saved by the precedence test.')
  const saved = await orchestrator.saveOrchestrator({ config: IN_PLACE_CONFIG, root: ws, source: savedSource })
  equal(saved.ok, true, 'saving with a workspace definition succeeds')
  equal(saved.orchestrator.path, workspacePath, 'the save targets the workspace definition')
  equal(readFileSync(workspacePath, 'utf8'), savedSource, 'the workspace definition is rewritten')
  equal(packagedDoctrine(pkg), packagedOriginal, 'the packaged doctrine is untouched while a workspace definition exists')
  equal(readFileSync(join(REAL_PACKAGE, 'defaults', 'orchestrator.md'), 'utf8'), realOriginal, 'the real doctrine is untouched')

  unlinkSync(workspacePath)
  const fallback = await orchestrator.readOrchestrator({ config: IN_PLACE_CONFIG, root: ws })
  equal(fallback.orchestrator.path, packagedPath, 'deleting the workspace definition falls back to the packaged doctrine')
  equal(fallback.orchestrator.bundled, false, 'the fallback is editable in place')
})

test('bundledEditable refuses to clobber a workspace definition that appears during save', async t => {
  const { pkg, ws, defaults } = fixture('orchestrator-conflict', t)
  const orchestrator = await loadOrchestrator(pkg)
  const workspacePath = join(ws, ORCHESTRATOR_RELATIVE)
  const original = packagedDoctrine(pkg)
  const appeared = editedSoul(WORKSPACE_DOCTRINE, 'Workspace definition that appeared while the editor was open.')

  const saved = await orchestrator.saveOrchestrator({
    config: IN_PLACE_CONFIG,
    root: ws,
    source: editedSoul(original, 'packaged write must not land'),
    validate: async () => {
      mkdirSync(dirname(workspacePath), { recursive: true })
      writeFileSync(workspacePath, appeared)
      return []
    },
  })
  equal(saved.ok, false, 'the save is refused when a workspace definition appears')
  equal(saved.code, 'conflict', 'the refusal is a conflict')
  ok(String(saved.message).includes('appeared'), 'the refusal explains that the workspace definition appeared')
  equal(packagedDoctrine(pkg), original, 'the packaged doctrine is not clobbered')
  equal(readFileSync(workspacePath, 'utf8'), appeared, 'the workspace definition that appeared is preserved')
  deepEqual(temporaryLeftovers(defaults), [], 'the refused save leaves no temporary file behind')
})

test('flag-off orchestrator behavior is unchanged', async t => {
  const { pkg, ws, defaults } = fixture('orchestrator-readonly', t)
  const orchestrator = await loadOrchestrator(pkg)
  const packagedPath = join(defaults, 'orchestrator.md')
  const workspacePath = join(ws, ORCHESTRATOR_RELATIVE)
  const original = packagedDoctrine(pkg)
  const realOriginal = readFileSync(join(REAL_PACKAGE, 'defaults', 'orchestrator.md'), 'utf8')

  const read = await orchestrator.readOrchestrator({ config: BASE_CONFIG, root: ws })
  equal(read.ok, true, 'the read-only mode reads the packaged default')
  equal(read.orchestrator.path, workspacePath, 'the read-only mode keeps reporting the workspace target')
  equal(read.orchestrator.configured, true, 'the packaged default is configured')
  equal(read.orchestrator.bundled, true, 'the packaged default is bundled:true')
  equal(read.orchestrator.sourcePath, packagedPath, 'the read-only mode reports the packaged source path')
  equal(read.orchestrator.source, original, 'the read-only mode returns the packaged text')

  const summary = await orchestrator.orchestratorSummary({ config: BASE_CONFIG, root: ws })
  equal(summary.path, workspacePath, 'the summary names the workspace target')
  equal(summary.bundled, true, 'the summary reports the packaged default as read-only')

  const savedSource = editedSoul(original, 'Workspace override created by the flag-off test.')
  const saved = await orchestrator.saveOrchestrator({ config: BASE_CONFIG, root: ws, source: savedSource })
  equal(saved.ok, true, 'the flag-off save succeeds')
  equal(saved.orchestrator.path, workspacePath, 'the flag-off save creates the workspace override')
  equal(readFileSync(workspacePath, 'utf8'), savedSource, 'the workspace override carries the saved source')
  equal(packagedDoctrine(pkg), original, 'the packaged doctrine is unchanged in flag-off mode')
  equal(readFileSync(join(REAL_PACKAGE, 'defaults', 'orchestrator.md'), 'utf8'), realOriginal, 'the real doctrine is unchanged')
  const after = await orchestrator.readOrchestrator({ config: BASE_CONFIG, root: ws })
  equal(after.orchestrator.bundled, false, 'the new workspace override reads as editable')
  equal(after.orchestrator.path, workspacePath, 'the override stays the effective workspace path')
})

test('bundled:false makes the orchestrator flag inert and keeps the override path', async t => {
  const { pkg, ws, defaults } = fixture('orchestrator-inert', t)
  const orchestrator = await loadOrchestrator(pkg)
  const workspacePath = join(ws, ORCHESTRATOR_RELATIVE)
  const original = packagedDoctrine(pkg)
  const realOriginal = readFileSync(join(REAL_PACKAGE, 'defaults', 'orchestrator.md'), 'utf8')
  const config = Object.freeze({ ...BASE_CONFIG, bundled: false, bundledEditable: true })

  const read = await orchestrator.readOrchestrator({ config, root: ws })
  equal(read.ok, true, 'the skeleton read succeeds')
  equal(read.orchestrator.configured, false, 'no packaged default fills in while bundled is false')
  equal(read.orchestrator.path, workspacePath, 'the fallback path is the workspace target')
  equal(read.orchestrator.bundled, false, 'the skeleton is not marked bundled')
  equal(read.orchestrator.source, orchestrator.canonicalOrchestratorSkeleton(), 'the fallback is the canonical skeleton')

  const savedSource = editedSoul(WORKSPACE_DOCTRINE, 'Inert-mode workspace override.')
  const saved = await orchestrator.saveOrchestrator({ config, root: ws, source: savedSource })
  equal(saved.ok, true, 'the inert-mode save succeeds')
  equal(saved.orchestrator.path, workspacePath, 'the inert-mode save writes the workspace override')
  equal(readFileSync(workspacePath, 'utf8'), savedSource, 'the workspace override carries the saved source')
  equal(packagedDoctrine(pkg), original, 'the packaged doctrine is untouched while bundled is false')
  equal(readFileSync(join(REAL_PACKAGE, 'defaults', 'orchestrator.md'), 'utf8'), realOriginal, 'the real doctrine is never written')
  const after = await orchestrator.readOrchestrator({ config, root: ws })
  equal(after.orchestrator.configured, true, 'the workspace override is configured after the save')
  equal(after.orchestrator.bundled, false, 'the workspace override is not bundled')
})
