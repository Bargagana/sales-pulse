/**
 * Models wrap JSON in prose or ```json fences despite instructions. Take the first balanced {...} object,
 * tracking strings so braces inside values do not end it early.
 */
export function extractFirstJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in the reply')

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) {
      return JSON.parse(text.slice(start, i + 1))
    }
  }
  throw new Error('The JSON object in the reply is not closed')
}
