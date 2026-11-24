// Onboarding state, credentials and settings endpoints. These do not need a dataset, so they run without core's data pipeline.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeFetch, json, makeTempDir, openAiReply, testApp } from './test-utils'

const API_KEY = 'sk-test-SECRET-4f9a2c'
const BOT_TOKEN = '987654321:SECRET-bot-token_xyz'

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => ({ dir, cleanup } = await makeTempDir()))
afterEach(() => cleanup())

const llmBody = { format: 'openai', baseUrl: 'https://llm.example.com/v1/', apiKey: API_KEY, model: 'gpt-test' }

function providers() {
  return fakeFetch((call) => (call.url.startsWith('https://api.telegram.org/') ? json({ ok: true, result: {} }) : openAiReply('{"ok":true}')))
}

describe('onboarding state', () => {
  it('starts empty with Indonesian as the default language', async () => {
    const { call } = testApp(dir)
    const { body } = await call('GET', '/api/state')
    expect(body).toEqual({
      onboarded: false,
      completed: { language: false, llm: false, data: false, mapping: false, quality: false, telegram: false },
      lang: 'id',
      llm: null,
      telegram: null,
      dataset: null,
    })
    expect((await call('GET', '/api/health')).body).toEqual({ ok: true })
  })

  it('marks language, persists it across restarts, and validates the body', async () => {
    const { call } = testApp(dir)
    const res = await call('PUT', '/api/settings/language', { json: { lang: 'en' } })
    expect(res.body).toMatchObject({ lang: 'en', completed: { language: true } })
    expect((await testApp(dir).call('GET', '/api/state')).body.lang).toBe('en')

    const bad = await call('PUT', '/api/settings/language', { json: { lang: 'fr' } })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('invalid_body')
    expect((await call('PUT', '/api/settings/language', { body: '{nope', headers: { 'content-type': 'application/json' } })).status).toBe(400)
  })

  it('only lets the client complete language and quality, and quality needs a dataset', async () => {
    const { call } = testApp(dir)
    expect((await call('POST', '/api/onboarding/complete', { json: { step: 'llm' } })).status).toBe(400)
    expect((await call('POST', '/api/onboarding/complete', { json: { step: 'quality' } })).status).toBe(404)
    const ok = await call('POST', '/api/onboarding/complete', { json: { step: 'language' } })
    expect(ok.body.completed.language).toBe(true)
  })

  it('returns ApiError JSON for unknown API routes', async () => {
    const { call } = testApp(dir)
    const res = await call('GET', '/api/nope')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('not_found')
  })
})

describe('LLM config', () => {
  it('tests the connection, saves on success, and exposes only hasKey', async () => {
    const { fetch, calls } = providers()
    const { call } = testApp(dir, { fetch })
    const res = await call('POST', '/api/llm/config', { json: llmBody })
    expect(res.body).toMatchObject({ ok: true })
    expect(calls[0]!.url).toBe('https://llm.example.com/v1/chat/completions')

    const state = (await call('GET', '/api/state')).body
    expect(state.llm).toEqual({ format: 'openai', baseUrl: 'https://llm.example.com/v1', model: 'gpt-test', hasKey: true })
    expect(state.completed.llm).toBe(true)
  })

  it('does not save a config whose test fails', async () => {
    const { fetch } = fakeFetch(() => json({ error: { message: `bad key ${API_KEY}` } }, 401))
    const { call } = testApp(dir, { fetch })
    const res = await call('POST', '/api/llm/config', { json: llmBody })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: false, code: 'unauthorized' })
    expect(res.text).not.toContain(API_KEY)
    expect((await call('GET', '/api/state')).body.llm).toBeNull()
  })

  it('reuses the saved key only for the same host', async () => {
    const { fetch, calls } = providers()
    const { call } = testApp(dir, { fetch })
    await call('POST', '/api/llm/config', { json: llmBody })

    const sameHost = await call('POST', '/api/llm/config', { json: { ...llmBody, apiKey: undefined, model: 'gpt-other' } })
    expect(sameHost.body.ok).toBe(true)
    expect(calls[1]!.headers['authorization']).toBe(`Bearer ${API_KEY}`)

    const otherHost = await call('POST', '/api/llm/config', { json: { ...llmBody, apiKey: undefined, baseUrl: 'https://other.example.com' } })
    expect(otherHost.status).toBe(400)
    expect(otherHost.body.error.code).toBe('missing_api_key')
    expect(calls).toHaveLength(2)
  })

  it('rejects a non-http base URL', async () => {
    const { call } = testApp(dir)
    expect((await call('POST', '/api/llm/config', { json: { ...llmBody, baseUrl: 'file:///etc/passwd' } })).status).toBe(400)
  })
})

describe('Telegram config', () => {
  it('sends a test message in the UI language, saves on success, and exposes only hasToken', async () => {
    const { fetch, calls } = providers()
    const { call } = testApp(dir, { fetch })
    await call('PUT', '/api/settings/language', { json: { lang: 'en' } })
    const res = await call('POST', '/api/telegram/config', { json: { botToken: BOT_TOKEN, chatId: '-100123' } })
    expect(res.body).toMatchObject({ ok: true })
    expect((calls[0]!.body as { text: string }).text).toContain('connected')

    const state = (await call('GET', '/api/state')).body
    expect(state.telegram).toEqual({ chatId: '-100123', hasToken: true })
    expect(state.completed.telegram).toBe(true)
  })

  it('reports chat_not_found and keeps nothing', async () => {
    const { fetch } = fakeFetch(() => json({ ok: false, description: 'Bad Request: chat not found' }, 400))
    const { call } = testApp(dir, { fetch })
    const res = await call('POST', '/api/telegram/config', { json: { botToken: BOT_TOKEN, chatId: '42' } })
    expect(res.body).toMatchObject({ ok: false, code: 'chat_not_found' })
    expect((await call('GET', '/api/state')).body.telegram).toBeNull()
  })

  it('requires a token the first time', async () => {
    const { call } = testApp(dir)
    const res = await call('POST', '/api/telegram/config', { json: { chatId: '42' } })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('missing_bot_token')
  })
})

describe('mock mode', () => {
  it('fake LLM accepts any key; fake Telegram accepts only 123:mock + 42', async () => {
    const { fetch, calls } = fakeFetch(() => json({}, 500))
    const { call } = testApp(dir, { fetch, llmMock: true, telegramMock: true })
    expect((await call('POST', '/api/llm/config', { json: llmBody })).body.ok).toBe(true)
    expect((await call('POST', '/api/telegram/config', { json: { botToken: '123:mock', chatId: '42' } })).body.ok).toBe(true)
    expect((await call('POST', '/api/telegram/config', { json: { botToken: '123:mock', chatId: '43' } })).body).toMatchObject({
      ok: false,
      code: 'unauthorized',
    })
    expect(calls).toHaveLength(0)
  })
})

describe('push token and forgetting credentials', () => {
  it('creates the token once, rotates it, and never puts it in /api/state', async () => {
    const { call } = testApp(dir)
    const first = (await call('GET', '/api/push-token')).body.token as string
    expect(first).toMatch(/^sp_[A-Za-z0-9_-]{40,}$/)
    expect((await call('GET', '/api/push-token')).body.token).toBe(first)

    const rotated = (await call('POST', '/api/push-token/rotate')).body.token as string
    expect(rotated).not.toBe(first)
    expect((await call('POST', '/api/ingest', { body: 'a\n1', headers: { authorization: `Bearer ${first}` } })).status).toBe(401)
    expect((await call('GET', '/api/state')).text).not.toContain(rotated)
  })

  it('forget wipes LLM + Telegram, resets their steps, keeps the language', async () => {
    const { fetch } = providers()
    const { call } = testApp(dir, { fetch })
    await call('PUT', '/api/settings/language', { json: { lang: 'en' } })
    await call('POST', '/api/llm/config', { json: llmBody })
    await call('POST', '/api/telegram/config', { json: { botToken: BOT_TOKEN, chatId: '42' } })

    const state = (await call('POST', '/api/credentials/forget')).body
    expect(state).toMatchObject({ llm: null, telegram: null, lang: 'en', completed: { language: true, llm: false, telegram: false } })
    // A restart must not bring them back either.
    expect((await testApp(dir).call('GET', '/api/state')).body).toMatchObject({ llm: null, telegram: null })
  })

  it('stores secrets only encrypted', async () => {
    const { fetch } = providers()
    const { call, bodies, logs } = testApp(dir, { fetch })
    await call('POST', '/api/llm/config', { json: llmBody })
    await call('POST', '/api/telegram/config', { json: { botToken: BOT_TOKEN, chatId: '42' } })
    await call('GET', '/api/state')

    const enc = await readFile(join(dir, 'credentials.enc'))
    const stateFile = await readFile(join(dir, 'state.json'), 'utf8')
    for (const secret of [API_KEY, BOT_TOKEN]) {
      expect(enc.includes(Buffer.from(secret))).toBe(false)
      expect(stateFile).not.toContain(secret)
      for (const body of bodies) expect(body).not.toContain(secret)
      for (const line of logs) expect(line).not.toContain(secret)
    }
  })
})
