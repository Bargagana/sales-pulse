// Upload -> propose -> apply, summary, Telegram send, push API and SSE, end to end on data/data.csv (PRD §8 AC2 golden values).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApplyResponse, IngestResponse, ProposeResponse, SummaryResponse, UploadResponse } from '@core/api-types'
import { fakeFetch, json, makeTempDir, openAiReply, readSampleCsv, testApp, type RecordedCall } from './test-utils'

const API_KEY = 'sk-test-SECRET-77aa01'
const BOT_TOKEN = '555000111:SECRET_bot-token-QQ'

let dir: string
let cleanup: () => Promise<void>
let csv: string
beforeEach(async () => {
  ;({ dir, cleanup } = await makeTempDir())
  csv ??= await readSampleCsv()
})
afterEach(() => cleanup())

interface ProviderScript {
  mapping?: () => string
  summary?: () => string
}

const systemOf = (call: RecordedCall) => ((call.body as { messages: { content: string }[] }).messages[0]?.content ?? '')

/** One fake for both providers: OpenAI-compatible LLM (routed by system prompt) and the Telegram Bot API. */
function providers(script: ProviderScript = {}) {
  return fakeFetch((call) => {
    if (call.url.startsWith('https://api.telegram.org/')) return json({ ok: true, result: {} })
    const system = systemOf(call)
    if (system.includes('connectivity check')) return openAiReply('{"ok":true}')
    if (system.includes('map messy sales')) return openAiReply(script.mapping?.() ?? '{}')
    return openAiReply(script.summary?.() ?? '{"template":"Net sales {total_net} ({mom_pct}). Visit {weak_1_name} first."}')
  })
}

const llmCalls = (calls: RecordedCall[], marker: string) => calls.filter((c) => !c.url.includes('telegram') && systemOf(c).includes(marker))

async function setup(script: ProviderScript = {}, configure = { llm: true, telegram: true }) {
  const fake = providers(script)
  const t = testApp(dir, { fetch: fake.fetch })
  if (configure.llm) {
    await t.call('POST', '/api/llm/config', { json: { format: 'openai', baseUrl: 'https://llm.example.com/v1', apiKey: API_KEY, model: 'm' } })
  }
  if (configure.telegram) await t.call('POST', '/api/telegram/config', { json: { botToken: BOT_TOKEN, chatId: '42' } })

  const upload = async (body: BodyInit = csv) => (await t.call('POST', '/api/data/upload', { body, headers: { 'content-type': 'text/csv' } })).body as UploadResponse
  const propose = async (uploadId: string) => (await t.call('POST', '/api/data/propose', { json: { uploadId } })).body as ProposeResponse
  const loadSample = async () => {
    const { uploadId } = await upload()
    const { mapping } = await propose(uploadId)
    const res = await t.call('POST', '/api/data/apply', { json: { uploadId, mapping } })
    return res.body as ApplyResponse
  }
  return { ...t, fake, upload, propose, loadSample }
}

describe('upload -> propose -> apply', () => {
  it('cleans data/data.csv to the golden quality numbers and activates it', async () => {
    const t = await setup()
    const { uploadId, profile } = await t.upload()
    expect(profile.rowCount).toBe(1891)
    expect(profile.headers).toHaveLength(15)

    const proposal = await t.propose(uploadId)
    expect(proposal.source).toBe('llm')
    expect(proposal.missingRequired).toEqual([])

    const apply = await t.call('POST', '/api/data/apply', { json: { uploadId, mapping: proposal.mapping } })
    expect(apply.status).toBe(200)
    expect(apply.body.quality).toMatchObject({ rowsRead: 1891, rowsClean: 1888, duplicatesRemoved: 3, returnLines: 1 })

    const state = (await t.call('GET', '/api/state')).body
    expect(state.dataset).toMatchObject({ id: apply.body.datasetId, rowCount: 1888 })
    expect(state.dataset.periods).toMatchObject({ current: '2026-10', baseline: '2026-09' })
    expect(state.completed).toMatchObject({ data: true, mapping: true })
    expect((await t.call('GET', '/api/dataset')).body.rows).toHaveLength(1888)
  })

  it('accepts a multipart upload', async () => {
    const t = await setup()
    const form = new FormData()
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'data.csv')
    const res = await t.call('POST', '/api/data/upload', { body: form })
    expect(res.status).toBe(200)
    expect(res.body.profile.rowCount).toBe(1891)
  })

  it('sends the LLM a profile, never the full rows', async () => {
    const t = await setup()
    const { uploadId } = await t.upload()
    await t.propose(uploadId)
    const [mappingCall] = llmCalls(t.fake.calls, 'map messy sales')
    const prompt = JSON.stringify(mappingCall!.body)
    const lines = csv.trim().split(/\r?\n/)
    // Data rows 6+ are not samples; a full row (all its cells in order) must not appear.
    for (const line of [lines[7]!, lines[500]!, lines.at(-1)!]) {
      expect(prompt).not.toContain(JSON.stringify(line.split(',')))
    }
  })

  it('falls back to the heuristic mapping after one retry when the LLM answers garbage', async () => {
    const t = await setup({ mapping: () => 'I think the columns are fine.' })
    const { uploadId } = await t.upload()
    const proposal = await t.propose(uploadId)
    expect(proposal.source).toBe('heuristic')
    expect(proposal.warnings[0]?.code).toBe('llm_invalid')
    expect(llmCalls(t.fake.calls, 'map messy sales')).toHaveLength(2)
  })

  it('uses the heuristic with a warning when no LLM is configured', async () => {
    const t = await setup({}, { llm: false, telegram: false })
    const { uploadId } = await t.upload()
    const proposal = await t.propose(uploadId)
    expect(proposal.source).toBe('heuristic')
    expect(proposal.warnings).toHaveLength(1)
  })

  it('reuses the confirmed mapping for the same file', async () => {
    const t = await setup()
    await t.loadSample()
    const before = llmCalls(t.fake.calls, 'map messy sales').length
    const { uploadId } = await t.upload()
    const again = await t.propose(uploadId)
    expect(again.source).toBe('saved')
    expect(again.warnings[0]?.code).toBe('mapping_reused')
    expect(llmCalls(t.fake.calls, 'map messy sales')).toHaveLength(before)
  })

  it('rejects a mapping without the required columns and an unknown upload', async () => {
    const t = await setup()
    const { uploadId } = await t.upload()
    const { mapping } = await t.propose(uploadId)
    const columnMap = Object.fromEntries(Object.entries(mapping.columnMap).map(([h, col]) => [h, col === 'net_sales_idr' ? null : col]))
    const res = await t.call('POST', '/api/data/apply', { json: { uploadId, mapping: { ...mapping, columnMap } } })
    expect(res.status).toBe(400)
    expect(res.body.error.details.missing).toEqual(['net_sales_idr'])

    expect((await t.call('POST', '/api/data/propose', { json: { uploadId: 'up_missing' } })).status).toBe(404)
  })

  it('answers 400 for an empty CSV and 413 above 20 MB', async () => {
    const t = await setup({}, { llm: false, telegram: false })
    expect((await t.call('POST', '/api/data/upload', { body: '  ' })).status).toBe(400)
    const huge = 'a'.repeat(21 * 1024 * 1024)
    const res = await t.call('POST', '/api/data/upload', { body: huge, headers: { 'content-type': 'text/csv' } })
    expect(res.status).toBe(413)
  })
})

describe('summary', () => {
  it('uses the LLM template when it validates and substitutes the values', async () => {
    const t = await setup()
    await t.loadSample()
    const res = (await t.call('POST', '/api/summary', { json: { filters: {}, lang: 'en' } })).body as SummaryResponse
    expect(res.source).toBe('llm')
    expect(res.template).toContain('{total_net}')
    expect(res.summary).not.toMatch(/[{}]/)
    expect(res.facts['total_net']?.value).toBe(1725966000)
  })

  it('sends the LLM only keys, kinds and descriptions, never fact values', async () => {
    const t = await setup()
    await t.loadSample()
    await t.call('POST', '/api/summary', { json: { filters: {}, lang: 'id' } })
    const prompt = JSON.stringify(llmCalls(t.fake.calls, 'digests')[0]!.body)
    expect(prompt).toContain('total_net')
    expect(prompt).not.toContain('1725966000')
    expect(prompt).not.toContain('Toko Bintang')
  })

  it('falls back to the deterministic template when the LLM keeps writing digits', async () => {
    const t = await setup({ summary: () => '{"template":"Sales rose 3 percent to {total_net}."}' })
    await t.loadSample()
    const res = (await t.call('POST', '/api/summary', { json: { filters: {}, lang: 'id' } })).body as SummaryResponse
    expect(res.source).toBe('fallback')
    expect(res.warnings).toHaveLength(1)
    const summaryCalls = llmCalls(t.fake.calls, 'digests')
    expect(summaryCalls).toHaveLength(2)
    expect(JSON.stringify(summaryCalls[1]!.body)).toContain('rejected')
  })

  it('scopes to a region when exactly one is filtered', async () => {
    const t = await setup()
    await t.loadSample()
    const res = (await t.call('POST', '/api/summary', { json: { filters: { regions: ['Kalimantan'] }, lang: 'en' } })).body as SummaryResponse
    expect(res.facts['total_net']?.value).toBe(144240400)
  })

  it('404s without a dataset', async () => {
    const t = await setup({}, { llm: false, telegram: false })
    expect((await t.call('POST', '/api/summary', { json: { filters: {}, lang: 'en' } })).status).toBe(404)
  })
})

describe('telegram send', () => {
  it('regenerates the summary server-side and sends HTML', async () => {
    const t = await setup()
    await t.loadSample()
    const res = await t.call('POST', '/api/telegram/send', { json: { filters: {}, lang: 'id' } })
    expect(res.body).toMatchObject({ ok: true })
    const sent = t.fake.calls.filter((c) => c.url.includes('api.telegram.org')).at(-1)!
    expect(sent.body).toMatchObject({ chat_id: '42', parse_mode: 'HTML' })
    expect((sent.body as { text: string }).text.length).toBeLessThanOrEqual(4096)
  })

  it('409s when Telegram is not configured', async () => {
    const t = await setup({}, { llm: true, telegram: false })
    await t.loadSample()
    expect((await t.call('POST', '/api/telegram/send', { json: { filters: {}, lang: 'id' } })).status).toBe(409)
  })
})

describe('push API /api/ingest', () => {
  async function withToken(t: Awaited<ReturnType<typeof setup>>) {
    const token = (await t.call('GET', '/api/push-token')).body.token as string
    const push = (body: BodyInit, query = '', headers: Record<string, string> = {}) =>
      t.call('POST', `/api/ingest${query}`, { body, headers: { authorization: `Bearer ${token}`, 'content-type': 'text/csv', ...headers } })
    return { token, push }
  }

  it('401 without or with a wrong token', async () => {
    const t = await setup({}, { llm: false, telegram: false })
    await withToken(t)
    expect((await t.call('POST', '/api/ingest', { body: csv })).status).toBe(401)
    const wrong = await t.call('POST', '/api/ingest', { body: csv, headers: { authorization: 'Bearer sp_wrong' } })
    expect(wrong.status).toBe(401)
    expect(wrong.body.error.code).toBe('unauthorized')
  })

  it('400 listing the missing required columns', async () => {
    const t = await setup({}, { llm: false, telegram: false })
    const { push } = await withToken(t)
    const res = await push('foo,bar\nx,y\n')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('missing_required_columns')
    expect(res.body.error.details.missing).toEqual(expect.arrayContaining(['date', 'region', 'outlet_id', 'brand', 'net_sales_idr']))
  })

  it('200 on a first push with no dataset yet, returning the golden numbers', async () => {
    const t = await setup({}, { llm: false, telegram: false })
    const { push } = await withToken(t)
    const res = await push(csv)
    expect(res.status).toBe(200)
    const body = res.body as IngestResponse
    expect(body.quality).toMatchObject({ rowsRead: 1891, rowsClean: 1888, duplicatesRemoved: 3, returnLines: 1 })
    expect(body.periods).toMatchObject({ from: '2026-09-01', to: '2026-10-31', current: '2026-10', baseline: '2026-09' })
    expect(body.kpis.netSales).toBe(1725966000)
    expect(body.kpis.momPct).toBeCloseTo(3.65, 2)
    expect(body.weakestOutlets.map((w) => w.outletId)).toEqual(['OUT1022', 'OUT1045', 'OUT1043', 'OUT1041', 'OUT1048'])
    expect(body.summary).toBeUndefined()
    expect((await t.call('GET', '/api/state')).body.dataset.id).toBe(body.datasetId)
  })

  it('200 with summary and Telegram when asked, using the confirmed mapping', async () => {
    const t = await setup()
    await t.loadSample()
    const { push } = await withToken(t)
    const res = await push(csv, '?summary=true&lang=en&region=Jawa%20Barat&telegram=true')
    expect(res.status).toBe(200)
    const body = res.body as IngestResponse
    expect(body.quality.unmapped).toEqual([])
    expect(body.summary).toBeTruthy()
    expect(body.summarySource).toBe('llm')
    expect(body.telegram).toMatchObject({ sent: true })
  })

  it('accepts multipart', async () => {
    const t = await setup({}, { llm: false, telegram: false })
    const { token } = await withToken(t)
    const form = new FormData()
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'data.csv')
    const res = await t.call('POST', '/api/ingest', { body: form, headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
  })

  it('422 for a region the confirmed mapping does not know, and keeps the old dataset', async () => {
    const t = await setup()
    const { datasetId } = await t.loadSample()
    const { push } = await withToken(t)
    const withNewRegion = csv.replace(',Jabodetabek,', ',Bali Nusra,')
    const res = await push(withNewRegion)
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('unmapped_values')
    expect(res.body.error.details.unmapped).toEqual([expect.objectContaining({ column: 'region', value: 'Bali Nusra' })])
    expect((await t.call('GET', '/api/state')).body.dataset.id).toBe(datasetId)
  })

  it('checks a push against the confirmed values, not against whatever the last push left behind', async () => {
    const t = await setup()
    await t.loadSample()
    const { push } = await withToken(t)
    // A variant with a new salesman is accepted (salesman does not block) and marks him Unmapped...
    const variant = await push(csv.replaceAll(',Andi,', ',Zulkifli Baru,'))
    expect(variant.status).toBe(200)
    expect((variant.body as IngestResponse).quality.unmapped).toEqual([expect.objectContaining({ column: 'salesman', value: 'Zulkifli Baru' })])
    // ...and pushing the original file again must not flag "Andi", whom the user confirmed in onboarding.
    const original = await push(csv)
    expect(original.status).toBe(200)
    expect((original.body as IngestResponse).quality.unmapped).toEqual([])
  })

  describe('a later export with the confirmed headers', () => {
    const lines = () => csv.trim().split(/\r?\n/).map((line) => line.split(','))
    const NUMERIC = [10, 11, 12, 13, 14] // qty_carton .. net_sales_idr in data/data.csv
    const thousands = (v: string) => v.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    const write = (rows: string[][], delimiter = ',') => rows.map((cells) => cells.join(delimiter)).join('\n')

    it('re-detects Indonesian thousands and ";" instead of reusing the confirmed number format', async () => {
      const t = await setup()
      await t.loadSample()
      const { push } = await withToken(t)
      const [header, ...rows] = lines()
      const res = await push(write([header!, ...rows.map((cells) => cells.map((v, i) => (NUMERIC.includes(i) ? thousands(v) : v)))], ';'))
      expect(res.status).toBe(200)
      const body = res.body as IngestResponse
      expect(body.quality.unparseable).toEqual([])
      expect(body.kpis.netSales).toBe(1725966000)
    })

    it('re-detects DD/MM/YYYY dates', async () => {
      const t = await setup()
      await t.loadSample()
      const { push } = await withToken(t)
      const [header, ...rows] = lines()
      const res = await push(write([header!, ...rows.map(([date, ...rest]) => [date!.split('-').reverse().join('/'), ...rest])]))
      expect(res.status).toBe(200)
      expect((res.body as IngestResponse).kpis.netSales).toBe(1725966000)
    })

    it('400 listing a required column that was dropped', async () => {
      const t = await setup()
      await t.loadSample()
      const { push } = await withToken(t)
      for (const [index, column] of [[14, 'net_sales_idr'], [2, 'region']] as const) {
        const res = await push(write(lines().map((cells) => cells.filter((_, i) => i !== index))))
        expect(res.status, column).toBe(400)
        expect(res.body.error.code).toBe('missing_required_columns')
        expect(res.body.error.details.missing).toEqual([column])
      }
    })

    it('422 when more than 5% of rows cannot be read, keeping the old dataset', async () => {
      const t = await setup()
      const { datasetId } = await t.loadSample()
      const { push } = await withToken(t)
      const [header, ...rows] = lines()
      const res = await push(write([header!, ...rows.map(([date, ...rest], i) => [i % 10 === 0 ? 'soon' : date!, ...rest])]))
      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('unreadable_rows')
      expect(res.body.error.details).toMatchObject({ rows: 190, rowsRead: 1891 })
      expect(res.body.error.details.unparseable[0]).toEqual({ row: 1, column: 'date', value: 'soon' })
      expect((await t.call('GET', '/api/state')).body.dataset.id).toBe(datasetId)
    })
  })

  it('400 bad_multipart for a malformed multipart body', async () => {
    const t = await setup({}, { llm: false, telegram: false })
    const { push } = await withToken(t)
    const res = await push('--zzz\r\nbroken', '', { 'content-type': 'multipart/form-data; boundary=zzz' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('bad_multipart')
    expect(t.logs.filter((l) => l.startsWith('Unhandled'))).toEqual([])
  })

  it('400 for an unknown region in the query, without replacing the dataset', async () => {
    const t = await setup()
    const { datasetId } = await t.loadSample()
    const { push } = await withToken(t)
    const res = await push(csv, '?summary=true&region=Atlantis')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('unknown_region')
    expect((await t.call('GET', '/api/state')).body.dataset.id).toBe(datasetId)
  })
})

describe('SSE /api/events', () => {
  it('emits a dataset event when a dataset is applied', async () => {
    const t = await setup()
    const res = await t.app.request('/api/events')
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    await reader.read()

    const { datasetId } = await t.loadSample()
    let text = ''
    while (!text.includes('\n\n') || !text.includes('event: dataset')) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value)
    }
    expect(text).toContain('event: dataset')
    expect(text).toContain(JSON.stringify({ datasetId }))
    await reader.cancel()
  })
})

describe('mock mode (SALES_PULSE_LLM_MOCK / SALES_PULSE_TELEGRAM_MOCK)', () => {
  it('runs the whole flow without any network call', async () => {
    const { fetch, calls } = fakeFetch(() => json({}, 500))
    const t = testApp(dir, { fetch, llmMock: true, telegramMock: true })
    await t.call('POST', '/api/llm/config', { json: { format: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'any', model: 'm' } })
    await t.call('POST', '/api/telegram/config', { json: { botToken: '123:mock', chatId: '42' } })

    const { uploadId } = (await t.call('POST', '/api/data/upload', { body: csv })).body as UploadResponse
    const proposal = (await t.call('POST', '/api/data/propose', { json: { uploadId } })).body as ProposeResponse
    expect(proposal).toMatchObject({ source: 'llm', missingRequired: [] })
    expect((await t.call('POST', '/api/data/apply', { json: { uploadId, mapping: proposal.mapping } })).body.quality.rowsClean).toBe(1888)

    const summary = (await t.call('POST', '/api/summary', { json: { filters: {}, lang: 'id' } })).body as SummaryResponse
    expect(summary.source).toBe('llm')
    expect((await t.call('POST', '/api/telegram/send', { json: { filters: {}, lang: 'id' } })).body.ok).toBe(true)
    expect(calls).toHaveLength(0)
  })
})

describe('secrets', () => {
  it('never appear in any response body or log line across the whole flow', async () => {
    const t = await setup()
    await t.loadSample()
    await t.call('GET', '/api/state')
    await t.call('GET', '/api/dataset')
    await t.call('POST', '/api/summary', { json: { filters: {}, lang: 'en' } })
    await t.call('POST', '/api/telegram/send', { json: { filters: {}, lang: 'en' } })
    const token = (await t.call('GET', '/api/push-token')).body.token as string
    await t.call('POST', '/api/ingest?summary=true&telegram=true', { body: csv, headers: { authorization: `Bearer ${token}` } })
    await t.call('POST', '/api/llm/config', { json: { format: 'openai', baseUrl: 'https://llm.example.com/v1', model: 'm' } })

    for (const secret of [API_KEY, BOT_TOKEN]) {
      for (const body of t.bodies) expect(body).not.toContain(secret)
      for (const line of t.logs) expect(line).not.toContain(secret)
    }
  })
})
