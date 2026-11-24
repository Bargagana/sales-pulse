import { describe, expect, it } from 'vitest'
import type { OnboardingStep } from '@core/api-types'
import type { DataProfile, Mapping } from '@core/types'
import {
  curlExample,
  duplicateTargets,
  invalidFixes,
  maskToken,
  removeValueFix,
  resumeStep,
  setValueFix,
  valueFixes,
} from './flow'

const completed = (done: OnboardingStep[]): Record<OnboardingStep, boolean> => ({
  language: done.includes('language'),
  llm: done.includes('llm'),
  data: done.includes('data'),
  mapping: done.includes('mapping'),
  quality: done.includes('quality'),
  telegram: done.includes('telegram'),
})

const mapping = (over: Partial<Mapping> = {}): Mapping => ({
  columnMap: { Region: 'region', Brand: 'brand' },
  dateFormat: 'YYYY-MM-DD',
  numberFormat: 'plain',
  valueMap: { region: { Jabar: 'Jawa Barat', 'JAWA BARAT': 'Jawa Barat' } },
  branchGeo: {},
  notes: [],
  ...over,
})

const profile: DataProfile = {
  headers: ['Region', 'Brand'],
  sampleRows: [],
  rowCount: 10,
  distinctValues: {
    Region: [
      { value: 'Jawa Barat', count: 5 },
      { value: 'Jabar', count: 4 },
      { value: 'JAWA BARAT', count: 1 },
    ],
  },
}

describe('resumeStep', () => {
  it('starts at the first incomplete step', () => {
    expect(resumeStep(completed([]), false)).toBe('language')
    expect(resumeStep(completed(['language', 'llm']), false)).toBe('data')
    expect(resumeStep(completed(['language', 'llm', 'data', 'mapping']), false)).toBe('quality')
  })

  it('sends mapping back to data when the upload is no longer in memory', () => {
    expect(resumeStep(completed(['language', 'llm', 'data']), false)).toBe('data')
    expect(resumeStep(completed(['language', 'llm', 'data']), true)).toBe('mapping')
  })
})

describe('value fixes', () => {
  it('takes row counts from the profile, biggest first', () => {
    expect(valueFixes(mapping(), profile)).toEqual([
      { column: 'region', from: 'Jabar', to: 'Jawa Barat', rows: 4 },
      { column: 'region', from: 'JAWA BARAT', to: 'Jawa Barat', rows: 1 },
    ])
  })

  it('adds, edits and removes without touching other columns', () => {
    const added = setValueFix(mapping(), 'brand', 'Kcg 2 Klinci', 'Kacang Dua Kelinci')
    expect(added.valueMap.brand).toEqual({ 'Kcg 2 Klinci': 'Kacang Dua Kelinci' })
    const removed = removeValueFix(added, 'brand', 'Kcg 2 Klinci')
    expect(removed.valueMap.brand).toBeUndefined()
    expect(removed.valueMap.region).toEqual(mapping().valueMap.region)
  })

  it('flags fixes with an empty target', () => {
    expect(invalidFixes(setValueFix(mapping(), 'region', 'Jabar', '  ')).map((f) => f.from)).toEqual(['Jabar'])
  })
})

describe('duplicateTargets', () => {
  it('reports a canonical column chosen for two headers', () => {
    expect(duplicateTargets(mapping({ columnMap: { Region: 'region', Wilayah: 'region', Brand: 'brand' } }))).toEqual([
      'region',
    ])
    expect(duplicateTargets(mapping({ columnMap: { Region: 'region', Extra: null, Other: null } }))).toEqual([])
  })
})

describe('push API helpers', () => {
  it('builds a curl call with the summary flag and the sample file', () => {
    const cmd = curlExample('http://localhost:5173', 'sp_abc')
    expect(cmd).toContain('http://localhost:5173/api/ingest?summary=true')
    expect(cmd).toContain('Authorization: Bearer sp_abc')
    expect(cmd).toContain('--data-binary @data/data.csv')
  })

  it('masks all but the ends of a token', () => {
    const masked = maskToken('sp_0123456789abcdefghij')
    expect(masked.startsWith('sp_01')).toBe(true)
    expect(masked.endsWith('ghij')).toBe(true)
    expect(masked).not.toContain('456789')
  })
})
