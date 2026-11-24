import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { formatInt } from '@core/index'
import type { Filters, Lang } from '@core/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { activeFilterCount, ALL_DIMENSIONS, DIMENSIONS, setDateRange, setDimension, type FilterOptions, type PickerDimension } from '../model/filters'
import { DateRangeInline, DateRangePopover, dateRangeLabel } from './DateRangeFilter'
import { OptionList } from './OptionList'

interface FilterBarProps {
  filters: Filters
  onChange: (filters: Filters) => void
  options: FilterOptions
  /** First and last date in the dataset: the date pickers cannot leave this range. */
  bounds: { from: string; to: string }
  lang: Lang
  isPhone: boolean
  /** Rows left after filtering, shown on the phone sheet's close button. */
  rowCount: number
}

/** PRD §6.6 filter bar: one row above the charts on desktop, a bottom sheet behind one button on phones. */
export function FilterBar(props: FilterBarProps) {
  return (
    <div className="flex flex-col gap-3">
      {props.isPhone ? <PhoneFilters {...props} /> : <DesktopFilters {...props} />}
      <FilterChips filters={props.filters} onChange={props.onChange} lang={props.lang} />
    </div>
  )
}

function DesktopFilters({ filters, onChange, options, bounds, lang }: FilterBarProps) {
  const { t } = useTranslation('dashboard')
  return (
    <div role="group" aria-label={t('filters.title')} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
      <DateRangePopover filters={filters} onChange={onChange} bounds={bounds} lang={lang} />
      {DIMENSIONS.filter((dim) => options[dim].length > 0).map((dim) => (
        <DimensionPopover
          key={dim}
          label={t(`filters.dim.${dim}`)}
          options={options[dim]}
          selected={filters[dim] ?? []}
          onChange={(values) => onChange(setDimension(filters, dim, values))}
        />
      ))}
    </div>
  )
}

function DimensionPopover({ label, options, selected, onChange }: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn(selected.length > 0 && 'border-primary text-primary')}>
          {label}
          {selected.length > 0 && <SelectedCount count={selected.length} />}
          <ChevronDown aria-hidden="true" className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <OptionList label={label} options={options} selected={selected} onChange={onChange} />
      </PopoverContent>
    </Popover>
  )
}

function SelectedCount({ count }: { count: number }) {
  const { t } = useTranslation('dashboard')
  return (
    <span className="rounded-sm bg-primary-soft px-1.5 text-xs font-semibold text-primary tabular">
      <span className="sr-only">{t('filters.selectedCount', { count })}</span>
      <span aria-hidden="true">{count}</span>
    </span>
  )
}

function PhoneFilters({ filters, onChange, options, bounds, rowCount, lang }: FilterBarProps) {
  const { t } = useTranslation('dashboard')
  const [open, setOpen] = useState(false)
  const count = activeFilterCount(filters)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal aria-hidden="true" />
            {t('filters.title')}
          </span>
          {count > 0 && <SelectedCount count={count} />}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[90dvh] gap-0 rounded-t-lg">
        <SheetHeader className="border-b pr-14">
          <SheetTitle>{t('filters.title')}</SheetTitle>
          <SheetDescription>{t('filters.sheetDescription')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          <DateRangeInline filters={filters} onChange={onChange} bounds={bounds} lang={lang} />
          {DIMENSIONS.filter((dim) => options[dim].length > 0).map((dim) => (
            <CollapsibleDimension
              key={dim}
              dim={dim}
              options={options[dim]}
              selected={filters[dim] ?? []}
              onChange={(values) => onChange(setDimension(filters, dim, values))}
            />
          ))}
        </div>
        <SheetFooter className="border-t">
          <Button onClick={() => setOpen(false)}>{t('filters.showRows', { count: rowCount, formatted: formatInt(rowCount, lang) })}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function CollapsibleDimension({ dim, options, selected, onChange }: { dim: PickerDimension; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation('dashboard')
  const [open, setOpen] = useState(selected.length > 0)
  const panelId = useId()
  const label = t(`filters.dim.${dim}`)

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
          <span className="inline-flex items-center gap-2">
            {label}
            {selected.length > 0 && <SelectedCount count={selected.length} />}
          </span>
          <ChevronDown aria-hidden="true" className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
      </h3>
      {open && (
        <div id={panelId} className="border-t px-2 py-2">
          <OptionList label={label} options={options} selected={selected} onChange={onChange} />
        </div>
      )}
    </section>
  )
}

/** Active filters as removable chips, plus "clear all". Shown under the bar on every screen size. */
function FilterChips({ filters, onChange, lang }: Pick<FilterBarProps, 'filters' | 'onChange' | 'lang'>) {
  const { t } = useTranslation('dashboard')
  if (activeFilterCount(filters) === 0) return null

  const chips: { key: string; text: string; remove: () => void }[] = []
  if (filters.dateFrom || filters.dateTo) {
    const text = dateRangeLabel(filters, lang, t('filters.allDates'))
    chips.push({ key: 'date', text, remove: () => onChange(setDateRange(filters, undefined, undefined)) })
  }
  for (const dim of ALL_DIMENSIONS) {
    for (const value of filters[dim] ?? []) {
      chips.push({
        key: `${dim}:${value}`,
        text: `${t(`filters.dim.${dim}`)}: ${value}`,
        remove: () => onChange(setDimension(filters, dim, (filters[dim] ?? []).filter((v) => v !== value))),
      })
    }
  }

  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label={t('filters.active')}>
      {chips.map((chip) => (
        <li key={chip.key} className="min-w-0 max-w-full">
          <Button
            variant="secondary"
            size="sm"
            onClick={chip.remove}
            aria-label={t('filters.remove', { filter: chip.text })}
            className="max-w-full"
          >
            <span className="truncate">{chip.text}</span>
            <X aria-hidden="true" />
          </Button>
        </li>
      ))}
      <li>
        <Button variant="link" size="sm" onClick={() => onChange({})}>
          {t('filters.clearAll')}
        </Button>
      </li>
    </ul>
  )
}
