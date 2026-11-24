// Helpers for server tests: a temp data dir, an app with injected fakes, and a recording fake fetch. Never hits the network.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp, type AppDeps } from './app'

export interface RecordedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

export type FakeHandler = (call: RecordedCall, signal: AbortSignal | undefined) => Response | Promise<Response>

export function fakeFetch(handler: FakeHandler) {
  const calls: RecordedCall[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const raw = typeof init?.body === 'string' ? init.body : undefined
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: raw === undefined ? undefined : JSON.parse(raw),
    }
    calls.push(call)
    return handler(call, init?.signal ?? undefined)
  }) as typeof fetch
  return { fetch: fetchFn, calls }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Rejects like a real fetch when the AbortSignal fires (used to exercise timeouts). */
export const hang: FakeHandler = (_call, signal) =>
  new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason)))

export const openAiReply = (content: string) => json({ choices: [{ message: { role: 'assistant', content } }] })

export async function makeTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'sales-pulse-test-'))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

export function testApp(dataDir: string, overrides: Partial<AppDeps> = {}) {
  let seq = 0
  const logs: string[] = []
  const app = createApp({
    dataDir,
    now: () => new Date('2026-11-23T10:00:00.000Z'),
    newId: (prefix) => `${prefix}_${++seq}`,
    log: (msg) => logs.push(msg),
    timeoutMs: 200,
    ...overrides,
  })
  // Every response body seen by a test, so secret-leak checks can scan all of them at once.
  const bodies: string[] = []

  async function call(method: string, path: string, init: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...init.headers }
    let body = init.body
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(init.json)
    }
    const res = await app.request(path, { method, headers, body })
    const text = await res.text()
    bodies.push(text)
    return { status: res.status, text, body: text ? JSON.parse(text) : undefined, headers: res.headers }
  }

  return { app, call, bodies, logs }
}

export const SAMPLE_CSV_PATH = fileURLToPath(new URL('../data/data.csv', import.meta.url))
export const readSampleCsv = () => readFile(SAMPLE_CSV_PATH, 'utf8')
