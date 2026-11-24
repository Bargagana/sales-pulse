// zod schemas for untrusted input (LLM output, request bodies). CONTRACT.
import { z } from 'zod'
import { CANONICAL_COLUMNS, MAPPABLE_COLUMNS } from './types'

export const canonicalColumnSchema = z.enum(CANONICAL_COLUMNS)

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
})

const valueMapSchema = z.partialRecord(z.enum(MAPPABLE_COLUMNS), z.record(z.string(), z.string().min(1).max(200)))

/** Full mapping (used for ApplyRequest bodies). */
export const mappingSchema = z.object({
  columnMap: z.record(z.string(), canonicalColumnSchema.nullable()),
  dateFormat: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'MM/DD/YYYY']),
  numberFormat: z.enum(['plain', 'id', 'en']),
  valueMap: valueMapSchema,
  branchGeo: z.record(z.string(), geoPointSchema),
  notes: z.array(z.string().max(500)).max(50),
})

/** What the LLM must return. Every field optional so a partial answer can be merged over the heuristic mapping. */
export const llmMappingProposalSchema = mappingSchema.partial()

export const langSchema = z.enum(['id', 'en'])

export const filtersSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  regions: z.array(z.string()).optional(),
  branches: z.array(z.string()).optional(),
  brands: z.array(z.string()).optional(),
  outletTypes: z.array(z.string()).optional(),
  salesmen: z.array(z.string()).optional(),
  skus: z.array(z.string()).optional(),
  outletIds: z.array(z.string()).optional(),
})

/** LLM summary output: one template string with {placeholders}. */
export const llmSummarySchema = z.object({ template: z.string().min(1).max(2000) })
