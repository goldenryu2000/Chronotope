import type postgres from 'postgres'

export type ClientOptions = postgres.Options<Record<string, postgres.PostgresType>>

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function isLocalDatabase(rawUrl: string): boolean {
  return LOCAL_HOSTS.has(new URL(rawUrl).hostname)
}

/**
 * The URL and options postgres.js should actually be given.
 *
 * Two things in the connection strings Neon hands out are wrong for this
 * driver, and neither fails loudly:
 *
 * - `sslmode=require` becomes `ssl: 'require'`, which postgres.js implements
 *   as `rejectUnauthorized: false`. The link is encrypted and the certificate
 *   is never checked, so anyone on the path can present their own. A remote
 *   database gets `verify-full`. Neon's certificates chain to public roots.
 * - Any query parameter postgres.js does not recognise is sent to the server
 *   as a startup setting. `channel_binding` is not a Postgres setting, so the
 *   server refuses the connection.
 *
 * On Vercel, functions share warm instances and are suspended between
 * requests. A small pool with a five-second idle timeout lets sockets close
 * before suspension instead of leaking. Through Neon's transaction-mode
 * pooler a leaked client socket holds no server connection, which is why
 * this driver was kept rather than switching to `pg` for
 * `attachDatabasePool` (that would change 31 `.execute()` call sites).
 */
export function connectionConfig(
  rawUrl: string,
  env: Record<string, string | undefined>,
): { url: string; options: ClientOptions } {
  const url = new URL(rawUrl)
  const local = LOCAL_HOSTS.has(url.hostname)
  if (local) return { url: rawUrl, options: {} }

  url.searchParams.delete('sslmode')
  url.searchParams.delete('channel_binding')

  const options: ClientOptions = { ssl: 'verify-full' }
  if (env.VERCEL === '1') {
    Object.assign(options, { max: 5, idle_timeout: 5, connect_timeout: 10, max_lifetime: 300 })
  }
  return { url: url.toString(), options }
}

export type MigrationCredentials =
  | { url: string }
  | { host: string; port: number; user: string; password: string; database: string; ssl: 'verify-full' }

/**
 * The `dbCredentials` drizzle-kit should be given.
 *
 * drizzle-kit hands a `url` straight to postgres.js, so a Neon string would
 * migrate over an unverified certificate and send `channel_binding`, which
 * the server refuses (see connectionConfig). Its credentials type has no way
 * to add options to a `url`, so a remote database is passed as discrete
 * fields, which do take `ssl`.
 */
export function migrationCredentials(rawUrl: string): MigrationCredentials {
  if (isLocalDatabase(rawUrl)) return { url: rawUrl }
  const url = new URL(rawUrl)
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    ssl: 'verify-full',
  }
}
