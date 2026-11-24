import { join } from 'node:path'
import type { OnboardingStep } from '@core/api-types'
import type { Dataset, Lang, MappableColumn, Mapping } from '@core/types'
import { ensureDir, readJsonFile, writeJsonAtomic } from './storage'

export interface StoredState {
  lang: Lang
  completed: Partial<Record<OnboardingStep, boolean>>
}

export interface SavedMapping {
  mapping: Mapping
  headers: string[]
  confirmedAt: string
  /** Canonical values the user saw and confirmed with this mapping; a push bringing anything else marks it Unmapped. */
  knownValues?: Partial<Record<MappableColumn, string[]>>
}

type MappingsFile = Record<string, SavedMapping>

const DEFAULT_STATE: StoredState = { lang: 'id', completed: {} }

/** state.json, dataset.json and mappings.json. Plain JSON: no secrets live here. */
export class DataStore {
  private state: StoredState | null = null
  private dataset: Dataset | null | undefined
  private mappings: MappingsFile | null = null

  constructor(
    private dir: string,
    private log: (msg: string) => void,
  ) {}

  async getState(): Promise<StoredState> {
    this.state ??= (await this.readOrNull<StoredState>('state.json')) ?? structuredClone(DEFAULT_STATE)
    return this.state
  }

  async updateState(patch: (s: StoredState) => StoredState): Promise<StoredState> {
    const next = patch(await this.getState())
    await this.write('state.json', next)
    this.state = next
    return next
  }

  async markSteps(steps: Partial<Record<OnboardingStep, boolean>>): Promise<StoredState> {
    return this.updateState((s) => ({ ...s, completed: { ...s.completed, ...steps } }))
  }

  async getDataset(): Promise<Dataset | null> {
    if (this.dataset === undefined) this.dataset = await this.readOrNull<Dataset>('dataset.json')
    return this.dataset
  }

  async setDataset(dataset: Dataset): Promise<void> {
    await this.write('dataset.json', dataset)
    this.dataset = dataset
  }

  async getMappings(): Promise<MappingsFile> {
    this.mappings ??= (await this.readOrNull<MappingsFile>('mappings.json')) ?? {}
    return this.mappings
  }

  async saveMapping(profileKey: string, entry: SavedMapping): Promise<void> {
    const next = { ...(await this.getMappings()), [profileKey]: entry }
    await this.write('mappings.json', next)
    this.mappings = next
  }

  private async write(name: string, value: unknown): Promise<void> {
    await ensureDir(this.dir)
    await writeJsonAtomic(join(this.dir, name), value)
  }

  private async readOrNull<T>(name: string): Promise<T | null> {
    try {
      return await readJsonFile<T>(join(this.dir, name))
    } catch {
      this.log(`${name} is unreadable and was ignored.`)
      return null
    }
  }
}
