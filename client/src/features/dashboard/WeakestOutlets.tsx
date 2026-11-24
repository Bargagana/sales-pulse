import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatIdr, formatMonth, formatPct, newOutlets, weakestOutlets } from '@core/index'
import type { Lang, Periods, SalesRow, WeakMode, WeakOutlet } from '@core/types'
import { DeltaBadge, EmptyState, Section } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatRatio } from './model/format'

interface WeakestOutletsProps {
  rows: SalesRow[]
  periods: Periods
  lang: Lang
  isPhone: boolean
}

/** PRD §6.4: the 5 outlets to visit first, by decline vs peers (default) or lowest sales vs peers. */
export function WeakestOutlets({ rows, periods, lang, isPhone }: WeakestOutletsProps) {
  const { t } = useTranslation('dashboard')
  const hasBaseline = periods.baseline !== null
  // With one month of data "decline" has nothing to compare, so the page opens on the view that works (PRD §6.4).
  const [chosen, setChosen] = useState<WeakMode | null>(null)
  const mode: WeakMode = chosen ?? (hasBaseline ? 'decline' : 'lowest')

  const outlets = useMemo(() => weakestOutlets(rows, { mode, limit: 5 }), [rows, mode])
  const excluded = useMemo(() => newOutlets(rows), [rows])

  const modeToggle = (
    <ToggleGroup
      type="single"
      variant="outline"
      value={mode}
      onValueChange={(v) => (v === 'decline' || v === 'lowest') && setChosen(v)}
      aria-label={t('weakest.modeLabel')}
    >
      <ToggleGroupItem value="decline" className="data-[state=on]:bg-primary-soft data-[state=on]:text-primary">
        {t('weakest.mode.decline')}
      </ToggleGroupItem>
      <ToggleGroupItem value="lowest" className="data-[state=on]:bg-primary-soft data-[state=on]:text-primary">
        {t('weakest.mode.lowest')}
      </ToggleGroupItem>
    </ToggleGroup>
  )

  return (
    <Section title={t('weakest.title')} description={t(`weakest.definition.${mode}`)} actions={modeToggle}>
      <div className="rounded-lg border bg-card">
        {outlets.length === 0 ? (
          mode === 'decline' && !hasBaseline ? (
            <EmptyState
              title={t('weakest.needsBaseline.title')}
              description={t('weakest.needsBaseline.body')}
              action={
                <Button variant="outline" onClick={() => setChosen('lowest')}>
                  {t('weakest.needsBaseline.action')}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t('weakest.empty.title')} description={t('weakest.empty.body')} />
          )
        ) : isPhone ? (
          <OutletCards outlets={outlets} mode={mode} periods={periods} lang={lang} />
        ) : (
          <OutletTable outlets={outlets} mode={mode} periods={periods} lang={lang} />
        )}
        {mode === 'decline' && excluded.length > 0 && (
          <p className="border-t px-4 py-3 text-sm text-muted-foreground">
            {t('weakest.newExcluded', {
              count: excluded.length,
              outlets: excluded.map((o) => (o.name ? `${o.name} (${o.outletId})` : o.outletId)).join(', '),
            })}
          </p>
        )}
      </div>
    </Section>
  )
}

interface ViewProps {
  outlets: WeakOutlet[]
  mode: WeakMode
  periods: Periods
  lang: Lang
}

function useColumnLabels(periods: Periods, lang: Lang) {
  const { t } = useTranslation('dashboard')
  return {
    baseline: periods.baseline ? formatMonth(periods.baseline, lang) : t('weakest.col.baseline'),
    current: periods.current ? formatMonth(periods.current, lang) : t('weakest.col.current'),
  }
}

function OutletTable({ outlets, mode, periods, lang }: ViewProps) {
  const { t } = useTranslation('dashboard')
  const months = useColumnLabels(periods, lang)
  const idr = (v: number) => formatIdr(v, lang, { compact: false })
  const showBaseline = periods.baseline !== null

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 pl-4">#</TableHead>
          <TableHead>{t('weakest.col.outlet')}</TableHead>
          <TableHead>{t('weakest.col.type')}</TableHead>
          <TableHead>{t('weakest.col.branch')}</TableHead>
          <TableHead>{t('weakest.col.salesman')}</TableHead>
          {showBaseline && <TableHead className="text-right">{months.baseline}</TableHead>}
          <TableHead className="text-right">{months.current}</TableHead>
          {mode === 'decline' ? (
            <>
              <TableHead className="text-right">{t('weakest.col.change')}</TableHead>
              <TableHead>{t('weakest.col.mom')}</TableHead>
              <TableHead className="pr-4 text-right">{t('weakest.col.peerMedian')}</TableHead>
            </>
          ) : (
            <TableHead className="pr-4 text-right">{t('weakest.col.vsPeers')}</TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {outlets.map((o, i) => (
          <TableRow key={o.outletId} data-testid="weak-row">
            <TableCell className="pl-4 text-muted-foreground tabular">{i + 1}</TableCell>
            <TableCell>
              <div className="font-medium">{o.name || o.outletId}</div>
              <div className="text-xs text-muted-foreground">{o.outletId}</div>
            </TableCell>
            <TableCell>{o.outletType}</TableCell>
            <TableCell>{o.branch}</TableCell>
            <TableCell>{o.salesman}</TableCell>
            {showBaseline && <TableCell className="text-right tabular">{idr(o.baseline)}</TableCell>}
            <TableCell className="text-right tabular">{idr(o.current)}</TableCell>
            {mode === 'decline' ? (
              <>
                <TableCell className="text-right tabular">{signedIdr(o.change, lang)}</TableCell>
                <TableCell>
                  <DeltaBadge value={o.momPct} text={formatPct(o.momPct, lang)} />
                </TableCell>
                <TableCell className="pr-4 text-right tabular">{formatPct(o.peerMedianPct, lang)}</TableCell>
              </>
            ) : (
              <TableCell className="pr-4 text-right tabular">{formatRatio(o.score, lang)}</TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function OutletCards({ outlets, mode, periods, lang }: ViewProps) {
  const { t } = useTranslation('dashboard')
  const months = useColumnLabels(periods, lang)
  const idr = (v: number) => formatIdr(v, lang)

  return (
    <ol className="divide-y">
      {outlets.map((o, i) => (
        <li key={o.outletId} data-testid="weak-row" className="flex flex-col gap-2 p-4">
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-muted-foreground tabular">{i + 1}.</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold break-words">{o.name || o.outletId}</p>
              <p className="text-xs text-muted-foreground">
                {[o.outletId, o.outletType, o.branch].filter(Boolean).join(' · ')}
              </p>
            </div>
            {mode === 'decline' && <DeltaBadge value={o.momPct} text={formatPct(o.momPct, lang)} />}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            {periods.baseline && (
              <>
                <dt className="text-muted-foreground">{months.baseline}</dt>
                <dd className="text-right tabular">{idr(o.baseline)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{months.current}</dt>
            <dd className="text-right tabular">{idr(o.current)}</dd>
            {mode === 'decline' ? (
              <>
                <dt className="text-muted-foreground">{t('weakest.col.change')}</dt>
                <dd className="text-right tabular">{signedIdr(o.change, lang, true)}</dd>
                <dt className="text-muted-foreground">{t('weakest.col.peerMedian')}</dt>
                <dd className="text-right tabular">{formatPct(o.peerMedianPct, lang)}</dd>
              </>
            ) : (
              <>
                <dt className="text-muted-foreground">{t('weakest.col.vsPeers')}</dt>
                <dd className="text-right tabular">{formatRatio(o.score, lang)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{t('weakest.col.salesman')}</dt>
            <dd className="text-right">{o.salesman}</dd>
          </dl>
        </li>
      ))}
    </ol>
  )
}

/** "+Rp 1.200.000" / "-Rp 5.541.200": formatIdr signs negatives only, and a change reads better signed both ways. */
function signedIdr(value: number, lang: Lang, compact = false): string {
  const text = formatIdr(value, lang, { compact })
  return value > 0 ? `+${text}` : text
}
