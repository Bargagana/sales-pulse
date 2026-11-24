import type { GeoPoint } from './types'

/** City-centre coordinates for branch bubbles on the map. Covers every branch in data/data.csv plus other major Indonesian cities. */
export const BUILTIN_BRANCH_GEO: Record<string, GeoPoint> = {
  // Jabodetabek + Banten
  Jakarta: { lat: -6.2088, lon: 106.8456 },
  'Jakarta Barat': { lat: -6.1683, lon: 106.7589 },
  'Jakarta Pusat': { lat: -6.1805, lon: 106.8284 },
  'Jakarta Selatan': { lat: -6.2615, lon: 106.8106 },
  'Jakarta Timur': { lat: -6.225, lon: 106.9004 },
  'Jakarta Utara': { lat: -6.1384, lon: 106.8634 },
  Tangerang: { lat: -6.1783, lon: 106.6319 },
  'Tangerang Selatan': { lat: -6.2886, lon: 106.7179 },
  Bekasi: { lat: -6.2383, lon: 106.9756 },
  Bogor: { lat: -6.5971, lon: 106.806 },
  Depok: { lat: -6.4025, lon: 106.7942 },
  Serang: { lat: -6.12, lon: 106.1503 },
  Cilegon: { lat: -6.0025, lon: 106.0111 },
  // Jawa Barat
  Bandung: { lat: -6.9175, lon: 107.6191 },
  Cirebon: { lat: -6.732, lon: 108.5523 },
  Tasikmalaya: { lat: -7.3274, lon: 108.2207 },
  Sukabumi: { lat: -6.9277, lon: 106.93 },
  Karawang: { lat: -6.3227, lon: 107.3376 },
  // Jawa Tengah + DIY
  Semarang: { lat: -6.9667, lon: 110.4167 },
  Solo: { lat: -7.5755, lon: 110.8243 },
  Surakarta: { lat: -7.5755, lon: 110.8243 },
  Yogyakarta: { lat: -7.7956, lon: 110.3695 },
  Purwokerto: { lat: -7.4245, lon: 109.2396 },
  Tegal: { lat: -6.8694, lon: 109.1402 },
  Pekalongan: { lat: -6.8898, lon: 109.6746 },
  Magelang: { lat: -7.4797, lon: 110.2177 },
  // Jawa Timur
  Surabaya: { lat: -7.2575, lon: 112.7521 },
  Malang: { lat: -7.9666, lon: 112.6326 },
  Sidoarjo: { lat: -7.4478, lon: 112.7183 },
  Kediri: { lat: -7.848, lon: 112.0178 },
  Jember: { lat: -8.1845, lon: 113.6681 },
  Madiun: { lat: -7.6298, lon: 111.5239 },
  // Bali + Nusa Tenggara
  Denpasar: { lat: -8.6705, lon: 115.2126 },
  Mataram: { lat: -8.5833, lon: 116.1167 },
  Kupang: { lat: -10.1772, lon: 123.607 },
  // Sumatera
  Medan: { lat: 3.5952, lon: 98.6722 },
  Palembang: { lat: -2.9761, lon: 104.7754 },
  Padang: { lat: -0.9471, lon: 100.4172 },
  Pekanbaru: { lat: 0.5071, lon: 101.4478 },
  Jambi: { lat: -1.6101, lon: 103.6131 },
  Bengkulu: { lat: -3.7928, lon: 102.2608 },
  'Bandar Lampung': { lat: -5.3971, lon: 105.2668 },
  'Banda Aceh': { lat: 5.5483, lon: 95.3238 },
  Batam: { lat: 1.0456, lon: 104.0305 },
  'Pangkal Pinang': { lat: -2.1291, lon: 106.109 },
  // Kalimantan
  Balikpapan: { lat: -1.2379, lon: 116.8529 },
  Banjarmasin: { lat: -3.3186, lon: 114.5944 },
  Samarinda: { lat: -0.5022, lon: 117.1536 },
  Pontianak: { lat: -0.0263, lon: 109.3425 },
  'Palangka Raya': { lat: -2.2161, lon: 113.9135 },
  Tarakan: { lat: 3.3, lon: 117.6333 },
  // Sulawesi, Maluku, Papua
  Makassar: { lat: -5.1477, lon: 119.4327 },
  Manado: { lat: 1.4748, lon: 124.8421 },
  Palu: { lat: -0.8917, lon: 119.8707 },
  Kendari: { lat: -3.9985, lon: 122.5129 },
  Gorontalo: { lat: 0.5435, lon: 123.0568 },
  Ambon: { lat: -3.6954, lon: 128.1814 },
  Jayapura: { lat: -2.5916, lon: 140.669 },
  Sorong: { lat: -0.8762, lon: 131.2558 },
}

const geoKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

const builtinByKey = new Map(Object.entries(BUILTIN_BRANCH_GEO).map(([name, point]) => [geoKey(name), point]))

/** Built-in coordinates for a branch, matched ignoring case, spaces and punctuation ("JAKARTA-BARAT" finds "Jakarta Barat"). */
export function builtinGeoFor(branch: string): GeoPoint | undefined {
  return builtinByKey.get(geoKey(branch))
}

/** Coordinates for each branch present. A confirmed mapping entry wins over the built-in table; unknown branches are left out. */
export function resolveBranchGeo(branches: Iterable<string>, confirmed: Record<string, GeoPoint>): Record<string, GeoPoint> {
  const out: Record<string, GeoPoint> = {}
  for (const branch of branches) {
    if (!branch) continue
    const point = confirmed[branch] ?? builtinGeoFor(branch)
    if (point) out[branch] = point
  }
  return out
}
