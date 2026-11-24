// PRD §4: the first-run onboarding is a blocking gate. Every step is tried with bad input first (it must not let the
// user through), then completed. Desktop runs it in Indonesian (the default), the phone in English.
import { expect, test, type Page } from '@playwright/test'
import { GOLDEN, SAMPLE_CSV, horizontalOverflow, smallTapTargets, t, untranslatedText, watchErrors, type Lang } from './support/app'

const langOf = (project: string): Lang => (project.startsWith('mobile') ? 'en' : 'id')
const int = (n: number, lang: Lang) => new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-US').format(n)

async function expectStillGated(page: Page, lang: Lang) {
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('button', { name: t(lang, 'common:actions.close'), exact: true })).toHaveCount(0)
  await expect(page.getByTestId('weak-row')).toHaveCount(0)
}

/** Phone-only layout checks, run on every step: no sideways scroll and no tap target under 44 px in the dialog. */
async function checkPhoneLayout(page: Page, isMobile: boolean, step: string) {
  if (!isMobile) return
  expect(await horizontalOverflow(page), `horizontal scroll on ${step}`).toBeLessThanOrEqual(0)
  // The inline @BotFather link sits in running text; WCAG 2.5.8 exempts inline links.
  const small = (await smallTapTargets(page, '[role=dialog]')).filter((s) => !s.includes('@BotFather'))
  expect(small, `tap targets under 44 px on ${step}`).toEqual([])
}

test('every onboarding step must pass before the next opens, then the dashboard shows', async ({ page, request, isMobile }, testInfo) => {
  const lang = langOf(testInfo.project.name)
  const errors = watchErrors(page)
  const dialog = page.getByRole('dialog')

  await test.step('the first-run dialog cannot be dismissed', async () => {
    await page.goto('/')
    await expectStillGated(page, 'id')
    await page.keyboard.press('Escape')
    await expectStillGated(page, 'id')
    if (!isMobile) {
      // Outside the centred dialog: the overlay must not close it either.
      await page.mouse.click(10, 10)
      await expectStillGated(page, 'id')
    }
    expect((await request.get('/api/dataset')).status()).toBe(404)
  })

  await test.step('language', async () => {
    await expect(dialog.getByText(t('id', 'onboarding:language.title'))).toBeVisible()
    await checkPhoneLayout(page, isMobile, 'language')
    if (lang === 'en') await dialog.getByText(t('en', 'common:language.en'), { exact: true }).click()
    await dialog.getByRole('button', { name: t(lang, 'onboarding:language.save', { language: t(lang, `common:language.${lang}`) }) }).click()
  })

  await test.step('LLM: empty or invalid fields do not reach the server', async () => {
    const testButton = dialog.getByRole('button', { name: t(lang, 'onboarding:llm.test') })
    await testButton.click()
    await expect(dialog.getByText(t(lang, 'onboarding:llm.errors.key'))).toBeVisible()
    await expect(dialog.getByText(t(lang, 'onboarding:llm.errors.model'))).toBeVisible()
    await dialog.getByLabel(t(lang, 'onboarding:llm.baseUrl'), { exact: true }).fill('api.openai.com')
    await testButton.click()
    await expect(dialog.getByText(t(lang, 'onboarding:llm.errors.url'))).toBeVisible()
    await expect(dialog.getByText(t(lang, 'onboarding:llm.title'))).toBeVisible()
    await checkPhoneLayout(page, isMobile, 'llm')

    await dialog.getByLabel(t(lang, 'onboarding:llm.baseUrl'), { exact: true }).fill('https://api.openai.com/v1')
    await dialog.getByLabel(t(lang, 'onboarding:llm.apiKey'), { exact: true }).fill('sk-e2e-mock')
    await dialog.getByLabel(t(lang, 'onboarding:llm.model'), { exact: true }).fill('mock-model')
    await testButton.click()
  })

  await test.step('data: no file or a non-CSV file cannot be uploaded', async () => {
    const upload = dialog.getByRole('button', { name: t(lang, 'onboarding:data.upload') })
    await expect(upload).toBeDisabled()
    // The push API panel is part of this step (PRD §4 step 3).
    await expect(dialog.getByText(t(lang, 'onboarding:push.title'))).toBeVisible()
    await page.locator('input[type=file]').setInputFiles({ name: 'sales.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('PK\u0003\u0004') })
    await expect(dialog.getByRole('alert')).toContainText(t(lang, 'onboarding:data.notCsv', { name: 'sales.xlsx' }))
    await expect(upload).toBeDisabled()
    await checkPhoneLayout(page, isMobile, 'data')

    await page.locator('input[type=file]').setInputFiles(SAMPLE_CSV)
    await upload.click()
  })

  await test.step('mapping: an unmapped required column blocks Confirm', async () => {
    const confirm = dialog.getByRole('button', { name: t(lang, 'onboarding:mapping.confirm') })
    await expect(confirm).toBeEnabled()
    // The proposal fixes the region spellings (PRD §6.2 example: Jabar -> Jawa Barat).
    await expect(dialog.getByLabel(t(lang, 'onboarding:mapping.fixTarget', { from: 'Jabar' }))).toHaveValue('Jawa Barat')
    await expect(dialog.getByLabel(t(lang, 'onboarding:mapping.fixTarget', { from: 'JAWA BARAT' }))).toHaveValue('Jawa Barat')

    const netColumn = dialog.getByRole('combobox', { name: t(lang, 'onboarding:mapping.readAsFor', { header: 'net_sales_idr' }) })
    await netColumn.click()
    await page.getByRole('option', { name: t(lang, 'onboarding:mapping.ignore') }).click()
    await expect(confirm).toBeDisabled()
    await expect(dialog.getByRole('alert')).toContainText(t(lang, 'onboarding:columns.net_sales_idr'))
    await checkPhoneLayout(page, isMobile, 'mapping')

    await netColumn.click()
    await page.getByRole('option', { name: t(lang, 'onboarding:mapping.requiredOption', { column: t(lang, 'onboarding:columns.net_sales_idr') }) }).click()
    await expect(confirm).toBeEnabled()
    await confirm.click()
  })

  await test.step('quality report shows the PRD numbers before the data is accepted', async () => {
    await expect(dialog.getByText(t(lang, 'onboarding:quality.title'))).toBeVisible()
    await expect(dialog).toContainText(int(GOLDEN.rowsRead, lang))
    await expect(dialog).toContainText(int(GOLDEN.rowsClean, lang))
    await expect(dialog).toContainText(GOLDEN.duplicateRows.map((r) => int(r, lang)).join(', '))
    await expect(dialog).toContainText(lang === 'id' ? '-Rp 528.000' : '-IDR 528,000')
    await checkPhoneLayout(page, isMobile, 'quality')
    // Accepting the data is not the end of the gate: a reload still shows onboarding, not the dashboard.
    await page.reload()
    await expectStillGated(page, lang)
    await dialog.getByRole('button', { name: t(lang, 'onboarding:quality.confirm') }).click()
  })

  await test.step('Telegram: empty fields and a rejected token keep the gate closed', async () => {
    const send = dialog.getByRole('button', { name: t(lang, 'onboarding:telegram.send') })
    await send.click()
    await expect(dialog.getByText(t(lang, 'onboarding:telegram.errors.token'))).toBeVisible()
    await expect(dialog.getByText(t(lang, 'onboarding:telegram.errors.chat'))).toBeVisible()

    await dialog.getByLabel(t(lang, 'onboarding:telegram.token'), { exact: true }).fill('123:wrong')
    await dialog.getByLabel(t(lang, 'onboarding:telegram.chatId'), { exact: true }).fill('42')
    await send.click()
    await expect(dialog.getByRole('alert')).toContainText(t(lang, 'onboarding:errors.telegram.unauthorized'))
    await checkPhoneLayout(page, isMobile, 'telegram')

    await page.reload()
    await expectStillGated(page, lang)
    await expect(dialog.getByText(t(lang, 'onboarding:telegram.title'))).toBeVisible()
    await dialog.getByLabel(t(lang, 'onboarding:telegram.token'), { exact: true }).fill('123:mock')
    await dialog.getByLabel(t(lang, 'onboarding:telegram.chatId'), { exact: true }).fill('42')
    await send.click()
  })

  await test.step('the dashboard opens', async () => {
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('weak-row')).toHaveCount(5)
    const state = await (await request.get('/api/state')).json()
    expect(state.onboarded).toBe(true)
    expect(state.lang).toBe(lang)
    expect(await untranslatedText(page)).toEqual([])
  })

  expect(errors).toEqual([])
})
