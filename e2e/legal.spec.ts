import { expect, test } from '@playwright/test'

test('credits name every source the site draws on', async ({ page }) => {
  const response = await page.goto('/credits')
  expect(response!.status()).toBe(200)
  for (const text of ['historical-basemaps', 'GPL-3.0', 'Natural Earth', 'Wikidata', 'Wikimedia Commons', 'MapLibre']) {
    await expect(page.locator('main')).toContainText(text)
  }
  await expect(page.locator('main')).not.toContainText('—')
})

test('the privacy notice says what is and is not collected', async ({ page }) => {
  const response = await page.goto('/privacy')
  expect(response!.status()).toBe(200)
  await expect(page.locator('main')).toContainText('no cookies')
  await expect(page.locator('main')).not.toContainText('—')
})

test('the landing page links to both', async ({ page }) => {
  await page.goto('/')
  await page.locator('.home__footer').getByRole('link', { name: 'Credits' }).click()
  await expect(page).toHaveURL(/\/credits$/)
  await page.goto('/')
  await page.locator('.home__footer').getByRole('link', { name: 'Privacy' }).click()
  await expect(page).toHaveURL(/\/privacy$/)
})

test('an entity page links to the credits', async ({ page }) => {
  await page.goto('/world/philosophy/laozi')
  await expect(page.getByRole('link', { name: 'Credits' })).toHaveAttribute('href', '/credits')
})
