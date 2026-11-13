/**
 * Adapter over the DSH 0.2.2 subagent-based Agent Teams API.
 *
 * The pre-0.2.2 Team service exposed roster membership (`tryMembership`),
 * member listing, spawning, messaging, interruption, and waits. DSH 0.2.2 moved
 * all of that to `ctx.subagents`: the tree root is the Lead, every descendant
 * is a teammate, names come from `namesOf`, listing comes from
 * `listDescendants`, and creation comes from `startActivation`.
 *
 * This module is the only place that translates between those two worlds. It
 * is dependency-free plain ESM so it loads from a DSH profile where only the
 * DSH installation resolves.
 *
 * @module @local/dsh-agent-soul/team
 */

/** One model-facing name for an unnamed child. */
function fallbackName(agent) {
  return typeof agent?.id === 'string' && agent.id !== '' ? agent.id : 'teammate'
}

/**
 * Read one optional Host service without assuming the composition provides it.
 * @param {object} ctx - plugin context.
 * @param {string} name - service name.
 * @returns {any} the service, or `undefined`.
 */
function serviceOf(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve one Agent's Team role, model-facing name, and Team mode.
 *
 * A root Session's Agent is the Lead; every live descendant of that root is a
 * teammate. The result is undefined when the subagent service is unavailable or
 * cannot resolve the Agent's tree, which mirrors the old
 * `tryMembership(...) === undefined` skip behavior.
 *
 * @param {object} ctx - plugin context.
 * @param {object} agent - exact live Agent.
 * @returns {{ role: 'lead' | 'teammate', name: string, parent: string | undefined,
 *   root: object, enabled: boolean, detached: boolean } | undefined}
 */
export function teamMemberOf(ctx, agent) {
  if (agent === null || typeof agent !== 'object') return undefined
  const subagents = serviceOf(ctx, 'subagents')
  if (subagents === undefined || typeof subagents.rootOf !== 'function') return undefined
  const header = agent.session?.header
  const parentId = typeof header?.parentSession === 'string' ? header.parentSession : ''
  const looksLikeChild = parentId !== '' || header?.origin === 'subagent'
  /** @type {object} */
  let root
  let detached = false
  try {
    root = subagents.rootOf(agent)
  } catch {
    // During the serial agent/created listener the child may not yet be in the
    // subagent manager even though its live parent chain already exists. Walk
    // the durable parent links to the live root so the pending Soul plan and
    // Team mode can still be resolved.
    root = agent
    const seen = new Set()
    let current = agent
    for (let hops = 0; hops < 64; hops += 1) {
      const parentSession = current?.session?.header?.parentSession
      if (typeof parentSession !== 'string' || parentSession === '' || seen.has(parentSession)) break
      seen.add(parentSession)
      let parent
      try {
        parent = serviceOf(ctx, 'agents')?.get?.(parentSession)
      } catch {
        parent = undefined
      }
      if (parent === null || typeof parent !== 'object') break
      root = parent
      current = parent
    }
    // A cold-resumed descendant can outlive its direct parent (DSH restores
    // only the target). There is no live root to walk to; keep the child
    // classification and let the caller fail closed on the durable plan.
    if (looksLikeChild && root === agent) detached = true
  }
  if (root !== null && typeof root === 'object' && looksLikeChild && root === agent) detached = true
  if (root === null || typeof root !== 'object') return undefined
  /** @type {{ self?: unknown, parent?: unknown }} */
  let names = {}
  try {
    if (typeof subagents.namesOf === 'function') names = subagents.namesOf(agent) ?? {}
  } catch {
    names = {}
  }
  const role = root === agent && !detached ? 'lead' : 'teammate'
  const name = typeof names?.self === 'string' && names.self !== ''
    ? names.self
    : role === 'lead' ? 'lead' : fallbackName(agent)
  const parent = typeof names?.parent === 'string' && names.parent !== '' ? names.parent : undefined
  let enabled = false
  try {
    enabled = serviceOf(ctx, 'agentTeams')?.isEnabled?.(agent) === true
  } catch {
    enabled = false
  }
  if (!enabled && root !== agent) {
    try {
      enabled = serviceOf(ctx, 'agentTeams')?.isEnabled?.(root) === true
    } catch {
      enabled = false
    }
  }
  return { role, name, parent, root, enabled, detached }
}

/**
 * Whether the Agent's Team mode is enabled.
 * @param {object} ctx - plugin context.
 * @param {object} agent - exact live Agent.
 * @returns {boolean}
 */
export function isTeamEnabled(ctx, agent) {
  return teamMemberOf(ctx, agent)?.enabled === true
}

/**
 * Whether the Agent is the root (Lead) of its subagent tree.
 * @param {object} ctx - plugin context.
 * @param {object} agent - exact live Agent.
 * @returns {boolean}
 */
export function isTeamLead(ctx, agent) {
  return teamMemberOf(ctx, agent)?.role === 'lead'
}

/**
 * The live parent Agent of one child, or undefined.
 * @param {object} ctx - plugin context.
 * @param {object} agent - exact live child Agent.
 * @returns {object | undefined}
 */
export function parentAgentOf(ctx, agent) {
  const parentId = agent?.session?.header?.parentSession
  if (typeof parentId !== 'string' || parentId === '') return undefined
  try {
    const agents = serviceOf(ctx, 'agents')
    const parent = typeof agents?.get === 'function' ? agents.get(parentId) : undefined
    return parent === null || typeof parent !== 'object' ? undefined : parent
  } catch {
    return undefined
  }
}

/**
 * One normalized live tree member for the GUI and name collision checks.
 * @typedef {{ id: string, name: string, role: 'lead' | 'teammate', status: string,
 *   description?: string, kind: 'root' | 'child' | 'diagnostic',
 *   mode?: string, parentId?: string, depth: number }} TeamMemberRow
 */

/**
 * List the root and every reachable descendant of one member's subagent tree.
 *
 * Descendant enumeration is the 0.2.2 replacement for the removed
 * `agentTeams.listMembers`. One-shot and external children are returned too:
 * they cannot be messaged, but their names still occupy the direct-child name
 * space and the GUI can explain them.
 *
 * @param {object} ctx - plugin context.
 * @param {object} caller - exact live root or descendant.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<TeamMemberRow[]>}
 * @throws when the caller's tree or the session-query projection is unavailable.
 */
export async function listTeamMembers(ctx, caller, options = {}) {
  const member = teamMemberOf(ctx, caller)
  if (member === undefined) return []
  const subagents = serviceOf(ctx, 'subagents')
  if (subagents === undefined || typeof subagents.listDescendants !== 'function') {
    throw new Error('the subagent service does not expose listDescendants')
  }
  const entries = await subagents.listDescendants(member.root.id, options.signal)
  /** @type {TeamMemberRow[]} */
  const rows = [{
    id: member.root.id,
    name: 'lead',
    role: 'lead',
    status: typeof member.root.status === 'string' ? member.root.status : 'inactive',
    description: 'root agent',
    kind: 'root',
    mode: 'continuable',
    depth: 0,
  }]
  if (!Array.isArray(entries)) return rows
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const name = typeof entry.path === 'string' && entry.path !== ''
      ? entry.path
      : typeof entry.name === 'string' && entry.name !== '' ? entry.name : String(entry.id)
    if (entry.kind === 'diagnostic') {
      rows.push({
        id: String(entry.id),
        name,
        role: 'teammate',
        status: typeof entry.reason === 'string' ? entry.reason : 'unavailable',
        kind: 'diagnostic',
        parentId: typeof entry.parentId === 'string' ? entry.parentId : undefined,
        depth: Number.isSafeInteger(entry.depth) ? entry.depth : 1,
      })
      continue
    }
    rows.push({
      id: String(entry.id),
      name,
      role: 'teammate',
      status: typeof entry.activity === 'string' ? entry.activity : 'inactive',
      ...typeof entry.label === 'string' && entry.label !== '' ? { description: entry.label } : {},
      kind: 'child',
      ...typeof entry.mode === 'string' ? { mode: entry.mode } : {},
      parentId: typeof entry.parentId === 'string' ? entry.parentId : undefined,
      depth: Number.isSafeInteger(entry.depth) ? entry.depth : 1,
    })
  }
  return rows
}

/**
 * Every direct-child name currently occupying the root's name space.
 *
 * Used for `nextTeammateName` only. Any failure is the caller's decision: a
 * spawn may retry without the pre-check because `startActivation` still rejects
 * a duplicate name.
 *
 * @param {object} ctx - plugin context.
 * @param {object} root - exact live Lead.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<Set<string>>}
 */
export async function directChildNames(ctx, root, options = {}) {
  const members = await listTeamMembers(ctx, root, options)
  const names = new Set()
  for (const member of members) {
    if (member.kind !== 'child' || member.depth !== 1) continue
    names.add(member.name)
  }
  return names
}

/**
 * Count the root plus every continuable descendant, for the Settings card.
 * @param {object} ctx - plugin context.
 * @param {object} root - exact live Lead.
 * @returns {Promise<number>}
 */
export async function countTeamMembers(ctx, root) {
  const members = await listTeamMembers(ctx, root)
  return members.filter(member => member.kind === 'root' || member.mode === 'continuable').length
}
