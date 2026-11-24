import { beforeAll, describe, expect, it } from 'vitest'
import { outletMonth, readSampleCsv } from './__fixtures__/rows'
import {
  applyFilters,
  buildFacts,
  cleanTable,
  fallbackTemplate,
  heuristicMapping,
  parseCsv,
  renderSummary,
  telegramMessage,
  validateSummaryTemplate,
  type Facts,
  type Lang,
  type SalesRow,
} from './index'

let rows: SalesRow[]
let facts: Facts

beforeAll(() => {
  const raw = parseCsv(readSampleCsv())
  rows = cleanTable(raw, heuristicMapping(raw)).rows
  facts = buildFacts(rows, {})
})

const LANGS: Lang[] = ['id', 'en']
const words = (text: string) => text.split(/\s+/).filter(Boolean).length

describe('buildFacts', () => {
  it('builds exactly the documented keys for the national scope', () => {
    const weakKeys = [1, 2, 3, 4, 5].flatMap((n) => [`weak_${n}_name`, `weak_${n}_pct`, `weak_${n}_branch`])
    expect(Object.keys(facts).sort()).toEqual(
      [
        'scope_name',
        'total_net',
        'mom_pct',
        'current_month',
        'baseline_month',
        'top_region',
        'top_region_net',
        'weakest_region',
        'weakest_region_mom_pct',
        'top_brand',
        'top_brand_share_pct',
        'return_net',
        'weak_count',
        ...weakKeys,
      ].sort(),
    )
    for (const [key, fact] of Object.entries(facts)) {
      expect(key).toMatch(/^[a-z0-9_]+$/)
      expect(fact.description.length).toBeGreaterThan(10)
    }
  })

  it('carries the computed values', () => {
    expect(facts.total_net).toMatchObject({ value: 1_725_966_000, kind: 'idr' })
    expect(facts.mom_pct!.value).toBeCloseTo(3.6496, 3)
    expect(facts.current_month).toMatchObject({ value: '2026-10', kind: 'month' })
    expect(facts.baseline_month!.value).toBe('2026-09')
    expect(facts.top_region).toMatchObject({ value: 'Jabodetabek', kind: 'text' })
    expect(facts.top_region_net!.value).toBe(495_827_800)
    expect(facts.top_brand!.value).toBe('Kacang Dua Kelinci')
    expect(facts.top_brand_share_pct!.value).toBeCloseTo((739_781_900 / 1_725_966_000) * 100, 6)
    expect(facts.return_net!.value).toBe(-528_000)
    expect(facts.weak_count).toMatchObject({ value: 5, kind: 'int' })
    expect(facts.weak_1_name!.value).toBe('Toko Bintang')
    expect(facts.weak_1_pct!.value).toBeCloseTo(-63.23, 1)
    expect(facts.scope_name!.value).toBe('Indonesia')
  })

  it('names the region with the lowest MoM % as weakest_region', () => {
    expect(typeof facts.weakest_region!.value).toBe('string')
    expect(facts.weakest_region_mom_pct!.value as number).toBeLessThan(facts.mom_pct!.value as number)
  })

  it('omits region comparisons for a single-region scope', () => {
    const regional = buildFacts(applyFilters(rows, { regions: ['Jawa Barat'] }), { region: 'Jawa Barat' })
    expect(regional.scope_name!.value).toBe('Jawa Barat')
    expect(regional).not.toHaveProperty('top_region')
    expect(regional).not.toHaveProperty('weakest_region')
    expect(regional).toHaveProperty('weak_1_name')
  })

  it('omits MoM and weak percentages when there is only one month', () => {
    const oneMonth = buildFacts(applyFilters(rows, { dateFrom: '2026-10-01' }), {})
    expect(oneMonth).not.toHaveProperty('mom_pct')
    expect(oneMonth).not.toHaveProperty('baseline_month')
    expect(oneMonth).not.toHaveProperty('weak_1_pct')
    expect(oneMonth).toHaveProperty('weak_1_name')
  })

  it('falls back to the outlet id and skips the branch when those columns are missing', () => {
    const bare = buildFacts([outletMonth('A', 'Warung', '2026-09-10', 100, { outlet_name: '', branch: '' }), outletMonth('A', 'Warung', '2026-10-31', 50, { outlet_name: '', branch: '' })], {})
    expect(bare.weak_1_name!.value).toBe('A')
    expect(bare).not.toHaveProperty('weak_1_branch')
    expect(renderSummary(fallbackTemplate(bare, 'en'), bare, 'en')).toContain('Visit first: A (-50.0%).')
  })

  it('has only the scope for no rows', () => {
    expect(Object.keys(buildFacts([], { region: 'Papua' }))).toEqual(['scope_name'])
  })
})

describe('validateSummaryTemplate', () => {
  const ok = 'Penjualan {total_net} ({mom_pct}). Kunjungi {weak_1_name}.'

  it('accepts a valid template', () => {
    expect(validateSummaryTemplate(ok, facts, 'id')).toEqual({ ok: true, errors: [] })
  })

  it('rejects unknown placeholders', () => {
    const result = validateSummaryTemplate('Sales {total_net} and {profit}.', facts, 'en')
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(['Unknown placeholder {profit}. Use only the listed fact keys.'])
  })

  it('rejects digits outside placeholders', () => {
    const result = validateSummaryTemplate('Top 5 outlets: {weak_1_name}, up 3% from {baseline_month}.', facts, 'en')
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/Digits outside placeholders: 5, 3/)
  })

  it('rejects non-ASCII digits too', () => {
    expect(validateSummaryTemplate('Naik ٣ persen {mom_pct}.', facts, 'id').ok).toBe(false)
  })

  it('rejects line breaks', () => {
    expect(validateSummaryTemplate('{total_net}.\n{mom_pct}.', facts, 'en').errors).toEqual(['Must be a single paragraph without line breaks.'])
  })

  it('ignores a trailing newline', () => {
    expect(validateSummaryTemplate(`${ok}\n`, facts, 'id').ok).toBe(true)
  })

  it('rejects more than 80 words after rendering', () => {
    const long = `${'kata '.repeat(78)}{total_net}`
    // 78 words + "Rp 1,73 miliar" (3 words) = 81.
    expect(validateSummaryTemplate(long, facts, 'id').errors).toEqual(['Too long: 81 words after filling placeholders (max 80).'])
    expect(validateSummaryTemplate(`${'kata '.repeat(77)}{total_net}`, facts, 'id').ok).toBe(true)
  })

  it('rejects empty templates and stray braces', () => {
    expect(validateSummaryTemplate('  ', facts, 'en')).toEqual({ ok: false, errors: ['Template is empty.'] })
    expect(validateSummaryTemplate('Sales {total_net} {oops', facts, 'en').errors).toEqual(['Unbalanced { or } outside a placeholder.'])
  })

  it('reports every failure at once', () => {
    expect(validateSummaryTemplate('{nope} 1\n', facts, 'en').errors).toHaveLength(2)
    expect(validateSummaryTemplate('{nope} 1\nx', facts, 'en').errors).toHaveLength(3)
  })
})

describe('renderSummary', () => {
  it('formats each fact for the language', () => {
    const template = '{scope_name}: {total_net} ({mom_pct}) in {current_month}; {top_brand} {top_brand_share_pct}; {weak_1_name} {weak_1_pct}; {weak_count} outlets.'
    expect(renderSummary(template, facts, 'id')).toBe(
      'Indonesia: Rp 1,73 miliar (+3,6%) in Oktober 2026; Kacang Dua Kelinci 42,9%; Toko Bintang -63,2%; 5 outlets.',
    )
    expect(renderSummary(template, facts, 'en')).toBe(
      'Indonesia: IDR 1.73B (+3.6%) in October 2026; Kacang Dua Kelinci 42.9%; Toko Bintang -63.2%; 5 outlets.',
    )
  })

  it('collapses whitespace and leaves unknown placeholders visible', () => {
    expect(renderSummary('  {total_net}   {unknown} ', facts, 'en')).toBe('IDR 1.73B {unknown}')
  })
})

describe('fallbackTemplate', () => {
  it.each(LANGS)('validates on the sample data (%s) and is action-oriented', (lang) => {
    const template = fallbackTemplate(facts, lang)
    expect(validateSummaryTemplate(template, facts, lang)).toEqual({ ok: true, errors: [] })
    const text = renderSummary(template, facts, lang)
    expect(text).toContain(lang === 'id' ? 'Prioritaskan kunjungan' : 'Visit first')
    for (const n of [1, 2, 3, 4, 5]) expect(template).toContain(`{weak_${n}_name}`)
    expect(words(text)).toBeLessThanOrEqual(80)
  })

  it('reads naturally in both languages', () => {
    expect(renderSummary(fallbackTemplate(facts, 'id'), facts, 'id')).toMatch(/^Penjualan bersih Indonesia Oktober 2026 \+3,6% dibanding September 2026/)
    expect(renderSummary(fallbackTemplate(facts, 'en'), facts, 'en')).toMatch(/^Indonesia net sales for October 2026 are \+3\.6% vs September 2026/)
  })

  const SEP = '2026-09-10'
  const OCT = '2026-10-31'
  const scenarios: [string, Facts][] = [
    ['two weak outlets', buildFacts([outletMonth('A', 'Warung', SEP, 100), outletMonth('A', 'Warung', OCT, 50), outletMonth('B', 'Warung', SEP, 100), outletMonth('B', 'Warung', OCT, 90)], {})],
    ['single month (no MoM, no weak %)', buildFacts([outletMonth('A', 'Warung', OCT, 100)], {})],
    ['no baseline outlets at all', buildFacts([outletMonth('A', 'Warung', '2026-10-01', 100), outletMonth('A', 'Warung', '2026-08-01', 100)], {})],
    ['one region scope', buildFacts([outletMonth('A', 'Warung', SEP, 100), outletMonth('A', 'Warung', OCT, 50)], { region: 'Jawa Barat' })],
    ['no data', buildFacts([], {})],
    ['only scope and total', { scope_name: { value: 'Indonesia', kind: 'text', description: 'd' }, total_net: { value: 10, kind: 'idr', description: 'd' } }],
  ]

  it.each(scenarios.flatMap(([name, f]) => LANGS.map((lang) => [name, lang, f] as const)))('validates with %s (%s)', (_name, lang, f) => {
    const template = fallbackTemplate(f, lang)
    expect(validateSummaryTemplate(template, f, lang)).toEqual({ ok: true, errors: [] })
  })

  it('drops detail instead of breaking the 80-word limit when names are long', () => {
    const longNames: Facts = { ...facts }
    for (const n of [1, 2, 3, 4, 5]) longNames[`weak_${n}_name`] = { value: 'Toko Grosir Serba Ada Sumber Rejeki Makmur Jaya Abadi', kind: 'text', description: 'd' }
    for (const lang of LANGS) {
      const template = fallbackTemplate(longNames, lang)
      expect(validateSummaryTemplate(template, longNames, lang).ok).toBe(true)
      expect(template).toContain('{weak_1_name}')
      expect(template).not.toContain('{weak_5_name}')
    }
  })

  it('mentions returns only when there are some', () => {
    expect(fallbackTemplate(facts, 'en')).toContain('{return_net}')
    expect(fallbackTemplate({ ...facts, return_net: { value: 0, kind: 'idr', description: 'd' } }, 'en')).not.toContain('{return_net}')
  })
})

describe('telegramMessage', () => {
  it('has a bold title with scope and period, the summary and a numbered top-5 list', () => {
    const summary = renderSummary(fallbackTemplate(facts, 'id'), facts, 'id')
    const message = telegramMessage(summary, facts, 'id')
    const lines = message.split('\n')
    expect(lines[0]).toBe('<b>Sales Pulse · Indonesia</b>')
    expect(lines[1]).toBe('Periode: September 2026 – Oktober 2026')
    expect(message).toContain(summary)
    expect(message).toContain('<b>Prioritas kunjungan</b>\n1. <b>Toko Bintang</b> (Semarang, -63,2%)')
    expect(message).toContain('5. <b>Toko Mekar</b> (Banjarmasin, -51,9%)')
    expect(telegramMessage(summary, facts, 'en')).toContain('<b>Visit first</b>')
  })

  it('escapes HTML in the summary and in fact values', () => {
    const tricky: Facts = { ...facts, scope_name: { value: 'R&D <test>', kind: 'text', description: 'd' }, weak_1_name: { value: 'Toko <b>A&B</b>', kind: 'text', description: 'd' } }
    const message = telegramMessage('Sales < target & falling > 5%', tricky, 'en')
    expect(message).toContain('<b>Sales Pulse · R&amp;D &lt;test&gt;</b>')
    expect(message).toContain('Sales &lt; target &amp; falling &gt; 5%')
    expect(message).toContain('<b>Toko &lt;b&gt;A&amp;B&lt;/b&gt;</b>')
  })

  it('stays within 4096 characters by shortening the summary', () => {
    const message = telegramMessage('&'.repeat(5000), facts, 'en')
    expect(message.length).toBeLessThanOrEqual(4096)
    expect(message).toContain('…')
    expect(message).toContain('5. <b>Toko Mekar</b>')
    expect(message).not.toMatch(/&(?!amp;)/)
  })

  it('lists single-month outlets without a %, and omits the list when there are no outlets', () => {
    const singleMonth = telegramMessage('Hello', buildFacts([outletMonth('A', 'Warung', '2026-10-31', 100)], {}), 'en')
    expect(singleMonth).toContain('Period: October 2026')
    expect(singleMonth).toContain('1. <b>Outlet A</b> (Bandung)')
    expect(singleMonth).not.toMatch(/Bandung, /)
    expect(telegramMessage('Hello', { scope_name: facts.scope_name! }, 'en')).toBe('<b>Sales Pulse · Indonesia</b>\n\nHello')
  })
})
