import { describe, expect, it } from 'vitest'
import { fileStorage } from './storage'

describe('fileStorage', () => {
  it('refuses a key that would escape the storage root', async () => {
    const storage = fileStorage()
    await expect(storage.put('../../etc/x.json', '{}', 'application/json'))
      .rejects.toThrow(/refusing to write outside storage root/)
  })
})
