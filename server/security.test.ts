import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { serve, type ServerType } from '@hono/node-server'
import { mkdir, writeFile } from 'node:fs/promises'
import { Agent, request } from 'node:http'
import { join } from 'node:path'
import { bearerToken, isLoopbackHost, tokensEqual } from './security'
import { makeTempDir, readSampleCsv, testApp } from './test-utils'

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => ({ dir, cleanup } = await makeTempDir()))
afterEach(() => cleanup())

describe('host check (DNS rebinding)', () => {
  it.each(['localhost', 'localhost:5173', '127.0.0.1:8801', '[::1]:5173'])('accepts %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true)
  })
  it.each(['evil.example', 'evil.example:5173', 'localhost.evil.example', '127.0.0.1.nip.io', '10.0.0.5'])('rejects %s', (host) => {
    expect(isLoopbackHost(host)).toBe(false)
  })

  it('returns 403 for a non-localhost Host header', async () => {
    const { call } = testApp(dir)
    const res = await call('GET', 'http://evil.example:5173/api/state', { headers: { host: 'evil.example:5173' } })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('forbidden_host')
  })
})

describe('origin check (CSRF)', () => {
  it('rejects a state-changing request from another origin', async () => {
    const { call } = testApp(dir)
    const res = await call('PUT', 'http://localhost:5173/api/settings/language', {
      json: { lang: 'en' },
      headers: { host: 'localhost:5173', origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('forbidden_origin')
  })

  it('rejects a localhost origin on a different port and the "null" origin', async () => {
    const { call } = testApp(dir)
    for (const origin of ['http://localhost:3000', 'null']) {
      const res = await call('PUT', 'http://localhost:5173/api/settings/language', {
        json: { lang: 'en' },
        headers: { host: 'localhost:5173', origin },
      })
      expect(res.status).toBe(403)
    }
  })

  it('allows the same origin, and requests without Origin (curl)', async () => {
    const { call } = testApp(dir)
    const same = await call('PUT', 'http://localhost:5173/api/settings/language', {
      json: { lang: 'en' },
      headers: { host: 'localhost:5173', origin: 'http://localhost:5173' },
    })
    expect(same.status).toBe(200)
    expect((await call('PUT', '/api/settings/language', { json: { lang: 'id' } })).status).toBe(200)
  })

  it('does not apply to GET', async () => {
    const { call } = testApp(dir)
    const res = await call('GET', '/api/state', { headers: { origin: 'https://evil.example' } })
    expect(res.status).toBe(200)
  })

  it('exempts /api/ingest from the origin rule, which still needs its bearer token', async () => {
    const { call } = testApp(dir)
    const res = await call('POST', '/api/ingest', { body: 'a,b\n1,2', headers: { origin: 'https://evil.example' } })
    expect(res.status).toBe(401)
  })
})

describe('tokens', () => {
  it('compares in constant time regardless of length', () => {
    expect(tokensEqual('sp_abc', 'sp_abc')).toBe(true)
    expect(tokensEqual('sp_abc', 'sp_abd')).toBe(false)
    expect(tokensEqual('sp_abc', 'sp_abcdef')).toBe(false)
  })
  it('parses bearer headers', () => {
    expect(bearerToken('Bearer sp_x')).toBe('sp_x')
    expect(bearerToken('bearer   sp_x ')).toBe('sp_x')
    expect(bearerToken('Basic abc')).toBeNull()
    expect(bearerToken(undefined)).toBeNull()
  })
})

describe('response headers', () => {
  it('forbid framing and keep the served page talking to this origin only', async () => {
    const staticRoot = join(dir, 'static')
    await mkdir(staticRoot)
    await writeFile(join(staticRoot, 'index.html'), '<!doctype html><title>t</title>')
    const { app } = testApp(dir, { staticRoot })
    for (const path of ['/', '/some/client/route', '/api/health']) {
      const res = await app.request(path)
      expect(res.status, path).toBe(200)
      const csp = res.headers.get('content-security-policy') ?? ''
      expect(csp, path).toContain("frame-ancestors 'none'")
      expect(csp, path).toContain("connect-src 'self'")
      expect(csp, path).toContain("script-src 'self'")
      expect(res.headers.get('x-frame-options'), path).toBe('DENY')
      expect(res.headers.get('referrer-policy'), path).toBe('no-referrer')
    }
  })
})

describe('keep-alive after a refused push', () => {
  let server: ServerType | undefined
  afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())))

  /** One request on a keep-alive agent; resolves with the status and the Connection header. */
  function post(agent: Agent, port: number, path: string, headers: Record<string, string>, body: string) {
    return new Promise<{ status: number; connection: string | undefined }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method: 'POST', agent, headers: { 'content-length': Buffer.byteLength(body), ...headers } }, (res) => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode ?? 0, connection: res.headers.connection }))
      })
      req.on('error', reject)
      req.end(body)
    })
  }

  it('closes the connection on a 401 sent before the body was read, so the retry gets a fresh one', async () => {
    const { app, call } = testApp(dir)
    const token = (await call('GET', '/api/push-token')).body.token as string
    const port = await new Promise<number>((resolve) => {
      server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => resolve(info.port))
    })
    const agent = new Agent({ keepAlive: true, maxSockets: 1 })
    // Large enough that the body is still unread when the 401 goes out.
    const csv = await readSampleCsv()
    try {
      const refused = await post(agent, port, '/api/ingest', { authorization: 'Bearer wrong', 'content-type': 'text/csv' }, csv)
      expect(refused).toEqual({ status: 401, connection: 'close' })
      const retry = await post(agent, port, '/api/ingest', { authorization: `Bearer ${token}`, 'content-type': 'text/csv' }, csv)
      expect(retry.status).toBe(200)
      expect(retry.connection).not.toBe('close')
    } finally {
      agent.destroy()
    }
  })
})
