import { z } from 'zod'
import * as core from '@core/index'
import type { Notice, ProposeResponse } from '@core/api-types'
import { llmMappingProposalSchema } from '@core/schemas'
import type { DataProfile, Mapping, RawTable } from '@core/types'
import { mappingPrompt } from './llm/prompts'
import { askStructured, type Check } from './llm/structured'
import { LlmError, type LlmAdapter } from './llm/types'

function checkProposal(json: unknown): Check<Partial<Mapping>> {
  const parsed = llmMappingProposalSchema.safeParse(json)
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: z.prettifyError(parsed.error) }
}

export function respond(mapping: Mapping, source: ProposeResponse['source'], warnings: Notice[]): ProposeResponse {
  return { mapping, source, warnings, missingRequired: core.missingRequiredColumns(mapping) }
}

/**
 * The LLM sees only the profile (headers, 5 sample rows, distinct values), never the full rows.
 * Its proposal is merged over the deterministic heuristic, so a partial or failed answer still yields a usable mapping.
 */
export async function proposeMapping(raw: RawTable, profile: DataProfile, adapter: LlmAdapter | null): Promise<ProposeResponse> {
  const heuristic = core.heuristicMapping(raw)
  if (!adapter) return respond(heuristic, 'heuristic', [{ code: 'llm_not_configured' }])

  try {
    const result = await askStructured(adapter, mappingPrompt(profile, Object.keys(core.BUILTIN_BRANCH_GEO)), checkProposal)
    if (result.ok) return respond(core.mergeMappings(heuristic, result.value), 'llm', [])
    return respond(heuristic, 'heuristic', [{ code: 'llm_invalid', detail: result.error }])
  } catch (err) {
    if (err instanceof LlmError) return respond(heuristic, 'heuristic', [{ code: 'llm_failed', detail: err.message }])
    throw err
  }
}
