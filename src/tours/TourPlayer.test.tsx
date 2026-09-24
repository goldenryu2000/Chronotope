/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAtlas } from '../state/store'
import TourPlayer from './TourPlayer'

const tour = {
  id: 'probe', regionSlug: 'world', title: 'Probe tour', subtitle: 'S',
  description: 'A tour the player suite renders, and nothing else reads.',
  estimatedMinutes: 4,
  stops: [
    {
      pack: 'mythology', year: -2000, entityId: 'gilgamesh',
      camera: { center: [45.64, 31.32], zoom: 4.6 }, layers: [],
      title: 'The First Question', locationLabel: 'Uruk, Sumer',
      narration: 'A king watches his friend die and refuses to accept it.',
    },
    {
      pack: 'philosophy', year: -550, entityId: 'laozi',
      camera: { center: [112.4, 34.6], zoom: 4.6 }, layers: [],
      title: 'The Turn', locationLabel: 'Zhou lands',
      narration: 'Someone starts giving reasons instead of names, and the world thins out.',
    },
  ],
}

beforeEach(() => {
  useAtlas.setState({ pendingView: null })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(tour))))
  window.history.pushState({}, '', '/world/tours/probe/1')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const props = { tourUrl: '/artifacts/tours/probe/x.json', slug: 'probe', regionSlug: 'world', stops: 2 }

describe('TourPlayer', () => {
  it('shows the stop the route named, and parks its view', async () => {
    render(<TourPlayer {...props} stop={1} />)

    expect(await screen.findByText('The First Question')).toBeTruthy()
    expect(screen.getByText(/Stop 1 of 2/)).toBeTruthy()
    await waitFor(() => {
      expect(useAtlas.getState().pendingView).toMatchObject({ pack: 'mythology', entityId: 'gilgamesh' })
    })
  })

  it("leaves onto the atlas at the stop's pack, year and figure", async () => {
    render(<TourPlayer {...props} stop={2} />)
    await screen.findByText('The Turn')

    expect(screen.getByRole('link', { name: 'Leave the tour' }).getAttribute('href'))
      .toBe('/world/philosophy?year=-550&entity=laozi')
    expect(screen.getByRole('link', { name: 'Finish' }).getAttribute('href'))
      .toBe('/world/philosophy?year=-550&entity=laozi')
  })

  it('advances to the next stop and writes the url without navigating', async () => {
    render(<TourPlayer {...props} stop={1} />)
    await screen.findByText('The First Question')

    await userEvent.click(screen.getByRole('button', { name: /next stop/i }))

    expect(await screen.findByText('The Turn')).toBeTruthy()
    expect(window.location.pathname).toBe('/world/tours/probe/2')
    await waitFor(() => {
      expect(useAtlas.getState().pendingView).toMatchObject({ pack: 'philosophy', entityId: 'laozi' })
    })
  })

  it('leaves the year alone when the timeline owns the arrow key', async () => {
    render(
      <>
        {/* Stands in for the timeline track, which is the element this
            guard exists for. Given the same role and the attributes that role
            requires, so it is the thing being simulated rather than a div. */}
        <div
          role="slider"
          tabIndex={0}
          data-testid="track"
          aria-label="timeline"
          aria-valuenow={-350}
          aria-valuemin={-3000}
          aria-valuemax={2026}
        />
        <TourPlayer {...props} stop={1} />
      </>,
    )
    await screen.findByText('The First Question')

    screen.getByTestId('track').focus()
    await userEvent.keyboard('{ArrowRight}')

    // The stop has not moved: the track handles this press, and one keystroke
    // must not both scrub the year and advance the tour.
    expect(screen.getByText('The First Question')).toBeTruthy()
  })

  it('advances on an arrow press that nothing else owns', async () => {
    render(<TourPlayer {...props} stop={1} />)
    await screen.findByText('The First Question')

    await userEvent.keyboard('{ArrowRight}')
    expect(await screen.findByText('The Turn')).toBeTruthy()
  })

  it('says so when the tour artifact will not load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    render(<TourPlayer {...props} stop={1} />)
    expect(await screen.findByText(/could not open this tour/i)).toBeTruthy()
  })
})
