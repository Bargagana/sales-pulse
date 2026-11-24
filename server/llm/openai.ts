import { describeKeys, postJson, safeToken, trimTrailingSlash, type ProviderBody } from './http'
import { LlmError, type ChatRequest, type LlmAdapter, type LlmConfig } from './types'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** `content` is a string in most APIs, but some return an array of parts: [{type:"text", text:"..."}]. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : isObj(part) && typeof part.text === 'string' ? part.text : ''))
      .join('')
  }
  return ''
}

interface Extracted {
  text: string
  finishReason?: string
  reasoningOnly: boolean
  sawChoices: boolean
  shape: string
}

function extract(body: ProviderBody): Extracted {
  if (body.kind === 'sse') {
    let text = ''
    let finishReason: string | undefined
    let reasoning = false
    let sawChoices = false
    for (const ev of body.events) {
      const choice = isObj(ev) && Array.isArray(ev.choices) ? ev.choices[0] : undefined
      if (!isObj(choice)) continue
      sawChoices = true
      const delta = isObj(choice.delta) ? choice.delta : isObj(choice.message) ? choice.message : {}
      text += contentText(delta.content)
      if (delta.reasoning_content || delta.reasoning) reasoning = true
      finishReason = safeToken(choice.finish_reason) ?? finishReason
    }
    return { text, finishReason, reasoningOnly: reasoning && text.trim() === '', sawChoices, shape: 'a stream' }
  }

  const json = body.json
  const choice = isObj(json) && Array.isArray(json.choices) ? json.choices[0] : undefined
  const message = isObj(choice) && isObj(choice.message) ? choice.message : undefined
  // Legacy completions-style routers put the text on the choice itself.
  const text = contentText(message?.content) || (isObj(choice) && typeof choice.text === 'string' ? choice.text : '')
  return {
    text,
    finishReason: isObj(choice) ? safeToken(choice.finish_reason) : undefined,
    reasoningOnly: !!(message && (message.reasoning_content || message.reasoning)) && text.trim() === '',
    sawChoices: isObj(choice),
    shape: describeKeys(json),
  }
}

function emptyReplyError(x: Extracted): LlmError {
  if (x.finishReason === 'length' || x.reasoningOnly) {
    return new LlmError(
      'bad_response',
      'The model used its whole token budget on reasoning and wrote no answer (finish_reason: length). Pick a non-reasoning model or one with lower reasoning effort.',
    )
  }
  if (x.finishReason === 'content_filter') return new LlmError('bad_response', 'The provider blocked the reply (finish_reason: content_filter)')
  if (!x.sawChoices) {
    return new LlmError('bad_response', `The reply is not in the OpenAI chat format: no "choices" field (fields: ${x.shape}). Check the API format setting.`)
  }
  return new LlmError('bad_response', `The reply had no text content${x.finishReason ? ` (finish_reason: ${x.finishReason})` : ''}`)
}

/** OpenAI-compatible chat completions (OpenAI, OpenRouter, Groq, Ollama, LM Studio, LiteLLM and other routers). */
export function openAiAdapter(config: LlmConfig, fetchFn: typeof fetch, timeoutMs: number): LlmAdapter {
  const url = `${trimTrailingSlash(config.baseUrl)}/chat/completions`
  const headers = { authorization: `Bearer ${config.apiKey}` }
  // Reasoning models (o-series, GPT-5) reject max_tokens and temperature; once one does, use their parameters.
  let reasoningParams = false

  const send = (req: ChatRequest) => {
    const messages = [{ role: 'system', content: req.system }, ...req.messages]
    const body = reasoningParams
      ? { model: config.model, messages, max_completion_tokens: req.maxTokens, stream: false }
      : { model: config.model, messages, max_tokens: req.maxTokens, temperature: 0, stream: false }
    return postJson(fetchFn, url, headers, body, timeoutMs)
  }

  return {
    async complete(req: ChatRequest): Promise<string> {
      let body: ProviderBody
      try {
        body = await send(req)
      } catch (err) {
        if (!(err instanceof LlmError) || err.code !== 'bad_request' || reasoningParams) throw err
        reasoningParams = true
        try {
          body = await send(req)
        } catch (retryErr) {
          reasoningParams = false
          throw retryErr
        }
      }
      const x = extract(body)
      if (x.text.trim() === '') throw emptyReplyError(x)
      return x.text
    },
  }
}
