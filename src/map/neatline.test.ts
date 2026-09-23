import { describe, expect, it } from 'vitest'
import { ringOf } from './neatline'

describe('ringOf', () => {
  it('draws a closed ring around the plate', () => {
    const [feature] = ringOf([66, 5, 97.6, 37.6]).features
    const ring = (feature.geometry as unknown as { coordinates: [number, number][] }).coordinates
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])
  })

  it('walks the plate\'s own corners, in order', () => {
    const [feature] = ringOf([0, 0, 10, 20]).features
    expect((feature.geometry as unknown as { coordinates: [number, number][] }).coordinates)
      .toEqual([[0, 0], [10, 0], [10, 20], [0, 20], [0, 0]])
  })

  it('is a line, not a fill: an edge is not territory', () => {
    expect(ringOf([0, 0, 1, 1]).features[0].geometry.type).toBe('LineString')
  })
})
