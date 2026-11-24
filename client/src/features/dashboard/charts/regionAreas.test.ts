import { describe, expect, it } from 'vitest'
import topology from '@highcharts/map-collection/countries/id/id-all.topo.json'
import { BUILTIN_BRANCH_GEO } from '@core/index'
import { assignRegions, decodeProvinces, normaliseName, provinceAt, type BranchTotal, type TopoLike } from './regionAreas'

const shapes = decodeProvinces(topology as unknown as TopoLike)
const geo = BUILTIN_BRANCH_GEO

const owned = (provinceRegion: Record<string, string>, region: string) =>
  Object.entries(provinceRegion)
    .filter(([, r]) => r === region)
    .map(([k]) => k)
    .sort()

describe('decodeProvinces / provinceAt', () => {
  it('decodes every province with lon/lat outlines', () => {
    expect(shapes.length).toBeGreaterThanOrEqual(34)
    const jabar = shapes.find((s) => s.key === 'id-jr')!
    expect(jabar.bbox[0]).toBeGreaterThan(105)
    expect(jabar.bbox[2]).toBeLessThan(109.5)
  })

  it('places sample branches in their provinces, coastal cities included', () => {
    const at = (city: string) => provinceAt(shapes, geo[city]!)
    expect(at('Bandung')).toBe('id-jr')
    expect(at('Tangerang')).toBe('id-bt')
    expect(at('Jakarta Barat')).toBe('id-jk')
    expect(at('Semarang')).toBe('id-jt')
    expect(at('Surabaya')).toBe('id-ji')
    expect(at('Medan')).toBe('id-su')
    expect(at('Balikpapan')).toBe('id-ki')
    expect(at('Banjarmasin')).toBe('id-ks')
  })

  it('returns null far out at sea', () => {
    expect(provinceAt(shapes, { lat: -20, lon: 80 })).toBeNull()
  })
})

describe('assignRegions', () => {
  const sample: BranchTotal[] = [
    { branch: 'Jakarta Barat', region: 'Jabodetabek', net: 300 },
    { branch: 'Tangerang', region: 'Jabodetabek', net: 400 },
    { branch: 'Bekasi', region: 'Jabodetabek', net: 300 },
    { branch: 'Bandung', region: 'Jawa Barat', net: 400 },
    { branch: 'Cirebon', region: 'Jawa Barat', net: 300 },
    { branch: 'Semarang', region: 'Jawa Tengah', net: 200 },
    { branch: 'Surabaya', region: 'Jawa Timur', net: 200 },
    { branch: 'Medan', region: 'Sumatera', net: 300 },
    { branch: 'Palembang', region: 'Sumatera', net: 200 },
    { branch: 'Balikpapan', region: 'Kalimantan', net: 200 },
  ]
  const regions = [...new Set(sample.map((b) => b.region))]

  it('maps the sample regions to provinces: name match, branch location, island group', () => {
    const { provinceRegion, unplaced } = assignRegions(shapes, regions, sample, geo)
    expect(unplaced).toEqual([])
    expect(owned(provinceRegion, 'Jawa Barat')).toEqual(['id-jr'])
    expect(owned(provinceRegion, 'Jawa Tengah')).toEqual(['id-jt'])
    expect(owned(provinceRegion, 'Jawa Timur')).toEqual(['id-ji'])
    expect(owned(provinceRegion, 'Jabodetabek')).toEqual(['id-bt', 'id-jk'])
    expect(owned(provinceRegion, 'Sumatera')).toHaveLength(10)
    expect(owned(provinceRegion, 'Kalimantan')).toEqual(['id-kb', 'id-ki', 'id-ks', 'id-kt', 'id-ku'])
    // No region covers these: they stay grey.
    expect(provinceRegion['id-yo']).toBeUndefined()
    expect(provinceRegion['id-ba']).toBeUndefined()
  })

  it('a province name beats branch locations, and abbreviations count', () => {
    // Bekasi is a Jabodetabek branch, but the "Jabar" region owns the Jawa Barat province by name.
    const branches: BranchTotal[] = [
      { branch: 'Bekasi', region: 'Jabodetabek', net: 1000 },
      { branch: 'Bandung', region: 'Jabar', net: 10 },
    ]
    const { provinceRegion } = assignRegions(shapes, ['Jabodetabek', 'Jabar'], branches, geo)
    expect(provinceRegion['id-jr']).toBe('Jabar')
  })

  it('a province with branches of two regions goes to the one selling more there', () => {
    const branches: BranchTotal[] = [
      { branch: 'Semarang', region: 'Central', net: 100 },
      { branch: 'Solo', region: 'South', net: 300 },
    ]
    expect(assignRegions(shapes, ['Central', 'South'], branches, geo).provinceRegion['id-jt']).toBe('South')
  })

  it('lists a region it cannot place, and finds a label point for each placed one', () => {
    const res = assignRegions(shapes, ['Jawa Timur', 'Online'], [{ branch: 'Surabaya', region: 'Jawa Timur', net: 1 }], geo)
    expect(res.unplaced).toEqual(['Online'])
    const p = res.labelAt['Jawa Timur']!
    expect(p.lon).toBeGreaterThan(111)
    expect(p.lon).toBeLessThan(115)
  })
})

describe('normaliseName', () => {
  it('folds case, punctuation and "&"', () => {
    expect(normaliseName('  JAWA-Barat ')).toBe('jawa barat')
    expect(normaliseName('Bali & Nusa Tenggara')).toBe('bali dan nusa tenggara')
  })
})
