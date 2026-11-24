import { Hono } from 'hono'
import * as core from '@core/index'
import type { IngestResponse } from '@core/api-types'
import type { Mapping, MappableColumn, RawTable } from '@core/types'
import type { AppContext } from '../context'
import type { SavedMapping } from '../data-store'
import { HttpError, readCsvBody, zodIssues } from '../http'
import { ingestQuerySchema } from '../schemas'
import { bearerToken, tokensEqual } from '../security'
import { confirmedValues } from '../known-values'
import { generateSummary } from '../summary'
import { parseCsvOrThrow } from './data'

/** Unknown values in these columns would silently create a new region/brand in every total, so they block the push. */
const BLOCKING_COLUMNS: MappableColumn[] = ['region', 'brand']

/**
 * More unreadable rows than this means the file is being misread (a new number or date format), not a few broken
 * lines; replacing the dataset with what is left would publish wrong totals with a 200.
 */
const MAX_UNREADABLE_SHARE = 0.05

/**
 * Mapping for an unattended push, most specific first:
 * 1. the mapping confirmed for exactly this profile (same headers and distinct values),
 * 2. the most recently confirmed mapping whose columnMap covers every header (same export, new rows),
 * 3. the deterministic heuristic.
 * A confirmed mapping keeps its column and value fixes, but dates and numbers are re-detected from this file.
 */
export function pickIngestMapping(raw: RawTable, profileKey: string, saved: Record<string, SavedMapping>): Mapping {
  const confirmed =
    saved[profileKey] ??
    Object.values(saved)
      .filter((entry) => raw.headers.every((h) => Object.hasOwn(entry.mapping.columnMap, h)))
      .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt))[0]
  return confirmed ? core.reuseMapping(confirmed.mapping, raw) : core.heuristicMapping(raw)
}

export function ingestRoutes(ctx: AppContext): Hono {
  const r = new Hono()

  r.post('/ingest', async (c) => {
    // Authenticate before reading the body so an unauthenticated caller cannot make us parse 20 MB.
    const presented = bearerToken(c.req.header('authorization'))
    const { pushToken } = await ctx.creds.load()
    if (!presented || !pushToken || !tokensEqual(presented, pushToken)) {
      throw new HttpError(401, 'unauthorized', 'Missing or invalid push token')
    }

    const query = ingestQuerySchema.safeParse(c.req.query())
    if (!query.success) throw new HttpError(400, 'invalid_query', 'Query parameters are invalid', zodIssues(query.error))
    const { region } = query.data
    const wantsTelegram = query.data.telegram === 'true'
    const wantsSummary = query.data.summary === 'true' || wantsTelegram

    const raw = parseCsvOrThrow(await readCsvBody(c))
    const profile = core.profileTable(raw)
    const profileKey = core.profileKey(profile)
    const saved = await ctx.data.getMappings()
    const mapping = pickIngestMapping(raw, profileKey, saved)

    const missing = core.missingRequiredColumns(mapping)
    if (missing.length > 0) {
      throw new HttpError(400, 'missing_required_columns', `Required columns not found: ${missing.join(', ')}`, { missing })
    }

    const dataset = core.cleanTable(raw, mapping, {
      knownValues: confirmedValues(profileKey, saved, await ctx.data.getDataset()),
      datasetId: ctx.newId('ds'),
      createdAt: ctx.now().toISOString(),
    })

    const blocking = dataset.quality.unmapped.filter((u) => BLOCKING_COLUMNS.includes(u.column))
    if (blocking.length > 0) {
      const list = blocking.map((u) => `${u.column}: ${u.value}`).join(', ')
      throw new HttpError(422, 'unmapped_values', `Unknown values; review the mapping in the app first (${list})`, { unmapped: blocking })
    }
    if (dataset.rows.length === 0) {
      throw new HttpError(422, 'no_valid_rows', 'No row could be read from this CSV', { quality: dataset.quality })
    }
    const unreadableRows = new Set(dataset.quality.unparseable.map((u) => u.row)).size
    if (unreadableRows > dataset.quality.rowsRead * MAX_UNREADABLE_SHARE) {
      throw new HttpError(422, 'unreadable_rows', `${unreadableRows} of ${dataset.quality.rowsRead} rows could not be read; check the date and number formats in the app`, {
        rows: unreadableRows,
        rowsRead: dataset.quality.rowsRead,
        unparseable: dataset.quality.unparseable.slice(0, 20),
      })
    }
    if (region !== undefined && !dataset.rows.some((row) => row.region === region)) {
      const regions = core.breakdown(dataset.rows, 'region').map((b) => b.key)
      throw new HttpError(400, 'unknown_region', `Region "${region}" is not in this data`, { regions })
    }

    await ctx.activateDataset(dataset)
    ctx.log(`Push API loaded ${dataset.rows.length} rows as ${dataset.id}`)

    const periods = core.computePeriods(dataset.rows)
    const response: IngestResponse = {
      datasetId: dataset.id,
      quality: dataset.quality,
      periods,
      kpis: core.computeKpis(dataset.rows),
      // With a single month there is no baseline to decline from, so rank by size vs peers instead (PRD §6.4).
      weakestOutlets: core.weakestOutlets(dataset.rows, { mode: periods.baseline ? 'decline' : 'lowest' }),
    }

    if (wantsSummary) {
      const lang = query.data.lang ?? (await ctx.data.getState()).lang
      const summary = await generateSummary(dataset.rows, region ? { regions: [region] } : {}, lang, (task) => ctx.savedAdapter(task))
      response.summary = summary.summary
      response.summarySource = summary.source

      if (wantsTelegram) {
        const { telegram } = await ctx.creds.load()
        // The dataset is already replaced, so a Telegram failure is reported in the body rather than failing the push.
        response.telegram = telegram
          ? await ctx
              .sendTelegram(telegram.botToken, telegram.chatId, core.telegramMessage(summary.summary, summary.facts, lang))
              .then((result) => ({ sent: result.ok, message: result.message }))
          : { sent: false, message: 'Telegram is not configured' }
      }
    }

    return c.json(response)
  })

  return r
}
