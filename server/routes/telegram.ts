import { Hono } from 'hono'
import * as core from '@core/index'
import type { TelegramSendResponse } from '@core/api-types'
import type { Lang } from '@core/types'
import type { AppContext } from '../context'
import { HttpError, readJson } from '../http'
import { generateSummary } from '../summary'
import { telegramConfigRequestSchema, telegramSendRequestSchema } from '../schemas'

const TEST_MESSAGE: Record<Lang, string> = {
  id: '✅ <b>Sales Pulse terhubung.</b> Ringkasan penjualan akan dikirim ke chat ini.',
  en: '✅ <b>Sales Pulse is connected.</b> Sales digests will be sent to this chat.',
}

export function telegramRoutes(ctx: AppContext): Hono {
  const r = new Hono()

  // Sends a test message and saves the config only when Telegram accepts it.
  r.post('/telegram/config', async (c) => {
    const body = await readJson(c, telegramConfigRequestSchema)
    const botToken = body.botToken ?? (await ctx.creds.load()).telegram?.botToken
    if (!botToken) throw new HttpError(400, 'missing_bot_token', 'Enter the bot token from BotFather')

    const { lang } = await ctx.data.getState()
    const result = await ctx.sendTelegram(botToken, body.chatId, TEST_MESSAGE[lang])
    if (result.ok) {
      await ctx.creds.update((cr) => ({ ...cr, telegram: { botToken, chatId: body.chatId } }))
      await ctx.data.markSteps({ telegram: true })
    }
    return c.json(result)
  })

  // The summary is regenerated here from the filters: text sent by the browser is never forwarded as-is.
  r.post('/telegram/send', async (c) => {
    const { filters, lang } = await readJson(c, telegramSendRequestSchema)
    const dataset = await ctx.requireDataset()
    const { telegram } = await ctx.creds.load()
    if (!telegram) throw new HttpError(409, 'telegram_not_configured', 'Set up Telegram in Settings first')

    const summary = await generateSummary(dataset.rows, filters, lang, (task) => ctx.savedAdapter(task))
    const result = await ctx.sendTelegram(telegram.botToken, telegram.chatId, core.telegramMessage(summary.summary, summary.facts, lang))
    return c.json(result satisfies TelegramSendResponse)
  })

  return r
}
