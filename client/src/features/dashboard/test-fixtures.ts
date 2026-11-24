// Shared by the dashboard tests: the PRD sample cleaned by core, exactly as the server would store it.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanTable, computePeriods, heuristicMapping, parseCsv } from '@core/index'
import type { AppState } from '@core/api-types'
import type { Dataset } from '@core/types'

export function sampleDataset(): Dataset {
  // Relative to the repo root (Vitest's root and cwd): under jsdom import.meta.url is not a file: URL.
  const csv = readFileSync(resolve(process.cwd(), 'data', 'data.csv'), 'utf8')
  const raw = parseCsv(csv)
  return cleanTable(raw, heuristicMapping(raw))
}

export function onboardedState(dataset: Dataset): AppState {
  return {
    onboarded: true,
    completed: { language: true, llm: true, data: true, mapping: true, quality: true, telegram: true },
    lang: 'id',
    llm: { format: 'openai', baseUrl: 'https://llm.test/v1', model: 'test', hasKey: true },
    telegram: { chatId: '42', hasToken: true },
    dataset: { id: dataset.id, rowCount: dataset.rows.length, createdAt: dataset.createdAt, periods: computePeriods(dataset.rows) },
  }
}
