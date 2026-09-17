import { expect, test } from '@playwright/test'

test('the landing page groups packs under the map they are drawn on', async ({ page }) => {
  await page.goto('/')

  const region = page.locator('.region').first()
  await expect(region.locator('.region__title')).toHaveText(/\S/)

  // The grouping is the point: a pack is a choice inside a region now, so the
  // region is what is being chosen and its packs are the ways in.
  await expect(region.locator('.card')).not.toHaveCount(0)
})

test('every atlas offered actually opens', async ({ page }) => {
  await page.goto('/')

  // Scoped to the atlas section. The tours section below it draws the same
  // card, and its hrefs are three segments rather than two, so an unscoped
  // query would fail the shape assertion on a link that is perfectly correct.
  const hrefs = await page.locator('.section--atlases .card').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href') ?? ''))
  expect(hrefs.length).toBeGreaterThan(0)

  /*
   * The end-to-end form of what `publishedAtlases` filters for.
   *
   * `/[region]/[pack]` 404s unless both the region and the pack have a current
   * published artifact, and the query's two `isNotNull` clauses exist to match
   * that exactly. Getting either wrong lists a door that does not open, which
   * no amount of the page rendering correctly would reveal.
   */
  for (const href of hrefs) {
    expect(href).toMatch(/^\/[^/]+\/[^/]+$/)
    const response = await page.request.get(href)
    expect(response.status(), `${href} is offered but does not open`).toBe(200)
  }
})

/**
 * The hero's claim is that the borders behind the title are the real thing,
 * at three different years. If the plate ever renders empty the page still
 * looks fine — a plain hero — which is exactly why it needs asserting.
 */
test('the hero draws three real border plates', async ({ page }) => {
  await page.goto('/')

  const frames = page.locator('.plate__frame')
  await expect(frames).toHaveCount(3)

  // Real path data, not an empty `d` that would render nothing.
  for (const d of await frames.evaluateAll((paths) =>
    paths.map((path) => path.getAttribute('d') ?? ''))) {
    expect(d.startsWith('M')).toBe(true)
    expect(d.length).toBeGreaterThan(2_000)
  }

  // Three distinct years, which is what makes the dissolve mean anything.
  const years = await page.locator('.plate__year').allTextContents()
  expect(new Set(years).size).toBe(3)
})

/**
 * The first screen has to say what this is and offer one obvious way in,
 * without scrolling.
 */
test('the first screen offers a way into the atlas and a tour', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')

  await expect(page.locator('h1')).toHaveCount(1)
  const primary = page.locator('.hero .button--primary')
  await expect(primary).toBeInViewport()
  const href = await primary.getAttribute('href')
  expect(href).toMatch(/^\/[^/]+\/[^/]+$/)
  expect((await page.request.get(href!)).status()).toBe(200)

  const secondary = page.locator('.hero .button--secondary')
  await expect(secondary).toBeInViewport()
  await secondary.click()
  await expect(page.locator('#tours')).toBeInViewport()
})

/**
 * Pins appear on the plate, and every picture on the page is a file this site
 * serves. Only images that need no caption are shown here, so each one must
 * actually load rather than leave a broken frame.
 */
test('the pictures on the landing page load from this site', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.plate__pin')).not.toHaveCount(0)

  const images = page.locator('.home img')
  expect(await images.count()).toBeGreaterThan(0)
  for (const src of await images.evaluateAll((list) =>
    list.map((img) => img.getAttribute('src') ?? ''))) {
    expect(src).toMatch(/^\/images\/[^/]+\/[^/]+\.jpg$/)
    expect((await page.request.get(src)).status(), `${src} does not load`).toBe(200)
  }

  // Alt text on every picture a reader can reach; the plate is decorative.
  for (const alt of await page.locator('.section img').evaluateAll((list) =>
    list.map((img) => img.getAttribute('alt') ?? ''))) {
    expect(alt).toMatch(/^Depiction of \S/)
  }
})

test('the landing copy uses no em dashes', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.home')).not.toContainText('\u2014')
})

test('every tour offered actually opens', async ({ page }) => {
  await page.goto('/')

  const hrefs = await page.locator('.section--tours .card').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href') ?? ''))
  expect(hrefs.length).toBeGreaterThan(0)

  /*
   * The end-to-end form of what `publishedTours` filters for.
   *
   * `/[region]/tours/[tour]` 404s unless the tour has a current published
   * version, and the query's join on `current_version_id` exists to match that
   * exactly. A tour seeded but never published would otherwise be listed as a
   * door that does not open, which the page rendering perfectly well would
   * never reveal.
   */
  for (const href of hrefs) {
    expect(href).toMatch(/^\/[^/]+\/tours\/[^/]+$/)
    const response = await page.request.get(href)
    expect(response.status(), `${href} is offered but does not open`).toBe(200)
  }
})

/**
 * A feature that ships has to leave the roadmap in the same change.
 *
 * The risk is not that "Guided tours" lingers under a heading saying it does
 * not exist; it is that it lingers there *and* nowhere else, so a built
 * feature is described to the reader as unbuilt.
 */
test('guided tours have left the roadmap and arrived somewhere clickable', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('.coming__item', { hasText: 'Guided tours' })).toHaveCount(0)
  await expect(page.locator('.section--tours .card').first()).toBeVisible()
})

test('the atlas offers a way into the tours, even with a panel open', async ({ page }) => {
  await page.goto('/world/philosophy')
  await expect(page.locator('.curtain')).toHaveAttribute('data-done', 'true', { timeout: 30_000 })

  /*
   * With the detail panel open, which is the state that has buried chrome in
   * this corner twice before. The panel starts below the chrome cluster for
   * exactly this reason, and a real click is the only thing that proves it:
   * a dispatched event reaches a handler through anything painted on top.
   */
  await page.locator('.pin').first().click()
  await expect(page.locator('.panel')).toBeVisible()

  await page.locator('.atlas__tours').click()
  await expect(page).toHaveURL('/world/tours')
  await expect(page.locator('.tours-index__link').first()).toBeVisible()
})

/**
 * A landing page may describe what is coming. It may not imply it is here.
 *
 * These are real roadmap items with no implementation behind them, so the one
 * way this section can do harm is by looking clickable.
 */
test('nothing in the unbuilt section pretends to be a link', async ({ page }) => {
  await page.goto('/')

  const coming = page.locator('.coming')
  await expect(coming.locator('a, button')).toHaveCount(0)
  await expect(coming.locator('.coming__item')).not.toHaveCount(0)
})

/**
 * The roadmap is a promise, so it says how far along each item is: what is
 * already underway apart from what is only planned.
 */
test('the roadmap separates what is in the works from what is planned', async ({ page }) => {
  await page.goto('/')

  const section = page.getByRole('region', { name: 'Coming to Chronotope' })
  await expect(section.getByRole('heading', { name: 'In the works' })).toBeVisible()
  await expect(section.getByRole('heading', { name: 'Planned' })).toBeVisible()
  await expect(section.locator('.coming__item')).toHaveCount(6)

  await expect(section.locator('.coming__item[data-status="in-works"]')).toHaveText(/India, up close/)
  await expect(section.locator('.coming__item[data-status="planned"]')).toHaveCount(5)

  // Dropped from the roadmap: not exciting enough to promise.
  for (const gone of ['Accounts', 'Search']) {
    await expect(section.getByText(gone, { exact: true })).toHaveCount(0)
  }
})

const themeOf = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.dataset.theme ?? '')

/**
 * A theme chosen anywhere holds everywhere.
 *
 * Every token lives under `[data-theme]`, so each screen used to hardcode one
 * on a wrapper: the landing page and the loading curtain were pinned to
 * rustic no matter what the reader had picked on the map.
 */
test('a theme picked on the landing page survives into the atlas', async ({ page }) => {
  await page.goto('/')
  expect(await themeOf(page)).toBe('rustic')

  await page.locator('.theme-toggle').click()
  expect(await themeOf(page)).toBe('slate')

  await page.locator('.card').first().click()
  await expect(page).toHaveURL(/\/world\/[a-z]+$/)

  // Including the curtain that covers the wait, which is drawn before any of
  // the atlas's own code has run.
  expect(await themeOf(page)).toBe('slate')
  await expect(page.locator('.curtain')).toHaveAttribute('data-done', 'true', { timeout: 30_000 })
  expect(await themeOf(page)).toBe('slate')
})

test('a theme picked on the atlas survives back to the landing page', async ({ page }) => {
  await page.goto('/world/philosophy')
  await expect(page.locator('.curtain')).toHaveAttribute('data-done', 'true', { timeout: 30_000 })
  expect(await themeOf(page)).toBe('rustic')

  await page.locator('.theme-toggle').click()
  expect(await themeOf(page)).toBe('slate')

  await page.locator('.atlas__home').click()
  await expect(page.locator('.hero__title')).toBeVisible()
  expect(await themeOf(page)).toBe('slate')

  // And on a cold load, before any JavaScript of ours has run: the bootstrap
  // in the root layout is what stops a light page flashing before a dark one.
  await page.reload()
  expect(await themeOf(page)).toBe('slate')
})
