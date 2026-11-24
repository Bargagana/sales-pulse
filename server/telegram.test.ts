import { describe, expect, it } from 'vitest'
import { mockTelegramSender, telegramSender } from './telegram'
import { fakeFetch, hang, json } from './test-utils'

const TOKEN = '123456789:AAH-secret_token'

describe('telegramSender', () => {
  it('calls sendMessage with parse_mode HTML', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ok: true, result: {} }))
    expect(await telegramSender(fetch, 1000)(TOKEN, '42', '<b>Hi</b>')).toEqual({ ok: true, message: 'Message sent' })

    const [call] = calls
    expect(call!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(call!.method).toBe('POST')
    expect(call!.body).toMatchObject({ chat_id: '42', text: '<b>Hi</b>', parse_mode: 'HTML' })
  })

  const cases: [string, Parameters<typeof fakeFetch>[0], string][] = [
    ['401 revoked token', () => json({ ok: false, error_code: 401, description: 'Unauthorized' }, 401), 'unauthorized'],
    ['404 malformed token', () => json({ ok: false, error_code: 404, description: 'Not Found' }, 404), 'unauthorized'],
    ['400 chat not found', () => json({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 400), 'chat_not_found'],
    ['403 bot blocked', () => json({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403), 'bot_blocked'],
    ['400 other', () => json({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }, 400), 'bad_request'],
    ['non-JSON', () => new Response('oops', { status: 502 }), 'bad_response'],
    ['network', () => Promise.reject(new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`)), 'network'],
    ['timeout', hang, 'timeout'],
  ]
  for (const [name, handler, code] of cases) {
    it(`${name} -> ${code}, without the token in the message`, async () => {
      const { fetch } = fakeFetch(handler)
      const result = await telegramSender(fetch, 30)(TOKEN, '42', 'x')
      expect(result).toMatchObject({ ok: false, code })
      expect(result.message).not.toContain(TOKEN)
    })
  }

  it('rejects a malformed token without calling Telegram (keeps "/" out of the URL path)', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ok: true }))
    expect(await telegramSender(fetch, 1000)('123/../../x', '42', 'x')).toMatchObject({ ok: false, code: 'unauthorized' })
    expect(calls).toHaveLength(0)
  })
})

describe('mockTelegramSender', () => {
  it('accepts only 123:mock + 42', async () => {
    expect(await mockTelegramSender('123:mock', '42', 'x')).toMatchObject({ ok: true })
    expect(await mockTelegramSender('123:mock', '43', 'x')).toMatchObject({ ok: false, code: 'unauthorized' })
    expect(await mockTelegramSender('124:mock', '42', 'x')).toMatchObject({ ok: false, code: 'unauthorized' })
  })
})
