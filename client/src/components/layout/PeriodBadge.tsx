import { useTranslation } from 'react-i18next'
import { CalendarDays } from 'lucide-react'
import type { Lang, Periods } from '@core/types'
import { LOCALE_TAG } from '@/i18n'

// Noon UTC keeps the calendar day the same in every timezone the browser might be in.
const toDate = (isoDay: string) => new Date(`${isoDay}T12:00:00Z`)

export function formatDateRange(from: string, to: string, lang: Lang): string {
  const fmt = new Intl.DateTimeFormat(LOCALE_TAG[lang], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return fmt.formatRange(toDate(from), toDate(to))
}

/** Header badge showing the first and last date in the active dataset. */
export function PeriodBadge({ periods, lang }: { periods: Pick<Periods, 'from' | 'to'> | null | undefined; lang: Lang }) {
  const { t } = useTranslation('common')

  return (
    <p className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground md:text-sm">
      <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t('period.label')}: </span>
      <span className="truncate tabular text-foreground">{periods ? formatDateRange(periods.from, periods.to, lang) : t('period.none')}</span>
    </p>
  )
}
