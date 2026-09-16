import { expect, test, type Page } from '@playwright/test'

/**
 * The philosophy pack, because it opens at 350 BCE and the alphabet layer is
 * valid from 1200 BCE to 400 CE. A layer that draws the moment it is lit is
 * what these tests are about; a layer whose years the opening cursor misses
 * would pass an "is it lit" assertion while drawing nothing at all.
 */
const ATLAS = '/world/philosophy'

/** The layer this file exercises, and the ids MapCanvas gives it. */
const SLUG = 'alphabets'
const NAME = 'Spread of Alphabets'
const LINE = `layer-line-${SLUG}`

/**
 * A handle on the live map. `window.__map` is set unconditionally in
 * MapCanvas.tsx; see the comment there for why it is not dev-gated.
 *
 * Asking MapLibre rather than the DOM is the whole point: a canvas has no
 * elements to query, so "the route is on the map" is a question only the map
 * can answer. A screenshot would answer it too, and would also fail on a font
 * change.
 */
interface MapHandle {
  areTilesLoaded(): boolean
  getStyle(): { layers: Array<{ id: string }> }
  getLayer(id: string): unknown
  getLayoutProperty(id: string, name: string): unknown
  getPaintProperty(id: string, name: string): unknown
  querySourceFeatures(id: string): unknown[]
}

/** Whether the layer's line is on the map and switched on. */
const drawing = (page: Page): Promise<boolean> =>
  page.evaluate((id) => {
    const map = (window as unknown as { __map?: MapHandle }).__map
    if (!map || !map.getLayer(id)) return false
    return map.getLayoutProperty(id, 'visibility') === 'visible'
  }, LINE)

/**
 * Whether the layer's line exists on the map at all, lit or not.
 *
 * Deliberately not `querySourceFeatures`: MapLibre cuts a GeoJSON source into
 * tiles only for a *visible* layer, so a hidden one parses nothing and that
 * probe reports zero however well the fetch went.
 */
const added = (page: Page): Promise<boolean> =>
  page.evaluate((id) => {
    const map = (window as unknown as { __map?: MapHandle }).__map
    return Boolean(map?.getLayer(id))
  }, LINE)

/** The colour the line is painted, as MapLibre resolved it. */
const lineColour = (page: Page): Promise<string> =>
  page.evaluate((id) => {
    const map = (window as unknown as { __map?: MapHandle }).__map
    return map?.getLayer(id) ? String(map.getPaintProperty(id, 'line-color')) : ''
  }, LINE)

/** How many features the layer's GeoJSON source actually parsed. */
const parsedFeatures = (page: Page): Promise<number> =>
  page.evaluate((id) => {
    const map = (window as unknown as { __map?: MapHandle }).__map
    return map ? map.querySourceFeatures(id).length : 0
  }, `layer-source-${SLUG}`)

/**
 * Wait for the opening curtain to lift.
 *
 * It is fixed over the whole viewport until the map has drawn, so anything
 * that clicks before this is clicking the curtain.
 */
async function opened(page: Page): Promise<void> {
  await expect(page.locator('.curtain'))
    .toHaveAttribute('data-done', 'true', { timeout: 30_000 })
}

/** Open the layer menu and hand back the layer's checkbox. */
async function menu(page: Page) {
  await page.getByRole('button', { name: 'Layers' }).click()
  return page.getByRole('checkbox', { name: NAME })
}

/** How many layer lines exist on the map at all, lit or hidden. */
const linesOnMap = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const map = (window as unknown as { __map?: MapHandle }).__map
    return map ? map.getStyle().layers.filter((layer) => layer.id.startsWith('layer-line-')).length : -1
  })

test('lighting a layer fetches its artifact once and draws it', async ({ page }) => {
  // Counted from before the page loads. The listener used to be attached after
  // `goto`, so a regression back to fetching all nine layers up front would
  // have made its requests before anything was listening, and passed.
  const layerRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/artifacts/layers/')) layerRequests.push(request.url())
  })

  await page.goto(ATLAS)
  await opened(page)
  await page.waitForFunction(() =>
    (window as unknown as { __map?: MapHandle }).__map?.areTilesLoaded())

  // Nothing fetched and nothing added before the reader asks. Asking whether
  // the alphabet line is *drawn* was the old check, and it passes on a build
  // that eagerly adds all nine hidden: hidden is not drawn.
  expect(layerRequests).toEqual([])
  expect(await linesOnMap(page)).toBe(0)

  const box = await menu(page)
  await box.check()

  await expect.poll(() => drawing(page), { timeout: 15_000 }).toBe(true)

  // Drawn, not merely added: an empty FeatureCollection would satisfy every
  // assertion above and put no line on the map. Polled because a GeoJSON
  // source reports its features per tile, and the tiles are cut on a worker
  // some frames after `addSource` returns.
  await expect.poll(() => parsedFeatures(page), { timeout: 15_000 }).toBeGreaterThan(0)

  // One artifact for one layer, and the right one. The count is the point,
  // because the fetch is guarded by a ref that a re-render could defeat.
  expect(layerRequests).toHaveLength(1)
  expect(layerRequests[0]).toContain(`/artifacts/layers/${SLUG}/`)
  expect(await linesOnMap(page)).toBe(1)

  // Toggling it off again keeps the geometry and only hides it, so a second
  // toggle costs nothing over the wire.
  await box.uncheck()
  await expect.poll(() => drawing(page)).toBe(false)
  await box.check()
  await expect.poll(() => drawing(page)).toBe(true)
  expect(layerRequests).toHaveLength(1)
})

test('a lit layer marks its years on the timeline', async ({ page }) => {
  await page.goto(ATLAS)
  await opened(page)

  // No layer lit, no row at all: an empty strip would be a promise of nothing.
  await expect(page.locator('[data-testid="layer-spans"]')).toHaveCount(0)

  const box = await menu(page)
  await box.check()

  // One lane per lit layer, not one blended bar. Nothing else in the suite
  // covers the wiring from the store through `Atlas` into `Timeline`, so
  // without this a filter that passed every layer through, lit or not, would
  // ship green.
  await expect(page.locator('.timeline__layer-lane')).toHaveCount(1)

  const band = page.locator('.timeline__layer-span').first()
  await expect(band).toHaveAttribute('title', /^Spread of Alphabets: /)

  await box.uncheck()
  await expect(page.locator('[data-testid="layer-spans"]')).toHaveCount(0)
})

test('a lit layer stops drawing outside its years, and says so', async ({ page }) => {
  await page.goto(ATLAS)
  await opened(page)

  const box = await menu(page)
  await box.check()
  await expect.poll(() => drawing(page), { timeout: 15_000 }).toBe(true)

  // The alphabet layer ends in 400 CE. `End` puts the cursor at the last year
  // the region covers, which is well past that.
  const readout = page.locator('[data-testid="year-readout"]')
  const before = await readout.textContent()
  await page.locator('[data-testid="timeline-track"]').focus()
  await page.keyboard.press('End')
  await expect(readout).not.toHaveText(before!)

  await expect.poll(() => drawing(page)).toBe(false)

  // Still lit. The checkbox is the reader's answer and the map does not get to
  // overrule it — the menu explains the gap instead of silently unchecking,
  // which is the difference between "you asked for nothing" and "there is
  // nothing there yet".
  await expect(box).toBeChecked()
  await expect(page.getByText('long gone')).toBeVisible()

  // Back inside its years, it draws again with no second fetch to wait on.
  await page.keyboard.press('Home')
  await expect.poll(() => drawing(page)).toBe(true)
})

test('a theme flip restyles a layer already on the map', async ({ page }) => {
  await page.goto(ATLAS)
  await opened(page)

  const box = await menu(page)
  await box.check()
  await expect.poll(() => drawing(page), { timeout: 15_000 }).toBe(true)

  const rustic = await lineColour(page)
  expect(rustic).not.toBe('')

  // The swatch carries `var(--map-layer-n)` rather than a resolved colour, so
  // it follows a theme with no JavaScript at all. Read before the flip, since
  // clicking the toggle is a click outside the popover and closes it.
  const swatch = page.locator('.layers__swatch').first()
  const swatchBefore = await swatch.evaluate((el) => getComputedStyle(el).backgroundColor)

  await page.locator('.theme-toggle').click()

  // The build this was ported from drew its overlays in static colours and
  // left them behind on a theme flip, which its own design called out as a
  // defect. The colour was never a literal here, so following the theme is
  // the whole of the fix — and this is what proves it happened.
  await expect.poll(() => lineColour(page)).not.toBe(rustic)

  // Still drawn, not dropped and re-added: `applyThemePaint` restyles in
  // place, and a layer that vanished on a theme change would be a regression
  // this assertion is the only one to see.
  expect(await drawing(page)).toBe(true)

  await menu(page)
  const swatchAfter = await page.locator('.layers__swatch').first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(swatchAfter).not.toBe(swatchBefore)
})

test('a layer unlit while its geometry is in flight does not arrive lit', async ({ page }) => {
  // The bug this exists for: the fetch is started by one effect run and lands
  // some time later, by which point the reader may have changed their mind.
  // A resolution that assumed the answer it was dispatched with would light a
  // layer the reader had just put out, and nothing would correct it — the
  // effect run that would have has already been and gone, and saw no layer.
  await page.route('**/artifacts/**', async (route) => {
    if (!route.request().url().includes(SLUG)) return route.continue()
    // Long enough to uncheck inside the window, short enough not to stall.
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    return route.continue()
  })

  await page.goto(ATLAS)
  await opened(page)

  const landed = page.waitForResponse((response) => response.url().includes(SLUG))

  const box = await menu(page)
  await box.check()
  await box.uncheck()

  // Waited for, not slept past. Asserting before the fetch resolves is the
  // trap this test fell into first: `drawing` is false at that moment whether
  // the code is right or wrong, so the assertion passed on the broken build.
  await landed

  // The geometry really did reach the map, so the race really did happen.
  // Without this the test would also pass on a build that never fetched.
  await expect.poll(() => added(page), { timeout: 15_000 }).toBe(true)

  // Arrived, and stayed out. This is the assertion.
  expect(await drawing(page)).toBe(false)
  await expect(box).not.toBeChecked()
})

test('a layer that fails to load says so, and does not blame the borders', async ({ page }) => {
  // One error slot used to serve both, so a missing route read as "Could not
  // load borders", pointing the reader at the one thing that was fine.
  await page.route(`**/artifacts/layers/${SLUG}/**`, (route) => route.fulfill({ status: 404, body: '' }))

  await page.goto(ATLAS)
  await opened(page)
  const box = await menu(page)
  await box.check()

  await expect(page.locator('.map__error')).toHaveText(`Could not load a layer: ${NAME} (HTTP 404)`)
  await expect(page.getByText('Could not load borders')).toHaveCount(0)
})

