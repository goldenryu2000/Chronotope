import type { S3Client } from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'
import { IMMUTABLE, r2Storage } from './r2'
import { storageFromEnv } from './selectStorage'

function fakeClient() {
  const sent: Array<Record<string, unknown>> = []
  const client = {
    send: async (command: { input: Record<string, unknown> }) => {
      sent.push(command.input)
    },
  }
  return { sent, client: client as unknown as Pick<S3Client, 'send'> }
}

// Fixtures shaped like real connection strings and R2 credentials, with
// made-up or local-only values. The pre-commit secret scan would otherwise
// refuse them.
// secretlint-disable
const LOCAL = 'postgres://postgres:chronotope@localhost:5432/chronotope'
const NEON = 'postgresql://owner:secret@ep-quiet-1.ap-southeast-1.aws.neon.tech/neondb'
const R2 = {
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'shh',
  R2_BUCKET: 'chronotope-assets',
}
// secretlint-enable

describe('r2Storage', () => {
  it('writes each artifact under artifacts/ and lets browsers keep it for a year', async () => {
    const { sent, client } = fakeClient()
    await r2Storage(client, 'chronotope-assets')
      .put('packs/philosophy/abc123.json', '{}', 'application/json')
    expect(sent).toEqual([{
      Bucket: 'chronotope-assets',
      Key: 'artifacts/packs/philosophy/abc123.json',
      Body: '{}',
      ContentType: 'application/json',
      CacheControl: IMMUTABLE,
    }])
  })
})

describe('storageFromEnv', () => {
  it('publishes the Docker database to local disk, as before', () => {
    expect(() => storageFromEnv({ DATABASE_URL: LOCAL })).not.toThrow()
  })

  it('refuses to publish a remote database to local disk', () => {
    expect(() => storageFromEnv({ DATABASE_URL: NEON })).toThrow(/STORAGE=r2/)
  })

  it('refuses to publish the Docker database into the production bucket', () => {
    expect(() => storageFromEnv({ DATABASE_URL: LOCAL, STORAGE: 'r2', ...R2 }))
      .toThrow(/local database/)
  })

  it('names every missing R2 variable and prints no values', () => {
    expect(() => storageFromEnv({ DATABASE_URL: NEON, STORAGE: 'r2', R2_SECRET_ACCESS_KEY: 'shh' }))
      .toThrow('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_BUCKET')
  })

  it('builds R2 storage when everything is set', () => {
    expect(storageFromEnv({ DATABASE_URL: NEON, STORAGE: 'r2', ...R2 }).put).toBeTypeOf('function')
  })

  it('refuses a storage kind it does not know', () => {
    expect(() => storageFromEnv({ DATABASE_URL: LOCAL, STORAGE: 's3' })).toThrow(/"file" or "r2"/)
  })
})
