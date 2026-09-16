# Chronotope. `make` on its own lists what there is.
#
# Nothing here is new behaviour: every target runs the same commands the README
# documents. It exists so that starting and stopping the whole app is one word
# each, rather than a docker command, an npm script, and a stray server on a
# port you have to go and find.

# `make` is commonly aliased to `make -j8`, and several of these are strictly
# ordered: the cold start must import before it tiles and tile before it
# publishes. Parallelism here would be silent corruption, not speed.
.NOTPARALLEL:

PORT ?= 3000
REGION ?= world

.DEFAULT_GOAL := help

# ---- running and stopping -------------------------------------------------

## dev: database up, then the dev server in the foreground
dev: up
	npm run dev

## serve: database up, production build, then serve it in the foreground
serve: up build
	npm start

## up: start Postgres and wait until it actually accepts connections
up:
	docker compose up -d --wait

## down: stop Postgres, keeping its data
down:
	docker compose down

## stop: stop the app and the database, whoever started them
stop: stop-app down

## stop-app: kill whatever is listening on the app port, if anything
#
# By port rather than by process name. Next's process is called `next-server`
# however it was started, so `pkill -f 'next dev'` matches nothing and leaves a
# stale server holding the port; the next `npm run dev` then quietly moves to
# 3001 and you spend a while wondering why your changes are not showing up.
stop-app:
	@pids=$$(lsof -ti tcp:$(PORT) 2>/dev/null); \
	if [ -n "$$pids" ]; then \
		kill $$pids && echo "stopped app on :$(PORT) (pid $$pids)"; \
	else \
		echo "nothing listening on :$(PORT)"; \
	fi

## restart: stop the app, leave the database alone, start dev again
restart: stop-app dev

## status: what is up, and what has been built
status:
	@printf 'database   '
	@docker compose ps --format '{{.Service}} {{.Status}}' 2>/dev/null | grep . || echo 'not running'
	@printf 'app        '
	@lsof -ti tcp:$(PORT) >/dev/null 2>&1 \
		&& echo "listening on :$(PORT)" \
		|| echo "not running"
	@printf 'tiles      '
	@ls -lh public/tiles/*.pmtiles 2>/dev/null | awk '{print $$9, $$5}' || echo 'none built'
	@printf 'artifacts  '
	@find public/artifacts -name '*.json' 2>/dev/null | wc -l | tr -d '\n' && echo ' published'

# ---- data -----------------------------------------------------------------

## cold: rebuild everything from nothing. Destroys both databases.
#
# The sequence from the README, in the one order that works: publish must run
# after the tiles, because it copies the archive's path onto the region and the
# atlas draws no map without it. `publish-all` refuses to run early, so getting
# this wrong fails loudly rather than producing a blank page.
#
# Tours are seeded before that publish and not after, for the same shape of
# reason: `publish-all` publishes packs and then tours, and a tour is validated
# against published packs. Seeding later would leave six tours in the database
# with no artifact behind them, and `/world/tours` empty with nothing to say why.
#
# Layers are imported before the tours are seeded, and for a harder reason than
# ordering taste: a stop names its layers through a foreign key, so seeding a
# stop that lights a route the database has never heard of is refused outright.
# `publish-all` then needs the layer artifacts to exist before it validates a
# lit stop against them.
cold:
	docker compose down -v
	docker compose up -d --wait
	npx drizzle-kit migrate
	npx tsx scripts/import-legacy.ts --all
	npx tsx scripts/import-boundaries.ts
	npx tsx scripts/build-tiles.ts $(REGION)
	npx tsx scripts/import-layers.ts
	npx tsx scripts/seed-tours.ts
	npx tsx scripts/publish-all.ts
	@echo
	@echo 'Cold start done. Run "make dev".' 

## migrate: apply schema migrations to the development database
migrate:
	npx drizzle-kit migrate

## import: re-read the legacy packs, the boundaries, the layers and the tours
import:
	npx tsx scripts/import-legacy.ts --all
	npx tsx scripts/import-boundaries.ts
	npx tsx scripts/import-layers.ts
	npx tsx scripts/seed-tours.ts

## tiles: rebuild one region's PMTiles archive (REGION=world)
tiles:
	npx tsx scripts/build-tiles.ts $(REGION)

## publish: render every region, pack and tour to a content-hashed artifact
publish:
	npx tsx scripts/publish-all.ts

## psql: a shell on the development database
psql:
	docker compose exec db psql -U postgres -d chronotope

## logs: follow the database container's log
logs:
	docker compose logs -f db

# ---- checking -------------------------------------------------------------

## check: typecheck, lint, unit tests, production build
check:
	npm run check

## test: unit tests only
test:
	npm test

## e2e: Playwright. Starts its own server if one is not already up.
e2e:
	npm run test:e2e

## typecheck: types only
typecheck:
	npm run typecheck

## lint: eslint only
lint:
	npm run lint

## build: production build only
build:
	npm run build

## all: the full gate, the way it is reported in commits
all: check e2e

# ---- production -------------------------------------------------------------
#
# Everything here runs from the owner's machine against Neon and R2, reading
# credentials from $(DEPLOY_ENV) through ENV_FILE. Nothing here runs on Vercel,
# and Vercel holds no credential that can write.

DEPLOY_ENV ?= .env.deploy

## deploy-role: create or rotate the read-only role the site connects as
deploy-role:
	@test -f $(DEPLOY_ENV) || { echo "$(DEPLOY_ENV) is missing. See .env.example."; exit 1; }
	ENV_FILE=$(DEPLOY_ENV) npx tsx scripts/create-app-role.ts

## deploy-data: migrate, import, tile, upload, publish to production, then redeploy
#
# The same order as `cold`, for the same reasons, with the archive uploaded
# before publishing so no artifact ever points at tiles the bucket lacks.
deploy-data:
	@test -f $(DEPLOY_ENV) || { echo "$(DEPLOY_ENV) is missing. See .env.example."; exit 1; }
	ENV_FILE=$(DEPLOY_ENV) npx drizzle-kit migrate
	ENV_FILE=$(DEPLOY_ENV) npx tsx scripts/import-legacy.ts --all
	ENV_FILE=$(DEPLOY_ENV) npx tsx scripts/import-boundaries.ts
	ENV_FILE=$(DEPLOY_ENV) npx tsx scripts/build-tiles.ts $(REGION)
	ENV_FILE=$(DEPLOY_ENV) npx tsx scripts/upload-tiles.ts $(REGION)
	ENV_FILE=$(DEPLOY_ENV) npx tsx scripts/import-layers.ts
	ENV_FILE=$(DEPLOY_ENV) npx tsx scripts/seed-tours.ts
	ENV_FILE=$(DEPLOY_ENV) npx tsx scripts/publish-all.ts
	ENV_FILE=$(DEPLOY_ENV) npx tsx scripts/trigger-deploy.ts

# ---- help -----------------------------------------------------------------

help:
	@echo 'Chronotope'
	@echo
	@grep -E '^## ' $(MAKEFILE_LIST) \
		| sed -e 's/^## //' \
		| awk -F': ' '{ printf "  \033[1m%-12s\033[0m %s\n", $$1, $$2 }'
	@echo
	@echo '  Variables: PORT=$(PORT) REGION=$(REGION)'

.PHONY: dev serve up down stop stop-app restart status cold migrate import \
        tiles publish psql logs check test e2e typecheck lint build all help \
        deploy-role deploy-data
