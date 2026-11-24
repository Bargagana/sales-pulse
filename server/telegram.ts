import type { TestResult } from '@core/api-types'
import { botTokenSchema } from './schemas'

export type TelegramSender = (botToken: string, chatId: string, html: string) => Promise<TestResult>

interface BotApiResponse {
  ok?: boolean
  description?: string
}

const MESSAGES = {
  ok: 'Message sent',
  unauthorized: 'Telegram rejected the bot token. Copy it again from BotFather.',
  chat_not_found: 'Chat not found. Check the chat ID and send /start to your bot first.',
  bot_blocked: 'The bot cannot write to this chat. Start the bot (or add it to the group) and try again.',
  bad_request: 'Telegram rejected the message.',
  network: 'Could not reach Telegram. Check your internet connection.',
  timeout: 'Telegram did not answer in time.',
  bad_response: 'Telegram sent an unexpected answer.',
} as const

function fail(code: keyof typeof MESSAGES & NonNullable<TestResult['code']>): TestResult {
  return { ok: false, code, message: MESSAGES[code] }
}

/**
 * Bot API sendMessage with parse_mode HTML (MarkdownV2 needs escaping of half the punctuation).
 * Never put err.message in the result: a fetch error can contain the request URL, and the URL contains the token.
 */
export function telegramSender(fetchFn: typeof fetch, timeoutMs: number): TelegramSender {
  return async (botToken, chatId, html) => {
    if (!botTokenSchema.safeParse(botToken).success) return fail('unauthorized')

    let res: Response
    try {
      res = await fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      const name = (err as { name?: string })?.name
      return fail(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network')
    }

    let body: BotApiResponse
    try {
      body = (await res.json()) as BotApiResponse
    } catch {
      return fail('bad_response')
    }
    if (res.ok && body.ok) return { ok: true, message: MESSAGES.ok }
    return fail(classify(res.status, body.description ?? ''))
  }
}

function classify(status: number, description: string): 'unauthorized' | 'chat_not_found' | 'bot_blocked' | 'bad_request' | 'bad_response' {
  // A malformed token gives 404 on the bot URL, a revoked one 401: both mean "wrong token" to the user.
  if (status === 401 || status === 404) return 'unauthorized'
  if (status === 403) return 'bot_blocked'
  if (status === 400 && /chat not found|peer_id_invalid/i.test(description)) return 'chat_not_found'
  if (status === 400) return 'bad_request'
  return 'bad_response'
}

export const MOCK_BOT_TOKEN = '123:mock'
export const MOCK_CHAT_ID = '42'

/** SALES_PULSE_TELEGRAM_MOCK=1: accepts exactly token "123:mock" + chat "42". */
export const mockTelegramSender: TelegramSender = async (botToken, chatId) =>
  botToken === MOCK_BOT_TOKEN && chatId === MOCK_CHAT_ID ? { ok: true, message: MESSAGES.ok } : fail('unauthorized')
