import { describe, expect, it } from 'vitest'
import { atlasHref, readAtlasLink } from './atlasUrl'

describe('readAtlasLink', () => {
  it('reads a signed year and a slug', () => {
    expect(readAtlasLink('?year=-350&entity=plato')).toEqual({ year: -350, entity: 'plato' })
  })

  it('drops what is not a year or a slug', () => {
    expect(readAtlasLink('?year=soon&entity=<script>')).toEqual({})
    expect(readAtlasLink('?year=1.5')).toEqual({})
    expect(readAtlasLink('?year=0')).toEqual({})
  })

  it('reads nothing from an empty address', () => {
    expect(readAtlasLink('')).toEqual({})
  })
})

describe('atlasHref', () => {
  it('writes the year and the figure after the path', () => {
    expect(atlasHref('world', 'philosophy', { year: -350, entity: 'plato' }))
      .toBe('/world/philosophy?year=-350&entity=plato')
  })

  it('writes a bare path when there is nothing to add', () => {
    expect(atlasHref('world', 'philosophy')).toBe('/world/philosophy')
  })

  it('round-trips', () => {
    const href = atlasHref('india', 'mythology', { year: 1200, entity: 'indra' })
    expect(readAtlasLink(href.slice(href.indexOf('?')))).toEqual({ year: 1200, entity: 'indra' })
  })
})
