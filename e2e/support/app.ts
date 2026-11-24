// Shared e2e helpers: UI labels from the app's own locale files, PRD golden values, and API shortcuts.
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

export type Lang = 'id' | 'en'
type Ns = 'common' | 'onboarding' | 'dashboard'
export const SAMPLE_CSV = 'data/data.csv'

const cache = new Map<string, unknown>()
function bundle(lang: Lang, ns: Ns): Record<string, unknown> {
  const key = `${lang}/${ns}`
  if (!cache.has(key)) cache.set(key, JSON.parse(readFileSync(`client/src/i18n/locales/${key}.json`, 'utf8')))
  return cache.get(key) as Record<string, unknown>
}

/**
 * Text of an i18n key, e.g. t('id', 'onboarding:llm.test'), with {{vars}} filled in. Reading labels from the locale
 * files keeps the tests about behaviour: a copy change does not break them, a missing key does.
 */
export function t(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const [ns, path] = key.split(':') as [Ns, string]
  let node: unknown = bundle(lang, ns)
  for (const part of path.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`No string at ${lang}:${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, v: string) => String(vars[v] ?? `{{${v}}}`))
}

/** The fixed part of a label before its first {{variable}}, for prefix matching. */
export const prefix = (lang: Lang, key: string) => t(lang, key).split('{{')[0]!
export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------- PRD §8 AC2 ----------

export const GOLDEN = {
  rowsRead: 1891,
  rowsClean: 1888,
  duplicates: 3,
  duplicateRows: [495, 913, 1873],
  returnLines: 1,
  returnNet: -528_000,
  invoices: 824,
  outlets: 52,
  gross: 1_756_320_000,
  discount: 30_354_000,
  net: 1_725_966_000,
  sep: 847_517_400,
  oct: 878_448_600,
  momPct: 3.65,
  regions: {
    Jabodetabek: 495_827_800,
    Sumatera: 340_690_500,
    'Jawa Barat': 310_947_300,
    'Jawa Tengah': 222_881_500,
    'Jawa Timur': 211_378_500,
    Kalimantan: 144_240_400,
  },
  weakest: [
    { id: 'OUT1022', name: 'Toko Bintang', sep: 8_764_300, oct: 3_223_100, mom: -63.2, score: -77.7 },
    { id: 'OUT1045', name: 'Toko Anugerah', sep: 798_000, oct: 360_000, mom: -54.9, score: -69.3 },
    { id: 'OUT1043', name: 'Minimarket Sido Muncul', sep: 9_181_700, oct: 2_873_700, mom: -68.7, score: -68.6 },
    { id: 'OUT1041', name: 'Toko Anugerah', sep: 12_494_900, oct: 5_909_600, mom: -52.7, score: -67.2 },
    { id: 'OUT1048', name: 'Toko Mekar', sep: 5_143_700, oct: 2_473_900, mom: -51.9, score: -66.4 },
  ],
  newOutlet: 'OUT1047',
} as const

/** Full-digit IDR exactly as PRD writes it: "Rp 8.764.300" / "IDR 8,764,300". Written here, not imported from core. */
export const fullIdr = (n: number, lang: Lang) =>
  `${n < 0 ? '-' : ''}${lang === 'id' ? 'Rp' : 'IDR'} ${new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-US').format(Math.abs(n))}`
/** "-63,2%" / "+3.6%". */
export const pct1 = (n: number, lang: Lang) =>
  `${new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(n)}%`

// ---------- page helpers ----------

/** Collects uncaught page errors and console errors; assert it is empty at the end of a test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return errors
}

/** document.scrollingElement.scrollWidth - innerWidth: > 0 means the page scrolls sideways. */
export const horizontalOverflow = (page: Page) =>
  page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollWidth - window.innerWidth)

/** Text that looks like an untranslated key ("dashboard.kpi.title", "onboarding:llm.test") or a raw placeholder. */
export async function untranslatedText(page: Page): Promise<string[]> {
  const text = await page.locator('body').innerText()
  const keyLike = /\b(?:common|onboarding|dashboard)[:.][a-z][\w.]*\b|\{\{\s*\w+\s*\}\}|\{[a-z0-9_]+\}/g
  return [...new Set(text.match(keyLike) ?? [])]
}

/** Chart-library controls (Apex legends, Highcharts credits), checked separately from the app's own controls. */
export const CHART_LIBRARY_CONTROLS = '.apexcharts-legend, .highcharts-credits, .highcharts-container a'

/** Interactive elements smaller than 44x44 CSS px (PRD AC7). `only`/`skip` select a subset by ancestor selector. */
export async function smallTapTargets(page: Page, scope = 'body', opts: { only?: string; skip?: string } = {}): Promise<string[]> {
  return page.locator(scope).evaluate((root, { only, skip }) => {
    const out: string[] = []
    for (const el of root.querySelectorAll<HTMLElement>('button, a[href], [role="button"], [role="checkbox"], [role="radio"], [role="tab"], [role="combobox"], input:not([type=hidden]), select')) {
      if ((only && !el.closest(only)) || (skip && el.closest(skip))) continue
      const r = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || style.visibility === 'hidden' || el.closest('[aria-hidden="true"], .sr-only')) continue
      // A control inside a <label> borrows the label's hit area (radio cards, checkbox rows).
      const hit = el.closest('label')?.getBoundingClientRect() ?? r
      // Half a pixel of slack: rem-based heights land on 43.99 px after layout rounding.
      if (Math.max(r.width, hit.width) < 43.5 || Math.max(r.height, hit.height) < 43.5) {
        out.push(`${el.tagName.toLowerCase()}[${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}] ${Math.round(r.width)}x${Math.round(r.height)}`)
      }
    }
    return out
  }, opts)
}

// ---------- API helpers ----------

export async function pushToken(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/push-token')
  expect(res.ok()).toBe(true)
  return ((await res.json()) as { token: string }).token
}

export async function ingest(request: APIRequestContext, csv: string, query = '', token?: string) {
  return request.post(`/api/ingest${query}`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'text/csv' },
    data: csv,
  })
}

/** Restores the sample as the active dataset, so a test that pushed a variant does not leak into the next one. */
export async function restoreSample(request: APIRequestContext) {
  const res = await ingest(request, readFileSync(SAMPLE_CSV, 'utf8'), '', await pushToken(request))
  expect(res.status()).toBe(200)
}
