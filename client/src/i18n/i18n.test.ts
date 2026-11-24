import { describe, expect, it } from 'vitest'
import i18n, { NAMESPACES, resources } from './index'

/** Flattens nested messages to dotted keys: { a: { b: 'x' } } -> { 'a.b': 'x' }. */
function flatten(messages: object, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) Object.assign(out, flatten(value, path))
    else out[path] = value
  }
  return out
}

const placeholders = (text: string) => [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort()

describe.each(NAMESPACES)('i18n namespace "%s"', (ns) => {
  const id = flatten(resources.id[ns])
  const en = flatten(resources.en[ns])

  it('has the same keys in id and en', () => {
    expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort())
  })

  it('has a non-empty string for every key', () => {
    for (const [lang, messages] of [['id', id], ['en', en]] as const) {
      for (const [key, value] of Object.entries(messages)) {
        expect(typeof value === 'string' && value.trim() !== '', `${lang}:${ns}:${key}`).toBe(true)
      }
    }
  })

  it('uses the same {{placeholders}} in both languages', () => {
    for (const [key, value] of Object.entries(id)) {
      if (typeof value !== 'string' || typeof en[key] !== 'string') continue
      expect(placeholders(value), `${ns}:${key}`).toEqual(placeholders(en[key] as string))
    }
  })
})

describe('i18n runtime', () => {
  it('starts in Indonesian and switches to English', async () => {
    expect(i18n.language).toBe('id')
    expect(i18n.t('actions.settings')).toBe('Pengaturan')
    await i18n.changeLanguage('en')
    expect(i18n.t('actions.settings')).toBe('Settings')
    await i18n.changeLanguage('id')
  })
})
