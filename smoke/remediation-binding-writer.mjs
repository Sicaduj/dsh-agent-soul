// Disposable IPC worker for the cross-process binding-store regression.
const { createBindingStore } = await import(process.env.BINDINGS_MODULE)
const store = createBindingStore({ fileSpec: process.env.BINDINGS_FILE,
  logger: { warn(message) { throw new Error(message) } } })
await store.get(process.env.BINDINGS_ROOT, 'prime')
process.once('message', async () => {
  try {
    for (let i = 0; i < 5; i += 1) {
      await store.set(process.env.BINDINGS_ROOT, `${process.env.WRITER_ID}-${i}`, {
        name: process.env.WRITER_ID, persona: `persona-${process.env.WRITER_ID}`,
        tools: ['read'], model: { provider: 'test', model: process.env.WRITER_ID }, context: 'fresh',
      })
    }
    await store.dispose()
    process.disconnect()
  } catch (error) {
    console.error(error)
    process.exitCode = 1
    process.disconnect()
  }
})
process.on('disconnect', () => {})
process.send({ primed: true })
