import { describeKeys, postJson, safeToken, trimTrailingSlash } from './http'
import { LlmError, type ChatRequest, type LlmAdapter, type LlmConfig } from './types'

export const ANTHROPIC_VERSION = '2023-06-01'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Users often paste "https://api.anthropic.com/v1"; the path below already adds /v1. */
function anthropicBase(baseUrl: string): string {
  return trimTrailingSlash(baseUrl).replace(/\/v1$/, '')
}

export function anthropicAdapter(config: LlmConfig, fetchFn: typeof fetch, timeoutMs: number): LlmAdapter {
  return {
    async complete(req: ChatRequest): Promise<string> {
      const body = await postJson(
        fetchFn,
        `${anthropicBase(config.baseUrl)}/v1/messages`,
        { 'x-api-key': config.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        {
          model: config.model,
          system: req.system,
          messages: req.messages,
          max_tokens: req.maxTokens,
          temperature: 0,
          stream: false,
        },
        timeoutMs,
      )

      let text = ''
      let stopReason: string | undefined
      let shape = 'a stream'
      let sawContent = false
      if (body.kind === 'sse') {
        for (const ev of body.events) {
          if (!isObj(ev)) continue
          if (ev.type === 'content_block_delta' && isObj(ev.delta) && typeof ev.delta.text === 'string') text += ev.delta.text
          if (ev.type === 'content_block_start' || ev.type === 'message_start') sawContent = true
          if (ev.type === 'message_delta' && isObj(ev.delta)) stopReason = safeToken(ev.delta.stop_reason) ?? stopReason
        }
      } else {
        const json = body.json
        shape = describeKeys(json)
        const content = isObj(json) && Array.isArray(json.content) ? json.content : undefined
        sawContent = content !== undefined
        text = (content ?? [])
          .filter((block): block is Obj => isObj(block) && block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text as string)
          .join('')
        stopReason = isObj(json) ? safeToken(json.stop_reason) : undefined
      }

      if (text.trim() === '') {
        if (stopReason === 'max_tokens') {
          throw new LlmError('bad_response', 'The model used its whole token budget (thinking) and wrote no answer (stop_reason: max_tokens)')
        }
        if (!sawContent) {
          throw new LlmError('bad_response', `The reply is not in the Anthropic Messages format: no "content" field (fields: ${shape}). Check the API format setting.`)
        }
        throw new LlmError('bad_response', 'The LLM reply had no text content')
      }
      return text
    },
  }
}
