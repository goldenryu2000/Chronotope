import { expect, test, type Page } from '@playwright/test'

/**
 * The precise timeline, driven the way a reader would drive it.
 *
 * The unit tests prove the arithmetic and the state; these prove it survives a
 * real layout: widths, pointer capture, the idle timer and the map behind it.
 */

async function opened(page: Page) {
  await page.goto('/world/philosophy')
  // The controls only exist once the map is built, same signal as atlas.spec.ts.
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
}

const yearNow = (page: Page) =>
  page.locator('[data-testid="timeline-track"]').getAttribute('aria-valuenow').then(Number)

async function typeYear(page: Page, text: string) {
  await page.getByRole('button', { name: /type a year/i }).click()
  const input = page.getByTestId('year-input')
  await input.fill(text)
  await input.press('Enter')
}

test('typing a year lands exactly on it', async ({ page }) => {
  await opened(page)
  await typeYear(page, '1492')
  await expect(page.getByTestId('year-readout')).toHaveText('1492 CE')

  await typeYear(page, '350 BC')
  await expect(page.getByTestId('year-readout')).toHaveText('350 BCE')
})

test('the steppers move exactly one year', async ({ page }) => {
  await opened(page)
  await typeYear(page, '1000')
  await page.getByRole('button', { name: 'Forward one year' }).click()
  await expect(page.getByTestId('year-readout')).toHaveText('1001 CE')
  await page.getByRole('button', { name: 'Back one year' }).click()
  await page.getByRole('button', { name: 'Back one year' }).click()
  await expect(page.getByTestId('year-readout')).toHaveText('999 CE')
})

test('next landmark goes to the moment it names', async ({ page }) => {
  await opened(page)
  await typeYear(page, '1480')

  const next = page.getByRole('button', { name: /^Next landmark,/ })
  const label = (await next.getAttribute('aria-label'))!
  // "Next landmark, 1492 CE: Borders redraw" -> 1492
  const named = Number(/, (\d+) (CE|BCE):/.exec(label)![1])
  expect(named).toBeGreaterThan(1480)

  await next.click()
  expect(await yearNow(page)).toBe(named)
})

test('the detail track lands within a year of where it is clicked', async ({ page }) => {
  await opened(page)
  await typeYear(page, '1500')
  await page.getByRole('button', { name: /keep the precise timeline open/i }).click()

  const detail = page.getByTestId('detail-track')
  await expect(detail).toBeVisible()
  const box = (await detail.boundingBox())!

  // The window is 1440 to 1560, so a quarter of the way in is 1470.
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2)
  expect(Math.abs((await yearNow(page)) - 1470)).toBeLessThanOrEqual(1)
})

test('the expanded timeline folds away once left alone', async ({ page }) => {
  await opened(page)
  const track = page.locator('[data-testid="timeline-track"]')
  await track.click({ position: { x: 400, y: 10 } })
  await expect(page.getByTestId('detail-track')).toBeVisible()

  // Pointer off the timeline, and focus off it, then wait out the idle clock.
  await page.mouse.move(700, 200)
  await page.locator('body').click({ position: { x: 700, y: 200 } })
  await expect(page.getByTestId('detail-track')).toBeHidden({ timeout: 6000 })
})
