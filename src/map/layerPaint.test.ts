/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { LAYER_KINDS } from '../data/schemas'
import { LAYER_LINE_PREFIX, KIND_DASH, layerLineId, layerLinePaint, layerSourceId } from './layerPaint'

vi.mock('../theme/themes', () => ({
  token: (name: string) => `token(${name})`,
}))

describe('layer ids', () => {
  it("namespaces a layer's source and line", () => {
    expect(layerSourceId('silk-road')).toBe('layer-source-silk-road')
    expect(layerLineId('silk-road')).toBe(`${LAYER_LINE_PREFIX}silk-road`)
  })
})

describe('KIND_DASH', () => {
  it('gives every kind a pattern of its own', () => {
    const patterns = LAYER_KINDS.map((kind) => JSON.stringify(KIND_DASH[kind]))
    expect(new Set(patterns).size).toBe(LAYER_KINDS.length)
  })
})

describe('layerLinePaint', () => {
  it('takes its colour from the slot token, never a literal', () => {
    const paint = layerLinePaint(3, 'trade')
    expect(paint['line-color']).toBe('token(--map-layer-3)')
    expect(JSON.stringify(paint)).not.toMatch(/#[0-9a-f]{3}/i)
  })

  it('dashes by kind', () => {
    expect(layerLinePaint(1, 'idea')['line-dasharray']).toEqual(KIND_DASH.idea)
    expect(layerLinePaint(1, 'migration')['line-dasharray']).toEqual(KIND_DASH.migration)
  })
})
