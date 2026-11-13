/**
 * Regression tests for the GUI-02 review defects (D01, D07, D08, D09, D12,
 * D13, D16) fixed in client.js and lib/gui-host.js.
 *
 * Two kinds of evidence are used deliberately:
 *
 * - The real lib/gui-host.js is loaded from a throwaway package copy through its
 *   own file URL and its routes are called directly with fake req/res objects
 *   and fake Host services. This exercises the catalog/validator fix (D12) and
 *   pins the overview payload contract the client validates (D13) without a
 *   server, a profile, a browser, or any write to this package.
 * - The real client.js classic artifact is evaluated in a fake module loader
 *   exactly like smoke/config-toggle.test.mjs. Its registered dictionaries are
 *   inspected as data (D16) and its source is checked for the fixed contracts
 *   (D01 draft/root guards, D07 raw-draft persistence, D08 shared toggle state
 *   and dependent-view invalidation, D09 poll terminal states, D13 overview
 *   validation). No component is rendered: this is static artifact evidence,
 *   not a rendered-browser test.
 *
 * Every assertion names the defect it protects, so a regression fails with the
 * defect context instead of a bare string mismatch.
 *
 * Run with: node --test smoke/gui-fixes.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The real package root, used only as the copy source and artifact source. */
const REAL_PACKAGE = fileURLToPath(new URL('..', import.meta.url))

/** Route paths this suite calls. */
const ROUTE_PATHS = Object.freeze({
  document: '/agent-soul/document',
  overview: '/agent-soul/overview',
  preview: '/agent-soul/preview',
})

/** Normalized config with the packaged catalog enabled and in-place mode off. */
const CONFIG = Object.freeze({
  dirs: ['.dsh/agents'],
  bundled: true,
  bundledEditable: false,
  bindingsFile: '.dsh/agent-soul/bindings.json',
  freshProvider: 'spawn',
  forkProvider: 'spawn',
})

/** The eight locales the plugin registers, in the order the artifact declares them. */
const LOCALES = Object.freeze(['en', 'zh', 'ja', 'de', 'fr', 'es', 'ru', 'pt'])

/**
 * D16: every in-page search placeholder must describe the metadata the search
 * actually reads (name, description, source path, file name) instead of a bare
 * "source" that reads like a Markdown-body search.
 */
const SEARCH_PLACEHOLDERS = Object.freeze({
  en: 'Search name, description, source path or file name',
  zh: '按名称、描述、来源路径或文件名搜索',
  ja: '名前、説明、ソースパス、ファイル名を検索',
  de: 'Name, Beschreibung, Quellpfad oder Dateiname durchsuchen',
  fr: 'Rechercher par nom, description, chemin de source ou nom de fichier',
  es: 'Buscar por nombre, descripción, ruta de origen o nombre de archivo',
  ru: 'Искать по имени, описанию, пути источника или имени файла',
  pt: 'Pesquisar nome, descrição, caminho de origem ou nome de arquivo',
})

/** Incremented by every assertion helper, so the run can report an exact count. */
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

// The tally is internal bookkeeping; enable it when measuring the suite size.
if (process.env.AGENT_SOUL_ASSERTION_TALLY === '1') {
  process.once('exit', () => {
    console.log('gui-fixes smoke assertions: ' + tally.assertions)
  })
}

/**
 * Create one isolated fixture: a canonical temporary package copy plus a
 * canonical workspace root with the configured soul directory.
 *
 * @param {string} label - fixture label used in both temporary names.
 * @param {object} t - node:test context used for cleanup.
 * @returns {{ pkg: string, ws: string, agents: string }}
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
  const agents = join(ws, '.dsh', 'agents')
  mkdirSync(agents, { recursive: true })
  t.after(() => {
    for (const dir of [pkg, ws]) {
      assert.equal(dirname(dir), realpathSync(tmpdir()), 'cleanup only removes the fixture under the OS temp directory')
      assert.ok(dir.includes('agent-soul-' + label + '-'), 'cleanup only removes this fixture')
      rmSync(dir, { recursive: true, force: true })
    }
  })
  return { pkg, ws, agents }
}

/** Import the copied GUI host. */
function loadGui(pkg) {
  return import(pathToFileURL(join(pkg, 'lib', 'gui-host.js')).href)
}

/**
 * GUI route dependencies.
 *
 * `tools` is the fake Host tools service: when present (live Lead) the GUI
 * reports catalogs.source "live-lead"; when absent the catalog source is "none".
 *
 * @param {string} ws - workspace root.
 * @param {{ tools?: object, withLead?: boolean, definitions?: object[] }} [options]
 * @returns {object}
 */
function guiDeps(ws, options = {}) {
  const withLead = options.withLead === true
  const lead = { id: 'lead-1', session: { header: {} } }
  const subagents = {
    rootOf: agent => lead,
    namesOf: agent => ({ self: agent === lead ? 'lead' : String(agent.id) }),
    listDescendants: async () => [],
  }
  const agentTeams = { isEnabled: () => true }
  const ctx = {
    get(name) {
      if (name === 'tools') return options.tools
      if (name === 'subagents') return subagents
      if (name === 'agentTeams') return agentTeams
      return undefined
    },
    agents: { list: () => (withLead ? [lead] : []) },
    agentTeams,
    connection: options.connection ?? { requestRejection: () => undefined },
  }
  return {
    ctx,
    config: CONFIG,
    catalog: {
      refresh: async () => ({
        scannedAt: Date.now(),
        definitions: Array.isArray(options.definitions) ? options.definitions : [],
        diagnostics: [],
      }),
    },
    bindings: {},
    logger: { warn() {}, info() {}, debug() {}, error() {} },
    root: ws,
    resolveModel: async () => undefined,
  }
}

/** One fake HTTP request for a route path; any defined payload is JSON-encoded. */
function request(method, path, payload) {
  const chunks = payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]
  return {
    method,
    url: path,
    headers: payload === undefined ? {} : { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
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

/** Find the one route descriptor for a method/path pair. */
function routeOf(routes, method, path) {
  return routes.find(route => route.method === method && route.path === path)
}

/** A minimal valid editable soul body for the preview/save routes. */
function soulFields(name, tools) {
  return { name, description: 'probe soul', tools }
}

/** One role section is enough to compose a valid document. */
const SOUL_SECTIONS = Object.freeze({ role: 'Role text for the GUI-02 probe.' })

/** The live catalog with a Lead but no restrictable tools. */
function emptyLiveCatalog() {
  return { definitions: () => [] }
}

/** The live catalog advertising exactly one named tool. */
function liveCatalogWith(name) {
  return { definitions: () => [{ name, description: 'an advertised tool' }] }
}

/** Cached client artifact evidence (the file is read and evaluated once). */
let clientArtifactCache = null

/**
 * Load the real client.js classic artifact in a fake module loader and capture
 * its source, its locale dictionaries, and everything apply() registers.
 *
 * The factory is invoked with a minimal React double: only the component
 * definitions run here, so hooks never execute and no DOM is required.
 *
 * @returns {{ source: string, state: { injected: string[], registrations: object[],
 *   namespace: string, dictionaries: object } }}
 */
function clientArtifact() {
  if (clientArtifactCache !== null) return clientArtifactCache
  const source = readFileSync(join(REAL_PACKAGE, 'client.js'), 'utf8')
  let definition
  const window = { __ModuleLoader__: { load(value) { definition = value } } }
  new Function('window', source)(window)
  ok(definition !== undefined, 'client.js registers a module definition')
  equal(definition.id, '@local/dsh-agent-soul', 'the client module keeps its package id')
  const React = { createElement() { return null } }
  const clientModule = definition.factory(name => {
    if (name === 'react') return React
    throw new Error('unexpected client require: ' + name)
  })
  const state = { injected: [], registrations: [], namespace: '', dictionaries: null }
  clientModule.apply({
    effect(callback) { return callback() },
    locale: {
      register(namespace, dictionaries) {
        state.namespace = namespace
        state.dictionaries = dictionaries
        return () => {}
      },
      bind: () => key => key,
    },
    slots: {
      inject(name, callback) {
        state.injected.push(name)
        return callback()
      },
      register(descriptor, component) {
        state.registrations.push({ descriptor, component })
        return () => {}
      },
    },
  })
  clientArtifactCache = { source, state }
  return clientArtifactCache
}

/**
 * Return the artifact source from one declaration to the end of the file.
 *
 * The fixed code under test is checked by the literal expressions it must (or
 * must not) contain; scanning from the declaration keeps those checks inside
 * the owning helper instead of matching an unrelated part of the page.
 */
function functionSource(source, declaration) {
  const start = source.indexOf(declaration)
  if (start === -1) return null
  return source.slice(start)
}

test('D16: all eight search placeholders name metadata, source path, or file name', () => {
  const { source, state } = clientArtifact()
  const dictionaries = state.dictionaries

  deepEqual(Object.keys(dictionaries).sort(), [...LOCALES].sort(), 'the artifact registers exactly its eight dictionaries')
  const referenceKeys = Object.keys(dictionaries.en).sort()
  for (const locale of LOCALES) {
    const dictionary = dictionaries[locale]
    deepEqual(Object.keys(dictionary).sort(), referenceKeys, locale + ' declares exactly the English key set')
    equal(dictionary.searchPlaceholder, SEARCH_PLACEHOLDERS[locale], locale + ' describes the searched metadata or path')
    ok(typeof dictionary.searchLabel === 'string' && dictionary.searchLabel.trim() !== '',
      locale + ' keeps a non-empty accessible search label')
    equal(/[{}]/u.test(dictionary.searchPlaceholder), false,
      locale + ' search placeholder carries no unresolved placeholder token')
    ok(typeof dictionary.errorCodeInvalidResponse === 'string' && dictionary.errorCodeInvalidResponse.trim() !== '',
      locale + ' localizes the invalid-response error code')
    ok(typeof dictionary.statusUnverified === 'string' && dictionary.statusUnverified.trim() !== '',
      locale + ' localizes the unverified-apply status')
  }
  for (const locale of LOCALES) {
    if (locale === 'en') continue
    equal(SEARCH_PLACEHOLDERS[locale] === SEARCH_PLACEHOLDERS.en, false, locale + ' placeholder is translated, not copied')
  }

  // The placeholder must match what the filter reads: metadata only.
  const haystack = source.match(/const haystack = \[([\s\S]*?)\]\.filter/um)
  ok(haystack !== null, 'the in-page search builds one haystack array')
  for (const part of ['document.name', 'document.description', 'document.sourcePath', 'document.label', 'document.file']) {
    equal(haystack[1].includes(part), true, 'the search haystack reads ' + part)
  }
  equal(/document\.source\b/u.test(haystack[1]), false, 'the search does not read the Markdown source as a whole')
  equal(/document\.(body|fields|sections)\b/u.test(haystack[1]), false, 'the search does not read the Markdown body')
})

test('D07: raw drafts persist and restore their source, mode, and base hash', () => {
  const { source } = clientArtifact()

  const read = functionSource(source, 'function readStoredDraft(file)')
  ok(read !== null, 'readStoredDraft exists')
  ok(read.includes("typeof parsed.rawSource === 'string'"), 'the stored raw source is type-checked before use')
  ok(read.includes("mode: parsed.mode === 'raw' && rawSource !== null ? 'raw' : 'form'"),
    'raw mode is restored only with the source it applies to')
  ok(read.includes("const baseHash = typeof parsed.baseHash === 'string' && parsed.baseHash !== '' ? parsed.baseHash : null"),
    'the stored base hash is validated as a non-empty string or null')
  ok(read.includes('baseHash: baseHash,'), 'the restored draft carries the base hash')
  ok(read.includes('Array.isArray(parsed.fields)') && read.includes('Array.isArray(parsed.sections)'),
    'malformed field/section containers still yield no draft (backward-safe validation)')

  const write = functionSource(source, 'function writeStoredDraft(file, draft)')
  ok(write !== null, 'writeStoredDraft exists')
  ok(write.includes("mode: draft.mode === 'raw' ? 'raw' : 'form'"), 'the draft mode is persisted')
  ok(write.includes("rawSource: typeof draft.rawSource === 'string' ? draft.rawSource : null"),
    'the raw source is persisted when present')
  ok(write.includes("baseHash: typeof draft.baseHash === 'string' ? draft.baseHash : null"),
    'the base hash is persisted when present')

  equal(source.includes("if (busyLocked || mode !== 'form') return undefined"), false,
    'raw mode no longer skips draft persistence')
  ok(source.includes('const rawDirty = mode === \'raw\' && rawSource !== baselineSource'),
    'the debounced persist effect tracks a raw-only edit as dirty')
  ok(source.includes('rawSource: rawDirty ? rawSource : null'), 'a dirty raw source is written with the draft')
  ok(source.includes("baseHash: typeof draft.hash === 'string' ? draft.hash : null"),
    'the persisted draft records the file hash it was based on')
  ok(source.includes('}, [draft, baseline, mode, rawSource, baselineSource, busyLocked])'),
    'the persist effect reruns when the raw source changes')

  ok(source.includes("const storedRawDirty = stored !== null && typeof stored.rawSource === 'string'"),
    'opening a document compares the stored raw source with the loaded source')
  ok(source.includes('&& (storedSnapshot !== nextBaseline || storedRawDirty)'),
    'a raw-only draft is offered even when the form snapshot is unchanged')
  ok(source.includes("if (offer.mode === 'raw' && typeof offer.rawSource === 'string')"),
    'restoring a raw draft switches the editor to raw mode')
  ok(source.includes('setRawSource(offer.rawSource)'), 'restoring a raw draft restores the edit text')
})

test('D08: one shared toggle state, and a settled toggle invalidates dependent views', () => {
  const { source } = clientArtifact()

  ok(source.includes('const configState = {'), 'the toggle state lives in one module-level record')
  ok(source.includes('function subscribeConfigState(listener)'), 'mounted controls subscribe to the shared record')
  ok(source.includes('const config = configState.block'), 'the switch reads its value from the shared record')
  ok(source.includes('const phase = configState.phase'), 'the switch reads its lifecycle from the shared record')
  equal(source.includes("const [phase, setPhase] = React.useState('loading')"), false,
    'no control keeps a private phase that can disagree with the other control')
  equal(source.split('const control = useDefaultSoulsConfig(t)').length - 1, 2,
    'both mounted controls (Settings card and Plugins row page) use the shared hook')

  ok(source.includes('function subscribeConfigSettled(listener)'), 'the page can subscribe to settled writes')
  ok(source.includes('void refreshAfterConfigChange()'), 'a settled write triggers the dependent-view refresh')
  ok(source.includes('if (orchestratorRef.current !== null && !orchestratorDirtyRef.current) await loadOrchestrator()'),
    'the config refresh never opens an unread orchestrator and never overwrites a dirty draft')
  ok(source.includes("if (dirtyRef.current || busyRef.current !== '') return"),
    'the quiet document refresh never races a dirty draft or an in-flight operation')
  ok(source.includes('await openDocument(file, { quiet: true })'),
    'the open document is re-read without flashing status or stealing the busy lock')
  ok(source.includes("if (quiet && (selectedRef.current !== file || dirtyRef.current || busyRef.current !== '')) return false"),
    'a background read is dropped when an edit, another document, or a save started after it')
  ok(source.includes('notifyConfigSettled({ verified: true, bundledEditable: requested })'),
    'a verified write notifies the page')
  ok(source.includes('notifyConfigSettled({ verified: false, bundledEditable: requested })'),
    'an unverified write still invalidates the page state')
})

test('D09: polling never reports Applied without a read that shows the written value', () => {
  const { source } = clientArtifact()

  equal(source.includes('matched || attempt >= CONFIG_POLL_ATTEMPTS'), false,
    'exhaustion no longer shares the success branch')
  ok(source.includes('if (matched) {'), 'a matching read is its own success branch')
  ok(/if \(matched\) \{[\s\S]{0,300}?phase: 'applied'/u.test(source),
    'only the matching branch reports applied')
  ok(/if \(attempt >= CONFIG_POLL_ATTEMPTS\) \{[\s\S]{0,500}?phase: 'unknown'/u.test(source),
    'exhausted polling ends in the unknown state, never applied')
  ok(source.includes("else if (phase === 'unknown') status = t('statusUnverified')"),
    'the unknown state has its own honest status copy')
  ok(source.includes("error: phase === 'error' || phase === 'unknown'"),
    'an unverified apply is visibly flagged, not shown as success')
  ok(source.includes("configStateSet({ writeActive: false, phase: 'unknown' })"),
    'a control that unmounts mid-write leaves an honest unknown state')
  ok(source.includes('poll(requested, attempt + 1)'), 'polling still retries until the bound')
  // A read failure is caught per attempt and can never be mistaken for a match.
  ok(source.includes('block = null\n            matched = false'), 'a failed poll read clears both block and match')
})

test('D01: a Session-root change cannot reload a dirty Orchestrator draft', () => {
  const { source } = clientArtifact()

  ok(source.includes('}, [activeTab, loadOrchestrator])'),
    'the Orchestrator load depends on the tab only, not on the Session root')
  equal(source.includes('}, [activeTab, loadOrchestrator, sessionRoot])'), false,
    'a Session-root change no longer re-runs the Orchestrator load')
  ok(source.includes("if (sessionRoot === '' || workspaceRootSourceRef.current !== 'pending') return undefined"),
    'the Session root is adopted once, only while the root is still unpinned')
  equal(source.includes("if (sessionRoot !== '' && workspaceRootSourceRef.current === 'pending')"),
    false, 'the old unconditional overview reload on every Session-root change is gone')
  ok(source.includes('}, [loadOverview])'), 'the initial catalog read is mount-scoped')
  const pinEffect = source.match(
    /React\.useEffect\(function \(\) \{\n        if \(sessionRoot === '' \|\| workspaceRootSourceRef\.current !== 'pending'\) return undefined[\s\S]*?\}, \[loadOverview, loadOrchestrator, sessionRoot\]\)/u)
  ok(pinEffect !== null, 'the pending-association effect is the only Session-root reader')
  ok(pinEffect[0].includes('void loadOverview()'), 'adopting the association reads the catalog for that root exactly once')
  ok(pinEffect[0].includes('if (orchestratorRef.current !== null && !orchestratorDirtyRef.current) void loadOrchestrator()'),
    'a stale definition is re-read for the adopted root, but never while its draft is dirty')
})

test('D13: a malformed overview answer becomes a typed error, never an empty catalog', () => {
  const { source } = clientArtifact()

  ok(source.includes('function overviewPayloadFailure(payload)'), 'the overview payload has one shape validator')
  for (const block of ['!Array.isArray(payload.documents)', "payload.plugin === null || typeof payload.plugin !== 'object'",
    "payload.settings === null || typeof payload.settings !== 'object'", "payload.runtime === null || typeof payload.runtime !== 'object'"]) {
    ok(source.includes(block), 'the validator requires ' + block)
  }
  ok(source.includes('const shapeFailure = overviewPayloadFailure(payload)'),
    'the successful read runs the shape validator')
  ok(source.includes('if (shapeFailure !== null) throw shapeFailure'),
    'a malformed 200 answer is thrown into the typed error path')
  ok(source.includes("'invalid-response': 'errorCodeInvalidResponse'"),
    'the typed failure carries a localized headline')
  const shapeAt = source.indexOf('const shapeFailure = overviewPayloadFailure(payload)')
  const adoptAt = source.indexOf('setOverview(payload)')
  ok(shapeAt !== -1 && adoptAt !== -1 && shapeAt < adoptAt,
    'the payload is validated before it replaces the rendered catalog')
  ok(source.includes('if (overview === null && overviewError !== null) return null'),
    'the failed state never falls through to the empty-catalog view')
})

test('D13: the real overview payload carries every block the client validates', async t => {
  const { pkg, ws } = fixture('overview-shape', t)
  const gui = await loadGui(pkg)
  const routes = gui.createGuiRoutes(guiDeps(ws, { withLead: true, tools: emptyLiveCatalog() }))
  const route = routeOf(routes, 'GET', ROUTE_PATHS.overview)
  ok(route !== undefined, 'the overview route is registered')

  const response = jsonResponse()
  await route.handler(request('GET', ROUTE_PATHS.overview), response.res)
  equal(response.res.status, 200, 'the overview route answers')
  const payload = response.json()
  equal(Array.isArray(payload.documents), true, 'partner contract: documents is an array')
  equal(payload.plugin !== null && typeof payload.plugin === 'object', true, 'partner contract: plugin is an object')
  equal(typeof payload.plugin.root, 'string', 'partner contract: plugin.root is a string')
  equal(payload.settings !== null && typeof payload.settings === 'object', true, 'partner contract: settings is an object')
  equal(payload.runtime !== null && typeof payload.runtime === 'object', true, 'partner contract: runtime is an object')
  equal(payload.catalogs !== null && typeof payload.catalogs === 'object', true, 'partner contract: catalogs is an object')
  equal(payload.catalogs.source, 'live-lead', 'the live-but-empty catalog reports its live source')
})

test('D13: the GUI trust fence uses the DSH 0.2.2 connection.admit contract', async t => {
  const { pkg, ws } = fixture('overview-admit', t)
  const gui = await loadGui(pkg)

  const admitted = gui.createGuiRoutes(guiDeps(ws, {
    withLead: true,
    tools: emptyLiveCatalog(),
    connection: { admit: () => ({ peer: {} }), requestRejection: () => 403 },
  }))
  const admittedRoute = routeOf(admitted, 'GET', ROUTE_PATHS.overview)
  const admittedResponse = jsonResponse()
  await admittedRoute.handler(request('GET', ROUTE_PATHS.overview), admittedResponse.res)
  equal(admittedResponse.res.status, 200, 'a connection.admit peer is accepted')

  const refused = gui.createGuiRoutes(guiDeps(ws, {
    withLead: true,
    tools: emptyLiveCatalog(),
    connection: { admit: () => ({ rejection: 403 }), requestRejection: () => undefined },
  }))
  const refusedRoute = routeOf(refused, 'GET', ROUTE_PATHS.overview)
  const refusedResponse = jsonResponse()
  await refusedRoute.handler(request('GET', ROUTE_PATHS.overview), refusedResponse.res)
  equal(refusedResponse.res.status, 403, 'a connection.admit rejection fails closed')
})

test('D12: a live Lead with no restrictable tools rejects an unknown tool in preview', async t => {
  const { pkg, ws } = fixture('d12-preview', t)
  const gui = await loadGui(pkg)

  async function preview(options, name) {
    const routes = gui.createGuiRoutes(guiDeps(ws, options))
    const route = routeOf(routes, 'POST', ROUTE_PATHS.preview)
    ok(route !== undefined, 'the preview route is registered')
    const response = jsonResponse()
    await route.handler(request('POST', ROUTE_PATHS.preview, {
      fields: soulFields(name, 'invented-tool'),
      sections: SOUL_SECTIONS,
    }), response.res)
    equal(response.res.status, 200, 'preview answers 200 even for invalid content')
    return response.json()
  }

  const emptyLive = await preview({ withLead: true, tools: emptyLiveCatalog() }, 'probe-empty-live')
  equal(emptyLive.valid, false, 'an unknown tool with a live-empty catalog is invalid')
  const unknownMessage = emptyLive.fieldErrors.tools
  ok(typeof unknownMessage === 'string' && unknownMessage.includes('invented-tool'),
    'the tools field error names the unknown tool')
  ok(unknownMessage.includes('no restrictable tools'),
    'the empty live catalog explains that the Lead offers no restrictable tools')
  equal(emptyLive.diagnostics.some(item => item.field === 'tools'), true, 'the diagnostic is field-tagged')

  const liveWithTool = await preview({ withLead: true, tools: liveCatalogWith('invented-tool') }, 'probe-live-with-tool')
  equal(liveWithTool.valid, true, 'a name in the live catalog is accepted')
  equal(liveWithTool.fieldErrors.tools, undefined, 'no tools error is reported for an advertised tool')

  const noCatalog = await preview({ withLead: false }, 'probe-no-catalog')
  equal(noCatalog.valid, true, 'a missing catalog source still skips unknown-tool validation')
})

test('D12: saving an unknown tool is refused for a live-but-empty catalog', async t => {
  const { pkg, ws, agents } = fixture('d12-save', t)
  const gui = await loadGui(pkg)

  async function save(options, name) {
    const routes = gui.createGuiRoutes(guiDeps(ws, options))
    const route = routeOf(routes, 'POST', ROUTE_PATHS.document)
    ok(route !== undefined, 'the document POST route is registered')
    const response = jsonResponse()
    await route.handler(request('POST', ROUTE_PATHS.document, {
      fields: soulFields(name, 'invented-tool'),
      sections: SOUL_SECTIONS,
    }), response.res)
    return { response, file: join(agents, name + '.md') }
  }

  const refused = await save({ withLead: true, tools: emptyLiveCatalog() }, 'probe-refused')
  equal(refused.response.res.status, 400, 'the save is refused with 400')
  equal(refused.response.json().code, 'invalid', 'the refusal is the semantic invalid code')
  ok(String(refused.response.json().fieldErrors.tools).includes('no restrictable tools'),
    'the save refusal carries the empty-live-catalog explanation')
  equal(existsSync(refused.file), false, 'the refused save writes no file')

  const accepted = await save({ withLead: true, tools: liveCatalogWith('invented-tool') }, 'probe-accepted')
  equal(accepted.response.res.status, 200, 'an advertised tool saves normally')
  equal(existsSync(accepted.file), true, 'the accepted save writes the file')

  const noCatalog = await save({ withLead: false }, 'probe-no-catalog')
  equal(noCatalog.response.res.status, 200, 'a missing catalog source saves normally')
  equal(existsSync(noCatalog.file), true, 'the unvalidated save writes the file')
})
