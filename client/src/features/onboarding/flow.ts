// Pure helpers for the onboarding flow: step order, mapping edits and display formatting.
// Kept free of React so the rules (what blocks Continue, where to resume) are unit-testable on their own.
import { ONBOARDING_STEPS, type LlmFormat, type OnboardingStep } from '@core/api-types'
import {
  CANONICAL_COLUMNS,
  MAPPABLE_COLUMNS,
  REQUIRED_COLUMNS,
  type CanonicalColumn,
  type DataProfile,
  type Lang,
  type MappableColumn,
  type Mapping,
} from '@core/types'
import { LOCALE_TAG } from '@/i18n'

export const DEFAULT_BASE_URL: Record<LlmFormat, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
}

/** Steps that live in client memory: the upload id from step 3 is gone after a reload, so mapping must start from data again. */
export function resumeStep(completed: Record<OnboardingStep, boolean>, hasUpload: boolean): OnboardingStep {
  const first = ONBOARDING_STEPS.find((step) => !completed[step]) ?? 'telegram'
  return first === 'mapping' && !hasUpload ? 'data' : first
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step)
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[stepIndex(step) + 1] ?? null
}

export function previousStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[stepIndex(step) - 1] ?? null
}

export const isRequired = (column: CanonicalColumn): boolean => (REQUIRED_COLUMNS as readonly string[]).includes(column)

/** Raw header currently mapped to a canonical column (first one wins; duplicates are reported separately). */
export function headerFor(mapping: Mapping, column: CanonicalColumn): string | undefined {
  return Object.entries(mapping.columnMap).find(([, target]) => target === column)?.[0]
}

/** Canonical columns chosen for more than one header. core would read only one of them, so the user must pick. */
export function duplicateTargets(mapping: Mapping): CanonicalColumn[] {
  const seen = new Map<CanonicalColumn, number>()
  for (const target of Object.values(mapping.columnMap)) if (target) seen.set(target, (seen.get(target) ?? 0) + 1)
  return CANONICAL_COLUMNS.filter((column) => (seen.get(column) ?? 0) > 1)
}

/** Distinct values (with counts) of the raw column that feeds a canonical column. */
export function distinctFor(profile: DataProfile, mapping: Mapping, column: MappableColumn): { value: string; count: number }[] {
  const header = headerFor(mapping, column)
  return header ? (profile.distinctValues[header] ?? []) : []
}

export interface ValueFix {
  column: MappableColumn
  from: string
  to: string
  /** Rows carrying `from`, from the upload profile. null when the profile capped the distinct list before this value. */
  rows: number | null
}

/** valueMap flattened into display rows, grouped by column in canonical order, biggest impact first. */
export function valueFixes(mapping: Mapping, profile: DataProfile): ValueFix[] {
  return MAPPABLE_COLUMNS.flatMap((column) => {
    const counts = new Map(distinctFor(profile, mapping, column).map((d) => [d.value, d.count]))
    return Object.entries(mapping.valueMap[column] ?? {})
      .map(([from, to]) => ({ column, from, to, rows: counts.get(from) ?? null }))
      .sort((a, b) => (b.rows ?? 0) - (a.rows ?? 0) || a.from.localeCompare(b.from))
  })
}

export function setValueFix(mapping: Mapping, column: MappableColumn, from: string, to: string): Mapping {
  return { ...mapping, valueMap: { ...mapping.valueMap, [column]: { ...mapping.valueMap[column], [from]: to } } }
}

export function removeValueFix(mapping: Mapping, column: MappableColumn, from: string): Mapping {
  const { [from]: _removed, ...rest } = mapping.valueMap[column] ?? {}
  const valueMap = { ...mapping.valueMap }
  if (Object.keys(rest).length > 0) valueMap[column] = rest
  else delete valueMap[column]
  return { ...mapping, valueMap }
}

export function setColumn(mapping: Mapping, header: string, target: CanonicalColumn | null): Mapping {
  return { ...mapping, columnMap: { ...mapping.columnMap, [header]: target } }
}

export function removeBranchGeo(mapping: Mapping, branch: string): Mapping {
  const { [branch]: _removed, ...branchGeo } = mapping.branchGeo
  return { ...mapping, branchGeo }
}

/** A fix whose target is blank (or too long for the server schema) cannot be applied. */
export function invalidFixes(mapping: Mapping): ValueFix[] {
  return MAPPABLE_COLUMNS.flatMap((column) =>
    Object.entries(mapping.valueMap[column] ?? {})
      .filter(([, to]) => to.trim() === '' || to.length > 200)
      .map(([from, to]) => ({ column, from, to, rows: null })),
  )
}

/** "1,4 MB" / "512 KB": file sizes read better in the unit people see in Finder. */
export function formatBytes(bytes: number, lang: Lang): string {
  const mb = bytes / (1024 * 1024)
  const [value, unit] = mb >= 1 ? [mb, 'megabyte'] : [Math.max(bytes / 1024, 0.1), 'kilobyte']
  return new Intl.NumberFormat(LOCALE_TAG[lang], { style: 'unit', unit, maximumFractionDigits: 1 }).format(value)
}

/** Ready-to-run push API call. Uses the page origin so it works in dev (Vite proxy) and in `npm start`. */
export function curlExample(origin: string, token: string): string {
  return [
    `curl -X POST "${origin}/api/ingest?summary=true" \\`,
    `  -H "Authorization: Bearer ${token}" \\`,
    `  -H "Content-Type: text/csv" \\`,
    `  --data-binary @data/data.csv`,
  ].join('\n')
}

/** Shows the first and last characters so two tokens can be told apart without revealing one. */
export function maskToken(token: string): string {
  return token.length <= 10 ? '•'.repeat(token.length) : `${token.slice(0, 5)}${'•'.repeat(12)}${token.slice(-4)}`
}
