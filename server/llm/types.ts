import type { LlmFormat, TestResult } from '@core/api-types'

export interface LlmConfig {
  format: LlmFormat
  baseUrl: string
  model: string
  apiKey: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  system: string
  messages: ChatMessage[]
  maxTokens: number
}

/** One interface, two wire formats. Returns the model's text reply. Throws LlmError. */
export interface LlmAdapter {
  complete(req: ChatRequest): Promise<string>
}

export type LlmErrorCode = Extract<TestResult['code'], 'unauthorized' | 'not_found' | 'timeout' | 'network' | 'bad_response' | 'bad_request' | 'provider_error'>

/** Messages are written by us, never copied from the provider: provider errors can echo part of the API key. */
export class LlmError extends Error {
  constructor(
    public code: LlmErrorCode,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Which job an adapter is created for. Real adapters ignore it; the mock adapter (SALES_PULSE_LLM_MOCK=1)
 * uses it to answer deterministically without parsing prompts.
 */
export type LlmTask =
  | { kind: 'test' }
  | { kind: 'mapping' }
  | { kind: 'summary'; template: () => string }

export type AdapterFactory = (config: LlmConfig, task: LlmTask) => LlmAdapter
