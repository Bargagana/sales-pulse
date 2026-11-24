import { cn } from '@/lib/utils'

export interface LegendItem {
  key: string
  label: string
  color: string
  /** Value shown after the label, e.g. the share. */
  detail?: string
  /** false for items that are not a filter value, such as the folded "Other" slice. */
  selectable?: boolean
}

interface ChartLegendProps {
  label: string
  items: LegendItem[]
  selected: string[] | undefined
  onSelect: (key: string) => void
  className?: string
}

/**
 * Replaces the ApexCharts legend where a chart needs one. Apex renders 16 px rows whose tap only hides a series, and
 * it inserts a formatted label with innerHTML; this legend is React text, filters like a click on the chart, and
 * gives each item a 44 px target on phones (PRD AC7).
 */
export function ChartLegend({ label, items, selected, onSelect, className }: ChartLegendProps) {
  return (
    <ul aria-label={label} className={cn('flex flex-wrap gap-x-1', className)}>
      {items.map((item) => {
        const content = (
          <>
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-foreground">{item.label}</span>
            {item.detail && <span className="tabular-nums text-muted-foreground">{item.detail}</span>}
          </>
        )
        const layout = 'flex min-h-11 items-center gap-1.5 rounded-md px-2 text-left text-xs md:min-h-8'
        return (
          <li key={item.key}>
            {item.selectable === false ? (
              <span className={layout}>{content}</span>
            ) : (
              <button
                type="button"
                aria-pressed={selected?.includes(item.key) ?? false}
                onClick={() => onSelect(item.key)}
                className={cn(layout, 'outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/70')}
              >
                {content}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
