// Request-body schemas. Built from the contract pieces in core/schemas.ts; candidates to move there.
import { z } from 'zod'
import { ONBOARDING_STEPS } from '@core/api-types'
import { filtersSchema, langSchema, mappingSchema } from '@core/schemas'

export const languageRequestSchema = z.object({ lang: langSchema })

export const completeStepRequestSchema = z.object({ step: z.enum(ONBOARDING_STEPS) })

export const llmConfigRequestSchema = z.object({
  format: z.enum(['openai', 'anthropic']),
  baseUrl: z.url({ protocol: /^https?$/ }).max(500),
  apiKey: z.string().trim().min(1).max(1000).optional(),
  model: z.string().trim().min(1).max(200),
})

const uploadIdSchema = z.string().min(1).max(100)

export const proposeRequestSchema = z.object({ uploadId: uploadIdSchema })

export const applyRequestSchema = z.object({ uploadId: uploadIdSchema, mapping: mappingSchema })

// Telegram tokens are "<bot id>:<secret>". Validating the shape also keeps "/" or "?" out of the Bot API URL path.
export const botTokenSchema = z.string().trim().regex(/^\d{3,20}:[A-Za-z0-9_-]{3,100}$/)

export const telegramConfigRequestSchema = z.object({
  botToken: z.string().trim().min(1).max(200).optional(),
  // Numeric chat id (negative for groups) or a public @channel username.
  chatId: z.string().trim().regex(/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/),
})

export const summaryRequestSchema = z.object({ filters: filtersSchema, lang: langSchema })

export const telegramSendRequestSchema = summaryRequestSchema

export const ingestQuerySchema = z.object({
  summary: z.enum(['true', 'false']).optional(),
  telegram: z.enum(['true', 'false']).optional(),
  lang: langSchema.optional(),
  region: z.string().trim().min(1).max(200).optional(),
})
