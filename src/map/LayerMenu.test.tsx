/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAtlas } from '../state/store'
import type { RegionLayer } from '../read/regionLayers'
import LayerMenu from './LayerMenu'

const layers: RegionLayer[] = [
  {
    slug: 'silk-road', name: 'Silk Road', kind: 'trade', paletteSlot: 1,
    valid: { start: -130, end: 1450 }, note: 'Han embassies west.',
    artifactUrl: '/artifacts/layers/silk-road/aaaa.json',
  },
  {
    slug: 'atlantic-passage', name: 'The Transatlantic Slave Trade', kind: 'migration',
    paletteSlot: 9, valid: { start: 1500, end: 1850 }, note: 'Twelve million people.',
    artifactUrl: '/artifacts/layers/atlantic-passage/bbbb.json',
  },
]

beforeEach(() => {
  useAtlas.setState({ activeLayers: [], year: 900 })
})
afterEach(cleanup)

describe('LayerMenu', () => {
  it('offers nothing when the region has no layers', () => {
    render(<LayerMenu layers={[]} />)
    expect(screen.queryByRole('button', { name: /layers/i })).toBeNull()
  })

  it('lists every layer under its kind', async () => {
    render(<LayerMenu layers={layers} />)
    await userEvent.click(screen.getByRole('button', { name: /layers/i }))
    expect(screen.getByText('Silk Road')).toBeTruthy()
    expect(screen.getByText('The Transatlantic Slave Trade')).toBeTruthy()
    expect(screen.getByRole('group', { name: /trade routes/i })).toBeTruthy()
  })

  it('lights a layer and puts the count on the toggle', async () => {
    render(<LayerMenu layers={layers} />)
    await userEvent.click(screen.getByRole('button', { name: /layers/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: /silk road/i }))
    expect(useAtlas.getState().activeLayers).toEqual(['silk-road'])
    expect(screen.getByTestId('layer-count').textContent).toBe('1')
  })

  it('says which side of its years a lit layer is on', async () => {
    useAtlas.setState({ activeLayers: ['atlantic-passage'], year: 900 })
    render(<LayerMenu layers={layers} />)
    await userEvent.click(screen.getByRole('button', { name: /layers/i }))
    expect(screen.getByText(/not yet/i)).toBeTruthy()

    // Wrapped in `act`, unlike the setup above: this call lands after the
    // component has mounted and subscribed, so React must be told to flush
    // the resulting re-render before the assertion reads the DOM. The
    // `beforeEach` writes above run before `render`, so there is no
    // subscriber yet and no flush to wait for.
    act(() => {
      useAtlas.setState({ year: 1900 })
    })
    expect(screen.getByText(/long gone/i)).toBeTruthy()
  })

  it('clears every lit layer at once', async () => {
    useAtlas.setState({ activeLayers: ['silk-road', 'atlantic-passage'] })
    render(<LayerMenu layers={layers} />)
    await userEvent.click(screen.getByRole('button', { name: /layers/i }))
    await userEvent.click(screen.getByRole('button', { name: /clear all/i }))
    expect(useAtlas.getState().activeLayers).toEqual([])
  })
})
