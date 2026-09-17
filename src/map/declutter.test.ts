import { describe, expect, it } from 'vitest'
import type { ActiveEntity } from '../data/entitySpan'
import { clusterName, layoutPins } from './declutter'

function entity(id: string, lng: number, lat: number, tier: 'core' | 'halo' = 'core'): ActiveEntity {
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    lng,
    lat,
    tier,
    place: 'Somewhere',
  } as unknown as ActiveEntity
}

/** One degree is ten pixels, so tests can place pins by eye. */
const project = (e: ActiveEntity) => ({ x: e.lng * 10, y: e.lat * 10 })

describe('clusterName', () => {
  it('names both members of a pair', () => {
    expect(clusterName([entity('gilgamesh', 0, 0), entity('inanna', 0, 0)], null)).toBe('Gilgamesh, Inanna')
  })

  it('names one member and counts the rest of a larger group', () => {
    const members = ['marduk', 'shamash', 'sin', 'tiamat'].map((id) => entity(id, 0, 0))
    expect(clusterName(members, null)).toBe('Marduk +3')
  })

  it('leads with a core figure over a halo one', () => {
    const members = [entity('mot', 0, 0, 'halo'), entity('baal', 0, 0), entity('yam', 0, 0, 'halo')]
    expect(clusterName(members, null)).toBe('Baal +2')
  })

  it('leads with whoever is selected', () => {
    const members = [entity('marduk', 0, 0), entity('shamash', 0, 0), entity('sin', 0, 0)]
    expect(clusterName(members, 'sin')).toBe('Sin +2')
  })
})

describe('layoutPins labels', () => {
  it('names every cluster that has room, not only the lone pins', () => {
    const { placed, clusters } = layoutPins(
      [
        entity('gilgamesh', 0, 0),
        entity('inanna', 0, 0),
        entity('marduk', 0, 20),
        entity('shamash', 0, 20),
        entity('mithra', 40, 10),
      ],
      project,
    )
    expect(placed.map((p) => [p.entity.id, p.label])).toEqual([['mithra', true]])
    expect(clusters.map((c) => [c.name, c.label])).toEqual([
      ['Gilgamesh, Inanna', true],
      ['Marduk, Shamash', true],
    ])
  })

  it("hides a pin's name that would lie across a cluster", () => {
    const { placed } = layoutPins(
      [entity('mithra', 0, 0), entity('marduk', 6, 0), entity('shamash', 6, 0)],
      project,
    )
    expect(placed[0].label).toBe(false)
  })

  it("hides a cluster's name that would lie across a pin", () => {
    const { clusters } = layoutPins(
      [entity('marduk', 0, 0), entity('shamash', 0, 0), entity('mithra', 6, 0)],
      project,
    )
    expect(clusters[0].label).toBe(false)
  })
})
