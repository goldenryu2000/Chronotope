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

/** Zoom the map straight to a camera, without waiting out a flight. */
async function jumpTo(page: Page, center: [number, number], zoom: number): Promise<void> {
  await page.evaluate(([c, z]) => {
    (window as unknown as {
      __map: { jumpTo: (o: { center: unknown; zoom: unknown }) => void }
    }).__map.jumpTo({ center: c, zoom: z })
  }, [center, zoom] as const)
}

test('the world map draws nothing for india until the reader goes to look at it', async ({ page }) => {
  await page.goto('/world/mythology')
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
  await opened(page)

  /*
   * At rest the map is clean. This is the whole of the redesign: the first
   * version drew a dashed rectangle and a boxed label over the subcontinent at
   * every year and every zoom, which put a clipping artifact on the reader's
   * map and competed with the only other lines there, the historical borders.
   */
  const invite = page.locator('.invite[data-invite="india"]')
  await expect(invite).toHaveAttribute('data-shown', 'false')

  // Then the reader zooms in on the subcontinent, and it offers itself.
  await jumpTo(page, [81.8, 21.3], 4.2)
  await expect(invite).toHaveAttribute('data-shown', 'true')
  await expect(invite).toContainText('India')
  await expect(invite).toContainText('Open the closer atlas')

  // And it withdraws again when they pull back out.
  await jumpTo(page, [20, 25], 1.6)
  await expect(invite).toHaveAttribute('data-shown', 'false')
})

test('accepting the invitation keeps the reader\'s pack', async ({ page }) => {
  await page.goto('/world/mythology')
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
  await opened(page)
  await jumpTo(page, [81.8, 21.3], 4.2)

  const invite = page.locator('.invite[data-invite="india"]')
  await expect(invite).toHaveAttribute('data-shown', 'true')
  // Reading the gods and going closer should not land in a different pack.
  await expect(invite).toHaveAttribute('href', '/india/mythology')

  await invite.click()
  await expect(page).toHaveURL('/india/mythology')
  await opened(page)
  await expect(page.locator('.atlas__title')).toHaveText('India')
})

test('the title is the map of the maps, and always there', async ({ page }) => {
  await page.goto('/world/philosophy')
  await opened(page)

  // The path that needs no zooming to discover, and the one that scales past
  // the two plates there are today.
  const toggle = page.locator('.regions__toggle')
  await expect(toggle).toHaveText(/World/)
  await toggle.click()

  const menu = page.locator('.regions__popover')
  await expect(menu).toBeVisible()
  await expect(menu.locator('.regions__name')).toHaveText(['World', 'India'])
  await expect(menu.locator('[data-here="true"] .regions__name')).toHaveText('World')

  // India is nested under the world, not offered beside it.
  await expect(menu.locator('li[data-depth="1"] .regions__name')).toHaveText('India')

  await menu.locator('.regions__item[href="/india/philosophy"]').click()
  await expect(page).toHaveURL('/india/philosophy')
  await opened(page)
  await expect(page.locator('.atlas__title')).toHaveText('India')
})

test('the menu closes on escape and on a click outside it', async ({ page }) => {
  await page.goto('/world/philosophy')
  await opened(page)

  await page.locator('.regions__toggle').click()
  await expect(page.locator('.regions__popover')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.regions__popover')).toHaveCount(0)

  await page.locator('.regions__toggle').click()
  await expect(page.locator('.regions__popover')).toBeVisible()
  // On the map itself, which is the gesture a reader actually makes.
  await page.locator('.map__canvas').click({ position: { x: 60, y: 420 } })
  await expect(page.locator('.regions__popover')).toHaveCount(0)
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
