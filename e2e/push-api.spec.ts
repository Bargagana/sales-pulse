// PRD §6.7 / AC6: the push API's auth, its success body, its 400/422 errors, and the live dashboard update via SSE.
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { GOLDEN, SAMPLE_CSV, ingest, pushToken, restoreSample, t } from './support/app'
import * as oracle from './support/oracle'
import * as variants from './support/variants'

const sampleCsv = readFileSync(SAMPLE_CSV, 'utf8')
let token = ''

test.beforeAll(async ({ request }) => {
  token = await pushToken(request)
})
test.afterAll(async ({ request }) => {
  await restoreSample(request)
})

test('401 without a token, with a wrong token, or with another auth scheme', async ({ request }) => {
  const before = (await (await request.get('/api/dataset')).json()).id
  for (const authorization of [undefined, 'Bearer wrong-token', `Basic ${token}`, `Bearer ${token}x`]) {
    const res = await request.post('/api/ingest', {
      headers: { 'content-type': 'text/csv', ...(authorization ? { authorization } : {}) },
      data: sampleCsv,
    })
    expect(res.status(), String(authorization)).toBe(401)
    expect((await res.json()).error.code).toBe('unauthorized')
  }
  // A rejected push never replaces the dataset.
  expect((await (await request.get('/api/dataset')).json()).id).toBe(before)
})

test('after a 401 the same keep-alive connection still serves the retry with the right token', async ({ request }) => {
  // QA-02: the 401 goes out before the CSV body is read, so the server closes that connection; a keep-alive client
  // must then retry on a fresh one instead of writing into the leftover body (which ended in ECONNRESET).
  const rejected = await request.post('/api/ingest', { headers: { 'content-type': 'text/csv', authorization: 'Bearer wrong' }, data: sampleCsv })
  expect(rejected.status()).toBe(401)
  const retry = await ingest(request, sampleCsv, '', token)
  expect(retry.status()).toBe(200)
})

test('200 with the token returns the PRD §6.7 body with the golden numbers', async ({ request }) => {
  const res = await ingest(request, sampleCsv, '?summary=true&lang=id&telegram=true', token)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.datasetId).toMatch(/^ds_/)
  expect(body.quality).toMatchObject({ rowsRead: 1891, rowsClean: 1888, duplicatesRemoved: 3, returnLines: 1, unmapped: [] })
  expect(body.quality.valuesFixed.reduce((n: number, f: { count: number }) => n + f.count, 0)).toBe(10)
  expect(body.periods).toMatchObject({ from: '2026-09-01', to: '2026-10-31', current: '2026-10', baseline: '2026-09' })
  expect(body.kpis.netSales).toBe(GOLDEN.net)
  expect(+body.kpis.momPct.toFixed(2)).toBe(GOLDEN.momPct)
  expect(body.weakestOutlets.map((o: { outletId: string; momPct: number; score: number }) => [o.outletId, +o.momPct.toFixed(1), +o.score.toFixed(1)])).toEqual(
    GOLDEN.weakest.map((w) => [w.id, w.mom, w.score]),
  )
  expect(body.summary).toContain('Rp 1,73 miliar')
  expect(body.summary).not.toMatch(/[{}]/)
  expect(body.telegram).toMatchObject({ sent: true })
})

test('multipart upload with a "file" field works like a raw body', async ({ request }) => {
  const res = await request.post('/api/ingest', {
    headers: { authorization: `Bearer ${token}` },
    multipart: { file: { name: 'data.csv', mimeType: 'text/csv', buffer: Buffer.from(sampleCsv) } },
  })
  expect(res.status()).toBe(200)
  expect((await res.json()).kpis.netSales).toBe(GOLDEN.net)
})

test('400 when a required column is missing, listing it (headers otherwise unchanged)', async ({ request }) => {
  // QA-01: the saved mapping still names the dropped header; only headers the file has may count as mapped.
  for (const column of ['net_sales_idr', 'region'] as const) {
    const res = await ingest(request, variants.withoutColumn(column), '', token)
    expect(res.status(), column).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('missing_required_columns')
    expect(body.error.details.missing).toContain(column)
  }
})

test('400 when a required column is missing from an export with new headers', async ({ request }) => {
  const csv = 'Tanggal,Wilayah,Kode Outlet,Merek\n2026-10-01,Jawa Barat,OUT1,Sukro\n'
  const res = await ingest(request, csv, '', token)
  expect(res.status()).toBe(400)
  const body = await res.json()
  expect(body.error.code).toBe('missing_required_columns')
  expect(body.error.details.missing).toEqual(['net_sales_idr'])
})

test('422 when a region is not in any confirmed mapping, listing it', async ({ request }) => {
  const res = await ingest(request, variants.sampleCsv(variants.replaceRegion('Kalimantan', 'Papua')), '', token)
  expect(res.status()).toBe(422)
  const body = await res.json()
  expect(body.error.code).toBe('unmapped_values')
  expect(body.error.details.unmapped).toEqual([expect.objectContaining({ column: 'region', value: 'Papua' })])
})

test('?region= scopes the summary; an unknown region is a 400', async ({ request }) => {
  const scoped = await ingest(request, sampleCsv, `?summary=true&lang=en&region=${encodeURIComponent('Jawa Barat')}`, token)
  expect(scoped.status()).toBe(200)
  const summary = (await scoped.json()).summary as string
  expect(summary).toContain('Jawa Barat')
  // "IDR 310.9M": Jawa Barat's own total, not the national one.
  expect(summary).toContain('IDR 310.9M')
  expect(summary).not.toContain('IDR 1.73B')

  const unknown = await ingest(request, sampleCsv, '?summary=true&region=Papua', token)
  expect(unknown.status()).toBe(400)
  expect((await unknown.json()).error.code).toBe('unknown_region')
})

test('an open dashboard updates without a reload after a push (SSE)', async ({ page, request }) => {
  await page.goto('/')
  const lang = (await (await request.get('/api/state')).json()).lang as 'id' | 'en'
  await expect(page.getByTestId('weak-row')).toHaveCount(5)
  await expect(page.getByText(lang === 'id' ? 'Rp 1,73 miliar' : 'IDR 1.73B').first()).toBeVisible()

  const table = variants.partialCurrentMonth('2026-10-15')
  const expectedNet = oracle.totals(oracle.clean(table).rows).net
  const res = await ingest(request, variants.sampleCsv(table), '', token)
  expect(res.status()).toBe(200)

  await expect(page.getByText(t(lang, 'dashboard:live.updated', { rows: new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-US').format(oracle.clean(table).rows.length) }))).toBeVisible()
  const compact = new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-US', { maximumFractionDigits: 2 }).format(expectedNet / 1e9)
  await expect(page.getByText(lang === 'id' ? `Rp ${compact} miliar` : `IDR ${compact}B`).first()).toBeVisible()
  // The header badge follows the new data: day 1..15 comparison.
  await expect(page.getByText(t(lang, 'dashboard:period.partial', { day: 15 })).first()).toBeVisible()
})
