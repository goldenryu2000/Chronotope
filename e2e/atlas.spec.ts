import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * What is actually on top at a point, expressed as "is it still part of the
 * thing I aimed at?".
 *
 * `.click()` bypasses hit-testing and will happily "succeed" on a buried
 * element. This is how the zoom controls sat unreachable under the dock for
 * weeks, and how a share button behind the detail panel shipped. Only
 * `document.elementFromPoint` asks the real question.
 *
 * It returns the innermost element, which for a control is usually a <span>
 * the widget draws inside itself — MapLibre's zoom button hands back
 * `SPAN.maplibregl-ctrl-icon`, and a pin hands back `SPAN.pin__dot`. So walk
 * up from whatever is on top with `.closest()`: anything foreign covering the
 * target fails that walk, and the target's own innards do not.
 */
async function topmostAt(page: Page, target: Locator, selector: string): Promise<string> {
  const box = (await target.boundingBox())!
  return page.evaluate(
    ([x, y, wanted]) => {
      const element = document.elementFromPoint(x as number, y as number)
      return element?.closest(wanted as string)
        ? (wanted as string).replace('.', '')
        : (element?.className ?? '')
    },
    [box.x + box.width / 2, box.y + box.height / 2, selector] as const,
  )
}

test('the map controls are not buried under the dock', async ({ page }) => {
  await page.goto('/world/philosophy')

  // The map is built only once both artifacts land, so the controls do not
  // exist at navigation time.
  const zoomIn = page.locator('.maplibregl-ctrl-zoom-in')
  await expect(zoomIn).toBeVisible()
  await opened(page)

  expect(await topmostAt(page, zoomIn, '.maplibregl-ctrl-zoom-in')).toContain(
    'maplibregl-ctrl-zoom-in',
  )
})

test('scrubbing the timeline changes the year', async ({ page }) => {
  await page.goto('/world/philosophy')
  await opened(page)

  const readout = page.locator('[data-testid="year-readout"]')
  await expect(readout).toBeVisible()
  const before = await readout.textContent()

  // The track is covered by a density histogram, a rail, era ticks, a fill and
  // a handle. Every one of them is pointer-events: none so that a scrub lands
  // on the slider — check that before scrubbing, or this test would pass by
  // clicking a decoration.
  const track = page.locator('[data-testid="timeline-track"]')
  const box = (await track.boundingBox())!
  const topmost = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.getAttribute('data-testid') ?? '',
    [box.x + 400, box.y + 10],
  )
  expect(topmost).toBe('timeline-track')

  await track.click({ position: { x: 400, y: 10 } })
  await expect(readout).not.toHaveText(before!)
})

test('clicking a pin opens the panel, and the panel does not bury the map controls', async ({
  page,
}) => {
  await page.goto('/world/philosophy')

  await opened(page)
  const pin = page.locator('.pin').first()
  await expect(pin).toBeVisible()

  // The dot is a <span> inside the button; `.closest` is what makes this a
  // question about burial rather than about markup.
  expect(await topmostAt(page, pin, '.pin')).toBe('pin')
  await pin.click()

  const panel = page.locator('.panel')
  await expect(panel).toBeVisible()

  // A link nobody can reach is not a link. Check the destination, then check
  // that the destination is clickable — a share button behind this very panel
  // is how that distinction was learned.
  //
  // The scroll is not a workaround for a burial: the link sits at the foot of
  // a long entry inside `.panel__scroll`, so before scrolling its layout box
  // is below the panel's clipped edge and what is painted there is the
  // timeline. Measured, not assumed — the first version of this test hit-
  // tested the unscrolled box and got `DIV.timeline`, which is the correct
  // answer to the wrong question.
  const link = page.locator('.panel__link')
  await expect(link).toHaveAttribute('href', /^https:\/\/en\.wikipedia\.org\/wiki\/./)
  await link.scrollIntoViewIfNeeded()
  expect(await topmostAt(page, link, '.panel__link')).toBe('panel__link')

  // The regression this whole file exists for, at the other end of the screen:
  // the panel grows down the right-hand side, and the zoom buttons live at the
  // bottom of it.
  const zoomIn = page.locator('.maplibregl-ctrl-zoom-in')
  expect(await topmostAt(page, zoomIn, '.maplibregl-ctrl-zoom-in')).toContain(
    'maplibregl-ctrl-zoom-in',
  )
})

/**
 * A handle on the live map. `window.__map` is set unconditionally in
 * MapCanvas.tsx; see the comment there for why it is not dev-gated.
 */
interface MapHandle {
  querySourceFeatures(id: string, options: { sourceLayer: string }): unknown[]
  queryRenderedFeatures(options: { layers: string[] }): Array<{ id?: number | string }>
  areTilesLoaded(): boolean
}

/** How many border features the vector source actually parsed. */
const parsedFeatures = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const map = (window as unknown as { __map?: MapHandle }).__map
    // A vector source needs the source layer named; a GeoJSON one did not.
    return map ? map.querySourceFeatures('borders', { sourceLayer: 'borders' }).length : 0
  })

/** The ids of the border polygons currently painted, as a sorted string. */
const paintedIds = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const map = (window as unknown as { __map?: MapHandle }).__map
    if (!map) return ''
    const ids = map.queryRenderedFeatures({ layers: ['borders-fill'] }).map((f) => f.id)
    return [...new Set(ids)].sort().join(',')
  })

/** Whether every tile the viewport needs has arrived. */
const tilesLoaded = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const map = (window as unknown as { __map?: MapHandle }).__map
    return map ? map.areTilesLoaded() : false
  })

/**
 * Wait for the opening curtain to lift.
 *
 * It is fixed over the whole viewport until the map has drawn, so anything
 * that hit-tests or clicks before this is testing the curtain. Every test here
 * that touches the page needs it, which is the honest cost of covering the
 * wait — and cheaper than the alternative, which was three visible states on
 * the way in.
 */
async function opened(page: Page): Promise<void> {
  await expect(page.locator('.curtain'))
    .toHaveAttribute('data-done', 'true', { timeout: 30_000 })
}

/** Wait until every tile the viewport needs is in. */
async function settle(page: Page): Promise<void> {
  await opened(page)
  await expect.poll(() => parsedFeatures(page), { timeout: 30_000 }).toBeGreaterThan(0)
  await expect.poll(() => tilesLoaded(page), { timeout: 30_000 }).toBe(true)
}

/**
 * The gap this milestone otherwise had: nothing proved the map's data loaded.
 *
 * A broken MapLibre worker fails completely silently — no console error, no
 * network request, a blank canvas (see docs/superpowers/reference/gotchas.md).
 * Every other check in this file would still pass with one: the zoom control
 * is DOM, the pins are HTML markers, the year readout is React state. So would
 * typecheck, lint and build. This is the only check that would notice.
 *
 * `querySourceFeatures`, not `isSourceLoaded`: a source with nothing in it
 * reports itself loaded immediately, so that check comes back true with a
 * completely dead worker. Only counting the features MapLibre actually decoded
 * proves the archive arrived, the `pmtiles://` protocol resolved it, and the
 * worker parsed the vector tiles inside.
 */
test('the borders actually parsed — the worker is alive', async ({ page }) => {
  await page.goto('/world/philosophy')

  // The map is built only once both artifacts land.
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()

  await settle(page)
  expect(await paintedIds(page)).not.toBe('')
})

/**
 * The architectural bet of milestone 2, stated so it can fail.
 *
 * Every era is in the one archive, so a year change is `setFilter` — a
 * repaint, not a fetch. The previous build kept two GeoJSON sources and
 * cross-faded them because each year was a different file over the network.
 * Asserting the borders changed is not enough on its own; asserting that they
 * changed *and* that nothing was requested is the whole claim.
 */
test('scrubbing the year repaints the borders without fetching anything', async ({ page }) => {
  await page.goto('/world/philosophy')
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
  await settle(page)

  // Recording starts only once the map is idle, so tiles still arriving from
  // the first paint are not counted against the scrub.
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))

  const readout = page.locator('[data-testid="year-readout"]')
  const track = page.locator('[data-testid="timeline-track"]')

  let previous = await paintedIds(page)
  const seen = new Set<string>([previous])

  for (const x of [80, 380, 680]) {
    const before = await readout.textContent()
    await track.click({ position: { x, y: 10 } })
    await expect(readout).not.toHaveText(before!)

    // `setFilter` is synchronous; the frame that shows its effect is not, and
    // `queryRenderedFeatures` reports what is painted right now. Reading
    // straight after the click reads the *previous* year's paint often enough
    // to be flaky, so wait for the repaint rather than assume it. The wait is
    // bounded, so a map that ignored the year still fails here — by timing
    // out on a set that never changes.
    await expect.poll(() => paintedIds(page)).not.toBe(previous)

    previous = await paintedIds(page)
    seen.add(previous)
  }

  // Four years, four different maps. Each step above only proves it differs
  // from the step before it; this is what would catch a scrub that oscillated
  // between two eras.
  expect(seen.size).toBe(4)

  // The assertion the milestone is judged on. Not "few requests" — none.
  expect(requests.filter((url) => url.includes('.pmtiles'))).toEqual([])
})

/**
 * A style expression is only checked against the data when it meets the data.
 *
 * MapLibre's own validator passes `['<=', ['get', 'confidence'], 1]` — `get`
 * has no type until a tile supplies one — and then, at paint time, complains
 * that it found a string and quietly falls back to a default. That is a
 * warning, not an error, so it never reaches `map.on('error')` and never fails
 * a test that watches for errors. It shipped exactly that way: `confidence` is
 * `low`/`medium`/`high` in the tiles, the TopoJSON snapshots it replaced had a
 * numeric `BORDERPRECISION`, and for a while every border was drawn at the
 * same width because the expression was falling back on every feature.
 */
test('no style expression falls back when it meets the tiles', async ({ page }) => {
  const complaints: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (/Expected value to be of type|Failed to evaluate|Unable to perform/.test(text)) {
      complaints.push(text)
    }
  })

  await page.goto('/world/philosophy')
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
  await settle(page)

  expect(complaints).toEqual([])
})

/** The labels of every pin currently on the map. */
const pinNames = (page: Page): Promise<string[]> =>
  page.locator('.pin').evaluateAll((pins) =>
    pins.map((pin) => pin.textContent?.trim() ?? '').sort())

/** Where the camera is, to three decimals — enough to catch a move, not a jitter. */
const cameraAt = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const map = (window as unknown as { __map?: {
      getCenter(): { lng: number; lat: number }; getZoom(): number
    } }).__map
    if (!map) return ''
    const { lng, lat } = map.getCenter()
    return [lng, lat, map.getZoom()].map((n) => n.toFixed(3)).join(',')
  })

/**
 * The switcher's whole reason for being on the map screen rather than on one
 * of its own: it answers "who else was here, then?".
 *
 * So the year and the camera surviving the switch is not a nicety, it is the
 * feature. A switcher that reloaded the page would satisfy "you can change
 * packs" and lose the question.
 */
test('switching packs changes who is on the map, keeping the year and the place', async ({
  page,
}) => {
  await page.goto('/world/philosophy')
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
  await settle(page)

  const chosen = page.locator('.pack-switcher__option[data-active="true"]')
  const mythology = page.locator('.pack-switcher__option', { hasText: /^Mythology$/i })
  await expect(chosen).toHaveText(/Philosophy/i)

  // Every alternative is on screen without a click. This is the assertion the
  // menu version could not have made, and the reason it was replaced: a
  // control a reader must first suspect exists is not a control.
  await expect(mythology).toBeVisible()

  // The rule this file exists for. The switcher sits in the header, over the
  // map canvas, which is exactly the arrangement that buries things.
  expect(await topmostAt(page, mythology, '.pack-switcher__option'))
    .toContain('pack-switcher__option')

  const readout = page.locator('[data-testid="year-readout"]')
  const year = await readout.textContent()
  const camera = await cameraAt(page)
  const before = await pinNames(page)

  // One click, not open-then-pick.
  await mythology.click()
  await expect(chosen).toHaveText(/Mythology/i)

  // Same moment, same place, different people.
  await expect(readout).toHaveText(year!)
  expect(await cameraAt(page)).toBe(camera)
  await expect.poll(() => pinNames(page)).not.toEqual(before)

  // Shareable and reversible, without ever remounting the map.
  await expect(page).toHaveURL(/\/world\/mythology$/)
  await page.goBack()
  await expect(chosen).toHaveText(/Philosophy/i)
  await expect(page).toHaveURL(/\/world\/philosophy$/)
})

/**
 * A radio group is expected to answer the arrow keys, and someone who has
 * tabbed onto this one has no pointer to fall back on.
 */
test('the pack switcher is operable from the keyboard', async ({ page }) => {
  await page.goto('/world/philosophy')
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
  await settle(page)

  const chosen = page.locator('.pack-switcher__option[data-active="true"]')
  await chosen.focus()
  await page.keyboard.press('ArrowRight')

  // Whatever is next in the row, it is not what was showing a moment ago.
  await expect(chosen).not.toHaveText(/Philosophy/i)

  // Focus follows the choice, or the next arrow press would come from nowhere.
  await expect(chosen).toBeFocused()
})

/**
 * The wait is covered, and — the part that matters — it uncovers again.
 *
 * A curtain that can hang is worse than no curtain: it would show a loading
 * screen over a working map, with no way to tell the difference from the
 * outside. So this asserts it lifts, and then that it is not still quietly
 * swallowing clicks meant for the map underneath.
 */
test('the opening curtain lifts, and stops intercepting when it does', async ({ page }) => {
  await page.goto('/world/philosophy')

  await opened(page)
  await settle(page)

  // The curtain is fixed over the whole viewport, so if it still took pointer
  // events every control on the page would be dead while looking alive. This
  // is the same hit-test the rest of this file uses, aimed at the one element
  // that covers everything.
  const zoomIn = page.locator('.maplibregl-ctrl-zoom-in')
  expect(await topmostAt(page, zoomIn, '.maplibregl-ctrl-zoom-in'))
    .toContain('maplibregl-ctrl-zoom-in')
})

/**
 * A way out.
 *
 * Switching packs uses `pushState`, so the browser's back button walks back
 * through pack switches before it ever leaves the atlas. Someone three
 * switches deep has no obvious way home, and on the map screen there is no
 * chrome to find one in. This is that way.
 */
test('the atlas offers a way back to the landing page', async ({ page }) => {
  await page.goto('/world/philosophy')
  await opened(page)

  const home = page.locator('.atlas__home')
  await expect(home).toBeVisible()

  // The map fills the viewport, so anything laid over it is a burial risk.
  expect(await topmostAt(page, home, '.atlas__home')).toContain('atlas__home')

  await home.click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('.cartouche__title')).toBeVisible()
})

/**
 * A bad atlas url is a 404, with the status to match.
 *
 * The curtain's `loading.tsx` opens a Suspense boundary around the page, and
 * Next streams a 200 before a `notFound()` inside that boundary can set the
 * status. The entity route hit this first and was fixed by moving out of the
 * group; the atlas page is the boundary's own child and could not be, so the
 * check moved up into a layout, which renders outside it.
 *
 * Asserted on the response rather than on the rendered text, because the
 * wrong-status version renders exactly the same "could not be found" page.
 */
for (const path of ['/nonsense/philosophy', '/world/nonsense', '/nonsense/nonsense']) {
  test(`${path} is a 404, not a 200 that looks like one`, async ({ page }) => {
    const response = await page.goto(path)
    expect(response!.status()).toBe(404)
  })
}
