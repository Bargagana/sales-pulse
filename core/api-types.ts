// HTTP contract between client/ and server/. CONTRACT: changes are an orchestrator/integrator decision.
// All endpoints are under /api, JSON unless noted. Errors: HTTP 4xx/5xx with body ApiError.
// Secrets (API key, bot token) are NEVER returned by any endpoint. Push token is returned only by GET /api/push-token.

import type { Dataset, Filters, Lang, Mapping, DataProfile, QualityReport, Facts, Periods, Kpis, WeakOutlet, CanonicalColumn } from './types'

export interface ApiError {
  error: { code: ApiErrorCode | (string & {}); message: string; details?: unknown }
}

/**
 * Codes the server returns in ApiError.error.code. The client translates from these; `message` is English diagnostic text.
 * details: missing_required_columns -> { missing: CanonicalColumn[] }, unmapped_values -> { unmapped: QualityReport['unmapped'] },
 * unknown_region -> { regions: string[] }, unreadable_rows -> { rows, rowsRead, unparseable: QualityReport['unparseable'] (first 20) },
 * invalid_body / invalid_query -> { path, message }[].
 */
export type ApiErrorCode =
  | 'forbidden_host' // 403: Host header is not localhost (DNS rebinding guard)
  | 'forbidden_origin' // 403: state-changing request from another origin (CSRF guard)
  | 'unauthorized' // 401: push API bearer token missing or wrong
  | 'invalid_json'
  | 'invalid_body'
  | 'invalid_query'
  | 'invalid_step'
  | 'missing_api_key'
  | 'missing_bot_token'
  | 'missing_file'
  | 'bad_multipart' // 400: multipart body is malformed
  | 'empty_body'
  | 'bad_csv'
  | 'payload_too_large' // 413
  | 'upload_not_found' // 404: upload expired or server restarted; upload again
  | 'missing_required_columns' // 400
  | 'no_valid_rows' // 422
  | 'unreadable_rows' // 422 (push API): more than 5% of rows unreadable, likely a new date or number format
  | 'unmapped_values' // 422 (push API): unknown region/brand values
  | 'unknown_region' // 400 (push API ?region=)
  | 'no_dataset' // 404
  | 'telegram_not_configured' // 409
  | 'not_found'
  | 'internal'

/** Why the server took a fallback path. The client translates `code`; `detail` is optional English diagnostic text. */
export type NoticeCode =
  | 'llm_not_configured' // no LLM saved, deterministic output used
  | 'llm_invalid' // LLM answered twice but failed validation; detail = last validation error
  | 'llm_failed' // LLM call failed (network, auth, timeout); detail = our own error text, never the provider's
  | 'mapping_reused' // the upload matches a mapping the user confirmed before
export interface Notice {
  code: NoticeCode
  detail?: string
}

export type LlmFormat = 'openai' | 'anthropic'

export type OnboardingStep = 'language' | 'llm' | 'data' | 'mapping' | 'quality' | 'telegram'
export const ONBOARDING_STEPS: OnboardingStep[] = ['language', 'llm', 'data', 'mapping', 'quality', 'telegram']

// GET /api/state
export interface AppState {
  onboarded: boolean // all steps complete
  completed: Record<OnboardingStep, boolean>
  lang: Lang
  llm: { format: LlmFormat; baseUrl: string; model: string; hasKey: boolean } | null
  telegram: { chatId: string; hasToken: boolean } | null
  dataset: { id: string; rowCount: number; createdAt: string; periods: Periods } | null
}

// PUT /api/settings/language
export interface LanguageRequest {
  lang: Lang
}

// POST /api/llm/config  — tests the connection (tiny prompt), saves encrypted only on success.
// apiKey may be omitted to keep the saved key (editing other fields in Settings).
export interface LlmConfigRequest {
  format: LlmFormat
  baseUrl: string // e.g. https://api.anthropic.com or https://openrouter.ai/api/v1
  apiKey?: string
  model: string
}
export interface TestResult {
  ok: boolean
  message: string // human readable, localised by client from `code` when present
  code?:
    | 'unauthorized'
    | 'not_found'
    | 'timeout'
    | 'network'
    | 'bad_response'
    | 'bad_request'
    | 'provider_error' // LLM: HTTP 5xx, or an error object inside a 200
    | 'chat_not_found'
    | 'bot_blocked'
  /** LLM test only: our own English diagnostic (never provider text), shown under the translated message. */
  detail?: string
}

// POST /api/data/upload  — body: text/csv (raw) or multipart/form-data field "file". Max 20 MB.
export interface UploadResponse {
  uploadId: string
  profile: DataProfile
}

// POST /api/data/propose — asks the LLM for a Mapping (falls back to core.heuristicMapping on failure).
export interface ProposeRequest {
  uploadId: string
}
export interface ProposeResponse {
  mapping: Mapping
  /** saved = a mapping the user confirmed earlier for the same profile (no LLM call made). */
  source: 'llm' | 'heuristic' | 'saved'
  warnings: Notice[]
  missingRequired: CanonicalColumn[]
}

// POST /api/data/apply — cleans with the confirmed mapping, makes it the active dataset, saves the mapping for reuse.
export interface ApplyRequest {
  uploadId: string
  mapping: Mapping
}
export interface ApplyResponse {
  datasetId: string
  quality: QualityReport
}

// POST /api/onboarding/complete  — marks a client-only step done (language, quality).
export interface CompleteStepRequest {
  step: OnboardingStep
}

// GET /api/dataset
export type DatasetResponse = Dataset

// POST /api/telegram/config — sends a test message, saves encrypted only on success.
// botToken may be omitted to keep the saved token.
export interface TelegramConfigRequest {
  botToken?: string
  chatId: string
}

// POST /api/summary
export interface SummaryRequest {
  filters: Filters
  lang: Lang
}
export interface SummaryResponse {
  summary: string
  template: string
  source: 'llm' | 'fallback'
  facts: Facts
  warnings: Notice[]
}

// POST /api/telegram/send — regenerates the summary server-side for these filters (client text is not trusted) and sends it.
export interface TelegramSendRequest {
  filters: Filters
  lang: Lang
}
export interface TelegramSendResponse {
  ok: boolean
  message: string
  code?: TestResult['code']
}

// GET /api/push-token -> { token } ; POST /api/push-token/rotate -> { token }
export interface PushTokenResponse {
  token: string
}

// POST /api/credentials/forget -> AppState (LLM + Telegram config wiped, onboarding llm/telegram steps reset).
// The push token lives in the same encrypted file, so it is invalidated too; GET /api/push-token creates a new one.

// POST /api/ingest  (push API) — Authorization: Bearer <push token>; body text/csv or multipart "file".
// Query: summary=true, lang=id|en, region=<name>, telegram=true
export interface IngestResponse {
  datasetId: string
  quality: QualityReport
  periods: Periods
  kpis: Kpis
  weakestOutlets: WeakOutlet[]
  summary?: string
  summarySource?: 'llm' | 'fallback'
  telegram?: { sent: boolean; message: string }
}

// GET /api/events — Server-Sent Events. event: "dataset", data: {"datasetId": string}. Heartbeat comment every 25 s.
export interface DatasetEvent {
  datasetId: string
}

export type { Dataset }
