import { Hono } from 'hono'
import type { AppContext } from '../context'
import { readJson } from '../http'
import { generateSummary } from '../summary'
import { summaryRequestSchema } from '../schemas'

export function summaryRoutes(ctx: AppContext): Hono {
  const r = new Hono()

  r.post('/summary', async (c) => {
    const { filters, lang } = await readJson(c, summaryRequestSchema)
    const dataset = await ctx.requireDataset()
    return c.json(await generateSummary(dataset.rows, filters, lang, (task) => ctx.savedAdapter(task)))
  })

  return r
}
