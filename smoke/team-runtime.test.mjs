/**
 * Focused contract tests for the DSH 0.2.2 Team adapter, soul surface, spawn
 * activation, soul application, and base-row migration.
 *
 * These cases use real modules with fake Host services; no CLI, profile, model,
 * or filesystem state outside the OS temporary directory is involved.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { applyTeammateSoul, createPendingSpawns, SoulPlanUnavailableError } from '../lib/apply.js'
import { nextTeammateName, spawnTeamMember } from '../lib/spawn.js'
import { countTeamMembers, directChildNames, listTeamMembers, setTeamModeEnabled, teamMemberOf, teamModeEnabled } from '../lib/team.js'
import { inspectBaseTeamRow, restoreBaseTeamRow } from '../lib/team-row.js'
import { ALWAYS_KEPT_TOOL_NAMES } from '../lib/team-tools.js'
import { installSoulSurface, SOUL_ONLY_DENIAL, soulPolicyText } from '../lib/tools.js'

/** A root/child pair with the 0.2.2 services this plugin reads. */
function teamContext({ enabled = true, brokenRootOf = false, brokenNames = false, brokenIsEnabled = false } = {}) {
  const root = { id: 'root-1', status: 'running', session: { header: {} } }
  const child = { id: 'child-1', status: 'inactive', session: { header: { parentSession: 'root-1' } } }
  const calls = []
  const subagents = {
    rootOf(agent) {
      if (brokenRootOf) throw new Error('manager not ready')
      return agent === root ? root : root
    },
    namesOf(agent) {
      if (brokenNames) throw new Error('names not ready')
      return agent === root ? { self: 'lead' } : { self: 'probe-1', parent: 'lead' }
    },
    async listDescendants() { return [] },
    getProvider() { return { name: 'spawn' } },
    resolveMaxDepth() { return 1 },
    async startActivation(spec) { calls.push(spec); return { childId: spec.childId ?? 'child-1', name: spec.name ?? 'probe-1' } },
  }
  const ctx = {
    get(name) {
      if (name === 'subagents') return subagents
      if (name === 'agentTeams') {
        return {
          isEnabled(agent) {
            if (brokenIsEnabled && agent !== root) throw new Error('mode unavailable')
            return enabled
          },
        }
      }
      if (name === 'agents') return { get: id => id === 'root-1' ? root : id === 'child-1' ? child : undefined }
      return undefined
    },
  }
  return { ctx, root, child, calls }
}

test('teamMemberOf maps root and child through rootOf/namesOf', () => {
  const { ctx, root, child } = teamContext()
  const rootMember = teamMemberOf(ctx, root)
  assert.equal(rootMember.role, 'lead')
  assert.equal(rootMember.name, 'lead')
  assert.equal(rootMember.root, root)
  assert.equal(rootMember.enabled, true)
  const childMember = teamMemberOf(ctx, child)
  assert.equal(childMember.role, 'teammate')
  assert.equal(childMember.name, 'probe-1')
  assert.equal(childMember.parent, 'lead')
  assert.equal(childMember.root, root)
  assert.equal(childMember.enabled, true)
})

test('teamMemberOf falls back to the live parent chain when the manager is not ready', () => {
  const { ctx, root, child } = teamContext({ brokenRootOf: true, brokenNames: true, brokenIsEnabled: true })
  const member = teamMemberOf(ctx, child)
  assert.equal(member.role, 'teammate')
  assert.equal(member.name, child.id, 'the child id is the safe fallback while names are unavailable')
  assert.equal(member.root, root)
  assert.equal(member.enabled, true, 'root Team mode is read when the child lookup throws')
})

test('listTeamMembers projects children and diagnostics; countTeamMembers includes continuable members', async () => {
  const { ctx, root } = teamContext()
  const subagents = ctx.get('subagents')
  subagents.listDescendants = async () => [
    { kind: 'child', id: 'child-1', path: 'probe-1', activity: 'inactive', label: 'probe description', mode: 'continuable', parentId: 'root-1', depth: 1 },
    { kind: 'diagnostic', id: 'broken-1', path: 'broken-1', reason: 'corrupt', parentId: 'child-1', depth: 2 },
    { kind: 'child', id: 'once-1', path: 'once-1', activity: 'inactive', label: 'one shot', mode: 'one-shot', parentId: 'root-1', depth: 1 },
  ]
  const rows = await listTeamMembers(ctx, root)
  assert.deepEqual(rows.map(row => [row.name, row.status]), [
    ['lead', 'running'], ['probe-1', 'inactive'], ['broken-1', 'corrupt'], ['once-1', 'inactive'],
  ])
  assert.equal(rows[1].description, 'probe description')
  assert.equal(await countTeamMembers(ctx, root), 2, 'root plus the continuable child')
  assert.deepEqual([...await directChildNames(ctx, root)].sort(), ['once-1', 'probe-1'])
})

test('nextTeammateName avoids catalog collisions and falls back to live children', async () => {
  const { ctx, root, child } = teamContext()
  const subagents = ctx.get('subagents')
  subagents.listDescendants = async () => [
    { kind: 'child', id: 'child-1', path: 'probe', activity: 'inactive', mode: 'continuable', parentId: 'root-1', depth: 1 },
    { kind: 'child', id: 'child-2', path: 'probe-2', activity: 'inactive', mode: 'continuable', parentId: 'root-1', depth: 1 },
  ]
  const deps = { ctx, logger: { warn() {} }, rootOf: () => '/ws' }
  assert.equal(await nextTeammateName(deps, root, 'probe'), 'probe-3')

  subagents.listDescendants = async () => { throw new Error('session query unavailable') }
  ctx.get = name => {
    if (name === 'subagents') return { ...subagents, namesOf: agent => agent === child ? { self: 'probe' } : { self: 'lead' } }
    if (name === 'agentTeams') return { isEnabled: () => true }
    if (name === 'agents') return { list: () => [root, child] }
    return undefined
  }
  // The fallback sees the live child's own name and increments it.
  assert.equal(await nextTeammateName(deps, root, 'probe'), 'probe-2')
})

test('the soul policy shadows the base policy and keeps the task guidance', () => {
  const enabled = soulPolicyText({ role: 'lead' }, true)
  assert.match(enabled, /Delegation is soul-only/)
  assert.match(enabled, /spawn_teammate/)
  assert.match(enabled, /shared task board|Shared-task workflow/i)
  assert.doesNotMatch(enabled, /Use the names returned by subagent/)
  assert.equal(soulPolicyText({ role: 'lead' }, false), '')
  assert.equal(soulPolicyText({ role: 'lead' }, false, false), '')
  assert.match(soulPolicyText({ role: 'lead' }, false, true), /Delegation is soul-only/)
  assert.match(soulPolicyText({ role: 'teammate' }, false), /defined Agent Soul teammate/)
})

test('Team mode helpers read and persist the selection and fail loudly without the service', async () => {
  let enabled = false
  const calls = []
  const root = { id: 'root-1', session: { header: {} } }
  const ctx = {
    get(name) {
      if (name === 'subagents') return { rootOf: () => root, namesOf: () => ({ self: 'lead' }) }
      if (name === 'agentTeams') {
        return {
          isEnabled: () => enabled,
          async setEnabled(agent, value) { calls.push([agent, value]); enabled = value },
        }
      }
      return undefined
    },
  }
  assert.equal(teamModeEnabled(ctx, root), false)
  await setTeamModeEnabled(ctx, root, true, undefined)
  assert.deepEqual(calls, [[root, true]])
  assert.equal(teamModeEnabled(ctx, root), true)

  await assert.rejects(
    setTeamModeEnabled({ get: () => undefined }, root, true),
    /Agent Teams service is unavailable/,
  )
})

test('installSoulSurface registers the shadow policy, Lead catalog, guard, and only the two plugin tools', () => {
  const sections = []
  const registrations = []
  const guards = []
  const scope = {
    systemPrompt: {
      section(registration) { sections.push(registration); return () => {} },
      getSectionOrder() { return 10 },
    },
    tools: {
      register(definition, options) { registrations.push({ definition, options }); return () => {} },
      guard(callback) { guards.push(callback); return () => {} },
    },
  }
  const { ctx, root } = teamContext()
  const deps = {
    ctx,
    logger: { warn() {} },
    rootOf: () => '/ws',
    isSoulTeammate: () => false,
    catalog: { promptText: () => 'CATALOG' },
    spawnTeamMember: async () => ({ member: { id: 'child-1', name: 'probe-1' }, soul: { name: 'probe', tools: null, model: null } }),
    describeSouls: async () => ({ souls: [], diagnostics: [], roots: [] }),
  }
  const member = { role: 'lead', name: 'lead', enabled: true, root }
  const dispose = installSoulSurface(root, scope, { ctx, config: {}, catalog: deps.catalog, deps, member })
  assert.deepEqual(sections.map(section => section.name), ['team:policy', 'team:agent-souls'])
  assert.match(sections[0].text(), /Delegation is soul-only/)
  assert.equal(sections[1].text(), 'CATALOG')
  assert.deepEqual(registrations.map(entry => entry.definition.name).sort(), ['list_agent_souls', 'spawn_teammate'])
  const spawn = registrations.find(entry => entry.definition.name === 'spawn_teammate')
  assert.equal(spawn.options.when({ agent: root }), true)
  assert.equal(guards.length, 1)
  assert.equal(guards[0]({ name: 'subagent' }), SOUL_ONLY_DENIAL)
  assert.equal(guards[0]({ name: 'read' }), undefined)
  dispose()

  const disabled = teamContext({ enabled: false })
  const disabledRegistrations = []
  const disabledSections = []
  const disabledScope = {
    systemPrompt: { section(reg) { disabledSections.push(reg); return () => {} }, getSectionOrder: () => 10 },
    tools: { register(def, options) { disabledRegistrations.push({ def, options }); return () => {} }, guard() { return () => {} } },
  }
  const disabledDeps = { ...deps, ctx: disabled.ctx, isSoulTeammate: () => false }
  const disabledDispose = installSoulSurface(disabled.root, disabledScope, {
    ctx: disabled.ctx, config: {}, catalog: deps.catalog, deps: disabledDeps,
    member: { role: 'lead', name: 'lead', enabled: false, root: disabled.root },
  })
  assert.equal(disabledSections[0].text(), '')
  assert.equal(disabledRegistrations[0].options.when({ agent: disabled.root }), false)
  assert.equal(disabledRegistrations[1].options.when({ agent: disabled.root }), false)
  disabledDispose()
})

test('an active orchestrator keeps the Soul surface and stock guard when Team is off', () => {
  const { ctx, root } = teamContext({ enabled: false })
  const sections = []
  const registrations = []
  const guards = []
  const scope = {
    systemPrompt: {
      section(registration) { sections.push(registration); return () => {} },
      getSectionOrder() { return 10 },
    },
    tools: {
      register(definition, options) { registrations.push({ definition, options }); return () => {} },
      guard(callback) { guards.push(callback); return () => {} },
    },
  }
  const deps = {
    ctx,
    logger: { warn() {} },
    rootOf: () => '/ws',
    isSoulTeammate: () => false,
    isOrchestratorActive: agent => agent === root,
    catalog: { promptText: () => 'CATALOG' },
  }
  const member = { role: 'lead', name: 'lead', enabled: false, root }
  const dispose = installSoulSurface(root, scope, { ctx, config: {}, catalog: deps.catalog, deps, member })
  assert.match(sections[0].text(), /Delegation is soul-only/)
  assert.equal(sections[1].text(), 'CATALOG')
  assert.deepEqual(registrations.map(entry => entry.definition.name).sort(), ['list_agent_souls', 'spawn_teammate'])
  assert.equal(registrations[0].options.when({ agent: root }), true)
  assert.equal(registrations[1].options.when({ agent: root }), true)
  assert.equal(guards[0]({ name: 'subagent' }), SOUL_ONLY_DENIAL)
  assert.equal(guards[0]({ name: 'subagent_fork' }), SOUL_ONLY_DENIAL)
  dispose()
})

test('spawnTeamMember reserves a child id, routes the model, and records the pending plan by id', async () => {
  const { ctx, root, calls } = teamContext()
  const bindings = []
  const pending = createPendingSpawns()
  const soul = { name: 'probe', description: 'probe soul', persona: 'PERSONA', tools: ['read'], model: 'deepseek-v4-pro', context: 'fresh', sourceLabel: 'workspace' }
  const catalog = { refresh: async () => ({ scannedAt: 0, definitions: [soul], byName: new Map([[soul.name, soul]]), diagnostics: [], dirs: ['/ws/.dsh/agents'] }) }
  const treeTools = { definitions: () => ['read', 'send_message', 'list_agents'].map(name => ({ name })) }
  ctx.get = name => {
    if (name === 'subagents') return ctx._subagents ?? (ctx._subagents = {
      rootOf: () => root,
      namesOf: () => ({ self: 'lead' }),
      getProvider: () => ({ name: 'spawn' }),
      resolveMaxDepth: () => 1,
      async startActivation(spec) { calls.push(spec); return { childId: spec.childId, name: spec.name } },
    })
    if (name === 'agentTeams') return { isEnabled: () => true }
    if (name === 'tools') return treeTools
    return undefined
  }
  const deps = {
    ctx, config: { freshProvider: 'spawn', forkProvider: 'fork', defaultContext: 'fresh' },
    rootOf: () => '/ws', logger: { warn() {} }, catalog, pending,
    pendingKey: (member, name) => `${member?.id ?? member}\u0000${name}`,
    bindings: { set: async (...args) => { bindings.push(args) }, get: async () => undefined },
    resolveModel: async () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }),
    preferences: { get: async () => ({ ok: true, preferences: { selected: null, warning: null } }) },
  }
  const result = await spawnTeamMember(deps, root, { name: 'probe-1', description: 'probe', prompt: 'do it', agentType: 'probe' })
  assert.equal(calls.length, 1)
  const spec = calls[0]
  assert.equal(spec.provider, 'spawn')
  assert.equal(spec.label, 'probe')
  assert.equal(spec.name, 'probe-1')
  assert.equal(spec.delivery, 'parent')
  assert.equal(spec.parent, root)
  assert.equal(spec.maxDepth, 1)
  assert.ok(/^[0-9a-f-]{36}$/u.test(spec.childId), 'the child id is reserved before activation')
  assert.deepEqual(spec.agentOptions, { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  assert.deepEqual(spec.prompt, [{ type: 'text', text: 'do it' }])
  assert.equal(result.member.id, spec.childId)
  assert.equal(bindings.length, 1)
  assert.equal(bindings[0][1], spec.childId)
  assert.equal(pending.size, 0, 'both pending keys are released after activation')
})

test('spawnTeamMember rejects Team-off, non-Lead, and activation failures without leaving a pending plan', async () => {
  const { ctx, root } = teamContext({ enabled: false })
  const pending = createPendingSpawns()
  const deps = {
    ctx, config: { freshProvider: 'spawn', forkProvider: 'fork', defaultContext: 'fresh' },
    rootOf: () => '/ws', logger: { warn() {} },
    catalog: { refresh: async () => ({ definitions: [], byName: new Map(), diagnostics: [], dirs: [] }) },
    pending, pendingKey: (member, name) => `${member?.id ?? member}\u0000${name}`,
    bindings: { set: async () => {} }, resolveModel: async () => undefined,
  }
  await assert.rejects(spawnTeamMember(deps, root, { name: 'probe-1', description: 'probe', prompt: 'do it' }), /Agent Teams is disabled/)

  const enabled = teamContext()
  const failingDeps = { ...deps, ctx: enabled.ctx, pending: createPendingSpawns() }
  const subagents = {
    rootOf: () => enabled.root, namesOf: () => ({ self: 'lead' }),
    getProvider: () => ({ name: 'spawn' }), resolveMaxDepth: () => 1,
    async startActivation() { throw new Error('provider failed') },
  }
  enabled.ctx.get = name => {
    if (name === 'subagents') return subagents
    if (name === 'agentTeams') return { isEnabled: () => true }
    if (name === 'tools') return { definitions: () => [{ name: 'read' }] }
    return undefined
  }
  const soul = { name: 'probe', description: 'probe', persona: 'PERSONA', tools: null, model: undefined, context: 'fresh', sourceLabel: 'workspace' }
  failingDeps.catalog = { refresh: async () => ({ definitions: [soul], byName: new Map([[soul.name, soul]]), diagnostics: [], dirs: [] }) }
  await assert.rejects(spawnTeamMember(failingDeps, enabled.root, { name: 'probe-2', description: 'probe', prompt: 'do it', agentType: 'probe' }), /provider failed/)
  assert.equal(failingDeps.pending.size, 0)
})

test('spawnTeamMember allows a Lead spawn when orchestrator mode is active and Team is off', async () => {
  const { ctx, root, calls } = teamContext({ enabled: false })
  const pending = createPendingSpawns()
  const soul = { name: 'probe', description: 'probe', persona: 'PERSONA', tools: null, context: 'fresh', sourceLabel: 'workspace' }
  const catalog = { refresh: async () => ({ definitions: [soul], byName: new Map([[soul.name, soul]]), diagnostics: [], dirs: [] }) }
  const deps = {
    ctx,
    config: { freshProvider: 'spawn', forkProvider: 'fork', defaultContext: 'fresh' },
    rootOf: () => '/ws',
    logger: { warn() {} },
    catalog,
    pending,
    pendingKey: (member, name) => `${member?.id ?? member}\u0000${name}`,
    bindings: { set: async () => {}, get: async () => undefined },
    resolveModel: async () => undefined,
    isOrchestratorActive: agent => agent === root,
  }
  const result = await spawnTeamMember(deps, root, { name: 'probe-1', description: 'probe', prompt: 'do it', agentType: 'probe' })
  assert.equal(calls.length, 1)
  assert.equal(result.soul.name, 'probe')
  assert.equal(pending.size, 0)
})

test('applyTeammateSoul keeps the base Team tools in a strict matrix and can skip an ordinary subagent', async () => {
  const state = { restrictions: [], sections: [], warnings: [] }
  const live = ['read', 'send_message', 'list_agents', 'subagent', 'team_task_create']
  const agent = {
    id: 'child-1', session: { header: { cwd: '/ws' } },
    ctx: {
      tools: {
        definitions: () => live.map(name => ({ name })),
        restrict(request) {
          const allow = [...(request?.allow ?? [])]
          const unknown = allow.filter(name => !live.includes(name))
          if (unknown.length > 0) throw new Error(`unknown ${unknown.join(',')}`)
          state.restrictions.push(allow)
          return () => {}
        },
      },
      systemPrompt: { section(reg) { state.sections.push(reg); return () => {} }, getSectionOrder: () => 10 },
      effect(callback) { const cleanup = callback(); return () => cleanup() },
    },
  }
  const pending = createPendingSpawns()
  const plan = { name: 'probe', persona: 'PERSONA', tools: ['read'], model: null, context: 'fresh', sourceLabel: 'workspace' }
  const deps = {
    ctx: { get: name => name === 'tools' ? agent.ctx.tools : undefined },
    pending, pendingKey: (member, name) => `${member}\u0000${name}`,
    bindings: { set: async () => {}, get: async () => undefined },
    logger: { warn: message => state.warnings.push(String(message)) }, rootOf: () => '/ws',
  }
  const membership = { role: 'teammate', name: 'probe', root: '/ws' }
  pending.set(deps.pendingKey('/ws', agent.id), plan)
  const applied = await applyTeammateSoul(agent, membership, deps)
  assert.equal(applied.soulName, 'probe')
  assert.deepEqual(state.restrictions.at(-1), ['read', 'send_message', 'list_agents', 'team_task_create'])
  assert.deepEqual(state.warnings, [])

  const skipped = await applyTeammateSoul(agent, membership, deps, { optional: true })
  assert.equal(skipped.skipped, true)
  await assert.rejects(applyTeammateSoul(agent, membership, deps), SoulPlanUnavailableError)
})

test('the child creation fence treats active orchestrator mode as strict', async () => {
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(source, /deps\.isOrchestratorActive\?\.\(member\.root\) === true/)
})

test('the GUI child injects connection.authentication for the 0.2.2 admit contract', async () => {
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(source, /ctx\.inject\(\[[^\]]*'connection\.authentication'/)
})

test('a detached cold-resumed child is a teammate, never a Lead', () => {
  const root = { id: 'root-1', session: { header: {} } }
  const child = { id: 'grandchild-1', session: { header: { origin: 'subagent', parentSession: 'dead-parent' } } }
  const ctx = {
    get(name) {
      if (name === 'subagents') {
        return {
          rootOf() { throw new Error('parent not live') },
          namesOf() { throw new Error('names unavailable') },
        }
      }
      if (name === 'agents') return { get: () => undefined }
      if (name === 'agentTeams') return { isEnabled() { throw new Error('root unavailable') } }
      return undefined
    },
  }
  const member = teamMemberOf(ctx, child)
  assert.equal(member.role, 'teammate', 'a child with a parent link is never the Lead')
  assert.equal(member.detached, true)
  assert.equal(member.root, child, 'the child is its own resolution fallback')
  assert.equal(member.name, child.id)
  assert.equal(member.enabled, false, 'an unavailable root cannot silently enable Team mode')
  assert.equal(teamMemberOf(ctx, root).role, 'lead', 'a root without a parent link is still the Lead')
})

test('the base Team row is inspected and restored through the Plugin Manager', async () => {
  const rows = [{ moduleName: '@deepseek-ai/dsh-tool-agent-team', patchId: 'tool-agent-team', entryId: 'entry-1', enabled: false }]
  const calls = []
  const ctx = {
    get(name) {
      if (name !== 'pluginManager') return undefined
      return {
        async listPlugins() { return rows },
        async setPluginEnabled(entryId, enabled) { calls.push([entryId, enabled]); rows[0].enabled = enabled; return { changed: true, application: 'applied' } },
      }
    },
  }
  const before = await inspectBaseTeamRow(ctx)
  assert.equal(before.status, 'disabled')
  assert.equal(before.ok, false)
  const restored = await restoreBaseTeamRow(ctx)
  assert.equal(restored.ok, true)
  assert.deepEqual(calls, [['entry-1', true]])
  assert.equal((await inspectBaseTeamRow(ctx)).status, 'enabled')

  const absent = await inspectBaseTeamRow({ get: () => ({ listPlugins: async () => [] }) })
  assert.equal(absent.status, 'absent')
  assert.equal(absent.ok, false)
  const unknown = await inspectBaseTeamRow({ get: () => undefined })
  assert.equal(unknown.status, 'unknown')
  assert.equal(unknown.ok, null)
})

test('base-row repair never claims live success for overridden, restart-only, or failed rows', async () => {
  const makeCtx = (rows, result) => ({
    get(name) {
      if (name !== 'pluginManager') return undefined
      return {
        async listPlugins() { return rows },
        async setPluginEnabled() { return result },
      }
    },
  })
  const disabledRow = { moduleName: '@deepseek-ai/dsh-tool-agent-team', patchId: 'tool-agent-team', entryId: 'entry-1', enabled: false }
  const overridden = await restoreBaseTeamRow(makeCtx([disabledRow], { changed: true, application: 'overridden' }))
  assert.equal(overridden.ok, false)
  assert.equal(overridden.reason, 'overridden')
  assert.equal(overridden.status, 'disabled')

  const restart = await restoreBaseTeamRow(makeCtx([disabledRow], { changed: true, application: 'restart-required', restartReason: 'no-hmr' }))
  assert.equal(restart.ok, false)
  assert.equal(restart.reason, 'restart-required')

  const failedRow = { moduleName: '@deepseek-ai/dsh-tool-agent-team', patchId: 'tool-agent-team', entryId: 'entry-1', enabled: true, fiberPhase: 'failed', diagnostic: 'boom' }
  const failed = await restoreBaseTeamRow(makeCtx([failedRow], { changed: true, application: 'applied' }))
  assert.equal(failed.ok, false)
  assert.equal(failed.reason, 'failed')
  assert.equal(failed.status, 'failed')
})
