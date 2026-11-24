import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { deltaTone, type DeltaTone } from '@/theme/colors'

export interface Delta {
  /** Raw change, e.g. MoM % as a number. Its sign picks the arrow; null means there is no baseline. */
  value: number | null
  /** The formatted change, e.g. formatPct(3.65, lang) -> "+3,6%". */
  text?: string
  /** What it is compared with, e.g. "vs Sep 2026". */
  caption?: string
  /** false for metrics where an increase is bad (returns). */
  positiveIsGood?: boolean
}

const TONE_CLASS: Record<DeltaTone, string> = {
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  neutral: 'bg-muted text-muted-foreground',
}

/** Change badge: arrow + signed text + colour, so the direction never depends on colour alone. */
export function DeltaBadge({ value, text, caption, positiveIsGood, className }: Delta & { className?: string }) {
  const { t } = useTranslation('common')

  if (value == null || !Number.isFinite(value)) {
    return <span className={cn('text-xs text-muted-foreground', className)}>{t('delta.noBaseline')}</span>
  }

  const tone = deltaTone(value, { positiveIsGood })
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus
  const direction = value > 0 ? t('delta.up') : value < 0 ? t('delta.down') : t('delta.flat')

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs', className)}>
      <span className={cn('inline-flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 font-semibold tabular', TONE_CLASS[tone])}>
        <Icon className="size-3.5" aria-hidden="true" />
        <span className="sr-only">{direction} </span>
        {text ?? String(value)}
      </span>
      {caption && <span className="text-muted-foreground">{caption}</span>}
    </span>
  )
}

export interface StatCardProps {
  label: string
  /** Preformatted value, e.g. formatIdr(netSales, lang, { compact: true }). */
  value: string
  delta?: Delta
  /** One extra fact, e.g. the full unrounded amount or "1 return line". */
  hint?: string
  /** Sparkline chart (ApexCharts sparkline mode, 40-48px high). */
  sparkline?: ReactNode
  /** The KPI the page leads with gets a larger figure. Use on one card only. */
  primary?: boolean
  loading?: boolean
  className?: string
}

export function StatCard({ label, value, delta, hint, sparkline, primary = false, loading = false, className }: StatCardProps) {
  const { t } = useTranslation('common')

  return (
    <div aria-busy={loading} className={cn('flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4', className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      {loading ? (
        <>
          <Skeleton className={cn('w-3/4', primary ? 'h-9' : 'h-7')} />
          <Skeleton className="h-4 w-1/2" />
          <span className="sr-only">{t('status.loading')}</span>
        </>
      ) : (
        <>
          <p
            className={cn(
              'tabular leading-tight font-semibold tracking-tight break-words text-foreground',
              primary ? 'text-3xl md:text-4xl' : 'text-2xl',
            )}
          >
            {value}
          </p>
          {delta && <DeltaBadge {...delta} />}
          {hint && <p className="text-xs text-muted-foreground tabular">{hint}</p>}
          {sparkline && <div className="-mx-1 mt-auto h-12 min-w-0">{sparkline}</div>}
        </>
      )}
    </div>
  )
}
