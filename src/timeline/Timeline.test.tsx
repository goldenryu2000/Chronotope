/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAtlas } from '../state/store'
import { buildScale } from './scale'
import Timeline from './Timeline'
import { IDLE_MS } from './useExpansion'

// Two eras of equal weight, so each takes exactly half the track: antiquity at
// offset 0 span 0.5, the middle ages at offset 0.5 span 0.5. That makes every
// position below a number worth asserting by hand.
const scale = buildScale([
  { id: 'antiquity', label: 'Antiquity', start: -1000, end: 500, weight: 1, blurb: 'The long first stretch of it.' },
  { id: 'middle', label: 'Middle Ages', start: 500, end: 1500, weight: 1, blurb: 'The long second stretch of it.' },
])

// Titles are anchored with `^` throughout. The era buttons carry their blurbs
// as titles in the same DOM, and `getByTitle` throws on more than one match, so
// an unanchored /Long/ would start failing the moment a blurb was reworded.
afterEach(cleanup)

describe('Timeline spans', () => {
  it('draws nothing when no layer is lit', () => {
    render(<Timeline scale={scale} entities={[]} spans={[]} />)
    expect(screen.queryByTestId('layer-spans')).toBeNull()
  })

  it('draws one band per lit layer, in its slot colour', () => {
    render(
      <Timeline
        scale={scale}
        entities={[]}
        spans={[{ slug: 'silk-road', name: 'Silk Road', from: -130, to: 1450, paletteSlot: 1 }]}
      />,
    )
    const band = screen.getByTitle(/^Silk Road:/)
    expect(band.style.background).toBe('var(--map-layer-1)')

    // 130 BCE is 870 years into antiquity's 1500, so 0.58 of its half of the
    // track; 1450 is 950 years into the middle ages' 1000, so 0.95 of the
    // second half. Asserted as numbers because "not empty" would pass on any
    // placement at all, including a wrong one.
    expect(Number.parseFloat(band.style.left)).toBeCloseTo(29, 9)
    expect(Number.parseFloat(band.style.width)).toBeCloseTo(68.5, 9)
  })

  it('clips a span that runs past the scale', () => {
    render(
      <Timeline
        scale={scale}
        entities={[]}
        spans={[{ slug: 'long', name: 'Long', from: -5000, to: 5000, paletteSlot: 2 }]}
      />,
    )
    const band = screen.getByTitle(/^Long:/)
    expect(band.style.background).toBe('var(--map-layer-2)')
    expect(band.style.left).toBe('0%')
    expect(band.style.width).toBe('100%')
  })

  it('draws nothing for a layer whose years miss the scale', () => {
    render(
      <Timeline
        scale={scale}
        entities={[]}
        spans={[{ slug: 'later', name: 'Later', from: 1600, to: 1900, paletteSlot: 3 }]}
      />,
    )
    expect(screen.queryByTitle(/Later/)).toBeNull()
    expect(screen.queryByTestId('layer-spans')).toBeNull()
  })

  it('draws nothing for a layer whose years end before the scale begins', () => {
    // The other half of the overlap filter. Test 4 above covers a layer that
    // starts after the scale ends; without this one, deleting
    // `span.to >= scale.start` leaves every test green while a layer that
    // finished two millennia early draws a stub pinned to the left edge.
    render(
      <Timeline
        scale={scale}
        entities={[]}
        spans={[{ slug: 'earlier', name: 'Earlier', from: -5000, to: -2000, paletteSlot: 4 }]}
      />,
    )
    expect(screen.queryByTitle(/^Earlier:/)).toBeNull()
    expect(screen.queryByTestId('layer-spans')).toBeNull()
  })

  it('keeps a one-year span visible, and inside the row', () => {
    // The width floor, which nothing else reaches: test 2 is 68.5% wide and
    // test 3 is 100%. A single year at the very end of the scale is also the
    // case that used to paint from 100% to 100.5%, past the end of the row.
    render(
      <Timeline
        scale={scale}
        entities={[]}
        spans={[{ slug: 'brief', name: 'Brief', from: 1500, to: 1500, paletteSlot: 5 }]}
      />,
    )
    const band = screen.getByTitle(/^Brief:/)
    expect(Number.parseFloat(band.style.width)).toBeCloseTo(0.5, 9)
    expect(Number.parseFloat(band.style.left)).toBeCloseTo(99.5, 9)

    // The assertion that matters: the bar ends exactly at the row's end.
    const left = Number.parseFloat(band.style.left)
    const width = Number.parseFloat(band.style.width)
    expect(left + width).toBeLessThanOrEqual(100)
  })

  it('gives each of several lit layers its own bar', () => {
    // Two overlapping layers, which is the ordinary case: eight of the nine
    // layers this ships with overlap somebody. Drawn in one lane they blend
    // into a single bar in a colour neither of them is.
    render(
      <Timeline
        scale={scale}
        entities={[]}
        spans={[
          { slug: 'silk-road', name: 'Silk Road', from: -130, to: 1450, paletteSlot: 1 },
          { slug: 'buddhism', name: 'Buddhism', from: -250, to: 800, paletteSlot: 7 },
        ]}
      />,
    )
    expect(screen.getByTitle(/^Silk Road:/).style.background).toBe('var(--map-layer-1)')
    expect(screen.getByTitle(/^Buddhism:/).style.background).toBe('var(--map-layer-7)')

    // Separate lanes, so neither is painted over by the other.
    const lanes = document.querySelectorAll('.timeline__layer-lane')
    expect(lanes).toHaveLength(2)
    expect(lanes[0].contains(screen.getByTitle(/^Silk Road:/))).toBe(true)
    expect(lanes[1].contains(screen.getByTitle(/^Buddhism:/))).toBe(true)
  })

  it('names the years in the tooltip, since the row is hidden from readers', () => {
    // `aria-hidden` means the title is the only text this row exposes. Saying
    // "the years it draws" without saying which years left it conveying less
    // than the colour already did.
    render(
      <Timeline
        scale={scale}
        entities={[]}
        spans={[{ slug: 'silk-road', name: 'Silk Road', from: -130, to: 1450, paletteSlot: 1 }]}
      />,
    )
    expect(screen.getByTitle(/^Silk Road:/).title).toBe('Silk Road: 130 BCE to 1450 CE')
  })
})

describe('Timeline precision controls', () => {
  const year = () => useAtlas.getState().year

  beforeEach(() => {
    useAtlas.setState({ year: 100 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts compact, with no detail track', () => {
    render(<Timeline scale={scale} entities={[]} spans={[]} />)
    expect(screen.queryByTestId('detail-track')).toBeNull()
  })

  it('expands when the overview track is pressed, and folds away once left alone', () => {
    vi.useFakeTimers()
    render(<Timeline scale={scale} entities={[]} spans={[]} />)

    fireEvent.pointerDown(screen.getByTestId('timeline-track'), { pointerId: 1, clientX: 0 })
    expect(screen.getByTestId('detail-track')).toBeTruthy()

    act(() => vi.advanceTimersByTime(IDLE_MS + 10))
    expect(screen.queryByTestId('detail-track')).toBeNull()
  })

  it('goes to a typed year, clamped to the scale', () => {
    render(<Timeline scale={scale} entities={[]} spans={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /type a year/i }))
    const input = screen.getByTestId('year-input')
    fireEvent.change(input, { target: { value: '350 BCE' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(year()).toBe(-350)

    fireEvent.click(screen.getByRole('button', { name: /type a year/i }))
    fireEvent.change(screen.getByTestId('year-input'), { target: { value: '3000' } })
    fireEvent.keyDown(screen.getByTestId('year-input'), { key: 'Enter' })
    expect(year()).toBe(1500)
  })

  it('keeps editing and says why when the year makes no sense', () => {
    render(<Timeline scale={scale} entities={[]} spans={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /type a year/i }))
    const input = screen.getByTestId('year-input')
    fireEvent.change(input, { target: { value: 'soon' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(year()).toBe(100)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('Try 1492 or 350 BCE')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('year-input')).toBeNull()
    expect(year()).toBe(100)
  })

  it('steps a year at a time, never landing on year 0', () => {
    useAtlas.setState({ year: -1 })
    render(<Timeline scale={scale} entities={[]} spans={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Forward one year' }))
    expect(year()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Back one year' }))
    expect(year()).toBe(-1)
  })

  it('jumps between landmarks with the buttons and the bracket keys', () => {
    render(<Timeline scale={scale} entities={[]} spans={[]} borderChanges={[700, 1200]} />)

    // From 100 the next landmark is the Middle Ages beginning at 500.
    fireEvent.click(screen.getByRole('button', { name: /next landmark/i }))
    expect(year()).toBe(500)

    fireEvent.keyDown(screen.getByTestId('timeline-track'), { key: ']' })
    expect(year()).toBe(700)

    fireEvent.keyDown(screen.getByTestId('timeline-track'), { key: '[' })
    expect(year()).toBe(500)

    // Said out loud for screen readers, since the map change is visual.
    expect(screen.getByTestId('timeline-announcement').textContent).toBe('500 CE: Middle Ages begins')
  })
})

describe('Timeline expand button and a steady ruler', () => {
  const year = () => useAtlas.getState().year
  const detail = () => screen.queryByTestId('detail-track')

  beforeEach(() => {
    useAtlas.setState({ year: 100 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('collapses at once when collapse is pressed, even with the pointer resting on it', () => {
    render(<Timeline scale={scale} entities={[]} spans={[]} />)
    fireEvent.pointerEnter(document.querySelector('.timeline')!)

    fireEvent.click(screen.getByRole('button', { name: 'Expand timeline' }))
    expect(detail()).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse timeline' }))
    expect(detail()).toBeNull()
  })

  it('offers collapse whenever it is expanded, however it opened', () => {
    render(<Timeline scale={scale} entities={[]} spans={[]} />)
    fireEvent.pointerDown(screen.getByTestId('timeline-track'), { pointerId: 1, clientX: 0 })
    expect(detail()).toBeTruthy()

    const button = screen.getByRole('button', { name: 'Collapse timeline' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(button)
    expect(detail()).toBeNull()
  })

  it('stays open after expand until collapse is pressed', () => {
    vi.useFakeTimers()
    render(<Timeline scale={scale} entities={[]} spans={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand timeline' }))
    act(() => vi.advanceTimersByTime(IDLE_MS * 3))
    expect(detail()).toBeTruthy()
  })

  it('does not open the precise timeline for a one-year step or an era pick', () => {
    render(<Timeline scale={scale} entities={[]} spans={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Forward one year' }))
    fireEvent.click(screen.getByRole('button', { name: /^Middle Ages$/ }))
    expect(year()).toBe(1000)
    expect(detail()).toBeNull()
  })

  it('keeps the ruler still while stepping within it', () => {
    render(<Timeline scale={scale} entities={[]} spans={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand timeline' }))
    const tickLeft = () => (screen.getByText('110').parentElement as HTMLElement).style.left

    const before = tickLeft()
    fireEvent.click(screen.getByRole('button', { name: 'Forward one year' }))
    expect(year()).toBe(101)
    expect(tickLeft()).toBe(before)
  })

  it('moves the ruler once the year leaves it', () => {
    render(<Timeline scale={scale} entities={[]} spans={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand timeline' }))
    fireEvent.click(screen.getByRole('button', { name: /type a year/i }))
    fireEvent.change(screen.getByTestId('year-input'), { target: { value: '400' } })
    fireEvent.keyDown(screen.getByTestId('year-input'), { key: 'Enter' })
    expect(screen.getByText('400')).toBeTruthy()
  })

  it('leaves the handle where the pointer let go', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 1000, bottom: 20, width: 1000, height: 20, x: 0, y: 0, toJSON: () => ({}),
    })
    render(<Timeline scale={scale} entities={[]} spans={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand timeline' }))

    const track = screen.getByTestId('detail-track')
    fireEvent.pointerDown(track, { pointerId: 1, clientX: 850 })
    fireEvent.pointerUp(track, { pointerId: 1, clientX: 850 })

    // The window is 40 to 160, so 85% of the way along is 142.
    expect(year()).toBe(142)
    const handle = document.querySelector('.timeline__detail-handle') as HTMLElement
    expect(Number.parseFloat(handle.style.left)).toBeCloseTo(85, 0)
  })
})
