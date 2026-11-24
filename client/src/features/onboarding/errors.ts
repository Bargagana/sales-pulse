import type { TFunction } from 'i18next'
import type { TestResult } from '@core/api-types'
import { ApiRequestError } from '@/lib/api'

/** Which step is talking: the same code means different things ("unauthorized" is a bad API key or a bad bot token). */
export type ErrorScope = 'llm' | 'telegram' | 'data' | 'mapping' | 'quality' | 'language' | 'push' | 'credentials'

/**
 * Server messages are English (and a provider's text could echo a secret), so the UI never shows them:
 * it translates the code, most specific key first.
 */
export function messageForCode(t: TFunction<'onboarding'>, scope: ErrorScope, code: string | undefined): string {
  const keys = code ? [`errors.${scope}.${code}`, `errors.any.${code}`, 'errors.any.unknown'] : ['errors.any.unknown']
  return t(keys)
}

export function messageForError(t: TFunction<'onboarding'>, scope: ErrorScope, error: unknown): string {
  // A fetch TypeError, or a non-JSON body from a crashed server/dev proxy, means the local server is not answering.
  if (!(error instanceof ApiRequestError) || error.code === 'http_error') return t('errors.any.serverDown')
  return messageForCode(t, scope, error.code)
}

export function messageForResult(t: TFunction<'onboarding'>, scope: ErrorScope, result: TestResult): string {
  return messageForCode(t, scope, result.code)
}
