import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { S3Client } from '@aws-sdk/client-s3'
import { afterAll, describe, expect, it } from 'vitest'
import { TILE_CACHE, uploadTiles } from './upload-tiles'

const dir = mkdtempSync(join(tmpdir(), 'chronotope-tiles-'))
writeFileSync(join(dir, 'world.pmtiles'), Buffer.from([1, 2, 3, 4]))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function fakeClient() {
  const sent: Array<Record<string, unknown>> = []
  const client = { send: async (c: { input: Record<string, unknown> }) => { sent.push(c.input) } }
  return { sent, client: client as unknown as Pick<S3Client, 'send'> }
}

describe('uploadTiles', () => {
  it('uploads under the key build-tiles records on the region', async () => {
    const { sent, client } = fakeClient()
    const result = await uploadTiles(client, 'chronotope-assets', 'world', dir)
    expect(result).toEqual({ key: 'tiles/world.pmtiles', bytes: 4 })
    expect(sent[0]).toMatchObject({
      Bucket: 'chronotope-assets',
      Key: 'tiles/world.pmtiles',
      ContentType: 'application/octet-stream',
      CacheControl: TILE_CACHE,
    })
  })

  it('says to build the archive first when there is none', async () => {
    const { client } = fakeClient()
    await expect(uploadTiles(client, 'b', 'india', dir)).rejects.toThrow(/build-tiles/)
  })

  it('refuses a region that is not a slug, since it becomes a path', async () => {
    const { client } = fakeClient()
    await expect(uploadTiles(client, 'b', '../world', dir)).rejects.toThrow(/slug/)
  })
})
