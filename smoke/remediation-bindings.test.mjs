import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const moduleURL = process.env.BINDINGS_MODULE ?? new URL('../lib/bindings.js', import.meta.url).href
const { createBindingStore } = await import(moduleURL)
const plan = name => ({ name, persona: `persona-${name}`, tools: ['read'],
  model: { provider: 'test', model: name, reasoningEffort: 'high' }, context: 'fresh' })
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-soul-bindings-repair-'))
  t.after(async () => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()))
    assert.ok(dir.includes('agent-soul-bindings-repair-'))
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}
const document = async path => JSON.parse(await readFile(path, 'utf8'))
const keys = async path => Object.keys((await document(path)).bindings).sort()

test('QAS-F002 concurrent primed roots and independent stores retain every record', async t => {
  const dir = await fixture(t), fileSpec = join(dir, 'bindings.json')
  const stores = Array.from({ length: 8 }, () => createBindingStore({ fileSpec }))
  await Promise.all(stores.map((store, i) => store.get(join(dir, `root-${i}`), 'prime')))
  await Promise.all(stores.map((store, i) => store.set(join(dir, `root-${i}`), `child-${i}`, plan(`soul-${i}`))))
  assert.deepEqual(await keys(fileSpec), stores.map((_, i) => `child-${i}`))
  const fresh = createBindingStore({ fileSpec })
  for (let i = 0; i < stores.length; i += 1) {
    assert.deepEqual(await fresh.get(join(dir, `root-${i}`), `child-${i}`),
      { ...plan(`soul-${i}`), sourceLabel: '' })
  }
  assert.deepEqual((await readdir(dir)).filter(name => /\.(tmp|lock)$/.test(name)), [])
})

test('same-root concurrent mutations retain all rows and expose only complete JSON', async t => {
  const dir = await fixture(t), fileSpec = join(dir, 'bindings.json')
  const store = createBindingStore({ fileSpec })
  await store.set(dir, 'initial', plan('initial'))
  let done = false, reads = 0
  const reader = (async () => {
    while (!done) {
      const current = await document(fileSpec)
      assert.equal(current.version, 1)
      assert.equal(typeof current.bindings, 'object')
      reads += 1
    }
  })()
  try {
    await Promise.all(Array.from({ length: 64 }, (_, i) => store.set(dir, `child-${i}`, plan(`soul-${i}`))))
  } finally { done = true; await reader }
  assert.ok(reads > 0)
  assert.equal((await keys(fileSpec)).length, 65)
  for (let i = 0; i < 64; i += 1) assert.equal((await store.get(dir, `child-${i}`)).name, `soul-${i}`)
})

test('canonical parent and file symlink aliases coordinate without replacing symlinks', async t => {
  const dir = await fixture(t), actual = join(dir, 'actual'), alias = join(dir, 'alias')
  await mkdir(actual)
  await symlink(actual, alias, 'dir')
  const a = createBindingStore({ fileSpec: join(actual, 'nested', 'bindings.json') })
  const b = createBindingStore({ fileSpec: join(alias, 'nested', 'bindings.json') })
  await Promise.all([a.get(dir, 'prime'), b.get(dir, 'prime')])
  await Promise.all([a.set(dir, 'a', plan('a')), b.set(dir, 'b', plan('b'))])
  const fileAlias = join(dir, 'file-alias.json')
  await symlink(join(actual, 'nested', 'bindings.json'), fileAlias)
  const c = createBindingStore({ fileSpec: fileAlias })
  await Promise.all([a.set(dir, 'c', plan('c')), c.set(dir, 'd', plan('d'))])
  assert.deepEqual(await keys(fileAlias), ['a', 'b', 'c', 'd'])
  const { lstat } = await import('node:fs/promises')
  assert.equal((await lstat(fileAlias)).isSymbolicLink(), true)
})

test('stale writers merge mutations, not snapshots: updates and deletions never resurrect', async t => {
  const dir = await fixture(t), fileSpec = join(dir, 'bindings.json')
  const a = createBindingStore({ fileSpec }), b = createBindingStore({ fileSpec })
  await a.set(dir, 'old', plan('old'))
  await a.set(dir, 'update', plan('v1'))
  await b.get(dir, 'old')
  await a.delete(dir, 'old')
  await a.set(dir, 'update', plan('v2'))
  await b.set(dir, 'new', plan('new'))
  let fresh = createBindingStore({ fileSpec })
  assert.equal(await fresh.get(dir, 'old'), undefined)
  assert.equal((await fresh.get(dir, 'update')).name, 'v2')
  // The deleting store need not have seen a row before deleting it.
  await a.delete(dir, 'new')
  await b.set(dir, 'other', plan('other'))
  fresh = createBindingStore({ fileSpec })
  assert.equal(await fresh.get(dir, 'new'), undefined)
  assert.deepEqual(await keys(fileSpec), ['other', 'update'])
})

test('write failure retains pending records and recovers without losing another store', async t => {
  const dir = await fixture(t), blocked = join(dir, 'blocked'), warnings = []
  await writeFile(blocked, 'not a directory')
  const fileSpec = join(blocked, 'bindings.json')
  const a = createBindingStore({ fileSpec, logger: { warn: message => warnings.push(message) } })
  await a.set(dir, 'a', plan('a'))
  assert.equal((await a.get(dir, 'a')).name, 'a')
  assert.ok(warnings.some(message => message.includes('cannot persist binding store')))
  assert.equal(resolve(blocked), join(dir, 'blocked'))
  await rm(blocked)
  const b = createBindingStore({ fileSpec })
  await b.set(dir, 'b', plan('b'))
  await a.set(dir, 'c', plan('c'))
  assert.deepEqual(await keys(fileSpec), ['a', 'b', 'c'])
})

test('read failure during persistence does not replace an unreadable shared document', async t => {
  const dir = await fixture(t), fileSpec = join(dir, 'bindings.json'), warnings = []
  const a = createBindingStore({ fileSpec, logger: { warn: message => warnings.push(message) } })
  await a.get(dir, 'prime')
  await mkdir(fileSpec)
  await writeFile(join(fileSpec, 'sentinel'), 'preserve')
  await a.set(dir, 'a', plan('a'))
  assert.equal(await readFile(join(fileSpec, 'sentinel'), 'utf8'), 'preserve')
  assert.ok(warnings.some(message => message.includes('cannot persist binding store')))
  assert.deepEqual((await readdir(dir)).filter(name => /\.(tmp|lock)$/.test(name)), [])
  assert.equal(resolve(fileSpec), join(dir, 'bindings.json'))
  await rm(fileSpec, { recursive: true })
  await a.set(dir, 'b', plan('b'))
  assert.deepEqual(await keys(fileSpec), ['a', 'b'])
})

test('newest retention, equal timestamp insertion ties, and stale pruning stay bounded', async t => {
  const dir = await fixture(t), fileSpec = join(dir, 'bindings.json')
  const a = createBindingStore({ fileSpec, maxEntries: 2 })
  const b = createBindingStore({ fileSpec, maxEntries: 2 })
  await b.get(dir, 'prime')
  const now = Date.now
  Date.now = () => 500
  try {
    await a.set(dir, 'z', plan('z'))
    await b.set(dir, 'y', plan('y'))
    await a.set(dir, 'x', plan('x'))
    assert.deepEqual(await keys(fileSpec), ['x', 'y'])
    await b.set(dir, 'w', plan('w'))
    assert.deepEqual(await keys(fileSpec), ['w', 'x'])
  } finally { Date.now = now }
})

test('default newest-500 retention and detached snapshots remain intact', async t => {
  const dir = await fixture(t), fileSpec = join(dir, 'bindings.json')
  const bindings = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [String(i),
    { ...plan(String(i)), savedAt: i }]))
  await writeFile(fileSpec, JSON.stringify({ version: 1, bindings }))
  const store = createBindingStore({ fileSpec })
  const snapshot = plan('new')
  await store.set(dir, 'new', snapshot)
  snapshot.tools.push('write')
  const first = await store.get(dir, 'new')
  first.model.model = 'changed'
  first.tools.push('edit')
  assert.deepEqual((await store.get(dir, 'new')).tools, ['read'])
  assert.equal((await store.get(dir, 'new')).model.model, 'new')
  assert.equal(await store.size(dir), 500)
  assert.equal(await store.get(dir, '0'), undefined)
  assert.equal((await keys(fileSpec)).length, 500)
  await store.flush()
  await store.dispose()
  assert.equal((await store.get(dir, 'new')).name, 'new')
})

test('workspace-relative files isolate identical child ids', async t => {
  const dir = await fixture(t), a = join(dir, 'a'), b = join(dir, 'b')
  const store = createBindingStore()
  await Promise.all([store.set(a, 'same', plan('a')), store.set(b, 'same', plan('b'))])
  assert.equal((await store.get(a, 'same')).name, 'a')
  assert.equal((await store.get(b, 'same')).name, 'b')
  await store.delete(a, 'same')
  assert.equal(await store.get(a, 'same'), undefined)
  assert.equal((await store.get(b, 'same')).name, 'b')
})

test('busy canonical anchor is bounded, never stolen, and does not block unrelated roots', { timeout: 15_000 }, async t => {
  const dir = await fixture(t), fileSpec = join(dir, 'bindings.json'), warnings = []
  await mkdir(`${fileSpec}.lock`)
  const store = createBindingStore({ fileSpec, logger: { warn: message => warnings.push(message) } })
  const blocked = store.set(dir, 'pending', plan('pending'))
  const healthy = createBindingStore({ fileSpec: join(dir, 'healthy.json') })
  const start = performance.now()
  await healthy.set(dir, 'healthy', plan('healthy'))
  assert.ok(performance.now() - start < 2000, 'unrelated canonical file makes progress during contention')
  await blocked
  assert.ok(warnings.some(message => message.includes('timed out acquiring binding lock')))
  assert.deepEqual(await readdir(`${fileSpec}.lock`), [], 'existing lock was not stolen')
  assert.equal((await store.get(dir, 'pending')).name, 'pending', 'failure remains diagnostic-only')
  assert.equal(resolve(`${fileSpec}.lock`), join(dir, 'bindings.json.lock'))
  await rm(`${fileSpec}.lock`, { recursive: true })
  await store.set(dir, 'after', plan('after'))
  assert.deepEqual(await keys(fileSpec), ['after', 'pending'])
})

test('eight primed OS processes perform forty healthy shared-anchor writes', { timeout: 20_000 }, async t => {
  const dir = await fixture(t), fileSpec = join(dir, 'bindings.json')
  const children = Array.from({ length: 8 }, (_, i) => fork(
    fileURLToPath(new URL('./remediation-binding-writer.mjs', import.meta.url)), [], {
      env: { PATH: process.env.PATH, BINDINGS_MODULE: moduleURL, BINDINGS_FILE: fileSpec,
        BINDINGS_ROOT: join(dir, `root-${i}`), WRITER_ID: `writer-${i}` },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    }))
  t.after(() => { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL') })
  const exits = children.map(child => once(child, 'exit'))
  await Promise.all(children.map(child => new Promise((resolveReady, reject) => {
    child.on('message', message => { if (message.primed) resolveReady() })
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`writer exited before barrier: ${code}`)))
  })))
  for (const child of children) child.send('write')
  assert.deepEqual(await Promise.all(exits), children.map(() => [0, null]))
  assert.equal((await keys(fileSpec)).length, 40)
  const fresh = createBindingStore({ fileSpec })
  for (let i = 0; i < 8; i += 1) {
    for (let j = 0; j < 5; j += 1) {
      assert.equal((await fresh.get(dir, `writer-${i}-${j}`)).persona, `persona-writer-${i}`)
    }
  }
})
