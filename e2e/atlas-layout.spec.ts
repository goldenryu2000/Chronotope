import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * The atlas's layout system, held the way a reader meets it.
 *
 * Every overlay on the atlas once reserved space with its own guess of the
 * others' sizes, and every camera move put its subject at the centre of the
 * screen. The result was measured before this file existed: every stop of the
 * flagship tour narrated a figure the tour card was covering, the cluster list
 * opened in the corner and jumped, and the layer menu ran under the panel.
 *
 * These assert on painted geometry and on `elementFromPoint`, never on whether
 * a handler fires, for the reason e2e/atlas.spec.ts gives at length.
 */

test.use({ viewport: { width: 1280, height: 800 } })

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

async function box(locator: Locator): Promise<Box> {
  const b = (await locator.boundingBox())!
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height }
}

const overlaps = (a: Box, b: Box) =>
  Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
  Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)

async function opened(page: Page, url: string) {
  await page.goto(url)
  await expect(page.locator('.curtain')).toHaveAttribute('data-done', 'true', { timeout: 30_000 })
}

/** Waits for the camera to come to rest, twice, since one move can chain another. */
async function still(page: Page) {
  for (let i = 0; i < 2; i += 1) {
    await page.waitForFunction(() => {
      const map = (window as unknown as { __map?: { isMoving(): boolean } }).__map
      return map !== undefined && !map.isMoving()
    })
    await page.waitForTimeout(250)
  }
}

/** Whether the element painted on top at a box's centre belongs to `selector`. */
async function onTop(page: Page, target: Box, selector: string) {
  return page.evaluate(
    ([x, y, wanted]) => document.elementFromPoint(x as number, y as number)?.closest(wanted as string) !== null,
    [(target.left + target.right) / 2, (target.top + target.bottom) / 2, selector] as const,
  )
}

/** The screen boxes of whatever is drawn over the map right now, by name. */
async function overlays(page: Page) {
  const names = {
    home: '.atlas__home',
    header: '.atlas__header',
    chrome: '.atlas__chrome',
    layers: '.layers__popover',
    panel: '.panel',
    tour: '.tour',
    empty: '.empty',
    timeline: '.timeline',
  }
  const found: Record<string, Box> = {}
  for (const [name, selector] of Object.entries(names)) {
    const locator = page.locator(selector)
    if ((await locator.count()) === 0 || !(await locator.first().isVisible())) continue
    found[name] = await box(locator.first())
  }
  return found
}

function expectNoOverlaps(found: Record<string, Box>) {
  const names = Object.keys(found)
  const collisions: string[] = []
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      if (overlaps(found[names[i]], found[names[j]])) collisions.push(`${names[i]} x ${names[j]}`)
    }
  }
  expect(collisions).toEqual([])
}

async function typeYear(page: Page, text: string) {
  await page.getByRole('button', { name: /type a year/i }).click()
  const input = page.getByTestId('year-input')
  await input.fill(text)
  await input.press('Enter')
}

test('every stop of the flagship tour frames its figure clear of every overlay', async ({ page }) => {
  test.setTimeout(120_000)
  await opened(page, '/world/tours/gods-grew-quiet')

  for (let stop = 1; stop <= 13; stop += 1) {
    if (stop > 1) await page.getByRole('button', { name: 'Next stop' }).click()
    await expect(page.getByText(`Stop ${stop} of 13`)).toBeVisible()
    // Every stop selects someone, and a cross-pack stop must too.
    const panel = page.locator('.panel')
    await expect(panel).toBeVisible()
    await still(page)

    const name = await panel.getAttribute('aria-label')
    const found = await overlays(page)
    expectNoOverlaps(found)

    // The figure's mark: their own pin, or the lit cluster they share.
    const id = await page.evaluate(
      (label) => [...document.querySelectorAll('.pin')].find((pin) => pin.getAttribute('aria-label')?.startsWith(`${label},`))?.getAttribute('aria-label') ?? null,
      name,
    )
    if (id) {
      const pin = page.locator(`.pin[aria-label="${id}"] .pin__dot`)
      const dot = await box(pin)
      for (const [overlay, area] of Object.entries(found)) {
        expect(overlaps(dot, area), `stop ${stop}: ${name} under ${overlay}`).toBe(false)
      }
      expect(await onTop(page, dot, '.pin')).toBe(true)
    } else {
      // Clustered with a neighbour: the lit cluster is the figure's mark.
      const cluster = page.locator('.cluster[data-active="true"]')
      const mark = await box(cluster)
      for (const [overlay, area] of Object.entries(found)) {
        expect(overlaps(mark, area), `stop ${stop}: ${name}'s cluster under ${overlay}`).toBe(false)
      }
    }
  }
})

test('a cross-pack stop keeps its figure selected once the pack lands', async ({ page }) => {
  await opened(page, '/world/tours/gods-grew-quiet/4')
  await expect(page.locator('.panel')).toBeVisible()
  // Stop 5 is the first philosophy stop.
  await page.getByRole('button', { name: 'Next stop' }).click()
  await expect(page.getByText('Stop 5 of 13')).toBeVisible()
  await expect(page.locator('.panel')).toHaveAttribute('aria-label', 'Laozi')
  // And it is still there after everything has settled, not just for a frame.
  await still(page)
  await expect(page.locator('.panel')).toHaveAttribute('aria-label', 'Laozi')
})

test('a cluster opens its list at the cluster, on the first frame, clear of the panel', async ({ page }) => {
  await opened(page, '/world/philosophy')
  // Socrates and Plato share Athens, and are both alive in 402 BCE.
  await typeYear(page, '402 BC')
  // East of centre and near the right edge, under where the panel will open.
  await page.evaluate(() =>
    (window as unknown as { __map: { jumpTo(o: object): void } }).__map.jumpTo({ center: [12, 39.5], zoom: 5 }),
  )
  await still(page)

  const cluster = page.locator('.cluster').first()
  await expect(cluster).toBeVisible()

  const firstFrames = async () => {
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[][] }
      w.__frames = []
      const start = performance.now()
      const tick = () => {
        const element = document.querySelector('.cluster-popover')
        const marker = document.querySelector('.cluster[data-active="true"], .cluster:hover')
        if (element && marker) {
          const r = element.getBoundingClientRect()
          const m = marker.getBoundingClientRect()
          w.__frames.push([(r.left + r.right) / 2 - (m.left + m.right) / 2, m.top - r.bottom])
        }
        if (performance.now() - start < 600) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }

  await firstFrames()
  const clusterBox = await box(cluster)
  expect(await onTop(page, clusterBox, '.cluster')).toBe(true)
  await page.mouse.click((clusterBox.left + clusterBox.right) / 2, (clusterBox.top + clusterBox.bottom) / 2)
  const popover = page.locator('.cluster-popover')
  await expect(popover).toBeVisible()
  await page.waitForTimeout(700)

  // Every frame, the first included, is centred over the cluster and sits just
  // above it. The corner flash was a frame hundreds of pixels away; the 6px of
  // slack is the fade-in rising into place.
  const frames = await page.evaluate(() => (window as unknown as { __frames: number[][] }).__frames)
  expect(frames.length).toBeGreaterThan(0)
  for (const [dx, gap] of frames) {
    expect(Math.abs(dx)).toBeLessThan(2)
    expect(gap).toBeGreaterThan(-6)
    expect(gap).toBeLessThan(40)
  }

  // Picking works, and the list stays open beside the panel it opens, so the
  // reader can go through every member without reopening the cluster.
  await page.locator('.cluster-popover__item', { hasText: 'Plato' }).click()
  await expect(page.locator('.panel')).toHaveAttribute('aria-label', 'Plato')
  await expect(popover).toBeVisible()
  await still(page)
  const list = await box(popover)
  for (const [name, area] of Object.entries(await overlays(page))) {
    expect(overlaps(list, area), `cluster list under ${name}`).toBe(false)
  }
  expect(overlaps(await box(page.locator('.cluster[data-active="true"]')), await box(page.locator('.panel')))).toBe(false)

  // The next member picks straight from the same list.
  const socrates = page.locator('.cluster-popover__item', { hasText: 'Socrates' })
  expect(await onTop(page, await box(socrates), '.cluster-popover__item')).toBe(true)
  await socrates.click()
  await expect(page.locator('.panel')).toHaveAttribute('aria-label', 'Socrates')
  await expect(socrates).toHaveAttribute('data-selected', 'true')
  await expect(popover).toBeVisible()

  // Escape closes it, and so does a click on bare map.
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await page.locator('.cluster').first().click()
  await expect(popover).toBeVisible()
  await still(page)
  await page.mouse.click(420, 300)
  await expect(popover).toHaveCount(0)
})

test('every cluster says who is in it, so a zoom into a crowd lands on names', async ({ page }) => {
  await opened(page, '/world/mythology')
  // Many gods share their cult centre's coordinate, so no zoom separates them:
  // after the zoom they are still clusters, and each must carry names.
  const nippur = page.locator('.cluster[aria-label*="in Nippur"]').first()
  await expect(nippur).toBeVisible()
  await nippur.click()
  await still(page)

  const labels = await page.locator('.cluster').evaluateAll((clusters) =>
    clusters
      .filter((cluster) => {
        const r = cluster.getBoundingClientRect()
        return r.left > 0 && r.top > 0 && r.right < innerWidth && r.bottom < innerHeight
      })
      .map((cluster) => {
        const label = cluster.querySelector('.cluster__label')!
        return { text: label.textContent, shown: getComputedStyle(label).opacity === '1' }
      }),
  )
  expect(labels.length).toBeGreaterThan(1)
  expect(labels.filter((label) => label.shown).length).toBeGreaterThan(1)
  for (const label of labels) expect(label.text).toMatch(/^\S.+(, .+| \+\d+)$/)
})

test('a pin chosen under the panel column is brought out from under the panel', async ({ page }) => {
  await opened(page, '/world/philosophy')
  // At world zoom the easternmost pins sit where the panel opens, and the map
  // is barely wider than the screen, so a pan alone cannot clear them.
  const east = await page.locator('.pin').evaluateAll((pins) =>
    pins
      .map((pin) => ({ label: pin.getAttribute('aria-label'), x: pin.getBoundingClientRect().left }))
      .filter((pin) => pin.x < innerWidth)
      .sort((a, b) => b.x - a.x)[0],
  )
  const pin = page.locator(`.pin[aria-label="${east.label}"]`)
  await pin.locator('.pin__dot').click()
  await expect(page.locator('.panel')).toBeVisible()
  await still(page)

  const dot = await box(pin.locator('.pin__dot'))
  expect(overlaps(dot, await box(page.locator('.panel')))).toBe(false)
  expect(await onTop(page, dot, '.pin')).toBe(true)
})

test('the layer menu takes the right column, and the panel steps aside for it', async ({ page }) => {
  await opened(page, '/world/philosophy')
  await page.locator('.pin').first().locator('.pin__dot').click()
  const panel = page.locator('.panel')
  await expect(panel).toBeVisible()

  await page.getByRole('button', { name: 'Layers' }).click()
  const menu = page.locator('.layers__popover')
  await expect(menu).toBeVisible()
  await expect(panel).toBeHidden()

  const found = await overlays(page)
  expectNoOverlaps(found)
  // Every checkbox in view is reachable, not painted over.
  for (const checkbox of await menu.locator('input[type="checkbox"]').all()) {
    const target = await box(checkbox)
    if (target.bottom > found.layers.bottom) break
    expect(await onTop(page, target, '.layers__popover')).toBe(true)
  }

  // Closing the menu gives the column back to the panel, still on the same figure.
  const name = await panel.getAttribute('aria-label')
  await page.getByRole('button', { name: 'Layers' }).click()
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('aria-label', name!)
})

test('the columns stay between the top bar and the dock, however tall the timeline is', async ({ page }) => {
  await opened(page, '/world/tours/gods-grew-quiet/8')
  await expect(page.locator('.panel')).toBeVisible()
  await still(page)
  expectNoOverlaps(await overlays(page))

  await page.getByRole('button', { name: 'Expand timeline' }).click()
  await expect(page.locator('.timeline')).toHaveAttribute('data-expanded', 'true')
  // The columns follow the dock on the next frame.
  await page.waitForTimeout(300)
  const found = await overlays(page)
  expectNoOverlaps(found)

  // And the tour's controls are still reachable.
  expect(await onTop(page, await box(page.getByRole('button', { name: 'Next stop' })), '.tour')).toBe(true)
  expect(await onTop(page, await box(page.getByRole('button', { name: 'Collapse timeline' })), '.timeline')).toBe(true)
})
