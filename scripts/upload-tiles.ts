import './load-env'

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { S3Client } from '@aws-sdk/client-s3'
import { db } from '../src/db/client'
import { putObject, r2Client, r2ConfigFromEnv } from '../src/publish/r2'
import { TILE_DIR, tileableRegions } from './build-tiles'

/**
 * An hour, not forever. The archive keeps one key per region and is rebuilt
 * in place, unlike artifacts, so a long cache would serve old borders for days.
 * PMTiles clients send the ETag with each range request, so a rebuild in the
 * middle of someone's session is detected rather than stitched into the old
 * archive.
 */
export const TILE_CACHE = 'public, max-age=3600'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export async function uploadTiles(
  client: Pick<S3Client, 'send'>,
  bucket: string,
  region: string,
  dir = TILE_DIR,
): Promise<{ key: string; bytes: number }> {
  if (!SLUG.test(region)) throw new Error(`region must be a slug, not "${region}"`)
  const path = join(dir, `${region}.pmtiles`)
  if (!existsSync(path)) {
    throw new Error(`no archive at ${path}. Run \`npx tsx scripts/build-tiles.ts ${region}\` first.`)
  }
  // Must match what build-tiles writes to regions.tileset_key.
  const key = `tiles/${region}.pmtiles`
  const body = readFileSync(path)
  await putObject(client, {
    bucket,
    key,
    body,
    contentType: 'application/octet-stream',
    cacheControl: TILE_CACHE,
  })
  return { key, bytes: body.byteLength }
}

async function run() {
  // No argument uploads every archive that has been cut, matching
  // `build-tiles.ts`: a deploy that uploaded only the region whose slug
  // someone remembered to type would publish a second plate pointing at tiles
  // the bucket does not hold, and the atlas draws no map without them.
  const only = process.argv[2]
  const slugs = only ? [only] : await tileableRegions()
  if (slugs.length === 0) throw new Error('no region has an archive to upload')

  const config = r2ConfigFromEnv(process.env)
  const client = r2Client(config)
  for (const region of slugs) {
    const { key, bytes } = await uploadTiles(client, config.bucket, region)
    console.log(`Uploaded ${key} (${(bytes / 1e6).toFixed(1)} MB)`)
  }
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  run()
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
    .finally(async () => {
      // build-tiles imports the database client, and an open pool keeps the process alive.
      await db.$client.end()
    })
}
