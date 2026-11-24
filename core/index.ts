// Public API of core/. CONTRACT: server/ and client/ import ONLY from '@core/index' (and '@core/types', '@core/api-types', '@core/schemas').
// Names and signatures are fixed; implementations live in the modules below.
// Everything in core/ is pure (no fs, no network, no Date.now in logic paths, no randomness) and runs in Node and the browser.

import type { QualityReport } from './types'

export * from './types'

// ---------- parse ----------
export { parseCsv, profileTable } from './parse'

// ---------- mapping ----------
export { heuristicMapping, mergeMappings, reuseMapping, missingRequiredColumns, profileKey, KNOWN_REGION_ALIASES } from './mapping'
export { BUILTIN_BRANCH_GEO } from './geo'

// ---------- clean ----------
export { cleanTable } from './clean'

// ---------- metrics (PRD §6.4) ----------
export {
  applyFilters,
  computePeriods,
  computeKpis,
  comparisonWindows,
  breakdown,
  matrix,
  dailySeries,
  monthlySeries,
  weakestOutlets,
  newOutlets,
} from './metrics'

// ---------- format ----------
export { formatIdr, formatPct, formatSharePct, formatInt, formatMonth } from './format'

// ---------- summary (PRD §6.5) ----------
export { buildFacts, validateSummaryTemplate, renderSummary, fallbackTemplate, telegramMessage } from './summary'

// re-export for convenience
export type { QualityReport }
