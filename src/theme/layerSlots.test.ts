import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LAYER_SLOTS, layerSlotToken } from './layerSlots'

/**
 * Read as text rather than through getComputedStyle. jsdom does not resolve
 * custom properties out of a stylesheet reliably, and the claim here is about
 * the theme files themselves: every slug a layer may pick has a colour in
 * every theme, or a layer draws with an empty string and vanishes.
 */
const themeSource = (name: string) =>
  readFileSync(join(process.cwd(), 'src', 'themes', `${name}.css`), 'utf8')

describe('layerSlotToken', () => {
  it('names the token for a slot', () => {
    expect(layerSlotToken(1)).toBe('--map-layer-1')
    expect(layerSlotToken(LAYER_SLOTS)).toBe(`--map-layer-${LAYER_SLOTS}`)
  })
})

describe.each(['rustic', 'slate'])('%s', (theme) => {
  const source = themeSource(theme)

  it('defines every palette slot', () => {
    for (let slot = 1; slot <= LAYER_SLOTS; slot++) {
      expect(source).toMatch(new RegExp(`${layerSlotToken(slot)}:\\s*#[0-9a-f]{3,8}`, 'i'))
    }
  })

  it('has retired the ported per-layer token names', () => {
    expect(source).not.toContain('--map-overlay-')
  })
})
