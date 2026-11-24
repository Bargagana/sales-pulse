import type { ChatRequest } from './types'
import {
  CANONICAL_COLUMNS,
  MAPPABLE_COLUMNS,
  REQUIRED_COLUMNS,
  type DataProfile,
  type Facts,
  type Lang,
} from '@core/types'

export const TEST_PROMPT: ChatRequest = {
  system: 'You are a connectivity check. Reply with the JSON object {"ok":true} and nothing else.',
  messages: [{ role: 'user', content: 'ping' }],
  // Reasoning models spend tokens thinking before they answer; 16 left them with an empty reply.
  maxTokens: 1024,
}

const MAPPING_RULES = [
  'columnMap: map EVERY raw header to one canonical column, or null when it matches none. Use each canonical column at most once.',
  'dateFormat: one of "YYYY-MM-DD", "DD/MM/YYYY", "DD-MM-YYYY", "MM/DD/YYYY". Decide from the sample dates. If every day value is <= 12 the order is ambiguous: prefer day-first (Indonesian convention) and say so in notes.',
  'numberFormat: "plain" (1725966000), "id" (1.725.966.000 or 1.234,5) or "en" (1,725,966,000.5). Values may carry "Rp".',
  'valueMap: keyed by CANONICAL column name (one of the mappable columns), mapping a raw variant to its canonical spelling: case and spacing errors, typos, abbreviations (e.g. "Jabar" -> "Jawa Barat", "Jateng" -> "Jawa Tengah", "Jatim" -> "Jawa Timur"). Only list values that change. Only use values that appear in distinctValues. Never merge two genuinely different entities.',
  'branchGeo: approximate city coordinates {"lat","lon"} ONLY for branch values that are not in knownBranches.',
  'notes: at most 10 short English sentences for the human reviewer about anything uncertain.',
]

export function mappingPrompt(profile: DataProfile, knownBranches: string[]): ChatRequest {
  const input = {
    canonicalColumns: CANONICAL_COLUMNS,
    requiredColumns: REQUIRED_COLUMNS,
    mappableColumns: MAPPABLE_COLUMNS,
    knownBranches,
    profile,
  }
  return {
    system:
      'You map messy sales CSV exports from an Indonesian snack distributor onto a fixed schema. ' +
      'A human reviews your proposal and code applies it, so be precise and conservative. ' +
      'Reply with ONE JSON object with the keys columnMap, dateFormat, numberFormat, valueMap, branchGeo, notes. No prose, no code fences.',
    messages: [{ role: 'user', content: `Rules:\n- ${MAPPING_RULES.join('\n- ')}\n\nInput:\n${JSON.stringify(input)}` }],
    maxTokens: 4000,
  }
}

const LANGUAGE_NAME: Record<Lang, string> = { id: 'Bahasa Indonesia', en: 'English' }

/** Only keys, kinds and descriptions go to the LLM. Values stay on the server, so the model cannot get a number wrong. */
export function summaryPrompt(facts: Facts, lang: Lang): ChatRequest {
  const placeholders = Object.entries(facts).map(([key, fact]) => ({ key, kind: fact.kind, description: fact.description }))
  const rules = [
    `Write in ${LANGUAGE_NAME[lang]}.`,
    'Exactly one paragraph, no line breaks, no lists, no markdown or HTML.',
    'At most 60 words.',
    'Never write a digit (0-9) yourself. Every number, name, month and percentage must be a {placeholder} from the list, written with curly braces exactly as given.',
    'Use only placeholders from the list. You do not need to use all of them.',
    'Audience: a sales manager reading Telegram on a phone. Lead with the overall result, then say which outlets to visit and which brand to push.',
  ]
  return {
    system: 'You write short, action-oriented sales digests as templates with {placeholders}. Reply with ONE JSON object {"template": "..."} and nothing else.',
    messages: [
      {
        role: 'user',
        content: `Rules:\n- ${rules.join('\n- ')}\n\nPlaceholders:\n${JSON.stringify(placeholders)}`,
      },
    ],
    maxTokens: 2000,
  }
}
