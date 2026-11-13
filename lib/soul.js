/** Agent Soul parsing, persona composition, and catalog discovery.
 *
 * A soul is one Markdown file with YAML frontmatter; this module validates it, composes the
 * teammate persona, discovers soul files for a workspace root, and renders the Lead catalog.
 * Only `node:` builtins are imported because the plugin loads from a profile where this
 * package's own dependencies do not resolve.
 *
 * @module @local/dsh-agent-soul/lib/soul
 */
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The soul catalog shipped inside this package.
 *
 * With `bundled: true` (the default) the catalog scan appends this directory
 * after the configured directories, so an installation exposes its bundled
 * souls in every workspace while local directories still take precedence for a
 * duplicate name. The path is resolved from this module's own URL, so the
 * package may be linked, copied into a profile, or run from a source checkout.
 * @type {string}
 */
export const BUNDLED_SOULS_DIR = fileURLToPath(new URL('../agents', import.meta.url))

/** Valid teammate name: lower-kebab-case. */
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
/** Tool names may carry namespace separators (`mcp__server__tool`). */
const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/
/** Frontmatter keys are flat YAML mapping keys. */
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/
const MAX_NAME_CHARS = 64
const MAX_DESCRIPTION_CHARS = 2000
const MAX_DEPTH = 8
const DEFAULT_MAX_DEFINITIONS = 64
const DEFAULT_MAX_PROMPT_CHARS = 12000
const MAX_CATALOG_DESCRIPTION_CHARS = 600
/** Never read a soul file larger than 1 MiB into the Host process. */
const MAX_SOUL_FILE_BYTES = 1024 * 1024
/** Bound each refresh across all configured directories, not merely per directory. */
const MAX_SCAN_FILES = 1000
/** The Team Lead's reserved identity: never a valid Agent Soul name. */
const RESERVED_NAME = 'lead'
/** Exact parser diagnostic text for the reserved identity. */
const RESERVED_NAME_MESSAGE = `name: "${RESERVED_NAME}" is reserved for the Team Lead`
/** Exact Lead-facing catalog preamble; entries are appended after the trailing blank line. */
const CATALOG_HEADER = `## Available teammate souls

A teammate started with \`spawn_teammate({ ..., agent_type: "<name>" })\` runs with the matching soul: its role definition is applied at the deployment-persona position (a configured deployment prefix line is still emitted first), its tool list becomes a hard permission matrix, and its model becomes the routed model. Every Team child must run a defined Agent Soul. If no soul matches the task, omit \`agent_type\` and the configured default Agent Soul is used; if no default is usable, \`spawn_teammate\` fails and names the reason. Never start a child with \`subagent\` or \`subagent_fork\` (both are denied for Team members and rejected at creation; a strict soul tool list also hides them), and never invent a soul name. Match a task to a soul by its description; call \`list_agent_souls\` for full detail.

`
/** Soul contract paragraph inside every teammate persona. */
const PERSONA_PREAMBLE =
  'The Agent Soul below is your system-level operating contract for this session. It is your authoritative role definition: where it conflicts with the deployment persona or other generic guidance, follow the Agent Soul, including its Hard Rules and Output Format.'
function messageOf(error) { return error instanceof Error ? error.message : String(error) }
/** @param {Record<string, unknown>} data @returns {boolean} */
function has(data, key) { return Object.prototype.hasOwnProperty.call(data, key) }
/** @param {unknown} value @param {number} fallback @returns {number} */
function normalizeLimit(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}
/** Strip one YAML inline comment from an unquoted value. */
function stripInlineComment(value) {
  let quote = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote !== '') {
      if (char === '\\' && quote === '"') index += 1
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '#' && (index === 0 || /[\s]/.test(value[index - 1]))) return value.slice(0, index).trimEnd()
  }
  return value.trimEnd()
}
/** Parse one scalar of the YAML subset. @param {string} raw @returns {unknown} */
function parseScalar(raw) {
  const text = raw.trim()
  if (text === '' || text === '~' || /^(?:null|Null|NULL)$/.test(text)) return null
  if (/^(?:true|True|TRUE)$/.test(text)) return true
  if (/^(?:false|False|FALSE)$/.test(text)) return false
  if (text.startsWith('"')) {
    if (text.length < 2 || !text.endsWith('"')) throw new Error('unterminated double-quoted string')
    try { return JSON.parse(text) } catch { throw new Error('invalid escape sequence in double-quoted string') }
  }
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) throw new Error('unterminated single-quoted string')
    return text.slice(1, -1).replace(/''/g, "'")
  }
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) ? Number(text) : text
}
/** Split the inside of a flow sequence into item source texts. */
function splitFlowItems(inner) {
  const items = []
  let current = ''
  let quote = ''
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]
    if (quote !== '') {
      current += char
      if (char === '\\' && quote === '"') { current += inner[++index] ?? ''; continue }
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") { quote = char; current += char; continue }
    if ('[]{}'.includes(char)) throw new Error(`unexpected "${char}" in flow sequence`)
    if (char === ',') { items.push(current); current = ''; continue }
    current += char
  }
  if (quote !== '') throw new Error('unterminated quoted string in flow sequence')
  items.push(current)
  return items
}
/** Parse one YAML-subset value: scalar, flow sequence, or plain scalar. */
function parseValue(raw) {
  const text = stripInlineComment(raw.trim())
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) throw new Error('unterminated flow sequence')
    const inner = text.slice(1, -1)
    if (inner.trim() === '') return []
    return splitFlowItems(inner).map((item) => {
      if (item.trim() === '') throw new Error('empty item in flow sequence')
      return parseScalar(item)
    })
  }
  if (text.startsWith('{')) throw new Error('inline mappings are not supported')
  if (/^[|>][+-]?$/.test(text)) throw new Error('block scalars ("|" and ">") are not supported')
  return parseScalar(text)
}
/**
 * Parse the YAML-subset frontmatter block of one Markdown document.
 * @param {string} text
 * @returns {{ data: Record<string, unknown> | null, body: string, errors: string[] }}
 *   `data` is null when there is no complete frontmatter block; `errors` carries line-scoped messages.
 */
export function parseFrontmatter(text) {
  const source = typeof text === 'string' ? text.replace(/^\uFEFF/, '') : ''
  const lines = source.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { data: null, body: source, errors: [] }
  let closing = -1
  for (let index = 1; index < lines.length; index += 1) if (lines[index].trim() === '---') { closing = index; break }
  if (closing === -1) return { data: null, body: '', errors: ['missing closing "---" frontmatter delimiter'] }
  /** @type {Record<string, unknown>} */
  const data = {}
  const errors = []
  let pendingKey = null
  let arrayKey = null
  let arrayItemIndent = -1
  const clear = () => { pendingKey = null; arrayKey = null }
  for (let index = 1; index < closing; index += 1) {
    const lineNo = index + 1
    const line = lines[index]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (line.slice(0, indent).includes('\t')) { errors.push(`line ${lineNo}: tab indentation is not supported`); clear(); continue }
    if (trimmed === '-' || trimmed.startsWith('- ')) {
      if (pendingKey === null) { errors.push(`line ${lineNo}: sequence item without a mapping key`); continue }
      arrayKey = pendingKey
      if (arrayItemIndent === -1) arrayItemIndent = indent
      if (indent !== arrayItemIndent) { errors.push(`line ${lineNo}: inconsistent sequence indentation`); continue }
      try {
        const item = parseValue(trimmed === '-' ? '' : trimmed.slice(2).trim())
        if (Array.isArray(item)) throw new Error('nested sequences are not supported')
        if (data[arrayKey] === null) data[arrayKey] = []
        data[arrayKey].push(item)
      } catch (error) { errors.push(`line ${lineNo}: ${messageOf(error)}`) }
      continue
    }
    const colon = trimmed.indexOf(':')
    if (indent > 0) {
      const unsupported = pendingKey !== null && colon > 0
      errors.push(`line ${lineNo}: ${unsupported ? 'nested mappings are not supported' : 'unexpected indentation'}`)
      clear()
      continue
    }
    if (colon <= 0) { errors.push(`line ${lineNo}: expected "key: value"`); clear(); continue }
    const key = trimmed.slice(0, colon).trim()
    if (!KEY_PATTERN.test(key)) { errors.push(`line ${lineNo}: invalid mapping key "${key}"`); clear(); continue }
    if (has(data, key)) { errors.push(`line ${lineNo}: duplicate mapping key "${key}"`); clear(); continue }
    arrayKey = null
    arrayItemIndent = -1
    const rest = stripInlineComment(trimmed.slice(colon + 1).trim())
    if (rest === '') { data[key] = null; pendingKey = key; continue }
    pendingKey = null
    try { data[key] = parseValue(rest) } catch (error) { data[key] = null; errors.push(`line ${lineNo}: ${messageOf(error)}`) }
  }
  return { data, body: lines.slice(closing + 1).join('\n'), errors }
}
/** Normalize the `tools` field: null = inherit every tool, [] = hide every inherited tool. */
function normalizeTools(value) {
  /** @param {unknown} item @returns {string} */
  const toolName = (item) => {
    if (typeof item !== 'string') throw new Error('must contain only strings')
    const name = item.trim()
    if (name === '') throw new Error('must not contain empty tool names')
    if (!TOOL_NAME_PATTERN.test(name)) throw new Error(`invalid tool name "${name}"`)
    return name
  }
  let items
  if (typeof value === 'string') {
    if (value.trim() === '*') return null
    items = value.split(',').map((item) => item.trim()).filter((item) => item !== '')
    if (items.length === 0) throw new Error('must not be empty')
  } else if (Array.isArray(value)) {
    if (value.length === 1 && value[0] === '*') return null
    items = value
  } else {
    throw new Error('must be "*", a comma-separated string, or a sequence of tool names')
  }
  const names = []
  for (const item of items) {
    const name = toolName(item)
    if (name === '*') throw new Error('must not mix "*" with tool names')
    if (!names.includes(name)) names.push(name)
  }
  return names
}

/** Read and validate one string field; returns '' when absent or invalid. */
function readString(data, key, fail, { required = false, max = 0, pattern = null, hint = '' } = {}) {
  const raw = data[key]
  if (!has(data, key) || raw === null) {
    if (required) fail(`${key}: missing required field`)
    return ''
  }
  if (typeof raw !== 'string' || raw.trim() === '') { fail(`${key}: must be a non-empty string`); return '' }
  const value = raw.trim()
  if (max > 0 && value.length > max) { fail(`${key}: must be at most ${max} characters`); return '' }
  if (pattern !== null && !pattern.test(value)) { fail(`${key}: ${hint}`); return '' }
  return value
}

/** Read one optional non-empty string field. @returns {string | undefined} */
function readOptionalString(data, key, fail) {
  if (!has(data, key) || data[key] === null) return undefined
  if (typeof data[key] === 'string' && data[key].trim() !== '') return data[key].trim()
  fail(`${key}: must be a non-empty string`)
  return undefined
}

/**
 * Parse one soul Markdown document into a validated definition.
 * @param {string} text - complete file contents.
 * @param {{ sourcePath: string, sourceLabel: string, mtimeMs?: number }} meta
 * @returns {{ definition?: object, diagnostics: { source: string, message: string, field?: string }[] }}
 *   `definition` is present only for a valid soul; any diagnostic yields no definition.
 *   A diagnostic may carry the frontmatter `field` it applies to (the reserved name does),
 *   so callers can focus the matching control.
 */
export function parseSoulMarkdown(text, meta = {}) {
  const sourcePath = typeof meta.sourcePath === 'string' ? meta.sourcePath : ''
  const sourceLabel =
    typeof meta.sourceLabel === 'string' && meta.sourceLabel !== '' ? meta.sourceLabel : sourcePath || 'unknown soul'
  /** @type {{ source: string, message: string, field?: string }[]} */
  const diagnostics = []
  /** @param {string} message @param {string} [field] */
  const report = (message, field) => {
    /** @type {{ source: string, message: string, field?: string }} */
    const diagnostic = { source: sourceLabel, message }
    if (typeof field === 'string' && field !== '') diagnostic.field = field
    diagnostics.push(diagnostic)
  }
  let valid = true
  /** @param {string} message @param {string} [field] */
  const fail = (message, field) => { valid = false; report(message, field) }

  const parsed = parseFrontmatter(text)
  if (parsed.data === null) {
    if (parsed.errors.length === 0) report('missing YAML frontmatter (expected a "---" block at the top of the file)')
    parsed.errors.forEach(report)
    return { diagnostics }
  }
  parsed.errors.forEach(report)
  if (parsed.errors.length > 0) return { diagnostics }
  const data = parsed.data

  const hint = 'must be kebab-case (^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$)'
  const name = readString(data, 'name', fail, { required: true, max: MAX_NAME_CHARS, pattern: NAME_PATTERN, hint })
  // `lead` is the Team Lead's reserved identity, so it can never become a soul
  // or a teammate persona. Only the exact name is reserved: `leadership`,
  // `lead-review`, and `lead-2` remain valid soul names.
  if (name === RESERVED_NAME) fail(RESERVED_NAME_MESSAGE, 'name')
  const description = readString(data, 'description', fail, { required: true, max: MAX_DESCRIPTION_CHARS })
  let tools = null
  if (has(data, 'tools') && data.tools !== null) {
    try { tools = normalizeTools(data.tools) } catch (error) { fail(`tools: ${messageOf(error)}`) }
  }
  const model = readOptionalString(data, 'model', fail)
  const provider = readOptionalString(data, 'provider', fail)
  const reasoningEffort = readOptionalString(data, 'reasoning-effort', fail)
  let context
  if (has(data, 'context') && data.context !== null) {
    if (data.context === 'fresh' || data.context === 'fork') context = data.context
    else fail('context: must be "fresh" or "fork"')
  }
  let userInvocable = false
  if (has(data, 'user-invocable') && data['user-invocable'] !== null) {
    if (typeof data['user-invocable'] === 'boolean') userInvocable = data['user-invocable']
    else fail('user-invocable: must be true or false')
  }
  const body = parsed.body.trim()
  if (body === '') fail('body: missing markdown body after the frontmatter block')
  if (!valid) return { diagnostics }

  /** @type {Record<string, unknown>} */
  const definition = { name, description, tools, userInvocable, body, persona: '', sourcePath, sourceLabel, mtimeMs: 0 }
  if (model !== undefined) definition.model = model
  if (provider !== undefined) definition.provider = provider
  if (reasoningEffort !== undefined) definition.reasoningEffort = reasoningEffort
  if (context !== undefined) definition.context = context
  definition.mtimeMs = typeof meta.mtimeMs === 'number' && Number.isFinite(meta.mtimeMs) ? meta.mtimeMs : 0
  definition.persona = composePersona(definition)
  return { definition, diagnostics }
}

/**
 * Compose the teammate system-prompt text from one definition.
 * @param {{ name?: string, description?: string, body?: string }} definition
 * @returns {string}
 */
export function composePersona(definition) {
  const name = typeof definition?.name === 'string' ? definition.name : ''
  const description = typeof definition?.description === 'string' ? definition.description.trim() : ''
  const body = typeof definition?.body === 'string' ? definition.body.trim() : ''
  return [`You are the delegated teammate "${name}".`, '', description, '', PERSONA_PREAMBLE, '', body].join('\n')
}

/** Collapse a description to one line of at most `limit` characters. */
function oneLine(value, limit) {
  const text = (typeof value === 'string' ? value : '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? text.slice(0, limit) : text
}

/** Render one catalog bullet line. */
function formatCatalogEntry(definition, commandPrefix = '') {
  const name = String(definition?.name ?? '')
  const prefix = typeof commandPrefix === 'string' ? commandPrefix : ''
  let tools = 'all'
  if (Array.isArray(definition?.tools)) tools = definition.tools.length === 0 ? 'none' : definition.tools.join(', ')
  const model =
    typeof definition?.model === 'string' && definition.model.trim() !== '' ? definition.model.trim() : 'inherit'
  const command = definition?.userInvocable === true ? `/${prefix}${name}` : 'AI only'
  return `- ${name} — ${oneLine(definition?.description, MAX_CATALOG_DESCRIPTION_CHARS)} (tools: ${tools}; model: ${model}; command: ${command})`
}

/**
 * Prompt catalog text for the Lead; '' when the snapshot has no definitions or no whole entry fits.
 * @param {{ definitions?: object[] } | undefined | null} snapshot
 * @param {{ maxPromptChars?: number, commandPrefix?: string }} [options]
 * @returns {string}
 */
export function catalogPromptText(snapshot, options = {}) {
  const definitions = Array.isArray(snapshot?.definitions) ? snapshot.definitions : []
  if (definitions.length === 0) return ''
  const maxPromptChars = normalizeLimit(options?.maxPromptChars, DEFAULT_MAX_PROMPT_CHARS)
  const entries = [...definitions]
    .sort((left, right) => String(left?.name ?? '').localeCompare(String(right?.name ?? '')))
    .map(definition => formatCatalogEntry(definition, options?.commandPrefix))
  /** @param {number} count @returns {string} */
  const render = (count) => {
    const kept = entries.slice(0, count)
    const remaining = entries.length - count
    let text = CATALOG_HEADER + kept.join('\n')
    if (remaining > 0) text += `${kept.length > 0 ? '\n' : ''}- (${remaining} more souls; call list_agent_souls)`
    return text
  }
  let best = -1
  for (let count = 0; count <= entries.length; count += 1) if (render(count).length <= maxPromptChars) best = count
  return best > 0 ? render(best) : ''
}

/** Label one soul file for display: relative to the scan root when possible. */
function labelOf(root, file) {
  const rel = relative(root, file)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? rel : file
}

/** Resolve one configured directory spec against the catalog root. */
function resolveDir(root, spec) {
  const text = spec.trim()
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return resolve(homedir(), text.slice(2))
  return isAbsolute(text) ? resolve(text) : resolve(root, text)
}

/** Whether `target` is equal to or lexically below `base`. */
function pathWithin(base, target) {
  const rel = relative(base, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Canonical path when it exists, with a lexical fallback for a future trash directory. */
function canonicalPath(path) {
  try { return realpathSync(path) } catch { return resolve(path) }
}

/** Recoverable trash lives beside the bindings document. */
function trashDirectoryOf(root, bindingsFile) {
  const configured = typeof bindingsFile === 'string' && bindingsFile.trim() !== ''
    ? bindingsFile.trim()
    : join('.dsh', 'agent-soul', 'bindings.json')
  const file = isAbsolute(configured) ? resolve(configured) : resolve(root, configured)
  return join(dirname(file), 'trash')
}

/**
 * Recursively collect at most the remaining scan budget of `*.md` files.
 * The trash comparison uses canonical paths so a symlinked configured directory
 * cannot accidentally re-import deleted souls.
 */
function collectMarkdownFiles(dir, diagnostics, logger, state, depth = 0) {
  if (state.capped || pathWithin(state.trashRoot, canonicalPath(dir))) return []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    const message = `cannot read soul directory: ${messageOf(error)}`
    diagnostics.push({ source: dir, message })
    logger?.warn?.(`agent soul: ${message} (${dir})`)
    return []
  }
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  const files = []
  for (const entry of entries) {
    if (state.capped) break
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH) files.push(...collectMarkdownFiles(full, diagnostics, logger, state, depth + 1))
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
 * Create the soul catalog (filesystem discovery + cache).
 * @param {{ dirs: string[], bundled?: boolean, logger?: { warn(message: string): void },
 *           maxDefinitions?: number, maxPromptChars?: number, bindingsFile?: string,
 *           commandPrefix?: string }} options
 * @returns {{ refresh(root: string): Promise<object>, get(root: string): object | undefined,
 *             ensure(root: string): Promise<object>, promptText(root: string): string,
 *             promptCatalogExtension(root: string): string, dispose(): void }}
 */
export function createCatalog(options) {
  const specs = (Array.isArray(options?.dirs) ? options.dirs : []).filter((spec) => typeof spec === 'string' && spec.trim() !== '')
  const logger = options?.logger
  const bundled = options?.bundled !== false
  const maxDefinitions = normalizeLimit(options?.maxDefinitions, DEFAULT_MAX_DEFINITIONS)
  const maxPromptChars = normalizeLimit(options?.maxPromptChars, DEFAULT_MAX_PROMPT_CHARS)
  const commandPrefix = typeof options?.commandPrefix === 'string' ? options.commandPrefix : ''
  /** @type {Map<string, object>} */
  const cache = new Map()
  const keyOf = (root) => resolve(typeof root === 'string' && root.trim() !== '' ? root : process.cwd())

  /** @param {string} root */
  async function refresh(root) {
    const base = keyOf(root)
    const snapshot = {
      root: base,
      dirs: [],
      bundledDir: null,
      definitions: [],
      byName: new Map(),
      diagnostics: [],
      scannedAt: 0,
    }
    const scan = { count: 0, capped: false, trashRoot: canonicalPath(trashDirectoryOf(base, options?.bindingsFile)) }
    // Local directories come first so a workspace definition shadows a bundled
    // soul with the same name (the duplicate diagnostic is reserved for two
    // local definitions, where the intent is ambiguous).
    const candidates = []
    for (const spec of specs) candidates.push(resolveDir(base, spec))
    if (bundled) candidates.push(BUNDLED_SOULS_DIR)
    const bundledCanonical = canonicalPath(BUNDLED_SOULS_DIR)
    const seen = new Set()
    /** Packaged name claims, so two packaged files cannot silently collapse into one. */
    const packagedClaims = new Map()
    let overflow = 0
    for (const dir of candidates) {
      if (scan.capped) break
      const canonical = canonicalPath(dir)
      if (seen.has(canonical)) continue
      seen.add(canonical)
      let stats
      try { stats = statSync(dir) } catch { continue } // Missing soul directories are not diagnostics.
      if (!stats.isDirectory()) { logger?.warn?.(`agent soul: skipping "${dir}" (not a directory)`); continue }
      const isBundled = canonical === bundledCanonical
      if (isBundled) snapshot.bundledDir = dir
      snapshot.dirs.push(dir)
      for (const file of collectMarkdownFiles(dir, snapshot.diagnostics, logger, scan)) {
        const sourceLabel = labelOf(base, file)
        let text
        let fileStat
        try {
          fileStat = statSync(file)
          if (fileStat.size > MAX_SOUL_FILE_BYTES) {
            snapshot.diagnostics.push({ source: sourceLabel, message: `soul file exceeds the 1 MiB limit; skipped before reading` })
            continue
          }
          text = readFileSync(file, 'utf8')
        } catch (error) {
          snapshot.diagnostics.push({ source: sourceLabel, message: `cannot read soul file: ${messageOf(error)}` })
          continue
        }
        const parsed = parseSoulMarkdown(text, { sourcePath: file, sourceLabel, mtimeMs: fileStat.mtimeMs })
        const definition = parsed.definition
        if (!definition) { snapshot.diagnostics.push(...parsed.diagnostics); continue }
        if (isBundled) {
          // Packaged defaults claim a name even while a local definition shadows
          // them. Two packaged files with one name are a broken package, and the
          // later file would otherwise disappear without a trace.
          const packagedClaim = packagedClaims.get(definition.name)
          if (packagedClaim !== undefined) {
            snapshot.diagnostics.push({
              source: sourceLabel,
              message: `duplicate packaged soul name "${definition.name}" (already defined in ${packagedClaim}); ignoring this packaged file`,
            })
            continue
          }
          packagedClaims.set(definition.name, sourceLabel)
        }
        const duplicate = snapshot.byName.get(definition.name)
        if (duplicate) {
          // A local definition intentionally shadows a packaged default.
          if (isBundled) continue
          const message = `duplicate soul name "${definition.name}" (already defined in ${duplicate.sourceLabel}); ignoring this file`
          snapshot.diagnostics.push({ source: sourceLabel, message })
          continue
        }
        if (snapshot.definitions.length >= maxDefinitions) { overflow += 1; continue }
        snapshot.definitions.push(definition)
        snapshot.byName.set(definition.name, definition)
      }
    }
    if (scan.capped) {
      snapshot.diagnostics.push({
        source: base,
        message: `soul scan stopped after ${MAX_SCAN_FILES} files; additional files were not scanned`,
      })
    }
    if (overflow > 0) {
      const message = `ignoring ${overflow} soul definition(s) beyond maxDefinitions=${maxDefinitions}`
      snapshot.diagnostics.push({ source: base, message })
    }
    snapshot.scannedAt = Date.now()
    cache.set(base, snapshot)
    return snapshot
  }

  const get = (root) => cache.get(keyOf(root))
  async function ensure(root) { return get(root) ?? refresh(root) }
  function promptText(root) {
    const snapshot = get(root)
    return snapshot ? catalogPromptText(snapshot, { maxPromptChars, commandPrefix }) : ''
  }
  function promptCatalogExtension(root) {
    const snapshot = get(root)
    return snapshot && snapshot.definitions.length > 0 ? catalogPromptText(snapshot, { maxPromptChars, commandPrefix }) : ''
  }
  function dispose() { cache.clear() }

  return { refresh, get, ensure, promptText, promptCatalogExtension, dispose }
}
