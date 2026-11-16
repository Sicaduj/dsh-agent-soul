/**
 * Regression contract for Windows-safe workspace and discovery guidance.
 *
 * An orchestration run on Windows failed with
 * `glob search failed (exit 2): rg: <path>: The system cannot find the file
 * specified. (os error 2)` because the Lead probed a scratch directory its
 * teammate had been told to create, before the teammate created it. The tool
 * was available the whole time. These cases pin the plugin-side safeguards that
 * keep that failure class from reading as "glob is unsupported on Windows":
 *
 * - the bundled doctrine still parses with no diagnostics;
 * - the workspace-preparation rules stay inside the canonical Delegation
 *   section and the expected-absence rules inside Exception & Recovery, so a
 *   GUI save round-trip keeps them in their sections instead of demoting them
 *   to extra markdown;
 * - every shipped soul that can discover files carries the same discovery
 *   safety block inside its Hard Rules section;
 * - no shipped guidance teaches a POSIX-only shell idiom as if it were
 *   portable. The bytes are deliberately literal so the check is auditable.
 *
 * Every fixture is deterministic and local: one temporary workspace, the real
 * document layer, and the shipped Markdown files. No Host, profile, model, or
 * network is involved; nothing under the package is written.
 *
 * Run with: node --test smoke/windows-discovery-discipline.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readOrchestrator, saveOrchestrator } from '../lib/orchestrator.js'

const SMOKE_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = dirname(SMOKE_DIR)

/** The souls that can discover files: three declare `glob`, two inherit every tool. */
const DISCOVERY_SOULS = Object.freeze([
  'researcher.md',
  'scribe.md',
  'adversarial-red-team-verifier.md',
  'software-engineer.md',
  'generalist.md',
])

/** Create one disposable workspace root under the OS temporary directory. */
function tempWorkspace(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-soul-windows-discovery-')))
  t.after(() => {
    assert.equal(dirname(root), realpathSync(tmpdir()), 'cleanup only removes the fixture under the OS temp directory')
    rmSync(root, { recursive: true, force: true })
  })
  return root
}

/** Read one file's text with line endings normalized. */
function sourceOf(path) {
  return readFileSync(path, 'utf8').replace(/\r\n?/gu, '\n')
}

/** The body of one canonical `##` section, normalized. */
function sectionOf(source, title) {
  const lines = source.split('\n')
  const start = lines.findIndex(line => line === `## ${title}`)
  assert.notEqual(start, -1, `the document must have a ## ${title} section`)
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines.slice(start + 1, next === -1 ? lines.length : next).join('\n').trim()
}

/** The plugin config the document layer defaults to in this package. */
const CONFIG = Object.freeze({ bundled: true })

test('the bundled doctrine keeps the new guidance inside its canonical sections', async t => {
  const root = tempWorkspace(t)
  const read = await readOrchestrator({ config: CONFIG, root })
  assert.equal(read.ok, true, JSON.stringify(read))
  assert.equal(read.orchestrator.valid, true, JSON.stringify(read.orchestrator.diagnostics))
  assert.deepEqual(read.orchestrator.diagnostics, [])
  assert.equal(read.orchestrator.bundled, true, 'the packaged default is the effective doctrine')

  const delegation = read.orchestrator.sections.delegation
  assert.match(delegation, /### Workspace preparation/u)
  assert.match(delegation, /Test-Path -LiteralPath/u, 'the Windows existence check is named')
  assert.match(delegation, /New-Item -ItemType Directory/u, 'the Windows directory creation is named')
  assert.match(delegation, /does not probe it, list it, or wait on it|do not probe it, list it, or wait on it/u)

  const recovery = read.orchestrator.sections.recovery
  assert.match(recovery, /### Expected absence/u)
  assert.match(recovery, /state fact, not a tool failure/u)
  assert.match(recovery, /does not consume a corrective cycle/u)
  assert.match(recovery, /give each provisional call its own error handling/u)

  assert.equal(read.orchestrator.sections.extraMarkdown.trim(), '',
    'a ### sub-heading must stay inside its canonical section, never become extra markdown')
})

test('a save round-trip keeps the guidance inside the same sections', async t => {
  const root = tempWorkspace(t)
  const first = await readOrchestrator({ config: CONFIG, root })
  assert.equal(first.ok, true)

  const saved = await saveOrchestrator({
    config: CONFIG,
    root,
    fields: first.orchestrator.fields,
    sections: first.orchestrator.sections,
  })
  assert.equal(saved.ok, true, JSON.stringify(saved))

  const second = await readOrchestrator({ config: CONFIG, root })
  assert.equal(second.ok, true)
  assert.equal(second.orchestrator.bundled, false, 'the round-trip writes a workspace override')
  assert.match(second.orchestrator.sections.delegation, /### Workspace preparation/u)
  assert.match(second.orchestrator.sections.recovery, /### Expected absence/u)
  assert.match(second.orchestrator.sections.recovery, /state fact, not a tool failure/u)
  assert.equal(second.orchestrator.sections.extraMarkdown.trim(), '',
    'the ### sub-headings survive as section content, not extras')
})

test('every discovery-capable soul carries the same safety block in Hard Rules', () => {
  for (const file of DISCOVERY_SOULS) {
    const hardRules = sectionOf(sourceOf(join(PACKAGE_DIR, 'agents', file)), 'Hard Rules')
    assert.match(hardRules, /### Workspace and discovery safety/u, file)
    assert.match(hardRules, /not present", not a tool failure/u, file)
    assert.match(hardRules, /Scope `glob` and `grep` to the assigned directory/u, file)
    assert.match(hardRules, /registered shell and native path forms/u, file)
    assert.match(hardRules, /as a hypothesis/u, file)
  }
})

test('the guidance names the two Windows error shapes it addresses', () => {
  const recovery = sectionOf(sourceOf(join(PACKAGE_DIR, 'defaults', 'orchestrator.md')), 'Exception & Recovery')
  assert.match(recovery, /missing file is a path problem/u,
    'a discovery I/O error must be framed as a path problem')
  for (const file of DISCOVERY_SOULS) {
    const hardRules = sectionOf(sourceOf(join(PACKAGE_DIR, 'agents', file)), 'Hard Rules')
    assert.match(hardRules, /unreadable entries there make an unrestricted listing fail on Windows/u, file)
  }
})

test('shipped guidance does not teach POSIX-only shell idioms as portable', () => {
  const files = [
    join(PACKAGE_DIR, 'defaults', 'orchestrator.md'),
    ...DISCOVERY_SOULS.map(file => join(PACKAGE_DIR, 'agents', file)),
  ]
  const posixOnly = [
    [/mkdir\s+-p/u, 'mkdir -p'],
    [/\/tmp\//u, '/tmp/'],
    [/\$HOME/u, '$HOME'],
    [/~\//u, '~/'],
    [/(^|\s)test\s+-d(\s|$)/mu, 'test -d'],
  ]
  for (const file of files) {
    const source = sourceOf(file)
    for (const [pattern, label] of posixOnly) {
      assert.doesNotMatch(source, pattern, `${file}: ${label} is POSIX-only guidance`)
    }
  }
})
