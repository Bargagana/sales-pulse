import { randomUUID } from 'node:crypto'
import type { AppState } from '@core/api-types'
import type { Dataset } from '@core/types'
import { DataStore } from './data-store'
import { EventBroadcaster } from './events'
import { HttpError } from './http'
import { realAdapterFactory } from './llm/index'
import { mockAdapterFactory } from './llm/mock'
import type { AdapterFactory, LlmAdapter, LlmTask } from './llm/types'
import { buildAppState } from './state'
import { CredentialStore } from './storage'
import { mockTelegramSender, telegramSender, type TelegramSender } from './telegram'
import { UploadStore } from './uploads'

export interface AppDeps {
  dataDir: string
  fetch?: typeof fetch
  now?: () => Date
  newId?: (prefix: string) => string
  /** SALES_PULSE_LLM_MOCK / SALES_PULSE_TELEGRAM_MOCK: built-in fakes instead of real HTTP calls. */
  llmMock?: boolean
  telegramMock?: boolean
  /** LLM and Telegram request timeout. */
  timeoutMs?: number
  /** Built client to serve with SPA fallback (--static). */
  staticRoot?: string
  log?: (msg: string) => void
}

const DEFAULT_TIMEOUT_MS = 30_000

const defaultId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`

export class AppContext {
  readonly data: DataStore
  readonly creds: CredentialStore
  readonly uploads: UploadStore
  readonly events = new EventBroadcaster()
  readonly now: () => Date
  readonly newId: (prefix: string) => string
  readonly log: (msg: string) => void
  private readonly adapterFactory: AdapterFactory
  readonly sendTelegram: TelegramSender

  constructor(deps: AppDeps) {
    const fetchFn = deps.fetch ?? globalThis.fetch
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? defaultId
    this.log = deps.log ?? ((msg) => console.log(`[sales-pulse] ${msg}`))
    this.data = new DataStore(deps.dataDir, this.log)
    this.creds = new CredentialStore(deps.dataDir, this.log)
    this.uploads = new UploadStore(this.now)
    this.adapterFactory = deps.llmMock ? mockAdapterFactory : realAdapterFactory(fetchFn, timeoutMs)
    this.sendTelegram = deps.telegramMock ? mockTelegramSender : telegramSender(fetchFn, timeoutMs)
  }

  async appState(): Promise<AppState> {
    return buildAppState(await this.data.getState(), await this.creds.load(), await this.data.getDataset())
  }

  adapterFor(config: Parameters<AdapterFactory>[0], task: LlmTask): LlmAdapter {
    return this.adapterFactory(config, task)
  }

  /** Adapter for the saved LLM config, or null when none is saved (callers fall back to deterministic output). */
  async savedAdapter(task: LlmTask): Promise<LlmAdapter | null> {
    const { llm } = await this.creds.load()
    return llm ? this.adapterFactory(llm, task) : null
  }

  async requireDataset(): Promise<Dataset> {
    const dataset = await this.data.getDataset()
    if (!dataset) throw new HttpError(404, 'no_dataset', 'No dataset loaded yet')
    return dataset
  }

  async activateDataset(dataset: Dataset): Promise<void> {
    await this.data.setDataset(dataset)
    this.events.broadcast({ datasetId: dataset.id })
  }
}
