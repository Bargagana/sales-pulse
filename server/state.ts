import * as core from '@core/index'
import { ONBOARDING_STEPS, type AppState, type OnboardingStep } from '@core/api-types'
import type { Dataset } from '@core/types'
import type { StoredState } from './data-store'
import type { Credentials } from './storage'

/**
 * A step counts as complete only while what it produced still exists: "llm" needs saved LLM credentials,
 * "mapping"/"quality" need an active dataset. So forgetting credentials or losing a file reopens the right step.
 */
export function buildAppState(stored: StoredState, creds: Credentials, dataset: Dataset | null): AppState {
  const prerequisite: Record<OnboardingStep, boolean> = {
    language: true,
    llm: creds.llm !== undefined,
    data: true,
    mapping: dataset !== null,
    quality: dataset !== null,
    telegram: creds.telegram !== undefined,
  }
  const completed = Object.fromEntries(
    ONBOARDING_STEPS.map((step) => [step, stored.completed[step] === true && prerequisite[step]]),
  ) as Record<OnboardingStep, boolean>

  return {
    onboarded: ONBOARDING_STEPS.every((step) => completed[step]),
    completed,
    lang: stored.lang,
    llm: creds.llm ? { format: creds.llm.format, baseUrl: creds.llm.baseUrl, model: creds.llm.model, hasKey: creds.llm.apiKey !== '' } : null,
    telegram: creds.telegram ? { chatId: creds.telegram.chatId, hasToken: creds.telegram.botToken !== '' } : null,
    dataset: dataset
      ? { id: dataset.id, rowCount: dataset.rows.length, createdAt: dataset.createdAt, periods: core.computePeriods(dataset.rows) }
      : null,
  }
}
