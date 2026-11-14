/**
 * Regression tests for the portable bash<->pwsh shell alias.
 *
 * An Agent Soul document is platform-neutral, so its `tools:` list may name
 * the shell tool by either model-facing spelling. DSH registers only one of
 * them per session (`bash` on POSIX compositions, `pwsh` on Windows), so the
 * plugin resolves a declared name to the registered one. These cases pin every
 * layer that resolves or validates the declaration against the real modules:
 *
 * - the frozen resolver in lib/tool-names.js (exact match wins, only the shell
 *   pair aliases, request order and dedupe);
 * - spawn validation in lib/spawn.js (a bash declaration is accepted on a
 *   pwsh-only session while typos, Team tools, and Lead-only tools still fail);
 * - the per-teammate permission matrix in lib/apply.js (the final
 *   `restrict({ allow })` carries the resolved name, never the absent spelling);
 * - the Orchestrator enable path in lib/orchestrator.js (the doctrine's tools
 *   list is probed and applied through the same resolver, and only genuinely
 *   unresolved names warn);
 * - the GUI overview catalog and save validator in lib/gui-host.js (the
 *   missing counterpart is advertised with `portableAliasOf` and both
 *   spellings validate, while a session with neither still rejects the name).
 *
 * Every fixture is deterministic and local: fake Agent/tool services, a
 * scripted doctrine document, and an isolated workspace under the OS temporary
 * directory for the GUI routes. No real Host, profile, model, or network is
 * involved.
 *
 * Run with: node --test smoke/windows-shell-alias.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { applyTeammateSoul, createPendingSpawns } from '../lib/apply.js'
import { createGuiRoutes } from '../lib/gui-host.js'
import { createOrchestratorRuntime, installOrchestratorCommand } from '../lib/orchestrator.js'
import { spawnTeamMember } from '../lib/spawn.js'
import { resolveRestrictableNames, resolveToolName, shellCounterpart, toolNameKnown } from '../lib/tool-names.js'

/** Create one disposable directory under the OS temporary directory. */
function tempDir(t, label) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `agent-soul-shell-alias-${label}-`)))
  t.after(() => {
    assert.equal(dirname(dir), realpathSync(tmpdir()), 'cleanup only removes the fixture under the OS temp directory')
    assert.ok(dir.includes(`agent-soul-shell-alias-${label}-`), 'cleanup only removes this fixture')
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

/** Return the rejection message of one action, failing when it does not reject. */
async function rejectionOf(action) {
  let observed
  try {
    await action()
  } catch (error) {
    observed = error
  }
  assert.ok(observed instanceof Error, 'the action must reject')
  return observed
}

/** Collect the warnings one fixture logs. */
function warningSink() {
  const warnings = []
  return { warnings, logger: { warn: message => warnings.push(String(message)) } }
}

// ---------------------------------------------------------------------------
// a) resolveToolName / toolNameKnown
// ---------------------------------------------------------------------------

test('an exact shell registration always wins', () => {
  assert.equal(resolveToolName('bash', ['bash', 'pwsh']), 'bash', 'bash stays bash when both spellings exist')
  assert.equal(resolveToolName('pwsh', ['bash', 'pwsh']), 'pwsh', 'pwsh stays pwsh when both spellings exist')
  assert.equal(resolveToolName('read', ['read', 'bash']), 'read', 'a non-shell name resolves to itself')
  assert.equal(toolNameKnown('read', ['read', 'bash']), true)
  assert.equal(toolNameKnown('read', ['bash', 'pwsh']), false, 'a non-shell name is not known just because a shell is')
  assert.equal(shellCounterpart('read'), undefined, 'non-shell names have no counterpart')
  assert.equal(shellCounterpart('bash'), 'pwsh')
  assert.equal(shellCounterpart('pwsh'), 'bash')
})

test('a missing shell spelling resolves to its registered counterpart only', () => {
  assert.equal(resolveToolName('bash', ['pwsh', 'read']), 'pwsh', 'bash resolves to the live pwsh tool')
  assert.equal(resolveToolName('pwsh', ['bash', 'read']), 'bash', 'pwsh resolves to the live bash tool')
  assert.equal(toolNameKnown('bash', ['pwsh']), true)
  assert.equal(toolNameKnown('pwsh', ['bash']), true)
  assert.equal(resolveToolName('bash', ['read', 'grep']), undefined, 'no shell registered means no substitution')
  assert.equal(resolveToolName('bash', new Set(['pwsh'])), 'pwsh', 'a Set availability catalog works too')
  assert.equal(resolveToolName('Bash', ['pwsh']), undefined, 'the resolver is case-sensitive')
})

// ---------------------------------------------------------------------------
// b) resolveRestrictableNames
// ---------------------------------------------------------------------------

test('resolveRestrictableNames keeps request order and resolves both directions', () => {
  const live = new Set(['read', 'bash'])
  const same = resolveRestrictableNames(['read', 'bash'], name => live.has(name))
  assert.deepEqual(same.names, ['read', 'bash'], 'resolved names keep the request order')
  assert.deepEqual(same.substituted, [])
  assert.deepEqual(same.skipped, [])

  const livePwsh = new Set(['pwsh', 'read'])
  const forward = resolveRestrictableNames(['bash', 'read'], name => livePwsh.has(name))
  assert.deepEqual(forward.names, ['pwsh', 'read'], 'bash resolves to the registered pwsh tool')
  assert.deepEqual(forward.substituted, ['bash'])
  assert.deepEqual(forward.skipped, [])

  const liveBash = new Set(['bash', 'read'])
  const reverse = resolveRestrictableNames(['pwsh', 'read'], name => liveBash.has(name))
  assert.deepEqual(reverse.names, ['bash', 'read'], 'pwsh resolves to the registered bash tool')
  assert.deepEqual(reverse.substituted, ['pwsh'])
  assert.deepEqual(reverse.skipped, [])
})

test('resolveRestrictableNames dedupes both spellings and reports every unresolved request', () => {
  const live = new Set(['pwsh', 'read'])
  const probe = name => live.has(name)
  const deduped = resolveRestrictableNames(['pwsh', 'bash', 'read'], probe)
  assert.deepEqual(deduped.names, ['pwsh', 'read'], 'both spellings collapse to the one live name')
  assert.equal(deduped.names.filter(name => name === 'pwsh').length, 1)
  assert.deepEqual(deduped.substituted, ['bash'], 'only the substituted request is reported')
  assert.deepEqual(deduped.skipped, [])

  const unresolved = resolveRestrictableNames(['bash', 'invented-tool', '', 'read'], probe)
  assert.deepEqual(unresolved.names, ['pwsh', 'read'])
  assert.deepEqual(unresolved.substituted, ['bash'])
  assert.deepEqual(unresolved.skipped, ['invented-tool', ''], 'unresolved and blank requests are skipped')

  const none = resolveRestrictableNames([], probe)
  assert.deepEqual(none, { names: [], substituted: [], skipped: [] }, 'an empty request resolves to an empty list')
})

// ---------------------------------------------------------------------------
// c) spawn validation (lib/spawn.js via the real spawnTeamMember)
// ---------------------------------------------------------------------------

/** The SoulSnapshot shape spawnTeamMember's catalog refresh returns. */
function catalogSnapshot(soul) {
  return {
    scannedAt: 0,
    definitions: [soul],
    byName: new Map([[soul.name, soul]]),
    diagnostics: [],
    dirs: ['/workspace/.dsh/agents'],
  }
}

/**
 * Build one spawn harness: a fake catalog, tools service, Team service, and
 * binding store around the real spawnTeamMember.
 * @param {{ live: string[], tools: string[] }} options
 */
function spawnHarness({ live, tools }) {
  const { warnings, logger } = warningSink()
  const spawnCalls = []
  const bindingWrites = []
  const lead = { id: 'lead-1', session: { header: {} } }
  const soul = {
    name: 'probe',
    description: 'Probe the portable shell alias.',
    persona: 'PROBE PERSONA',
    tools,
    model: undefined,
    context: 'fresh',
    sourceLabel: 'workspace',
  }
  const subagents = {
    rootOf: agent => agent === lead ? lead : agent,
    namesOf: agent => ({ self: agent === lead ? 'lead' : String(agent.id) }),
    getProvider: () => ({ name: 'spawn' }),
    resolveMaxDepth: () => 1,
    startActivation: async spec => {
      spawnCalls.push(spec)
      return { childId: 'child-1', name: spec.name }
    },
  }
  const deps = {
    config: { freshProvider: 'spawn', forkProvider: 'spawn', defaultContext: 'fresh' },
    rootOf: () => '/workspace',
    logger,
    catalog: { refresh: async () => catalogSnapshot(soul) },
    pending: createPendingSpawns(),
    pendingKey: (root, name) => `${root?.id ?? root}\u0000${name}`,
    bindings: { set: async (...args) => { bindingWrites.push(args) } },
    resolveModel: async () => undefined,
    ctx: {
      get(service) {
        if (service === 'tools') return { definitions: () => live.map(name => ({ name, description: `${name} probe description` })) }
        if (service === 'subagents') return subagents
        if (service === 'agentTeams') return { isEnabled: () => true }
        return undefined
      },
    },
  }
  return { deps, warnings, spawnCalls, bindingWrites, lead }
}

/** Spawn one probe teammate through the real orchestration entry point. */
function spawnProbe(harness) {
  return spawnTeamMember(harness.deps, harness.lead, {
    name: 'probe-1',
    description: 'Probe the soul runtime.',
    prompt: 'Report your tool matrix.',
    agentType: 'probe',
  })
}

test('spawn validation accepts a bash declaration on a pwsh-only session', async () => {
  const harness = spawnHarness({ live: ['pwsh', 'read', 'grep', 'glob'], tools: ['bash', 'read', 'grep', 'glob'] })
  const spawned = await spawnProbe(harness)

  assert.equal(spawned.member.id, 'child-1', 'the teammate spawned')
  assert.equal(spawned.soul.name, 'probe')
  assert.deepEqual(spawned.soul.tools, ['bash', 'read', 'grep', 'glob'],
    'the resolved soul keeps the portable declaration for the child apply step')
  assert.equal(harness.spawnCalls.length, 1)
  assert.deepEqual(harness.spawnCalls[0].prompt, [{ type: 'text', text: 'Report your tool matrix.' }])
  assert.equal(harness.spawnCalls[0].provider, 'spawn', 'the fresh provider is used')
  assert.equal(harness.spawnCalls[0].delivery, 'parent', 'the child result returns to the Lead')
  assert.equal(harness.spawnCalls[0].maxDepth, 1, 'the composition depth cap is forwarded')
  assert.equal(harness.bindingWrites.length, 1, 'the durable binding was written')
  assert.deepEqual(harness.bindingWrites[0][2].tools, ['bash', 'read', 'grep', 'glob'],
    'the durable plan records the declared spelling, not the resolved one')
  assert.equal(harness.deps.pending.size, 0, 'the pending handoff was consumed')
  assert.deepEqual(harness.warnings, [])
})

test('spawn validation still rejects unknown, Team, and Lead-only tools', async () => {
  const unknown = spawnHarness({ live: ['pwsh', 'read', 'glob', 'grep'], tools: ['bash', 'invented-tool'] })
  const unknownError = await rejectionOf(() => spawnProbe(unknown))
  assert.match(unknownError.message, /soul "probe" has an invalid tools list/)
  assert.match(unknownError.message, /"invented-tool" is not a tool visible in this session/)
  assert.match(unknownError.message, /Restrictable tools: glob, grep, pwsh, read/,
    'the refusal recommends the live catalog, which carries the shell counterpart')
  assert.equal(unknown.spawnCalls.length, 0, 'an invalid soul never reaches the Team service')
  assert.equal(unknown.bindingWrites.length, 0)

  const team = spawnHarness({ live: ['pwsh', 'read', 'send_message'], tools: ['send_message'] })
  const teamError = await rejectionOf(() => spawnProbe(team))
  assert.match(teamError.message, /"send_message" is a Team tool every teammate keeps automatically/)
  assert.equal(team.spawnCalls.length, 0)

  const leadOnly = spawnHarness({ live: ['pwsh', 'manage_agent_souls'], tools: ['manage_agent_souls'] })
  const leadOnlyError = await rejectionOf(() => spawnProbe(leadOnly))
  assert.match(leadOnlyError.message, /"manage_agent_souls" is a Lead-only scoped tool and cannot be delegated to a teammate/)
  assert.equal(leadOnly.spawnCalls.length, 0)
})

// ---------------------------------------------------------------------------
// d) apply path (lib/apply.js applyTeammateSoul)
// ---------------------------------------------------------------------------

/**
 * Build one teammate Agent double whose restrict() throws for an unknown name
 * exactly like the live tools service and records every accepted allow-list.
 * @param {{ live: string[], tools: string[] }} options
 */
function applyHarness({ live, tools }) {
  const state = { restrictions: [], sections: [], warnings: [] }
  const known = new Set(live)
  const agent = {
    id: 'child-1',
    session: { header: { cwd: '/workspace' } },
    ctx: {
      tools: {
        restrict(request) {
          const allow = Array.isArray(request?.allow) ? [...request.allow] : []
          const unknown = allow.filter(name => !known.has(name))
          if (unknown.length > 0) throw new Error(`cannot restrict unknown tool(s): ${unknown.join(', ')}`)
          state.restrictions.push(allow)
          return () => {}
        },
        definitions() {
          return [...known].map(name => ({ name, description: `${name} probe description` }))
        },
      },
      systemPrompt: {
        section(registration) {
          state.sections.push({ ...registration })
          return () => {}
        },
        getSectionOrder() { return 10 },
      },
      effect(callback) {
        const cleanup = callback()
        return () => { if (typeof cleanup === 'function') cleanup() }
      },
    },
  }
  const { warnings, logger } = warningSink()
  state.warnings = warnings
  const pending = createPendingSpawns()
  const deps = {
    pending,
    pendingKey: (root, name) => `${root}\u0000${name}`,
    rootOf: () => '/workspace',
    bindings: { set: async () => {}, get: async () => undefined },
    logger,
  }
  const membership = { role: 'teammate', name: 'probe', root: '/workspace' }
  const plan = {
    name: 'probe',
    persona: 'APPLIED PERSONA',
    tools,
    model: null,
    context: 'fresh',
    sourceLabel: 'workspace',
  }
  pending.set(deps.pendingKey(membership.root, membership.name), plan)
  return { agent, deps, membership, state }
}

/** The final permission matrix one applyHarness recorded. */
function finalAllow(state) {
  return state.restrictions.at(-1)
}

test('apply resolves a missing shell spelling in both directions', async () => {
  const forward = applyHarness({ live: ['pwsh', 'read'], tools: ['bash', 'read'] })
  const applied = await applyTeammateSoul(forward.agent, forward.membership, forward.deps)
  assert.equal(applied.soulName, 'probe')
  assert.deepEqual(finalAllow(forward.state), ['pwsh', 'read'],
    'the final restriction names the registered pwsh tool, not the declared bash')
  assert.deepEqual(forward.state.warnings, [], 'a substituted name is not a warning')
  assert.deepEqual(forward.state.sections.map(section => section.text), ['APPLIED PERSONA'],
    'the soul persona is still registered')

  const reverse = applyHarness({ live: ['bash', 'read'], tools: ['pwsh', 'read'] })
  await applyTeammateSoul(reverse.agent, reverse.membership, reverse.deps)
  assert.deepEqual(finalAllow(reverse.state), ['bash', 'read'],
    'the reverse direction resolves pwsh to the registered bash tool')
  assert.deepEqual(reverse.state.warnings, [])
})

test('apply dedupes both shell spellings to the one live name', async () => {
  const run = applyHarness({ live: ['pwsh', 'read'], tools: ['pwsh', 'bash', 'read'] })
  await applyTeammateSoul(run.agent, run.membership, run.deps)
  assert.deepEqual(finalAllow(run.state), ['pwsh', 'read'],
    'the live name appears once even when the soul declared both spellings')
  assert.equal(finalAllow(run.state).filter(name => name === 'pwsh').length, 1)
  assert.deepEqual(run.state.warnings, [])
})

test('apply warns only about genuinely unresolved tools', async () => {
  const run = applyHarness({ live: ['pwsh', 'read'], tools: ['bash', 'read', 'invented-tool'] })
  await applyTeammateSoul(run.agent, run.membership, run.deps)
  assert.deepEqual(finalAllow(run.state), ['pwsh', 'read'])
  assert.equal(run.state.warnings.length, 1, 'only the unresolved name warns')
  assert.match(run.state.warnings[0], /invented-tool/)
  assert.doesNotMatch(run.state.warnings[0], /\bbash\b/,
    'the substituted shell name is never reported as non-restrictable')
})

// ---------------------------------------------------------------------------
// e) Orchestrator probe (lib/orchestrator.js enable path)
// ---------------------------------------------------------------------------

/** A workspace-relative orchestrator document, beside the default bindings file. */
const ORCHESTRATOR_DOCTRINE = join('.dsh', 'agent-soul', 'orchestrator.md')

/** The normalized plugin config the orchestrator runtime reads. */
const ORCHESTRATOR_CONFIG = Object.freeze({
  dirs: ['.dsh/agents'],
  bundled: true,
  bundledEditable: false,
  bindingsFile: '.dsh/agent-soul/bindings.json',
  freshProvider: 'spawn',
  forkProvider: 'spawn',
})

/** Write one valid doctrine whose frontmatter declares the given tools. */
function writeDoctrine(root, { tools, marker }) {
  const file = join(root, ORCHESTRATOR_DOCTRINE)
  mkdirSync(dirname(file), { recursive: true })
  const lines = ['---', 'name: shell-alias-conductor', 'gate-mode: strict', 'max-retries: 3', 'tools:']
  for (const tool of tools) lines.push(`  - ${tool}`)
  lines.push('---', '', '## Identity & Boundaries', '', marker, '')
  writeFileSync(file, lines.join('\n'))
}

/**
 * Build the real orchestrator runtime and command handler over one fake Lead
 * whose tools service throws for an unknown restrict name.
 * @param {{ root: string, live: string[] }} options
 */
function orchestratorHarness({ root, live }) {
  const { warnings, logger } = warningSink()
  const known = new Set(live)
  const state = { restrictions: [], sections: [], model: { provider: 'test-provider', model: 'base-model' }, events: [], queued: [], teamEnabled: false }
  const agent = {
    id: 'fake-lead',
    session: {
      get seq() { return state.events.length - 1 },
      eventAt(index) { return state.events[index] },
    },
    followup(message) { state.queued.push(message) },
    model: {
      current() { return { ...state.model } },
      select(selection) { state.model = { ...selection } },
    },
    ctx: {
      systemPrompt: {
        section(registration) {
          state.sections.push({ ...registration })
          return { dispose() {} }
        },
        context(registration) {
          state.sections.push({ ...registration })
          return { dispose() {} }
        },
        getSectionOrder() { return 10 },
      },
      tools: {
        restrict(request) {
          const allow = Array.isArray(request?.allow) ? [...request.allow] : []
          const unknown = allow.filter(name => !known.has(name))
          if (unknown.length > 0) throw new Error(`cannot restrict unknown tool(s): ${unknown.join(', ')}`)
          state.restrictions.push(allow)
          return { dispose() {} }
        },
        definitions() {
          return [...known].map(name => ({ name, description: `${name} probe description` }))
        },
      },
      effect(callback) {
        const cleanup = callback()
        return () => { if (typeof cleanup === 'function') cleanup() }
      },
    },
  }
  const deps = {
    config: ORCHESTRATOR_CONFIG,
    rootOf: () => root,
    logger,
    handlerTails: new WeakMap(),
    teamModeOf: () => state.teamEnabled,
    async setTeamMode(_agent, enabled) { state.teamEnabled = enabled === true },
  }
  const runtime = createOrchestratorRuntime(deps)
  let definition
  const installed = installOrchestratorCommand(agent, {
    commands: { register(value) { definition = value; return { dispose() {} } } },
  }, deps, runtime)
  return {
    agent,
    runtime,
    state,
    warnings,
    installed,
    invoke: (rawInput, commandId) => definition.handler({ agent, rawInput, commandId }),
  }
}

test('orchestrator enable resolves a doctrine bash declaration to the live pwsh tool', async t => {
  const root = tempDir(t, 'orchestrator-bash')
  writeDoctrine(root, { tools: ['bash', 'read', 'invented-tool'], marker: 'ORCH-ALIAS-DOCTRINE' })
  const run = orchestratorHarness({ root, live: ['pwsh', 'read'] })

  const result = await run.invoke('', 'cmd-1')

  assert.equal(result.kind, 'success', String(result.text))
  assert.equal(run.runtime.isActive(run.agent), true, 'orchestrator mode is live')
  assert.deepEqual(finalAllow(run.state), ['pwsh', 'read'],
    'the applied restriction names the registered pwsh tool and the exact read tool')
  assert.equal(run.state.sections.some(section => (typeof section.text === 'function'
    ? String(section.text({}))
    : String(section.text)).includes('ORCH-ALIAS-DOCTRINE')), true,
    'the doctrine section is installed')
  const skipWarnings = run.warnings.filter(message => message.includes('non-restrictable tool(s) stay visible'))
  assert.equal(skipWarnings.length, 1, 'one skip warning is logged')
  assert.match(skipWarnings[0], /invented-tool/)
  assert.doesNotMatch(skipWarnings[0], /\bbash\b/,
    'the substituted shell name is not reported as non-restrictable')
  run.installed.dispose()
})

test('orchestrator enable resolves a doctrine pwsh declaration to the live bash tool', async t => {
  const root = tempDir(t, 'orchestrator-pwsh')
  writeDoctrine(root, { tools: ['pwsh', 'read'], marker: 'ORCH-ALIAS-REVERSE' })
  const run = orchestratorHarness({ root, live: ['bash', 'read'] })

  const result = await run.invoke('', 'cmd-1')

  assert.equal(result.kind, 'success', String(result.text))
  assert.deepEqual(finalAllow(run.state), ['bash', 'read'])
  assert.deepEqual(run.warnings.filter(message => message.includes('non-restrictable tool(s) stay visible')), [],
    'a fully resolved tools list logs no skip warning')
  run.installed.dispose()
})

// ---------------------------------------------------------------------------
// f) GUI catalog + save validator (lib/gui-host.js)
// ---------------------------------------------------------------------------

/** The normalized plugin config the GUI routes read. */
const GUI_CONFIG = Object.freeze({
  dirs: ['.dsh/agents'],
  bundled: true,
  bundledEditable: false,
  bindingsFile: '.dsh/agent-soul/bindings.json',
  freshProvider: 'spawn',
  forkProvider: 'spawn',
})

/** One role section is enough to compose a valid soul document. */
const SOUL_SECTIONS = Object.freeze({ role: 'Portable shell alias probe role.' })

/** Build one isolated workspace with the configured soul directory. */
function guiWorkspace(t, label) {
  const root = tempDir(t, `gui-${label}`)
  mkdirSync(join(root, '.dsh', 'agents'), { recursive: true })
  return root
}

/**
 * GUI route dependencies whose live tools catalog advertises exactly the given
 * names through a fake Lead and tools service.
 */
function guiDeps(root, live) {
  const lead = { id: 'lead-1', session: { header: {} } }
  const definitions = live.map(name => ({ name, description: `${name} probe description` }))
  const subagents = {
    rootOf: agent => lead,
    namesOf: agent => ({ self: agent === lead ? 'lead' : String(agent.id) }),
    listDescendants: async () => [],
  }
  const agentTeams = { isEnabled: () => true }
  return {
    ctx: {
      get(service) {
        if (service === 'tools') return { definitions: () => definitions }
        if (service === 'subagents') return subagents
        if (service === 'agentTeams') return agentTeams
        return undefined
      },
      agents: { list: () => [lead] },
      agentTeams,
      connection: { requestRejection: () => undefined },
    },
    config: GUI_CONFIG,
    catalog: { refresh: async () => ({ scannedAt: Date.now(), definitions: [], diagnostics: [] }) },
    bindings: {},
    logger: { warn() {}, info() {}, debug() {}, error() {} },
    root,
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

/** One capturing response: status and the JSON body text. */
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

/** One draft soul with the given tools text. */
function soulFields(name, tools) {
  return { name, description: 'Portable shell alias probe soul.', tools }
}

/** Read the overview's tool catalog for one live name set. */
async function catalogOf(root, live) {
  const routes = createGuiRoutes(guiDeps(root, live))
  const route = routeOf(routes, 'GET', '/agent-soul/overview')
  assert.ok(route !== undefined, 'the overview route is registered')
  const response = jsonResponse()
  await route.handler(request('GET', '/agent-soul/overview'), response.res)
  assert.equal(response.res.status, 200, 'the overview route answers')
  return response.json().catalogs
}

/** Preview one draft through the real no-write preview route. */
async function previewOf(root, live, name, tools) {
  const routes = createGuiRoutes(guiDeps(root, live))
  const route = routeOf(routes, 'POST', '/agent-soul/preview')
  assert.ok(route !== undefined, 'the preview route is registered')
  const response = jsonResponse()
  await route.handler(request('POST', '/agent-soul/preview', {
    fields: soulFields(name, tools),
    sections: SOUL_SECTIONS,
  }), response.res)
  assert.equal(response.res.status, 200, 'preview answers 200 even for invalid content')
  return response.json()
}

/** Save one draft through the real document POST route. */
async function saveOf(root, live, name, tools) {
  const routes = createGuiRoutes(guiDeps(root, live))
  const route = routeOf(routes, 'POST', '/agent-soul/document')
  assert.ok(route !== undefined, 'the document POST route is registered')
  const response = jsonResponse()
  await route.handler(request('POST', '/agent-soul/document', {
    fields: soulFields(name, tools),
    sections: SOUL_SECTIONS,
  }), response.res)
  return { status: response.res.status, body: response.json(), file: join(root, '.dsh', 'agents', `${name}.md`) }
}

test('a bash-only live catalog advertises pwsh and validates either spelling', async t => {
  const root = guiWorkspace(t, 'bash')
  const catalogs = await catalogOf(root, ['bash', 'read'])

  assert.equal(catalogs.source, 'live-lead')
  assert.deepEqual(catalogs.tools.map(tool => tool.name).sort(), ['bash', 'pwsh', 'read'],
    'the catalog advertises the missing shell counterpart')
  const bashEntry = catalogs.tools.find(tool => tool.name === 'bash')
  assert.equal(Object.hasOwn(bashEntry, 'portableAliasOf'), false, 'the live tool is not marked as an alias')
  assert.deepEqual(catalogs.tools.find(tool => tool.name === 'pwsh'), {
    name: 'pwsh',
    description: 'Portable shell alias: this session registers its shell as "bash"; naming "pwsh" resolves to it.',
    portableAliasOf: 'bash',
  })

  const pwshDraft = await previewOf(root, ['bash', 'read'], 'probe-pwsh', 'pwsh')
  assert.equal(pwshDraft.valid, true, 'a draft naming pwsh validates on a bash-only session')
  assert.equal(pwshDraft.fieldErrors.tools, undefined)
  const bashDraft = await previewOf(root, ['bash', 'read'], 'probe-bash', 'bash')
  assert.equal(bashDraft.valid, true, 'the live spelling still validates')
})

test('a pwsh-only live catalog advertises bash, validates it, and saves it', async t => {
  const root = guiWorkspace(t, 'pwsh')
  const catalogs = await catalogOf(root, ['pwsh', 'read'])

  assert.deepEqual(catalogs.tools.map(tool => tool.name).sort(), ['bash', 'pwsh', 'read'])
  assert.deepEqual(catalogs.tools.find(tool => tool.name === 'bash'), {
    name: 'bash',
    description: 'Portable shell alias: this session registers its shell as "pwsh"; naming "bash" resolves to it.',
    portableAliasOf: 'pwsh',
  })
  const pwshDraft = await previewOf(root, ['pwsh', 'read'], 'probe-pwsh-exact', 'pwsh')
  assert.equal(pwshDraft.valid, true, 'the live spelling validates')
  const bashDraft = await previewOf(root, ['pwsh', 'read'], 'probe-bash-alias', 'bash')
  assert.equal(bashDraft.valid, true, 'the counterpart spelling validates')

  const saved = await saveOf(root, ['pwsh', 'read'], 'probe-bash-saved', 'bash')
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  assert.equal(saved.body.ok, true)
  assert.equal(existsSync(saved.file), true, 'the save with the counterpart spelling writes the document')
})

test('a live catalog with neither shell spelling still rejects bash', async t => {
  const root = guiWorkspace(t, 'neither')
  const catalogs = await catalogOf(root, ['read'])

  assert.deepEqual(catalogs.tools.map(tool => tool.name), ['read'],
    'no synthetic shell alias is added when the session registers no shell tool')
  const rejected = await previewOf(root, ['read'], 'probe-rejected', 'bash')
  assert.equal(rejected.valid, false, 'bash stays unknown when the session registers neither spelling')
  assert.match(String(rejected.fieldErrors.tools), /"bash" is not a tool visible in this session/)
  assert.match(String(rejected.fieldErrors.tools), /restrictable tools: read/)

  const unknown = await previewOf(root, ['read'], 'probe-unknown', 'invented-tool')
  assert.equal(unknown.valid, false, 'a non-shell unknown name is still rejected')
  assert.match(String(unknown.fieldErrors.tools), /"invented-tool" is not a tool visible in this session/)

  const refused = await saveOf(root, ['read'], 'probe-refused', 'bash')
  assert.equal(refused.status, 400, 'the save is refused with 400')
  assert.equal(refused.body.code, 'invalid')
  assert.equal(existsSync(refused.file), false, 'the refused save writes no file')
})
