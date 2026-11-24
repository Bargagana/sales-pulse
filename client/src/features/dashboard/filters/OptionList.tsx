import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface OptionListProps {
  /** Dimension name, used for the search field's accessible name. */
  label: string
  options: readonly string[]
  selected: readonly string[]
  onChange: (values: string[]) => void
}

/** Searchable checkbox list: the body of every multi-select, in the desktop popover and in the phone sheet. */
export function OptionList({ label, options, selected, onChange }: OptionListProps) {
  const { t } = useTranslation('dashboard')
  const [query, setQuery] = useState('')
  const baseId = useId()

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options
  }, [options, query])

  const toggle = (value: string, checked: boolean) =>
    onChange(checked ? [...selected, value] : selected.filter((v) => v !== value))

  return (
    <div className="flex flex-col gap-2">
      {/* Short lists (regions, outlet types) fit without searching; the field would only push them down. */}
      {options.length > 7 && (
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('filters.searchPlaceholder')}
          aria-label={t('filters.search', { dimension: label })}
        />
      )}
      <ul className="-mx-1 max-h-64 overflow-y-auto" aria-label={label}>
        {visible.map((option, i) => {
          const id = `${baseId}-${i}`
          return (
            <li key={option}>
              <label
                htmlFor={id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent md:min-h-9"
              >
                <Checkbox id={id} checked={selected.includes(option)} onCheckedChange={(c) => toggle(option, c === true)} />
                <span className="min-w-0 flex-1 break-words">{option}</span>
              </label>
            </li>
          )
        })}
        {visible.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">{t('filters.noMatch')}</li>}
      </ul>
      {selected.length > 0 && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => onChange([])}>
          {t('filters.clearDimension', { count: selected.length })}
        </Button>
      )}
    </div>
  )
}
