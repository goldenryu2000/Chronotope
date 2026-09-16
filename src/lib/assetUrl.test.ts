import { describe, expect, it } from 'vitest'
import { assetUrl } from './assetUrl'

describe('assetUrl', () => {
  it('serves from this origin when no base is set, which is how public/ works locally', () => {
    expect(assetUrl(undefined, 'tiles/world.pmtiles')).toBe('/tiles/world.pmtiles')
    expect(assetUrl('', 'tiles/world.pmtiles')).toBe('/tiles/world.pmtiles')
  })

  it('joins a bucket origin without doubling or dropping the slash', () => {
    expect(assetUrl('https://assets.example.com/', 'tiles/world.pmtiles'))
      .toBe('https://assets.example.com/tiles/world.pmtiles')
    expect(assetUrl('https://assets.example.com', '/tiles/world.pmtiles'))
      .toBe('https://assets.example.com/tiles/world.pmtiles')
  })
})
