# Sales Pulse design rules

For the FE engineers building onboarding and the dashboard. Read [PRD.md](PRD.md) §2 (who uses this) and §6.6 (what is on the page) first.

**Design read:** an internal sales tool for Indonesian sales managers reading on a phone in the field, and a business-minded reviewer on a Mac. Calm and numeric, light mode only. Figures first, decoration never.

**Dials:** ENERGY 1 (calm) / RHYTHM 2 (one grid, broken only where content needs it, e.g. the map spans two columns) / MOTION 1 (hover states and 250 ms chart transitions on filter change, nothing else).

**Identity motif:** every card states the question it answers under its title, and every change is shown with the same delta badge (arrow + signed value + colour). Use both everywhere; they are what make this product recognisable.

## 1. Where things live

| Need | Import |
|---|---|
| Page frame, header, language toggle | `AppShell`, `LanguageToggle`, `useLanguageSwitch` from `@/components/layout` |
| Page sections and the chart grid | `Section`, `DashboardGrid`, `ChartCard` |
| KPI tiles and change badges | `StatCard`, `DeltaBadge` |
| States | `EmptyState`, `ErrorState`, `FullPageLoader`, `ChartCard status=...` |
| Data period in the header | `PeriodBadge` |
| Phone vs desktop behaviour | `useIsPhone()` (below 768 px) |
| Chart colours and options | `@/theme` (`apexBase`, `mergeOptions`, `datasetScales`, `heatmapRanges`, `changeColor`, `highchartsTheme`, ...) |
| Strings | `useTranslation('dashboard')` / `('onboarding')`; shared words in `common` (`actions.retry`, `actions.close`, `status.loading`, ...) |

`App.tsx` renders `<Dashboard>`; the Dashboard renders `<AppShell>` itself so it can fill the header slots:

```tsx
const switchLang = useLanguageSwitch(state, onStateChange)
<AppShell
  lang={state.lang}
  onLangChange={switchLang}
  onOpenSettings={onOpenSettings}
  period={<PeriodBadge periods={state.dataset?.periods} lang={state.lang} />}
  actions={<SendToTelegramButton />}
>
  ...
</AppShell>
```

The product name in the header is the page's only `h1`. `Section` titles are `h2`, `ChartCard` titles are `h3`. Do not add another `h1`.

## 2. Layout

- **Grid:** `DashboardGrid` is 1 column on phones, 2 from `md` (768 px), 3 from `xl` (1280 px), gap 16 px. `ChartCard span={2}` for wide charts (map, daily trend), `span="full"` for the weakest-outlets table and summary.
- **KPI row:** `grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4`. Two KPIs per row on a phone is readable; one per row wastes the first screen.
- **Page order (PRD §6.6):** filter bar, KPI row, charts, weakest outlets, summary. On phones the filters live in a `Sheet` opened from one "Filter" button showing the active-filter count; the table becomes a list of cards.
- **Container:** `AppShell` already gives `max-w-screen-2xl`, 16 px side padding on phones, 24 px from `md`. Do not add another page container.
- **Overflow:** no horizontal page scroll at 375 px. Wide content (table, heatmap with many brands) scrolls inside its card with `overflow-x-auto`. Grid children need `min-w-0` (ChartCard and StatCard already have it).

### Spacing scale

Tailwind steps only: `1` (4 px) inside badges, `2` (8 px) between label and value, `3` (12 px) inside card headers and KPI gaps on phones, `4` (16 px) card padding on phones and grid gaps, `5` (20 px) card padding from `md`, `6` (24 px) between page sections. Nothing larger: this is a dense tool, not a landing page.

### Type scale

System font stack (SF on Mac, Roboto on Android, Segoe UI on Windows). No web fonts.

| Use | Class |
|---|---|
| Header product name | `text-base md:text-lg font-semibold` (AppShell) |
| Section title (`h2`) | `text-lg font-semibold tracking-tight` |
| Card title (`h3`) | `text-sm md:text-base font-semibold` |
| Card question, helper text | `text-sm text-muted-foreground` |
| Primary KPI value | `text-3xl md:text-4xl font-semibold` (`StatCard primary`) |
| Other KPI values | `text-2xl font-semibold` |
| Axis ticks, legends, captions | 12 px (`text-xs`) |

Figures that sit in columns or change with filters use `tabular` (or `font-variant-numeric: tabular-nums`). Table cells get it automatically. No uppercase-with-tracking labels, no monospace.

## 3. Colour

One accent: deep teal `primary` (#0e6660). It is for the primary action of a screen ("Send to Telegram", "Continue" in onboarding), focus rings and the selected state. Not for icons, borders or chart series.

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `background` | #f6f6f3 | page plane | |
| `card` | #ffffff | cards, dialogs, popovers, charts | |
| `foreground` | #191917 | text | 16.3:1 on page |
| `muted-foreground` | #5d5c57 | secondary text | 6.2:1 on page, 6.7:1 on card |
| `primary` | #0e6660 | accent, white text on it | 6.8:1 |
| `primary-soft` | #e3f0ee | selected toggle background | teal text 5.8:1 |
| `input` | #8f8d86 | input borders | 3.3:1 on white (WCAG 1.4.11) |
| `positive` / `positive-soft` | #146b34 / #e6f2e9 | delta up (good) | 5.7:1 |
| `negative` / `negative-soft` | #b3261e / #fbeae8 | delta down (bad) | 5.6:1 |
| `destructive` | #c22f2a | "Forget credentials", errors | white text 5.6:1 |

Use the Tailwind names (`bg-primary-soft`, `text-negative`, ...). Never write a hex in a component.

## 4. Charts

### Rules

1. **One question per chart.** The `ChartCard` `question` prop is that question, written for a sales manager ("Region mana yang paling besar?"). If a sentence answers it better, write the sentence.
2. **Sort bars** by value, largest first. Category order only for time.
3. **Direct labels over legends** where they fit: value labels on bars, branch names on the map. A legend is required when there are 2+ series and no direct labels. One series needs no legend; the title names it.
4. **IDR formatting:** tooltips and data labels use `formatIdr` (via `chartFormatters(lang).idr` / `.idrCompact`). Axis ticks use `.idrAxis` ("Rp 100 jt", "IDR 100M"); dense cells use `.short`. Never `toLocaleString` by hand.
5. **No 3D, no rainbow, no dual axes, no gradients except the area chart's faint fill.**
6. **Hover/tap tooltip on every chart.** Apex tooltips are already styled like shadcn popovers.
7. **Every chart has loading, empty and error states** through `ChartCard status`. Empty must say why ("No sales match these filters") and offer the fix (clear filters).
8. **Cross-filter on click** (PRD §6.6): clicking a bar, slice, cell or bubble toggles that value in the filters; the selected item stays full colour, the rest drop to 35 % opacity.

### Colour helpers (`@/theme`)

- **Entity colours:** `const scales = useMemo(() => datasetScales(dataset.rows), [dataset.id])`. Then `scales.region.color('Jawa Barat')`, `scales.brand.colors(names)` for Apex `colors` in series order. Slots are assigned by sorted name over the **unfiltered** dataset, so the map, region bar and donut agree and a filter never repaints survivors. Unknown and `Unmapped` values are grey.
- **Magnitude (heatmap):** `plotOptions.heatmap.colorScale.ranges = heatmapRanges(maxCellValue)`. Zero is grey, then 7 blue steps; label colour is set per step (white from step 500). Use `sequentialColor(v, max)` for anything else that encodes magnitude.
- **Change (diverging bar, MoM cells):** `changeColor(change)`: blue growth, red decline, grey none. Blue/red, not green/red: the two poles stay apart for red-green colour-blind readers. The KPI badges use green/red text, which is safe because they always carry an arrow and a sign.
- **Badges:** `<DeltaBadge value={momPct} text={formatPct(momPct, lang)} caption={t(...)} />`; `positiveIsGood={false}` for returns.
- **Labels inside fills:** `scale.labelColor(name)`: white or ink, whichever contrasts more with the fill (`readableOn`), so every slot reaches at least 4.4:1. Ink is used on orange, aqua, yellow, magenta and red.
- Palette slots 3, 4, 5 (aqua, yellow, magenta) are below 3:1 on white. Any chart that uses them must show values another way: direct labels or the tooltip plus a table/list nearby.

### ApexCharts recipe

```ts
const fmt = chartFormatters(lang)
const options = mergeOptions(apexBase(lang), {
  chart: { type: 'bar', events: { dataPointSelection: ... } },
  plotOptions: { bar: { horizontal: true } },
  stroke: FILL_GAP_STROKE,
  colors: scales.region.colors(rows.map((r) => r.key)),
  xaxis: { categories: rows.map((r) => r.key), tickAmount: isPhone ? 3 : 5 },
  tooltip: { y: { formatter: fmt.idr } },
})
```

| Chart | Notes |
|---|---|
| KPI sparklines | `chart: { sparkline: { enabled: true } }`, height 48, one series in `ink.secondary` or the accent, no tooltip on phones. |
| Region bar | Horizontal, sorted. `distributed: true` with region colours: it doubles as the map's colour key. Value labels inside the bar on desktop, hidden below 768 px (the tooltip carries them). |
| Heatmap region x brand | `stroke: FILL_GAP_STROKE`, `dataLabels.formatter: fmt.short`; hide labels on phones. Apex draws the first series at the bottom: pass regions in reverse so the biggest is on top. Cap at 8 brands, fold the rest into "Lainnya / Other". |
| Brand donut | `stroke: FILL_GAP_STROKE`, legend at the bottom, the total in the centre label. Max 8 slices plus Other. |
| Daily trend | Area with `fill: { type: 'gradient', gradient: { opacityFrom: 0.25, opacityTo: 0 } }`, brush chart below it on desktop only. |
| Weakest outlets diverging bar | `colors: [({ value }) => changeColor(value)]`, value labels at the bar end, hide the value axis on phones. |
| SKU treemap | `stroke: FILL_GAP_STROKE`, tiles in their brand's colour with `enableShades: false` (matches the donut); a tap filters by SKU. Label = SKU name, value in the tooltip. Top 20, rest as Other. |
| Outlet type 100 % stacked bar | `scales.outletType.colors(types)`, `stroke: FILL_GAP_STROKE`, legend on top. |

### Map (Highcharts Maps)

- Before rendering: `applyHighchartsLang(Highcharts, lang)` and key the component on `lang` (Highcharts `lang` is global).
- Options: `mergeOptions(highchartsTheme(), {...})`. Basemap: `@highcharts/map-collection/countries/id/id-all.topo.json` imported locally, provinces in `ink.muted` with white borders and no hover. It is context, not data.
- One `mapbubble` point per branch: `z` = net sales, `color` = `scales.region.color(region)`. Bubbles get a 2 px white ring from the theme so overlapping Java branches stay separate. Branch name as a data label from `md` up; tooltip shows branch, region and `fmt.idr(net)`.
- Six region colours on a map are more than the palette can keep apart pairwise, so colour is never the only key here: position (regions are geographic), direct branch labels, the tooltip and the region bar next to it carry the identity.
- Branches without coordinates: a short list under the map titled "Belum ada di peta / Not yet on map".
- Mouse-wheel zoom is off so the page scrolls; the +/- buttons are 44 px on touch screens. Keep the credit link visible (licence).

## 5. Onboarding modal

- Desktop (`md` up): shadcn `Dialog`, `sm:max-w-2xl`, content scrolls inside the dialog, footer with Back / primary action fixed at the bottom of the dialog.
- Phone: the same `DialogContent` made full screen: `max-md:h-dvh max-md:max-w-none max-md:rounded-none max-md:border-0`, header and footer sticky, body scrolls. The footer must stay above the on-screen keyboard: put it inside the scroll container's flex column, not `position: fixed`.
- Stepper with the 6 steps (language, LLM, data, mapping, quality, Telegram): on desktop a row of numbered steps with names; on phones "Langkah 2 dari 6" plus the step name and a `Progress` bar. Completed steps show a check icon and the word, not only colour. Current step has `aria-current="step"`.
- Initial mode: not dismissible (no close button, `onEscapeKeyDown`/`onInteractOutside` prevented). Settings mode: closable with the X button and Escape, opens on the step the user picks.
- One primary button per step, labelled with what it does ("Tes koneksi", "Kirim pesan tes", "Konfirmasi pemetaan"), never "Next" for an action that calls the server. Disabled with a spinner and "Menguji..." while running; result shown inline with an icon and text, errors in plain language from `TestResult.code`.
- Secrets: password inputs with a show/hide toggle; after save, show the masked state ("Kunci tersimpan") rather than an empty field.
- Mapping review (step 4): one row per proposed change `Jabar -> Jawa Barat (4 baris)` with an editable target; on phones each row is a card, not a table.

## 6. Accessibility checklist

- [ ] Text contrast 4.5:1 (3:1 for 18 px+); chart marks and input borders 3:1. Use the tokens above; check anything new with the contrast script.
- [ ] Tap targets 44 x 44 px below `md`. Built-in `Button`, `Toggle`, `Input`, `Select`, `Tabs` already are (default, `sm` and `icon` sizes). Do not use `size="xs"` / `"icon-xs"` for anything tappable on phones. Checkboxes and radios sit inside a `<label>` that is at least 44 px tall.
- [ ] Every control is a native `button`/`a`/`input`; icon-only buttons have `aria-label` and `aria-hidden` icons.
- [ ] Every input has a visible `<Label htmlFor>`; placeholders are examples, not labels.
- [ ] Keyboard: Tab order follows the visual order, Escape closes dialogs and sheets, the focus ring is visible (teal ring, already in the components).
- [ ] Status is never colour alone: delta badges have arrows and signs, errors have an icon and text, completed steps say "Selesai".
- [ ] Loading text is announced (`role="status"` / `aria-busy`), errors use `role="alert"` (ErrorState does).
- [ ] Every chart has a text alternative: the question plus the tooltip, and for the weakest outlets the table itself.
- [ ] No hardcoded UI strings: everything through i18n, both `id` and `en` (the i18n test fails on a missing key or placeholder mismatch).
- [ ] Motion: nothing loops except loading indicators; `prefers-reduced-motion` turns chart animation off (handled in `apexBase` / `highchartsTheme`).
- [ ] Check every screen at 375 x 812 and 1440 x 900: no horizontal scroll, nothing clipped.

## 7. Why these choices

| Decision | Reason |
|---|---|
| System font | Native on the managers' phones and reviewers' Macs, works offline, nothing to download on field connections. |
| Warm grey page, white cards, hairline borders, no card shadows | Cards separate by tone; shadow is reserved for things that float (dialogs, popovers, toasts). |
| Deep teal accent | Distinct from every chart hue, so a button never reads as a data series; 6.8:1 with white text. |
| Radius 8 px cards, 6 px controls, 4 px badges | Small steps that tell card, control and label apart; nothing pill-shaped except the switch. |
| Validated 8-colour palette, slots by name | Colour-blind-safe neighbours (CVD Delta E >= 9.1), and the same region is the same colour everywhere. |
| Blue/red for change | Survives red-green colour blindness; green/red only where an arrow and sign carry the meaning. |
| Lucide icons, few of them | They match shadcn's stroke weight; used only where the glyph carries meaning (settings, direction arrows, error, calendar), never as decoration. |
| No logo | None has been designed; the product name is set as text until one is. |
