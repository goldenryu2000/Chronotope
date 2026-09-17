import { expect, test, type Page } from '@playwright/test'

const TOUR = '/world/tours/gods-grew-quiet'

test('a tour opens on its first stop, already framed', async ({ page }) => {
  await page.goto(TOUR)

  await expect(page.getByText('Stop 1 of 13')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The First Question' })).toBeVisible()

  // The stop selects somebody, and the panel is what proves the selection
  // reached the atlas rather than only the player.
  await expect(page.locator('.panel')).toBeVisible()
})

test('the tour metadata is server rendered', async ({ request }) => {
  const response = await request.get(TOUR)
  expect(await response.text()).toContain('When the Gods Grew Quiet')
})

test('crossing packs mid-tour fetches one artifact and keeps the map', async ({ page }) => {
  await page.goto(TOUR)
  await expect(page.getByText('Stop 1 of 13')).toBeVisible()

  const artifactRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/artifacts/')) artifactRequests.push(request.url())
  })

  // Stops 1 to 4 are mythology, stop 5 is philosophy: the flagship's whole
  // point, and the case the server-side pack resolution exists for.
  for (let i = 0; i < 4; i += 1) {
    await page.getByRole('button', { name: 'Next stop' }).click()
  }

  await expect(page.getByText('Stop 5 of 13')).toBeVisible()
  await expect(page).toHaveURL(/\/world\/tours\/gods-grew-quiet\/5$/)

  // One artifact crossed the wire: the philosophy pack itself. No manifest
  // fetched first to discover where it lives, which is the waterfall the
  // server-side resolution exists to remove.
  await expect
    .poll(() => artifactRequests.filter((url) => url.includes('/packs/')).length)
    .toBe(1)

  // The map survived the switch rather than remounting.
  expect(await page.evaluate(() => Boolean((window as { __map?: unknown }).__map))).toBe(true)
})

test('a link to a stop opens on that stop', async ({ page }) => {
  await page.goto(`${TOUR}/7`)
  await expect(page.getByText('Stop 7 of 13')).toBeVisible()
})

test('a stop past the end is a 404, not a silent first stop', async ({ page }) => {
  const response = await page.goto(`${TOUR}/99`)
  expect(response?.status()).toBe(404)
})

test('the timeline keeps its arrow keys during a tour', async ({ page }) => {
  await page.goto(TOUR)
  await expect(page.getByText('Stop 1 of 13')).toBeVisible()

  await page.locator('[data-testid="timeline-track"]').focus()
  await page.keyboard.press('ArrowRight')

  // One keystroke, one effect: the year moved, the tour did not.
  await expect(page.getByText('Stop 1 of 13')).toBeVisible()
})

/**
 * A handle on the live map. `window.__map` is set unconditionally in
 * MapCanvas.tsx; see the comment there for why it is not dev-gated. Declared
 * here rather than imported from maplibre-gl, as `e2e/layers.spec.ts` does,
 * because a browser spec has no business pulling the map library in to name
 * two methods.
 */
interface MapHandle {
  getLayer(id: string): unknown
  getLayoutProperty(id: string, name: string): unknown
}

/** A layer line's visibility, or null when it is not on the map at all. */
const visibility = (page: Page, line: string) =>
  page.evaluate((id) => {
    const map = (window as unknown as { __map?: MapHandle }).__map
    if (!map || !map.getLayer(id)) return null
    return String(map.getLayoutProperty(id, 'visibility'))
  }, line)

test('a stop lights the layer it is talking about', async ({ page }) => {
  const LINE = 'layer-line-atlantic-passage'
  const fetched: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/artifacts/layers/atlantic-passage/')) fetched.push(request.url())
  })

  // Stop 5 is Hermes in 200 and names no layer. Checked once the stop has
  // finished opening, not the moment the timeline mounts: at that moment no
  // fetch could have landed even for a stop that did light it, so a null read
  // there proved nothing.
  await page.goto('/world/tours/gods-who-emigrated/5')
  await expect(page.locator('.curtain')).toHaveAttribute('data-done', 'true', { timeout: 30_000 })
  await expect(page.locator('.panel')).toBeVisible()
  expect(fetched).toEqual([])
  expect(await visibility(page, LINE)).toBe(null)

  // Stop 6 is Ogun in 1700, and the Atlantic passage is the whole subject.
  await page.getByRole('button', { name: 'Next stop' }).click()
  await expect.poll(() => visibility(page, LINE), { timeout: 15_000 }).toBe('visible')
  await expect(page).toHaveURL(/\/world\/tours\/gods-who-emigrated\/6$/)
  expect(fetched).toHaveLength(1)
})

test('a stop that names no layer puts out the one before it', async ({ page }) => {
  const LINE = 'layer-line-silk-road'

  /*
   * The transmission tour, not the emigration one, and the year is the reason.
   *
   * Walking back from Ogun in 1700 to Hermes in 200 also puts the Atlantic
   * passage out, but for the wrong reason: it is valid 1500 to 1850, so the
   * cursor has left its years and it would hide whether the stop cleared it or
   * not. That test cannot tell "the stop unlit it" from "the year moved", and
   * a `setLayers` that merged instead of replacing passed it.
   *
   * Here both stops sit inside the Silk Road's -130 to 1450. The year cannot
   * explain anything, so the line going out is the stop clearing it and
   * nothing else: a view describes the atlas completely, and an empty layer
   * list means "none of them", not "leave whatever was lit alone".
   */
  await page.goto('/world/tours/aristotle-in-translation/5')
  await page.locator('[data-testid="timeline-track"]').waitFor()
  await expect.poll(() => visibility(page, LINE), { timeout: 15_000 }).toBe('visible')

  await page.getByRole('button', { name: 'Next stop' }).click()
  await expect(page).toHaveURL(/\/world\/tours\/aristotle-in-translation\/6$/)

  // Still on the map, and still inside its years. Only put out.
  await expect.poll(() => visibility(page, LINE)).toBe('none')
})

test('a stop opened directly has its layers lit on the first paint', async ({ page }) => {
  /*
   * The server-resolved view, and nothing else.
   *
   * The player re-applies a stop's view, layers included, as soon as the tour
   * artifact lands. So merely opening a lit stop proves little: with the
   * page's `initialView` emptied, the artifact still arrives a moment later
   * and lights the layer inside any reasonable poll. The first version of this
   * test passed that way.
   *
   * Holding the tour artifact removes that path. While it is held, the only
   * thing that can have lit the line is the view the server resolved from
   * Postgres and rendered into the page.
   */
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  let requested = false
  await page.route('**/artifacts/tours/**', async (route) => {
    requested = true
    await held
    await route.continue()
  })

  await page.goto('/world/tours/gods-who-emigrated/6')
  await page.locator('[data-testid="timeline-track"]').waitFor()

  await expect
    .poll(() => visibility(page, 'layer-line-atlantic-passage'), { timeout: 15_000 })
    .toBe('visible')

  // The hold was real: the player did ask for the artifact, and is still
  // waiting on it. Without this a pattern that matched nothing would make the
  // whole test pass for the reason it exists to rule out.
  expect(requested).toBe(true)
  await expect(page.getByText('Stop 6 of 8')).toHaveCount(0)

  release()
  await expect(page.getByText('Stop 6 of 8')).toBeVisible()
})

test('an atlas opened after a tour starts with nothing lit', async ({ page }) => {
  /*
   * Client-side navigation keeps the store, and the store holds the lit layers.
   * A fresh atlas already resets its year and its selection; left alone, the
   * layers were the one thing that followed the reader out: home from a lit
   * stop, into any atlas, and the tour's route was still ticked.
   */
  await page.goto('/world/tours/gods-who-emigrated/6')
  await expect.poll(() => visibility(page, 'layer-line-atlantic-passage'), { timeout: 15_000 })
    .toBe('visible')
  await expect(page.locator('[data-testid="layer-count"]')).toHaveText('1')

  await page.locator('.atlas__home').click()
  await expect(page.getByRole('heading', { level: 1, name: /Pick a year/ })).toBeVisible()
  await page.locator('.card').first().click()
  await expect(page).toHaveURL(/\/world\/[a-z]+$/)
  await expect(page.locator('.curtain')).toHaveAttribute('data-done', 'true', { timeout: 30_000 })

  // The same kind of wait the stop tests use, so a clear that arrives a moment
  // late is not mistaken for a leak, and a leak is not mistaken for a clear.
  await expect(page.locator('.layers__toggle')).toBeVisible()
  await expect(page.locator('[data-testid="layer-count"]')).toHaveCount(0)
})

