import { describe, expect, it } from 'vitest'
import { LICENCES, LicenceSchema, licenceUrl } from './licences'

describe('licences', () => {
  it('links every Creative Commons licence to its deed', () => {
    for (const [label, url] of Object.entries(LICENCES)) {
      if (label.startsWith('CC')) expect(url).toMatch(/^https:\/\/creativecommons\.org\/.+\/$/)
    }
  })

  it('has nothing to link for public domain', () => {
    expect(licenceUrl('Public domain')).toBeNull()
  })

  it('refuses a licence nobody has reviewed, non-commercial ones included', () => {
    expect(LicenceSchema.safeParse('CC BY-NC 4.0').success).toBe(false)
    expect(licenceUrl('CC BY-NC 4.0')).toBeNull()
  })
})
