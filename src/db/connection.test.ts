import { describe, expect, it } from 'vitest'
import { connectionConfig, isLocalDatabase, migrationCredentials } from './connection'

// Fixtures shaped like real connection strings, with made-up or local-only
// passwords. The pre-commit secret scan would otherwise refuse them.
// secretlint-disable-next-line
const LOCAL = 'postgres://postgres:chronotope@localhost:5432/chronotope'
const NEON =
  'postgresql://neondb_owner:secret@ep-quiet-1-pooler.ap-southeast-1.aws.neon.tech/neondb'
  + '?sslmode=require&channel_binding=require'

describe('connectionConfig', () => {
  it('leaves the Docker database exactly as it was', () => {
    expect(connectionConfig(LOCAL, {})).toEqual({ url: LOCAL, options: {} })
  })

  it('verifies the certificate of a remote database instead of trusting sslmode=require', () => {
    const { url, options } = connectionConfig(NEON, {})
    expect(options.ssl).toBe('verify-full')
    expect(url).not.toContain('sslmode')
  })

  it('drops channel_binding, which postgres.js would send to Postgres as an unknown setting', () => {
    expect(connectionConfig(NEON, {}).url).not.toContain('channel_binding')
  })

  it('keeps the pool small and quick to let go on Vercel', () => {
    const { options } = connectionConfig(NEON, { VERCEL: '1' })
    expect(options).toMatchObject({ max: 5, idle_timeout: 5, connect_timeout: 10, max_lifetime: 300 })
  })

  it('does not apply the Vercel pool settings anywhere else', () => {
    expect(connectionConfig(NEON, {}).options.max).toBeUndefined()
  })
})

describe('migrationCredentials', () => {
  it('hands drizzle-kit the Docker URL unchanged', () => {
    expect(migrationCredentials(LOCAL)).toEqual({ url: LOCAL })
  })

  it('verifies a remote certificate and sends no channel_binding, as the app client does', () => {
    // drizzle-kit passes a `url` straight to postgres.js, which is the failure
    // connectionConfig exists for. Discrete fields let `ssl` be set.
    expect(migrationCredentials(NEON)).toEqual({
      host: 'ep-quiet-1-pooler.ap-southeast-1.aws.neon.tech',
      port: 5432,
      user: 'neondb_owner',
      password: 'secret',
      database: 'neondb',
      ssl: 'verify-full',
    })
  })

  it('decodes a percent-encoded password', () => {
    // secretlint-disable-next-line
    expect(migrationCredentials('postgresql://u:a%2Fb%40c@db.example.com:6543/x')).toMatchObject({
      password: 'a/b@c',
      port: 6543,
    })
  })
})

describe('isLocalDatabase', () => {
  it('knows Docker from Neon', () => {
    expect(isLocalDatabase(LOCAL)).toBe(true)
    expect(isLocalDatabase('postgres://u:p@127.0.0.1/x')).toBe(true)
    expect(isLocalDatabase(NEON)).toBe(false)
  })
})
