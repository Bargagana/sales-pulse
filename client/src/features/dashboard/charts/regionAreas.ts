// Which provinces on the Indonesia map belong to which sales region. Pure: takes the topology, so it is unit-testable.
//
// Sales regions are not provinces: "Jawa Barat" is one, "Jabodetabek" spans Jakarta, Banten and part of Jawa Barat,
// "Sumatera" is a whole island. Rules, strongest first:
//   1. a province whose name (or common abbreviation) is the region's name;
//   2. a province that holds the region's branches (point-in-polygon on the branch coordinates; when several
//      regions have branches there, the one with the most net sales in it wins);
//   3. a region named after an island group takes that group's provinces not claimed by rules 1-2.
// A province no rule claims stays grey. A region no rule places is listed under the map.

import type { GeoPoint } from '@core/types'

type Island = 'sumatera' | 'jawa' | 'kalimantan' | 'sulawesi' | 'nusa' | 'maluku' | 'papua'

interface Province {
  island: Island
  /** Lower-case spellings people use for the province as a sales region, besides its map name. */
  aliases: string[]
}

/** Keyed by the topology's hc-key. Names on the map are older spellings (Jakarta Raya, Irian Jaya Barat). */
const PROVINCES: Record<string, Province> = {
  'id-ac': { island: 'sumatera', aliases: ['aceh', 'nad', 'nanggroe aceh darussalam'] },
  'id-su': { island: 'sumatera', aliases: ['sumatera utara', 'sumatra utara', 'sumut'] },
  'id-sb': { island: 'sumatera', aliases: ['sumatera barat', 'sumatra barat', 'sumbar'] },
  'id-ri': { island: 'sumatera', aliases: ['riau'] },
  'id-kr': { island: 'sumatera', aliases: ['kepulauan riau', 'kepri'] },
  'id-ja': { island: 'sumatera', aliases: ['jambi'] },
  'id-be': { island: 'sumatera', aliases: ['bengkulu'] },
  'id-sl': { island: 'sumatera', aliases: ['sumatera selatan', 'sumatra selatan', 'sumsel'] },
  'id-bb': { island: 'sumatera', aliases: ['bangka belitung', 'kepulauan bangka belitung', 'babel'] },
  'id-1024': { island: 'sumatera', aliases: ['lampung'] },
  'id-jk': { island: 'jawa', aliases: ['dki jakarta', 'jakarta', 'dki', 'jakarta raya'] },
  'id-bt': { island: 'jawa', aliases: ['banten'] },
  'id-jr': { island: 'jawa', aliases: ['jawa barat', 'jabar', 'west java'] },
  'id-jt': { island: 'jawa', aliases: ['jawa tengah', 'jateng', 'central java'] },
  'id-yo': { island: 'jawa', aliases: ['yogyakarta', 'diy', 'di yogyakarta', 'daerah istimewa yogyakarta', 'jogja', 'jogjakarta'] },
  'id-ji': { island: 'jawa', aliases: ['jawa timur', 'jatim', 'east java'] },
  'id-ba': { island: 'nusa', aliases: ['bali'] },
  'id-nb': { island: 'nusa', aliases: ['nusa tenggara barat', 'ntb'] },
  'id-nt': { island: 'nusa', aliases: ['nusa tenggara timur', 'ntt'] },
  'id-kb': { island: 'kalimantan', aliases: ['kalimantan barat', 'kalbar'] },
  'id-kt': { island: 'kalimantan', aliases: ['kalimantan tengah', 'kalteng'] },
  'id-ks': { island: 'kalimantan', aliases: ['kalimantan selatan', 'kalsel'] },
  'id-ki': { island: 'kalimantan', aliases: ['kalimantan timur', 'kaltim'] },
  'id-ku': { island: 'kalimantan', aliases: ['kalimantan utara', 'kaltara'] },
  'id-sw': { island: 'sulawesi', aliases: ['sulawesi utara', 'sulut'] },
  'id-go': { island: 'sulawesi', aliases: ['gorontalo'] },
  'id-st': { island: 'sulawesi', aliases: ['sulawesi tengah', 'sulteng'] },
  'id-sr': { island: 'sulawesi', aliases: ['sulawesi barat', 'sulbar'] },
  'id-se': { island: 'sulawesi', aliases: ['sulawesi selatan', 'sulsel'] },
  'id-sg': { island: 'sulawesi', aliases: ['sulawesi tenggara', 'sultra'] },
  'id-ma': { island: 'maluku', aliases: ['maluku'] },
  'id-la': { island: 'maluku', aliases: ['maluku utara', 'malut'] },
  'id-pa': { island: 'papua', aliases: ['papua'] },
  'id-ib': { island: 'papua', aliases: ['papua barat', 'irian jaya barat'] },
}

const ISLAND_NAMES: Record<Island, string[]> = {
  sumatera: ['sumatera', 'sumatra', 'pulau sumatera'],
  jawa: ['jawa', 'java', 'pulau jawa'],
  kalimantan: ['kalimantan', 'borneo'],
  sulawesi: ['sulawesi', 'celebes'],
  nusa: ['nusa tenggara', 'bali nusa tenggara', 'bali dan nusa tenggara', 'balinusra', 'bali nusra'],
  maluku: ['maluku', 'kepulauan maluku'],
  papua: ['papua', 'tanah papua'],
}

/** "Jawa  Barat", "JAWA-BARAT", "Bali & Nusa Tenggara" -> "jawa barat", "bali dan nusa tenggara". */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' dan ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

// ---------- topology decoding ----------

export interface TopoLike {
  transform?: { scale: [number, number]; translate: [number, number] }
  arcs: [number, number][][]
  objects: Record<string, { geometries: { type: string; arcs?: unknown; properties?: Record<string, unknown> }[] }>
}

type Ring = [number, number][] // [lon, lat]
export interface ProvinceShape {
  key: string
  name: string
  polygons: Ring[][] // polygon = outer ring + holes
  bbox: [number, number, number, number] // minLon, minLat, maxLon, maxLat
  area: number
}

function decodeArcs(topo: TopoLike): Ring[] {
  const [sx, sy] = topo.transform?.scale ?? [1, 1]
  const [tx, ty] = topo.transform?.translate ?? [0, 0]
  return topo.arcs.map((arc) => {
    let x = 0
    let y = 0
    return arc.map(([dx, dy]) => {
      if (topo.transform) {
        x += dx
        y += dy
        return [x * sx + tx, y * sy + ty] as [number, number]
      }
      return [dx, dy] as [number, number]
    })
  })
}

function ringFromArcs(indices: number[], arcs: Ring[]): Ring {
  const ring: Ring = []
  for (const i of indices) {
    const arc = i >= 0 ? arcs[i] : arcs[~i]?.slice().reverse()
    if (!arc) continue
    // Consecutive arcs share their joining point.
    ring.push(...(ring.length ? arc.slice(1) : arc))
  }
  return ring
}

function ringArea(ring: Ring): number {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j]![0] - ring[i]![0]) * (ring[j]![1] + ring[i]![1])
  return Math.abs(a / 2)
}

export function decodeProvinces(topo: TopoLike): ProvinceShape[] {
  const arcs = decodeArcs(topo)
  const object = Object.values(topo.objects)[0]
  const shapes: ProvinceShape[] = []
  for (const g of object?.geometries ?? []) {
    const key = g.properties?.['hc-key']
    if (typeof key !== 'string') continue
    const raw = (g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []) as number[][][]
    const polygons = raw.map((poly) => poly.map((ringIdx) => ringFromArcs(ringIdx, arcs)))
    const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const poly of polygons)
      for (const [lon, lat] of poly[0] ?? []) {
        bbox[0] = Math.min(bbox[0], lon)
        bbox[1] = Math.min(bbox[1], lat)
        bbox[2] = Math.max(bbox[2], lon)
        bbox[3] = Math.max(bbox[3], lat)
      }
    const area = polygons.reduce((s, poly) => s + ringArea(poly[0] ?? []), 0)
    shapes.push({ key, name: String(g.properties?.name ?? key), polygons, bbox, area })
  }
  return shapes
}

function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function contains(shape: ProvinceShape, p: [number, number]): boolean {
  const [x, y] = p
  if (x < shape.bbox[0] || x > shape.bbox[2] || y < shape.bbox[1] || y > shape.bbox[3]) return false
  return shape.polygons.some((poly) => poly[0] && inRing(p, poly[0]) && !poly.slice(1).some((hole) => inRing(p, hole)))
}

/** The province a point lies in; a coastal city just outside the simplified outline goes to the nearest one (≤ ~55 km). */
export function provinceAt(shapes: ProvinceShape[], point: GeoPoint): string | null {
  const p: [number, number] = [point.lon, point.lat]
  const hit = shapes.find((s) => contains(s, p))
  if (hit) return hit.key
  let best: { key: string; d: number } | null = null
  for (const s of shapes)
    for (const poly of s.polygons)
      for (const [lon, lat] of poly[0] ?? []) {
        const d = (lon - p[0]) ** 2 + (lat - p[1]) ** 2
        if (!best || d < best.d) best = { key: s.key, d }
      }
  return best && best.d <= 0.25 ? best.key : null
}

// ---------- assignment ----------

export interface BranchTotal {
  branch: string
  region: string
  net: number
}

export interface RegionAreas {
  /** hc-key -> region */
  provinceRegion: Record<string, string>
  /** Regions with no province on the map. */
  unplaced: string[]
  /** Where to put each region's label: centre of its provinces, weighted by area. */
  labelAt: Record<string, GeoPoint>
  /** Bounding box of every placed province, for framing the map. */
  bounds: [number, number, number, number] | null
}

export function assignRegions(
  shapes: ProvinceShape[],
  regions: readonly string[],
  branches: readonly BranchTotal[],
  geo: Record<string, GeoPoint>,
): RegionAreas {
  const byKey = new Map(shapes.map((s) => [s.key, s]))
  const provinceRegion: Record<string, string> = {}

  // 1. Name match. If two region spellings match one province (should not happen after cleaning), the first wins.
  for (const region of regions) {
    const n = normaliseName(region)
    for (const [key, prov] of Object.entries(PROVINCES)) {
      if (!byKey.has(key) || provinceRegion[key]) continue
      const mapName = normaliseName(byKey.get(key)!.name)
      if (prov.aliases.includes(n) || mapName === n) provinceRegion[key] = region
    }
  }

  // 2. Branch locations, by net sales per province and region.
  const salesIn = new Map<string, Map<string, number>>()
  for (const b of branches) {
    const point = geo[b.branch]
    if (!point || !regions.includes(b.region)) continue
    const key = provinceAt(shapes, point)
    if (!key) continue
    const m = salesIn.get(key) ?? new Map<string, number>()
    m.set(b.region, (m.get(b.region) ?? 0) + Math.max(0, b.net))
    salesIn.set(key, m)
  }
  for (const [key, m] of salesIn) {
    if (provinceRegion[key]) continue
    const [top] = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    if (top) provinceRegion[key] = top[0]
  }

  // 3. Island-group names fill the rest of their island.
  for (const region of regions) {
    const n = normaliseName(region)
    const island = (Object.keys(ISLAND_NAMES) as Island[]).find((i) => ISLAND_NAMES[i].includes(n))
    if (!island) continue
    for (const [key, prov] of Object.entries(PROVINCES)) {
      if (prov.island === island && byKey.has(key) && !provinceRegion[key]) provinceRegion[key] = region
    }
  }

  const labelAt: Record<string, GeoPoint> = {}
  const acc = new Map<string, { lon: number; lat: number; w: number }>()
  let bounds: [number, number, number, number] | null = null
  for (const [key, region] of Object.entries(provinceRegion)) {
    const s = byKey.get(key)!
    const w = Math.max(s.area, 1e-6)
    const a = acc.get(region) ?? { lon: 0, lat: 0, w: 0 }
    a.lon += ((s.bbox[0] + s.bbox[2]) / 2) * w
    a.lat += ((s.bbox[1] + s.bbox[3]) / 2) * w
    a.w += w
    acc.set(region, a)
    bounds = bounds
      ? [Math.min(bounds[0], s.bbox[0]), Math.min(bounds[1], s.bbox[1]), Math.max(bounds[2], s.bbox[2]), Math.max(bounds[3], s.bbox[3])]
      : [...s.bbox]
  }
  for (const [region, a] of acc) labelAt[region] = { lon: a.lon / a.w, lat: a.lat / a.w }

  return { provinceRegion, unplaced: regions.filter((r) => !acc.has(r)), labelAt, bounds }
}

/** Net sales per branch with its region, from rows. */
export function branchTotals(rows: readonly { branch: string; region: string; net_sales_idr: number }[]): BranchTotal[] {
  const m = new Map<string, BranchTotal>()
  for (const r of rows) {
    const k = `${r.region}\u0000${r.branch}`
    const t = m.get(k) ?? { branch: r.branch, region: r.region, net: 0 }
    t.net += r.net_sales_idr
    m.set(k, t)
  }
  return [...m.values()]
}
