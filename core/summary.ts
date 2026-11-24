// PRD §6.5: code owns every number. The LLM (or fallbackTemplate) writes words around {placeholders}; code validates and fills them.
import { formatIdr, formatInt, formatMonth, formatPct, formatSharePct } from './format'
import { breakdown, computeKpis, computePeriods, momByGroup, weakestOutlets } from './metrics'
import type { Fact, Facts, Lang, SalesRow, SummaryScope, SummaryValidation } from './types'
import { compareText } from './util'

const MAX_WORDS = 80
const TELEGRAM_LIMIT = 4096
const PLACEHOLDER = /\{([^{}]*)\}/g

const fact = (value: number | string, kind: Fact['kind'], description: string): Fact => ({ value, kind, description })

/** Facts for rows already filtered to the scope. Keys whose value cannot be computed are omitted. */
export function buildFacts(rows: SalesRow[], scope: SummaryScope): Facts {
  const facts: Facts = {
    scope_name: fact(scope.region ?? 'Indonesia', 'text', 'Scope of the summary: a region name, or "Indonesia" for the national view'),
  }
  if (rows.length === 0) return facts

  const periods = computePeriods(rows)
  const kpis = computeKpis(rows)
  facts.total_net = fact(kpis.netSales, 'idr', 'Total net sales (IDR) over the whole data period in scope, returns included')
  if (kpis.momPct !== null) {
    const window = periods.comparableDay ? `, comparing day 1-${periods.comparableDay} of both months` : ''
    facts.mom_pct = fact(kpis.momPct, 'pct', `Net sales change of the current month vs the baseline month (signed %)${window}`)
  }
  if (periods.current) facts.current_month = fact(periods.current, 'month', 'Current (latest) month in the data')
  if (periods.baseline) facts.baseline_month = fact(periods.baseline, 'month', 'Baseline month (the month before the current one)')

  const regions = breakdown(rows, 'region')
  if (regions.length >= 2) {
    facts.top_region = fact(regions[0]!.key, 'text', 'Region with the highest total net sales')
    facts.top_region_net = fact(regions[0]!.net, 'idr', 'Total net sales (IDR) of top_region')
    const slowest = momByGroup(rows, 'region')
      .filter((r): r is typeof r & { momPct: number } => r.momPct !== null)
      .sort((a, b) => a.momPct - b.momPct || compareText(a.key, b.key))[0]
    if (slowest) {
      facts.weakest_region = fact(slowest.key, 'text', 'Region with the lowest month-over-month change')
      facts.weakest_region_mom_pct = fact(slowest.momPct, 'pct', 'Month-over-month change of weakest_region (signed %)')
    }
  }

  const topBrand = breakdown(rows, 'brand')[0]
  if (topBrand) {
    facts.top_brand = fact(topBrand.key, 'text', 'Brand with the highest net sales')
    facts.top_brand_share_pct = fact(topBrand.share * 100, 'share', "top_brand's share of total net sales (%)")
  }
  facts.return_net = fact(kpis.returnNet, 'idr', 'Net value of returned goods (IDR, zero or negative)')

  // With a baseline month we rank by decline vs peers; with one month only the "lowest vs peers" view exists, which has no %.
  const declineMode = periods.baseline !== null
  const weak = weakestOutlets(rows, { mode: declineMode ? 'decline' : 'lowest', limit: 5 })
  facts.weak_count = fact(weak.length, 'int', declineMode ? 'Number of weakest outlets listed (largest decline vs peers)' : 'Number of weakest outlets listed (lowest sales vs peers)')
  weak.forEach((o, i) => {
    const n = i + 1
    // outlet_name and branch are optional columns: fall back to the id, and skip an empty branch.
    facts[`weak_${n}_name`] = fact(o.name || o.outletId, 'text', `Name of weak outlet #${n} (outlets to visit first, #1 is the weakest)`)
    if (o.branch) facts[`weak_${n}_branch`] = fact(o.branch, 'text', `Branch (city) of weak outlet #${n}`)
    if (declineMode) facts[`weak_${n}_pct`] = fact(o.momPct, 'pct', `Month-over-month net sales change of weak outlet #${n} (signed %)`)
  })
  return facts
}

function renderFact(f: Fact, lang: Lang): string {
  if (typeof f.value === 'string') return f.kind === 'month' ? formatMonth(f.value, lang) : f.value
  switch (f.kind) {
    case 'idr':
      return formatIdr(f.value, lang)
    case 'pct':
      return formatPct(f.value, lang)
    case 'share':
      // A share is not a change, so it carries no sign: "+42,9% of sales" would mislead.
      return formatSharePct(f.value, lang)
    case 'int':
      return formatInt(f.value, lang)
    default:
      return String(f.value)
  }
}

export function renderSummary(template: string, facts: Facts, lang: Lang): string {
  return template
    .replace(PLACEHOLDER, (whole, key: string) => {
      const f = facts[key]
      return f ? renderFact(f, lang) : whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length

/** Rules: every placeholder exists; no digits outside placeholders; one paragraph; <= 80 words after rendering. */
export function validateSummaryTemplate(template: string, facts: Facts, lang: Lang): SummaryValidation {
  const errors: string[] = []
  const text = template.trim()
  if (!text) return { ok: false, errors: ['Template is empty.'] }

  const unknown = [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!).filter((key) => !(key in facts))
  for (const key of new Set(unknown)) errors.push(`Unknown placeholder {${key}}. Use only the listed fact keys.`)

  const outside = text.replace(PLACEHOLDER, '')
  if (/[{}]/.test(outside)) errors.push('Unbalanced { or } outside a placeholder.')
  const digits = outside.match(/\p{Nd}+/gu)
  if (digits) errors.push(`Digits outside placeholders: ${[...new Set(digits)].join(', ')}. Every number must come from a placeholder.`)
  if (/[\r\n]/.test(text)) errors.push('Must be a single paragraph without line breaks.')

  const words = countWords(renderSummary(text, facts, lang))
  if (words > MAX_WORDS) errors.push(`Too long: ${words} words after filling placeholders (max ${MAX_WORDS}).`)

  return { ok: errors.length === 0, errors }
}

// ---------- deterministic fallback ----------

interface FallbackParts {
  outlets: number
  regions: boolean
  brand: boolean
  returns: boolean
}

const PHRASES = {
  id: {
    noData: 'Belum ada data penjualan untuk cakupan ini.',
    headlineMom: 'Penjualan bersih {scope_name} {current_month} {mom_pct} dibanding {baseline_month}, total periode data {total_net}.',
    headlineUntil: 'Penjualan bersih {scope_name} hingga {current_month}: {total_net}.',
    headline: 'Penjualan bersih {scope_name}: {total_net}.',
    brand: 'Dorong terus {top_brand}, merek teratas dengan {top_brand_share_pct} penjualan.',
    regions: 'Wilayah terbesar {top_region} ({top_region_net}); pertumbuhan terlemah {weakest_region} ({weakest_region_mom_pct}).',
    topRegion: 'Wilayah terbesar {top_region} ({top_region_net}).',
    outlets: 'Prioritaskan kunjungan: ',
    returns: 'Retur {return_net}, cek alasannya dengan outlet.',
  },
  en: {
    noData: 'No sales data for this scope yet.',
    headlineMom: '{scope_name} net sales for {current_month} are {mom_pct} vs {baseline_month}, data-period total {total_net}.',
    headlineUntil: '{scope_name} net sales up to {current_month}: {total_net}.',
    headline: '{scope_name} net sales: {total_net}.',
    brand: 'Keep pushing {top_brand}, the top brand at {top_brand_share_pct} of sales.',
    regions: 'Biggest region {top_region} ({top_region_net}); weakest trend {weakest_region} ({weakest_region_mom_pct}).',
    topRegion: 'Biggest region {top_region} ({top_region_net}).',
    outlets: 'Visit first: ',
    returns: 'Returns {return_net}; check the reason with the outlets.',
  },
} satisfies Record<Lang, Record<string, string>>

function outletPhrase(facts: Facts, n: number): string {
  const details = [`weak_${n}_branch`, `weak_${n}_pct`].filter((k) => k in facts).map((k) => `{${k}}`)
  return details.length > 0 ? `{weak_${n}_name} (${details.join(', ')})` : `{weak_${n}_name}`
}

function composeFallback(facts: Facts, lang: Lang, parts: FallbackParts): string {
  const p = PHRASES[lang]
  if (!('total_net' in facts)) return p.noData
  const sentences: string[] = []

  if ('mom_pct' in facts && 'current_month' in facts && 'baseline_month' in facts) sentences.push(p.headlineMom)
  else if ('current_month' in facts) sentences.push(p.headlineUntil)
  else sentences.push(p.headline)

  if (parts.outlets > 0) {
    const listed: string[] = []
    for (let n = 1; n <= parts.outlets && `weak_${n}_name` in facts; n++) listed.push(outletPhrase(facts, n))
    if (listed.length > 0) sentences.push(`${p.outlets}${listed.join(', ')}.`)
  }
  if (parts.brand && 'top_brand' in facts && 'top_brand_share_pct' in facts) sentences.push(p.brand)
  if (parts.regions && 'top_region' in facts && 'top_region_net' in facts) {
    sentences.push('weakest_region' in facts && 'weakest_region_mom_pct' in facts ? p.regions : p.topRegion)
  }
  if (parts.returns && typeof facts.return_net?.value === 'number' && facts.return_net.value < 0) sentences.push(p.returns)
  return sentences.join(' ')
}

/** From richest to leanest; the first one that fits the rules wins, so long outlet names shorten the message instead of breaking it. */
const FALLBACK_LADDER: FallbackParts[] = [
  { outlets: 5, regions: true, brand: true, returns: true },
  { outlets: 5, regions: true, brand: true, returns: false },
  { outlets: 3, regions: true, brand: true, returns: false },
  { outlets: 3, regions: false, brand: true, returns: false },
  { outlets: 3, regions: false, brand: false, returns: false },
  { outlets: 1, regions: false, brand: false, returns: false },
  { outlets: 0, regions: false, brand: false, returns: false },
]

/** Deterministic fallback template (with placeholders) in the given language. Passes validateSummaryTemplate for any facts. */
export function fallbackTemplate(facts: Facts, lang: Lang): string {
  let template = ''
  for (const parts of FALLBACK_LADDER) {
    template = composeFallback(facts, lang, parts)
    if (validateSummaryTemplate(template, facts, lang).ok) return template
  }
  return template
}

// ---------- Telegram ----------

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const TELEGRAM_TEXT = {
  id: { period: 'Periode', outlets: 'Prioritas kunjungan' },
  en: { period: 'Period', outlets: 'Visit first' },
} satisfies Record<Lang, Record<string, string>>

/** Telegram HTML message (parse_mode HTML, escaped, <= 4096 chars): bold title with scope + period, the summary paragraph, numbered top-5 list. */
export function telegramMessage(summary: string, facts: Facts, lang: Lang): string {
  const t = TELEGRAM_TEXT[lang]
  const value = (key: string) => (facts[key] ? renderFact(facts[key], lang) : undefined)

  const period = [value('baseline_month'), value('current_month')].filter(Boolean).join(' – ')
  const header = `<b>Sales Pulse · ${escapeHtml(value('scope_name') ?? 'Indonesia')}</b>` + (period ? `\n${t.period}: ${escapeHtml(period)}` : '')

  const items: string[] = []
  for (let n = 1; n <= 5 && facts[`weak_${n}_name`]; n++) {
    const details = [value(`weak_${n}_branch`), value(`weak_${n}_pct`)].filter(Boolean).join(', ')
    // Cap each name so one absurd value cannot push the summary out of the 4096-character budget.
    const name = value(`weak_${n}_name`)!.slice(0, 100)
    items.push(`${n}. <b>${escapeHtml(name)}</b>${details ? ` (${escapeHtml(details)})` : ''}`)
  }
  const list = items.length > 0 ? `\n\n<b>${t.outlets}</b>\n${items.join('\n')}` : ''

  const build = (body: string) => `${header}\n\n${body}${list}`
  const budget = TELEGRAM_LIMIT - build('').length
  let body = escapeHtml(summary.trim())
  if (body.length > budget) {
    // Cut the raw text, not the escaped one, so an entity like &amp; is never split. One character is kept for "…".
    let used = 0
    let cut = ''
    for (const char of summary.trim()) {
      const escaped = escapeHtml(char)
      if (used + escaped.length > budget - 1) break
      used += escaped.length
      cut += escaped
    }
    body = `${cut.trimEnd()}…`
  }
  return build(body)
}
