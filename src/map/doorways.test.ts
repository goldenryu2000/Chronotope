import { describe, expect, it } from 'vitest'
import { doorwayLineId, doorwaySourceId, frameOf } from './doorways'

describe('frameOf', () => {
  it('draws a closed ring around the plate', () => {
    const [feature] = frameOf([66, 5, 97.6, 37.6]).features
    const ring = (feature.geometry as unknown as { coordinates: [number, number][] }).coordinates
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])
  })

  it('walks the plate\'s own corners, in order', () => {
    const [feature] = frameOf([0, 0, 10, 20]).features
    expect((feature.geometry as unknown as { coordinates: [number, number][] }).coordinates).toEqual([
      [0, 0], [10, 0], [10, 20], [0, 20], [0, 0],
    ])
  })

  it('is a line, not a fill: it must not look like territory', () => {
    const [feature] = frameOf([0, 0, 1, 1]).features
    expect(feature.geometry.type).toBe('LineString')
  })
})

describe('ids', () => {
  it('namespaces per plate, so two doorways never share a source', () => {
    expect(doorwaySourceId('india')).not.toBe(doorwaySourceId('europe'))
    expect(doorwayLineId('india')).not.toBe(doorwaySourceId('india'))
  })
})
