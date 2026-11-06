/**
 * Team-tool row composition: detection, diagnosis, and repair.
 *
 * This bundle replaces the shipped `tool-agent-team` row with `agent-soul-team`.
 * Profile patch layers apply in `dsh.profile.bundles` order, so the replacement
 * is deterministic only when this bundle's layer comes *after* the Agent Teams
 * bundle's layer. When the Agent Teams bundle is enabled (or re-enabled) later,
 * this bundle's `- id: tool-agent-team disabled: true` targets a row that does
 * not exist yet, the Loader warns and skips it, and both tool rows mount: they
 * race for the same `team:policy` prompt section and Team tool names, and one
 * surface silently disappears.
 *
 * This module reads the live Loader tree (optional `loader` service) to say
 * which case applies, and can ask the Plugin Manager (optional `pluginManager`
 * service) to persist the same `disabled: true` override a manual profile patch
 * would write. All services are looked up defensively: headless, SDK, and ACP
 * compositions without a profile simply report `unknown` instead of failing.
 *
 * @module @local/dsh-agent-soul/composition
 */

/** Loader row id of the shipped Team tool row this bundle replaces. */
export const TEAM_TOOL_ROW_ID = 'tool-agent-team'

/** Package name of the shipped Team tool plugin. */
export const TEAM_TOOL_PLUGIN_NAME = '@deepseek-ai/dsh-experimental-tool-agent-team'

/** The profile-patch override that makes the replacement deterministic. */
export const PROFILE_PATCH_FIX = `- id: ${TEAM_TOOL_ROW_ID}\n  disabled: true`

/** Human-readable message for one arbitrary thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Log one warning without letting diagnostics logging break the caller.
 * @param {{ warn?: (message: string) => void } | undefined} logger
 * @param {string} message
 * @returns {void}
 */
function warn(logger, message) {
  try {
    if (typeof logger?.warn === 'function') logger.warn(`agent-soul: ${message}`)
  } catch {
    // Diagnostics must never break activation.
  }
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
 * The shaped answer for a composition this plugin cannot inspect.
 * @returns {object}
 */
function unknownState() {
  return {
    available: false,
    status: 'unknown',
    ok: null,
    rows: [],
    message: 'the Loader service is unavailable, so the Team-tool row composition cannot be inspected',
    fix: PROFILE_PATCH_FIX,
  }
}

/**
 * Read the shipped Team tool row state from the live Loader tree.
 *
 * `enabled` reports the composed intent (`!disabled`), which is known before the
 * row's fiber starts: that makes activation-time inspection accurate even while
 * the tree is still mounting rows in parallel.
 *
 * @param {object} ctx - plugin context (its optional `loader` service is read).
 * @returns {{ available: boolean, status: 'replaced' | 'conflict' | 'absent' | 'unknown',
 *   ok: boolean | null, rows: { id: string, disabled: boolean, enabled: boolean }[],
 *   message: string, fix: string }}
 */
export function inspectTeamToolSurface(ctx) {
  const loader = serviceOf(ctx, 'loader')
  if (loader === undefined || typeof loader.entries !== 'function') return unknownState()
  /** @type {{ id: string, disabled: boolean, enabled: boolean }[]} */
  const rows = []
  try {
    for (const entry of loader.entries()) {
      const options = entry?.options
      if (options === null || typeof options !== 'object' || options.name !== TEAM_TOOL_PLUGIN_NAME) continue
      let disabled = false
      try {
        disabled = typeof entry.disabled === 'boolean' ? entry.disabled : options.disabled === true
      } catch {
        disabled = options.disabled === true
      }
      rows.push({ id: String(options.id ?? ''), disabled, enabled: !disabled })
    }
  } catch (error) {
    return {
      ...unknownState(),
      message: `cannot enumerate Loader entries, so the Team-tool row composition cannot be inspected: ${messageOf(error)}`,
    }
  }
  const competing = rows.filter(row => row.enabled)
  if (competing.length > 0) {
    const ids = competing.map(row => row.id).filter(id => id !== '').join(', ')
    return {
      available: true,
      status: 'conflict',
      ok: false,
      rows,
      message: `the shipped Team tool row${ids === '' ? '' : ` (${ids})`} is active alongside agent-soul-team, so both rows register the same Team tools and one surface silently disappears; enable the Agent Teams bundle before this bundle, or add the override below to the profile patch and reload`,
      fix: PROFILE_PATCH_FIX,
    }
  }
  if (rows.length > 0) {
    return {
      available: true,
      status: 'replaced',
      ok: true,
      rows,
      message: 'the shipped Team tool row is disabled, so agent-soul-team owns the Team tool surface',
      fix: PROFILE_PATCH_FIX,
    }
  }
  return {
    available: true,
    status: 'absent',
    ok: true,
    rows,
    message: 'no shipped Team tool row is composed in this profile',
    fix: PROFILE_PATCH_FIX,
  }
}

/**
 * Build one composition state from the Plugin Manager's own row listing.
 *
 * Used when the Loader service is not exposed to this plugin (the Web profile's
 * normal case): the Plugin Manager still lists the shipped row and its enabled
 * state, which is enough to detect the duplicate-surface conflict.
 *
 * @param {unknown} listing - `pluginManager.listPlugins()` result.
 * @returns {{ available: boolean, status: 'replaced' | 'conflict' | 'absent' | 'unknown',
 *   ok: boolean | null, rows: { id: string, disabled: boolean, enabled: boolean }[],
 *   message: string, fix: string }}
 */
function managerTeamToolState(listing) {
  const rows = Array.isArray(listing) ? listing.filter(row => row !== null && typeof row === 'object') : []
  const candidates = rows.filter(row => row.moduleName === TEAM_TOOL_PLUGIN_NAME || row.patchId === TEAM_TOOL_ROW_ID)
  const mapped = candidates.map(row => ({
    id: String(row.patchId ?? row.entryId ?? ''),
    disabled: row.enabled === false,
    enabled: row.enabled !== false,
  }))
  if (candidates.some(row => row.enabled !== false)) {
    return {
      available: true,
      status: 'conflict',
      ok: false,
      rows: mapped,
      message: `the shipped Team tool row is enabled in the profile alongside agent-soul-team, so both rows register the same Team tools and one surface silently disappears; enable the Agent Teams bundle before this bundle, or add the override below to the profile patch and reload`,
      fix: PROFILE_PATCH_FIX,
    }
  }
  if (candidates.length > 0) {
    return {
      available: true,
      status: 'replaced',
      ok: true,
      rows: mapped,
      message: 'the shipped Team tool row is disabled in the profile, so agent-soul-team owns the Team tool surface',
      fix: PROFILE_PATCH_FIX,
    }
  }
  return {
    available: true,
    status: 'absent',
    ok: true,
    rows: [],
    message: 'the Plugin Manager lists no shipped Team tool row in this profile',
    fix: PROFILE_PATCH_FIX,
  }
}

/**
 * Ask the Plugin Manager to persist the `disabled: true` override for the
 * shipped Team tool row — the same profile write a manual patch would make.
 *
 * This is the explicit repair path; `createCompositionGuard().claim()` uses it
 * for the opt-in automatic path. A profile without the Plugin Manager (headless
 * composition without management services) reports the manual fix instead.
 *
 * @param {{ ctx: object, logger?: object }} options
 * @returns {Promise<{ ok: boolean, changed: boolean, reason: string, message: string,
 *   fix: string, status?: string }>}
 */
export async function repairTeamToolSurface({ ctx, logger } = {}) {
  const manager = serviceOf(ctx, 'pluginManager')
  let state = inspectTeamToolSurface(ctx)
  if (state.available !== true) {
    // Some hosts (notably the Web profile) do not expose the Loader service to
    // plugins even though the Plugin Manager is available. Fall back to the
    // manager's own listing so a reordered/re-enable composition can still be
    // detected and repaired automatically instead of silently keeping both
    // Team-tool rows mounted.
    if (manager === undefined || typeof manager.listPlugins !== 'function') {
      return { ok: false, changed: false, reason: 'unavailable', message: state.message, fix: state.fix, status: state.status }
    }
    let fallbackListing
    try {
      fallbackListing = await manager.listPlugins()
    } catch (error) {
      return {
        ok: false,
        changed: false,
        reason: 'listing-failed',
        message: `cannot list profile plugins to locate ${TEAM_TOOL_ROW_ID}: ${messageOf(error)}; add the override below manually:\n${state.fix}`,
        fix: state.fix,
        status: state.status,
      }
    }
    state = managerTeamToolState(fallbackListing)
  }
  if (state.ok === true) {
    return { ok: true, changed: false, reason: 'no-conflict', message: state.message, fix: state.fix, status: state.status }
  }
  if (manager === undefined || typeof manager.setPluginEnabled !== 'function') {
    return {
      ok: false,
      changed: false,
      reason: 'plugin-manager-unavailable',
      message: `the Plugin Manager service is unavailable, so the override must be added to the profile patch manually:\n${state.fix}`,
      fix: state.fix,
      status: state.status,
    }
  }
  let listing
  try {
    listing = await manager.listPlugins()
  } catch (error) {
    return {
      ok: false,
      changed: false,
      reason: 'listing-failed',
      message: `cannot list profile plugins to locate ${TEAM_TOOL_ROW_ID}: ${messageOf(error)}; add the override below manually:\n${state.fix}`,
      fix: state.fix,
      status: state.status,
    }
  }
  const rows = Array.isArray(listing) ? listing.filter(row => row !== null && typeof row === 'object') : []
  const candidates = rows.filter(row => row.moduleName === TEAM_TOOL_PLUGIN_NAME || row.patchId === TEAM_TOOL_ROW_ID)
  const target = candidates.find(row => typeof row.entryId === 'string' && row.enabled !== false)
    ?? candidates.find(row => typeof row.entryId === 'string')
  if (target === undefined) {
    return {
      ok: false,
      changed: false,
      reason: 'not-listed',
      message: `the Plugin Manager does not list ${TEAM_TOOL_ROW_ID} as a manageable row; add the override below manually:\n${state.fix}`,
      fix: state.fix,
      status: state.status,
    }
  }
  if (typeof target.readOnlyReason === 'string' && target.readOnlyReason !== '') {
    return {
      ok: false,
      changed: false,
      reason: 'read-only',
      message: `the ${TEAM_TOOL_ROW_ID} row is read-only (${target.readOnlyReason}); add the override below manually:\n${state.fix}`,
      fix: state.fix,
      status: state.status,
    }
  }
  let result
  try {
    result = await manager.setPluginEnabled(target.entryId, false)
  } catch (error) {
    return {
      ok: false,
      changed: false,
      reason: 'failed',
      message: `disabling ${TEAM_TOOL_ROW_ID} failed: ${messageOf(error)}`,
      fix: state.fix,
      status: state.status,
    }
  }
  const application = typeof result?.application === 'string' ? result.application : ''
  const warnings = Array.isArray(result?.warnings) ? result.warnings.map(String).filter(Boolean) : []
  if (application !== 'applied' && result?.changed !== true) {
    return {
      ok: false,
      changed: result?.changed === true,
      reason: 'not-applied',
      message: `the Plugin Manager did not apply the disable${application === '' ? '' : ` (${application})`}${warnings.length === 0 ? '' : `: ${warnings.join('; ')}`}`,
      fix: state.fix,
      status: state.status,
    }
  }
  return {
    ok: true,
    changed: result?.changed === true,
    reason: 'applied',
    message: `disabled the shipped ${TEAM_TOOL_ROW_ID} row in the profile${warnings.length === 0 ? '' : ` (warnings: ${warnings.join('; ')})`}; the profile reloads and agent-soul-team owns the Team tool surface`,
    fix: state.fix,
    status: 'replaced',
  }
}

/**
 * Create the per-activation composition guard used by `index.js`.
 *
 * `claim()` performs the opt-in automatic repair. `scheduleClaim()` starts it
 * once, after the Loader tree settles (concurrently mounted rows must be
 * visible before deciding), and schedules at most one attempt per activation;
 * a successful repair rewrites the profile so the next reconciliation sees a
 * clean composition and never schedules another.
 *
 * @param {{ ctx: object, config?: { claimTeamToolRow?: boolean }, logger?: object }} options
 * @returns {{ inspect: () => object,
 *   repair: () => Promise<object>,
 *   claim: () => Promise<object>,
 *   scheduleClaim: () => Promise<object> }}
 */
export function createCompositionGuard({ ctx, config, logger } = {}) {
  let scheduleStarted = false
  /**
   * Opt-in automatic repair: only acts on a confirmed conflict.
   * @returns {Promise<object>}
   */
  async function claim() {
    if (config?.claimTeamToolRow !== true) {
      return { ok: true, changed: false, reason: 'disabled', message: 'claimTeamToolRow is off; no automatic repair was attempted', fix: PROFILE_PATCH_FIX }
    }
    const state = inspectTeamToolSurface(ctx)
    // A Loader-less composition (Web profile) still exposes the Plugin Manager;
    // let repairTeamToolSurface consult that listing before concluding there is
    // no conflict, otherwise a reordered/re-enabled profile keeps both rows.
    const needsManagerFallback = state.ok !== false && state.available !== true
    if (state.ok !== false && !needsManagerFallback) {
      return { ok: true, changed: false, reason: 'no-conflict', message: state.message, fix: state.fix, status: state.status }
    }
    const result = await repairTeamToolSurface({ ctx, logger }).catch(error => ({
      ok: false,
      changed: false,
      reason: 'failed',
      message: `the automatic Team-tool repair failed: ${messageOf(error)}`,
      fix: PROFILE_PATCH_FIX,
    }))
    if (result.changed === true) logger?.info?.(`agent-soul: ${result.message}`)
    else if (result.ok !== true && result.reason !== 'no-conflict') warn(logger, `automatic Team-tool repair did not apply: ${result.message}`)
    return result
  }
  return {
    inspect: () => inspectTeamToolSurface(ctx),
    repair: () => repairTeamToolSurface({ ctx, logger }),
    claim,
    scheduleClaim() {
      if (config?.claimTeamToolRow !== true || scheduleStarted) {
        return Promise.resolve({ ok: true, changed: false, reason: scheduleStarted ? 'already-scheduled' : 'disabled', message: 'no automatic repair was scheduled', fix: PROFILE_PATCH_FIX })
      }
      scheduleStarted = true
      return new Promise(resolve => {
        setTimeout(() => {
          void (async () => {
            // Rows mount in parallel; settle the tree so a later bundle layer is
            // visible before deciding whether a repair is needed.
            const loader = serviceOf(ctx, 'loader')
            try {
              if (typeof loader?.await === 'function') await loader.await()
            } catch {
              // Inspect the current tree below.
            }
            resolve(await claim().catch(error => ({
              ok: false,
              changed: false,
              reason: 'failed',
              message: `the automatic Team-tool repair failed: ${messageOf(error)}`,
              fix: PROFILE_PATCH_FIX,
            })))
          })()
        }, 0)
      })
    },
  }
}
