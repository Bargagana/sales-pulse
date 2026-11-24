import type { TestResult } from '@core/api-types'
import { anthropicAdapter } from './anthropic'
import { openAiAdapter } from './openai'
import { TEST_PROMPT } from './prompts'
import { LlmError, type AdapterFactory, type LlmAdapter } from './types'

export function realAdapterFactory(fetchFn: typeof fetch, timeoutMs: number): AdapterFactory {
  return (config) =>
    config.format === 'anthropic' ? anthropicAdapter(config, fetchFn, timeoutMs) : openAiAdapter(config, fetchFn, timeoutMs)
}

/** Any non-empty text reply counts: some models ignore "JSON only" for a ping, which is fine for a connectivity check. */
export async function testConnection(adapter: LlmAdapter): Promise<TestResult> {
  try {
    await adapter.complete(TEST_PROMPT)
    return { ok: true, message: 'Connected to the LLM' }
  } catch (err) {
    // LlmError messages are written by us (never copied from the provider), so they are safe to show as detail.
    if (err instanceof LlmError) return { ok: false, code: err.code, message: err.message, detail: err.message }
    return { ok: false, code: 'bad_response', message: 'Unexpected error while testing the LLM' }
  }
}

export { LlmError } from './types'
export type { AdapterFactory, LlmAdapter, LlmConfig, LlmTask } from './types'
