import { z } from 'zod'
import * as core from '@core/index'
import type { Notice, SummaryResponse } from '@core/api-types'
import { llmSummarySchema } from '@core/schemas'
import type { Facts, Filters, Lang, SalesRow, SummaryScope } from '@core/types'
import { summaryPrompt } from './llm/prompts'
import { askStructured, type Check } from './llm/structured'
import { LlmError, type LlmAdapter, type LlmTask } from './llm/types'

/** A summary is scoped to one region only when exactly one region is filtered; otherwise it is the national digest. */
export function summaryScope(filters: Filters): SummaryScope {
  return filters.regions?.length === 1 ? { region: filters.regions[0] } : {}
}

function templateCheck(facts: Facts, lang: Lang) {
  return (json: unknown): Check<string> => {
    const parsed = llmSummarySchema.safeParse(json)
    if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) }
    const validation = core.validateSummaryTemplate(parsed.data.template, facts, lang)
    return validation.ok ? { ok: true, value: parsed.data.template } : { ok: false, error: validation.errors.join('; ') }
  }
}

/**
 * PRD §6.5: code computes the facts, the LLM only writes wording around {placeholders}, code validates and substitutes.
 * The task carries the fallback template so the mock LLM can answer with a known-valid one.
 */
export async function generateSummary(
  allRows: SalesRow[],
  filters: Filters,
  lang: Lang,
  adapterFor: (task: LlmTask) => Promise<LlmAdapter | null>,
): Promise<SummaryResponse> {
  const facts = core.buildFacts(core.applyFilters(allRows, filters), summaryScope(filters))
  const fallback = () => core.fallbackTemplate(facts, lang)

  const useFallback = (warning: Notice): SummaryResponse => {
    const template = fallback()
    return { summary: core.renderSummary(template, facts, lang), template, source: 'fallback', facts, warnings: [warning] }
  }

  const adapter = await adapterFor({ kind: 'summary', template: fallback })
  if (!adapter) return useFallback({ code: 'llm_not_configured' })

  try {
    const result = await askStructured(adapter, summaryPrompt(facts, lang), templateCheck(facts, lang))
    if (!result.ok) return useFallback({ code: 'llm_invalid', detail: result.error })
    return { summary: core.renderSummary(result.value, facts, lang), template: result.value, source: 'llm', facts, warnings: [] }
  } catch (err) {
    if (err instanceof LlmError) return useFallback({ code: 'llm_failed', detail: err.message })
    throw err
  }
}
