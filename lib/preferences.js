/**
 * Plugin-owned Agent Soul preferences.
 *
 * The one preference this plugin stores is the default Agent Soul: the soul a
 * teammate runs when `spawn_teammate` omits `agent_type`. It lives beside the
 * durable bindings document (default `.dsh/agent-soul/preferences.json` per
 * workspace, anchored by the configured `bindingsFile`) so every piece of
 * plugin state shares one state directory.
 *
 * Reads never throw: a missing document means "no explicit selection"; a
 * corrupt or unsupported document is reported as a warning with an empty
 * selection so the Settings page can show it. Default spawn fails closed on
 * that warning rather than continuing through {@link resolveDefaultSoul}'s
 * fallback chain; an explicit `agent_type` remains a separate path. Writes are
 * atomic (temporary file in the same directory + `rename`) and refuse a
 * symbolic-link escape out of the state directory, mirroring
 * `lib/orchestrator.js`.
 *
 * @module @local/dsh-agent-soul/preferences
 */

import { lstat, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** Default bindings document when the composition did not configure one. */
const DEFAULT_BINDINGS_FILE = join('.dsh', 'agent-soul', 'bindings.json')

/** File name beside the bindings document. */
export const PREFERENCES_FILE_NAME = 'preferences.json'

/** On-disk format version. */
export const PREFERENCES_VERSION = 1

/**
 * Fallback name used with no explicit selection: the live catalog's
 * `generalist` (normally bundled), with no catalog-provenance requirement.
 */
export const BUILTIN_DEFAULT_SOUL = 'generalist'

/** Valid soul name accepted by a persisted selection. */
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Monotonic suffix so two writes in the same millisecond never share a temp name. */
let temporaryCounter = 0

/**
 * Human-readable message for one arbitrary thrown value.
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether one value is a plain (non-array) object.
 * @param {unknown} value
 * @returns {boolean}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The absolute workspace root relative specs resolve against.
 * @param {unknown} root
 * @returns {string}
 */
function baseRoot(root) {
  return typeof root === 'string' && root.trim() !== '' ? resolve(root) : process.cwd()
}

/**
 * Whether `target` is inside `base` (or equal to it) on the lexical path.
 * @param {string} base
 * @param {string} target
 * @returns {boolean}
 */
function within(base, target) {
  const rel = relative(resolve(base), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * `realpath` that answers null instead of throwing.
 * @param {string} path
 * @returns {Promise<string | null>}
 */
async function realpathOrNull(path) {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

/**
 * Resolve every existing ancestor symlink while allowing a missing suffix.
 * @param {string} path
 * @returns {Promise<string | null>}
 */
async function realpathWithMissing(path) {
  let cursor = resolve(path)
  /** @type {string[]} */
  const suffix = []
  while (true) {
    const real = await realpathOrNull(cursor)
    if (real !== null) return join(real, ...suffix)
    const info = await lstatOrNull(cursor)
    if (info !== null) return null
    const parent = dirname(cursor)
    if (parent === cursor) return null
    suffix.unshift(basename(cursor))
    cursor = parent
  }
}

/**
 * `stat` that answers null instead of throwing.
 * @param {string} path
 * @returns {Promise<import('node:fs').Stats | null>}
 */
async function statOrNull(path) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

/**
 * `lstat` that answers null instead of throwing.
 * @param {string} path
 * @returns {Promise<import('node:fs').Stats | null>}
 */
async function lstatOrNull(path) {
  try {
    return await lstat(path)
  } catch {
    return null
  }
}

/**
 * The absolute preferences document path for one workspace root.
 *
 * The document sits in the same directory as the resolved bindings document;
 * the default configuration (`.dsh/agent-soul/bindings.json`) therefore yields
 * `<root>/.dsh/agent-soul/preferences.json`.
 *
 * @param {{ bindingsFile?: unknown } | undefined} config - normalized plugin config.
 * @param {unknown} root - workspace root for a relative bindings file.
 * @returns {string} absolute path (the file may not exist).
 */
export function preferencesPathOf(config, root) {
  const base = baseRoot(root)
  const spec = typeof config?.bindingsFile === 'string' && config.bindingsFile.trim() !== ''
    ? config.bindingsFile.trim()
    : DEFAULT_BINDINGS_FILE
  const bindingsFile = isAbsolute(spec) ? resolve(spec) : resolve(base, spec)
  return join(dirname(bindingsFile), PREFERENCES_FILE_NAME)
}

/**
 * Resolve the state directory boundary shared with the bindings document.
 * @param {object | undefined} config
 * @param {unknown} root
 * @returns {{ base: string, relativeSpec: boolean, stateDirectory: string, path: string }}
 */
function locationOf(config, root) {
  const base = baseRoot(root)
  const spec = typeof config?.bindingsFile === 'string' && config.bindingsFile.trim() !== ''
    ? config.bindingsFile.trim()
    : DEFAULT_BINDINGS_FILE
  const relativeSpec = !isAbsolute(spec)
  const bindingsFile = relativeSpec ? resolve(base, spec) : resolve(spec)
  const stateDirectory = dirname(bindingsFile)
  return { base, relativeSpec, stateDirectory, path: join(stateDirectory, PREFERENCES_FILE_NAME) }
}

/**
 * Validate the shared read/write path before any document I/O.
 *
 * A relative bindings file is workspace-owned: both its lexical path and its
 * real path (including existing ancestors of a missing suffix) must remain in
 * the real workspace root. An absolute bindings file explicitly places the
 * state directory outside the workspace, so its real state directory is the
 * boundary instead. An existing final link must resolve to a regular file
 * inside the real state directory.
 *
 * @param {object | undefined} config
 * @param {unknown} root
 * @param {{ stateMustExist?: boolean }} [options]
 * @returns {Promise<{ ok: true } | { ok: false, code: 'unsafe-path', message: string }>}
 */
async function checkPreferencesPath(config, root, options = {}) {
  const { base, relativeSpec, stateDirectory, path } = locationOf(config, root)
  const unsafe = message => ({ ok: false, code: 'unsafe-path', message })
  if (!path.toLowerCase().endsWith('.json')) {
    return unsafe(`the preferences path must end with .json: ${path}`)
  }
  if (relativeSpec && !within(base, stateDirectory)) {
    return unsafe(`the relative preferences state path escapes its workspace: ${stateDirectory}`)
  }

  const realBase = relativeSpec ? await realpathOrNull(base) : null
  if (relativeSpec && realBase === null) {
    return unsafe(`cannot resolve the real preferences workspace root: ${base}`)
  }
  const stateInfo = await lstatOrNull(stateDirectory)
  const realState = await realpathOrNull(stateDirectory)
  if (stateInfo !== null) {
    const targetInfo = await statOrNull(stateDirectory)
    if (realState === null || targetInfo === null || !targetInfo.isDirectory()) {
      return unsafe(`the preferences state path is not a resolvable directory: ${stateDirectory}`)
    }
  }
  if (options.stateMustExist === true && realState === null) {
    return unsafe(`the preferences state directory does not exist after creation: ${stateDirectory}`)
  }
  const resolvedState = realState ?? await realpathWithMissing(stateDirectory)
  if (resolvedState === null) {
    return unsafe(`cannot resolve the real preferences state directory: ${stateDirectory}`)
  }
  if (relativeSpec && !within(realBase, resolvedState)) {
    return unsafe(`the preferences state path escapes the real workspace through a symbolic link: ${stateDirectory}`)
  }

  const info = await lstatOrNull(path)
  if (info === null) return { ok: true }
  const targetInfo = await statOrNull(path)
  const realTarget = await realpathOrNull(path)
  if (realState === null || realTarget === null || targetInfo === null || !targetInfo.isFile()) {
    return unsafe(`the preferences path is not a regular file: ${path}`)
  }
  if (!within(realState, realTarget)) {
    return unsafe(`the preferences path escapes its real state directory through a symbolic link: ${path}`)
  }
  return { ok: true }
}

/**
 * Atomic UTF-8 write: temp file in the target directory, then `rename`.
 * @param {string} target - absolute file path whose parent directory exists.
 * @param {string} source
 * @returns {Promise<void>}
 */
async function writeAtomic(target, source) {
  const directory = dirname(target)
  temporaryCounter += 1
  const temporary = join(directory, `${basename(target)}.${process.pid}.${temporaryCounter}.tmp`)
  await writeFile(temporary, source, 'utf8')
  try {
    await rename(temporary, target)
  } catch (error) {
    try {
      await unlink(temporary)
    } catch {
      // The rename failure is the meaningful error; cleanup is best-effort.
    }
    throw error
  }
}

/**
 * Read the preferences document for one workspace root.
 *
 * @param {{ config?: object, root?: string } | undefined} options
 * @returns {Promise<{ ok: true, preferences: { path: string, selected: string | null,
 *   warning: string | null } } |
 *   { ok: false, code: 'unsafe-path' | 'invalid-request', message: string }>}
 */
export async function readPreferences(options = {}) {
  const path = preferencesPathOf(options.config, options.root)
  const safe = await checkPreferencesPath(options.config, options.root)
  if (!safe.ok) return safe
  /** @type {string} */
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error).code === 'ENOENT'
      || /** @type {{ code?: string }} */ (error).code === 'ENOTDIR') {
      return { ok: true, preferences: { path, selected: null, warning: null } }
    }
    return { ok: false, code: 'invalid-request', message: `cannot read the Agent Soul preferences: ${messageOf(error)}` }
  }
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      ok: true,
      preferences: { path, selected: null, warning: `ignoring an unreadable preferences document at ${path}` },
    }
  }
  if (!isRecord(parsed) || parsed.version !== PREFERENCES_VERSION) {
    return {
      ok: true,
      preferences: {
        path,
        selected: null,
        warning: `ignoring an invalid preferences document with an unsupported version at ${path}`,
      },
    }
  }
  if (!Object.hasOwn(parsed, 'selected')) {
    return {
      ok: true,
      preferences: {
        path,
        selected: null,
        warning: `ignoring an invalid preferences document at ${path}: missing "selected"`,
      },
    }
  }
  const rawSelected = parsed.selected
  /** @type {string | null} */
  let selected = null
  /** @type {string | null} */
  let problem = null
  if (rawSelected !== null) {
    if (typeof rawSelected !== 'string') {
      problem = '"selected" must be a soul name string or null'
    } else {
      const candidate = rawSelected.trim()
      if (candidate === '') problem = '"selected" must not be blank; use null to clear it'
      else if (candidate.length > 64 || !NAME_PATTERN.test(candidate)) {
        problem = '"selected" must be a lower-kebab-case soul name of at most 64 characters'
      } else selected = candidate
    }
  }
  if (problem !== null) {
    return {
      ok: true,
      preferences: {
        path,
        selected: null,
        warning: `ignoring an invalid preferences document at ${path}: ${problem}`,
      },
    }
  }
  return { ok: true, preferences: { path, selected, warning: null } }
}

/**
 * Atomically persist one default-soul selection (or clear it with null).
 *
 * The caller is responsible for validating the name against the live catalog;
 * this layer enforces only the persisted shape and the file-path boundary.
 *
 * @param {{ config?: object, root?: string, selected?: unknown } | undefined} options
 * @returns {Promise<{ ok: true, preferences: { path: string, selected: string | null,
 *   warning: string | null } } |
 *   { ok: false, code: 'unsafe-path' | 'invalid-request', message: string }>}
 */
export async function savePreferences(options = {}) {
  const raw = options.selected
  if (raw !== null && raw !== undefined && typeof raw !== 'string') {
    return { ok: false, code: 'invalid-request', message: 'selected must be a soul name or null' }
  }
  const candidate = typeof raw === 'string' ? raw.trim() : ''
  const selected = candidate === '' ? null : candidate
  if (selected !== null && (selected.length > 64 || !NAME_PATTERN.test(selected))) {
    return {
      ok: false,
      code: 'invalid-request',
      message: 'selected must be a lower-kebab-case soul name of at most 64 characters',
    }
  }
  const path = preferencesPathOf(options.config, options.root)
  const safe = await checkPreferencesPath(options.config, options.root)
  if (!safe.ok) return safe
  try {
    await mkdir(dirname(path), { recursive: true })
  } catch (error) {
    return { ok: false, code: 'invalid-request', message: `cannot write the Agent Soul preferences: ${messageOf(error)}` }
  }
  // Directory creation can traverse a changed or newly visible symlink. Check
  // the now-real state directory again before creating the temporary file.
  const createdSafe = await checkPreferencesPath(options.config, options.root, { stateMustExist: true })
  if (!createdSafe.ok) return createdSafe
  const document = { version: PREFERENCES_VERSION, selected }
  try {
    await writeAtomic(path, `${JSON.stringify(document, null, 2)}\n`)
  } catch (error) {
    return { ok: false, code: 'invalid-request', message: `cannot write the Agent Soul preferences: ${messageOf(error)}` }
  }
  return readPreferences({ config: options.config, root: options.root })
}

/**
 * Resolve the effective default soul from one selection and a live catalog
 * snapshot.
 *
 * An explicit selection wins and must exist in the catalog: a stale selection
 * fails loudly instead of silently falling back, because a silent fallback
 * would make a configured default impossible to debug. With no explicit
 * selection, the live catalog entry named by `builtinName` (`generalist` by
 * default) is used when present. The default is normally bundled, but no
 * provenance is required: workspace-only, shadowing, and `bundled: false`
 * definitions are accepted. When neither is usable the result is an actionable
 * failure — never a generic no-soul child.
 *
 * @param {{ selected?: string | null, definitions?: object[],
 *   builtinName?: string }} [input]
 * @returns {{ ok: true, soul: object, name: string, source: 'selection' | 'builtin',
 *   available: string[] } |
 *   { ok: false, name: string | null, source: 'selection' | 'none',
 *     available: string[], warning: string }}
 */
export function resolveDefaultSoul(input = {}) {
  const definitions = Array.isArray(input.definitions) ? input.definitions : []
  const byName = new Map()
  for (const definition of definitions) {
    if (isRecord(definition) && typeof definition.name === 'string' && definition.name !== '') {
      byName.set(definition.name, definition)
    }
  }
  const available = [...byName.keys()].sort()
  const builtinName = typeof input.builtinName === 'string' && input.builtinName !== ''
    ? input.builtinName
    : BUILTIN_DEFAULT_SOUL
  const selected = typeof input.selected === 'string' && input.selected.trim() !== ''
    ? input.selected.trim()
    : null
  if (selected !== null) {
    const soul = byName.get(selected)
    if (soul !== undefined) return { ok: true, soul, name: selected, source: 'selection', available }
    return {
      ok: false,
      name: selected,
      source: 'selection',
      available,
      warning: `the selected default Agent Soul "${selected}" is not in the live catalog`,
    }
  }
  const builtin = byName.get(builtinName)
  if (builtin !== undefined) {
    return { ok: true, soul: builtin, name: builtinName, source: 'builtin', available }
  }
  return {
    ok: false,
    name: null,
    source: 'none',
    available,
    warning: `no default Agent Soul is selected and the bundled "${builtinName}" soul is not in the live catalog`,
  }
}

/**
 * The GUI-facing preference block: persisted selection plus the effective
 * default and the reason it is or is not usable.
 *
 * `warning` marks the preferences document itself as unusable (corrupt shape,
 * malformed selection, unsupported version, or an unsafe path). Such a
 * document is never reinterpreted as "no selection": the block reports
 * `valid: false`, no effective default, and the diagnostic, matching the
 * spawn path's fail-closed behavior.
 *
 * @param {{ path?: string, selected?: string | null, definitions?: object[],
 *   builtinName?: string, warning?: string | null }} [input]
 * @returns {{ path: string, selected: string | null, effective: string | null,
 *   source: 'selection' | 'builtin' | 'none', valid: boolean,
 *   warning: string | null, available: string[] }}
 */
export function describePreferences(input = {}) {
  const resolved = resolveDefaultSoul(input)
  const override = typeof input.warning === 'string' && input.warning !== '' ? input.warning : null
  const documentUsable = override === null
  return {
    path: typeof input.path === 'string' ? input.path : '',
    selected: typeof input.selected === 'string' && input.selected !== '' ? input.selected : null,
    effective: documentUsable && resolved.ok ? resolved.name : null,
    source: documentUsable && resolved.ok ? resolved.source : 'none',
    valid: documentUsable && resolved.ok,
    warning: override ?? (resolved.ok ? null : resolved.warning),
    available: resolved.available,
  }
}

/**
 * Create the preference store shared by the spawn path and the GUI routes.
 *
 * @param {{ config?: object }} [options]
 * @returns {{ path(root: string): string,
 *   get(root: string): Promise<object>, set(root: string, selected: unknown): Promise<object> }}
 */
export function createPreferenceStore(options = {}) {
  const config = options.config
  return {
    path(root) {
      return preferencesPathOf(config, root)
    },
    async get(root) {
      return await readPreferences({ config, root })
    },
    async set(root, selected) {
      return await savePreferences({ config, root, selected })
    },
  }
}
