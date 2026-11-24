// Typed client for the server API (contract: core/api-types.ts). Shared by onboarding and dashboard features.
import type {
  ApiError,
  AppState,
  ApplyRequest,
  ApplyResponse,
  CompleteStepRequest,
  DatasetEvent,
  DatasetResponse,
  LlmConfigRequest,
  ProposeResponse,
  PushTokenResponse,
  SummaryRequest,
  SummaryResponse,
  TelegramConfigRequest,
  TelegramSendRequest,
  TelegramSendResponse,
  TestResult,
  UploadResponse,
} from '@core/api-types'
import type { Lang } from '@core/types'

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const isRaw = body instanceof Blob || body instanceof FormData || typeof body === 'string'
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined || isRaw ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : isRaw ? (body as BodyInit) : JSON.stringify(body),
    ...init,
  })
  const text = await res.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    // A non-JSON body (an HTML error page from a proxy, a crashed server) is still an HTTP failure, not a client bug.
    throw new ApiRequestError(res.status, 'http_error', res.statusText || 'Unexpected response from the server')
  }
  if (!res.ok) {
    const err = (json as ApiError | undefined)?.error
    throw new ApiRequestError(res.status, err?.code ?? 'http_error', err?.message ?? res.statusText, err?.details)
  }
  return json as T
}

export const api = {
  state: () => request<AppState>('GET', '/state'),
  setLanguage: (lang: Lang) => request<AppState>('PUT', '/settings/language', { lang }),
  completeStep: (body: CompleteStepRequest) => request<AppState>('POST', '/onboarding/complete', body),

  configureLlm: (body: LlmConfigRequest) => request<TestResult>('POST', '/llm/config', body),

  uploadCsv: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<UploadResponse>('POST', '/data/upload', form)
  },
  propose: (uploadId: string) => request<ProposeResponse>('POST', '/data/propose', { uploadId }),
  apply: (body: ApplyRequest) => request<ApplyResponse>('POST', '/data/apply', body),
  dataset: () => request<DatasetResponse>('GET', '/dataset'),

  configureTelegram: (body: TelegramConfigRequest) => request<TestResult>('POST', '/telegram/config', body),
  summary: (body: SummaryRequest) => request<SummaryResponse>('POST', '/summary', body),
  sendTelegram: (body: TelegramSendRequest) => request<TelegramSendResponse>('POST', '/telegram/send', body),

  pushToken: () => request<PushTokenResponse>('GET', '/push-token'),
  rotatePushToken: () => request<PushTokenResponse>('POST', '/push-token/rotate'),
  forgetCredentials: () => request<AppState>('POST', '/credentials/forget'),
}

/** Subscribe to dataset changes (push API). Returns an unsubscribe function. */
export function onDatasetChange(cb: (e: DatasetEvent) => void): () => void {
  const es = new EventSource('/api/events')
  const handler = (ev: MessageEvent) => {
    try {
      cb(JSON.parse(ev.data) as DatasetEvent)
    } catch {
      /* ignore malformed event */
    }
  }
  es.addEventListener('dataset', handler as EventListener)
  return () => {
    es.removeEventListener('dataset', handler as EventListener)
    es.close()
  }
}
