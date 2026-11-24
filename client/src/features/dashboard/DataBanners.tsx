import { useTranslation } from 'react-i18next'
import { ClipboardList, TriangleAlert } from 'lucide-react'
import { formatIdr, formatInt } from '@core/index'
import type { Lang, QualityReport } from '@core/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

interface DataBannersProps {
  quality: QualityReport
  lang: Lang
  onOpenSettings: () => void
}

/**
 * PRD §6.3: values the push API could not map are kept as "Unmapped" and must be reviewed, so they get a banner.
 * The quality line underneath keeps every data fix one tap away (PRD goal 2).
 */
export function DataBanners({ quality, lang, onOpenSettings }: DataBannersProps) {
  const { t } = useTranslation('dashboard')
  const int = (v: number) => formatInt(v, lang)
  const fixed = quality.valuesFixed.reduce((sum, f) => sum + f.count, 0)
  const unmappedRows = quality.unmapped.reduce((sum, u) => sum + u.count, 0)

  return (
    <div className="flex flex-col gap-3">
      {quality.unmapped.length > 0 && (
        <Alert>
          <TriangleAlert aria-hidden="true" className="text-destructive" />
          <AlertTitle>{t('banners.unmapped.title', { count: quality.unmapped.length, formatted: int(quality.unmapped.length) })}</AlertTitle>
          <AlertDescription>
            <p>
              {t('banners.unmapped.body', {
                values: quality.unmapped.map((u) => `${u.value} (${t(`columns.${u.column}`)})`).join(', '),
                rows: int(unmappedRows),
              })}
            </p>
            <Button variant="outline" size="sm" onClick={onOpenSettings} className="mt-1">
              {t('banners.unmapped.action')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <p className="tabular">
          {t('banners.quality.line', {
            read: int(quality.rowsRead),
            clean: int(quality.rowsClean),
            duplicates: int(quality.duplicatesRemoved),
            fixed: int(fixed),
          })}
        </p>
        <QualityDialog quality={quality} lang={lang} />
      </div>
    </div>
  )
}

function QualityDialog({ quality, lang }: { quality: QualityReport; lang: Lang }) {
  const { t } = useTranslation('dashboard')
  const int = (v: number) => formatInt(v, lang)

  const facts: [string, string][] = [
    [t('quality.rows'), t('quality.rowsValue', { read: int(quality.rowsRead), clean: int(quality.rowsClean) })],
    [t('quality.duplicates'), quality.duplicateRowNumbers.length > 0 ? t('quality.duplicatesValue', { count: quality.duplicatesRemoved, formatted: int(quality.duplicatesRemoved), rows: quality.duplicateRowNumbers.join(', ') }) : int(0)],
    [t('quality.trimmed'), int(quality.valuesTrimmed)],
    [t('quality.returns'), t('quality.returnsValue', { count: quality.returnLines, formatted: int(quality.returnLines), value: formatIdr(quality.returnNet, lang, { compact: false }) })],
    [t('quality.missingSalesman'), int(quality.missingSalesman)],
    [t('quality.arithmetic'), int(quality.arithmeticMismatches.length)],
    [t('quality.unparseable'), int(quality.unparseable.length)],
  ]
  if (quality.missingColumns.length > 0) {
    facts.push([t('quality.missingColumns'), quality.missingColumns.map((c) => t(`columns.${c}`)).join(', ')])
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="link" size="sm" className="px-0">
          <ClipboardList aria-hidden="true" />
          {t('banners.quality.open')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('quality.title')}</DialogTitle>
          <DialogDescription>{t('quality.description')}</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular max-sm:mb-1">{value}</dd>
            </div>
          ))}
        </dl>

        {quality.valuesFixed.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t('quality.fixedTitle')}</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {quality.valuesFixed.map((f) => (
                <li key={`${f.column}:${f.from}`} className="break-words">
                  <span className="text-muted-foreground">{t(`columns.${f.column}`)}: </span>
                  {t('quality.fixedItem', { from: f.from, to: f.to, count: f.count, formatted: int(f.count) })}
                </li>
              ))}
            </ul>
          </section>
        )}

        {quality.sharedOutletNames.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t('quality.sharedTitle')}</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {quality.sharedOutletNames.map((s) => (
                <li key={s.name}>{t('quality.sharedItem', { name: s.name, ids: s.outletIds.join(', ') })}</li>
              ))}
            </ul>
          </section>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}
