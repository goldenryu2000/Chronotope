import { expect, test, type Page } from '@playwright/test'

/**
 * A CSP that blocks MapLibre's worker or a tile fetch does not throw. The map
 * just stays blank, so the violations are collected and asserted on.
 */
async function collectViolations(page: Page): Promise<string[]> {
  const violations: string[] = []
  page.on('console', (message) => {
    if (message.text().startsWith('CSP violation')) violations.push(message.text())
  })
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI}`)
    })
  })
  return violations
}

test('pages send the security headers and hide the framework', async ({ page }) => {
  const response = await page.goto('/')
  const headers = response!.headers()
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['x-powered-by']).toBeUndefined()
})

test('the atlas draws its map without a CSP violation', async ({ page }) => {
  const violations = await collectViolations(page)
  await page.goto('/world/philosophy')
  // Same readiness signal as e2e/atlas.spec.ts: controls exist only once the map is built.
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible()
  await page.waitForTimeout(1000)
  expect(violations).toEqual([])
})

for (const path of ['/', '/world/tours', '/world/philosophy/laozi']) {
  test(`${path} loads without a CSP violation`, async ({ page }) => {
    const violations = await collectViolations(page)
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    expect(violations).toEqual([])
  })
}

for (const path of [
  '/WORLD/philosophy',
  `/world/${'a'.repeat(200)}`,
  '/world/philosophy/Laozi',
  "/world/philosophy'--",
  '/world/tours/not%20a%20tour',
]) {
  test(`${path} is a 404, not a 500`, async ({ page }) => {
    const response = await page.goto(path)
    expect(response!.status()).toBe(404)
  })
}
