import { Hono } from 'hono'
import * as core from '@core/index'
import type { ApplyResponse, ProposeResponse, UploadResponse } from '@core/api-types'
import type { RawTable } from '@core/types'
import type { AppContext } from '../context'
import { HttpError, readCsvBody, readJson } from '../http'
import { proposeMapping, respond } from '../propose'
import { applyRequestSchema, proposeRequestSchema } from '../schemas'
import { knownValuesOf } from '../known-values'

/** core.parseCsv throws readable errors for empty or garbled input; those are the client's fault, not ours. */
export function parseCsvOrThrow(text: string): RawTable {
  try {
    return core.parseCsv(text)
  } catch (err) {
    throw new HttpError(400, 'bad_csv', err instanceof Error ? err.message : 'The CSV could not be read')
  }
}

export function datasetRoutes(ctx: AppContext): Hono {
  const r = new Hono()

  r.post('/data/upload', async (c) => {
    const raw = parseCsvOrThrow(await readCsvBody(c))
    const profile = core.profileTable(raw)
    const uploadId = ctx.newId('up')
    ctx.uploads.add(uploadId, raw, profile)
    await ctx.data.markSteps({ data: true })
    return c.json({ uploadId, profile } satisfies UploadResponse)
  })

  r.post('/data/propose', async (c) => {
    const { uploadId } = await readJson(c, proposeRequestSchema)
    const upload = requireUpload(ctx, uploadId)

    const saved = (await ctx.data.getMappings())[core.profileKey(upload.profile)]
    if (saved) {
      return c.json(respond(core.reuseMapping(saved.mapping, upload.raw), 'saved', [{ code: 'mapping_reused' }]) satisfies ProposeResponse)
    }
    return c.json(await proposeMapping(upload.raw, upload.profile, await ctx.savedAdapter({ kind: 'mapping' })))
  })

  r.post('/data/apply', async (c) => {
    const { uploadId, mapping } = await readJson(c, applyRequestSchema)
    const upload = requireUpload(ctx, uploadId)

    const missing = core.missingRequiredColumns(mapping)
    if (missing.length > 0) {
      throw new HttpError(400, 'missing_required_columns', `Map these required columns first: ${missing.join(', ')}`, { missing })
    }
    const dataset = core.cleanTable(upload.raw, mapping, { datasetId: ctx.newId('ds'), createdAt: ctx.now().toISOString() })
    if (dataset.rows.length === 0) {
      throw new HttpError(422, 'no_valid_rows', 'No row could be read with this mapping', { quality: dataset.quality })
    }

    await ctx.activateDataset(dataset)
    await ctx.data.saveMapping(core.profileKey(upload.profile), {
      mapping,
      headers: upload.raw.headers,
      confirmedAt: ctx.now().toISOString(),
      knownValues: knownValuesOf(dataset),
    })
    await ctx.data.markSteps({ mapping: true })
    return c.json({ datasetId: dataset.id, quality: dataset.quality } satisfies ApplyResponse)
  })

  r.get('/dataset', async (c) => c.json(await ctx.requireDataset()))

  return r
}

function requireUpload(ctx: AppContext, uploadId: string) {
  const upload = ctx.uploads.get(uploadId)
  if (!upload) throw new HttpError(404, 'upload_not_found', 'This upload has expired. Please upload the CSV again.')
  return upload
}
