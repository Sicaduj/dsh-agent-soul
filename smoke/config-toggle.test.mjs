/**
 * Regression tests for the "Use Default Agent Souls" configuration toggle's Host
 * contract: the shared GET/POST /agent-soul/config endpoint that reads and
 * persists config.bundledEditable through the Host configEditor service.
 *
 * Every case copies lib/, agents/, defaults/, index.js, and package.json into a
 * throwaway temporary package and imports lib/gui-host.js through its own file
 * URL, so the module graph (and any packaged-path constant it computes) resolves
 * inside the copy and the real package is never written. The routes are called
 * directly with fake req/res objects, a fake configEditor service, and a fake
 * connection trust fence; no server, profile, credential, or network is used.
 *
 * Covered behavior:
 * - createGuiRoutes returns 15 endpoints over 11 distinct exact paths, including
 *   the GET+POST /agent-soul/config pair;
 * - GET reports the effective bundledEditable flag, the bundled flag, and
 *   configurable=true only when the configEditor service and the plugin's own
 *   Loader row (options.id "agent-soul-team") are both available;
 * - POST requires a JSON object with a boolean bundledEditable, refuses a
 *   disabled packaged catalog (409 bundled-disabled), refuses an unavailable
 *   editor or plugin row (409 not-configurable), reports a failed editor write
 *   as 409 overridden, and answers a successful write with the applied config;
 * - a successful POST calls editor.edit(entry, change) exactly once with the
 *   plugin row entry, and change(current) preserves every other config key while
 *   replacing bundledEditable (the profile-patch shallow-replacement guard);
 * - the connection trust fence rejects with 401/403 before any route work, and a
 *   composition without a fence fails closed with 403.
 *
 * The client half is also covered from the real client.js artifact loaded in a
 * fake module loader: the plugins.row.config contribution uses the exact bundle
 * key and locale namespace, all eight dictionaries carry the twelve new toggle
 * keys (the English title and switch/card label are asserted exactly), the old
 * infoBundled copy is gone, and the switch reads, writes, and polls
 * agent-soul/config while the Settings card shares the same control hook.
 *
 * Run with: node --test smoke/config-toggle.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The real package root, used only as the copy source. */
const REAL_PACKAGE = fileURLToPath(new URL('..', import.meta.url))

/** The shared configuration route. */
const ROUTE_PATH = '/agent-soul/config'

/** The Loader row id the route edits (and the browser key's suffix). */
const PLUGIN_ROW_ID = 'agent-soul-team'

/** Every exact path createGuiRoutes must expose after P3. */
const EXPECTED_PATHS = Object.freeze([
  '/agent-soul/config',
  '/agent-soul/create',
  '/agent-soul/delete',
  '/agent-soul/document',
  '/agent-soul/duplicate',
  '/agent-soul/orchestrator',
  '/agent-soul/overview',
  '/agent-soul/parse',
  '/agent-soul/preferences',
  '/agent-soul/preview',
  '/agent-soul/restore',
])

/** Normalized config with the packaged catalog enabled and in-place mode off. */
const CONFIG = Object.freeze({
  dirs: ['.dsh/agents'],
  bundled: true,
  bundledEditable: false,
  bindingsFile: '.dsh/agent-soul/bindings.json',
  freshProvider: 'spawn',
  forkProvider: 'spawn',
  claimTeamToolRow: false,
})

/** Normalized config with in-place editing on. */
const EDITABLE_CONFIG = Object.freeze({ ...CONFIG, bundledEditable: true })

/** Normalized config with the packaged catalog disabled (the flag is inert). */
const DISABLED_CONFIG = Object.freeze({ ...CONFIG, bundled: false, bundledEditable: true })

/** Incremented by every assertion helper, so the run reports an exact count. */
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

/**
 * Create one isolated fixture: a canonical temporary package copy plus a
 * canonical workspace root (the config route itself is profile-wide, so the
 * workspace only keeps the fixture shape identical to the other GUI tests).
 *
 * @param {string} label - fixture label used in both temporary names.
 * @param {object} t - node:test context used for cleanup.
 * @returns {{ pkg: string, ws: string }}
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
  return { pkg, ws }
}

/** Import the copied GUI host. */
function loadGui(pkg) {
  return import(pathToFileURL(join(pkg, 'lib', 'gui-host.js')).href)
}

/** One Loader row entry as the Host config editor lists it. */
function pluginRow(config = CONFIG) {
  return {
    options: { id: PLUGIN_ROW_ID, config: { ...config } },
    meta: 'agent-soul-plugin-row',
  }
}

/** One unrelated Loader row. */
function otherRow() {
  return { options: { id: 'another-plugin', config: { enabled: true } }, meta: 'other-row' }
}

/**
 * A fake Host configEditor service.
 *
 * @param {object[]} rows - rows returned by entries().
 * @param {{ editThrow?: string, withoutEdit?: boolean, entriesThrow?: boolean }} [options]
 * @returns {{ editor: object, calls: { entry: object, change: (current: unknown) => object }[] }}
 */
function fakeConfigEditor(rows, options = {}) {
  const calls = []
  const editor = {
    entries() {
      if (options.entriesThrow === true) throw new Error('cannot list configuration entries')
      return rows
    },
    async edit(entry, change) {
      calls.push({ entry, change })
      if (options.editThrow !== undefined) throw new Error(options.editThrow)
      return {}
    },
  }
  if (options.withoutEdit === true) delete editor.edit
  return { editor, calls }
}

/** GUI route dependencies with an optional configEditor and trust fence. */
function guiDeps(ws, options = {}) {
  const logger = { warn() {}, info() {}, debug() {}, error() {} }
  const ctx = {
    get(name) {
      if (options.getThrows === true) throw new Error('service lookup failed')
      return name === 'configEditor' ? options.editor : undefined
    },
    agents: { list: () => [] },
  }
  if (options.withoutConnection !== true) {
    ctx.connection = { requestRejection: options.fence ?? (() => undefined) }
  }
  return {
    ctx,
    config: options.config ?? CONFIG,
    catalog: { refresh: async () => [] },
    bindings: {},
    logger,
    root: ws,
    resolveModel: async () => undefined,
  }
}

/**
 * One fake HTTP request. A string payload is sent verbatim (for malformed-body
 * cases); any other value is JSON-encoded. An undefined payload sends no body.
 */
function request(method, payload, options = {}) {
  const contentType = options.contentType ?? 'application/json'
  const chunks = payload === undefined
    ? []
    : [Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))]
  return {
    method,
    url: ROUTE_PATH,
    headers: payload === undefined ? {} : { 'content-type': contentType },
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

/** Find the route descriptor for one method on the config path. */
function configRoute(routes, method) {
  return routes.find(route => route.method === method && route.path === ROUTE_PATH)
}

/** Build the routes and return the config GET/POST descriptors. */
function routesOf(gui, ws, options = {}) {
  const routes = gui.createGuiRoutes(guiDeps(ws, options))
  return { routes, get: configRoute(routes, 'GET'), post: configRoute(routes, 'POST') }
}

// The tally is internal bookkeeping; enable it when measuring the suite size.
if (process.env.AGENT_SOUL_ASSERTION_TALLY === '1') {
  process.once('exit', () => {
    console.log('config-toggle smoke assertions: ' + tally.assertions)
  })
}

test('createGuiRoutes exposes 15 endpoints over 11 exact paths including the config pair', async t => {
  const { pkg, ws } = fixture('routes', t)
  const gui = await loadGui(pkg)
  const { routes } = routesOf(gui, ws, { editor: fakeConfigEditor([pluginRow()]).editor })

  equal(routes.length, 15, 'createGuiRoutes returns the P3 endpoint count')
  equal(new Set(routes.map(route => route.path)).size, 11, 'the endpoints share 11 distinct exact paths')
  deepEqual(
    [...new Set(routes.map(route => route.path))].sort(),
    [...EXPECTED_PATHS].sort(),
    'the exact path set includes the config route and every earlier endpoint',
  )
  equal(new Set(routes.map(route => route.method + ' ' + route.path)).size, 15, 'no method/path pair is duplicated')
  equal(routes.every(route => route.kind === 'exact'), true, 'every endpoint is registered as an exact path')
  const configRoutes = routes.filter(route => route.path === ROUTE_PATH)
  equal(configRoutes.length, 2, 'the config path carries exactly two method descriptors')
  deepEqual(configRoutes.map(route => route.method).sort(), ['GET', 'POST'], 'the config path supports GET and POST')
  ok(configRoutes.every(route => typeof route.handler === 'function'), 'both config descriptors carry a handler')
})

test('GET /agent-soul/config reports effective flags and real configurability', async t => {
  const { pkg, ws } = fixture('get', t)
  const gui = await loadGui(pkg)

  const editableEditor = fakeConfigEditor([otherRow(), pluginRow(EDITABLE_CONFIG)]).editor
  const editable = routesOf(gui, ws, { config: EDITABLE_CONFIG, editor: editableEditor }).get
  const first = jsonResponse()
  await editable.handler(request('GET'), first.res)
  equal(first.res.status, 200, 'the editable config is readable')
  equal(first.json().ok, true, 'the read reports ok')
  equal(first.json().config.bundledEditable, true, 'the effective in-place flag is reported')
  equal(first.json().config.bundled, true, 'the packaged-catalog flag is reported')
  equal(first.json().config.configurable, true, 'the toggle is configurable when the service and row exist')

  const readOnly = routesOf(gui, ws, { config: CONFIG, editor: fakeConfigEditor([pluginRow(CONFIG)]).editor }).get
  const readOnlyRead = jsonResponse()
  await readOnly.handler(request('GET'), readOnlyRead.res)
  equal(readOnlyRead.json().config.bundledEditable, false, 'the effective flag is false when in-place editing is off')

  const disabled = routesOf(gui, ws, {
    config: DISABLED_CONFIG,
    editor: fakeConfigEditor([pluginRow(DISABLED_CONFIG)]).editor,
  }).get
  const disabledRead = jsonResponse()
  await disabled.handler(request('GET'), disabledRead.res)
  equal(disabledRead.json().config.bundled, false, 'a disabled packaged catalog is reported')
  equal(disabledRead.json().config.bundledEditable, false, 'the inert flag reads as false while bundled is false')

  const withoutService = routesOf(gui, ws, { config: EDITABLE_CONFIG }).get
  const noServiceRead = jsonResponse()
  await withoutService.handler(request('GET'), noServiceRead.res)
  equal(noServiceRead.json().config.configurable, false, 'a missing configEditor service is not configurable')
  equal(noServiceRead.json().config.bundledEditable, true, 'the effective flag is still reported without the service')

  const withoutRow = routesOf(gui, ws, { editor: fakeConfigEditor([otherRow()]).editor }).get
  const noRowRead = jsonResponse()
  await withoutRow.handler(request('GET'), noRowRead.res)
  equal(noRowRead.json().config.configurable, false, 'a missing plugin row is not configurable')

  const entriesThrow = routesOf(gui, ws, {
    editor: fakeConfigEditor([], { entriesThrow: true }).editor,
  }).get
  const entriesRead = jsonResponse()
  await entriesThrow.handler(request('GET'), entriesRead.res)
  equal(entriesRead.json().config.configurable, false, 'a failing entries() call is not configurable')

  const getThrows = routesOf(gui, ws, { getThrows: true }).get
  const lookupRead = jsonResponse()
  await getThrows.handler(request('GET'), lookupRead.res)
  equal(lookupRead.json().config.configurable, false, 'a failing service lookup is not configurable')

  const wrongMethod = jsonResponse()
  await editable.handler(request('POST', {}), wrongMethod.res)
  equal(wrongMethod.res.status, 405, 'the GET handler answers a POST with 405')
  equal(wrongMethod.res.headers.allow, 'GET', 'the 405 advertises the GET method')
})

test('POST /agent-soul/config persists bundledEditable through the plugin row', async t => {
  const { pkg, ws } = fixture('post', t)
  const gui = await loadGui(pkg)
  const row = pluginRow(CONFIG)
  const { editor, calls } = fakeConfigEditor([otherRow(), row])
  const { post } = routesOf(gui, ws, { config: CONFIG, editor })

  const current = {
    dirs: ['.dsh/agents'],
    bundled: true,
    bundledEditable: false,
    commandPrefix: '',
    claimTeamToolRow: false,
    freshProvider: 'spawn',
    forkProvider: 'spawn',
    custom: { keep: true },
  }
  const enabled = jsonResponse()
  await post.handler(request('POST', { bundledEditable: true }, { contentType: 'application/json; charset=utf-8' }), enabled.res)
  equal(enabled.res.status, 200, 'a valid toggle POST succeeds')
  equal(enabled.json().ok, true, 'the write reports ok')
  equal(enabled.json().config.bundledEditable, true, 'the applied flag is echoed')
  equal(enabled.json().config.bundled, true, 'the response keeps the packaged-catalog flag')
  equal(enabled.json().config.configurable, true, 'the response reports the row as configurable')
  equal(calls.length, 1, 'editor.edit is called exactly once')
  equal(calls[0].entry, row, 'editor.edit receives the plugin row entry itself')

  const changed = calls[0].change(current)
  deepEqual(changed, { ...current, bundledEditable: true }, 'change() replaces only bundledEditable and preserves every other key')
  equal(current.bundledEditable, false, 'change() does not mutate the caller current config')
  equal(changed.custom, current.custom, 'untouched nested values keep their identity')
  deepEqual(calls[0].change(undefined), { bundledEditable: true }, 'change() tolerates a missing current config')

  const editableRow = pluginRow(EDITABLE_CONFIG)
  const secondEditor = fakeConfigEditor([editableRow])
  const second = routesOf(gui, ws, { config: EDITABLE_CONFIG, editor: secondEditor.editor }).post
  const off = jsonResponse()
  await second.handler(request('POST', { bundledEditable: false }), off.res)
  equal(off.res.status, 200, 'toggling the flag off succeeds')
  equal(off.json().config.bundledEditable, false, 'the disabled flag is echoed')
  equal(secondEditor.calls.length, 1, 'the off toggle still calls editor.edit once')
  deepEqual(
    secondEditor.calls[0].change({ ...CONFIG, bundledEditable: true }),
    { ...CONFIG, bundledEditable: false },
    'the off toggle also preserves the complete config',
  )
})

test('POST /agent-soul/config validates its body, mode, service, row, and write result', async t => {
  const { pkg, ws } = fixture('validation', t)
  const gui = await loadGui(pkg)

  async function postWith(options, payload, requestOptions = {}) {
    const { post } = routesOf(gui, ws, options)
    const response = jsonResponse()
    await post.handler(request('POST', payload, requestOptions), response.res)
    return response
  }

  const validEditor = fakeConfigEditor([pluginRow()])
  const malformed = await postWith({ editor: validEditor.editor }, '{')
  equal(malformed.res.status, 400, 'malformed JSON is 400')
  equal(malformed.json().code, 'invalid-request', 'malformed JSON carries invalid-request')
  equal(validEditor.calls.length, 0, 'a malformed body never reaches the editor')

  const wrongType = await postWith({ editor: fakeConfigEditor([pluginRow()]).editor }, { bundledEditable: true }, { contentType: 'text/plain' })
  equal(wrongType.res.status, 400, 'a non-JSON content type is 400')
  equal(wrongType.json().code, 'invalid-request', 'a non-JSON content type carries invalid-request')

  const arrayBody = await postWith({ editor: fakeConfigEditor([pluginRow()]).editor }, [true])
  equal(arrayBody.res.status, 400, 'a non-object JSON body is 400')

  const missing = await postWith({ editor: fakeConfigEditor([pluginRow()]).editor }, {})
  equal(missing.res.status, 400, 'a missing bundledEditable is 400')
  equal(missing.json().message, 'bundledEditable must be a boolean', 'the missing-field message is explicit')

  const stringBody = await postWith({ editor: fakeConfigEditor([pluginRow()]).editor }, { bundledEditable: 'true' })
  equal(stringBody.res.status, 400, 'a string bundledEditable is 400')
  equal(stringBody.json().code, 'invalid-request', 'a string bundledEditable carries invalid-request')
  const numberBody = await postWith({ editor: fakeConfigEditor([pluginRow()]).editor }, { bundledEditable: 1 })
  equal(numberBody.res.status, 400, 'a numeric bundledEditable is 400')
  equal(numberBody.json().code, 'invalid-request', 'a numeric bundledEditable carries invalid-request')
  const nullBody = await postWith({ editor: fakeConfigEditor([pluginRow()]).editor }, { bundledEditable: null })
  equal(nullBody.res.status, 400, 'a null bundledEditable is 400')
  equal(nullBody.json().code, 'invalid-request', 'a null bundledEditable carries invalid-request')

  const disabledEditor = fakeConfigEditor([pluginRow(DISABLED_CONFIG)])
  const disabled = await postWith({ config: DISABLED_CONFIG, editor: disabledEditor.editor }, { bundledEditable: true })
  equal(disabled.res.status, 409, 'a disabled packaged catalog is 409')
  equal(disabled.json().code, 'bundled-disabled', 'the disabled catalog reports bundled-disabled')
  ok(disabled.json().message.includes('bundled=true'), 'the disabled-catalog message explains the prerequisite')
  equal(disabledEditor.calls.length, 0, 'a disabled packaged catalog never reaches the editor')

  const noService = await postWith({ config: EDITABLE_CONFIG }, { bundledEditable: true })
  equal(noService.res.status, 409, 'a missing configEditor service is 409')
  equal(noService.json().code, 'not-configurable', 'a missing service reports not-configurable')

  const noRowEditor = fakeConfigEditor([otherRow()])
  const noRow = await postWith({ config: EDITABLE_CONFIG, editor: noRowEditor.editor }, { bundledEditable: true })
  equal(noRow.res.status, 409, 'a missing plugin row is 409')
  equal(noRow.json().code, 'not-configurable', 'a missing plugin row reports not-configurable')
  ok(noRow.json().message.includes(PLUGIN_ROW_ID), 'the missing-row message names the expected row id')
  equal(noRowEditor.calls.length, 0, 'a missing plugin row never calls editor.edit')

  const noEdit = await postWith({ config: EDITABLE_CONFIG, editor: fakeConfigEditor([pluginRow()], { withoutEdit: true }).editor }, { bundledEditable: true })
  equal(noEdit.res.status, 409, 'a service without edit() is 409')
  equal(noEdit.json().code, 'not-configurable', 'a service without edit() reports not-configurable')

  const throwingEditor = fakeConfigEditor([pluginRow()], { editThrow: 'the row was overridden by a profile patch' })
  const overridden = await postWith({ config: EDITABLE_CONFIG, editor: throwingEditor.editor }, { bundledEditable: true })
  equal(overridden.res.status, 409, 'a failed editor write is 409')
  equal(overridden.json().code, 'overridden', 'a failed editor write reports overridden')
  ok(overridden.json().message.includes('profile patch'), 'the overridden message preserves the editor error')
  equal(throwingEditor.calls.length, 1, 'the failed write still attempted the editor once')

  const lookupThrows = await postWith({ getThrows: true }, { bundledEditable: true })
  equal(lookupThrows.res.status, 409, 'a failing service lookup is 409')
  equal(lookupThrows.json().code, 'not-configurable', 'a failing service lookup reports not-configurable')

  const { post } = routesOf(gui, ws, { editor: fakeConfigEditor([pluginRow()]).editor })
  const wrongMethod = jsonResponse()
  await post.handler(request('GET'), wrongMethod.res)
  equal(wrongMethod.res.status, 405, 'the POST handler answers a GET with 405')
  equal(wrongMethod.res.headers.allow, 'POST', 'the 405 advertises the POST method')
})

test('the connection trust fence rejects both config methods and fails closed without one', async t => {
  const { pkg, ws } = fixture('fence', t)
  const gui = await loadGui(pkg)

  const unauthorized = routesOf(gui, ws, {
    editor: fakeConfigEditor([pluginRow()]).editor,
    fence: () => 401,
  })
  const get401 = jsonResponse()
  await unauthorized.get.handler(request('GET'), get401.res)
  equal(get401.res.status, 401, 'GET is rejected with 401 by the trust fence')
  const post401 = jsonResponse()
  await unauthorized.post.handler(request('POST', { bundledEditable: true }), post401.res)
  equal(post401.res.status, 401, 'POST is rejected with 401 by the trust fence')

  const forbidden = routesOf(gui, ws, {
    editor: fakeConfigEditor([pluginRow()]).editor,
    fence: () => 403,
  })
  const get403 = jsonResponse()
  await forbidden.get.handler(request('GET'), get403.res)
  equal(get403.res.status, 403, 'GET is rejected with 403 by the trust fence')
  const post403 = jsonResponse()
  await forbidden.post.handler(request('POST', { bundledEditable: true }), post403.res)
  equal(post403.res.status, 403, 'POST is rejected with 403 by the trust fence')

  const noConnection = guiDeps(ws, {
    editor: fakeConfigEditor([pluginRow()]).editor,
    withoutConnection: true,
  })
  const post = configRoute(gui.createGuiRoutes(noConnection), 'POST')
  const closed = jsonResponse()
  await post.handler(request('POST', { bundledEditable: true }), closed.res)
  equal(closed.res.status, 403, 'a composition without the trust fence fails closed with 403')
})

/** The twelve locale keys the packaged-defaults toggle contributes. */
const TOGGLE_LOCALE_KEYS = Object.freeze([
  'pageTitle',
  'pageDescription',
  'toggleLabel',
  'cardLabel',
  'summary',
  'statusOn',
  'statusOff',
  'statusUnavailable',
  'statusNotConfigurable',
  'statusApplying',
  'statusApplied',
  'statusError',
])

/** Cached client artifact evidence (the file is read and evaluated once). */
let clientArtifactCache = null

/**
 * Load the real client.js classic artifact in a fake module loader and capture
 * its locale dictionaries plus everything apply() registers.
 *
 * The factory is invoked with a minimal React double: only the component
 * definitions run here, so hooks never execute and no DOM is required. This is
 * static contract evidence, not a rendered-browser test.
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
  // Only React.createElement is evaluated at factory time; hooks run when a
  // component renders, which this static artifact test never does.
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

test('client registers the plugins.row.config contribution with the exact key and locale', () => {
  const { source, state } = clientArtifact()

  equal(state.namespace, 'settings.agentSoul', 'the client registers its dictionaries under the page namespace')
  equal(state.injected.includes('plugins.row.config'), true, 'apply() injects the plugins.row.config slot')
  equal(
    source.includes("ctx.slots.inject('plugins.row.config'"),
    true,
    'the contribution is registered through ctx.slots.inject',
  )
  const registration = state.registrations.find(entry => entry.descriptor.name === 'plugins.row.config')
  ok(registration !== undefined, 'the plugins.row.config contribution is registered')
  equal(registration.descriptor.name, 'plugins.row.config', 'the slot name is exactly plugins.row.config')
  equal(registration.descriptor.key, '@local/dsh-agent-soul#agent-soul-team', 'the contribution is keyed by package name and row id')
  equal(registration.descriptor.locale, 'settings.agentSoul', 'the contribution uses the page locale namespace')
  equal(typeof registration.component, 'function', 'the contribution registers a component')
  equal(
    state.registrations.some(entry => entry.descriptor.name === 'settings.section'),
    true,
    'the existing Settings section contribution is still registered',
  )
  equal(
    state.registrations.some(entry => entry.descriptor.name === 'conversation.session.header.actions'),
    true,
    'the existing session-header badge contribution is still registered',
  )
})

test('client dictionaries carry the toggle copy in all eight locales', () => {
  const { source, state } = clientArtifact()
  const dictionaries = state.dictionaries

  deepEqual(
    Object.keys(dictionaries).sort(),
    ['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'],
    'all eight dictionaries are registered',
  )
  const en = dictionaries.en
  equal(en.pageTitle, 'Use Default Agent Souls', 'the English row-page title is exact')
  equal(en.toggleLabel, 'Use default agent souls', 'the English switch label is exact')
  equal(en.cardLabel, 'Use default agent souls', 'the English settings-card label is exact')
  for (const locale of Object.keys(dictionaries).sort()) {
    const dictionary = dictionaries[locale]
    equal(
      TOGGLE_LOCALE_KEYS.every(key => typeof dictionary[key] === 'string' && dictionary[key].trim() !== ''),
      true,
      locale + ' has all twelve non-empty toggle keys',
    )
  }
  const referenceKeys = Object.keys(en).sort()
  for (const locale of Object.keys(dictionaries).sort()) {
    deepEqual(Object.keys(dictionaries[locale]).sort(), referenceKeys, locale + ' declares the same key set as en')
  }
  deepEqual(
    Object.keys(en).filter(key => key.startsWith('infoBundled')),
    [],
    'the old infoBundled keys are gone from the English dictionary',
  )
  equal(
    Object.values(dictionaries).some(dictionary => Object.values(dictionary).includes('Bundled defaults')),
    false,
    'the old Bundled defaults copy is gone from every dictionary',
  )
  equal(source.includes('infoBundled'), false, 'client.js no longer mentions any infoBundled key')
  equal(source.includes('Bundled defaults'), false, 'client.js no longer contains the old Bundled defaults copy')
})

test('client toggle reads, writes, and polls agent-soul/config and shares one control', () => {
  const { source } = clientArtifact()

  equal(source.includes("const CONFIG_ROUTE = 'agent-soul/config'"), true, 'the toggle addresses agent-soul/config')
  equal(
    source.split("await fetch(CONFIG_ROUTE, { headers: { accept: 'application/json' } })").length - 1,
    2,
    'both the mount read and the poll read the config route with GET',
  )
  ok(
    /React\.useEffect\(function \(\) \{\s*alive\.current = true\s*void load\(\)/u.test(source),
    'the mount effect loads the config',
  )
  ok(
    /await fetch\(CONFIG_ROUTE, \{\s*method: 'POST',\s*headers: \{ 'content-type': 'application\/json' \},\s*body: JSON\.stringify\(\{ bundledEditable: next === true \}\),\s*\}\)/u.test(source),
    'the toggle POSTs JSON with the requested boolean',
  )
  ok(
    /setPhase\('applying'\)\s*poll\(next === true, 1\)/u.test(source),
    'a successful write starts the poll with the requested value',
  )
  equal(source.includes('poll(requested, attempt + 1)'), true, 'the poll retries until the reload is observed')
  equal(source.includes('timer.current = setTimeout('), true, 'the poll is timer-driven and cleared on unmount')
  ok(/const CONFIG_POLL_INTERVAL_MS = \d+/u.test(source), 'the poll cadence is a named constant')
  ok(/const CONFIG_POLL_ATTEMPTS = \d+/u.test(source), 'the poll attempt bound is a named constant')
  equal(
    source.includes('if (config === null || config.bundled === false || !config.configurable) return'),
    true,
    'the toggle refuses writes the Host reported as unavailable',
  )
  equal(
    source.includes("infoRow(t('cardLabel'), h(DefaultSoulsCardControl, { t: t }))"),
    true,
    'the Settings card row renders the shared control',
  )
  equal(
    source.split('const control = useDefaultSoulsConfig(t)').length - 1,
    2,
    'the Plugins row page and the Settings card share one control hook',
  )
  equal(source.split("t('toggleLabel')").length - 1, 2, 'both controls use the switch label')
  equal(source.split("t('pageTitle')").length - 1, 2, 'the row page uses the page title for its label and heading')
  equal(source.includes("props.view === 'summary'"), true, 'the row contribution supports the summary view')
  equal(source.includes("return t('summary')"), true, 'the summary view uses the localized summary copy')
})
