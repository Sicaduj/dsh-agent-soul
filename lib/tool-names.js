/**
 * Portable shell tool names.
 *
 * DSH registers one model-facing shell tool per shell dialect: `bash` on
 * POSIX compositions and `pwsh` on Windows compositions (the one-shot and the
 * persistent tool share the same model-facing name in each family). An Agent
 * Soul is platform-neutral, so a `tools:` list may name either spelling; the
 * plugin resolves it against the tool names the live session actually
 * registers. An exact registration always wins; only a missing shell name is
 * substituted with its counterpart. Names outside the shell family are never
 * aliased.
 *
 * @module @local/dsh-agent-soul/tool-names
 */

/**
 * Pairs of model-facing names for the same cross-platform shell capability.
 * Add a pair here only when two names really select the same tool.
 */
export const SHELL_TOOL_ALIAS_PAIRS = Object.freeze([
  Object.freeze(['bash', 'pwsh']),
])

/** @type {ReadonlyMap<string, string>} */
const SHELL_COUNTERPARTS = new Map()
for (const pair of SHELL_TOOL_ALIAS_PAIRS) {
  for (let index = 0; index < pair.length; index += 1) {
    SHELL_COUNTERPARTS.set(pair[index], pair[(index + 1) % pair.length])
  }
}

/**
 * Normalize an availability catalog to a Set of registered names.
 * @param {ReadonlySet<string> | Iterable<string>} available
 * @returns {ReadonlySet<string>}
 */
function nameSet(available) {
  return available instanceof Set ? available : new Set(available)
}

/**
 * The cross-platform counterpart of one shell tool name.
 * @param {string} name
 * @returns {string | undefined} the other spelling, or undefined for non-shell names.
 */
export function shellCounterpart(name) {
  return SHELL_COUNTERPARTS.get(name)
}

/**
 * Resolve one requested tool name against the names the session registers.
 * Exact matches win; a missing shell name falls back to its counterpart.
 * @param {string} name
 * @param {ReadonlySet<string> | Iterable<string>} available
 * @returns {string | undefined} the registered name, or undefined when unavailable.
 */
export function resolveToolName(name, available) {
  const names = nameSet(available)
  if (names.has(name)) return name
  const counterpart = shellCounterpart(name)
  return counterpart !== undefined && names.has(counterpart) ? counterpart : undefined
}

/**
 * Whether a requested name resolves to a registered tool name.
 * @param {string} name
 * @param {ReadonlySet<string> | Iterable<string>} available
 * @returns {boolean}
 */
export function toolNameKnown(name, available) {
  return resolveToolName(name, available) !== undefined
}

/**
 * Resolve a requested allow-list against a per-name restrictability probe.
 *
 * Each requested name is probed exactly first and then through its shell
 * counterpart, because a session registers only one shell spelling. The probe
 * is a plain boolean test: callers wrap DSH's throwing `restrict({ allow })`
 * probe. Resolved names keep request order, appear once, and `skipped` lists
 * every requested name that resolved to nothing. `substituted` lists the
 * requested names that were satisfied by their counterpart.
 *
 * @param {readonly string[]} names
 * @param {(name: string) => boolean} probe
 * @returns {{ names: string[], substituted: string[], skipped: string[] }}
 */
export function resolveRestrictableNames(names, probe) {
  /** @type {string[]} */
  const restrictable = []
  /** @type {string[]} */
  const substituted = []
  /** @type {string[]} */
  const skipped = []
  const seen = new Set()
  /** @param {string} resolved @returns {void} */
  const take = (resolved) => {
    if (seen.has(resolved)) return
    seen.add(resolved)
    restrictable.push(resolved)
  }
  for (const requested of names) {
    const name = typeof requested === 'string' ? requested.trim() : ''
    if (name === '') {
      skipped.push(String(requested))
      continue
    }
    if (probe(name)) {
      take(name)
      continue
    }
    const counterpart = shellCounterpart(name)
    if (counterpart !== undefined && probe(counterpart)) {
      take(counterpart)
      substituted.push(name)
      continue
    }
    skipped.push(name)
  }
  return { names: restrictable, substituted, skipped }
}
