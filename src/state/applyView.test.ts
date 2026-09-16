import { beforeEach, describe, expect, it } from 'vitest'
import { INITIAL_YEAR, useAtlas } from './store'

describe('applyView', () => {
  beforeEach(() => {
    useAtlas.setState({
      year: INITIAL_YEAR, selectedId: null, cameraTarget: null, pendingView: null,
    })
  })

  it('parks the view rather than applying it, because the pack may not be here yet', () => {
    const view = {
      pack: 'mythology', year: -2000, entityId: 'gilgamesh',
      camera: { center: [45.64, 31.32] as [number, number], zoom: 4.6 }, layers: [],
    }
    useAtlas.getState().applyView(view)

    expect(useAtlas.getState().pendingView).toEqual(view)
    // Nothing has moved: the atlas consumes this once the named pack has landed.
    expect(useAtlas.getState().year).toBe(INITIAL_YEAR)
    expect(useAtlas.getState().selectedId).toBeNull()
  })

  it('clears on null, so exiting a tour leaves nothing half-applied', () => {
    useAtlas.getState().applyView({
      pack: 'philosophy', year: -350, entityId: null, camera: null, layers: [],
    })
    useAtlas.getState().applyView(null)
    expect(useAtlas.getState().pendingView).toBeNull()
  })
})
