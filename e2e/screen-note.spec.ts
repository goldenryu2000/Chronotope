import { expect, test } from '@playwright/test'

/**
 * The site is built for desktop screens. On a phone it says so, quietly, and
 * never gets in the way: the note is click-through and absent at desktop widths.
 */

test('a desktop screen does not see the phone notice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.locator('.screen-note')).toBeHidden()
})

test('a phone screen sees the notice, and taps pass through it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const note = page.locator('.screen-note')
  await expect(note).toBeVisible()
  await expect(note).toHaveText('Chronotope is made for desktop screens. Phones are not supported yet.')
  expect(await note.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')
})

test('the landing footer says what screen the site is made for', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home__footer')).toContainText('Best viewed on a desktop or laptop screen.')
})
