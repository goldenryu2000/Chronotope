import { describe, expect, it } from 'vitest'
import { formatYear, parseYear, yearsBetween } from './year'

describe('parseYear', () => {
  it('reads a bare number as CE and a negative one as BCE', () => {
    expect(parseYear('1492')).toBe(1492)
    expect(parseYear('-350')).toBe(-350)
  })

  it('reads era words either side, in any case, with or without dots', () => {
    expect(parseYear('350 BCE')).toBe(-350)
    expect(parseYear('350 bc')).toBe(-350)
    expect(parseYear('350 B.C.')).toBe(-350)
    expect(parseYear('1492 CE')).toBe(1492)
    expect(parseYear('AD 1492')).toBe(1492)
    expect(parseYear('1492 a.d.')).toBe(1492)
  })

  it('ignores surrounding space and thousands separators', () => {
    expect(parseYear('  1,492 ')).toBe(1492)
  })

  it('refuses what is not a year, including year 0 which this atlas does not have', () => {
    for (const input of ['', 'soon', '0', '0 BCE', '12.5', '-350 BCE', '1492 CE BCE', '--5']) {
      expect(parseYear(input)).toBeNull()
    }
  })
})

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
