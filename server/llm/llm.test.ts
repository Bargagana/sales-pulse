import { describe, expect, it } from 'vitest'
import { fakeFetch, hang, json, openAiReply } from '../test-utils'
import { anthropicAdapter, ANTHROPIC_VERSION } from './anthropic'
import { testConnection } from './index'
import { extractFirstJsonObject } from './json'
import { openAiAdapter } from './openai'
import { askStructured } from './structured'
import type { ChatRequest, LlmConfig } from './types'

const KEY = 'sk-secret-123'
const req: ChatRequest = { system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 }
const openaiConfig: LlmConfig = { format: 'openai', baseUrl: 'https://llm.example.com/v1/', model: 'gpt-x', apiKey: KEY }
const anthropicConfig: LlmConfig = { format: 'anthropic', baseUrl: 'https://api.anthropic.com/', model: 'claude-x', apiKey: KEY }

describe('OpenAI-compatible adapter', () => {
  it('posts chat/completions with a bearer key and the system prompt first', async () => {
    const { fetch, calls } = fakeFetch(() => openAiReply('hello'))
    expect(await openAiAdapter(openaiConfig, fetch, 1000).complete(req)).toBe('hello')

    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call!.url).toBe('https://llm.example.com/v1/chat/completions')
    expect(call!.method).toBe('POST')
    expect(call!.headers['authorization']).toBe(`Bearer ${KEY}`)
    expect(call!.headers['content-type']).toBe('application/json')
    expect(call!.body).toEqual({
      model: 'gpt-x',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      max_tokens: 50,
      temperature: 0,
      stream: false,
    })
  })
})

describe('OpenAI-compatible adapter: reply shapes from routers and reasoning models', () => {
  const sse = (lines: string[]) => new Response(lines.map((l) => `data: ${l}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })

  it('reads a streamed (SSE) reply even though stream:false was sent', async () => {
    const { fetch } = fakeFetch(() =>
      sse([
        JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' } }] }),
        JSON.stringify({ choices: [{ delta: { content: '{"ok":' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'true}' }, finish_reason: 'stop' }] }),
        '[DONE]',
      ]),
    )
    expect(await openAiAdapter(openaiConfig, fetch, 1000).complete(req)).toBe('{"ok":true}')
  })

  it('reads SSE sent without an event-stream content type', async () => {
    const { fetch } = fakeFetch(() => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'pong' } }] })}\n\ndata: [DONE]\n\n`))
    expect(await openAiAdapter(openaiConfig, fetch, 1000).complete(req)).toBe('pong')
  })

  it('joins content given as an array of text parts', async () => {
    const { fetch } = fakeFetch(() => json({ choices: [{ message: { content: [{ type: 'text', text: 'po' }, { type: 'text', text: 'ng' }] } }] }))
    expect(await openAiAdapter(openaiConfig, fetch, 1000).complete(req)).toBe('pong')
  })

  it('explains a reasoning model that ran out of tokens instead of a vague format error', async () => {
    const { fetch } = fakeFetch(() =>
      json({ choices: [{ message: { content: null, reasoning_content: 'thinking...' }, finish_reason: 'length' }] }),
    )
    const result = await testConnection(openAiAdapter(openaiConfig, fetch, 1000))
    expect(result).toMatchObject({ ok: false, code: 'bad_response' })
    expect(result.detail).toContain('finish_reason: length')
  })

  it('names the fields it got when the reply is not chat-completions JSON, without copying values', async () => {
    const { fetch } = fakeFetch(() => json({ output: [{ text: KEY }], id: 'x' }))
    const result = await testConnection(openAiAdapter(openaiConfig, fetch, 1000))
    expect(result.detail).toContain('output, id')
    expect(result.detail).not.toContain(KEY)
  })

  it('says when the base URL serves an HTML page', async () => {
    const { fetch } = fakeFetch(() => new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } }))
    const result = await testConnection(openAiAdapter(openaiConfig, fetch, 1000))
    expect(result).toMatchObject({ ok: false, code: 'bad_response' })
    expect(result.detail).toContain('HTML page')
  })

  it('retries a 400 once with reasoning-model parameters (max_completion_tokens, no temperature) and keeps them', async () => {
    const { fetch, calls } = fakeFetch((call) =>
      (call.body as Record<string, unknown>).max_tokens !== undefined ? json({ error: { message: 'Unsupported parameter: max_tokens' } }, 400) : openAiReply('pong'),
    )
    const adapter = openAiAdapter(openaiConfig, fetch, 1000)
    expect(await adapter.complete(req)).toBe('pong')
    expect(calls[1]!.body).toEqual({
      model: 'gpt-x',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      max_completion_tokens: 50,
      stream: false,
    })
    await adapter.complete(req)
    expect(calls).toHaveLength(3)
  })

  it('a 400 that also fails with reasoning parameters stays bad_request', async () => {
    const { fetch, calls } = fakeFetch(() => json({}, 400))
    expect(await testConnection(openAiAdapter(openaiConfig, fetch, 1000))).toMatchObject({ ok: false, code: 'bad_request' })
    expect(calls).toHaveLength(2)
  })
})

describe('Anthropic adapter', () => {
  it('posts v1/messages with x-api-key and anthropic-version, system as a top-level field', async () => {
    const { fetch, calls } = fakeFetch(() => json({ content: [{ type: 'text', text: 'hel' }, { type: 'text', text: 'lo' }] }))
    expect(await anthropicAdapter(anthropicConfig, fetch, 1000).complete(req)).toBe('hello')

    const [call] = calls
    expect(call!.url).toBe('https://api.anthropic.com/v1/messages')
    expect(call!.headers['x-api-key']).toBe(KEY)
    expect(call!.headers['anthropic-version']).toBe(ANTHROPIC_VERSION)
    expect(call!.headers['authorization']).toBeUndefined()
    expect(call!.body).toEqual({ model: 'claude-x', system: 'sys', messages: [{ role: 'user', content: 'hi' }], max_tokens: 50, temperature: 0, stream: false })
  })

  it('accepts a base URL that already ends in /v1', async () => {
    const { fetch, calls } = fakeFetch(() => json({ content: [{ type: 'text', text: 'x' }] }))
    await anthropicAdapter({ ...anthropicConfig, baseUrl: 'https://api.anthropic.com/v1' }, fetch, 1000).complete(req)
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages')
  })
})

describe('testConnection error mapping', () => {
  const cases: [string, Parameters<typeof fakeFetch>[0], string][] = [
    ['401', () => json({ error: { message: `Incorrect API key provided: ${KEY}` } }, 401), 'unauthorized'],
    ['403', () => json({}, 403), 'unauthorized'],
    ['404', () => json({}, 404), 'not_found'],
    ['400', () => json({}, 400), 'bad_request'],
    ['500', () => json({}, 500), 'provider_error'],
    ['error object with HTTP 200', () => json({ error: { message: KEY } }), 'provider_error'],
    ['non-JSON body', () => new Response('<html>gateway</html>', { status: 200 }), 'bad_response'],
    ['JSON without text', () => json({ choices: [] }), 'bad_response'],
    ['network failure', () => Promise.reject(new TypeError('fetch failed')), 'network'],
    ['timeout', hang, 'timeout'],
  ]
  for (const [name, handler, code] of cases) {
    it(`${name} -> ${code}`, async () => {
      const { fetch } = fakeFetch(handler)
      const result = await testConnection(openAiAdapter(openaiConfig, fetch, 30))
      expect(result).toMatchObject({ ok: false, code })
      expect(result.message).not.toContain(KEY)
    })
  }

  it('succeeds on any text reply', async () => {
    const { fetch } = fakeFetch(() => openAiReply('pong'))
    expect(await testConnection(openAiAdapter(openaiConfig, fetch, 1000))).toMatchObject({ ok: true })
  })
})

describe('extractFirstJsonObject', () => {
  it('finds JSON inside prose and code fences, ignoring braces in strings', () => {
    expect(extractFirstJsonObject('Sure!\n```json\n{"a":"x}y","b":{"c":1}}\n```\nanything {else}')).toEqual({ a: 'x}y', b: { c: 1 } })
  })
  it('throws when there is no object', () => {
    expect(() => extractFirstJsonObject('no json here')).toThrow()
    expect(() => extractFirstJsonObject('{"open": ')).toThrow()
  })
})

describe('askStructured', () => {
  const check = (j: unknown) =>
    typeof (j as { n?: unknown }).n === 'number' ? { ok: true as const, value: (j as { n: number }).n } : { ok: false as const, error: 'n must be a number' }

  it('retries once, feeding back the validation error', async () => {
    const { fetch, calls } = fakeFetch(() => openAiReply(calls.length === 1 ? '{"n":"one"}' : '{"n":1}'))
    const result = await askStructured(openAiAdapter(openaiConfig, fetch, 1000), req, check)
    expect(result).toEqual({ ok: true, value: 1, attempts: 2 })
    const retryMessages = (calls[1]!.body as { messages: { role: string; content: string }[] }).messages
    expect(retryMessages.at(-2)).toEqual({ role: 'assistant', content: '{"n":"one"}' })
    expect(retryMessages.at(-1)!.content).toContain('n must be a number')
  })

  it('gives up after the second invalid answer', async () => {
    const { fetch, calls } = fakeFetch(() => openAiReply('not json'))
    const result = await askStructured(openAiAdapter(openaiConfig, fetch, 1000), req, check)
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(2)
  })
})
