/**
 * Base `tool-agent-team` row inspection and one-click restoration.
 *
 * DSH 0.2.2 ships the Team task tools in the base bundle. A profile upgraded
 * from the old plugin may still carry the plugin's former
 * `- id: tool-agent-team\n  disabled: true` override (or a user may have added
 * it manually). That leaves the plugin's soul spawn working while the base Team
 * policy and task board are absent, which is never the intended composition.
 *
 * This module only diagnoses and, on explicit request, re-enables that row. It
 * never rewrites the profile at activation.
 *
 * @module @local/dsh-agent-soul/team-row
 */

/** Loader row id of the shipped Team tool row. */
export const BASE_TEAM_ROW_ID = 'tool-agent-team'

/** Package name of the shipped Team tool plugin in DSH 0.2.2. */
export const BASE_TEAM_PLUGIN_NAME = '@deepseek-ai/dsh-tool-agent-team'

/** Human-readable manual fix for a disabled base row. */
export const BASE_TEAM_ROW_FIX = `remove the legacy override from the profile patch, or run manage_agent_souls({ action: "repair_team_tools" }):\n- id: ${BASE_TEAM_ROW_ID}\n  disabled: false`

/** One raw Plugin Manager row, reduced to the fields this module reads. */
function rowOf(row) {
  if (row === null || typeof row !== 'object') return undefined
  const moduleName = typeof row.moduleName === 'string' ? row.moduleName : ''
  const patchId = typeof row.patchId === 'string' ? row.patchId : ''
  if (moduleName !== BASE_TEAM_PLUGIN_NAME && patchId !== BASE_TEAM_ROW_ID) return undefined
  return {
    entryId: typeof row.entryId === 'string' ? row.entryId : undefined,
    patchId: patchId === '' ? undefined : patchId,
    moduleName: moduleName === '' ? undefined : moduleName,
    enabled: row.enabled !== false,
    fiberPhase: typeof row.fiberPhase === 'string' ? row.fiberPhase : undefined,
    diagnostic: typeof row.diagnostic === 'string' && row.diagnostic !== '' ? row.diagnostic : undefined,
    readOnlyReason: typeof row.readOnlyReason === 'string' && row.readOnlyReason !== ''
      ? row.readOnlyReason
      : undefined,
  }
}

/**
 * Read the composed state of the shipped Team tool row.
 *
 * @param {object} ctx - plugin context (optional `pluginManager` service).
 * @returns {Promise<{ available: boolean,
 *   status: 'enabled' | 'disabled' | 'failed' | 'absent' | 'unknown',
 *   ok: boolean | null, rows: object[], message: string, fix: string }>}
 */
export async function inspectBaseTeamRow(ctx) {
  let manager
  try {
    manager = typeof ctx?.get === 'function' ? ctx.get('pluginManager') : undefined
  } catch {
    manager = undefined
  }
  if (manager === undefined || typeof manager.listPlugins !== 'function') {
    return {
      available: false,
      status: 'unknown',
      ok: null,
      rows: [],
      message: 'the Plugin Manager service is unavailable, so the base tool-agent-team row cannot be inspected',
      fix: BASE_TEAM_ROW_FIX,
    }
  }
  let listing
  try {
    listing = await manager.listPlugins()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      available: false,
      status: 'unknown',
      ok: null,
      rows: [],
      message: `cannot list profile plugins to locate ${BASE_TEAM_ROW_ID}: ${message}`,
      fix: BASE_TEAM_ROW_FIX,
    }
  }
  const rows = (Array.isArray(listing) ? listing : []).map(rowOf).filter(row => row !== undefined)
  if (rows.length === 0) {
    return {
      available: true,
      status: 'absent',
      ok: false,
      rows,
      message: `no ${BASE_TEAM_ROW_ID} row is composed in this profile; Team task tools and policy are unavailable. Mount ${BASE_TEAM_PLUGIN_NAME}, or remove the legacy override.`,
      fix: BASE_TEAM_ROW_FIX,
    }
  }
  const failed = rows.find(row => row.enabled && (row.fiberPhase === 'failed' || row.diagnostic !== undefined))
  if (failed !== undefined) {
    return {
      available: true,
      status: 'failed',
      ok: false,
      rows,
      message: `the shipped ${BASE_TEAM_ROW_ID} row is enabled but its fiber failed${failed.diagnostic === undefined ? '' : `: ${failed.diagnostic}`}; the base Team tools and policy are unavailable`,
      fix: BASE_TEAM_ROW_FIX,
    }
  }
  if (rows.some(row => row.enabled)) {
    return {
      available: true,
      status: 'enabled',
      ok: true,
      rows,
      message: 'the shipped tool-agent-team row is enabled, so the base Team tools and policy are available',
      fix: BASE_TEAM_ROW_FIX,
    }
  }
  return {
    available: true,
    status: 'disabled',
    ok: false,
    rows,
    message: `the shipped ${BASE_TEAM_ROW_ID} row is disabled in this profile, so the base Team task tools and policy are unavailable alongside agent-soul-team`,
    fix: BASE_TEAM_ROW_FIX,
  }
}

/**
 * Re-enable the shipped Team tool row through the Plugin Manager.
 *
 * This is the explicit repair path. A missing or read-only row reports the
 * manual profile fix instead.
 *
 * @param {object} ctx - plugin context (optional `pluginManager` service).
 * @returns {Promise<{ ok: boolean, changed: boolean, reason: string, message: string,
 *   status?: string }>}
 */
export async function restoreBaseTeamRow(ctx) {
  const state = await inspectBaseTeamRow(ctx)
  if (state.ok === true) {
    return { ok: true, changed: false, reason: 'no-conflict', message: state.message, status: state.status }
  }
  if (state.status === 'failed') {
    return {
      ok: false,
      changed: false,
      reason: 'failed',
      message: `the base ${BASE_TEAM_ROW_ID} row is enabled but failed; enabling it again cannot prove a live recovery: ${state.message}`,
      status: 'failed',
    }
  }
  let manager
  try {
    manager = typeof ctx?.get === 'function' ? ctx.get('pluginManager') : undefined
  } catch {
    manager = undefined
  }
  if (manager === undefined || typeof manager.setPluginEnabled !== 'function') {
    return {
      ok: false,
      changed: false,
      reason: 'plugin-manager-unavailable',
      message: `the Plugin Manager service is unavailable, so the base row must be restored manually: ${state.fix}`,
      status: state.status,
    }
  }
  const target = state.rows.find(row => row.entryId !== undefined && row.enabled === false)
    ?? state.rows.find(row => row.entryId !== undefined)
  if (target === undefined) {
    return {
      ok: false,
      changed: false,
      reason: 'not-listed',
      message: `the Plugin Manager does not list a manageable ${BASE_TEAM_ROW_ID} row; ${state.fix}`,
      status: state.status,
    }
  }
  if (typeof target.readOnlyReason === 'string' && target.readOnlyReason !== '') {
    return {
      ok: false,
      changed: false,
      reason: 'read-only',
      message: `the ${BASE_TEAM_ROW_ID} row is read-only (${target.readOnlyReason}); ${state.fix}`,
      status: state.status,
    }
  }
  let result
  try {
    result = await manager.setPluginEnabled(target.entryId, true)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      changed: false,
      reason: 'failed',
      message: `enabling ${BASE_TEAM_ROW_ID} failed: ${message}`,
      status: state.status,
    }
  }
  const application = typeof result?.application === 'string' ? result.application : ''
  const warnings = Array.isArray(result?.warnings) ? result.warnings.map(String).filter(Boolean) : []
  if (application === 'restart-required') {
    return {
      ok: false,
      changed: result?.changed === true,
      reason: 'restart-required',
      message: `the profile now enables ${BASE_TEAM_ROW_ID}, but this Host cannot apply it live${typeof result?.restartReason === 'string' ? ` (${result.restartReason})` : ''}; restart DSH, then re-check the health card`,
      status: state.status,
    }
  }
  if (application !== 'applied') {
    return {
      ok: false,
      changed: result?.changed === true,
      reason: application === 'overridden' ? 'overridden' : 'not-applied',
      message: `the Plugin Manager did not apply a live enable${application === '' ? '' : ` (${application})`}${warnings.length === 0 ? '' : `: ${warnings.join('; ')}`}; the base row may still be disabled`,
      status: state.status,
    }
  }
  // Do not trust the change result alone: re-read the live row and require an
  // enabled, non-failed status before reporting repair success.
  let after
  try {
    after = await inspectBaseTeamRow(ctx)
  } catch (error) {
    return {
      ok: false,
      changed: result?.changed === true,
      reason: 'verification-failed',
      message: `the Plugin Manager applied the enable, but the base row could not be re-read: ${error instanceof Error ? error.message : String(error)}`,
      status: state.status,
    }
  }
  if (after.status !== 'enabled' || after.ok !== true) {
    return {
      ok: false,
      changed: result?.changed === true,
      reason: 'not-verified',
      message: `the Plugin Manager applied the enable, but the base row is still not live: ${after.message}`,
      status: after.status,
    }
  }
  return {
    ok: true,
    changed: result?.changed === true,
    reason: 'applied',
    message: `re-enabled the shipped ${BASE_TEAM_ROW_ID} row${warnings.length === 0 ? '' : ` (warnings: ${warnings.join('; ')})`}; the base Team tools and policy are available again`,
    status: 'enabled',
  }
}
