import { extractFirstJsonObject } from './json'
import type { ChatRequest, LlmAdapter } from './types'

export type Check<T> = { ok: true; value: T } | { ok: false; error: string }

export type StructuredResult<T> = { ok: true; value: T; attempts: number } | { ok: false; error: string; attempts: number }

/**
 * Ask for JSON, validate it, and on failure retry exactly once with the validation error fed back.
 * Transport errors (LlmError) propagate: retrying a wrong key or a dead endpoint only doubles the wait.
 */
export async function askStructured<T>(
  adapter: LlmAdapter,
  req: ChatRequest,
  check: (json: unknown) => Check<T>,
): Promise<StructuredResult<T>> {
  const first = await adapter.complete(req)
  const firstCheck = parseAndCheck(first, check)
  if (firstCheck.ok) return { ok: true, value: firstCheck.value, attempts: 1 }

  const retry: ChatRequest = {
    ...req,
    messages: [
      ...req.messages,
      { role: 'assistant', content: first },
      {
        role: 'user',
        content: `Your reply was rejected: ${firstCheck.error}\nReply again with only the corrected JSON object.`,
      },
    ],
  }
  const second = parseAndCheck(await adapter.complete(retry), check)
  return second.ok ? { ok: true, value: second.value, attempts: 2 } : { ok: false, error: second.error, attempts: 2 }
}

function parseAndCheck<T>(text: string, check: (json: unknown) => Check<T>): Check<T> {
  let json: unknown
  try {
    json = extractFirstJsonObject(text)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
  return check(json)
}
