# PRD — Sales Pulse (AI Builder build test)

| | |
|---|---|
| Status | Draft v1 — decisions locked in grill session, 2026-11-23 |
| Deadline | ~44 h from 2026-11-23 (build test limit: 48 h) |
| Deliverable | Repo link or zip + README. Reviewers run it on their own machine (assume macOS). |
| Sample data | [data/data.csv](data/data.csv) — 1,891 invoice lines, 15 columns, Sep–Oct 2026 |

## 1. Summary

A local web app that turns a messy sales export into (1) a dashboard of sales by region and brand, (2) the 5 weakest outlets, and (3) a one-paragraph summary a sales manager reads in Telegram — and actually sends it there.

The task, verbatim: *"ship a small web app that shows sales by region and brand, flags the 5 weakest outlets, and writes a one-paragraph summary a sales manager could read in Telegram."*

What the reviewers are really testing (from the job page): messy-data handling, product sense ("who uses this and why"), judgment over AI output, and shipping something that runs first time.

## 2. Personas

| Persona | Context | Needs from this app |
|---|---|---|
| **Sales manager / Head of Region** (end user) | Reads on a phone, in the field. Not technical. Indonesian. | "Which outlets do I visit this week, which brand do I push?" A short, numeric, actionable Telegram message. A dashboard that works on a phone. |
| **Hiring manager** (task giver, reports to Commercial Director) | Business-minded, impatient with half-built work, heavy AI user. Runs the repo on their own Mac. | Clone → running in < 2 min. Clear README: problem, user, decisions. Evidence it could become a real internal tool. |
| **Live-build observer** (60-min session) | Watches how the candidate works with AI. | Code the candidate can explain and change live. Tests that prove the numbers. AI kept on a short leash. |

## 3. Goals and non-goals

**Goals**
1. Numbers are correct and reproducible, whatever the shape of the input CSV.
2. Onboarding gets any user from raw CSV to a trusted dashboard, with every data fix visible.
3. Summary is accurate by construction (the LLM never produces a number).
4. Works on phone and desktop. Full UI in Bahasa Indonesia and English.

**Non-goals**
- Hosting, multi-user accounts, auth beyond a local push-API token.
- Direct QAD ERP connector (listed as next step in README).
- Dark mode.
- Datasets beyond ~100k rows (state the limit in README).

## 4. User flow

Onboarding is a blocking modal. **All steps are required**; the dashboard is unreachable until every step passes. Everything can be changed later via ⚙️ Settings, which reopens the same steps.

1. **Language** — Bahasa Indonesia / English (default: Indonesian; switchable anytime).
2. **LLM endpoint** — format (OpenAI-compatible | Anthropic), base URL, API key, model. "Test connection" must succeed to continue.
3. **Load data** — drag-and-drop or pick a CSV. The push API (§6.7) is shown here with its token for automated loads.
4. **Review mapping** — the LLM proposes column mapping and value fixes (§6.2). The user sees each proposal (e.g. `Jabar → Jawa Barat`, 4 rows) and can accept or edit it. Confirm to continue.
5. **Data quality report** — rows read, duplicates removed, returns found, values fixed, warnings (§6.3). Confirm to continue.
6. **Telegram** — bot token + chat ID, with a 3-step BotFather guide inline. "Send test message" must succeed.
7. → **Dashboard**.

## 5. Decisions log

| # | Decision | Rationale |
|---|---|---|
| D1 | Stack: React + TypeScript (Vite), small Node server in the same repo | Candidate's strongest language; secrets cannot live in the browser. |
| D2 | Charts: ApexCharts for all charts; Highcharts Maps for the Indonesia map only | ApexCharts has no geo map. |
| D3 | UI: shadcn/ui, light mode only | Requested. |
| D4 | LLM via user-supplied custom endpoint, entered in onboarding (not `.env`) | Better UX for reviewers. |
| D5 | LLM **proposes** normalization; **code applies** it deterministically | Accuracy and testability. Per-row LLM rewriting rejected: non-deterministic, slow, breaks "matches manual calculation". |
| D6 | All numbers computed in code; LLM writes wording only, via placeholders (§6.5) | A wrong % sends a manager to the wrong outlet. |
| D7 | Weakest outlet = largest month-over-month decline vs. peers of the same outlet type | Raw totals would just list the smallest warungs. |
| D8 | Data in via CSV upload **and** push API that returns a response | Push mirrors the real job (agents pulling ERP data). |
| D9 | Telegram sending is real (Bot API), not copy-only | Requested. |
| D10 | Credentials stored encrypted on the local machine | Survive restarts without `.env`. |
| D11 | Full UI and summary bilingual (ID/EN); README in English | Users are Indonesian; job page is English-first. |
| D12 | Onboarding fully required (CSV + LLM + Telegram) | Requested. Risk noted in §10. |

## 6. Functional requirements

### 6.1 Data input contract

Canonical columns (15): `date, invoice_no, region, branch, outlet_id, outlet_name, outlet_type, salesman, brand, sku, qty_carton, price_per_carton_idr, gross_sales_idr, discount_idr, net_sales_idr`.

Required for the app to work: `date, region, outlet_id, brand, net_sales_idr`. Others are optional; features that need a missing column are hidden with a note.

Parsing (code, deterministic):
- Delimiter auto-detect (`,` `;` tab), UTF-8 with or without BOM.
- Numbers: plain (`1725966000`), Indonesian (`1.725.966.000`, `1.234,5`), with `Rp`. Ambiguous values are reported, never guessed silently.
- Dates: `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`. If day/month order is ambiguous, the LLM proposal decides and the user confirms in step 4.

### 6.2 LLM-assisted normalization (propose → review → apply)

**Input to the LLM** (never the full dataset): header row, 5 sample rows, and the distinct values (with counts, capped at 300 per column) of `region, branch, outlet_type, brand, sku, salesman`.

**Output**: strict JSON, validated with a zod schema:
```json
{
  "columnMap": { "Region": "region", "Net Sales": "net_sales_idr" },
  "dateFormat": "YYYY-MM-DD",
  "valueMap": {
    "region": { "Jabar": "Jawa Barat", "JAWA BARAT": "Jawa Barat" }
  },
  "branchGeo": { "Banjarmasin": { "lat": -3.32, "lon": 114.59 } },
  "notes": ["..."]
}
```
- Invalid JSON or schema → retry once with the validation error → otherwise show a manual mapping form.
- Code then applies the confirmed maps to every row. Same input + same confirmed maps = identical output.
- Confirmed maps are saved, keyed by a hash of the distinct values, and reused by later uploads and the push API.
- `branchGeo` is only proposed for branches missing from the built-in coordinate table; the user confirms it like any other mapping.

### 6.3 Cleaning rules (code, in this order)

| Rule | Behaviour | Reported as |
|---|---|---|
| Trim | Trim whitespace in all text cells | "N values trimmed" |
| Apply maps | Column map, value maps | "N values fixed" with before → after |
| Duplicates | Drop rows identical in every column after the steps above | "N duplicates removed" (list them) |
| Returns | Rows with `qty_carton < 0` (or invoice prefix `RTR`) are **kept** as negative sales | "N return lines, Rp X" |
| Outlet identity | Group by `outlet_id`, never by name. Display name = most frequent name for that ID | "N names shared by different outlets" |
| Missing salesman | Set to `Unassigned` | "N rows without salesman" |
| Arithmetic check | Flag rows where `qty × price ≠ gross` or `gross − discount ≠ net`. Keep reported `net_sales_idr` as the source of truth | "N rows with arithmetic mismatch" |
| Unknown values (push API only) | Values not in a confirmed map are kept as `Unmapped` and trigger a banner to review | "N unmapped values" |

### 6.4 Metric definitions

- **Net sales** = sum of `net_sales_idr` after cleaning, returns included (negative).
- **Periods**: current = latest calendar month in the data; baseline = the month before it. If the current month is incomplete (last date < month end), compare day 1..D of both months.
- **MoM %** = (current − baseline) / baseline × 100.
- **Weakest outlets (default view: "Decline vs peers")**
  - Eligible: outlets with baseline > 0. Outlets with current = 0 count as −100% (lapsed).
  - Outlets with no baseline sales are labelled **New** and excluded.
  - Score = outlet MoM % − median MoM % of its `outlet_type`.
  - Top 5 = lowest score. Tie-break: lower current-period net sales.
  - Each row shows: name, ID, type, branch, salesman, baseline, current, Rp change, MoM %, peer median.
- **Alternative view ("Lowest vs peers")**: outlet net sales ÷ median net sales of its `outlet_type`, lowest 5. Used when the data has only one month.
- All metrics respond to the active filters.

### 6.5 Summary (LLM, bilingual, accurate by construction)

1. Code builds a facts object for the current filter scope (national or one region): total net, MoM %, top and weakest region, top brand, the 5 weakest outlets with %, returns, data period.
2. The LLM gets the facts' **keys and descriptions only**. It returns one paragraph using placeholders, e.g. `Penjualan bersih {total_net} ({mom_pct} vs bulan lalu). Fokus kunjungan: {weak_1_name} ({weak_1_pct})...`.
3. Code validates: every placeholder exists; **no digits appear outside placeholders**; one paragraph; ≤ 80 words after substitution.
4. Code substitutes values formatted for the locale (`Rp 1,73 miliar` / `IDR 1.73B`, `-54,9%` / `-54.9%`).
5. Validation fails → retry once with the error → otherwise show a deterministic template summary, labelled as such.
6. Language follows the UI toggle. The user can regenerate it.

### 6.6 Dashboard (shadcn/ui, light mode)

**Layout**: header (language toggle, ⚙️, data period, "Send to Telegram"); filter bar (date range, region, branch, brand, outlet type, salesman); KPI row; charts grid; weakest-outlets table; summary card with a Telegram-style preview. Mobile: single column, filters in a sheet, charts full width, table becomes cards.

**Charts** — one question per chart, every chart cross-filters the rest on click:

| Question | Chart | Library |
|---|---|---|
| How much did we sell, and is it rising? | KPI cards (net sales, invoices, active outlets, returns) + sparklines | ApexCharts |
| Where are sales across Indonesia? | Indonesia map, each region drawn as the provinces it covers (colour = region, label = net sales); click an area to filter by region | Highcharts Maps |
| Which region is biggest? | Horizontal bar, sorted | ApexCharts |
| Which brand is strong in which region? | Heatmap region × brand | ApexCharts |
| What share does each brand have? | Donut | ApexCharts |
| How is the daily trend? | Area chart with brush (zoom) | ApexCharts |
| Which outlets fell the most? | Diverging bar, baseline → current | ApexCharts |
| Which SKUs sell most? | Treemap | ApexCharts |
| Which outlet types matter? | 100% stacked bar by region | ApexCharts |

**Map notes** (changed on 2026-11-24 at the user's request: areas instead of branch bubbles): each region is drawn as the provinces it covers. A province goes to the region named after it (including abbreviations such as Jabar), else to the region whose branches are in it (most net sales wins), else to a region named after its island (Sumatera, Kalimantan, ...). Regions that are not provinces, such as Jabodetabek, therefore show as DKI Jakarta + Banten. A legend under the map lists every region with its total, because Java's labels do not all fit. Regions that cannot be placed are listed under "Not yet on map". The map topology is bundled locally (no network needed). ApexCharts and Highcharts share one theme (palette, font, tooltip style) taken from the shadcn tokens.

### 6.7 Push API

`POST /api/ingest`
- Auth: `Authorization: Bearer <push token>`. The token is generated in onboarding and shown in Settings.
- Body: `text/csv` (raw CSV) or `multipart/form-data` (`file`).
- Behaviour: parse → apply saved maps → clean → replace the current dataset → dashboard updates live (server-sent events).
- Query `?summary=true&lang=id|en&region=<name>` also returns the summary. `&telegram=true` also sends it.
- Response `200`:
```json
{
  "datasetId": "ds_…",
  "quality": { "rowsRead": 1891, "rowsClean": 1888, "duplicatesRemoved": 3, "returnLines": 1, "valuesFixed": 10, "unmapped": [] },
  "period": { "from": "2026-09-01", "to": "2026-10-31", "current": "2026-10", "baseline": "2026-09" },
  "kpis": { "netSales": 1725966000, "momPct": 3.65 },
  "weakestOutlets": [ { "outletId": "OUT1022", "name": "Toko Bintang", "momPct": -63.2, "score": -77.7 } ],
  "summary": "…",
  "telegram": { "sent": true }
}
```
- Errors: `401` bad token; `400` missing required columns (lists them); `422` unmapped values that block a required column (lists them).

### 6.8 Telegram

- Bot API `sendMessage` with `parse_mode: HTML` (avoids MarkdownV2 escaping errors). Message ≤ 4,096 characters.
- Message = summary paragraph + data period + a top-5 list.
- Onboarding requires a successful test message. Errors from Telegram are shown in plain language (wrong token, bot not started in chat, wrong chat ID).
- Send scope follows the region filter (national digest or one region's digest).

### 6.9 Credentials

- Entered in the UI and sent once to the local server. Never returned to the browser (shown masked), never logged.
- Stored encrypted with AES-256-GCM in the OS user data folder (e.g. `~/Library/Application Support/sales-pulse/` on macOS), outside the repo. The key is a random 32-byte file in the same folder with `0600` permissions.
- Honest scope (state in README): this prevents secrets from leaking via the repo, logs or browser. It does not protect against someone with access to the user's machine account.
- Settings → "Forget credentials" deletes both files.

### 6.10 Internationalisation

- Every UI string, chart label, tooltip, error and summary in `id` and `en` (react-i18next). No hardcoded strings; a test fails on missing keys.
- Numbers and dates are formatted with `Intl` (`id-ID` / `en-US`). Currency is always IDR.

## 7. Architecture

```
sales-pulse/
├─ core/       Pure TS, no I/O: parse, clean, metrics, summary validation. Shared by client and server. 100% unit-tested.
├─ server/     Hono on Node: LLM proxy, Telegram, push API, SSE, encrypted credential store, dataset store.
├─ client/     Vite + React + TS, Tailwind + shadcn/ui, react-apexcharts, highcharts-react-official, react-i18next.
├─ data/       Sample CSV (data.csv).
└─ README.md
```

- The server owns the current dataset (cleaned rows saved as local JSON, so a restart keeps it). The client loads the cleaned rows (≈1.9k rows) and computes filtered views with `core/` for instant cross-filtering.
- LLM adapter: one interface, two formats. OpenAI-compatible: `POST {base}/chat/completions`, `Authorization: Bearer`. Anthropic: `POST {base}/v1/messages`, `x-api-key` and `anthropic-version` headers. Timeout 30 s.
- One command: `npm install && npm start` builds the client and serves it with the API on `http://localhost:5173`. `npm run dev` for hot reload. Requires Node ≥ 20 (checked on start, with a clear message).

## 8. Acceptance criteria

**AC1 — Runs**: on a clean macOS machine with Node ≥ 20, `git clone` → `npm install && npm start` → app open in < 2 minutes.

**AC2 — Correct numbers on the sample data** (golden values, computed independently from [data/data.csv](data/data.csv)):

| Metric | Expected |
|---|---|
| Rows read → clean | 1,891 → 1,888 |
| Duplicates removed | 3 |
| Return lines | 1 (RTR900001, −Rp 528.000) |
| Region variants → regions | 10 → 6 |
| Invoices / outlets | 824 / 52 (by `outlet_id`) |
| Total gross / discount / net | Rp 1.756.320.000 / Rp 30.354.000 / Rp 1.725.966.000 |
| Net Sep / Oct / MoM | Rp 847.517.400 / Rp 878.448.600 / +3,65% |

| Region | Net sales (Rp) |
|---|---|
| Jabodetabek | 495.827.800 |
| Sumatera | 340.690.500 |
| Jawa Barat | 310.947.300 |
| Jawa Tengah | 222.881.500 |
| Jawa Timur | 211.378.500 |
| Kalimantan | 144.240.400 |

| Brand | Net sales (Rp) |
|---|---|
| Kacang Dua Kelinci | 739.781.900 |
| Tos Tos | 285.909.300 |
| Sukro | 271.738.100 |
| Tic Tac | 187.336.900 |
| Deka | 91.197.500 |
| Pilus | 71.659.900 |
| Usagi | 43.943.200 |
| Roni | 34.399.200 |

Peer medians (MoM %): Grosir −1,9 · Warung +7,3 · Toko Kelontong +14,5 · Minimarket −0,1.

| # | Weakest outlet | Type | Sep → Oct (Rp) | MoM | Score vs peers |
|---|---|---|---|---|---|
| 1 | OUT1022 Toko Bintang | Toko Kelontong | 8.764.300 → 3.223.100 | −63,2% | −77,7 |
| 2 | OUT1045 Toko Anugerah | Toko Kelontong | 798.000 → 360.000 | −54,9% | −69,3 |
| 3 | OUT1043 Minimarket Sido Muncul | Minimarket | 9.181.700 → 2.873.700 | −68,7% | −68,6 |
| 4 | OUT1041 Toko Anugerah | Toko Kelontong | 12.494.900 → 5.909.600 | −52,7% | −67,2 |
| 5 | OUT1048 Toko Mekar | Toko Kelontong | 5.143.700 → 2.473.900 | −51,9% | −66,4 |

New outlet excluded: OUT1047. Note #2 and #4 share a name: grouping by name would merge them and give wrong results.

**AC3 — Robust to messy input**: the same golden values result from variants of the sample with shuffled columns, renamed headers (`Region`, `Net Sales`), `;` delimiter, Indonesian number format, `DD/MM/YYYY` dates, and extra casing/spacing errors (fixtures in `core/__fixtures__/`).

**AC4 — Summary**: every number in the summary equals a computed fact; no digits outside placeholders; one paragraph; ≤ 80 words; correct in both languages.

**AC5 — Telegram**: a test message and a digest arrive in the configured chat; errors are readable.

**AC6 — Push API**: `curl` with the sample CSV returns the JSON in §6.7, and an open dashboard updates without reload.

**AC7 — Mobile**: usable at 375 px width; no horizontal scroll; every chart readable; tap targets ≥ 44 px.

**AC8 — Tests pass**: `npm test` green. It covers:
- `core` unit tests (Vitest): parsing, every cleaning rule, metrics, golden values, summary validator. The LLM is mocked with recorded responses.
- Server tests: push API (auth, 400/422), credential encryption round-trip, LLM adapters for both formats, Telegram client (mocked HTTP).
- One Playwright smoke test: onboarding with mocked LLM and Telegram → dashboard → summary visible, on desktop and 375 px viewports.
- An i18n test for missing keys.

**AC9 — Security**: no secret in the client bundle, git history, logs or API responses (checked by test).

## 9. Plan (44 h)

| Block | Hours | Output |
|---|---|---|
| 1. Scaffold + `core` parse/clean/metrics + golden tests | 8 | AC2 and AC3 green in Vitest |
| 2. Server: credential store, LLM adapters, normalization proposal, Telegram, push API, SSE | 8 | AC5, AC6, server tests |
| 3. Onboarding modal (6 steps), i18n | 7 | Full flow working end to end |
| 4. Dashboard: filters, KPIs, 8 ApexCharts, Highcharts map, table, cross-filter | 10 | AC7 |
| 5. Summary: placeholder generation, validator, preview, send | 4 | AC4 |
| 6. Playwright, clean-machine run on macOS, README, screenshots | 4 | AC1, AC8, AC9 |
| Buffer | 3 | |

Build in this order so a working, correct core exists even if later blocks slip.

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Reviewer has no LLM key or Telegram bot, so required onboarding blocks them from the dashboard (D12) | They never see the work | README states the requirement up front with a 3-step guide for both; include screenshots and a short screen recording of the full flow. |
| Highcharts licence: free for non-commercial use; commercial use needs a paid licence | Blocker if Dua Kelinci adopts the app | Name it in README; the map sits behind one component so it can be swapped (e.g. react-simple-maps). Verify the licence terms before submitting. |
| LLM proposes a wrong mapping | Wrong totals | Human review step; deterministic apply; golden tests. |
| Small baselines make % swings noisy (OUT1045: Rp 798k → 360k) | Manager chases a tiny outlet | Show Rp change beside %; open question below. |
| Two chart libraries look inconsistent | Looks unpolished | Shared theme module from shadcn tokens. |

## 11. Open questions

1. Minimum baseline for the weakest-outlet ranking (e.g. ≥ Rp 1 juta)? Default: none, but Rp change is always shown.
2. Are exact duplicate lines always errors, or could the same SKU appear twice on one invoice legitimately? Default: treat as duplicates and list them in the quality report.
3. Brands `Roni` and `Deka` appear in the data but not on the company's brand list (possibly OEM). Default: show as-is.
