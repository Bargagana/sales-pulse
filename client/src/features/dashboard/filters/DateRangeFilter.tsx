import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { enUS } from 'date-fns/locale/en-US'
import { id as idLocale } from 'date-fns/locale/id'
import type { DateRange } from 'react-day-picker'
import type { Filters, Lang } from '@core/types'
import { formatDateRange } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { setDateRange } from '../model/filters'

interface DateRangeFilterProps {
  filters: Filters
  onChange: (filters: Filters) => void
  bounds: { from: string; to: string }
  lang: Lang
}

// The calendar works in local dates; the filters hold calendar days as YYYY-MM-DD. These two convert without
// going through UTC, so a viewer east or west of Greenwich never gets the neighbouring day.
const toLocalDate = (isoDay: string) => {
  const [y, m, d] = isoDay.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}
const toIsoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/**
 * The range calendar, in the app's language (a native date input follows the browser's locale instead, which put
 * "mm/dd/yyyy" in an Indonesian UI). Days outside the dataset are disabled.
 */
function RangeCalendar({ filters, onChange, bounds, lang, months }: DateRangeFilterProps & { months: number }) {
  const first = toLocalDate(bounds.from)
  const last = toLocalDate(bounds.to)
  const selected: DateRange | undefined = filters.dateFrom
    ? { from: toLocalDate(filters.dateFrom), to: filters.dateTo ? toLocalDate(filters.dateTo) : undefined }
    : undefined

  return (
    <Calendar
      mode="range"
      locale={lang === 'id' ? idLocale : enUS}
      numberOfMonths={months}
      // Outside days would show the neighbouring month's selection twice in the two-month view.
      showOutsideDays={false}
      selected={selected}
      onSelect={(range) => onChange(setDateRange(filters, range?.from && toIsoDay(range.from), range?.to && toIsoDay(range.to)))}
      defaultMonth={months > 1 ? first : (selected?.from ?? last)}
      startMonth={first}
      endMonth={last}
      disabled={[{ before: first }, { after: last }]}
      // 44px day cells on touch screens, the shadcn 32px from md up.
      className="mx-auto [--cell-size:--spacing(11)] md:[--cell-size:--spacing(8)]"
    />
  )
}

export function dateRangeLabel(filters: Filters, lang: Lang, allDates: string): string {
  if (filters.dateFrom && filters.dateTo) return formatDateRange(filters.dateFrom, filters.dateTo, lang)
  if (filters.dateFrom) return formatDateRange(filters.dateFrom, filters.dateFrom, lang)
  return allDates
}

/** Desktop: a button in the filter row that opens the calendar. */
export function DateRangePopover(props: DateRangeFilterProps) {
  const { t } = useTranslation('dashboard')
  const active = Boolean(props.filters.dateFrom || props.filters.dateTo)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn(active && 'border-primary text-primary')} aria-label={`${t('filters.date')}: ${dateRangeLabel(props.filters, props.lang, t('filters.allDates'))}`}>
          <CalendarDays aria-hidden="true" />
          <span className="tabular">{dateRangeLabel(props.filters, props.lang, t('filters.allDates'))}</span>
          <ChevronDown aria-hidden="true" className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <RangeCalendar {...props} months={2} />
        {active && (
          <div className="border-t p-2">
            <Button variant="ghost" size="sm" onClick={() => props.onChange(setDateRange(props.filters, undefined, undefined))}>
              {t('filters.allDates')}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Phone sheet: a collapsible section with the calendar inline, one month at a time. */
export function DateRangeInline(props: DateRangeFilterProps) {
  const { t } = useTranslation('dashboard')
  const active = Boolean(props.filters.dateFrom || props.filters.dateTo)
  const [open, setOpen] = useState(active)
  const panelId = useId()

  return (
    <section className="rounded-md border">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          <span>
            {t('filters.date')}: <span className="font-normal text-muted-foreground">{dateRangeLabel(props.filters, props.lang, t('filters.allDates'))}</span>
          </span>
          <ChevronDown aria-hidden="true" className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
      </h3>
      {open && (
        <div id={panelId} className="flex flex-col items-start gap-1 border-t p-2">
          <RangeCalendar {...props} months={1} />
          {active && (
            <Button variant="ghost" size="sm" onClick={() => props.onChange(setDateRange(props.filters, undefined, undefined))}>
              {t('filters.allDates')}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
