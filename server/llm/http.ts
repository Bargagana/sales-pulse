import { LlmError } from './types'

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string })?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

/**
 * A provider reply: plain JSON, or Server-Sent Events. Some OpenAI-compatible routers stream even when the request
 * says `stream: false`, so the adapters accept both.
 */
export type ProviderBody = { kind: 'json'; json: unknown } | { kind: 'sse'; events: unknown[] }

/** Parses `data: {...}` lines; `[DONE]` and non-JSON lines are skipped. */
export function parseSse(text: string): unknown[] {
  const events: unknown[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^data:\s?(.*)$/.exec(line)
    if (!m || m[1] === undefined) continue
    const data = m[1].trim()
    if (data === '' || data === '[DONE]') continue
    try {
      events.push(JSON.parse(data))
    } catch {
      /* keep-alive or partial line */
    }
  }
  return events
}

/**
 * Names of fields we saw, for diagnostics. Only identifier-shaped names: values from the provider never reach
 * our messages, because a provider error can echo part of the API key.
 */
export function describeKeys(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Array.isArray(value) ? 'an array' : typeof value
  const keys = Object.keys(value).filter((k) => /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(k)).slice(0, 10)
  return keys.length ? keys.join(', ') : 'no fields'
}

/** A provider-supplied enum such as finish_reason, kept only if it looks like one. */
export function safeToken(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z_]{1,30}$/.test(value) ? value : undefined
}

/** POST JSON to an LLM provider and map every failure onto a TestResult code. */
export async function postJson(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<ProviderBody> {
  let res: Response
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      // A redirect to another origin must not carry the API key with it.
      redirect: 'error',
    })
  } catch (err) {
    if (isTimeout(err)) throw new LlmError('timeout', `The LLM did not answer within ${Math.round(timeoutMs / 1000)} s`)
    throw new LlmError('network', 'Could not reach the LLM endpoint. Check the base URL and your connection.')
  }

  if (res.status === 401 || res.status === 403) throw new LlmError('unauthorized', `The LLM rejected the API key (HTTP ${res.status})`)
  if (res.status === 404) throw new LlmError('not_found', 'Endpoint or model not found (HTTP 404). Check the base URL and model name.')
  if (res.status >= 400 && res.status < 500) throw new LlmError('bad_request', `The LLM rejected the request (HTTP ${res.status})`)
  if (!res.ok) {
    throw new LlmError('provider_error', `The provider or its upstream model failed (HTTP ${res.status}). Try again, or try another model.`)
  }

  let text: string
  try {
    text = await res.text()
  } catch (err) {
    if (isTimeout(err)) throw new LlmError('timeout', `The LLM did not answer within ${Math.round(timeoutMs / 1000)} s`)
    throw new LlmError('network', 'The connection to the LLM endpoint broke while reading the reply')
  }

  const contentType = res.headers.get('content-type') ?? ''
  const trimmed = text.trimStart()
  if (contentType.includes('text/event-stream') || trimmed.startsWith('data:') || trimmed.startsWith('event:')) {
    const events = parseSse(text)
    if (events.length === 0) throw new LlmError('bad_response', 'The endpoint sent a stream with no readable events')
    return { kind: 'sse', events }
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    const kind = trimmed.startsWith('<') ? 'an HTML page' : contentType ? `"${contentType.split(';')[0]}"` : 'non-JSON text'
    throw new LlmError(
      'bad_response',
      `The endpoint returned ${kind} instead of JSON. Check that the base URL is the API root (often ending in /v1).`,
    )
  }
  // Some routers report upstream failures as HTTP 200 with an error object.
  if (json && typeof json === 'object' && 'error' in json && (json as { error?: unknown }).error) {
    throw new LlmError('provider_error', 'The provider answered HTTP 200 but with an error object (often a wrong model name or an upstream failure)')
  }
  return { kind: 'json', json }
}
