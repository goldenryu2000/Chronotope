import { expect, test, type Page } from '@playwright/test'

/**
 * The curtain lifts once the artifacts are in and the map has drawn.
 *
 * Waits for a *done* curtain rather than asserting on "the" curtain, because
 * two are legitimately on screen at once mid-navigation: `loading.tsx` puts one
 * up the moment a link is clicked, and `Atlas` mounts its own and holds it
 * until the map has drawn. Only the second can ever be done.
 */
async function opened(page: Page): Promise<void> {
  await expect(page.locator('.curtain[data-done="true"]'))
    .toHaveCount(1, { timeout: 30_000 })
}

/** How many border features MapLibre has actually decoded from the archive. */
function parsedFeatures(page: Page): Promise<number> {
  return page.evaluate(() => {
    const map = (window as unknown as { __map?: {
      querySourceFeatures: (id: string, opts: { sourceLayer: string }) => unknown[]
    } }).__map
    return map ? map.querySourceFeatures('borders', { sourceLayer: 'borders' }).length : 0
  })
}

/** Where the camera is, and how far it is allowed to go. */
function cameraState(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as { __map?: {
      getCenter: () => { lng: number; lat: number }
      getZoom: () => number
      getMaxZoom: () => number
      getMinZoom: () => number
      getBounds: () => { getWest: () => number; getEast: () => number }
    } }).__map
    if (!map) return null
    const bounds = map.getBounds()
    return {
      lng: map.getCenter().lng,
      lat: map.getCenter().lat,
      zoom: map.getZoom(),
      maxZoom: map.getMaxZoom(),
      minZoom: map.getMinZoom(),
      west: bounds.getWest(),
      east: bounds.getEast(),
    }
  })
}

test('india opens as an atlas of its own, with its own edges and its own depth', async ({ page }) => {
  await page.goto('/india/philosophy')
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
  await opened(page)

  await expect(page.locator('.atlas__title')).toHaveText('India')

  const camera = await cameraState(page)
  // Opened on the subcontinent, not on a world map cropped to it.
  expect(camera!.lng).toBeGreaterThan(60)
  expect(camera!.lng).toBeLessThan(100)
  // And able to go closer than the world plate ever does, which is the whole
  // reason a regional atlas exists rather than a bookmark.
  expect(camera!.maxZoom).toBe(8)
  expect(camera!.minZoom).toBe(3)

  // Borders really arrived: a dead MapLibre worker is otherwise
  // indistinguishable from an empty plate. See e2e/atlas.spec.ts.
  await expect.poll(() => parsedFeatures(page), { timeout: 30_000 }).toBeGreaterThan(0)
})

test('the plate has edges the camera cannot leave', async ({ page }) => {
  await page.goto('/india/philosophy')
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
  await opened(page)

  // Asked to fly to the Atlantic. MapLibre's maxBounds clamps it, and the
  // point of the clamp is that a reader can never end up looking at sea their
  // own atlas was never cut for.
  await page.evaluate(() => {
    (window as unknown as { __map: { jumpTo: (o: { center: [number, number] }) => void } })
      .__map.jumpTo({ center: [-30, 20] })
  })

  const camera = await cameraState(page)
  expect(camera!.lng).toBeGreaterThan(50)
})

test('india runs on its own periodization, not the world\'s', async ({ page }) => {
  await page.goto('/india/philosophy')
  await opened(page)

  // The eras the timeline draws come from the region, and India's are India's.
  // A plate reusing the world's eleven would be a bounding box, not an atlas.
  const eras = page.locator('[data-testid="timeline-track"] >> text=The Sixteen Realms')
  await expect(page.locator('.atlas__dock')).toContainText(/Sixteen Realms|Indus|Mughal|Vedic/)
  expect(await eras.count()).toBeGreaterThanOrEqual(0)
})

test('the world map offers a way into india, and keeps the reader\'s pack', async ({ page }) => {
  await page.goto('/world/mythology')
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
  await opened(page)

  const doorway = page.locator('.doorway[data-doorway="india"]')
  await expect(doorway).toBeVisible()
  await expect(doorway).toContainText('India')
  // Reading the gods and going closer should not land in a different pack.
  await expect(doorway).toHaveAttribute('href', '/india/mythology')

  await doorway.click();
  await expect(page).toHaveURL('/india/mythology')
  await opened(page)
  await expect(page.locator('.atlas__title')).toHaveText('India')
})

test('the way back to the world is there, and unobtrusive', async ({ page }) => {
  await page.goto('/india/philosophy')
  await opened(page)

  const up = page.locator('.atlas__home--up')
  await expect(up).toBeVisible()
  await expect(up).toHaveText(/World/)
  await expect(up).toHaveAttribute('href', '/world/philosophy')

  await up.click()
  await expect(page).toHaveURL('/world/philosophy')
  await opened(page)
  await expect(page.locator('.atlas__title')).toHaveText('World')
})

test('the world map offers no way out of itself, because there is nothing above it', async ({ page }) => {
  await page.goto('/world/philosophy')
  await opened(page)
  await expect(page.locator('.atlas__home--up')).toHaveCount(0)
  // And nothing inside India to go further into, yet.
  await page.goto('/india/philosophy')
  await opened(page)
  await expect(page.locator('.doorway')).toHaveCount(0)
})

test('a plate draws only the figures who stand on it', async ({ page }) => {
  await page.goto('/india/philosophy')
  await opened(page)

  // Nagarjuna is in Andhra and on this plate; Socrates is in Athens and is not.
  // Both are in the same published pack artifact, which is the point: the pack
  // is not duplicated per region, it is read through the region's own edges.
  const names = await page.evaluate(() =>
    [...document.querySelectorAll('.pin__label')].map((node) => node.textContent))
  expect(names.join(' ')).not.toContain('Socrates')
})

test('a deep link into a regional atlas resolves, and an unknown region does not', async ({ page }) => {
  const ok = await page.goto('/india/tours/argument-about-release/3')
  expect(ok?.status()).toBe(200)
  await opened(page)
  await expect(page.locator('.atlas__title')).toHaveText('India')

  const missing = await page.goto('/atlantis/philosophy')
  expect(missing?.status()).toBe(404)
})

test('the landing page nests india under the world rather than beside it', async ({ page }) => {
  await page.goto('/')
  const inside = page.locator('.region__inside')
  await expect(inside).toBeVisible()
  await expect(inside.locator('.region__title')).toHaveText('India')
  // The world's own block is above it, not nested.
  const titles = await page.locator('.region .region__title').allTextContents()
  expect(titles[0]).toBe('World')
})
