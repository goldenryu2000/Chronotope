import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../src/db/client'
import { appRoleStatements, createAppRole } from './create-app-role'

const ROLE = 'chronotope_app_test'
const PASSWORD = 'test_only_password_long_enough_0123456789'
const testUrl = new URL(process.env.DATABASE_URL_TEST!)
const database = testUrl.pathname.slice(1)

describe('appRoleStatements', () => {
  it('refuses a role name that would need quoting', () => {
    expect(() => appRoleStatements({ role: 'app"; drop role x; --', password: PASSWORD, database }))
      .toThrow(/role name/)
  })

  it('refuses a password that is short or could break out of its literal', () => {
    expect(() => appRoleStatements({ role: ROLE, password: "short'", database })).toThrow(/password/)
  })
})

describe('createAppRole', () => {
  let asApp: postgres.Sql

  beforeAll(async () => {
    await createAppRole(db.$client, { role: ROLE, password: PASSWORD, database })
    const url = new URL(testUrl)
    url.username = ROLE
    url.password = PASSWORD
    asApp = postgres(url.toString(), { max: 1, onnotice: () => {} })
  })

  afterAll(async () => {
    await asApp.end()
    await db.$client.unsafe(`drop owned by ${ROLE}`)
    await db.$client.unsafe(`drop role ${ROLE}`)
  })

  it('can read what the site renders', async () => {
    const [row] = await asApp`select count(*)::int as n from regions`
    expect(row.n).toBeGreaterThanOrEqual(0)
  })

  it('cannot write, even after asking for a read-write transaction', async () => {
    await expect(asApp.begin('read write', (sql) => sql`delete from regions where false`))
      .rejects.toThrow(/permission denied/)
  })

  it('defaults to read-only and gives up on a runaway query', async () => {
    const [readOnly] = await asApp`show default_transaction_read_only`
    const [timeout] = await asApp`show statement_timeout`
    expect(readOnly.default_transaction_read_only).toBe('on')
    expect(timeout.statement_timeout).toBe('10s')
  })

  it('can be run again to rotate the password', async () => {
    await expect(createAppRole(db.$client, { role: ROLE, password: PASSWORD, database }))
      .resolves.toBeUndefined()
  })
})
