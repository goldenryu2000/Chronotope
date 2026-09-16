import { expect, test } from '@playwright/test'

test('an entity page renders its facts server-side', async ({ page }) => {
  const response = await page.goto('/world/philosophy/laozi')
  expect(response!.status()).toBe(200)
  await expect(page.locator('h1')).toHaveText('Laozi')
  await expect(page.locator('body')).toContainText('State of Chu')
  await expect(page).toHaveTitle(/Laozi/)
})

test('an unknown entity is a 404, not a blank page', async ({ page }) => {
  const response = await page.goto('/world/philosophy/nobody')
  expect(response!.status()).toBe(404)
})

/**
 * The entity page had no navigation at all: no way back to the map it belongs
 * to, and no way home. It is a dead end reached from a pin.
 */
test('an entity page can get back to its atlas', async ({ page }) => {
  await page.goto('/world/philosophy/laozi')

  const back = page.locator('.entity__back')
  await expect(back).toBeVisible()

  await back.click()
  await expect(page).toHaveURL(/\/world\/philosophy$/)
})

/**
 * The entity page paints no background of its own, so it was the one screen
 * where Next's leftover `prefers-color-scheme` boilerplate still won: it
 * followed the operating system while every other screen followed the toggle.
 */
test('an entity page follows the chosen theme', async ({ page }) => {
  await page.goto('/')
  await page.locator('.theme-toggle').click()

  await page.goto('/world/philosophy/laozi')
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('slate')

  // The attribute alone is not the claim; the page has to actually be dark.
  const paper = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(paper).not.toBe('rgb(255, 255, 255)')
})
