/**
 * Durable per-teammate soul bindings.
 *
 * The session log stays the source of truth for conversations, but a spawned
 * teammate's soul snapshot is plugin-owned state: the Team roster does not
 * carry it and cold resume re-creates the child Agent without our in-memory
 * pending spawn. This store keeps the smallest durable record that lets a
 * resumed teammate re-apply its persona, tool matrix, and routed model.
 *
 * One JSON document per workspace root (`.dsh/agent-soul/bindings.json` by
 * default), written atomically and pruned to the newest entries. The store
 * reports a missing, unreadable, or corrupt document as an empty result with a
 * warning; admission treats a missing plan as fatal, so a roster teammate is
 * never allowed to resume without its Soul effects.
 *
 * @module @local/dsh-agent-soul/bindings
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

/** Default maximum retained bindings per root. */
const DEFAULT_MAX_ENTRIES = 500

/** On-disk format version of the bindings document. */
const BINDINGS_VERSION = 1

/** Human-readable message for one arbitrary thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether one parsed binding value has the shape this module writes.
 * Unknown or malformed entries are dropped instead of failing the whole store.
 * @param {unknown} value
 * @returns {boolean}
 */
function isBindingRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = /** @type {Record<string, unknown>} */ (value)
  return typeof record.name === 'string' && record.name.length > 0
    && typeof record.persona === 'string'
  && (record.tools === null || Array.isArray(record.tools))
    && (record.model === null || (typeof record.model === 'object'
      && record.model !== null
      && typeof (/** @type {Record<string, unknown>} */ (record.model)).provider === 'string'
      && typeof (/** @type {Record<string, unknown>} */ (record.model)).model === 'string'))
    && typeof record.savedAt === 'number'
}

/**
 * Detach the stored form from the caller's snapshot and stamp it.
 * @param {object} snapshot - SoulSnapshot-shaped plan.
 * @returns {Record<string, unknown>} the durable record.
 */
function toRecord(snapshot) {
  return {
    name: snapshot.name,
    persona: snapshot.persona,
    tools: snapshot.tools === null || snapshot.tools === undefined ? null : [...snapshot.tools],
    model: snapshot.model === null || snapshot.model === undefined
      ? null
      : {
        provider: snapshot.model.provider,
        model: snapshot.model.model,
        ...snapshot.model.reasoningEffort === undefined ? {} : { reasoningEffort: snapshot.model.reasoningEffort },
      },
    context: snapshot.context ?? null,
    sourceLabel: snapshot.sourceLabel ?? null,
    savedAt: Date.now(),
  }
}

/**
 * Detach the durable record into the SoulSnapshot shape callers apply.
 * @param {Record<string, unknown>} record
 * @returns {object} the snapshot.
 */
function fromRecord(record) {
  return {
    name: record.name,
    persona: record.persona,
    tools: record.tools === null ? null : [...record.tools],
    model: record.model === null
      ? null
      : {
        provider: record.model.provider,
        model: record.model.model,
        ...record.model.reasoningEffort === undefined ? {} : { reasoningEffort: record.model.reasoningEffort },
      },
    context: record.context ?? null,
    sourceLabel: typeof record.sourceLabel === 'string' ? record.sourceLabel : '',
  }
}

/**
 * Detach one durable record into the GUI-facing binding row.
 *
 * The soul usage panel groups rows by `name` and correlates live Team
 * members through `childId` (the teammate's Session id), so both are exposed
 * alongside the stored soul snapshot. Arrays and the model object are fresh
 * copies: a caller cannot mutate the loaded store through this row.
 *
 * @param {string} childId - Session id the binding belongs to.
 * @param {Record<string, unknown>} record - one validated durable record.
 * @returns {{ childId: string, name: string, tools: string[] | null,
 *   model: { provider: string, model: string, reasoningEffort?: string } | null,
 *   context: 'fresh' | 'fork' | null, sourceLabel: string, savedAt: number }}
 */
function toListRow(childId, record) {
  return {
    childId,
    name: record.name,
    tools: record.tools === null ? null : [...record.tools],
    model: record.model === null
      ? null
      : {
        provider: record.model.provider,
        model: record.model.model,
        ...record.model.reasoningEffort === undefined ? {} : { reasoningEffort: record.model.reasoningEffort },
      },
    context: record.context === 'fresh' || record.context === 'fork' ? record.context : null,
    sourceLabel: typeof record.sourceLabel === 'string' ? record.sourceLabel : '',
    savedAt: record.savedAt,
  }
}

/**
 * Create the durable soul binding store.
 *
 * @param {{ fileSpec?: string, maxEntries?: number,
 *   logger?: { warn(message: string): void } }} [options]
 *   `fileSpec` is absolute or workspace-relative; `maxEntries` bounds each root's document.
 * @returns {{
 *   filePath(root: string): string,
 *   get(root: string, childId: string): Promise<object | undefined>,
 *   list(root: string): Promise<Array<{ childId: string, name: string,
 *     tools: string[] | null,
 *     model: { provider: string, model: string, reasoningEffort?: string } | null,
 *     context: 'fresh' | 'fork' | null, sourceLabel: string, savedAt: number }>>,
 *   set(root: string, childId: string, snapshot: object): Promise<void>,
 *   delete(root: string, childId: string): Promise<void>,
 *   flush(): Promise<void>,
 *   dispose(): Promise<void>,
 *   size(root: string): Promise<number>,
 * }}
 */
export function createBindingStore(options = {}) {
  const fileSpec = typeof options.fileSpec === 'string' && options.fileSpec.length > 0
    ? options.fileSpec
    : join('.dsh', 'agent-soul', 'bindings.json')
  const maxEntries = Number.isSafeInteger(options.maxEntries) && options.maxEntries > 0
    ? options.maxEntries
    : DEFAULT_MAX_ENTRIES
  const logger = options.logger

  /** @type {Map<string, { entries: Map<string, Record<string, unknown>>, loaded?: Promise<void>, chain: Promise<void>, tmp: number }>} */
  const roots = new Map()

  /** Absolute document path for one workspace root. */
  function filePath(root) {
    return isAbsolute(fileSpec) ? fileSpec : join(root, fileSpec)
  }

  /** One root's mutable state. */
  function stateOf(root) {
    let state = roots.get(root)
    if (state === undefined) {
      state = { entries: new Map(), chain: Promise.resolve(), tmp: 0 }
      roots.set(root, state)
    }
    return state
  }

  /** Read and validate one root's document once. */
  function ensureLoaded(root, state) {
    state.loaded ??= (async () => {
      const path = filePath(root)
      let text
      try {
        text = await readFile(path, 'utf8')
      } catch (error) {
        if (/** @type {{ code?: string }} */ (error).code !== 'ENOENT') {
          logger?.warn(`agent-soul: cannot read ${path}: ${messageOf(error)}`)
        }
        return
      }
      try {
        const parsed = JSON.parse(text)
        const bindings = parsed?.version === BINDINGS_VERSION ? parsed?.bindings : undefined
        if (typeof bindings !== 'object' || bindings === null || Array.isArray(bindings)) {
          throw new Error(`unsupported document (expected version ${BINDINGS_VERSION})`)
        }
        for (const [childId, record] of Object.entries(bindings)) {
          if (isBindingRecord(record)) state.entries.set(childId, record)
        }
      } catch (error) {
        logger?.warn(`agent-soul: ignoring unreadable binding store ${path}: ${messageOf(error)}`)
        state.entries.clear()
      }
    })().catch(error => {
      logger?.warn(`agent-soul: binding store load failed: ${messageOf(error)}`)
    })
    return state.loaded
  }

  /** Keep only the newest entries for one root. */
  function prune(state) {
    if (state.entries.size <= maxEntries) return
    const ordered = [...state.entries.entries()].sort((left, right) => {
      const leftAt = typeof left[1].savedAt === 'number' ? left[1].savedAt : 0
      const rightAt = typeof right[1].savedAt === 'number' ? right[1].savedAt : 0
      return leftAt - rightAt
    })
    for (const [childId] of ordered.slice(0, state.entries.size - maxEntries)) state.entries.delete(childId)
  }

  /** Serialize one root's document to disk after the previous write settles. */
  function enqueueWrite(root, state) {
    state.chain = state.chain.then(async () => {
      const path = filePath(root)
      const document = { version: BINDINGS_VERSION, bindings: Object.fromEntries(state.entries) }
      const temporary = `${path}.${process.pid}.${state.tmp++}.tmp`
      await mkdir(dirname(path), { recursive: true })
      await writeFile(temporary, `${JSON.stringify(document)}\n`, 'utf8')
      await rename(temporary, path)
    }).catch(error => {
      logger?.warn(`agent-soul: cannot persist binding store for ${root}: ${messageOf(error)}`)
    })
    return state.chain
  }

  return {
    filePath,

    async get(root, childId) {
      const state = stateOf(root)
      await ensureLoaded(root, state)
      const record = state.entries.get(childId)
      return record === undefined ? undefined : fromRecord(record)
    },

    /**
     * Every retained binding for one root as a freshly allocated array, newest
     * first. A missing or corrupt document is the same empty store `get`/`size`
     * see (the load is shared, so this read never changes corruption handling
     * and never writes). Entries with equal timestamps fall back to ascending
     * Session id so the order is deterministic.
     *
     * @param {string} root
     * @returns {Promise<Array<{ childId: string, name: string, tools: string[] | null,
     *   model: { provider: string, model: string, reasoningEffort?: string } | null,
     *   context: 'fresh' | 'fork' | null, sourceLabel: string, savedAt: number }>>}
     */
    async list(root) {
      const state = stateOf(root)
      await ensureLoaded(root, state)
      const rows = []
      for (const [childId, record] of state.entries) rows.push(toListRow(childId, record))
      rows.sort((left, right) => right.savedAt - left.savedAt
        || (left.childId < right.childId ? -1 : left.childId > right.childId ? 1 : 0))
      return rows
    },

    async set(root, childId, snapshot) {
      const state = stateOf(root)
      await ensureLoaded(root, state)
      state.entries.set(childId, toRecord(snapshot))
      prune(state)
      await enqueueWrite(root, state)
    },

    async delete(root, childId) {
      const state = stateOf(root)
      await ensureLoaded(root, state)
      if (!state.entries.delete(childId)) return
      await enqueueWrite(root, state)
    },

    async flush() {
      await Promise.all([...roots.values()].map(state => state.chain))
    },

    async dispose() {
      await this.flush()
      roots.clear()
    },

    async size(root) {
      const state = stateOf(root)
      await ensureLoaded(root, state)
      return state.entries.size
    },
  }
}
