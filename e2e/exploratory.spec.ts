// Trying to break onboarding (via Settings, which reopens the same steps) and the dashboard: bad files, network
// failures, double clicks, one-month data, huge values and unicode names.
import { expect, test, type Page } from '@playwright/test'
import { SAMPLE_CSV, ingest, pushToken, restoreSample, t, untranslatedText, watchErrors, type Lang } from './support/app'
import * as oracle from './support/oracle'
import * as variants from './support/variants'

const langOf = (project: string): Lang => (project.startsWith('mobile') ? 'en' : 'id')

test.afterAll(async ({ request }) => {
  await restoreSample(request)
})

async function openSettingsTab(page: Page, lang: Lang, tab: string) {
  await page.goto('/')
  await expect(page.getByTestId('weak-row').first()).toBeVisible()
  await page.getByRole('banner').getByRole('button', { name: t(lang, 'common:actions.settings') }).click()
  await page.getByRole('dialog').getByRole('tab', { name: t(lang, `onboarding:settings.tabs.${tab}`) }).click()
}

test('bad files get a plain-language error and never reach the mapping step', async ({ page }, testInfo) => {
  const lang = langOf(testInfo.project.name)
  const errors = watchErrors(page)
  await openSettingsTab(page, lang, 'data')
  const dialog = page.getByRole('dialog')
  const input = page.locator('input[type=file]')
  const upload = dialog.getByRole('button', { name: t(lang, 'onboarding:data.upload') })

  const cases: { name: string; body: string; message: string }[] = [
    { name: 'empty.csv', body: '', message: t(lang, 'onboarding:errors.data.empty_body') },
    { name: 'headers-only.csv', body: 'date,region,outlet_id,brand,net_sales_idr\n', message: t(lang, 'onboarding:errors.data.bad_csv') },
    { name: 'photo.csv', body: '\u0089PNG\r\n\u001a\n\u0000\u0000IHDR', message: t(lang, 'onboarding:errors.data.bad_csv') },
    { name: 'broken.csv', body: 'a,b\n"unterminated,1\n', message: t(lang, 'onboarding:errors.data.bad_csv') },
  ]
  for (const c of cases) {
    await input.setInputFiles({ name: c.name, mimeType: 'text/csv', buffer: Buffer.from(c.body, 'latin1') })
    await upload.click()
    await expect(dialog.getByRole('alert'), c.name).toContainText(c.message)
    await expect(dialog.getByRole('button', { name: t(lang, 'onboarding:mapping.confirm') })).toHaveCount(0)
  }
  expect(errors.filter((e) => !/status of 400/.test(e))).toEqual([])
})

test('a network failure shows the "server unreachable" message, and a retry succeeds', async ({ page }, testInfo) => {
  const lang = langOf(testInfo.project.name)
  await openSettingsTab(page, lang, 'llm')
  const dialog = page.getByRole('dialog')
  await page.route('**/api/llm/config', (route) => route.abort('connectionrefused'))
  await dialog.getByLabel(t(lang, 'onboarding:llm.apiKey'), { exact: true }).fill('sk-e2e-mock')
  await dialog.getByRole('button', { name: t(lang, 'onboarding:llm.test') }).click()
  await expect(dialog.getByRole('alert')).toContainText(t(lang, 'onboarding:errors.any.serverDown'))

  await page.unroute('**/api/llm/config')
  await dialog.getByRole('button', { name: t(lang, 'onboarding:llm.test') }).click()
  await expect(dialog.getByText(t(lang, 'onboarding:llm.saved', { model: 'mock-model' }))).toBeVisible()
})

test('the app shows a retry screen when the server is down at start', async ({ page }) => {
  let fail = true
  await page.route('**/api/state', (route) => (fail ? route.abort('connectionrefused') : route.continue()))
  await page.goto('/')
  // The language is not known yet, so this screen is in the default language (Indonesian).
  await expect(page.getByText(t('id', 'common:error.appStateTitle'))).toBeVisible()
  fail = false
  await page.getByRole('button', { name: t('id', 'common:actions.retry') }).click()
  await expect(page.getByTestId('weak-row').first()).toBeVisible()
  expect(await untranslatedText(page)).toEqual([])
})

test('double clicks send one Telegram digest and apply a mapping once', async ({ page }, testInfo) => {
  const lang = langOf(testInfo.project.name)
  const calls: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/(telegram\/send|data\/apply)$/.test(r.url())) calls.push(new URL(r.url()).pathname)
  })
  await page.goto('/')
  await expect(page.getByTestId('telegram-preview')).toBeVisible()
  await page.getByRole('main').getByRole('button', { name: t(lang, 'dashboard:telegram.send'), exact: true }).dblclick()
  const toast = page.getByText(t(lang, 'dashboard:telegram.sent')).first()
  await expect(toast).toBeVisible()
  // On a phone the toast covers the header; a pointer resting on it pauses its timer, so move away and let it close.
  await page.mouse.move(10, 700)
  await expect(toast).toBeHidden({ timeout: 10_000 })

  await page.getByRole('banner').getByRole('button', { name: t(lang, 'common:actions.settings') }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: t(lang, 'onboarding:settings.tabs.data') }).click()
  await page.locator('input[type=file]').setInputFiles(SAMPLE_CSV)
  await dialog.getByRole('button', { name: t(lang, 'onboarding:data.upload') }).click()
  await dialog.getByRole('button', { name: t(lang, 'onboarding:mapping.confirm') }).dblclick()
  await expect(dialog.getByText(t(lang, 'onboarding:quality.title'))).toBeVisible()

  expect(calls.filter((c) => c.endsWith('/telegram/send'))).toHaveLength(1)
  expect(calls.filter((c) => c.endsWith('/data/apply'))).toHaveLength(1)
})

test('one month of data: the dashboard opens on "lowest vs peers" and decline explains why it is empty', async ({ page, request }, testInfo) => {
  const lang = langOf(testInfo.project.name)
  const errors = watchErrors(page)
  const table = variants.singleMonth('2026-10')
  expect((await ingest(request, variants.sampleCsv(table), '', await pushToken(request))).status()).toBe(200)
  await page.goto('/')
  const rows = page.getByTestId('weak-row')
  await expect(rows).toHaveCount(5)
  const expected = oracle.weakestLowest(oracle.clean(table).rows).map((o) => o.outletId)
  expect((await rows.allInnerTexts()).map((s) => /OUT\d+/.exec(s)?.[0])).toEqual(expected)

  await page.getByRole('radio', { name: t(lang, 'dashboard:weakest.mode.decline') }).click()
  await expect(page.getByText(t(lang, 'dashboard:weakest.needsBaseline.title'))).toBeVisible()
  await expect(page.getByTestId('telegram-preview')).toBeVisible()
  expect(await page.getByTestId('telegram-preview').innerText()).not.toMatch(/[{}]/)
  expect(errors).toEqual([])
})

test('huge amounts and unicode outlet names render without errors', async ({ page, request }, testInfo) => {
  const lang = langOf(testInfo.project.name)
  const errors = watchErrors(page)
  const net = variants.COL('net_sales_idr')
  const name = variants.COL('outlet_name')
  // Every amount x 1,000 (sample total ~Rp 1,7 triliun) and the weakest outlet renamed with non-Latin text.
  const table = variants.sampleTable().map((c) => {
    const out = c.map((v, i) => (i >= variants.COL('price_per_carton_idr') ? String(Number(v) * 1000) : v))
    if (out[variants.COL('outlet_id')] === 'OUT1022') out[name] = 'Toko Bintang 星 Ñandú 🍜'
    return out
  })
  expect((await ingest(request, variants.sampleCsv(table), '', await pushToken(request))).status()).toBe(200)
  await page.goto('/')
  await expect(page.getByTestId('weak-row').first()).toContainText('Toko Bintang 星 Ñandú 🍜')
  const total = oracle.totals(oracle.clean(table).rows).net
  expect(total).toBe(1_725_966_000_000)
  await expect(page.getByText(lang === 'id' ? 'Rp 1,73 triliun' : 'IDR 1.73T').first()).toBeVisible()
  expect(Number(table[0]![net])).toBe(940_500_000)
  expect(errors).toEqual([])
})
