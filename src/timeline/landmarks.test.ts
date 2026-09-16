import { describe, expect, it } from 'vitest'
import { buildLandmarks, describeLandmark, nextLandmark, previousLandmark } from './landmarks'

const base = {
  start: -800,
  end: 2000,
  borderChanges: [],
  eras: [],
  entities: [],
  spans: [],
}

describe('buildLandmarks', () => {
  it('marks border changes, era starts, arrivals, departures and lit layers', () => {
    const landmarks = buildLandmarks({
      ...base,
      borderChanges: [1492],
      eras: [{ label: 'Antiquity', start: -800 }, { label: 'Middle Ages', start: 500 }],
      entities: [{ name: 'Plato', from: -400, to: -348 }],
      spans: [{ name: 'Silk Road', from: -130, to: 1450 }],
    })

    expect(landmarks.map((l) => [l.year, l.labels])).toEqual([
      [-400, ['Plato appears']],
      [-347, ['Plato leaves']],
      [-130, ['Silk Road begins']],
      [500, ['Middle Ages begins']],
      [1450, ['Silk Road ends']],
      [1492, ['Borders redraw']],
    ])
  })

  it('does not mark the start of the timeline itself as a moment', () => {
    // The first era always starts where the scale starts; a landmark there is
    // a jump to Home, not a change on the map.
    const landmarks = buildLandmarks({ ...base, eras: [{ label: 'Antiquity', start: -800 }] })
    expect(landmarks).toEqual([])
  })

  it('merges everything in one year into one marker, borders first', () => {
    const landmarks = buildLandmarks({
      ...base,
      borderChanges: [1492],
      entities: [{ name: 'Columbus', from: 1492, to: 1506 }],
      eras: [{ label: 'Early Modern', start: 1492 }],
    })
    expect(landmarks).toHaveLength(2)
    expect(landmarks[0]).toEqual({
      year: 1492,
      labels: ['Borders redraw', 'Early Modern begins', 'Columbus appears'],
      kinds: ['border', 'era', 'arrival'],
    })
  })

  it('drops moments outside the scale', () => {
    const landmarks = buildLandmarks({
      ...base,
      borderChanges: [-3000, 2010],
      entities: [{ name: 'Still here', from: 1990, to: 2000 }],
    })
    expect(landmarks.map((l) => l.year)).toEqual([1990])
  })

  it('never puts a departure on year 0, which does not exist', () => {
    const landmarks = buildLandmarks({ ...base, entities: [{ name: 'Edge', from: -30, to: -1 }] })
    expect(landmarks.map((l) => l.year)).toEqual([-30, 1])
  })
})

describe('describeLandmark', () => {
  it('names up to three things, then counts the rest', () => {
    expect(describeLandmark({ year: 1492, labels: ['A', 'B'], kinds: [] })).toBe('1492 CE: A · B')
    expect(describeLandmark({ year: -350, labels: ['A', 'B', 'C', 'D', 'E'], kinds: [] }))
      .toBe('350 BCE: A · B · C and 2 more')
  })
})

describe('next and previous landmark', () => {
  const landmarks = buildLandmarks({ ...base, borderChanges: [100, 500, 900] })

  it('steps strictly past the current year', () => {
    expect(nextLandmark(landmarks, 100)?.year).toBe(500)
    expect(nextLandmark(landmarks, 101)?.year).toBe(500)
    expect(previousLandmark(landmarks, 500)?.year).toBe(100)
    expect(previousLandmark(landmarks, 499)?.year).toBe(100)
  })

  it('has nowhere to go past either end', () => {
    expect(nextLandmark(landmarks, 900)).toBeNull()
    expect(previousLandmark(landmarks, 100)).toBeNull()
  })
})
