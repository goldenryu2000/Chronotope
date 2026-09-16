import './load-env'

import { pathToFileURL } from 'node:url'
import type { Sql } from 'postgres'
import { db } from '../src/db/client'

export interface AppRole {
  role: string
  password: string
  database: string
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/
const PASSWORD = /^[A-Za-z0-9_-]{32,128}$/

/**
 * The role Vercel connects as. It can select from every table in `public` and
 * do nothing else.
 *
 * The site never writes at request time: every write is an import or a publish
 * run from the owner's machine as the database owner. A read-only runtime role
 * means a bug or an injection in a page can read public content and nothing
 * more.
 *
 * `default_transaction_read_only` is only a default, and any session can turn
 * it off. The grants are what actually stop a write; the default makes a stray
 * write fail with a clear message. `statement_timeout` caps what one runaway
 * PostGIS query can cost against Neon's monthly compute.
 *
 * `CREATE ROLE ... PASSWORD` cannot take a bind parameter, so the password is
 * interpolated. The patterns above are what make that safe: no quote, no
 * backslash, no dollar sign can reach the statement.
 *
 * `ALTER DEFAULT PRIVILEGES` covers tables created later by the role running
 * this script, which is the role that runs migrations.
 */
export function appRoleStatements({ role, password, database }: AppRole): string[] {
  if (!IDENTIFIER.test(role)) throw new Error(`role name must match ${IDENTIFIER}`)
  if (!IDENTIFIER.test(database)) throw new Error(`database name must match ${IDENTIFIER}`)
  if (!PASSWORD.test(password)) {
    throw new Error('password must be 32 to 128 characters of letters, digits, _ or -')
  }

  return [
    `do $$ begin
       if exists (select from pg_roles where rolname = '${role}') then
         alter role ${role} with login password '${password}';
       else
         create role ${role} with login password '${password}';
       end if;
     end $$`,
    `alter role ${role} set default_transaction_read_only = on`,
    `alter role ${role} set statement_timeout = '10s'`,
    `alter role ${role} set idle_in_transaction_session_timeout = '15s'`,
    `grant connect on database ${database} to ${role}`,
    `grant usage on schema public to ${role}`,
    `grant select on all tables in schema public to ${role}`,
    `alter default privileges in schema public grant select on tables to ${role}`,
  ]
}

export async function createAppRole(client: Sql, spec: AppRole): Promise<void> {
  for (const statement of appRoleStatements(spec)) {
    await client.unsafe(statement)
  }
}

async function run() {
  const password = process.env.APP_ROLE_PASSWORD
  if (!password) throw new Error('APP_ROLE_PASSWORD is not set')
  const database = new URL(process.env.DATABASE_URL!).pathname.slice(1)
  await createAppRole(db.$client, { role: 'chronotope_app', password, database })
  console.log(`Role chronotope_app can read ${database} and nothing else.`)
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
      await db.$client.end()
    })
}
