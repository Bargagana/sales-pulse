# Team contracts (Sales Pulse)

Spec: [PRD.md](PRD.md). This file says who owns what and how the parts talk. Read both before writing code.

## Ownership (edit only your lane)

| Lane | Owner | Paths |
|---|---|---|
| Contracts | Orchestrator / Integrator | `core/types.ts`, `core/api-types.ts`, `core/schemas.ts`, `client/src/lib/api.ts`, `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `CONTRACTS.md` |
| Data | Data Engineer | `core/**` except contract files. `core/index.ts` signatures are fixed: implement in modules (`core/parse.ts`, `core/mapping.ts`, `core/clean.ts`, `core/metrics.ts`, `core/format.ts`, `core/summary.ts`, `core/geo.ts`) and re-export from `core/index.ts`. Fixtures in `core/__fixtures__/`. |
| Backend | BE | `server/**` |
| Design system | UI/UX | `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx`, `client/src/index.css`, `client/src/components/ui/**`, `client/src/components/layout/**`, `client/src/theme/**`, `client/src/i18n/index.ts`, `client/src/i18n/locales/*/common.json`, `DESIGN.md` |
| Onboarding | FE-Onboarding | `client/src/features/onboarding/**`, `client/src/i18n/locales/*/onboarding.json` |
| Dashboard | FE-Dashboard | `client/src/features/dashboard/**`, `client/src/i18n/locales/*/dashboard.json` |
| E2E | QA | `e2e/**`, `playwright.config.ts` |

Rules:
- **Never run `npm install` / `npm uninstall` / `npx shadcn add`.** All dependencies are installed. If you truly need one, stop and say so in your final report.
- Need a contract change? Don't edit the contract file; describe the change in your final report. Work around it locally if you can.
- Before finishing: `npx tsc --noEmit -p .` must show no errors in your lane, and `npx vitest run <your paths>` must pass.
- No secrets in logs, test snapshots, or the client bundle.

## Client composition

`client/src/App.tsx` (UI/UX) loads `api.state()` and renders:
- not onboarded → `<Onboarding mode="initial" state={state} onStateChange={setState} />`
- onboarded → `<Dashboard state={state} onStateChange={setState} onOpenSettings={...} />`, plus `<Onboarding mode="settings" ... onClose={...} />` when Settings is open.

Feature entry points (fixed props):
```ts
// client/src/features/onboarding/index.tsx
export function Onboarding(props: { mode: 'initial' | 'settings'; state: AppState; onStateChange: (s: AppState) => void; onClose?: () => void }): JSX.Element
// client/src/features/dashboard/index.tsx
export function Dashboard(props: { state: AppState; onStateChange: (s: AppState) => void; onOpenSettings: () => void }): JSX.Element
```
- `App` lazy-loads both features (`React.lazy`), so onboarding and the dashboard (with ApexCharts) are separate chunks.
- `<Dashboard>` renders `<AppShell>` itself, to fill the header's period badge and actions (Send to Telegram, language toggle). `App` wraps only loading, error and first-run onboarding in `AppShell`.
- With `@types/react` 19 there is no global `JSX` namespace: feature files use `import type { JSX } from 'react'`.

Language: `AppState.lang` is the source of truth; App syncs `i18next.changeLanguage(state.lang)`. i18n namespaces: `common`, `onboarding`, `dashboard`; every key must exist in both `id` and `en`.

## Running things while others work

Several agents work in this folder at once:
- Don't run `npm run build` / `vite build` / `npm start` (they write `dist/`). The Integrator does.
- To run servers, use your lane's ports: BE API `8801`; FE-Onboarding API `8802` + Vite `5182`; FE-Dashboard API `8803` + Vite `5183`; QA `8804`/`5184`. Example: `SALES_PULSE_API_PORT=8803 SALES_PULSE_DATA_DIR=.local-data/fe-dash SALES_PULSE_LLM_MOCK=1 SALES_PULSE_TELEGRAM_MOCK=1 npx tsx server/index.ts` and `SALES_PULSE_API_PORT=8803 npx vite --port 5183`. Stop your servers before finishing.
- Screenshots: Playwright Chromium is installed (`npx playwright screenshot --viewport-size=375,812 http://localhost:5183 shot.png`, or a small script with `@playwright/test`'s `chromium`). Save under `.local-data/`.
- Server port: `--static` → `PORT` (default 5173); otherwise `SALES_PULSE_API_PORT` (default 8787).

## Imports

- `@core/*` → `core/*` (server, client, tests). `@/*` → `client/src/*`.
- server and client import core via `@core/index`, `@core/types`, `@core/api-types`, `@core/schemas` only.
- `core/` is pure TS: no `fs`, no network, no `Date.now()`/`Math.random()` in logic (accept ids/timestamps as params). It runs in the browser too.

## Runtime

| Mode | Command | What runs |
|---|---|---|
| Dev | `npm run dev` | API on `127.0.0.1:8787` (tsx watch) + Vite on `5173` proxying `/api` (`changeOrigin: false`, so the API's Origin == Host check passes) |
| Prod (reviewers) | `npm start` | Node check → `vite build` → `tsx server/index.ts --static` serves `dist/client` + API on `127.0.0.1:${PORT:-5173}` |
| Tests | `npm test` (Vitest), `npm run test:e2e` (`vite build` + Playwright: one `--static` server per viewport: desktop on 8804, mobile on 5184, with mocks and data dirs under `.local-data/e2e/`), `npm run test:all` | |

- Server binds **127.0.0.1 only** and prints `http://127.0.0.1:<port>` (not `localhost`, which may resolve to another app on `[::1]`).
- Local data folder: env `SALES_PULSE_DATA_DIR` if set (tests use a temp dir), else macOS `~/Library/Application Support/sales-pulse`, Windows `%APPDATA%/sales-pulse`, Linux `$XDG_CONFIG_HOME/sales-pulse` or `~/.config/sales-pulse`.
- Contents: `key` (32 random bytes, mode 0600), `credentials.enc` (AES-256-GCM: LLM config + key, Telegram token + chat id, push token), `state.json` (lang, completed steps), `dataset.json` (active Dataset), `mappings.json` (confirmed mappings by `profileKey`).
- Env `SALES_PULSE_LLM_MOCK=1` and `SALES_PULSE_TELEGRAM_MOCK=1`: server uses built-in deterministic fakes (for E2E and demos). Fake LLM returns the heuristic mapping and a valid summary template. Fake Telegram accepts token `123:mock` and chat id `42`, and rejects anything else with `unauthorized`.

## HTTP API

Types: `core/api-types.ts`. Client: `client/src/lib/api.ts`.

- Errors: `ApiError` with `code` from `ApiErrorCode` (listed with their `details` shapes in `core/api-types.ts`). The client translates from `code`; `message` is English diagnostic text. A non-JSON error body becomes `ApiRequestError(status, 'http_error')`.
- Fallback paths are reported as `warnings: Notice[]` (`{ code: 'llm_not_configured' | 'llm_invalid' | 'llm_failed' | 'mapping_reused', detail? }`) on `ProposeResponse` and `SummaryResponse`. `ProposeResponse.source` is `'llm' | 'heuristic' | 'saved'`; `saved` means a mapping the user confirmed earlier for the same profile, with no LLM call.
- `Filters.skus` and `Filters.outletIds` are set only by chart clicks (SKU treemap, outlet-change bars); the filter bar has no pickers for them.

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/health` | → `{ ok: true }` |
| GET | `/api/state` | → `AppState` |
| PUT | `/api/settings/language` | `LanguageRequest` → `AppState` (marks `language` complete) |
| POST | `/api/onboarding/complete` | `CompleteStepRequest` → `AppState` (only `language`, `quality`) |
| POST | `/api/llm/config` | `LlmConfigRequest` → `TestResult` (saves + marks `llm` on success) |
| POST | `/api/data/upload` | csv / multipart `file` → `UploadResponse` (marks `data`) |
| POST | `/api/data/propose` | `ProposeRequest` → `ProposeResponse` |
| POST | `/api/data/apply` | `ApplyRequest` → `ApplyResponse` (marks `mapping`; SSE `dataset`) |
| GET | `/api/dataset` | → `Dataset` (404 `no_dataset`) |
| POST | `/api/telegram/config` | `TelegramConfigRequest` → `TestResult` (saves + marks `telegram` on success) |
| POST | `/api/summary` | `SummaryRequest` → `SummaryResponse` |
| POST | `/api/telegram/send` | `TelegramSendRequest` → `TelegramSendResponse` |
| GET | `/api/push-token` | → `PushTokenResponse` (created on first call) |
| POST | `/api/push-token/rotate` | → `PushTokenResponse` |
| POST | `/api/credentials/forget` | → `AppState` (also invalidates the push token, which lives in `credentials.enc`; a new one is created on the next GET) |
| POST | `/api/ingest` | Bearer push token; csv / multipart → `IngestResponse` (401/400/422 per PRD §6.7) |
| GET | `/api/events` | SSE `dataset` events |

Push API value check: values are compared with the canonical values saved with every confirmed mapping (`mappings.json` → `knownValues`). An exact profile match is accepted as-is. Unknown region/brand → 422; other columns → `Unmapped` + banner.

Push API mapping: the confirmed mapping (exact profile, else the newest one whose columnMap covers every header) goes through `core.reuseMapping(confirmed, raw)`: column and value maps are kept, headers the file lacks are dropped (so a missing required column is a 400), and date/number formats are re-detected from the file, falling back to the confirmed format only where the file is ambiguous. The upload flow's `saved` proposal uses the same function. More than 5% unreadable rows → 422 `unreadable_rows`; the dataset is not replaced.

Response headers (all routes): `Content-Security-Policy` (`default-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`, `frame-ancestors 'none'`, …), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. An error response to a POST/PUT whose body was not read carries `Connection: close`.

Onboarding order in the UI: language → llm → data → mapping → quality → telegram. `AppState.onboarded` is true only when all six are complete. Uploading a new CSV later (Settings) re-runs data → mapping → quality without wiping the LLM/Telegram steps.

## LLM usage (server)

- Adapters: `openai` → `POST {baseUrl}/chat/completions` (`Authorization: Bearer`), `anthropic` → `POST {baseUrl}/v1/messages` (`x-api-key`, `anthropic-version: 2023-06-01`). Strip trailing `/` from baseUrl. 30 s timeout. Ask for JSON only; extract the first JSON object from the reply; validate with zod (`llmMappingProposalSchema`, `llmSummarySchema`); retry once with the validation error; then fall back (`core.heuristicMapping` / `core.fallbackTemplate`).
- Mapping prompt input = `core.profileTable(raw)` only (never full rows) + the canonical columns + rules.
- Summary prompt input = fact **keys, kinds and descriptions only** (never values) + language + rules (one paragraph, ≤ 80 words, no digits, use {placeholders}, action-oriented for a sales manager). Then `core.validateSummaryTemplate` → `core.renderSummary`.

## Golden numbers

PRD §8 AC2 lists the expected values for `data/data.csv`. Tests assert those exact numbers.

## Platform notes

- Windows + Git Bash, `vite build`: `vite.config.ts` upper-cases the drive letter of every path it passes to Vite. Without that, a build from a `/c/...` cwd bundled React twice (blank page, "reading useRef").
- Windows + Git Bash: run Vitest from PowerShell (or any shell whose cwd has an uppercase `C:`). From a `/c/...` cwd Node loads `vitest` twice (`c:` vs `C:` module URLs) and every suite fails with "failed to find the current suite". macOS and Linux are not affected.

