import { describe, expect, it } from 'vitest'
import { formatYear, yearsBetween } from './year'

describe('formatYear', () => {
  it('labels negative years BCE', () => {
    expect(formatYear(-384)).toBe('384 BCE')
  })
  it('labels positive years CE', () => {
    expect(formatYear(1650)).toBe('1650 CE')
  })
})

describe('yearsBetween', () => {
  it('measures within an epoch', () => {
    expect(yearsBetween(1600, 1650)).toBe(50)
  })
  it('drops the non-existent year 0 when crossing epochs', () => {
    // 1 BCE to 1 CE is one year, not two.
    expect(yearsBetween(-1, 1)).toBe(1)
  })
})
