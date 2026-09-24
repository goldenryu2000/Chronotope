import { describe, expect, it } from 'vitest'
import type { ActiveEntity } from '../data/entitySpan'
import { clusterCaption, clusterMove, clusterName, COLLIDE_PX, layoutPins, sharedPlace } from './declutter'
import { project as mercator } from '../layout/safeArea'

function entity(
  id: string, lng: number, lat: number, tier: 'core' | 'halo' = 'core', place = 'Somewhere',
): ActiveEntity {
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    lng,
    lat,
    tier,
    place,
  } as unknown as ActiveEntity
}

/** One degree is ten pixels, so tests can place pins by eye. */
const project = (e: ActiveEntity) => ({ x: e.lng * 10, y: e.lat * 10 })

describe('clusterName', () => {
  it('names both members of a pair', () => {
    expect(clusterName([entity('gilgamesh', 0, 0), entity('inanna', 0, 0)], null)).toBe('Gilgamesh, Inanna')
  })

  it('names all three members of a trio, so none of them goes unnamed', () => {
    const members = [entity('lernaean hydra', 0, 0), entity('pegasus', 0, 0), entity('satyr', 0, 0)]
    expect(clusterName(members, null)).toBe('Lernaean hydra, Pegasus, Satyr')
  })

  it('names one member and counts the rest of a larger group', () => {
    const members = ['marduk', 'shamash', 'sin', 'tiamat'].map((id) => entity(id, 0, 0))
    expect(clusterName(members, null)).toBe('Marduk +3')
  })

  it('leads with a core figure over a halo one', () => {
    const members = [entity('mot', 0, 0, 'halo'), entity('baal', 0, 0), entity('yam', 0, 0, 'halo'), entity('el', 0, 0, 'halo')]
    expect(clusterName(members, null)).toBe('Baal +3')
  })

  it('leads with whoever is selected', () => {
    const members = [entity('marduk', 0, 0), entity('shamash', 0, 0), entity('sin', 0, 0), entity('tiamat', 0, 0)]
    expect(clusterName(members, 'sin')).toBe('Sin +3')
  })
})

describe('cluster place', () => {
  it('names the place only when every member shares it', () => {
    const socrates = entity('socrates', 23.73, 37.98, 'core', 'Athens, Greece')
    const plato = entity('plato', 23.73, 37.98, 'core', 'Athens')
    const aristotle = entity('aristotle', 23.86, 40.52, 'core', 'Stagira, Macedon')
    expect(sharedPlace([socrates, plato])).toBe('Athens')
    // The reported case: this pair was "2 entities in Stagira".
    expect(sharedPlace([aristotle, plato])).toBeNull()
  })

  it('says how many, and where only when it can', () => {
    expect(clusterCaption(2, 'Athens')).toBe('2 figures in Athens')
    expect(clusterCaption(31, null)).toBe('31 figures nearby')
  })

  it('reaches the cluster layoutPins builds', () => {
    const { clusters } = layoutPins(
      [entity('aristotle', 0, 0, 'core', 'Stagira'), entity('plato', 0, 1, 'core', 'Athens')],
      project,
    )
    expect(clusters[0].place).toBeNull()
  })
})

describe('layoutPins labels', () => {
  it('gives a cluster its name before a lone pin takes the room', () => {
    // The cluster is boxed in above, below and to the right, so its one free
    // side is the left, which is also where Lonely's name would go. Placed
    // first, the pin took it and four figures went unnamed.
    const { placed, clusters } = layoutPins(
      [
        entity('lonely', 2, 10),
        ...['biga', 'bigb', 'bigc', 'bigd'].map((id) => entity(id, 10, 10)),
        entity('up', 10, 6.9),
        entity('down', 10, 13.1),
        entity('east', 15, 10),
      ],
      project,
    )
    expect(clusters[0]).toMatchObject({ label: true, side: 'left' })
    expect(placed.find((p) => p.entity.id === 'lonely')).toMatchObject({ label: true, side: 'left' })
  })

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

  it("moves a pin's name to the left rather than across a cluster on its right", () => {
    const { placed } = layoutPins(
      [entity('mithra', 0, 0), entity('marduk', 6, 0), entity('shamash', 6, 0)],
      project,
    )
    expect(placed[0]).toMatchObject({ label: true, side: 'left' })
  })

  it("moves a cluster's name rather than lay it across a pin", () => {
    const { clusters } = layoutPins(
      [entity('marduk', 0, 0), entity('shamash', 0, 0), entity('mithra', 6, 0)],
      project,
    )
    expect(clusters[0]).toMatchObject({ label: true, side: 'left' })
  })

  it('names Satyr when it sits just west of the Hydra (the reported case)', () => {
    // Zoom 6 around Lerna: Satyr's name to the right would cover the Hydra.
    const at = (e: ActiveEntity) => mercator([e.lng, e.lat], 6)
    const { placed } = layoutPins(
      [entity('lernaean hydra', 22.72, 37.55), entity('pegasus', 22.88, 37.9), entity('satyr', 22.3, 37.6)],
      at,
    )
    for (const pin of placed) expect(pin.label, pin.entity.id).toBe(true)
  })

  it('shortens a boxed-in trio to its lead name rather than leave it unnamed (Humbaba on the world map)', () => {
    // The world creatures map at opening, measured: Humbaba, Lamassu and the
    // Mermaid share Mesopotamia and Syria, with Chimera to the west, Simurgh
    // and Div with Manticore to the east, and the Egyptian and Greek crowds
    // below and beyond. "Humbaba, Lamassu, Mermaid" fits on no side.
    const { clusters } = layoutPins(
      [
        entity('humbaba', 0, 0), entity('lamassu', 0.5, 0.3), entity('mermaid', -0.4, -0.5),
        entity('chimera', -4.9, -0.2),
        entity('simurgh', 7.7, -0.1),
        entity('div', 4.2, 1), entity('manticore', 4.3, 1.1),
        ...['ammit', 'apep', 'bennu', 'phoenix', 'sphinx'].map((id) => entity(id, -4.3, 4.3)),
        ...['centaur', 'cerberus', 'harpy'].map((id) => entity(id, -8.9, -0.8)),
      ],
      project,
    )
    const trio = clusters.find((c) => c.members.some((m) => m.id === 'humbaba'))!
    expect(trio).toMatchObject({ label: true, name: 'Humbaba +2' })
    // Only the one that had no room is shortened.
    expect(clusters.find((c) => c.members.some((m) => m.id === 'div'))!.name).toBe('Div, Manticore')
  })

  it('never lays one name over another, and hides a name only when every side is taken', () => {
    // A pin boxed in on all four sides by others close enough to cover each side.
    const { placed } = layoutPins(
      [entity('middle', 10, 10), entity('east', 13.5, 10), entity('west', 6.5, 10), entity('north', 10, 7), entity('south', 10, 13)],
      project,
    )
    const middle = placed.find((p) => p.entity.id === 'middle')!
    expect(middle.label).toBe(false)
    expect(placed.filter((p) => p.label).length).toBeGreaterThan(0)
  })
})

describe('clusterMove', () => {
  /** On-screen distance between two members at a zoom. */
  const apart = (a: ActiveEntity, b: ActiveEntity, zoom: number) => {
    const p = mercator([a.lng, a.lat], zoom)
    const q = mercator([b.lng, b.lat], zoom)
    return Math.hypot(p.x - q.x, p.y - q.y)
  }

  it('opens the list when every member shares one spot', () => {
    expect(clusterMove([entity('socrates', 23.73, 37.98), entity('plato', 23.73, 37.98)], 5, 6)).toEqual({ kind: 'list' })
  })

  it('zooms in when more zoom would pull members apart, even past the old 4.2 cut-off', () => {
    // The reported case: at 5.2 these three still sat inside 30px of each
    // other, the click opened a list, and Satyr never got a name on the map.
    const hydra = entity('hydra', 22.72, 37.55)
    const pegasus = entity('pegasus', 22.88, 37.9)
    const satyr = entity('satyr', 22.3, 37.6)
    const move = clusterMove([hydra, pegasus, satyr], 5.2, 6)
    expect(move).toEqual({ kind: 'zoom', zoom: 6 })
    expect(apart(hydra, satyr, 6)).toBeGreaterThanOrEqual(COLLIDE_PX)
  })

  it('zooms far enough to leave room between members, not just past touching', () => {
    const aristotle = entity('aristotle', 23.86, 40.52)
    const plato = entity('plato', 23.73, 37.98)
    const move = clusterMove([aristotle, plato], 1.6, 6)
    expect(move.kind).toBe('zoom')
    const zoom = (move as { zoom: number }).zoom
    expect(apart(aristotle, plato, zoom)).toBeGreaterThanOrEqual(COLLIDE_PX * 2 - 1e-6)
    expect(zoom).toBeLessThan(6)
  })

  it('zooms to split off the separable members of a group that also holds a shared spot', () => {
    const move = clusterMove([entity('anat', 35.78, 35.6), entity('baal', 35.78, 35.6), entity('dagon', 36.5, 35.6)], 2, 6)
    expect(move.kind).toBe('zoom')
  })

  it('opens the list once no zoom the map allows would separate them', () => {
    // A tenth of a degree apart needs more than zoom 6 to reach 30px.
    expect(clusterMove([entity('a', 22, 37), entity('b', 22.05, 37)], 5, 6)).toEqual({ kind: 'list' })
  })
})
