// Chart design tokens shared by ApexCharts and Highcharts.
// The UI values mirror client/src/index.css; tokens.test.ts fails if the two drift apart.

export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

/** Neutral ink and chrome, matching the shadcn tokens in index.css. */
export const ink = {
  primary: '#191917', // --foreground
  secondary: '#5d5c57', // --muted-foreground, 6.7:1 on white
  axis: '#6b6a65', // tick labels, 5.4:1 on white
  surface: '#ffffff', // --card: every chart sits on a card
  page: '#f6f6f3', // --background
  muted: '#efeee9', // --muted
  border: '#e2e1db', // --border
  grid: '#ebeae5', // hairline gridlines, deliberately quieter than --border
  baseline: '#c3c2b7', // zero line / axis line
  accent: '#0e6660', // --primary
} as const

/**
 * Categorical palette in fixed order (dataviz reference palette, validated with validate_palette.js on #ffffff):
 * adjacent CVD Delta E >= 9.1, adjacent normal-vision Delta E >= 19.6. Slots 3, 4 and 5 sit below 3:1 on white,
 * so charts that use them must carry direct labels or a table view.
 */
export const CATEGORICAL = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#6250d6', // violet
  '#e34948', // red
] as const

/** Colour for anything outside the categorical domain: "Other", "Unmapped", a 9th series. 3.5:1 on white. */
export const OTHER_COLOR = '#8a8984'

/** Text placed inside a categorical fill: white or ink, whichever contrasts more (every slot ends up >= 4.4:1). */
export const CATEGORICAL_LABEL = CATEGORICAL.map((hex) => readableOn(hex))

/** White or the page ink, whichever has more contrast on `hex` (WCAG relative luminance). */
export function readableOn(hex: string): string {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, ink.primary) ? '#ffffff' : ink.primary
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Single-hue blue ramp for magnitude (heatmap). Step 100 is "near zero"; 700 is the maximum. */
export const SEQUENTIAL = {
  100: '#cde2fb',
  200: '#9ec5f4',
  300: '#6da7ec',
  400: '#3987e5',
  500: '#256abf',
  600: '#184f95',
  700: '#0d366b',
} as const
export type SequentialStep = keyof typeof SEQUENTIAL

/**
 * Diverging pair for change vs. a baseline. Blue/red rather than green/red: the poles stay apart under
 * red-green colour blindness, and the neutral midpoint is grey, never a hue.
 */
export const DIVERGING = {
  growth: '#2a78d6', // 4.4:1 on white
  neutral: '#c3c2b7', // zero change, and the "baseline period" bar beside a coloured current bar
  decline: '#d03b3b', // 4.8:1 on white
} as const

/** Delta text colours (KPI badges, table cells). Always shipped with an arrow and a sign. */
export const DELTA_TEXT = {
  positive: '#146b34',
  negative: '#b3261e',
  neutral: '#5d5c57',
} as const
