import type { MiddlewareHandler } from 'hono'
import { createHash, timingSafeEqual } from 'node:crypto'
import { errorBody } from './http'

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** "localhost:5173" -> "localhost"; "[::1]:5173" -> "[::1]". */
function hostnameOf(host: string): string {
  const lower = host.toLowerCase()
  if (lower.startsWith('[')) return lower.slice(0, lower.indexOf(']') + 1)
  return lower.split(':')[0] ?? ''
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostnameOf(host))
}

/**
 * The server only listens on 127.0.0.1, but a web page can still reach it from the user's browser:
 * - DNS rebinding: evil.example resolves to 127.0.0.1, so the browser sends Host: evil.example. Reject non-loopback hosts.
 * - CSRF: a page on another origin POSTs to localhost. Browsers attach Origin; it must equal our own host.
 * Requests without Origin (curl, scripts) pass; the push API is guarded by its bearer token instead.
 */
export function localOnly(opts: { originExemptPaths: string[] }): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host
    if (!isLoopbackHost(host)) {
      return c.json(errorBody('forbidden_host', 'This server only accepts requests addressed to localhost'), 403)
    }
    const origin = c.req.header('origin')
    if (origin !== undefined && !SAFE_METHODS.has(c.req.method) && !opts.originExemptPaths.includes(c.req.path)) {
      if (!isSameLocalOrigin(origin, host)) {
        return c.json(errorBody('forbidden_origin', 'Cross-origin requests are not allowed'), 403)
      }
    }
    await next()
  }
}

function isSameLocalOrigin(origin: string, host: string): boolean {
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === host.toLowerCase() && isLoopbackHost(url.host)
  } catch {
    // Includes the literal "null" origin sent by sandboxed iframes and file:// pages.
    return false
  }
}

/** Hashing first gives equal-length buffers, which timingSafeEqual requires, without leaking the token length. */
export function tokensEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function bearerToken(authorization: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '')
  return match?.[1] ?? null
}
