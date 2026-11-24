import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import type { AppContext } from '../context'
import { HttpError, readJson } from '../http'
import { completeStepRequestSchema, languageRequestSchema } from '../schemas'

/** Steps the client completes on its own; the others are marked by the endpoint that does the work. */
const CLIENT_STEPS = new Set(['language', 'quality'])

const newPushToken = () => `sp_${randomBytes(32).toString('base64url')}`

export function settingsRoutes(ctx: AppContext): Hono {
  const r = new Hono()

  r.get('/health', (c) => c.json({ ok: true }))

  r.get('/state', async (c) => c.json(await ctx.appState()))

  r.put('/settings/language', async (c) => {
    const { lang } = await readJson(c, languageRequestSchema)
    await ctx.data.updateState((s) => ({ ...s, lang, completed: { ...s.completed, language: true } }))
    return c.json(await ctx.appState())
  })

  r.post('/onboarding/complete', async (c) => {
    const { step } = await readJson(c, completeStepRequestSchema)
    if (!CLIENT_STEPS.has(step)) throw new HttpError(400, 'invalid_step', `Step "${step}" is completed by its own endpoint`)
    if (step === 'quality') await ctx.requireDataset()
    await ctx.data.markSteps({ [step]: true })
    return c.json(await ctx.appState())
  })

  r.get('/push-token', async (c) => {
    let { pushToken } = await ctx.creds.load()
    if (!pushToken) {
      pushToken = newPushToken()
      const token = pushToken
      await ctx.creds.update((cr) => ({ ...cr, pushToken: token }))
    }
    c.header('Cache-Control', 'no-store')
    return c.json({ token: pushToken })
  })

  r.post('/push-token/rotate', async (c) => {
    const token = newPushToken()
    await ctx.creds.update((cr) => ({ ...cr, pushToken: token }))
    c.header('Cache-Control', 'no-store')
    return c.json({ token })
  })

  // Deletes credentials.enc and the key file. The push token lives there too, so it is invalidated as well.
  r.post('/credentials/forget', async (c) => {
    await ctx.creds.forget()
    await ctx.data.markSteps({ llm: false, telegram: false })
    return c.json(await ctx.appState())
  })

  return r
}
