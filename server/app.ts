import type { HttpBindings } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { AppContext, type AppDeps } from './context'
import { errorBody, HttpError } from './http'
import { datasetRoutes } from './routes/data'
import { ingestRoutes } from './routes/ingest'
import { llmRoutes } from './routes/llm'
import { settingsRoutes } from './routes/settings'
import { summaryRoutes } from './routes/summary'
import { telegramRoutes } from './routes/telegram'
import { localOnly } from './security'

export type { AppDeps } from './context'

const MB = 1024 * 1024
const CSV_PATHS = new Set(['/api/data/upload', '/api/ingest'])

/**
 * The page may not be framed (clickjacking on "Send to Telegram" or "Forget credentials") and may only talk to this
 * server, so a script injected through the data could not send the dataset or push token anywhere else.
 * Inline styles stay allowed: ApexCharts and Highcharts style their SVG with style attributes and <style> tags.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
}

export function createApp(deps: AppDeps): Hono {
  const ctx = new AppContext(deps)
  const app = new Hono()

  app.use('*', async (c, next) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.header(name, value)
    await next()
    // A request refused before its body was read (wrong push token, too large, forbidden) leaves that body on the
    // socket. Closing the connection stops a keep-alive client from sending its retry into the leftover bytes.
    const incoming = (c.env as Partial<HttpBindings> | undefined)?.incoming
    if (c.res.status >= 400 && incoming && !incoming.readableEnded && !['GET', 'HEAD'].includes(c.req.method)) {
      c.res.headers.set('Connection', 'close')
    }
  })

  // No browser calls /api/ingest, so it has no Origin to check; its bearer token is the guard.
  app.use('*', localOnly({ originExemptPaths: ['/api/ingest'] }))

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('X-Content-Type-Options', 'nosniff')
    const maxSize = CSV_PATHS.has(c.req.path) ? 20 * MB : 2 * MB
    return bodyLimit({
      maxSize,
      onError: (c) => c.json(errorBody('payload_too_large', `Request body is larger than ${maxSize / MB} MB`), 413),
    })(c, next)
  })

  for (const routes of [settingsRoutes, llmRoutes, datasetRoutes, summaryRoutes, telegramRoutes, ingestRoutes]) {
    app.route('/api', routes(ctx))
  }
  app.get('/api/events', (c) => ctx.events.stream(c))
  app.all('/api/*', (c) => c.json(errorBody('not_found', `No API route for ${c.req.method} ${c.req.path}`), 404))

  if (deps.staticRoot) {
    app.use('*', serveStatic({ root: deps.staticRoot }))
    // SPA fallback: any other GET gets index.html and the client decides what to render.
    app.get('*', serveStatic({ root: deps.staticRoot, path: 'index.html' }))
  }

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json(errorBody(err.code, err.message, err.details), err.status)
    // Only the error's name and message: request bodies (which may hold API keys) are never logged.
    ctx.log(`Unhandled error on ${c.req.method} ${c.req.path}: ${err.name}: ${err.message}`)
    return c.json(errorBody('internal', 'Unexpected server error'), 500)
  })

  return app
}
