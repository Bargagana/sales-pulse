import { serve } from '@hono/node-server'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'
import { ensureDir, resolveDataDir } from './storage'

const HOST = '127.0.0.1'

function fail(message: string): never {
  console.error(`\n${message}\n`)
  process.exit(1)
}

function portFrom(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`${name} must be a port number between 1 and 65535 (got "${value}").`)
  return port
}

const isStatic = process.argv.includes('--static')
const port = isStatic ? portFrom(process.env.PORT, 5173, 'PORT') : portFrom(process.env.SALES_PULSE_API_PORT, 8787, 'SALES_PULSE_API_PORT')
const staticRoot = fileURLToPath(new URL('../dist/client', import.meta.url))
if (isStatic && !existsSync(staticRoot)) fail('The client is not built yet. Run "npm start" (it builds first) instead of starting the server directly.')

const dataDir = resolveDataDir()
await ensureDir(dataDir)

const llmMock = process.env.SALES_PULSE_LLM_MOCK === '1'
const telegramMock = process.env.SALES_PULSE_TELEGRAM_MOCK === '1'

const app = createApp({ dataDir, llmMock, telegramMock, staticRoot: isStatic ? staticRoot : undefined })

const server = serve({ fetch: app.fetch, hostname: HOST, port }, () => {
  const mocks = [llmMock && 'LLM', telegramMock && 'Telegram'].filter(Boolean).join(' + ')
  console.log('')
  // Print the IPv4 address, not "localhost": a Vite dev server elsewhere on the machine listens on [::1]:5173 by
  // default, and "localhost" may resolve to that one first.
  console.log(isStatic ? `  Sales Pulse is running: http://${HOST}:${port}` : `  Sales Pulse API: http://${HOST}:${port}/api`)
  console.log(`  Local data folder: ${dataDir}`)
  if (mocks) console.log(`  Mock mode: ${mocks} (no real calls are made)`)
  console.log('')
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') fail(`Port ${port} is already in use. Stop the other process or set ${isStatic ? 'PORT' : 'SALES_PULSE_API_PORT'} to another port.`)
  fail(`The server could not start: ${err.message}`)
})

// Open SSE streams keep close() waiting forever, so give it a second and then exit anyway.
const shutdown = () => {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
