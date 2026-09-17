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
  // Typing a year opens the precise timeline, centred on it.

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

/*
 * Each of these was a real defect found by driving the live site with a mouse:
 * the unit tests passed while the button, the steppers and a drag misbehaved.
 */

test('collapse works with the pointer still resting on the button', async ({ page }) => {
  await opened(page)
  await page.getByRole('button', { name: 'Expand timeline' }).click()
  await expect(page.getByTestId('detail-track')).toBeVisible()

  // Same pointer, same spot, no movement away.
  await page.getByRole('button', { name: 'Collapse timeline' }).click()
  await expect(page.getByTestId('detail-track')).toBeHidden()
})

test('a one-year step does not unfold the timeline or move the stepper', async ({ page }) => {
  await opened(page)
  const forward = page.getByRole('button', { name: 'Forward one year' })
  const before = (await forward.boundingBox())!

  await forward.click()
  await forward.click()

  await expect(page.getByTestId('detail-track')).toBeHidden()
  const after = (await forward.boundingBox())!
  expect(after.y).toBe(before.y)
})

test('the detail handle stays where the pointer lets go', async ({ page }) => {
  await opened(page)
  await typeYear(page, '1500')
  // Typing a year opens the precise timeline, centred on it.

  const detail = page.getByTestId('detail-track')
  const box = (await detail.boundingBox())!
  const x = box.x + box.width * 0.85
  await page.mouse.move(box.x + box.width * 0.8, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(x, box.y + 10, { steps: 4 })
  await page.mouse.up()

  const handle = (await page.locator('.timeline__detail-handle').boundingBox())!
  expect(Math.abs(handle.x + handle.width / 2 - x)).toBeLessThanOrEqual(8)
})

test('dragging across a track, even past its edge, selects no text', async ({ page }) => {
  await opened(page)
  await typeYear(page, '1500')

  // Starts on the overview's era labels and sweeps over the detail ruler's
  // decade labels and out past its edge: the path a real scrub takes.
  const detail = (await page.getByTestId('detail-track').boundingBox())!
  await page.mouse.move(detail.x + detail.width * 0.2, detail.y + 10)
  await page.mouse.down()
  await page.mouse.move(detail.x + detail.width + 80, detail.y + 30, { steps: 10 })
  await page.mouse.up()

  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
})

test('the expand button is not buried under an open figure panel', async ({ page }) => {
  await opened(page)
  // Every tour stop opens this panel. It used to overlap the dock's top-right
  // corner; the columns now end above the dock, and this keeps it that way.
  await page.locator('.pin').first().click()
  await expect(page.locator('.panel')).toBeVisible()

  const button = page.getByRole('button', { name: 'Expand timeline' })
  const box = (await button.boundingBox())!
  const topmost = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('.timeline__pin') !== null,
    [box.x + box.width / 2, box.y + box.height / 2],
  )
  expect(topmost).toBe(true)
})
