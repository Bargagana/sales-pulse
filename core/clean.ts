// PRD §6.3: applies a confirmed mapping and the cleaning rules, in the order the PRD lists them.
import { resolveBranchGeo } from './geo'
import { fnv1aUpdate, toHex } from './hash'
import {
  CANONICAL_COLUMNS,
  MAPPABLE_COLUMNS,
  NUMERIC_COLUMNS,
  REQUIRED_COLUMNS,
  UNASSIGNED_SALESMAN,
  UNMAPPED,
  type CanonicalColumn,
  type Dataset,
  type MappableColumn,
  type Mapping,
  type QualityReport,
  type RawTable,
  type SalesRow,
} from './types'
import { compareText, Counter } from './util'
import { parseDate, parseNumber } from './values'

type TextRecord = Record<CanonicalColumn, string>
type NumericColumn = (typeof NUMERIC_COLUMNS)[number]

interface Line {
  rowNumber: number // 1-based data row, header excluded
  row: SalesRow
}

const isMappable = (column: string): column is MappableColumn => (MAPPABLE_COLUMNS as readonly string[]).includes(column)
const REQUIRED_TEXT = REQUIRED_COLUMNS.filter((c) => c !== 'date' && c !== 'net_sales_idr')

/** Raw rows within 1 rupiah count as matching: exports round each line to whole rupiah. */
const ARITHMETIC_TOLERANCE = 1

export interface CleanOptions {
  /** Push API: per canonical column, the values the confirmed mapping knows. Anything else becomes UNMAPPED. */
  knownValues?: Partial<Record<string, string[]>>
  datasetId?: string
  createdAt?: string
}

/** Applies mapping deterministically and runs PRD §6.3 cleaning rules in order. Throws if a required column is not mapped. */
export function cleanTable(raw: RawTable, mapping: Mapping, opts: CleanOptions = {}): Dataset {
  const columnIndex = new Map<CanonicalColumn, number>()
  raw.headers.forEach((header, index) => {
    const column = mapping.columnMap[header]
    if (column && !columnIndex.has(column)) columnIndex.set(column, index)
  })
  const notMapped = REQUIRED_COLUMNS.filter((c) => !columnIndex.has(c))
  if (notMapped.length > 0) throw new Error(`Required columns are not mapped: ${notMapped.join(', ')}.`)

  // 1-2. Trim every cell, then apply the confirmed value maps.
  let valuesTrimmed = 0
  const fixes = new Map<string, QualityReport['valuesFixed'][number]>()
  const texts: TextRecord[] = raw.rows.map((cells) => {
    const text = {} as TextRecord
    for (const column of CANONICAL_COLUMNS) {
      const index = columnIndex.get(column)
      const original = index === undefined ? '' : (cells[index] ?? '')
      let value = original.trim()
      if (value !== original) valuesTrimmed++
      const mapped = isMappable(column) ? mapping.valueMap[column]?.[value] : undefined
      if (mapped !== undefined && mapped !== value) {
        const key = `${column}\u0000${value}`
        const fix = fixes.get(key) ?? { column: column as MappableColumn, from: value, to: mapped, count: 0 }
        fix.count++
        fixes.set(key, fix)
        value = mapped
      }
      text[column] = value
    }
    return text
  })

  // 3. Parse numbers and dates. Rows whose required values cannot be read are dropped and listed.
  const unparseable: QualityReport['unparseable'] = []
  let lines: Line[] = []
  texts.forEach((text, i) => {
    const rowNumber = i + 1
    const problems: QualityReport['unparseable'] = []
    const date = parseDate(text.date, mapping.dateFormat)
    if (!date) problems.push({ row: rowNumber, column: 'date', value: text.date })
    for (const column of REQUIRED_TEXT) {
      if (!text[column]) problems.push({ row: rowNumber, column, value: '' })
    }

    const numbers = {} as Record<NumericColumn, number>
    for (const column of NUMERIC_COLUMNS) {
      const value = text[column]
      const parsed = value === '' && column !== 'net_sales_idr' ? 0 : parseNumber(value, mapping.numberFormat)
      if (parsed === null && column === 'net_sales_idr') problems.push({ row: rowNumber, column, value })
      // An unreadable optional number becomes 0; the arithmetic check below then flags the row.
      numbers[column] = parsed ?? 0
    }

    if (problems.length > 0) {
      unparseable.push(...problems)
      return
    }
    lines.push({
      rowNumber,
      row: {
        date: date!,
        invoice_no: text.invoice_no,
        region: text.region,
        branch: text.branch,
        outlet_id: text.outlet_id,
        outlet_name: text.outlet_name,
        outlet_type: text.outlet_type,
        salesman: text.salesman,
        brand: text.brand,
        sku: text.sku,
        ...numbers,
        isReturn: false,
      },
    })
  })

  // 4. Exact duplicates, compared after trimming, mapping and parsing. The first copy is kept.
  const seen = new Set<string>()
  const duplicateRowNumbers: number[] = []
  let contentHash: number | undefined
  lines = lines.filter(({ row, rowNumber }) => {
    const key = JSON.stringify(CANONICAL_COLUMNS.map((c) => row[c]))
    if (seen.has(key)) {
      duplicateRowNumbers.push(rowNumber)
      return false
    }
    seen.add(key)
    contentHash = fnv1aUpdate(key, contentHash)
    return true
  })

  // 5. Returns stay in the data as negative sales.
  let returnLines = 0
  let returnNet = 0
  for (const { row } of lines) {
    row.isReturn = row.qty_carton < 0 || row.invoice_no.toUpperCase().startsWith('RTR')
    if (row.isReturn) {
      returnLines++
      returnNet += row.net_sales_idr
    }
  }

  // 6. Outlet identity is the id. Display name = most frequent name for that id (first seen on a tie).
  const namesById = new Map<string, Counter<string>>()
  for (const { row } of lines) {
    if (!namesById.has(row.outlet_id)) namesById.set(row.outlet_id, new Counter())
    if (row.outlet_name) namesById.get(row.outlet_id)!.add(row.outlet_name)
  }
  const displayName = new Map<string, string>()
  const outletIdsWithNameVariants: QualityReport['outletIdsWithNameVariants'] = []
  const idsByName = new Map<string, string[]>()
  for (const [outletId, names] of namesById) {
    const name = names.mostFrequent() ?? ''
    displayName.set(outletId, name)
    if (names.counts.size > 1) {
      const byFrequency = [...names.counts].sort((a, b) => b[1] - a[1]).map(([n]) => n)
      outletIdsWithNameVariants.push({ outletId, names: byFrequency })
    }
    if (!name) continue
    const ids = idsByName.get(name)
    if (ids) ids.push(outletId)
    else idsByName.set(name, [outletId])
  }
  for (const { row } of lines) row.outlet_name = displayName.get(row.outlet_id) ?? row.outlet_name
  const sharedOutletNames = [...idsByName]
    .filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({ name, outletIds: [...ids].sort(compareText) }))
    .sort((a, b) => compareText(a.name, b.name))
  outletIdsWithNameVariants.sort((a, b) => compareText(a.outletId, b.outletId))

  // 7. Blank salesman. A missing salesman column stays '' (it is listed in missingColumns instead).
  let missingSalesman = 0
  if (columnIndex.has('salesman')) {
    for (const { row } of lines) {
      if (!row.salesman) {
        row.salesman = UNASSIGNED_SALESMAN
        missingSalesman++
      }
    }
  }

  // 8. Arithmetic check only flags: net_sales_idr stays the source of truth.
  const arithmeticMismatches: QualityReport['arithmeticMismatches'] = []
  const canCheckGross = ['qty_carton', 'price_per_carton_idr', 'gross_sales_idr'].every((c) => columnIndex.has(c as CanonicalColumn))
  const canCheckNet = ['gross_sales_idr', 'discount_idr'].every((c) => columnIndex.has(c as CanonicalColumn))
  for (const { row, rowNumber } of lines) {
    if (canCheckGross && Math.abs(row.qty_carton * row.price_per_carton_idr - row.gross_sales_idr) >= ARITHMETIC_TOLERANCE) {
      arithmeticMismatches.push({ row: rowNumber, reason: 'gross' })
    }
    if (canCheckNet && Math.abs(row.gross_sales_idr - row.discount_idr - row.net_sales_idr) >= ARITHMETIC_TOLERANCE) {
      arithmeticMismatches.push({ row: rowNumber, reason: 'net' })
    }
  }

  // 9. Push API: values the confirmed mapping has never seen are parked as UNMAPPED for review.
  const unmappedCounts = new Map<string, QualityReport['unmapped'][number]>()
  for (const [column, known] of Object.entries(opts.knownValues ?? {})) {
    if (!known || !isMappable(column) || !columnIndex.has(column)) continue
    const allowed = new Set(known)
    for (const { row } of lines) {
      const value = row[column]
      if (value === '' || allowed.has(value) || (column === 'salesman' && value === UNASSIGNED_SALESMAN)) continue
      const key = `${column}\u0000${value}`
      const entry = unmappedCounts.get(key) ?? { column, value, count: 0 }
      entry.count++
      unmappedCounts.set(key, entry)
      row[column] = UNMAPPED
    }
  }

  const byColumnThenCount = <T extends { column: string; count: number }>(a: T, b: T) =>
    MAPPABLE_COLUMNS.indexOf(a.column as MappableColumn) - MAPPABLE_COLUMNS.indexOf(b.column as MappableColumn) || b.count - a.count

  const rows = lines.map((l) => l.row)
  const quality: QualityReport = {
    rowsRead: raw.rows.length,
    rowsClean: rows.length,
    duplicatesRemoved: duplicateRowNumbers.length,
    duplicateRowNumbers,
    valuesTrimmed,
    valuesFixed: [...fixes.values()].sort(byColumnThenCount),
    returnLines,
    returnNet,
    sharedOutletNames,
    outletIdsWithNameVariants,
    missingSalesman,
    arithmeticMismatches,
    unmapped: [...unmappedCounts.values()].sort(byColumnThenCount),
    unparseable,
    missingColumns: CANONICAL_COLUMNS.filter((c) => !columnIndex.has(c)),
  }

  return {
    // Ids default to a content hash so the same input always yields the same dataset; the server passes real ones.
    id: opts.datasetId ?? `ds_${toHex(contentHash ?? fnv1aUpdate(''))}`,
    createdAt: opts.createdAt ?? new Date(0).toISOString(),
    rows,
    quality,
    presentColumns: CANONICAL_COLUMNS.filter((c) => columnIndex.has(c)),
    mapping,
    branchGeo: resolveBranchGeo(new Set(rows.map((r) => r.branch)), mapping.branchGeo),
  }
}
