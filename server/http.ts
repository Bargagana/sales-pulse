import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { ApiError } from '@core/api-types'

/** Thrown anywhere in a handler; app.onError turns it into an ApiError body. Messages must never contain secrets. */
export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export function errorBody(code: string, message: string, details?: unknown): ApiError {
  return { error: details === undefined ? { code, message } : { code, message, details } }
}

/** Issue paths and messages only: zod v4 does not copy the rejected input into issues, so secrets cannot leak here. */
export function zodIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON')
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new HttpError(400, 'invalid_body', 'Request body is invalid', zodIssues(parsed.error))
  return parsed.data
}

/** CSV arrives either as a raw body (text/csv, curl --data-binary) or as a multipart "file" field (browser upload). */
export async function readCsvBody(c: Context): Promise<string> {
  const contentType = c.req.header('content-type') ?? ''
  let text: string
  if (contentType.startsWith('multipart/form-data')) {
    let form: Awaited<ReturnType<typeof c.req.parseBody>>
    try {
      form = await c.req.parseBody()
    } catch {
      throw new HttpError(400, 'bad_multipart', 'The multipart body could not be read')
    }
    const file = form['file']
    if (!(file instanceof File)) throw new HttpError(400, 'missing_file', 'Multipart body must contain a "file" field')
    text = await file.text()
  } else {
    text = await c.req.text()
  }
  if (text.trim() === '') throw new HttpError(400, 'empty_body', 'The CSV is empty')
  return text
}
