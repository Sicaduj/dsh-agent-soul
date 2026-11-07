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

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** Default maximum retained bindings per document (normally one per root). */
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
 *   `fileSpec` is absolute or workspace-relative; `maxEntries` bounds each document,
 *   including all records when multiple roots intentionally share an absolute path.
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

  /** @typedef {{ record: Record<string, unknown> | null }} Mutation */
  /** @type {Map<string, { entries: Map<string, Record<string, unknown>>, pending: Map<string, Mutation>, loaded?: Promise<void>, chain: Promise<void> }>} */
  const roots = new Map()

  /** Configured document path (kept stable for callers and diagnostics). */
  function filePath(root) {
    return isAbsolute(fileSpec) ? fileSpec : join(root, fileSpec)
  }

  /** One root's lazy read cache and uncommitted mutations, never a replacement snapshot. */
  function stateOf(root) {
    let state = roots.get(root)
    if (state === undefined) {
      state = { entries: new Map(), pending: new Map(), chain: Promise.resolve() }
      roots.set(root, state)
    }
    return state
  }

  /** Resolve aliases even before the document's parent directory exists. */
  async function canonicalPath(path) {
    let ancestor = resolve(path)
    const missing = []
    for (;;) {
      try {
        return join(await realpath(ancestor), ...missing)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        // Do not replace a dangling symlink with a new regular file.
        try {
          if ((await lstat(ancestor)).isSymbolicLink()) throw new Error(`dangling binding path: ${ancestor}`)
        } catch (statError) {
          if (statError.code !== 'ENOENT') throw statError
        }
        const parent = dirname(ancestor)
        if (parent === ancestor) throw error
        missing.unshift(basename(ancestor))
        ancestor = parent
      }
    }
  }

  /** A filesystem lock coordinates roots, store instances, and cooperating processes. */
  async function withFileLock(path, operation) {
    await mkdir(dirname(path), { recursive: true })
    const lock = `${path}.lock`
    const deadline = performance.now() + 5000
    for (;;) {
      try {
        await mkdir(lock)
        break
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        if (performance.now() >= deadline) {
          throw new Error(`timed out acquiring binding lock ${lock}; stop all writers before removing a stale lock`)
        }
        await delay(10)
      }
    }
    // Never steal a lock based on age: a slow live writer still owns its transaction.
    try { return await operation() } finally { await rmdir(lock) }
  }

  /** Reads tolerate corruption as before; transactions must not overwrite on an I/O error. */
  async function readEntries(path, strict = false) {
    let text
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return new Map()
      if (strict) throw error
      logger?.warn(`agent-soul: cannot read ${path}: ${messageOf(error)}`)
      return new Map()
    }
    try {
      const parsed = JSON.parse(text)
      const bindings = parsed?.version === BINDINGS_VERSION ? parsed?.bindings : undefined
      if (typeof bindings !== 'object' || bindings === null || Array.isArray(bindings)) {
        throw new Error(`unsupported document (expected version ${BINDINGS_VERSION})`)
      }
      return new Map(Object.entries(bindings).filter(([, record]) => isBindingRecord(record)))
    } catch (error) {
      logger?.warn(`agent-soul: ignoring unreadable binding store ${path}: ${messageOf(error)}`)
      return new Map()
    }
  }

  /** Read one root's document once; ordinary reads remain non-mutating. */
  function ensureLoaded(root, state) {
    state.loaded ??= readEntries(filePath(root)).then(entries => {
      state.entries = entries
    }).catch(error => {
      logger?.warn(`agent-soul: binding store load failed: ${messageOf(error)}`)
    })
    return state.loaded
  }

  /** Keep newest records; stable timestamp ties preserve the prior insertion-order rule. */
  function prune(entries) {
    if (entries.size <= maxEntries) return
    const ordered = [...entries.entries()].sort((left, right) => left[1].savedAt - right[1].savedAt)
    for (const [childId] of ordered.slice(0, entries.size - maxEntries)) entries.delete(childId)
  }

  /** Apply only local mutations: merging cached snapshots would resurrect stale rows. */
  function applyMutations(entries, mutations) {
    for (const [childId, mutation] of mutations) {
      if (mutation.record === null) entries.delete(childId)
      else entries.set(childId, mutation.record)
    }
  }

  /** Serialize a root's attempts, then merge under the canonical document's lock. */
  function enqueueWrite(root, state) {
    state.chain = state.chain.then(async () => {
      const pending = new Map(state.pending)
      if (pending.size === 0) return
      const path = await canonicalPath(filePath(root))
      await withFileLock(path, async () => {
        const entries = await readEntries(path, true)
        applyMutations(entries, pending)
        prune(entries)
        const document = { version: BINDINGS_VERSION, bindings: Object.fromEntries(entries) }
        const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, `${JSON.stringify(document)}\n`, { encoding: 'utf8', flag: 'wx' })
          await rename(temporary, path)
        } finally {
          try { await unlink(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
        }
        for (const [childId, mutation] of pending) {
          if (state.pending.get(childId) === mutation) state.pending.delete(childId)
        }
        state.entries = entries
        // A newer set/delete may have arrived while this transaction awaited I/O.
        applyMutations(state.entries, state.pending)
        prune(state.entries)
      })
    }).catch(error => {
      // Retain pending mutations and the in-memory plan for a later healthy write.
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
      const record = toRecord(snapshot)
      state.entries.set(childId, record)
      state.pending.set(childId, { record })
      prune(state.entries)
      await enqueueWrite(root, state)
    },

    async delete(root, childId) {
      const state = stateOf(root)
      await ensureLoaded(root, state)
      state.entries.delete(childId)
      state.pending.set(childId, { record: null })
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
