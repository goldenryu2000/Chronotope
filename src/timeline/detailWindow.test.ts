import { describe, expect, it } from 'vitest'
import {
  DETAIL_SPAN,
  detailTicks,
  fractionOfYear,
  shiftWindow,
  windowAround,
  yearInWindow,
} from './detailWindow'

describe('windowAround', () => {
  it('centres a 120-year window on the year', () => {
    expect(DETAIL_SPAN).toBe(120)
    expect(windowAround(1500, -800, 2026)).toEqual({ from: 1440, to: 1560 })
  })

  it('stays inside the scale at either end, keeping its width', () => {
    expect(windowAround(-790, -800, 2026)).toEqual({ from: -800, to: -680 })
    expect(windowAround(2020, -800, 2026)).toEqual({ from: 1906, to: 2026 })
  })

  it('shrinks to the scale when the whole scale is narrower than a window', () => {
    expect(windowAround(1950, 1900, 2000)).toEqual({ from: 1900, to: 2000 })
  })
})

describe('yearInWindow and fractionOfYear', () => {
  const window = { from: 1440, to: 1560 }

  it('maps linearly, a year per 1/120 of the track', () => {
    expect(yearInWindow(window, 0)).toBe(1440)
    expect(yearInWindow(window, 0.5)).toBe(1500)
    expect(yearInWindow(window, 1)).toBe(1560)
    expect(fractionOfYear(window, 1470)).toBeCloseTo(0.25, 9)
  })

  it('clamps a pointer past either edge to the edge year', () => {
    expect(yearInWindow(window, -0.3)).toBe(1440)
    expect(yearInWindow(window, 1.4)).toBe(1560)
  })

  it('never lands on year 0', () => {
    const around = { from: -60, to: 60 }
    expect(yearInWindow(around, 0.5)).not.toBe(0)
  })
})

describe('shiftWindow', () => {
  it('pans by whole years and stops at the scale ends', () => {
    expect(shiftWindow({ from: 1440, to: 1560 }, 10, -800, 2026)).toEqual({ from: 1450, to: 1570 })
    expect(shiftWindow({ from: 1900, to: 2020 }, 50, -800, 2026)).toEqual({ from: 1906, to: 2026 })
    expect(shiftWindow({ from: -790, to: -670 }, -50, -800, 2026)).toEqual({ from: -800, to: -680 })
  })
})

describe('detailTicks', () => {
  it('gives every year a tick, labels each decade, and skips year 0', () => {
    const ticks = detailTicks({ from: -12, to: 12 })
    expect(ticks.some((tick) => tick.year === 0)).toBe(false)
    expect(ticks).toHaveLength(24)
    expect(ticks.filter((tick) => tick.label).map((tick) => tick.year)).toEqual([-10, 10])
    expect(ticks.find((tick) => tick.year === 5)?.mid).toBe(true)
  })
})
