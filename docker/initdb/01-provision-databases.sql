-- Provisioning for a fresh data volume. The entrypoint replays this file only
-- when the data directory is empty, so `docker compose down -v && docker
-- compose up -d` recreates everything below without a manual step.
--
-- Note this bind mount *masks* the postgis image's own /docker-entrypoint-
-- initdb.d scripts, so the extension is ours to install. That is deliberate:
-- provisioning belongs here, not in a migration. `drizzle-kit generate` never
-- emits CREATE EXTENSION, so a developer who deletes drizzle/ and regenerates
-- from scratch would otherwise lose it and every geometry column would fail to
-- create. Installing it here means the schema can be regenerated freely.

CREATE EXTENSION IF NOT EXISTS postgis;

-- The test suite runs against a second database on the same server. Combined
-- with src/db/client.ts refusing to fall back to DATABASE_URL under Vitest,
-- this is what keeps a test's `db.delete(...)` off imported content.
CREATE DATABASE chronotope_test;
\connect chronotope_test
CREATE EXTENSION IF NOT EXISTS postgis;
