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
 * default), written atomically and pruned to the newest entries.
 *
 * A missing document is an empty store. A document that exists but cannot be
 * trusted — unreadable, malformed JSON, an unsupported envelope, or a record
 * without the shape this module writes — is a typed
 * {@link BindingStoreError}, never a silent empty store:
 *
 * - every `get`/`list`/`size` re-reads the durable document before answering,
 *   so a document that became corrupt, unreadable, or unsafe after it was
 *   cached rejects with its typed failure instead of returning a stale plan;
 * - a tolerated `list`/`size` read keeps every valid record and reports the
 *   corruption, while `get` refuses the whole document: admission must not act
 *   on a store it could only partially validate;
 * - a mutation refuses to rewrite the document at all, so corrupt bytes can
 *   never erase the unrelated valid records they still contain; a snapshot that
 *   cannot be represented as a valid record is refused before it is written;
 * - an unpersisted local `set`/`delete` mutation is the only in-memory value
 *   served while the document is unusable: it is the newest intent for that
 *   child, not a cached durable record, and a later healthy write retries it;
 * - a workspace-relative document path is fenced to the real workspace root
 *   (resolving existing ancestors), so a symlinked `.dsh` or
 *   `.dsh/agent-soul` cannot move bindings outside the workspace. An absolute
 *   path is intentional shared state and is used verbatim.
 *
 * Admission treats a missing plan and an unusable document as fatal, so a
 * roster teammate is never allowed to resume without its Soul effects.
 *
 * @module @local/dsh-agent-soul/bindings
 */

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** Default maximum retained bindings per document (normally one per root). */
const DEFAULT_MAX_ENTRIES = 500

/** On-disk format version of the bindings document. */
const BINDINGS_VERSION = 1

/**
 * Stable failure codes for the durable store.
 *
 * They are exported so admission diagnostics and tests can distinguish a
 * missing document (no binding was ever written) from one that exists but
 * cannot be trusted, a workspace-relative path that escapes its real root, and
 * a caller snapshot that cannot be represented as a valid record.
 */
export const BINDING_UNREADABLE = 'E_BINDING_UNREADABLE'
export const BINDING_CORRUPT = 'E_BINDING_CORRUPT'
export const BINDING_UNSUPPORTED = 'E_BINDING_UNSUPPORTED'
export const BINDING_UNSAFE_PATH = 'E_BINDING_UNSAFE_PATH'
export const BINDING_INVALID_RECORD = 'E_BINDING_INVALID_RECORD'

/** One typed, actionable failure of the durable binding document. */
export class BindingStoreError extends Error {
  /**
   * @param {string} code - one exported BINDING_* code.
   * @param {string} message - actionable text naming the document.
   * @param {{ path?: string, cause?: unknown, childIds?: string[] }} [options]
   */
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'BindingStoreError'
    this.code = code
    if (options.path !== undefined) this.path = options.path
    if (options.cause !== undefined) this.cause = options.cause
    if (options.childIds !== undefined) this.childIds = options.childIds
  }
}

/** Human-readable message for one arbitrary thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** The directory one relative document spec resolves against. */
function baseRoot(root) {
  return typeof root === 'string' && root.trim() !== '' ? resolve(root) : process.cwd()
}

/** Whether `target` is inside `base` (or equal to it) on the lexical path. */
function within(base, target) {
  const rel = relative(resolve(base), resolve(target))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** `realpath` that answers null instead of throwing. */
async function realpathOrNull(path) {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

/**
 * Resolve every existing ancestor symbolic link while allowing a missing suffix.
 *
 * A missing suffix is lexical: none of its components exists, so none can be a
 * symbolic link. An existing entry that cannot be resolved (a dangling symbolic
 * link, for example) answers null so callers refuse instead of writing through
 * it. Mirrors the fence in `lib/preferences.js` and `lib/orchestrator.js`.
 *
 * @param {string} path
 * @returns {Promise<string | null>} canonical prospective path, or null.
 */
async function realpathWithMissing(path) {
  let cursor = resolve(path)
  /** @type {string[]} */
  const suffix = []
  for (;;) {
    const real = await realpathOrNull(cursor)
    if (real !== null) return suffix.length === 0 ? real : join(real, ...suffix)
    let info = null
    try { info = await lstat(cursor) } catch { info = null }
    if (info !== null) return null
    const parent = dirname(cursor)
    if (parent === cursor) return null
    suffix.unshift(basename(cursor))
    cursor = parent
  }
}

/**
 * Whether one configured bindings file is a workspace-relative spec that would
 * escape every workspace root.
 *
 * A relative spec is workspace-owned state and must stay inside the root it is
 * resolved against. An absolute spec is an explicit, intentional shared-state
 * location (several workspaces may share one document); it is allowed as-is,
 * matching `lib/preferences.js` and `lib/orchestrator.js`.
 *
 * @param {unknown} fileSpec
 * @returns {boolean}
 */
export function bindingFileEscapesWorkspace(fileSpec) {
  if (typeof fileSpec !== 'string' || fileSpec.trim() === '') return false
  const spec = fileSpec.trim()
  return !isAbsolute(spec) && !within('.', spec)
}

/**
 * Refuse one configured bindings file that would escape its workspace.
 * @param {unknown} fileSpec
 * @returns {void}
 * @throws {TypeError} for a workspace-relative spec that escapes the root.
 */
export function assertBindingFileSpec(fileSpec) {
  if (bindingFileEscapesWorkspace(fileSpec)) {
    throw new TypeError(
      `agent-soul config.bindingsFile must be an absolute path or a workspace-relative path that does not escape the workspace: ${String(fileSpec)}`,
    )
  }
}

/**
 * Whether one parsed binding value has the shape this module writes.
 *
 * A tolerated read keeps the records that pass and reports the rest; a strict
 * transaction refuses the whole document so it can never rewrite (and thereby
 * drop) an entry it cannot validate.
 *
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
 *   `fileSpec` is absolute (intentional shared state, used verbatim for every
 *   root) or workspace-relative (fenced to the real workspace root, resolving
 *   symbolic links, before any I/O; a lexical or symlink escape is refused);
 *   `maxEntries` bounds each document, including all records when multiple
 *   roots intentionally share an absolute path.
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
  /**
   * @typedef {object} RootState
   * @property {Map<string, Record<string, unknown>>} entries - last revalidated snapshot plus local mutations.
   * @property {Map<string, Mutation>} pending - mutations not yet persisted.
   * @property {BindingStoreError | null} loadError - unreadable/corrupt/unsafe document, if any.
   * @property {BindingStoreError | null} corruption - malformed records filtered out of a tolerated read.
   * @property {Promise<void>} chain - serialized write attempts.
   */
  /** @type {Map<string, RootState>} */
  const roots = new Map()

  /**
   * Configured document path (kept stable for callers and diagnostics).
   *
   * This is the `..`-free lexical path a caller can display. A relative spec
   * resolves inside the workspace root and is refused when it would escape it
   * lexically; an absolute spec is used verbatim for every root, which is the
   * one intentional shared-state rule this store, the preferences document, and
   * the orchestrator document all follow. Document I/O uses
   * {@link documentPath}, which additionally resolves symbolic links.
   *
   * @param {string} root
   * @returns {string}
   * @throws {BindingStoreError} for a relative spec that escapes the root.
   */
  function filePath(root) {
    const path = isAbsolute(fileSpec) ? fileSpec : join(baseRoot(root), fileSpec)
    if (!isAbsolute(fileSpec) && !within(baseRoot(root), path)) {
      throw new BindingStoreError(
        BINDING_UNSAFE_PATH,
        `the workspace-relative bindings file escapes its workspace: ${fileSpec} (root ${String(root)}); use an absolute bindingsFile for intentional shared state`,
        { path },
      )
    }
    return path
  }

  /**
   * Resolve the document path for I/O and fence a workspace-relative spec to the
   * real workspace root.
   *
   * The lexical check in {@link filePath} cannot see a symbolic link: when
   * `<root>/.dsh` (or `<root>/.dsh/agent-soul`) points outside the workspace,
   * every binding read and write would silently follow it. Resolving the nearest
   * existing ancestor of the prospective document catches that case before any
   * I/O. An absolute spec is intentional shared state and is returned verbatim;
   * its directory, not the workspace, is the boundary.
   *
   * @param {string} root
   * @returns {Promise<string>}
   * @throws {BindingStoreError} for a relative spec that escapes the real root.
   */
  async function documentPath(root) {
    const path = filePath(root)
    if (isAbsolute(fileSpec)) return path
    const base = baseRoot(root)
    const realBase = await realpathOrNull(base) ?? await realpathWithMissing(base)
    if (realBase === null) {
      throw new BindingStoreError(
        BINDING_UNSAFE_PATH,
        `cannot resolve the real workspace root for the bindings file: ${base}`,
        { path },
      )
    }
    const realPath = await realpathWithMissing(path)
    if (realPath === null) {
      throw new BindingStoreError(
        BINDING_UNSAFE_PATH,
        `cannot resolve the real binding store path (a dangling symbolic link?): ${path}`,
        { path },
      )
    }
    if (!within(realBase, realPath)) {
      throw new BindingStoreError(
        BINDING_UNSAFE_PATH,
        `the workspace-relative bindings file escapes its real workspace through a symbolic link: ${fileSpec} (root ${base}); use an absolute bindingsFile for intentional shared state`,
        { path },
      )
    }
    return path
  }

  /**
   * Resolve the document path for a mutation: fence it, create the state
   * directory, then re-check because a link could have appeared before `mkdir`.
   * The returned path is canonical so the atomic write and its lock address the
   * same file every cooperating process would resolve.
   *
   * @param {string} root
   * @returns {Promise<string>}
   * @throws {BindingStoreError}
   */
  async function resolveWritablePath(root) {
    const path = await documentPath(root)
    await mkdir(dirname(path), { recursive: true })
    return await canonicalPath(await documentPath(root))
  }

  /** One root's last revalidated snapshot and uncommitted mutations, never a replacement snapshot. */
  function stateOf(root) {
    let state = roots.get(root)
    if (state === undefined) {
      state = {
        entries: new Map(),
        pending: new Map(),
        loadError: null,
        corruption: null,
        chain: Promise.resolve(),
      }
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

  /** Normalize one thrown value into a typed binding-store failure. */
  function asBindingFailure(error, path) {
    if (error instanceof BindingStoreError) return error
    return new BindingStoreError(
      BINDING_UNREADABLE,
      `cannot read the binding store ${path}: ${messageOf(error)}`,
      { path, cause: error },
    )
  }

  /**
   * Read one binding document.
   *
   * A missing document is an empty store. Every other failure is typed:
   * unreadable I/O, malformed JSON, an unsupported envelope, or a record that
   * does not have the shape this module writes. A tolerated read keeps the valid
   * records so unrelated bindings stay usable while the corruption is reported;
   * a strict read (a transaction) refuses the document entirely, so a mutation
   * can never rewrite records it cannot validate.
   *
   * @param {string} path
   * @param {{ strict?: boolean }} [options]
   * @returns {Promise<{ entries: Map<string, Record<string, unknown>>,
   *   corruption: BindingStoreError | null }>}
   */
  async function readEntries(path, options = {}) {
    const strict = options.strict === true
    let text
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return { entries: new Map(), corruption: null }
      throw asBindingFailure(error, path)
    }
    /** @type {unknown} */
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new BindingStoreError(
        BINDING_CORRUPT,
        `the binding store ${path} is not valid JSON (${messageOf(error)}); repair or remove it before bindings are rewritten`,
        { path, cause: error },
      )
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new BindingStoreError(
        BINDING_UNSUPPORTED,
        `the binding store ${path} is not a JSON object; repair or remove it before bindings are rewritten`,
        { path },
      )
    }
    const document = /** @type {Record<string, unknown>} */ (parsed)
    if (document.version !== BINDINGS_VERSION) {
      throw new BindingStoreError(
        BINDING_UNSUPPORTED,
        `the binding store ${path} uses unsupported version ${JSON.stringify(document.version)} (expected ${BINDINGS_VERSION}); repair or remove it before bindings are rewritten`,
        { path },
      )
    }
    if (typeof document.bindings !== 'object' || document.bindings === null || Array.isArray(document.bindings)) {
      throw new BindingStoreError(
        BINDING_UNSUPPORTED,
        `the binding store ${path} has no bindings object; repair or remove it before bindings are rewritten`,
        { path },
      )
    }
    const entries = new Map()
    /** @type {string[]} */
    const malformed = []
    for (const [childId, record] of Object.entries(/** @type {Record<string, unknown>} */ (document.bindings))) {
      if (isBindingRecord(record)) entries.set(childId, record)
      else malformed.push(childId)
    }
    if (malformed.length === 0) return { entries, corruption: null }
    const listed = malformed.slice(0, 5).join(', ')
    const corruption = new BindingStoreError(
      BINDING_CORRUPT,
      `the binding store ${path} contains ${malformed.length} malformed record(s): ${listed}${malformed.length > 5 ? ', …' : ''}; repair or remove them before bindings are rewritten`,
      { path, childIds: malformed },
    )
    if (strict) throw corruption
    return { entries, corruption }
  }

  /**
   * Re-read one root's document from disk before a read or mutation.
   *
   * The durable document, not this store's cache, is the cross-process source of
   * truth. Re-reading on every read is what makes another process's write, a
   * repair, or a new corruption visible without constructing a new store.
   * Pending local mutations are re-applied on top of the fresh snapshot so a
   * retained in-memory plan keeps its effect. A failed read keeps the previous
   * snapshot (including pending mutations) but records the typed failure, which
   * `get` propagates for every child without an unpersisted mutation.
   */
  async function refreshEntries(root, state) {
    /** @type {string} */
    let path = ''
    try {
      path = await documentPath(root)
      const { entries, corruption } = await readEntries(path)
      const previousCorruption = state.corruption
      state.entries = entries
      applyMutations(state.entries, state.pending)
      prune(state.entries)
      state.corruption = corruption
      state.loadError = null
      if (corruption !== null && (previousCorruption === null || previousCorruption.message !== corruption.message)) {
        logger?.warn(`agent-soul: ${corruption.message}`)
      }
    } catch (error) {
      const failure = asBindingFailure(error, path === '' ? root : path)
      // A polling read must not spam one persistent diagnostic.
      const previous = state.loadError
      state.loadError = failure
      if (previous === null || previous.message !== failure.message) {
        logger?.warn(`agent-soul: cannot refresh the binding store for ${String(root)}: ${messageOf(failure)}`)
      }
    }
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
      // Fence the state path before any directory/file I/O, then lock the
      // canonical document every cooperating process resolves.
      const path = await resolveWritablePath(root)
      await withFileLock(path, async () => {
        // Strict: a document this module cannot validate is never rewritten, so
        // a corrupt or unsupported file cannot erase unrelated valid records.
        const { entries } = await readEntries(path, { strict: true })
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
        // The strict read succeeded, so the document is trustworthy again.
        state.loadError = null
        state.corruption = null
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

    /**
     * One durable binding, or `undefined` when it was never written.
     *
     * The durable document is revalidated before every answer: a document that
     * became corrupt, unreadable, unsupported, unsafe, or partially malformed
     * after an earlier read rejects with its typed {@link BindingStoreError}
     * instead of returning a stale plan (admission must not apply a plan it
     * cannot fully verify). The one in-memory value served while the document is
     * unusable is an unpersisted local `set`/`delete` mutation for this child:
     * it is this process's newest intent and a later healthy write retries it,
     * so it is not a stale durable record. A write by another process or an
     * external repair becomes visible immediately because the document is
     * re-read on every call.
     *
     * @param {string} root
     * @param {string} childId
     * @returns {Promise<object | undefined>}
     * @throws {BindingStoreError}
     */
    async get(root, childId) {
      const state = stateOf(root)
      await refreshEntries(root, state)
      const mutation = state.pending.get(childId)
      if (state.loadError !== null) {
        if (mutation === undefined) throw state.loadError
        // Local intent is answerable even while the document cannot be read.
        return mutation.record === null ? undefined : fromRecord(mutation.record)
      }
      if (state.corruption !== null) {
        if (mutation === undefined) throw state.corruption
        // Local intent is answerable even beside an unrelated malformed record.
        return mutation.record === null ? undefined : fromRecord(mutation.record)
      }
      const record = state.entries.get(childId)
      return record === undefined ? undefined : fromRecord(record)
    },

    /**
     * Every retained binding for one root as a freshly allocated array, newest
     * first. The snapshot is refreshed from disk on every call (pending local
     * mutations are re-applied), so the usage panel sees another process's
     * writes. A missing document is an empty list; an unreadable or unsupported
     * one rejects with its typed {@link BindingStoreError}. Malformed records are filtered out of
     * a tolerated read and reported through the store warning instead of failing
     * the whole list. When the document itself is unreadable, unsupported, or
     * unsafe, the list rejects even if local mutations are pending: only `get`
     * answers a pending child's intent, and `list` describes the durable
     * document. Entries with equal timestamps fall back to ascending Session id
     * so the order is deterministic.
     *
     * @param {string} root
     * @returns {Promise<Array<{ childId: string, name: string, tools: string[] | null,
     *   model: { provider: string, model: string, reasoningEffort?: string } | null,
     *   context: 'fresh' | 'fork' | null, sourceLabel: string, savedAt: number }>>}
     * @throws {BindingStoreError}
     */
    async list(root) {
      const state = stateOf(root)
      await refreshEntries(root, state)
      if (state.loadError !== null) throw state.loadError
      const rows = []
      for (const [childId, record] of state.entries) rows.push(toListRow(childId, record))
      rows.sort((left, right) => right.savedAt - left.savedAt
        || (left.childId < right.childId ? -1 : left.childId > right.childId ? 1 : 0))
      return rows
    },

    /**
     * Persist one binding.
     *
     * A snapshot that cannot be represented as a valid durable record rejects
     * with {@link BindingStoreError} instead of writing a document this store's
     * revalidated read would refuse. I/O and document failures stay
     * diagnostic-only: the pending mutation is retained for a later healthy
     * write.
     *
     * @param {string} root
     * @param {string} childId
     * @param {object} snapshot
     * @returns {Promise<void>}
     * @throws {BindingStoreError}
     */
    async set(root, childId, snapshot) {
      const state = stateOf(root)
      await refreshEntries(root, state)
      /** @type {Record<string, unknown>} */
      let record
      try {
        record = toRecord(snapshot)
      } catch (error) {
        throw new BindingStoreError(
          BINDING_INVALID_RECORD,
          `refusing to persist a malformed Agent Soul binding for ${String(childId)}: ${messageOf(error)}`,
          { childIds: [String(childId)], cause: error },
        )
      }
      // Never write a record the revalidated read must refuse as malformed: a
      // caller bug must not poison the whole store and block every admission.
      if (!isBindingRecord(record)) {
        throw new BindingStoreError(
          BINDING_INVALID_RECORD,
          `refusing to persist a malformed Agent Soul binding for ${String(childId)}: name, persona, tools, model, and savedAt must have the documented shape`,
          { childIds: [String(childId)] },
        )
      }
      state.entries.set(childId, record)
      state.pending.set(childId, { record })
      prune(state.entries)
      await enqueueWrite(root, state)
    },

    async delete(root, childId) {
      const state = stateOf(root)
      await refreshEntries(root, state)
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

    /**
     * The number of retained bindings for one root.
     *
     * The snapshot is refreshed from disk on every call (pending local mutations
     * are re-applied). An unusable document rejects with its typed
     * {@link BindingStoreError} instead of reporting a misleading zero; a
     * partially corrupt document reports the count of its valid records (the
     * corruption is warned about).
     *
     * @param {string} root
     * @returns {Promise<number>}
     * @throws {BindingStoreError}
     */
    async size(root) {
      const state = stateOf(root)
      await refreshEntries(root, state)
      if (state.loadError !== null) throw state.loadError
      return state.entries.size
    },
  }
}
