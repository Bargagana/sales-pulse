// Dashboard on the sample data: PRD §8 AC2 numbers in the UI, both languages, the summary and Telegram send, filters
// checked against the independent oracle, phone layout (AC7) and missing translations (§6.10).
import { expect, test, type Page } from '@playwright/test'
import {
  CHART_LIBRARY_CONTROLS,
  GOLDEN,
  fullIdr,
  horizontalOverflow,
  pct1,
  restoreSample,
  smallTapTargets,
  t,
  untranslatedText,
  watchErrors,
  type Lang,
} from './support/app'
import * as oracle from './support/oracle'

const langOf = (project: string): Lang => (project.startsWith('mobile') ? 'en' : 'id')
const other = (lang: Lang): Lang => (lang === 'id' ? 'en' : 'id')

/** PRD §6.5 compact money: "Rp 1,73 miliar" / "IDR 1.73B", "Rp 310,9 juta" / "IDR 310.9M". */
function compactIdr(n: number, lang: Lang): string {
  const abs = Math.abs(n)
  const fmt = (v: number, d: number) => new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-US', { maximumFractionDigits: d }).format(v)
  const unit = abs >= 1e9 ? { size: 1e9, d: 2, id: ' miliar', en: 'B' } : abs >= 1e6 ? { size: 1e6, d: 1, id: ' juta', en: 'M' } : null
  if (!unit) return fullIdr(n, lang)
  return `${n < 0 ? '-' : ''}${lang === 'id' ? 'Rp' : 'IDR'} ${fmt(abs / unit.size, unit.d)}${unit[lang]}`
}

const sample = oracle.clean(oracle.readSampleTable()).rows

async function openDashboard(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('weak-row').first()).toBeVisible()
}

async function switchLanguage(page: Page, to: Lang) {
  // The toggle's items are labelled with each language's own name, the same in both UIs.
  await page.getByRole('banner').getByRole('radio', { name: t(to, `common:language.${to}`) }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', to === 'id' ? /^id/ : /^en/)
}

// ChartCard is a <section aria-labelledby>, i.e. a named region.
const chartCard = (page: Page, lang: Lang, key: string) => page.getByRole('region', { name: t(lang, `dashboard:charts.${key}.title`), exact: true })

async function weakRowTexts(page: Page): Promise<string[]> {
  return page.getByTestId('weak-row').allInnerTexts()
}

test.beforeAll(async ({ request }) => {
  // Each test expects the untouched sample, whatever an earlier run left active.
  await restoreSample(request)
})

test('shows the PRD golden numbers in both languages', async ({ page, isMobile }, testInfo) => {
  const lang = langOf(testInfo.project.name)
  const errors = watchErrors(page)
  await openDashboard(page)

  for (const l of [lang, other(lang)]) {
    if (l !== lang) await switchLanguage(page, l)
    await expect(page.getByText(compactIdr(GOLDEN.net, l), { exact: true }).first()).toBeVisible()
    expect(compactIdr(GOLDEN.net, 'id')).toBe('Rp 1,73 miliar')
    expect(compactIdr(GOLDEN.net, 'en')).toBe('IDR 1.73B')

    // Six regions, not ten spellings, in the region chart.
    const regionChart = chartCard(page, l, 'region')
    for (const region of Object.keys(GOLDEN.regions)) await expect(regionChart.getByText(region, { exact: true })).toBeVisible()
    for (const variant of ['Jabar', 'JAWA BARAT', 'JABODETABEK', 'JAWA TIMUR']) await expect(regionChart.getByText(variant, { exact: true })).toHaveCount(0)

    const rows = await weakRowTexts(page)
    expect(rows).toHaveLength(5)
    GOLDEN.weakest.forEach((w, i) => {
      expect(rows[i], `weakest #${i + 1}`).toContain(w.id)
      expect(rows[i]).toContain(w.name)
      expect(rows[i]).toContain(pct1(w.mom, l))
      // The desktop table shows full amounts; the phone cards use the compact form.
      if (!isMobile) {
        expect(rows[i]).toContain(fullIdr(w.sep, l))
        expect(rows[i]).toContain(fullIdr(w.oct, l))
        expect(rows[i]).toContain(fullIdr(w.oct - w.sep, l))
      }
    })
    await expect(page.getByText(GOLDEN.newOutlet).first()).toBeVisible()
    expect(await untranslatedText(page), `untranslated text in ${l}`).toEqual([])
  }
  // Leave the server in this project's language for the next tests.
  await switchLanguage(page, lang)
  expect(errors).toEqual([])
})

test('summary has no placeholders and the digest is sent to Telegram', async ({ page, request }, testInfo) => {
  const lang = langOf(testInfo.project.name)
  const errors = watchErrors(page)
  await openDashboard(page)

  const preview = page.getByTestId('telegram-preview')
  await expect(preview).toBeVisible()
  const text = await preview.innerText()
  expect(text).not.toMatch(/[{}]/)
  expect(text).toContain(compactIdr(GOLDEN.net, lang))
  expect(text).toContain(pct1(((GOLDEN.oct - GOLDEN.sep) / GOLDEN.sep) * 100, lang))
  expect(text).toContain(GOLDEN.weakest[0].name)

  // Same facts from the API: the paragraph is one paragraph of at most 80 words (PRD §6.5).
  const api = await (await request.post('/api/summary', { data: { filters: {}, lang } })).json()
  expect(api.summary.split(/\s+/).length).toBeLessThanOrEqual(80)
  expect(api.summary).not.toMatch(/\n/)
  expect(api.facts.total_net.value).toBe(GOLDEN.net)
  expect(text).toContain(api.summary)

  await page.getByRole('main').getByRole('button', { name: t(lang, 'dashboard:telegram.send'), exact: true }).click()
  await expect(page.getByText(t(lang, 'dashboard:telegram.sent'))).toBeVisible()
  expect(errors).toEqual([])
})

/** Desktop popover filter: open the dimension, tick the values, close. */
async function pickFilter(page: Page, lang: Lang, dim: string, values: string[]) {
  const bar = page.getByRole('group', { name: t(lang, 'dashboard:filters.title') })
  await bar.getByRole('button', { name: new RegExp(`^${t(lang, `dashboard:filters.dim.${dim}`)}`) }).click()
  const popover = page.getByRole('dialog')
  for (const v of values) await popover.getByLabel(v, { exact: true }).check()
  await page.keyboard.press('Escape')
}

async function expectWeakTableMatchesOracle(page: Page, lang: Lang, rows: oracle.Row[]) {
  const expected = oracle.weakestDecline(rows).outlets
  const shown = await weakRowTexts(page)
  expect(shown.map((s) => /OUT\d+/.exec(s)?.[0])).toEqual(expected.map((o) => o.outletId))
  expected.forEach((o, i) => {
    expect(shown[i]).toContain(fullIdr(o.baseline, lang))
    expect(shown[i]).toContain(fullIdr(o.current, lang))
    expect(shown[i]).toContain(pct1(o.momPct, lang))
    expect(shown[i]).toContain(pct1(o.peerMedianPct, lang))
  })
}

test('filters recompute KPIs and the weakest outlets like the oracle', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'the phone filter sheet is covered in the layout test')
  const lang = langOf(testInfo.project.name)
  const errors = watchErrors(page)
  await openDashboard(page)

  await pickFilter(page, lang, 'regions', ['Jawa Barat'])
  const jabar = oracle.applyFilters(sample, { regions: ['Jawa Barat'] })
  expect(oracle.totals(jabar).net).toBe(GOLDEN.regions['Jawa Barat'])
  await expect(page.getByText(compactIdr(oracle.totals(jabar).net, lang), { exact: true }).first()).toBeVisible()
  await expectWeakTableMatchesOracle(page, lang, jabar)

  await pickFilter(page, lang, 'brands', ['Sukro'])
  const jabarSukro = oracle.applyFilters(sample, { regions: ['Jawa Barat'], brands: ['Sukro'] })
  await expect(page.getByText(compactIdr(oracle.totals(jabarSukro).net, lang), { exact: true }).first()).toBeVisible()
  await expectWeakTableMatchesOracle(page, lang, jabarSukro)
  // Both filters show as removable chips.
  const chips = page.getByRole('list', { name: t(lang, 'dashboard:filters.active') })
  await expect(chips).toContainText('Jawa Barat')
  await expect(chips).toContainText('Sukro')

  // The summary does not regenerate on every click; it says it is out of date instead.
  await expect(page.getByText(t(lang, 'dashboard:summary.stale'))).toBeVisible()

  await chips.getByRole('button', { name: t(lang, 'dashboard:filters.clearAll') }).click()
  await expect(page.getByText(compactIdr(GOLDEN.net, lang), { exact: true }).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('chart clicks cross-filter the rest of the dashboard', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'one viewport is enough for the click wiring')
  const lang = langOf(testInfo.project.name)
  await openDashboard(page)
  // Click the Kalimantan bar label area: Apex bars are SVG paths, so click the path of the last (smallest) bar.
  const bars = chartCard(page, lang, 'region').locator('path.apexcharts-bar-area')
  await expect(bars).toHaveCount(6)
  await bars.nth(5).click()
  const chips = page.getByRole('list', { name: t(lang, 'dashboard:filters.active') })
  await expect(chips).toContainText('Kalimantan')
  const kal = oracle.applyFilters(sample, { regions: ['Kalimantan'] })
  await expect(page.getByText(compactIdr(oracle.totals(kal).net, lang), { exact: true }).first()).toBeVisible()
  await expectWeakTableMatchesOracle(page, lang, kal)
})

async function scrollThrough(page: Page) {
  // Lazy charts (the map) are only laid out once they have been scrolled into view.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 50))
    }
    window.scrollTo(0, 0)
  })
}

test('phone: no sideways scroll, filters in a sheet, tap targets of at least 44 px', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'phone layout only')
  const lang = langOf(testInfo.project.name)
  const errors = watchErrors(page)
  await openDashboard(page)

  await scrollThrough(page)
  await expect(chartCard(page, lang, 'map').locator('svg').first()).toBeVisible()
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  // The app's own controls: header, filters, toggles, chips, summary buttons. Chart legends are checked below.
  expect(await smallTapTargets(page, 'body', { skip: CHART_LIBRARY_CONTROLS }), 'tap targets under 44 px').toEqual([])

  await page.getByRole('button', { name: t(lang, 'dashboard:filters.title') }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: new RegExp(`^${t(lang, 'dashboard:filters.dim.regions')}`) }).click()
  await sheet.getByLabel('Jawa Barat', { exact: true }).check()
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  const jabar = oracle.applyFilters(sample, { regions: ['Jawa Barat'] })
  await sheet.getByRole('button', { name: t(lang, 'dashboard:filters.showRows_other', { formatted: new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-US').format(jabar.length) }) }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByText(compactIdr(oracle.totals(jabar).net, lang), { exact: true }).first()).toBeVisible()
  const shown = await weakRowTexts(page)
  expect(shown.map((s) => /OUT\d+/.exec(s)?.[0])).toEqual(oracle.weakestDecline(jabar).outlets.map((o) => o.outletId))
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  expect(errors).toEqual([])
})

test('phone: chart legends and map links are at least 44 px tall', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'phone layout only')
  // QA-05: the Apex legends are replaced by HTML legends and the map credits are plain text, so nothing in a chart
  // library's own markup is tappable any more.
  const lang = langOf(testInfo.project.name)
  await openDashboard(page)
  await scrollThrough(page)
  await expect(chartCard(page, lang, 'map').locator('svg').first()).toBeVisible()
  expect(await smallTapTargets(page, 'body', { only: CHART_LIBRARY_CONTROLS })).toEqual([])

  for (const [key, items] of [['brand', 8], ['outletType', 4]] as const) {
    const name = t(lang, 'dashboard:charts.legend', { chart: t(lang, `dashboard:charts.${key}.title`) })
    const legend = chartCard(page, lang, key).getByRole('list', { name })
    await expect(legend.getByRole('button'), key).toHaveCount(items)
    const heights = await legend.getByRole('button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
    expect(Math.min(...heights), key).toBeGreaterThanOrEqual(43.5)
  }
})

test('settings dialog has no missing translations in either language', async ({ page }, testInfo) => {
  const lang = langOf(testInfo.project.name)
  await openDashboard(page)
  for (const l of [lang, other(lang)]) {
    if (l !== lang) await switchLanguage(page, l)
    await page.getByRole('banner').getByRole('button', { name: t(l, 'common:actions.settings') }).click()
    const dialog = page.getByRole('dialog')
    for (const tab of ['language', 'llm', 'data', 'telegram', 'credentials']) {
      await dialog.getByRole('tab', { name: t(l, `onboarding:settings.tabs.${tab}`) }).click()
      expect(await untranslatedText(page), `${l} settings tab ${tab}`).toEqual([])
    }
    await dialog.getByRole('button', { name: t(l, 'common:actions.close') }).click()
    await expect(dialog).toHaveCount(0)
  }
  await switchLanguage(page, lang)
})
