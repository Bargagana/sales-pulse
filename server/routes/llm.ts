import { Hono } from 'hono'
import type { AppContext } from '../context'
import { HttpError, readJson } from '../http'
import { testConnection } from '../llm/index'
import { trimTrailingSlash } from '../llm/http'
import type { LlmConfig } from '../llm/types'
import { llmConfigRequestSchema } from '../schemas'

export function llmRoutes(ctx: AppContext): Hono {
  const r = new Hono()

  // Tests the connection with a tiny prompt and saves the config only when it works.
  r.post('/llm/config', async (c) => {
    const body = await readJson(c, llmConfigRequestSchema)
    const baseUrl = trimTrailingSlash(body.baseUrl)
    const saved = (await ctx.creds.load()).llm

    // Omitting apiKey keeps the saved one, but only for the same host: never send a saved key to a new endpoint.
    const canReuseKey = saved !== undefined && new URL(saved.baseUrl).origin === new URL(baseUrl).origin
    const apiKey = body.apiKey ?? (canReuseKey ? saved.apiKey : undefined)
    if (!apiKey) throw new HttpError(400, 'missing_api_key', 'Enter the API key for this endpoint')

    const config: LlmConfig = { format: body.format, baseUrl, model: body.model, apiKey }
    const result = await testConnection(ctx.adapterFor(config, { kind: 'test' }))
    if (result.ok) {
      await ctx.creds.update((cr) => ({ ...cr, llm: config }))
      await ctx.data.markSteps({ llm: true })
    }
    return c.json(result)
  })

  return r
}
