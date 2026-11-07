/**
 * Regression tests for QAS-F001: the Lead-only `manage_agent_souls` tool's
 * `get_orchestrator` result carries `bundled` and `sourcePath`, so the tool's
 * own registered output schema must declare both.
 *
 * The tools pipeline validates every successful value against that schema and
 * closes the root object with `additionalProperties: false`; an undeclared
 * field therefore turns each `get_orchestrator` call into a `ToolOutputError`
 * instead of returning the doctrine. This file reproduces the contract at the
 * registration boundary: it installs the real `installSoulAdminTool`, reads the
 * tool definition back from the capturing registry, and checks the three result
 * variants (packaged default, valid workspace document, invalid workspace
 * document) against that exact schema plus a zero-write workspace fingerprint.
 *
 * The validator below is test-owned and implements only the documented JSON
 * Schema subset (`type`/`oneOf`/`properties`/`required`/`additionalProperties`/
 * `items`/`enum`), so the result is judged against the schema's declared
 * semantics rather than the implementation under test. Every case uses a fresh
 * disposable workspace under the OS temporary directory: no real profile, no
 * plugin installation, and no writes outside the temporary directory.
 *
 * Run with: `node --test smoke/remediation-admin.test.mjs`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { installSoulAdminTool } from '../lib/admin-tool.js'

/** Normalized plugin config this workspace uses for every case. */
const CONFIG = Object.freeze({
  dirs: ['.dsh/agents'],
  bundled: false,
  bindingsFile: '.dsh/agent-soul/bindings.json',
})

/** State directory and document name the tool reports for this config. */
const STATE_RELATIVE = join('.dsh', 'agent-soul')
const ORCHESTRATOR_RELATIVE = join(STATE_RELATIVE, 'orchestrator.md')

/** A workspace document the orchestrator analyzer accepts. */
const VALID_SOURCE = '---\nname: qa-orchestrator\n---\n\nWorkspace doctrine body.\n'

/** A workspace document that parses but fails frontmatter validation. */
const INVALID_SOURCE = '---\nname: Not_Kebab\ngate-mode: sometimes\n---\n\nInvalid body.\n'

/** SHA-256 hex digest of one text payload. */
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Independent validator for the tool output contract's JSON Schema subset.
 * @param {object} schema
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string[]} violations
 */
function schemaViolations(schema, value, path = 'value') {
  if (schema === null || typeof schema !== 'object') return []
  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.filter(branch => schemaViolations(branch, value, path).length === 0).length
    return matched === 1 ? [] : [`"${path}" must match exactly one oneOf branch (matched ${matched})`]
  }
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`"${path}" must be an object`]
    const violations = []
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) violations.push(`missing required property "${path}.${key}"`)
    }
    const properties = schema.properties ?? {}
    for (const [key, child] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) continue
      violations.push(...schemaViolations(child, value[key], `${path}.${key}`))
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) {
          violations.push(`"${path}.${key}" is not a declared property (additionalProperties: false)`)
        }
      }
    }
    return violations
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`"${path}" must be an array`]
    if (schema.items === undefined) return []
    return value.flatMap((entry, index) => schemaViolations(schema.items, entry, `${path}[${index}]`))
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return [`"${path}" must be a string`]
    return Array.isArray(schema.enum) && !schema.enum.includes(value)
      ? [`"${path}" must be one of ${JSON.stringify(schema.enum)}`]
      : []
  }
  if (schema.type === 'boolean') return typeof value === 'boolean' ? [] : [`"${path}" must be a boolean`]
  if (schema.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? [] : [`"${path}" must be a number`]
  }
  return []
}

/**
 * Fingerprint every filesystem entry under one workspace: relative path, entry
 * kind, and file content digest. Two equal fingerprints mean the read performed
 * no writes, creates, renames, or deletions.
 * @param {string} root
 * @returns {{ entries: string[], digest: string }}
 */
function treeFingerprint(root) {
  const entries = []
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name)
      const entryPath = relative(root, absolute).split(sep).join('/')
      const info = lstatSync(absolute)
      if (info.isDirectory()) {
        entries.push(`dir ${entryPath}`)
        walk(absolute)
      } else if (info.isFile()) {
        entries.push(`file ${entryPath} ${sha256(readFileSync(absolute))}`)
      } else {
        // Entry kinds this disposable workspace never creates still participate.
        entries.push(`other ${entryPath}`)
      }
    }
  }
  walk(root)
  return { entries, digest: sha256(entries.join('\n')) }
}

/** Whether one absolute path resolves inside a directory (lexical check). */
function isInside(root, target) {
  const entryPath = relative(root, target)
  return entryPath !== '' && entryPath !== '..' && !entryPath.startsWith(`..${sep}`) && !isAbsolute(entryPath)
}

/** Create one disposable workspace; the caller removes it. */
function makeWorkspace(label) {
  return mkdtempSync(join(tmpdir(), `agent-soul-${label}-`))
}

/**
 * Register the real tool for one workspace and expose it for direct execution.
 * @param {string} root - the workspace root this Lead belongs to.
 * @param {object} [config] - normalized plugin config.
 * @returns {{ tool: object, warnings: string[], call(args: object): Promise<object> }}
 */
function installProbe(root, config = CONFIG) {
  const registered = []
  const warnings = []
  const scope = { tools: { register(tool) { registered.push(tool); return () => {} } } }
  const logger = {
    warn(message) { warnings.push(String(message)) },
    info() {},
    debug() {},
    error(message) { warnings.push(String(message)) },
  }
  installSoulAdminTool({ id: 'lead-remediation' }, scope, {
    ctx: { get: () => undefined },
    config,
    catalog: { promptText: () => '' },
    bindings: {},
    logger,
    rootOf: () => root,
    resolveModel: async () => undefined,
    composition: { inspect: () => null, repair: async () => ({ ok: false }) },
    syncSouls: async () => {},
  })
  assert.equal(registered.length, 1, 'installSoulAdminTool registers exactly one tool')
  const tool = registered[0]
  return { tool, warnings, call: async args => await tool.execute(args, { agent: { id: 'lead-remediation' } }) }
}

/** Require that one returned value satisfies the tool's registered output schema. */
function assertSchemaValid(tool, value, label) {
  assert.deepEqual(
    schemaViolations(tool.output.schema, value),
    [],
    `${label}: the get_orchestrator result must satisfy the tool's registered output schema`,
  )
}

/** Require that one read left the workspace byte-for-byte unchanged. */
function assertNoWrites(before, after, label) {
  assert.deepEqual(after.entries, before.entries, `${label}: get_orchestrator must not write into the workspace`)
  assert.equal(after.digest, before.digest, `${label}: the workspace fingerprint must stay stable`)
}

test('QAS-F001.registered-output-schema declares both origin fields and stays closed', async () => {
  const root = makeWorkspace('qas-schema')
  try {
    const { tool } = installProbe(root)
    const schema = tool.output.schema
    assert.equal(tool.name, 'manage_agent_souls')
    assert.equal(schema.type, 'object')
    assert.equal(schema.additionalProperties, false, 'the output schema is closed')
    assert.deepEqual(schema.required, ['ok', 'action'])
    assert.deepEqual(
      Object.keys(schema.properties).sort(),
      ['action', 'bundled', 'diagnostics', 'documents', 'file', 'message', 'ok', 'source', 'sourcePath'].sort(),
      'the closed schema declares exactly the documented result fields',
    )
    assert.deepEqual(schema.properties.bundled, { type: 'boolean' })
    assert.deepEqual(schema.properties.sourcePath, { type: 'string' })
    assert.equal(schema.required.includes('bundled'), false, 'bundled is optional: no other action returns it')
    assert.equal(schema.required.includes('sourcePath'), false, 'sourcePath is optional: no other action returns it')
    for (const [name, type] of [
      ['ok', 'boolean'], ['action', 'string'], ['message', 'string'], ['file', 'string'],
      ['source', 'string'], ['documents', 'array'], ['diagnostics', 'array'],
    ]) {
      assert.equal(schema.properties[name].type, type, `declared property ${name} keeps its type`)
    }
    assert.equal(schema.properties.documents.items.type, 'object')
    assert.equal(schema.properties.diagnostics.items.type, 'object')
    assert.equal(schema.properties.diagnostics.items.additionalProperties, false)
    assert.deepEqual(schema.properties.diagnostics.items.required, ['message'])

    // Negative control: the closure assertion above must come from the schema,
    // so an undeclared field on a real-shaped value is rejected by the validator.
    assert.deepEqual(
      schemaViolations(schema, {
        ok: true,
        action: 'get_orchestrator',
        bundled: true,
        sourcePath: '/tmp/defaults/orchestrator.md',
        undeclaredField: 1,
      }),
      ['"value.undeclaredField" is not a declared property (additionalProperties: false)'],
      'the closed schema rejects a field it does not declare',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('QAS-F001.bundled-default result is schema-valid and writes nothing', async () => {
  const root = makeWorkspace('qas-bundled')
  try {
    const probe = installProbe(root, { ...CONFIG, bundled: true })
    const before = treeFingerprint(root)
    const result = await probe.call({ action: 'get_orchestrator' })

    assert.equal(result.ok, true)
    assert.equal(result.action, 'get_orchestrator')
    assert.equal(result.bundled, true, 'a workspace without a definition reports the packaged default as bundled')
    assert.equal(typeof result.sourcePath, 'string')
    assert.ok(
      result.sourcePath.endsWith(join('defaults', 'orchestrator.md')),
      `sourcePath names the packaged default doctrine: ${result.sourcePath}`,
    )
    assert.equal(existsSync(result.sourcePath), true, 'the packaged default doctrine exists')
    assert.equal(isInside(root, result.sourcePath), false, 'the packaged default stays outside the workspace')
    assert.equal(result.file, join(root, ORCHESTRATOR_RELATIVE), 'file stays the writable workspace definition')
    assert.equal(typeof result.source, 'string')
    assert.ok(result.source.length > 0, 'source carries the doctrine Markdown')
    assert.deepEqual(result.diagnostics, [])
    assert.ok(
      result.message.includes(result.sourcePath) && result.message.includes(result.file),
      'the message names both the packaged source and the writable workspace target',
    )
    assertSchemaValid(probe.tool, result, 'bundled default')
    assert.deepEqual(probe.warnings, [], 'the bundled read logs no failure warning')

    assert.equal(existsSync(join(root, '.dsh')), false, 'reading the bundled default must not create workspace state')
    assertNoWrites(before, treeFingerprint(root), 'bundled default')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('QAS-F001.valid-workspace-definition result is schema-valid and writes nothing', async () => {
  const root = makeWorkspace('qas-valid')
  try {
    const path = join(root, ORCHESTRATOR_RELATIVE)
    mkdirSync(join(root, STATE_RELATIVE), { recursive: true })
    writeFileSync(path, VALID_SOURCE)
    const probe = installProbe(root)
    const before = treeFingerprint(root)
    const result = await probe.call({ action: 'get_orchestrator' })

    assert.equal(result.ok, true)
    assert.equal(result.action, 'get_orchestrator')
    assert.equal(result.bundled, false, 'a workspace definition wins over the packaged default')
    assert.equal(result.sourcePath, path)
    assert.equal(result.file, path)
    assert.equal(result.source, VALID_SOURCE)
    assert.ok(
      result.message.includes(path) && !result.message.includes('(invalid)'),
      'a valid document is reported as loaded without an invalid marker',
    )
    assert.deepEqual(result.diagnostics, [])
    assertSchemaValid(probe.tool, result, 'valid workspace definition')
    assert.deepEqual(probe.warnings, [], 'the workspace read logs no failure warning')

    assertNoWrites(before, treeFingerprint(root), 'valid workspace definition')
    assert.equal(readFileSync(path, 'utf8'), VALID_SOURCE, 'the document is read, never rewritten')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('QAS-F001.invalid-workspace-definition result is schema-valid and writes nothing', async () => {
  const root = makeWorkspace('qas-invalid')
  try {
    const path = join(root, ORCHESTRATOR_RELATIVE)
    mkdirSync(join(root, STATE_RELATIVE), { recursive: true })
    writeFileSync(path, INVALID_SOURCE)
    const probe = installProbe(root)
    const before = treeFingerprint(root)
    const result = await probe.call({ action: 'get_orchestrator' })

    assert.equal(result.ok, true, 'an invalid document is still returned so the model can repair it')
    assert.equal(result.action, 'get_orchestrator')
    assert.equal(result.bundled, false)
    assert.equal(result.sourcePath, path)
    assert.equal(result.file, path)
    assert.equal(result.source, INVALID_SOURCE)
    assert.ok(
      result.message.includes(path) && result.message.includes('(invalid)'),
      'the invalid document is reported as loaded (invalid) so the model knows to repair it',
    )
    assert.ok(Array.isArray(result.diagnostics) && result.diagnostics.length >= 1, 'an invalid document reports diagnostics')
    for (const diagnostic of result.diagnostics) {
      assert.equal(diagnostic.source, path)
      assert.equal(typeof diagnostic.message, 'string')
      assert.notEqual(diagnostic.message, '')
    }
    assertSchemaValid(probe.tool, result, 'invalid workspace definition')
    assert.deepEqual(probe.warnings, [], 'the invalid-document read reports through diagnostics, not warnings')

    assertNoWrites(before, treeFingerprint(root), 'invalid workspace definition')
    assert.equal(readFileSync(path, 'utf8'), INVALID_SOURCE, 'the invalid document is never rewritten')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
