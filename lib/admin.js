/** Agent Soul document layer: split, compose, validate, scan, read, save, create, delete.
 *
 * This is the "one operation, two callers" layer of the Agent Soul plugin: the
 * Web GUI routes (`lib/gui-host.js`) and the Lead's `manage_agent_souls` tool
 * both go through these functions, so a document saved by a human and one saved
 * by the model cannot diverge.
 *
 * Every write is atomic (temporary file in the same directory + `rename`, or
 * hard-link publication when replacement is forbidden) and every path must
 * resolve inside one of the configured soul directories;
 * existing targets are also checked through `realpath` so a symbolic link cannot
 * escape the directory. Malformed documents are tolerated by `splitDocument`
 * (editable best-effort fields) and refused by `composeDocument`/`saveDocument`.
 *
 * Documents carry a `hash` (SHA-256 of the on-disk text) and a `modifiedAt`
 * timestamp; a save may pass the `expectedHash` it last loaded and is then
 * refused with `conflict` when the file changed or vanished (optimistic
 * concurrency for the GUI). Canonical-target queues serialize plugin callers in
 * this process; they deliberately do not claim cross-process external CAS.
 * An optional caller-supplied `validate(definition)`
 * callback adds semantic diagnostics (the GUI's tool/model/duplicate-name
 * checks) after the parser accepts the composed document.
 *
 * P1 editing operations build on those primitives: `createDocument` can write a
 * validated caller-supplied source instead of the skeleton, `duplicateDocument`
 * composes a renamed copy, and delete is recoverable — the file moves to the
 * trash directory beside the configured bindings document and `restoreDocument`
 * moves it back.
 *
 * Only `node:` builtins and the plugin's own parser are imported: the plugin
 * loads from a profile where this package's dependencies do not resolve.
 *
 * @module @local/dsh-agent-soul/admin
 */

import { createHash } from 'node:crypto'
import { link, lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { BUNDLED_SOULS_DIR, parseSoulMarkdown, parseFrontmatter } from './soul.js'

/** Valid teammate name: lower-kebab-case (mirrors `lib/soul.js`). */
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
/** Maximum soul name length (mirrors `lib/soul.js`). */
const MAX_NAME_CHARS = 64
/** Recursive scan limit for nested soul directories. */
const MAX_DEPTH = 8
/** Maximum bytes read from or written to one soul document. */
const MAX_SOUL_FILE_BYTES = 1024 * 1024
/** Maximum files read by one administrative scan across every configured directory. */
const MAX_SCAN_FILES = 1000
/** Reserved Team role name: a soul may not create a file for it. */
const RESERVED_NAME = 'lead'
/** Workspace-relative fallback location of the recoverable trash directory. */
const TRASH_DIR_SEGMENTS = Object.freeze(['.dsh', 'agent-soul', 'trash'])

/** Canonical frontmatter keys this layer composes; every other key is passed through. */
const KNOWN_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'tools',
  'model',
  'provider',
  'reasoning-effort',
  'context',
  'user-invocable',
])

/** Canonical body sections in composition order. */
const SECTION_HEADINGS = [
  { key: 'role', title: 'Role Definition' },
  { key: 'inputs', title: 'Inputs You Will See' },
  { key: 'rules', title: 'Hard Rules' },
  { key: 'output', title: 'Output Format' },
]

/** Lowercased heading title -> canonical section key. */
const SECTION_TITLE_TO_KEY = new Map(
  SECTION_HEADINGS.map(({ key, title }) => [title.toLowerCase(), key]),
)

/** A YAML plain scalar this layer is willing to emit without quoting. */
const PLAIN_SCALAR_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9 _.,;()/@+-]*$/u
/** Values a plain YAML scalar would parse as something other than a string. */
const NON_STRING_SCALAR_PATTERN = /^(?:true|True|TRUE|false|False|FALSE|null|Null|NULL|~|-?(?:0|[1-9]\d*)(?:\.\d+)?)$/u

/** A line that opens a canonical or custom body heading (one or two `#`). */
const HEADING_PATTERN = /^(#{1,2})[ \t]+(.+?)[ \t]*#*[ \t]*$/u
/** A top-level frontmatter mapping key line. */
const FRONTMATTER_KEY_PATTERN = /^([A-Za-z][A-Za-z0-9_-]*)[ \t]*:/

/** Monotonic suffix so two writes in the same millisecond never share a temp name. */
let temporaryCounter = 0

/**
 * Process-local mutation queues keyed by canonical target. This closes races
 * between plugin callers in this Host only: it is not a portable cross-process
 * compare-and-swap. No-replace hard-link publication separately protects create
 * and restore operations from external writers, but expectedHash is not external CAS.
 * @type {Map<string, Promise<void>>}
 */
const mutationTails = new Map()

/**
 * SHA-256 hex digest of one document's text.
 *
 * The browser half sends back the hash it last loaded as `expectedHash`; a save
 * whose target no longer matches that hash is refused with `conflict`, so
 * concurrent plugin editors in this Host cannot silently overwrite each other.
 *
 * @param {unknown} source - complete document text (absent values hash as '').
 * @returns {string} 64 lowercase hex characters.
 */
export function documentHash(source) {
  const text = typeof source === 'string' ? source : source === undefined || source === null ? '' : String(source)
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

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
 * Read one display string, coercing non-strings and treating absent values as ''.
 * @param {unknown} value
 * @returns {string}
 */
function textOf(value) {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value.trim() : String(value)
}

/**
 * The absolute workspace root this layer resolves relative specs against.
 * @param {unknown} root
 * @returns {string}
 */
function baseRoot(root) {
  return typeof root === 'string' && root.trim() !== '' ? resolve(root) : process.cwd()
}

/**
 * Log one warning through an optional logger, swallowing logger failures.
 * @param {{ warn?: (message: string) => void } | undefined} logger
 * @param {string} message
 * @returns {void}
 */
function warn(logger, message) {
  try {
    if (typeof logger?.warn === 'function') logger.warn(`agent-soul: ${message}`)
  } catch {
    // Logging must never break a document operation.
  }
}

/**
 * Resolve one configured directory spec: absolute, `~`/`~/…`, or workspace-relative.
 * @param {string} root
 * @param {string} spec
 * @returns {string}
 */
function resolveDirectorySpec(root, spec) {
  const text = spec.trim()
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return resolve(homedir(), text.slice(2))
  return isAbsolute(text) ? resolve(text) : resolve(root, text)
}

/**
 * Absolute soul directories for one workspace root.
 *
 * Entries may be absolute, `~/…`, or relative to `root`; duplicates are removed
 * after resolution. Directories that do not exist are still listed (callers that
 * must write decide whether an existing directory is required).
 *
 * @param {{ dirs?: unknown } | undefined} config - normalized plugin config.
 * @param {string} root - workspace root the relative entries resolve against.
 * @returns {string[]} absolute directory paths, in configured order.
 */
export function resolveSoulDirs(config, root) {
  const base = baseRoot(root)
  const specs = Array.isArray(config?.dirs) ? config.dirs : []
  const seen = new Set()
  const dirs = []
  for (const spec of specs) {
    if (typeof spec !== 'string' || spec.trim() === '') continue
    const dir = resolveDirectorySpec(base, spec)
    if (seen.has(dir)) continue
    seen.add(dir)
    dirs.push(dir)
  }
  return dirs
}

/**
 * The packaged bundled soul directory when bundled content is enabled.
 *
 * The document layer treats this directory as read-only by default: its souls
 * can be opened and duplicated, but not edited or deleted in place. Setting
 * `bundledEditable: true` opts into in-place authoring instead. A local soul
 * with the same name shadows a packaged copy either way.
 *
 * @param {{ bundled?: unknown } | undefined} config - normalized plugin config.
 * @returns {string | null} absolute directory, or null when bundled content is off.
 */
export function bundledSoulsDir(config) {
  return config?.bundled === false ? null : BUNDLED_SOULS_DIR
}

/**
 * Whether the packaged bundled documents are editable in place.
 *
 * Opt-in authoring mode: when `bundledEditable` is true and the packaged
 * catalog is enabled, a document canonically inside {@link BUNDLED_SOULS_DIR}
 * keeps its packaged identity (package-relative label, shadow semantics) but is
 * reported as editable and accepts writes, deletes, and restores. The flag is
 * inert while `bundled` is false because the packaged catalog is not scanned.
 *
 * @param {{ bundled?: unknown, bundledEditable?: unknown } | undefined} config -
 *   normalized plugin config.
 * @returns {boolean} true when packaged documents may be edited in place.
 */
export function bundledEditableEnabled(config) {
  return bundledSoulsDir(config) !== null && config?.bundledEditable === true
}

/**
 * The workspace root the GUI edits: `workingDirectory.defaultDirectory`, else `process.cwd()`.
 * @param {object | undefined} ctx - plugin or Agent context carrying optional services.
 * @returns {string} an absolute directory.
 */
export function resolveGuiRoot(ctx) {
  try {
    const workingDirectory = typeof ctx?.get === 'function' ? ctx.get('workingDirectory') : undefined
    if (isRecord(workingDirectory)) {
      const directory = workingDirectory.defaultDirectory
      if (typeof directory === 'string' && directory.trim() !== '') return resolve(directory)
    }
  } catch {
    // A composition without the working-directory service falls back to cwd.
  }
  return process.cwd()
}

/**
 * Display label for one file: root-relative when inside `root`, absolute otherwise.
 * @param {string} root
 * @param {string} file
 * @returns {string}
 */
function labelOf(root, file) {
  const rel = relative(root, file)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? rel : file
}

/**
 * Whether `target` is inside `base` (or equal to it) on the lexical path.
 * @param {string} base
 * @param {string} target
 * @returns {boolean}
 */
function within(base, target) {
  const rel = relative(base, target)
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
 * Real path of `path`, or of its nearest existing ancestor with the missing
 * suffix appended back.
 *
 * `realpath` fails for a directory that does not exist yet, which is exactly the
 * case an implicit `mkdir` creates. Resolving the nearest existing ancestor
 * first reveals the physical directory `mkdir` would write into (a symlinked
 * `.dsh`, for example), so the caller can refuse before anything is created.
 * The appended suffix is lexical: none of its components exists, so none can be
 * a symbolic link.
 *
 * @param {string} path
 * @returns {Promise<string | null>} canonical prospective path, or null at the filesystem root.
 */
async function realpathOrAncestor(path) {
  let current = resolve(path)
  /** @type {string[]} */
  const suffix = []
  for (;;) {
    const real = await realpathOrNull(current)
    if (real !== null) return suffix.length === 0 ? real : join(real, ...suffix.reverse())
    const parent = dirname(current)
    if (parent === current) return null
    suffix.push(basename(current))
    current = parent
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

/** Canonical identity of an existing target, or canonical-parent + basename for a new one. */
async function canonicalMutationTarget(target) {
  const existing = await realpathOrNull(target)
  if (existing !== null) return existing
  const parent = await realpathOrNull(dirname(target))
  return join(parent ?? dirname(target), basename(target))
}

/** Acquire one already-resolved canonical key without unhandled queue rejections. */
async function acquireMutationLock(key) {
  const previous = mutationTails.get(key) ?? Promise.resolve()
  let release
  const current = new Promise(resolve => { release = resolve })
  const tail = previous.then(() => current)
  mutationTails.set(key, tail)
  await previous
  return () => {
    release()
    if (mutationTails.get(key) === tail) mutationTails.delete(key)
  }
}

/** Serialize a mutation on all involved canonical targets, in deadlock-free key order. */
async function withMutationLocks(targets, operation) {
  const keys = [...new Set(await Promise.all(targets.map(canonicalMutationTarget)))].sort()
  const releases = []
  try {
    for (const key of keys) releases.push(await acquireMutationLock(key))
    return await operation()
  } finally {
    for (const release of releases.reverse()) release()
  }
}

/**
 * Serialize name-changing publications per workspace. Target locks alone cannot
 * prevent two different filenames from concurrently introducing one frontmatter name.
 */
async function withNameUniquenessLock(root, operation) {
  const canonicalRoot = await realpathOrNull(root) ?? resolve(root)
  const release = await acquireMutationLock(`soul-names:${canonicalRoot}`)
  try { return await operation() } finally { release() }
}

/**
 * Current on-disk state of one document target: its hash and modifiedAt.
 * @param {string} target
 * @returns {Promise<{ hash: string, modifiedAt: number } | null>} null when missing/unreadable.
 */
async function currentDocumentState(target) {
  const info = await statOrNull(target)
  if (info === null || !info.isFile() || info.size > MAX_SOUL_FILE_BYTES) return null
  try {
    const source = await readFile(target, 'utf8')
    return { hash: documentHash(source), modifiedAt: Math.trunc(info.mtimeMs) }
  } catch {
    return null
  }
}

/**
 * Optimistic-concurrency refusal for one save target.
 *
 * `currentHash`/`currentModifiedAt` describe what is on disk now (null/0 when the
 * file was removed), so the browser can offer "Reload file" or "Overwrite".
 *
 * @param {string} target
 * @param {{ hash: string, modifiedAt: number } | null} current
 * @returns {{ ok: false, code: 'conflict', message: string, currentHash: string | null,
 *   currentModifiedAt: number }}
 */
function conflictOf(target, current) {
  return {
    ok: false,
    code: 'conflict',
    message: current === null
      ? `the document was removed since it was loaded: ${target}`
      : `the document changed on disk since it was loaded: ${target}`,
    currentHash: current === null ? null : current.hash,
    currentModifiedAt: current === null ? 0 : current.modifiedAt,
  }
}

/** expectedMissing refusal: a target appeared before the no-replace publication. */
function missingConflictOf(target, current) {
  return {
    ok: false,
    code: 'conflict',
    message: `the document already exists and was expected to be missing: ${target}`,
    currentHash: current === null ? null : current.hash,
    currentModifiedAt: current === null ? 0 : current.modifiedAt,
  }
}

/** Check optimistic guards while the caller holds the target's process-local lock. */
async function checkSaveGuard(target, expectedHash, expectedMissing) {
  if (expectedMissing !== true && typeof expectedHash !== 'string') return null
  const current = await currentDocumentState(target)
  if (expectedMissing === true) return current === null ? null : missingConflictOf(target, current)
  if (current === null || current.hash !== expectedHash) return conflictOf(target, current)
  return null
}

/** True when one in-memory source exceeds the document byte budget. */
function sourceExceedsLimit(source) {
  return typeof source === 'string' && Buffer.byteLength(source, 'utf8') > MAX_SOUL_FILE_BYTES
}

/**
 * Map parser diagnostics to the document-layer wire shape.
 *
 * The parser may tag a diagnostic with the frontmatter `field` it applies to
 * (the reserved `lead` name is one). Preserving that tag lets the GUI focus the
 * matching control instead of showing an unfocused banner.
 *
 * @param {{ source?: string, message: string, field?: string }[]} diagnostics
 * @returns {{ message: string, field?: string }[]}
 */
function parserDiagnostics(diagnostics) {
  /** @type {{ message: string, field?: string }[]} */
  const mapped = []
  for (const diagnostic of diagnostics) {
    /** @type {{ message: string, field?: string }} */
    const entry = { message: diagnostic.message }
    if (typeof diagnostic.field === 'string' && diagnostic.field !== '') entry.field = diagnostic.field
    mapped.push(entry)
  }
  return mapped
}

/**
 * Normalize one caller-supplied `validate(definition)` result into diagnostics.
 *
 * The documented shape is `{ diagnostics: [{ message, field? }] }`; a bare array
 * is accepted too. A callback that throws is treated as a refusal (never as a
 * write), so a validator bug cannot become an unhandled failure.
 *
 * @param {((definition: object) => unknown) | undefined} validate
 * @param {object} definition - the parsed definition the save would write.
 * @returns {Promise<{ message: string, field?: string }[]>} normalized diagnostics.
 */
async function validationDiagnostics(validate, definition) {
  if (typeof validate !== 'function') return []
  /** @type {unknown} */
  let result
  try {
    result = await validate(definition)
  } catch (error) {
    return [{ message: `cannot validate the soul document: ${messageOf(error)}` }]
  }
  const items = Array.isArray(result)
    ? result
    : isRecord(result) && Array.isArray(result.diagnostics) ? result.diagnostics : []
  /** @type {{ message: string, field?: string }[]} */
  const diagnostics = []
  for (const item of items) {
    if (typeof item === 'string') {
      const message = item.trim()
      if (message !== '') diagnostics.push({ message })
      continue
    }
    if (!isRecord(item)) continue
    const message = typeof item.message === 'string' ? item.message.trim() : ''
    if (message === '') continue
    /** @type {{ message: string, field?: string }} */
    const diagnostic = { message }
    if (typeof item.field === 'string' && item.field.trim() !== '') diagnostic.field = item.field.trim()
    diagnostics.push(diagnostic)
  }
  return diagnostics
}

/**
 * Validate one document path and resolve it into a safe absolute target.
 *
 * A target must be a `.md` file whose lexical path is inside one of the resolved
 * soul directories. For existing targets the real path of the containing
 * directory (and of the target itself, when it is a symbolic link) must stay
 * inside the real soul directory, so a symlink cannot escape the fence.
 *
 * The packaged bundled directory is checked first and canonically (`realpath`),
 * so a configured absolute path, workspace-relative alias, or symlink pointing
 * at it still classifies as packaged instead of becoming an editable configured
 * directory. Package ownership and read-only status are separate: with
 * `bundledEditable` enabled the packaged identity still labels and shadows
 * like a packaged default, but writes are allowed there.
 *
 * @param {{ config: object, root: string, file: unknown, forWrite?: boolean }} options
 * @returns {Promise<{ ok: true, target: string, dir: string, bundled: boolean,
 *   packageOwned: boolean } | { ok: false, code: 'unsafe-path', message: string }>}
 */
async function resolveTarget({ config, root, file, forWrite = false }) {
  const base = baseRoot(root)
  const raw = typeof file === 'string' ? file.trim() : ''
  if (raw === '') return { ok: false, code: 'unsafe-path', message: 'a document file path is required' }
  if (!raw.toLowerCase().endsWith('.md')) {
    return { ok: false, code: 'unsafe-path', message: `the document path must end with .md: ${raw}` }
  }
  const target = isAbsolute(raw) ? resolve(raw) : resolve(base, raw)
  const bundledDir = bundledSoulsDir(config)
  const realBundledDir = bundledDir === null ? null : await realpathOrNull(bundledDir)
  // Canonical ownership runs before any configured-directory match so every
  // alias spelling of the packaged directory keeps its packaged identity.
  let packageOwned = false
  if (bundledDir !== null) {
    packageOwned = within(bundledDir, target)
      || (realBundledDir !== null && within(realBundledDir, await canonicalMutationTarget(target)))
  }
  const editable = packageOwned && bundledEditableEnabled(config)
  const bundled = packageOwned && !editable
  if (bundled && forWrite) {
    return {
      ok: false,
      code: 'unsafe-path',
      message: `the bundled default soul cannot be edited or deleted in place; duplicate it into a workspace soul directory and edit the copy: ${raw}`,
    }
  }
  let dir = resolveSoulDirs(config, base).find(candidate => candidate !== target && within(candidate, target))
  if (dir === undefined && packageOwned && bundledDir !== null) dir = bundledDir
  if (dir === undefined) {
    return {
      ok: false,
      code: 'unsafe-path',
      message: `the document path is outside every configured soul directory: ${raw}`,
    }
  }
  const realDir = await realpathOrNull(dir)
  if (realDir === null) {
    // A configured directory that does not exist cannot hold an existing file.
    if (forWrite) {
      return { ok: false, code: 'unsafe-path', message: `the soul directory does not exist: ${dir}` }
    }
    return { ok: true, target, dir, bundled, packageOwned }
  }
  const parent = dirname(target)
  const realParent = await realpathOrNull(parent)
  if (realParent === null) {
    if (forWrite) {
      return { ok: false, code: 'unsafe-path', message: `the soul directory does not exist: ${parent}` }
    }
    return { ok: true, target, dir: realDir, bundled, packageOwned }
  }
  if (!within(realDir, realParent)) {
    return {
      ok: false,
      code: 'unsafe-path',
      message: `the document path escapes its soul directory through a symbolic link: ${raw}`,
    }
  }
  const info = await lstatOrNull(target)
  if (info !== null) {
    if (!info.isFile() && !info.isSymbolicLink()) {
      return { ok: false, code: 'unsafe-path', message: `the document path is not a regular file: ${raw}` }
    }
    if (info.isSymbolicLink()) {
      const realTarget = await realpathOrNull(target)
      if (realTarget === null || !within(realDir, realTarget)) {
        return {
          ok: false,
          code: 'unsafe-path',
          message: `the document path escapes its soul directory through a symbolic link: ${raw}`,
        }
      }
    }
  }
  if (forWrite) {
    const parentInfo = await statOrNull(parent)
    if (parentInfo === null || !parentInfo.isDirectory()) {
      return { ok: false, code: 'unsafe-path', message: `the soul directory does not exist: ${parent}` }
    }
  }
  return { ok: true, target, dir: realDir, bundled, packageOwned }
}

/**
 * Atomic UTF-8 write from a same-directory temporary file. Replacement uses
 * `rename`; no-replace uses a hard link, whose EEXIST is atomic even across processes.
 */
async function writeAtomic(target, source, { noReplace = false } = {}) {
  if (sourceExceedsLimit(source)) throw new Error('soul source exceeds the 1 MiB limit')
  const directory = dirname(target)
  const info = await statOrNull(directory)
  if (info === null || !info.isDirectory()) {
    throw new Error(`cannot write the soul document: directory does not exist: ${directory}`)
  }
  temporaryCounter += 1
  const temporary = join(directory, `${basename(target)}.${process.pid}.${temporaryCounter}.tmp`)
  await writeFile(temporary, source, { encoding: 'utf8', flag: 'wx' })
  try {
    if (noReplace) {
      await link(temporary, target)
      // Publication succeeded; a stale temp hard link is harmless if cleanup fails.
      await unlink(temporary).catch(() => {})
    } else {
      await rename(temporary, target)
    }
  } catch (error) {
    try {
      await unlink(temporary)
    } catch {
      // The publication failure is the meaningful error; cleaning up is best-effort.
    }
    throw error
  }
}

/** Move an existing file without replacing a destination, including across callers. */
async function moveNoReplace(source, target) {
  await link(source, target)
  try {
    await unlink(source)
  } catch (error) {
    // Do not leave two visible copies when the move cannot be completed.
    await unlink(target).catch(() => {})
    throw error
  }
}

/** @returns {Record<string, unknown>} fresh editable field defaults (inherit every tool). */
function defaultFields() {
  return {
    name: '',
    description: '',
    tools: '*',
    model: '',
    provider: '',
    reasoningEffort: '',
    context: '',
    userInvocable: false,
    extraFrontmatter: '',
  }
}

/**
 * Render one tool declaration as the editable comma-separated text form.
 * `'*'` means inherit every tool; `''` means deny every inherited tool.
 * @param {unknown} value - raw frontmatter value.
 * @returns {string}
 */
function toolsText(value) {
  if (value === undefined || value === null) return '*'
  if (typeof value === 'string') {
    const text = value.trim()
    return text === '' ? '' : text
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return ''
    if (value.length === 1 && value[0] === '*') return '*'
    return value.map(item => (typeof item === 'string' ? item.trim() : String(item))).join(', ')
  }
  return String(value)
}

/**
 * Normalize the editable tools text into what the composer should emit.
 * @param {unknown} value - `fields.tools` (or a raw frontmatter value).
 * @returns {{ kind: 'inherit' } | { kind: 'none' } | { kind: 'list', items: string[] }}
 */
function toolsForCompose(value) {
  if (value === undefined || value === null) return { kind: 'inherit' }
  const parts = []
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item === undefined || item === null) continue
      parts.push(typeof item === 'string' ? item.trim() : String(item))
    }
  } else {
    parts.push(...String(value).split(',').map(item => item.trim()))
  }
  const items = []
  for (const part of parts) {
    if (part === '' || items.includes(part)) continue
    items.push(part)
  }
  if (items.length === 0) return { kind: 'none' }
  if (items.length === 1 && items[0] === '*') return { kind: 'inherit' }
  return { kind: 'list', items }
}

/**
 * Best-effort summary form of one raw tools declaration.
 * @param {unknown} value
 * @returns {string[] | null} null = inherits every tool.
 */
function summaryTools(value) {
  const composed = toolsForCompose(value)
  if (composed.kind === 'inherit') return null
  if (composed.kind === 'none') return []
  return composed.items
}

/**
 * Render one YAML scalar: plain when unambiguously a string, else a JSON quoted string.
 * @param {unknown} value
 * @returns {string}
 */
function yamlScalar(value) {
  const text = (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value))
    .replace(/\r\n?/gu, '\n')
    .trim()
  if (text !== '' && PLAIN_SCALAR_PATTERN.test(text) && !NON_STRING_SCALAR_PATTERN.test(text)) return text
  return text === '' ? '""' : JSON.stringify(text)
}

/**
 * The raw top-level lines of the frontmatter block, or null when there is no complete block.
 * @param {string} text
 * @returns {string[] | null}
 */
function frontmatterBodyLines(text) {
  const lines = String(text).replace(/^\uFEFF/u, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') return lines.slice(1, index)
  }
  return null
}

/**
 * Collect the raw YAML lines of unknown frontmatter keys, preserving them verbatim.
 *
 * A key that this layer does not understand opens an "extra" block: the key line
 * and every following indented / list / blank line up to the next top-level key
 * are kept. Known keys are reconstructed canonically by the composer.
 *
 * @param {string} text
 * @returns {string} raw lines, or '' when the document has no extra keys.
 */
function splitExtraFrontmatter(text) {
  const lines = frontmatterBodyLines(text)
  if (lines === null) return ''
  const extras = []
  let inUnknown = false
  for (const line of lines) {
    const keyMatch = FRONTMATTER_KEY_PATTERN.exec(line)
    if (keyMatch !== null) {
      inUnknown = !KNOWN_FRONTMATTER_KEYS.has(keyMatch[1])
      if (inUnknown) extras.push(line)
      continue
    }
    if (inUnknown) extras.push(line)
  }
  return extras.join('\n').trim()
}

/**
 * Best-effort editable fields from one parsed frontmatter mapping.
 * @param {string} text - complete document source, for the extra-frontmatter lines.
 * @param {Record<string, unknown> | null} data - parsed frontmatter mapping.
 * @returns {{ name: string, description: string, tools: string, model: string, provider: string,
 *   reasoningEffort: string, context: string, userInvocable: boolean, extraFrontmatter: string }}
 */
function fieldsFromFrontmatter(text, data) {
  const fields = defaultFields()
  if (isRecord(data)) {
    fields.name = textOf(data.name)
    fields.description = textOf(data.description)
    fields.tools = toolsText(data.tools)
    fields.model = textOf(data.model)
    fields.provider = textOf(data.provider)
    fields.reasoningEffort = textOf(data['reasoning-effort'])
    fields.context = data.context === 'fresh' || data.context === 'fork' ? data.context : ''
    fields.userInvocable = data['user-invocable'] === true
  }
  fields.extraFrontmatter = splitExtraFrontmatter(text)
  return fields
}

/**
 * The body text after the frontmatter block, best-effort even when it is malformed.
 * @param {string} text
 * @param {{ data: Record<string, unknown> | null, body: string }} parsed
 * @returns {string}
 */
function bodyTextOf(text, parsed) {
  if (parsed.data !== null) return parsed.body
  const lines = String(text).replace(/^\uFEFF/u, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return text
  // A missing closing delimiter is still reported through diagnostics; keep the
  // remaining lines editable instead of discarding the whole document.
  return lines.slice(1).join('\n')
}

/**
 * Read one body heading line as a canonical section title, when it is one.
 *
 * Only the four canonical `#`/`##` headings delimit sections. Every other
 * heading is plain Markdown content inside the current section: bundled soul
 * files routinely put `## Answer` / `## Findings` templates inside their Output
 * Format, and treating those as new sections would move the template out of the
 * Output Format textarea on the next save.
 *
 * @param {string} line
 * @returns {string | null} the canonical section key, or null when the line is content.
 */
function canonicalKeyOf(line) {
  const match = HEADING_PATTERN.exec(line)
  if (match === null) return null
  return SECTION_TITLE_TO_KEY.get(match[2].replace(/\s+/gu, ' ').trim().toLowerCase()) ?? null
}

/**
 * Split one Markdown body into the four canonical sections plus the preamble.
 *
 * The text before the first canonical heading is the body preamble and becomes
 * `extraMarkdown`; the composer puts it back before the canonical sections, so
 * `split(compose(split(source)))` round-trips section content even when a
 * section itself contains Markdown headings. A body without any canonical
 * heading is entirely `extraMarkdown` (it is the only editable content left).
 *
 * @param {string} body
 * @returns {{ role: string, inputs: string, rules: string, output: string, extraMarkdown: string }}
 */
function splitBody(body) {
  const sections = { role: '', inputs: '', rules: '', output: '', extraMarkdown: '' }
  /** @type {Map<string, string[]>} */
  const buffers = new Map()
  /** @type {string[] | null} */
  let current = null
  const preamble = []
  const seen = new Set()
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const key = canonicalKeyOf(line)
    if (key !== null && !seen.has(key)) {
      seen.add(key)
      const lines = []
      buffers.set(key, lines)
      current = lines
      continue
    }
    if (current === null) preamble.push(line)
    else current.push(line)
  }
  for (const [key, lines] of buffers) sections[key] = lines.join('\n').trim()
  sections.extraMarkdown = preamble.join('\n').trim()
  return sections
}

/**
 * Compose the body from the editable sections, in the canonical order.
 * @param {{ role?: unknown, inputs?: unknown, rules?: unknown, output?: unknown, extraMarkdown?: unknown }} sections
 * @returns {string} the body text (no frontmatter, no trailing newline).
 */
function composeBody(sections) {
  /** @param {unknown} value @returns {string} */
  const sectionText = (value) => (typeof value === 'string' ? value.replace(/\r\n?/gu, '\n').trim() : '')
  const blocks = []
  for (const { key, title } of SECTION_HEADINGS) {
    const text = sectionText(sections?.[key])
    if (text !== '') blocks.push(`## ${title}\n\n${text}`)
  }
  const extra = sectionText(sections?.extraMarkdown)
  if (blocks.length === 0) return extra
  // The preamble comes first so the splitter can recover it verbatim; sections
  // keep their own Markdown headings (they are content, not section delimiters).
  if (extra === '') return blocks.join('\n\n')
  return `${extra}\n\n${blocks.join('\n\n')}`
}

/**
 * Compose the complete Markdown source from editable fields and sections.
 * @param {Record<string, unknown>} fields
 * @param {Record<string, unknown>} sections
 * @returns {string}
 */
function composeSource(fields, sections) {
  const lines = ['---']
  lines.push(`name: ${yamlScalar(fields?.name)}`)
  lines.push(`description: ${yamlScalar(fields?.description)}`)
  const tools = toolsForCompose(fields?.tools)
  if (tools.kind === 'list') {
    lines.push('tools:')
    for (const item of tools.items) lines.push(`  - ${yamlScalar(item)}`)
  } else if (tools.kind === 'none') {
    lines.push('tools: []')
  }
  const model = textOf(fields?.model)
  if (model !== '') lines.push(`model: ${yamlScalar(model)}`)
  const provider = textOf(fields?.provider)
  if (provider !== '') lines.push(`provider: ${yamlScalar(provider)}`)
  const reasoningEffort = textOf(fields?.reasoningEffort)
  if (reasoningEffort !== '') lines.push(`reasoning-effort: ${yamlScalar(reasoningEffort)}`)
  const context = textOf(fields?.context)
  if (context === 'fresh' || context === 'fork') lines.push(`context: ${context}`)
  else if (context !== '' && context !== 'none') lines.push(`context: ${yamlScalar(context)}`)
  if (fields?.userInvocable === true) lines.push('user-invocable: true')
  else if (fields?.userInvocable !== undefined && fields.userInvocable !== null && fields.userInvocable !== false) {
    // An invalid checkbox value is a client bug, not "false": emit it so the
    // parser's `must be true or false` diagnostic refuses the save.
    lines.push(`user-invocable: ${yamlScalar(fields.userInvocable)}`)
  }
  const extra = typeof fields?.extraFrontmatter === 'string'
    ? fields.extraFrontmatter.replace(/\r\n?/gu, '\n').trim()
    : textOf(fields?.extraFrontmatter)
  if (extra !== '') lines.push(...extra.split('\n'))
  lines.push('---')
  const body = composeBody(sections)
  const frontmatter = lines.join('\n')
  return body === '' ? `${frontmatter}\n` : `${frontmatter}\n\n${body}\n`
}

/**
 * Split one Markdown document into editable parts.
 *
 * Never throws: a malformed frontmatter block or a missing body is reported
 * through `diagnostics`, while the best-effort fields and sections stay editable.
 *
 * @param {unknown} source - complete file text.
 * @param {{ sourcePath?: string, sourceLabel?: string, mtimeMs?: number }} [meta]
 *   diagnostic provenance; the parser reports line-scoped messages against it.
 * @returns {{ fields: { name: string, description: string, tools: string, model: string,
 *     provider: string, reasoningEffort: string, context: string, userInvocable: boolean,
 *     extraFrontmatter: string },
 *   sections: { role: string, inputs: string, rules: string, output: string, extraMarkdown: string },
 *   valid: boolean, diagnostics: { message: string, field?: string }[] }}
 */
export function splitDocument(source, meta = {}) {
  const text = typeof source === 'string' ? source.replace(/^\uFEFF/u, '') : ''
  let fields = defaultFields()
  let sections = { role: '', inputs: '', rules: '', output: '', extraMarkdown: '' }
  let valid = false
  let diagnostics = []
  try {
    const parsed = parseFrontmatter(text)
    fields = fieldsFromFrontmatter(text, parsed.data)
    sections = splitBody(bodyTextOf(text, parsed))
    const soul = parseSoulMarkdown(text, {
      sourcePath: typeof meta?.sourcePath === 'string' ? meta.sourcePath : '',
      sourceLabel: typeof meta?.sourceLabel === 'string' ? meta.sourceLabel : '',
      mtimeMs: 0,
    })
    valid = soul.definition !== undefined
    diagnostics = parserDiagnostics(soul.diagnostics)
  } catch (error) {
    valid = false
    diagnostics = [{ message: `cannot split the soul document: ${messageOf(error)}` }]
  }
  return { fields, sections, valid, diagnostics }
}

/**
 * Compose and validate one document.
 *
 * `input` carries `{ fields, sections }` in the same shape as DocumentDetail.
 * The composed source is validated with the plugin's own parser: any diagnostic
 * means the document would not be accepted by the catalog and must not be saved.
 *
 * @param {{ fields?: Record<string, unknown>, sections?: Record<string, unknown> } | undefined} input
 * @returns {{ source: string, valid: boolean, diagnostics: { message: string, field?: string }[] }}
 */
export function composeDocument(input) {
  const fields = isRecord(input?.fields) ? input.fields : {}
  const sections = isRecord(input?.sections) ? input.sections : {}
  const source = composeSource(fields, sections)
  const parsed = parseSoulMarkdown(source)
  const diagnostics = parserDiagnostics(parsed.diagnostics)
  return { source, valid: parsed.definition !== undefined, diagnostics }
}

/**
 * The canonical skeleton used by `createDocument`.
 *
 * The placeholder text is valid by construction: the document parses with a
 * lower-kebab-case name, a non-empty description, all four body sections, and no
 * tool restriction (it inherits every tool until edited).
 *
 * @param {string} name - an already validated lower-kebab-case soul name.
 * @returns {string} complete Markdown source.
 */
export function canonicalSkeleton(name) {
  const soulName = typeof name === 'string' && name.trim() !== '' ? name.trim() : 'soul'
  return composeDocument({
    fields: {
      name: soulName,
      description: `The ${soulName} teammate. Replace this sentence with one sentence describing when to use it.`,
      tools: '*',
      model: '',
      provider: '',
      reasoningEffort: '',
      context: 'fresh',
      userInvocable: false,
      extraFrontmatter: '',
    },
    sections: {
      role: `You are the "${soulName}" teammate. Describe your role, the perspective you take, and what you are responsible for.`,
      inputs: 'Describe the task message and workspace context you expect from the lead.',
      rules: '- List the hard rules you always follow.\n- Keep each rule concrete and checkable.',
      output: 'Describe the exact structure of your final reply.',
      extraMarkdown: '',
    },
  }).source
}

/**
 * Recursively collect `*.md` files under one directory, sorted per directory.
 * Dot entries, `node_modules`, symbolic links, and the canonical trash subtree
 * are skipped. The shared state caps a whole multi-directory scan at 1000 files.
 */
async function collectMarkdownFiles(dir, diagnostics, state, depth = 0) {
  const canonicalDir = await realpathOrNull(dir) ?? resolve(dir)
  if (state.capped || within(state.trashRoot, canonicalDir)) return []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    const message = `cannot read soul directory: ${messageOf(error)}`
    diagnostics.push({ source: dir, message })
    return []
  }
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  const files = []
  for (const entry of entries) {
    if (state.capped) break
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH) files.push(...await collectMarkdownFiles(full, diagnostics, state, depth + 1))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      if (state.count >= MAX_SCAN_FILES) {
        state.capped = true
        break
      }
      state.count += 1
      files.push(full)
    }
  }
  return files
}

/**
 * Build one DocumentSummary from a file on disk.
 * @param {string} file - absolute file path.
 * @param {string} root - workspace root, for the display label.
 * @param {{ source: string, message: string }[]} diagnostics - scan diagnostics sink.
 * @param {{ bundled?: boolean, packageDir?: string }} [options] - `bundled` is
 *   the read-only packaged classification; `packageDir` is the packaged
 *   directory a package-owned file is labelled relative to (also editable when
 *   `bundledEditable` is enabled).
 * @returns {Promise<object | null>} the summary, or null when the file cannot be read.
 */
async function summarizeFile(file, root, diagnostics, options = {}) {
  const packageDir = typeof options?.packageDir === 'string' ? options.packageDir : null
  const bundled = options?.bundled === true
  // Packaged souls are labelled relative to their own directory so the list
  // shows `generalist.md` instead of an absolute install path.
  const label = packageDir !== null ? labelOf(packageDir, file) : labelOf(root, file)
  let info
  let source
  try {
    info = await stat(file)
    if (info.size > MAX_SOUL_FILE_BYTES) {
      diagnostics.push({ source: label, message: 'soul file exceeds the 1 MiB limit; skipped before reading' })
      return null
    }
    source = await readFile(file, 'utf8')
  } catch (error) {
    diagnostics.push({ source: label, message: `cannot read soul file: ${messageOf(error)}` })
    return null
  }
  const meta = { sourcePath: file, sourceLabel: label, mtimeMs: info.mtimeMs }
  const parsed = parseSoulMarkdown(source, meta)
  const split = splitDocument(source, meta)
  const raw = parseFrontmatter(source)
  const data = isRecord(raw.data) ? raw.data : {}
  const definition = parsed.definition
  const valid = definition !== undefined
  if (!valid) for (const diagnostic of parsed.diagnostics) diagnostics.push({ source: label, message: diagnostic.message })
  const name = valid ? definition.name : split.fields.name !== '' ? split.fields.name : null
  const description = valid ? definition.description : split.fields.description !== '' ? split.fields.description : null
  const model = typeof data.model === 'string' && data.model.trim() !== '' ? data.model.trim() : null
  const context = valid
    ? definition.context ?? null
    : data.context === 'fresh' || data.context === 'fork' ? data.context : null
  return {
    file,
    label,
    name,
    description,
    valid,
    bundled,
    packageOwned: packageDir !== null,
    tools: valid ? definition.tools : summaryTools(data.tools),
    model,
    modelResolved: null,
    userInvocable: valid ? definition.userInvocable === true : data['user-invocable'] === true,
    context,
    command: null,
    sourcePath: file,
    hash: documentHash(source),
    modifiedAt: Math.trunc(info.mtimeMs),
    diagnostics: split.diagnostics,
  }
}

/**
 * Resolve every configured directory that currently exists as a directory.
 * @param {object} config
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function existingDirs(config, root) {
  const dirs = []
  for (const candidate of resolveSoulDirs(config, root)) {
    const info = await statOrNull(candidate)
    if (info !== null && info.isDirectory()) dirs.push(candidate)
  }
  return dirs
}

/**
 * Resolve every configured directory that currently exists as a directory and
 * is not the packaged bundled directory (or physically inside it).
 *
 * The exclusion is canonical (`realpath`), so a configured absolute path,
 * workspace-relative alias, or symlink that points at the packaged catalog
 * cannot receive an implicit create/duplicate write. `bundledEditable` lifts
 * the exclusion because in-place authoring makes the packaged catalog an
 * intentional write target.
 *
 * @param {object} config
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function writableExistingDirs(config, root) {
  const dirs = await existingDirs(config, root)
  const bundledDir = bundledSoulsDir(config)
  if (bundledDir === null) return dirs
  // In-place authoring mode makes the packaged catalog an intentional write
  // target, so configured aliases of it are not filtered out.
  if (bundledEditableEnabled(config)) return dirs
  const realBundledDir = await realpathOrNull(bundledDir)
  if (realBundledDir === null) return dirs
  const writable = []
  for (const dir of dirs) {
    const realDir = await realpathOrNull(dir) ?? resolve(dir)
    if (within(realBundledDir, realDir)) continue
    writable.push(dir)
  }
  return writable
}

/**
 * Resolve the writable soul directories for one workspace root.
 *
 * When none exists yet, create the first workspace-relative configured directory
 * so a fresh workspace can save a soul without a manual `mkdir`. Absolute,
 * `~/…`, and packaged bundled directories are never created implicitly.
 *
 * Implicit creation is fenced canonically: the real workspace root and the real
 * nearest existing ancestor of the prospective directory must agree before
 * `mkdir`, and the created directory's real path is checked again afterwards.
 * A symlinked `.dsh` (or any other alias) therefore cannot make auto-creation
 * land outside the workspace; a refusal creates nothing.
 *
 * @param {object} config
 * @param {string} root
 * @returns {Promise<string[]>} existing (created) writable directories.
 */
async function writableDirs(config, root) {
  const base = baseRoot(root)
  const existing = await writableExistingDirs(config, base)
  if (existing.length > 0) return existing
  const specs = Array.isArray(config?.dirs) ? config.dirs : []
  const realBase = await realpathOrNull(base) ?? await realpathOrAncestor(base)
  if (realBase === null) return []
  for (const spec of specs) {
    if (typeof spec !== 'string' || spec.trim() === '') continue
    const text = spec.trim()
    if (text === '~' || text.startsWith('~/') || isAbsolute(text)) continue
    const dir = resolveDirectorySpec(base, text)
    if (!within(base, dir)) continue
    // Decide where `mkdir` would physically create before touching the filesystem.
    const ancestor = await realpathOrAncestor(dir)
    if (ancestor === null || !within(realBase, ancestor)) continue
    try {
      await mkdir(dir, { recursive: true })
    } catch {
      continue
    }
    // Creation can still traverse a link that changed in between; return only a
    // canonical directory that is inside the real workspace.
    const realDir = await realpathOrNull(dir)
    if (realDir === null || !within(realBase, realDir)) continue
    return await writableExistingDirs(config, base)
  }
  return []
}

/**
 * Scan every readable soul directory for `*.md` files (valid or not), sorted by label.
 *
 * The packaged bundled catalog is appended after the configured directories when
 * `bundled` is enabled (the default), so an installation always exposes its
 * souls. A local soul with the same name shadows the bundled copy, matching the
 * catalog scan; packaged rows carry `packageOwned: true` and, unless
 * `bundledEditable` enables in-place authoring, `bundled: true` because the
 * document layer keeps them read-only. A configured directory whose canonical
 * (`realpath`) path is the packaged directory or inside it is classified
 * package-owned too, so an alias keeps the packaged identity.
 *
 * Missing directories are skipped silently (a workspace may not have souls
 * yet); unreadable directories and invalid documents are reported through
 * top-level `diagnostics` while the per-document summary carries its own
 * diagnostics.
 *
 * @param {{ config: object, root: string,
 *   logger?: { warn: (message: string) => void } }} options
 * @returns {Promise<{ dirs: string[], documents: object[], diagnostics: { source: string, message: string }[],
 *   scannedAt: number }>}
 */
export async function listDocuments({ config, root, logger } = {}) {
  const base = baseRoot(root)
  const bundledDir = bundledSoulsDir(config)
  const realBundledDir = bundledDir === null ? null : await realpathOrNull(bundledDir)
  const editableBundled = bundledEditableEnabled(config)
  const candidates = resolveSoulDirs(config, base)
  if (bundledDir !== null) candidates.push(bundledDir)
  const dirs = []
  const bundledDirs = new Set()
  const packageDirs = new Set()
  const seen = new Set()
  for (const candidate of candidates) {
    const info = await statOrNull(candidate)
    if (info === null) continue
    if (!info.isDirectory()) {
      warn(logger, `skipping soul directory (not a directory): ${candidate}`)
      continue
    }
    const resolvedCandidate = resolve(candidate)
    const canonical = await realpathOrNull(resolvedCandidate) ?? resolvedCandidate
    if (seen.has(canonical)) continue
    seen.add(canonical)
    dirs.push(resolvedCandidate)
    if (realBundledDir !== null && within(realBundledDir, canonical)) {
      packageDirs.add(resolvedCandidate)
      // Read-only packaging classification only when in-place editing is off;
      // package ownership is tracked either way for labels and shadowing.
      if (!editableBundled) bundledDirs.add(resolvedCandidate)
    }
  }
  /** @type {{ source: string, message: string }[]} */
  const diagnostics = []
  const trashRoot = await realpathOrNull(trashDirectoryOf(base, config)) ?? trashDirectoryOf(base, config)
  const scan = { count: 0, capped: false, trashRoot }
  /** @type {object[]} */
  const documents = []
  for (const dir of dirs) {
    if (scan.capped) break
    const bundled = bundledDirs.has(dir)
    const packageOwned = packageDirs.has(dir)
    const options = packageOwned ? { bundled, packageDir: dir } : bundled ? { bundled } : {}
    for (const file of await collectMarkdownFiles(dir, diagnostics, scan)) {
      const summary = await summarizeFile(file, base, diagnostics, options)
      if (summary !== null) documents.push(summary)
    }
  }
  if (scan.capped) {
    diagnostics.push({
      source: base,
      message: `administrative soul scan stopped after ${MAX_SCAN_FILES} files; additional files were not scanned`,
    })
  }
  // A local definition intentionally shadows a same-named packaged soul (read-only
  // or editable); the packaged copy is not a second document in the list.
  const localNames = new Set()
  for (const row of documents) {
    if (row.packageOwned !== true && row.valid === true && typeof row.name === 'string' && row.name !== '') localNames.add(row.name)
  }
  const visible = documents.filter(row => !(row.packageOwned === true && typeof row.name === 'string' && localNames.has(row.name)))
  visible.sort((left, right) => (left.label < right.label ? -1 : left.label > right.label ? 1 : 0))
  return { dirs, documents: visible, diagnostics, scannedAt: Date.now() }
}

/**
 * Read one document as editable detail.
 *
 * @param {{ config: object, root: string, file: unknown }} options
 * @returns {Promise<{ ok: true, document: object } |
 *   { ok: false, code: string, message: string }>}
 *   404-worthy `not-found`, safety `unsafe-path`, or an unreadable-file `invalid-request`.
 */
export async function readDocument({ config, root, file } = {}) {
  const base = baseRoot(root)
  const resolved = await resolveTarget({ config, root: base, file, forWrite: false })
  if (!resolved.ok) return resolved
  const target = resolved.target
  let info
  let source
  try {
    info = await stat(target)
    if (!info.isFile()) return { ok: false, code: 'not-found', message: `the document does not exist: ${target}` }
    if (info.size > MAX_SOUL_FILE_BYTES) {
      return { ok: false, code: 'invalid-request', message: `the document exceeds the 1 MiB limit: ${target}` }
    }
    source = await readFile(target, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return { ok: false, code: 'not-found', message: `the document does not exist: ${target}` }
    }
    return { ok: false, code: 'invalid-request', message: `cannot read the document: ${messageOf(error)}` }
  }
  const bundled = resolved.bundled === true
  const packageOwned = resolved.packageOwned === true
  const packageDir = bundledSoulsDir(config)
  // Packaged souls are labelled relative to their packaged directory, matching
  // the list rows; local documents stay workspace-relative (or absolute).
  const label = packageOwned && packageDir !== null
    ? labelOf(packageDir, target)
    : labelOf(base, target)
  const split = splitDocument(source, { sourcePath: target, sourceLabel: label })
  return {
    ok: true,
    document: {
      file: target,
      label,
      bundled,
      packageOwned,
      sourcePath: target,
      source,
      hash: documentHash(source),
      modifiedAt: Math.trunc(info.mtimeMs),
      fields: split.fields,
      sections: split.sections,
      valid: split.valid,
      diagnostics: split.diagnostics,
    },
  }
}

/** Find another valid document with the same frontmatter name in this document layer. */
async function duplicateNameOf({ config, root, name, excludeFile }) {
  const excluded = typeof excludeFile === 'string' && excludeFile.trim() !== ''
    ? await canonicalMutationTarget(isAbsolute(excludeFile) ? resolve(excludeFile) : resolve(root, excludeFile))
    : null
  const listed = await listDocuments({ config, root })
  for (const row of listed.documents) {
    // Packaged souls are defaults, not claims on the name: a workspace soul with
    // the same name shadows the packaged copy and is allowed (whether the
    // packaged copy is read-only or editable in place).
    if (row.packageOwned === true) continue
    if (row.valid !== true || row.name !== name) continue
    if (excluded !== null && await canonicalMutationTarget(row.file) === excluded) continue
    return row
  }
  return null
}

/** Build the layer-wide duplicate-name refusal used by GUI and tool callers alike. */
function duplicateNameFailure(name, duplicate, code = 'invalid') {
  return {
    ok: false,
    code,
    message: `another soul named "${name}" already exists: ${duplicate.file}`,
    diagnostics: [{ field: 'name', message: `another soul named "${name}" already exists: ${duplicate.label}` }],
  }
}

/**
 * Compose, validate, and atomically save one document.
 *
 * When `file` is absent (a not-yet-created suggestion) the first existing
 * configured directory plus `<fields.name>.md` is used; a collision there is
 * refused with `exists` instead of overwriting a document the user did not open.
 * An explicit `file` may name a new file inside a configured directory.
 *
 * Optional safeguards keep the GUI coherent without changing the agent tool's
 * last-write-wins path:
 *
 * - `expectedHash` (a string, including empty): re-read the target under its
 *   mutation lock and refuse with `conflict` when it vanished or changed.
 * - `expectedMissing: true`: require absence and recreate with no-replace
 *   publication; an empty expectedHash never substitutes for this guard.
 * - `validate(definition)`: after the parser accepts the composed document, ask
 *   the caller for semantic diagnostics (`{ diagnostics: [{ message, field? }] }`
 *   or a bare array). A non-empty list refuses with `invalid` and writes nothing.
 *
 * @param {{ config: object, root: string, file?: unknown,
 *   fields?: Record<string, unknown>, sections?: Record<string, unknown>,
 *   expectedHash?: string, expectedMissing?: boolean, validate?: (definition: object) => unknown }} options
 * @returns {Promise<{ ok: true, document: object } |
 *   { ok: false, code: 'invalid' | 'unsafe-path' | 'exists' | 'invalid-request' | 'conflict',
 *     message: string, diagnostics?: { message: string, field?: string }[],
 *     currentHash?: string | null, currentModifiedAt?: number }>}
 */
export async function saveDocument({ config, root, file, fields, sections, expectedHash, expectedMissing = false, validate } = {}) {
  const base = baseRoot(root)
  if (typeof expectedMissing !== 'boolean') {
    return { ok: false, code: 'invalid-request', message: 'expectedMissing must be a boolean' }
  }
  if (expectedMissing && typeof expectedHash === 'string' && expectedHash !== '') {
    return { ok: false, code: 'invalid-request', message: 'expectedMissing cannot be combined with a non-empty expectedHash' }
  }
  const hasFile = typeof file === 'string' && file.trim() !== ''
  if (!hasFile && typeof expectedHash === 'string' && !expectedMissing) {
    return {
      ok: false,
      code: 'conflict',
      message: 'the document does not exist yet; there is no saved version to match',
      currentHash: null,
      currentModifiedAt: 0,
    }
  }
  /** @type {string} */
  let target
  if (hasFile) {
    const resolved = await resolveTarget({ config, root: base, file, forWrite: true })
    if (!resolved.ok) return resolved
    target = resolved.target
  } else {
    const dirs = await writableDirs(config, base)
    if (dirs.length === 0) {
      return { ok: false, code: 'unsafe-path', message: 'no soul directory exists to save the document in' }
    }
    const name = textOf(fields?.name)
    if (!NAME_PATTERN.test(name) || name.length > MAX_NAME_CHARS || name === RESERVED_NAME) {
      // The suggested target name is validated before the parser runs, so the
      // refusal must still carry the same name-tagged diagnostic the parser
      // would have produced; otherwise this save path would show an unfocused
      // banner instead of a `fieldErrors.name` the editor can act on.
      const diagnosticMessage = name === RESERVED_NAME
        ? `name: "${RESERVED_NAME}" is reserved for the Team Lead`
        : name.length > MAX_NAME_CHARS
          ? `name: must be at most ${MAX_NAME_CHARS} characters`
          : 'name: must be kebab-case (^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$)'
      return {
        ok: false,
        code: 'invalid',
        message: 'the soul name is not a valid teammate name',
        diagnostics: [{ message: diagnosticMessage, field: 'name' }],
      }
    }
    target = join(dirs[0], `${name}.md`)
  }
  return withNameUniquenessLock(base, () => withMutationLocks([target], async () => {
    if (hasFile) {
      const guarded = await checkSaveGuard(target, expectedHash, expectedMissing)
      if (guarded !== null) return guarded
    } else if (await lstatOrNull(target) !== null) {
      return { ok: false, code: 'exists', message: `the document already exists: ${target}` }
    }
    const composed = composeDocument({ fields, sections })
    if (sourceExceedsLimit(composed.source)) {
      return { ok: false, code: 'invalid-request', message: 'the composed soul source exceeds the 1 MiB limit' }
    }
    if (!composed.valid) {
      return {
        ok: false,
        code: 'invalid',
        message: 'the soul document is invalid and was not saved',
        diagnostics: composed.diagnostics,
      }
    }
    const parsed = parseSoulMarkdown(composed.source)
    const definition = parsed.definition
    if (definition === undefined) {
      return {
        ok: false,
        code: 'invalid',
        message: 'the soul document is invalid and was not saved',
        diagnostics: parserDiagnostics(parsed.diagnostics),
      }
    }
    const duplicate = await duplicateNameOf({ config, root: base, name: definition.name, excludeFile: target })
    if (duplicate !== null) return duplicateNameFailure(definition.name, duplicate)
    const diagnostics = await validationDiagnostics(validate, definition)
    if (diagnostics.length > 0) {
      return { ok: false, code: 'invalid', message: 'the soul document is invalid and was not saved', diagnostics }
    }
    if (hasFile) {
      // Re-check immediately before publication, still under the canonical-target lock.
      const guarded = await checkSaveGuard(target, expectedHash, expectedMissing)
      if (guarded !== null) return guarded
    }
    try {
      await writeAtomic(target, composed.source, { noReplace: !hasFile || expectedMissing })
    } catch (error) {
      if (error?.code === 'EEXIST') {
        if (!hasFile) return { ok: false, code: 'exists', message: `the document already exists: ${target}` }
        return missingConflictOf(target, await currentDocumentState(target))
      }
      return { ok: false, code: 'invalid-request', message: `cannot write the document: ${messageOf(error)}` }
    }
    const detail = await readDocument({ config, root: base, file: target })
    if (!detail.ok) return detail
    return { ok: true, document: detail.document }
  }))
}

/**
 * Validate raw Markdown and atomically write it (the Lead tool's save path).
 *
 * Unlike `saveDocument` this takes the complete document text instead of the
 * split form, but it validates with the same parser and applies the same path
 * safety, so the tool and the GUI cannot diverge. `expectedHash` and `validate`
 * behave exactly as in `saveDocument`.
 *
 * @param {{ config: object, root: string, file: unknown, source: unknown,
 *   expectedHash?: string, expectedMissing?: boolean, validate?: (definition: object) => unknown }} options
 * @returns {Promise<{ ok: true, file: string, diagnostics: { message: string }[], document?: object } |
 *   { ok: false, code: 'invalid' | 'unsafe-path' | 'invalid-request' | 'conflict',
 *     message: string, diagnostics?: { message: string, field?: string }[],
 *     currentHash?: string | null, currentModifiedAt?: number }>}
 */
export async function saveDocumentSource({ config, root, file, source, expectedHash, expectedMissing = false, validate } = {}) {
  const base = baseRoot(root)
  if (typeof expectedMissing !== 'boolean') {
    return { ok: false, code: 'invalid-request', message: 'expectedMissing must be a boolean' }
  }
  if (expectedMissing && typeof expectedHash === 'string' && expectedHash !== '') {
    return { ok: false, code: 'invalid-request', message: 'expectedMissing cannot be combined with a non-empty expectedHash' }
  }
  const resolved = await resolveTarget({ config, root: base, file, forWrite: true })
  if (!resolved.ok) return resolved
  const target = resolved.target
  if (sourceExceedsLimit(source)) {
    return { ok: false, code: 'invalid-request', message: 'soul source exceeds the 1 MiB limit' }
  }
  return withNameUniquenessLock(base, () => withMutationLocks([target], async () => {
    let guarded = await checkSaveGuard(target, expectedHash, expectedMissing)
    if (guarded !== null) return guarded
    const text = typeof source === 'string' ? source : ''
    const label = labelOf(base, target)
    const parsed = parseSoulMarkdown(text, { sourcePath: target, sourceLabel: label, mtimeMs: 0 })
    const diagnostics = parserDiagnostics(parsed.diagnostics)
    if (parsed.definition === undefined) {
      return { ok: false, code: 'invalid', message: 'the soul document is invalid and was not saved', diagnostics }
    }
    const duplicate = await duplicateNameOf({ config, root: base, name: parsed.definition.name, excludeFile: target })
    if (duplicate !== null) return duplicateNameFailure(parsed.definition.name, duplicate)
    const semantic = await validationDiagnostics(validate, parsed.definition)
    if (semantic.length > 0) {
      return { ok: false, code: 'invalid', message: 'the soul document is invalid and was not saved', diagnostics: semantic }
    }
    guarded = await checkSaveGuard(target, expectedHash, expectedMissing)
    if (guarded !== null) return guarded
    try {
      await writeAtomic(target, text, { noReplace: expectedMissing })
    } catch (error) {
      if (error?.code === 'EEXIST') return missingConflictOf(target, await currentDocumentState(target))
      return { ok: false, code: 'invalid-request', message: `cannot write the document: ${messageOf(error)}` }
    }
    // The re-read detail is included for callers (the Lead tool) that render the
    // document after saving; `file` remains the contract's crisp success result.
    const detail = await readDocument({ config, root: base, file: target })
    return {
      ok: true,
      file: target,
      diagnostics,
      ...detail.ok ? { document: detail.document } : {},
    }
  }))
}

/**
 * Create one document in the first existing configured directory.
 *
 * Without `source` the canonical skeleton is written. With `source` (validated
 * Markdown) that text is written verbatim instead, so the GUI can create a
 * document from a pasted import or one of its templates. The same path safety
 * and `exists`/`invalid-name` refusals apply in both modes; an unparseable
 * source is an `invalid` refusal carrying the parser diagnostics.
 *
 * @param {{ config: object, root: string, name: unknown, source?: unknown,
 *   validate?: (definition: object) => unknown }} options
 * @returns {Promise<{ ok: true, document: object } |
 *   { ok: false, code: 'invalid-name' | 'exists' | 'no-dirs' | 'invalid' | 'invalid-request',
 *     message: string, diagnostics?: { message: string, field?: string }[] }>}
 */
export async function createDocument({ config, root, name, source, validate } = {}) {
  const base = baseRoot(root)
  const candidate = typeof name === 'string' ? name.trim() : ''
  if (!NAME_PATTERN.test(candidate) || candidate.length > MAX_NAME_CHARS || candidate === RESERVED_NAME) {
    return {
      ok: false,
      code: 'invalid-name',
      message: 'name must be lower-kebab-case, at most 64 characters, and not "lead"',
    }
  }
  const hasSource = source !== undefined && source !== null
  if (hasSource && typeof source !== 'string') {
    return { ok: false, code: 'invalid-request', message: 'source must be a string' }
  }
  if (sourceExceedsLimit(source)) {
    return { ok: false, code: 'invalid-request', message: 'soul source exceeds the 1 MiB limit' }
  }
  const dirs = await writableDirs(config, base)
  if (dirs.length === 0) {
    return { ok: false, code: 'no-dirs', message: 'no writable soul directory is configured; set dirs to a workspace-relative directory first' }
  }
  const target = join(dirs[0], `${candidate}.md`)
  return withNameUniquenessLock(base, () => withMutationLocks([target], async () => {
    for (const dir of dirs) {
      const candidateFile = join(dir, `${candidate}.md`)
      if (await lstatOrNull(candidateFile) !== null) {
        return { ok: false, code: 'exists', message: `a soul named "${candidate}" already exists: ${candidateFile}` }
      }
    }
    const text = hasSource ? source : canonicalSkeleton(candidate)
    const parsed = parseSoulMarkdown(text, { sourcePath: target, sourceLabel: labelOf(base, target), mtimeMs: 0 })
    if (parsed.definition === undefined) {
      return {
        ok: false,
        code: 'invalid',
        message: 'the soul source is invalid and was not created',
        diagnostics: parserDiagnostics(parsed.diagnostics),
      }
    }
    if (parsed.definition.name !== candidate) {
      return {
        ok: false,
        code: 'invalid',
        message: `the source frontmatter name must equal the requested create name "${candidate}"`,
        diagnostics: [{ field: 'name', message: `source name "${parsed.definition.name}" does not equal "${candidate}"` }],
      }
    }
    const duplicate = await duplicateNameOf({ config, root: base, name: candidate, excludeFile: target })
    if (duplicate !== null) return duplicateNameFailure(candidate, duplicate, 'exists')
    const diagnostics = await validationDiagnostics(validate, parsed.definition)
    if (diagnostics.length > 0) {
      return { ok: false, code: 'invalid', message: 'the soul source is invalid and was not created', diagnostics }
    }
    try {
      await writeAtomic(target, text, { noReplace: true })
    } catch (error) {
      if (error?.code === 'EEXIST') {
        return { ok: false, code: 'exists', message: `a soul named "${candidate}" already exists: ${target}` }
      }
      return { ok: false, code: 'invalid-request', message: `cannot write the document: ${messageOf(error)}` }
    }
    const detail = await readDocument({ config, root: base, file: target })
    if (!detail.ok) return detail
    return { ok: true, document: detail.document }
  }))
}

/**
 * Copy one existing document under a new name in the first existing configured directory.
 *
 * The source is read through the same path safety as every other operation,
 * split, renamed, composed again, and validated before anything is written, so
 * the duplicate keeps every other field, section, and unknown frontmatter key
 * verbatim (in canonical composer order) while the file name and `name` field
 * both use the new lower-kebab-case name.
 *
 * @param {{ config: object, root: string, file: unknown, name: unknown,
 *   validate?: (definition: object) => unknown }} options
 * @returns {Promise<{ ok: true, document: object } |
 *   { ok: false, code: 'invalid-name' | 'not-found' | 'exists' | 'invalid' | 'unsafe-path'
 *     | 'no-dirs' | 'invalid-request', message: string,
 *     diagnostics?: { message: string, field?: string }[] }>}
 */
export async function duplicateDocument({ config, root, file, name, validate } = {}) {
  const base = baseRoot(root)
  const candidate = typeof name === 'string' ? name.trim() : ''
  if (!NAME_PATTERN.test(candidate) || candidate.length > MAX_NAME_CHARS || candidate === RESERVED_NAME) {
    return {
      ok: false,
      code: 'invalid-name',
      message: 'name must be lower-kebab-case, at most 64 characters, and not "lead"',
    }
  }
  const resolvedSource = await resolveTarget({ config, root: base, file, forWrite: false })
  if (!resolvedSource.ok) return resolvedSource
  const dirs = await writableDirs(config, base)
  if (dirs.length === 0) {
    return { ok: false, code: 'no-dirs', message: 'no writable soul directory is configured; set dirs to a workspace-relative directory first' }
  }
  const target = join(dirs[0], `${candidate}.md`)
  return withNameUniquenessLock(base, () => withMutationLocks([resolvedSource.target, target], async () => {
    const source = await readDocument({ config, root: base, file: resolvedSource.target })
    if (!source.ok) return source
    const split = splitDocument(source.document.source, {
      sourcePath: source.document.file,
      sourceLabel: source.document.label,
    })
    const composed = composeDocument({
      fields: { ...split.fields, name: candidate },
      sections: split.sections,
    })
    if (sourceExceedsLimit(composed.source)) {
      return { ok: false, code: 'invalid-request', message: 'the duplicated soul source exceeds the 1 MiB limit' }
    }
    if (!composed.valid) {
      return {
        ok: false,
        code: 'invalid',
        message: 'the duplicated soul document is invalid and was not created',
        diagnostics: composed.diagnostics,
      }
    }
    const parsed = parseSoulMarkdown(composed.source)
    if (parsed.definition === undefined) {
      return { ok: false, code: 'invalid', message: 'the duplicated soul document is invalid and was not created', diagnostics: composed.diagnostics }
    }
    for (const dir of dirs) {
      const candidateFile = join(dir, `${candidate}.md`)
      if (await lstatOrNull(candidateFile) !== null) {
        return { ok: false, code: 'exists', message: `a soul named "${candidate}" already exists: ${candidateFile}` }
      }
    }
    const duplicate = await duplicateNameOf({ config, root: base, name: candidate, excludeFile: target })
    if (duplicate !== null) return duplicateNameFailure(candidate, duplicate, 'exists')
    const diagnostics = await validationDiagnostics(validate, parsed.definition)
    if (diagnostics.length > 0) {
      return { ok: false, code: 'invalid', message: 'the duplicated soul document is invalid and was not created', diagnostics }
    }
    try {
      await writeAtomic(target, composed.source, { noReplace: true })
    } catch (error) {
      if (error?.code === 'EEXIST') {
        return { ok: false, code: 'exists', message: `a soul named "${candidate}" already exists: ${target}` }
      }
      return { ok: false, code: 'invalid-request', message: `cannot write the document: ${messageOf(error)}` }
    }
    const detail = await readDocument({ config, root: base, file: target })
    if (!detail.ok) return detail
    return { ok: true, document: detail.document }
  }))
}

/**
 * The recoverable-trash directory for one workspace root.
 *
 * It sits beside the configured bindings document, so all plugin-owned runtime
 * state lives in one place (`<dirname(bindingsFile)>/trash`). Without a
 * configured file the historical `<root>/.dsh/agent-soul/trash` location is
 * used.
 * @param {string} root
 * @param {object} [config] - normalized plugin config.
 * @returns {string} absolute path (the directory may not exist yet).
 */
function trashDirectoryOf(root, config) {
  const base = baseRoot(root)
  const configured = typeof config?.bindingsFile === 'string' ? config.bindingsFile.trim() : ''
  if (configured !== '') {
    const file = isAbsolute(configured) ? resolve(configured) : join(base, configured)
    return join(dirname(file), 'trash')
  }
  return join(base, ...TRASH_DIR_SEGMENTS)
}

/**
 * Sortable trash-file prefix: `YYYYMMDDTHHMMSSmmmZ` (UTC, no separators).
 * @param {Date} [date]
 * @returns {string}
 */
function trashTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:.]/gu, '')
}

/**
 * Validate a trashed-file path and resolve it inside the workspace trash directory.
 *
 * Mirrors {@link resolveTarget}'s `.md` rule and symlink fence, with the trash
 * directory (not a configured soul directory) as the boundary. The file
 * itself may still be absent here; the caller reports `not-found`.
 *
 * @param {string} root
 * @param {unknown} trashedFile
 * @returns {Promise<{ ok: true, target: string } |
 *   { ok: false, code: 'unsafe-path', message: string }>}
 */
async function resolveTrashedTarget(root, config, trashedFile) {
  const base = baseRoot(root)
  const raw = typeof trashedFile === 'string' ? trashedFile.trim() : ''
  if (raw === '') return { ok: false, code: 'unsafe-path', message: 'a trashed file path is required' }
  if (!raw.toLowerCase().endsWith('.md')) {
    return { ok: false, code: 'unsafe-path', message: `the trashed path must end with .md: ${raw}` }
  }
  const trashDir = trashDirectoryOf(base, config)
  const target = isAbsolute(raw) ? resolve(raw) : resolve(base, raw)
  if (target === trashDir || !within(trashDir, target)) {
    return {
      ok: false,
      code: 'unsafe-path',
      message: `the trashed path is outside the trash directory: ${raw}`,
    }
  }
  const realTrash = await realpathOrNull(trashDir)
  if (realTrash !== null) {
    const parent = dirname(target)
    const realParent = await realpathOrNull(parent)
    if (realParent === null || !within(realTrash, realParent)) {
      return {
        ok: false,
        code: 'unsafe-path',
        message: `the trashed path escapes the trash directory through a symbolic link: ${raw}`,
      }
    }
    const info = await lstatOrNull(target)
    if (info !== null && info.isSymbolicLink()) {
      const realTarget = await realpathOrNull(target)
      if (realTarget === null || !within(realTrash, realTarget)) {
        return {
          ok: false,
          code: 'unsafe-path',
          message: `the trashed path escapes the trash directory through a symbolic link: ${raw}`,
        }
      }
    }
  }
  return { ok: true, target }
}

/**
 * Delete one document from a configured soul directory, recoverably.
 *
 * The file is moved to the trash directory beside the configured bindings
 * document (`<dirname(bindingsFile)>/trash`, default
 * `<root>/.dsh/agent-soul/trash/`) under a
 * `<timestamp>-<basename>` name (sortable, `.md` preserved), adding a unique
 * suffix on collision and publishing no-replace, so a delete can be undone with
 * {@link restoreDocument}. If the trash directory cannot be created
 * or the move fails, the old hard delete runs instead and the result omits
 * `trashedFile`. Path safety is applied before anything is moved.
 *
 * @param {{ config: object, root: string, file: unknown }} options
 * @returns {Promise<{ ok: true, file: string, trashedFile?: string } |
 *   { ok: false, code: 'unsafe-path' | 'not-found' | 'invalid-request', message: string }>}
 */
export async function deleteDocument({ config, root, file } = {}) {
  const base = baseRoot(root)
  const resolved = await resolveTarget({ config, root: base, file, forWrite: true })
  if (!resolved.ok) return resolved
  const target = resolved.target
  return withMutationLocks([target], async () => {
    const info = await lstatOrNull(target)
    if (info === null) return { ok: false, code: 'not-found', message: `the document does not exist: ${target}` }
    if (info.isDirectory()) {
      return { ok: false, code: 'unsafe-path', message: `the document path is a directory: ${target}` }
    }
    const trashDir = trashDirectoryOf(base, config)
    const timestamp = trashTimestamp()
    try {
      await mkdir(trashDir, { recursive: true })
      for (let attempt = 0; attempt < 1000; attempt += 1) {
        const unique = attempt === 0 ? '' : `${process.pid}.${++temporaryCounter}-`
        const trashedFile = join(trashDir, `${timestamp}-${unique}${basename(target)}`)
        try {
          await moveNoReplace(target, trashedFile)
          return { ok: true, file: target, trashedFile }
        } catch (error) {
          if (error?.code === 'EEXIST') continue
          throw error
        }
      }
      return { ok: false, code: 'invalid-request', message: `cannot allocate a unique trash filename for: ${target}` }
    } catch {
      // Intentional compatibility fallback: when trash cannot be created or the
      // no-replace move fails for a non-collision reason, hard-delete the source.
      try {
        await unlink(target)
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return { ok: false, code: 'not-found', message: `the document does not exist: ${target}` }
        }
        return { ok: false, code: 'invalid-request', message: `cannot delete the document: ${messageOf(error)}` }
      }
      return { ok: true, file: target }
    }
  })
}

/**
 * Move one trashed document back to a configured soul directory.
 *
 * Both paths are fenced: `trashedFile` must resolve inside the workspace trash
 * directory and `file` inside a configured soul directory (the same helpers a
 * save uses). An existing target is refused with `exists` rather than
 * overwritten, and a missing trashed file is `not-found`.
 *
 * @param {{ config: object, root: string, trashedFile: unknown, file: unknown }} options
 * @returns {Promise<{ ok: true, document: object } |
 *   { ok: false, code: 'unsafe-path' | 'not-found' | 'exists' | 'invalid' | 'invalid-request',
 *     message: string }>}
 */
export async function restoreDocument({ config, root, trashedFile, file } = {}) {
  const base = baseRoot(root)
  const trashed = await resolveTrashedTarget(base, config, trashedFile)
  if (!trashed.ok) return trashed
  const resolved = await resolveTarget({ config, root: base, file, forWrite: true })
  if (!resolved.ok) return resolved
  const target = resolved.target
  return withNameUniquenessLock(base, () => withMutationLocks([trashed.target, target], async () => {
    const info = await lstatOrNull(trashed.target)
    if (info === null) return { ok: false, code: 'not-found', message: `the trashed document does not exist: ${trashed.target}` }
    if (!info.isFile() && !info.isSymbolicLink()) {
      return { ok: false, code: 'unsafe-path', message: `the trashed path is not a regular file: ${trashed.target}` }
    }
    if (await lstatOrNull(target) !== null) {
      return { ok: false, code: 'exists', message: `the restore target already exists: ${target}` }
    }
    // Parse valid trashed souls before publication so restore cannot bypass the
    // document layer's frontmatter-name uniqueness rule. Invalid legacy files
    // remain restorable, as before, but still obey the read-size bound.
    const fileInfo = await statOrNull(trashed.target)
    if (fileInfo === null) return { ok: false, code: 'not-found', message: `the trashed document does not exist: ${trashed.target}` }
    if (fileInfo.size > MAX_SOUL_FILE_BYTES) {
      return { ok: false, code: 'invalid-request', message: `the trashed document exceeds the 1 MiB limit: ${trashed.target}` }
    }
    try {
      const source = await readFile(trashed.target, 'utf8')
      const parsed = parseSoulMarkdown(source, { sourcePath: trashed.target, sourceLabel: labelOf(base, trashed.target) })
      if (parsed.definition !== undefined) {
        const duplicate = await duplicateNameOf({ config, root: base, name: parsed.definition.name, excludeFile: target })
        if (duplicate !== null) return duplicateNameFailure(parsed.definition.name, duplicate)
      }
    } catch (error) {
      return { ok: false, code: 'invalid-request', message: `cannot read the trashed document: ${messageOf(error)}` }
    }
    try {
      await moveNoReplace(trashed.target, target)
    } catch (error) {
      if (error?.code === 'EEXIST') {
        return { ok: false, code: 'exists', message: `the restore target already exists: ${target}` }
      }
      if (error?.code === 'ENOENT') {
        return { ok: false, code: 'not-found', message: `the trashed document does not exist: ${trashed.target}` }
      }
      return { ok: false, code: 'invalid-request', message: `cannot restore the document: ${messageOf(error)}` }
    }
    const detail = await readDocument({ config, root: base, file: target })
    if (!detail.ok) return detail
    return { ok: true, document: detail.document }
  }))
}
