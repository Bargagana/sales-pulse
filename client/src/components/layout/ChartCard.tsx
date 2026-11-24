import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { EmptyState, ErrorState } from './states'

export type ViewStatus = 'ready' | 'loading' | 'empty' | 'error'

const SPAN = {
  1: '',
  2: 'md:col-span-2',
  full: 'col-span-full',
} as const

export interface ChartCardProps {
  title: string
  /** The one question this chart answers, as a short sentence. Shown under the title. */
  question?: string
  /** Small controls for this chart only (mode switch, "show all"). */
  actions?: ReactNode
  status?: ViewStatus
  /** Shown when status is 'empty'. Defaults to the "no sales match these filters" message. */
  empty?: { title?: string; description?: string; action?: ReactNode }
  /** Shown when status is 'error'. */
  error?: { message?: string; onRetry?: () => void }
  /** Plot height in px. Loading, empty and error states reserve the same height, so nothing jumps. */
  height?: number
  /** Columns to span in DashboardGrid. */
  span?: keyof typeof SPAN
  footer?: ReactNode
  className?: string
  children?: ReactNode
}

export function ChartCard({
  title,
  question,
  actions,
  status = 'ready',
  empty,
  error,
  height = 280,
  span = 1,
  footer,
  className,
  children,
}: ChartCardProps) {
  const { t } = useTranslation('common')
  const titleId = useId()

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={status === 'loading'}
      // min-w-0: a grid item defaults to min-width:auto, and a chart's SVG would then push the page sideways.
      className={cn('flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 md:p-5', SPAN[span], className)}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-sm font-semibold text-foreground md:text-base">
            {title}
          </h3>
          {question && <p className="mt-0.5 text-sm text-muted-foreground">{question}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>

      <div className="flex min-w-0 flex-col" style={{ minHeight: height }}>
        {status === 'loading' && (
          <>
            <Skeleton className="w-full" style={{ height }} />
            <span className="sr-only">{t('status.loadingChart')}</span>
          </>
        )}
        {status === 'empty' && (
          <EmptyState
            title={empty?.title ?? t('empty.filteredTitle')}
            description={empty?.description ?? t('empty.filteredBody')}
            action={empty?.action}
            className="flex-1"
          />
        )}
        {status === 'error' && <ErrorState message={error?.message ?? t('error.chart')} onRetry={error?.onRetry} className="flex-1" />}
        {status === 'ready' && children}
      </div>

      {footer && status === 'ready' && <div className="text-xs text-muted-foreground">{footer}</div>}
    </section>
  )
}

interface SectionProps {
  title: string
  description?: string
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

/** A titled group of cards on the page (KPIs, charts, weakest outlets). */
export function Section({ title, description, actions, children, className }: SectionProps) {
  const titleId = useId()

  return (
    <section aria-labelledby={titleId} className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/** The dashboard grid: 1 column on phones, 2 from md (768px), 3 from xl (1280px). */
export function DashboardGrid({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3', className)}>{children}</div>
}
