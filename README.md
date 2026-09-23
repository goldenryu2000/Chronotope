# Chronotope

Chronotope is an atlas that renders history as a place and a year at once: a
map of the world redrawn to match whatever year a timeline is scrubbed to,
with pins for the people, gods, or creatures who were "there" at that moment.
The same map engine currently drives three content packs — **philosophy**,
**mythology**, and **creatures** — all laid over the `world` region.

Content used to live in the repo as JSON; now it lives in Postgres, and the
browser never talks to Postgres directly. A publish step renders each pack
and region into a small hashed JSON artifact, and the atlas fetches that.
Borders take the same road: 48 historical snapshots become interval rows in
PostGIS, tippecanoe cuts them into one PMTiles archive per region, and
scrubbing the timeline re-filters an archive already in the browser rather
than fetching a file per year.

## The stack

- **Next.js 16 (App Router, Turbopack) + React 19** — the landing page and
  entity pages render on the server (see "Why server rendering" below); the
  atlas map is a client island.
- **Postgres 16 + PostGIS 3.4**, via Docker locally. Schema and migrations
  are managed with **Drizzle ORM** / `drizzle-kit`.
- **MapLibre GL** for the map, styled entirely from CSS custom properties
  (see Rule 1).
- **Zod** for the content contract that legacy import, the database rows,
  and the published artifacts all agree to.
- **Vitest** for unit tests, **Playwright** for browser end-to-end tests.

## Running it locally, from a cold start

You need Docker and Node (`.nvmrc` says 22; this has also been run and
verified under Node 24). Copy `.env.example` to `.env.local` first if you
don't already have one — the defaults point at the docker-compose database.

You also need **tippecanoe** to build PMTiles archives from boundary
geometry, but only for that — the atlas itself runs fine without it once an
archive exists. On Arch it is AUR-only, `aur/tippecanoe`, a source build:
`paru -S tippecanoe`. Elsewhere, see
https://github.com/felt/tippecanoe. `scripts/check-tiletools.sh` checks for
it and explains what's missing if it isn't there.

```bash
docker compose down -v && docker compose up -d --wait
npx drizzle-kit migrate
npx tsx scripts/import-legacy.ts --all
npx tsx scripts/import-regions.ts
npx tsx scripts/import-boundaries.ts
npx tsx scripts/build-tiles.ts
npx tsx scripts/import-layers.ts
npx tsx scripts/seed-tours.ts
npx tsx scripts/publish-all.ts
npm run build && npm start
```

That's the whole path from nothing to a running app on
`http://localhost:3000`. Every step is unattended, there is no file to
hand-edit and no manual click anywhere in this sequence.

There is a `Makefile` wrapping these: `make cold` runs exactly the sequence
above, `make dev` brings the database up and starts the dev server, and
`make stop` stops both, including a server left holding the port from an
earlier run. `make` on its own lists the rest. It is a convenience over the
commands here, not a replacement for them.

The root of the site is a landing page listing whatever has been published.
The atlases themselves live at `/<region>/<pack>` — with the committed content
imported, that is `/world/philosophy`, `/world/mythology`, `/world/creatures`
and the same three packs read through India's plate at `/india/philosophy` and
so on. An individual figure is a further segment down,
`/world/philosophy/laozi`.

A few things about that sequence that are easy to misread:

- `docker compose up -d --wait` (not the bare `-d`) matters: the compose
  file has a healthcheck, and `--wait` blocks until Postgres is actually
  ready to accept connections, rather than racing the migration against a
  container that's merely been *started*.
- `docker/initdb/01-provision-databases.sql` runs once, the first time the
  data directory is empty, and installs the PostGIS extension plus a second
  `chronotope_test` database used only by the test suite. `docker compose
  down -v` wipes the volume, so a cold start always replays it.
- `drizzle-kit migrate` will print
  `NOTICE: extension "postgis" already exists, skipping`. That's expected,
  not a failure — the initdb script above already installed it, and the
  migration also carries a (now redundant) `CREATE EXTENSION IF NOT EXISTS
  postgis` so that `drizzle-kit generate` can be re-run from scratch without
  silently losing extension provisioning.
- `scripts/import-legacy.ts --all` reads the previous static build's content
  directory (a machine-local path, set with `LEGACY_CONTENT_DIR`) and imports
  all three packs, one transaction per pack. It lays them over no region: where
  a pack is read is the next step's business.
- `scripts/import-regions.ts` reads `data/regions/` into the `regions` table:
  one file per plate, carrying its edges, its zooms, its periodization, which
  plate it sits inside, and which packs are laid over it. It runs *after* the
  packs because it writes the `era_sets` row that places one, and only for a
  pack that is already there. See "Regional atlases" below.
- `scripts/import-boundaries.ts` folds the 48 historical border snapshots in
  `data/borders/` into the `boundaries` table as validity intervals —
  10,614 rows — deduplicating geometry that does not change between
  consecutive snapshots, and applying the Jammu and Kashmir correction
  described below as it goes.
- `scripts/build-tiles.ts` cuts one archive per region: it clips those rows to
  each region's bbox and hands them to tippecanoe, producing
  `public/tiles/world.pmtiles` and `public/tiles/india.pmtiles` (also
  gitignored: they are generated from the database). It records each archive's
  path on its region row, which is how the next step finds it. A slug narrows
  it to one plate; no argument cuts them all, which is what the cold start
  wants — `world` is a row like any other and defaulting to its slug meant a
  second plate silently never got an archive.
- `scripts/import-layers.ts` reads the nine historical layers in `data/layers/`
  into the `layers` and `layer_features` tables. It runs *before*
  `seed-tours.ts` because a tour stop names the layers it lights through a
  foreign key: seeding a stop that lights a route the database has never heard
  of is refused outright, naming the layer. It runs before `publish-all` for a
  second reason, that a lit stop is validated against the *published* layer to
  check the route actually draws in the year the stop sits in.
- `scripts/seed-tours.ts` reads the six guided tours in `data/tours/` into the
  database. It runs *before* `publish-all` because that script publishes packs
  and then tours, and a tour is validated against published packs: seeding
  afterwards would leave six tours in the database with no artifact behind them
  and `/world/tours` empty with nothing to say why.
- `scripts/publish-all.ts` renders every region and every pack
  into content-hashed JSON files under `public/artifacts/` (gitignored —
  see "Read path" below) and points each one's "current version" at what it
  just wrote. **It must run after `build-tiles`**, and refuses to run before
  it: the region artifact carries the archive's path, and the atlas draws no
  map without one. Getting that order wrong used to produce six successful
  commands and a blank page.
- `npm run build` also regenerates `public/maplibre/`, copying MapLibre's
  worker script out of `node_modules` so Turbopack doesn't need to resolve
  it at runtime (see the comment in `src/map/MapCanvas.tsx` if curious why
  that matters — a `new Worker("")` failure here is silent, not an error).

## Importing and publishing content

- `npx tsx scripts/import-legacy.ts --all` imports all three legacy packs.
  Pass no `--all` for usage help.
- `npx tsx scripts/import-regions.ts` re-reads `data/regions/` into the
  `regions` table. Safe to re-run; it replaces each plate it finds a file for,
  which cascades to that plate's era sets, its placements and any tour authored
  on it — so `seed-tours.ts` runs after it, never before. A slug or several
  narrows it to those plates and their ancestors.
- `npx tsx scripts/import-boundaries.ts` re-reads `data/borders/` into the
  `boundaries` table. Safe to re-run; it replaces what is there.
- `npx tsx scripts/build-tiles.ts` rebuilds every region's archive; a slug
  rebuilds one. Run it after any change to boundary geometry or to a region's
  bbox or zooms, and run `publish-all` after it. It reports what it wrote:

  ```
  Built public/tiles/world.pmtiles: 10614 features into 2557 tiles,
  9.57 MB, largest tile 341 KB, 6 features missing at max zoom
  (widest 6.10e-4°), in 5.6s.
  ```

  One 9.57 MB archive covers every year from 3000 BCE to 2010 CE, in place
  of the 6.6 MB of per-year TopoJSON snapshots the previous build fetched
  one file at a time. It is larger on disk and much smaller in use: a
  reader scrubbing the timeline downloads the handful of tiles their
  viewport needs, once, and every subsequent year change is a style filter
  rather than another request.
- `npx tsx scripts/import-layers.ts` re-reads `data/layers/` into the `layers`
  and `layer_features` tables. Safe to re-run; it replaces each layer it finds
  a file for. Run it before `seed-tours.ts`, which needs the layer rows to
  exist before a stop can name one.
- `npx tsx scripts/seed-tours.ts` re-reads `data/tours/` into the `tours` and
  `tour_stops` tables. Safe to re-run; it replaces each tour it finds a file
  for.
- `npx tsx scripts/publish-all.ts` re-publishes every region, every pack and
  every tour currently in the database. Run it again any time the database content
  changes — a fresh publish is a new content-hashed file; nothing is
  overwritten in place, and the "current version" pointer moves atomically.
- There is no content in the repository. If `public/artifacts/` is empty,
  the atlas 404s rather than showing a blank map — that's deliberate: a
  stale "current version" pointer with nothing behind it is a bug worth
  surfacing, not hiding.

## Guided tours

A tour is an ordered walk through views of one region's map: each stop names a
pack, a year, someone to select and where to put the camera, and carries the
prose read over it. The six that ship live in `data/tours/`, are seeded into
Postgres by `scripts/seed-tours.ts`, and are published as content-hashed
artifacts exactly the way packs are. `/world/tours` lists them; a single stop
is `/world/tours/gods-grew-quiet/5`, which is a real address that reloads and
shares.

Two things about them are worth knowing before touching either:

- **A tour can cross packs.** The flagship starts in mythology and ends in
  philosophy, and the switch happens in place: one artifact is fetched and the
  map, its loaded tiles and the camera all stay put. `tours` is a reserved slug
  because of the route shape, held by a check constraint on `packs.slug` rather
  than by a convention.
- **An unpublishable tour is refused, not shipped.** `publishTour` validates
  every stop against the *published* packs and will not write an artifact if one
  fails: an entity in no pack, a year outside the lifetime the map draws, or a
  camera framing somewhere the pin is not. The build this was ported from shipped
  four broken stops out of twenty-eight, and every one of them passed lint,
  typecheck and build, because a stop that selects nobody is data and a type
  checker cannot see data.

A stop can also light layers, below. Ten stops across four tours do: the Silk
Road under the translators who carried Aristotle east, the Atlantic passage
under the orishas who crossed it. A stop's layers replace whatever the reader
had lit, the same way its year replaces one they scrubbed to, so a stop naming
none puts every layer out.

## Layers

A layer is a historical route or spread drawn over the map: the Silk Road, the
spread of alphabets, the Atlantic passage. Nine ship, in `data/layers/`, and
they are rows in `layers` and `layer_features` published as content-hashed
artifacts the way packs and tours are. The menu on any atlas page lists the
ones that reach that region, and a layer's geometry is fetched the first time
a reader lights it, not before.

- **A layer picks a palette slot, not a colour.** Each theme defines nine
  `--map-layer-n` colours and a layer names a slot from 1 to 9. A layer a
  reader writes one day cannot ship CSS, and a hex value in the data would be
  a colour literal in map code by another route (Rule 1). A theme switch
  restyles every lit line in place, without reloading the map.
- **A layer draws only inside its years.** Lit at 1900, the Silk Road draws
  nothing, and the checkbox stays checked: the menu says "not yet" or "long
  gone" rather than quietly unticking, and the timeline marks each lit layer's
  years in its own lane so there is somewhere to scrub to.
- **Nothing says which region a layer belongs to.** `layers` has no region
  column and there is no placement table. Which layers a region offers is
  computed per request, by testing the layer's geometry against the region's
  bbox, for the reason `boundaries` works the same way: the Silk Road is not
  owned by a region.
- **A tour cannot narrate a layer the reader will not see.** `publishTour`
  refuses a stop whose layer is unpublished, does not reach the tour's region,
  or does not draw in the stop's year, and refuses a stop with no one selected
  whose camera is not over the layers it lights. A stop with neither a person
  nor a layer is refused outright, as a view of nothing.
- **A layer a tour still names cannot be deleted.** `tour_stop_layers` holds
  the key `on delete restrict`, so the database refuses rather than quietly
  turning a published tour into one describing a route that is gone.
  Re-importing is not deleting: `import-layers` updates a layer in place and
  its id survives, so tours keep pointing at it. It refuses to overwrite a
  layer that belongs to a reader, and refuses a leg that crosses the
  antimeridian, which the atlas would draw the long way round the world.

## Regional atlases

An atlas is a plate: a rectangle of the world, a shape of time, and whatever
content falls inside it. `world` is one, `india` is another drawn inside it,
and the second is not a special case of the first. Both are files in
`data/regions/`, both go through the same importer, the same publisher, the
same tile build and the same map engine, and nothing under `src/` knows either
of their names (Rule 3).

What a plate decides:

- **Its edges.** `bbox` is what `scripts/build-tiles.ts` clips the boundary
  corpus to, what the camera may travel over, and which figures the atlas
  draws. India shows the ten philosophers, seventeen gods and six creatures who
  stand inside it, out of the same three published pack artifacts the world
  atlas reads. Nothing is duplicated per region, and adding a plate republishes
  nothing.
- **Its depth.** `maxZoom` is how far in the archive is cut. The world stops at
  6; India goes to 8, from exactly the same `boundaries` rows, which is what
  makes the Mahajanapadas, the Chalukyas and the Palas legible at all. India's
  archive is 1.4 MB against the world's 9.6, and its largest tile 30 KB against
  341.
- **Its shape of time.** `eras` is the region's own periodization and it is
  what the timeline track is built from, so a plate is a different atlas rather
  than a different bounding box. India runs from the Indus cities to the
  Republic in ten eras; the world runs from the Axial Age in eleven.
- **What is laid over it.** `packs` names the packs the plate offers, and
  optionally each one's own periodization for *this* plate. A bare slug means
  no override, which is the normal case: on India the region's centuries drive
  every pack's timeline. The two myth packs carry an override on `world`, which
  is the six-era periodization they have always had there.
- **Where it sits.** `parent` is one slug, or null for a root atlas. That is
  the whole hierarchy: one nullable self-reference on `regions`, which is
  enough to carry World → India → Northern India unchanged, and which nothing
  reads more than one step of.

What a plate does *not* decide, and must not: which entities exist, which
layers there are, how borders are stored, or anything about how the map draws.
An entity belongs to a pack and is laid over whatever plates contain it; a
layer belongs to nobody and reaches whatever plates its geometry touches
(`src/read/regionLayers.ts`); a boundary is a row in one global table. That is
why India needed no new entities, no new layers, no second pipeline and no
`if (region === 'india')` anywhere.

### Adding one

1. Write `data/regions/<slug>.json`. Copy `india.json`: it is the shorter of
   the two and every field is commented in `RegionDefinitionSchema`
   (`src/data/schemas.ts`), which refuses a camera outside its own bbox,
   overlapping eras, an era reaching outside the region's range, a pack laid
   twice, and a parent that does not exist.
2. `npx tsx scripts/import-regions.ts` — or just `make import`, which runs the
   whole sequence in the one order that works.
3. `npx tsx scripts/build-tiles.ts` and `npx tsx scripts/publish-all.ts`.

That is the entire list. The plate appears on the landing page nested under its
parent, its parent's map grows a dashed frame around it labelled with its name,
and the trail in its own top-left corner gains a step back out. No code
changes, and no map-engine changes ever.

Two things worth knowing before writing one:

- **A plate is offered only where it would open.** The landing page, the pack
  switcher and the doorway on the parent's map all require the region to be
  published, the pack to be published, *and* at least one of that pack's
  entities to stand inside the plate. A plate whose packs are all empty is not
  linked from anywhere, which is deliberate: a door onto an empty map is worse
  than no door.
- **A tour on a plate is validated against it.** `publishTour`'s rule 8 refuses
  a stop selecting someone the plate draws no pin for, and a stop whose camera
  sits outside where the plate lets the camera go. Both were unreachable while
  the world was the only region, and both are the first thing a regional tour
  gets wrong.

## The read path is not the write path

Import and publish write to Postgres and then to storage. The *browser*
never queries Postgres: `GET /world/philosophy` resolves the pack's current
published version on the server — a database read, as is the tab title — and
the browser then fetches that one JSON artifact and nothing else.

Entity pages (`/world/philosophy/laozi`) do not follow that path at all.
They query Postgres directly, and they are **prerendered at build time**, not
per request: `generateStaticParams` in
`app/[region]/[pack]/[entity]/page.tsx` enumerates every (region, pack,
entity) triple and Next builds a static page for each.

Two consequences worth stating plainly:

- **Entity pages go stale.** Content imported or edited after a build does
  not reach them until the next `npm run build`. The atlas does not have this
  problem — it re-resolves the current version on every request.
- **They bypass the artifact.** An entity page can therefore show something
  the published pack does not, if the database has moved on since the last
  `publish-all`. Unifying the two is M3 work, once there is an authoring UI
  that can actually cause the divergence.

**Why server rendering, proven, not asserted:** the whole reason Next.js is
in this stack rather than a plain SPA is that entity pages need to exist for
a search engine, not just for a browser that already ran the JavaScript. You
can check this yourself without a browser at all:

```bash
curl -s http://localhost:3000/world/philosophy/laozi | grep -c "State of Chu"
```

A `1` (or more) means the fact arrived in the initial HTML. A `0` would mean
the page is client-rendering and the SEO surface doesn't actually exist.

## Years, and one thing about them that will bite you

Years are plain signed integers with **no year 0**: `-384` means 384 BCE,
`1650` means 1650 CE. Going from `-1` straight to `1` (no `0` in between) is
what "no year 0" means in practice, and cross-epoch arithmetic (`src/lib/
year.ts`) accounts for it explicitly — do not reach for astronomical year
numbering as a shortcut.

Postgres's `int4range` is **end-exclusive**: a range is `[lo, hi)`. A
last-inclusive year `Y` is therefore stored as `hi = Y + 1`. If you're
reading a range straight out of the database and it looks off by one, this
is why — `src/db/types.ts` and `src/publish/renderPack.ts` both have to
undo it on the way back out.

## The three rules

Three unrelated content packs (philosophy, mythology, creatures) ride one
map engine. That only stays true if the engine never learns anything
pack-specific or region-specific. Three rules keep it that way:

1. **No colour literals in map code.** Every colour the map draws comes from
   a CSS custom property, read through `token()` (`src/theme/themes.ts`).
   Packs and themes can repaint the map by changing CSS, never by patching
   `src/map/`.
2. **No pack vocabulary in engine code.** Nothing under `src/` may know what
   a "philosopher" is, or a "god," or a "creature." The engine renders
   entities, traditions, and eras — generic nouns — and gets everything
   pack-specific (labels, colours, copy) from the artifact it's handed.
3. **No region vocabulary in engine code.** The engine renders *a* region.
   The world map is simply the row in `regions` whose slug happens to be
   `world`; it carries no special privileges, no hardcoded bounding box, no
   `if (region === 'world')` anywhere in the engine. India is the falsifiable
   form of that claim: it is a file in `data/regions/`, it goes through every
   step the world does, and its slug appears nowhere under `src/`.

## What's deliberately not here yet

- **Authoring and review (M3).** There's no login, no submissions queue, no
  editor UI. `users` exists as a table, not yet wired to real sessions.
- **Regions beyond India.** The backbone is region-agnostic and India proves
  it, but Europe, China and the Islamic world are files nobody has written yet.
  See "Regional atlases" for what writing one involves.

## Where the borders come from, and where they deliberately differ

The boundaries are aourednik's
[historical-basemaps](https://github.com/aourednik/historical-basemaps), 48
snapshots between 3000 BCE and 2010 CE, GPL-3.0. `data/borders/` holds them
as committed source; nothing serves them, and the browser never sees them.

A caution worth repeating from upstream: **historical borders are
interpretations, not measurements.** Many are approximate, many are
contested, and the very idea of a hard linear frontier is anachronistic for
most of the period covered. Each row carries a `confidence` value, and the
map draws the least confident lines thinner because of it.

### Jammu and Kashmir

Boundaries valid from **1945 onward** depart from upstream. Upstream draws
the region on the de facto lines — Aksai Chin within China, Gilgit-Baltistan
and Azad Kashmir within Pakistan. Chronotope shows the whole of the erstwhile
princely state as Indian territory, which is the depiction the Survey of
India requires of maps published in India.

- Applied by `src/boundaries/indiaClaim.ts`, at import, and recorded in each
  affected row's `source` column — so the divergence travels with the data
  instead of living in a script you would have to re-run to believe.
- Claim geometry from **[Natural Earth](https://www.naturalearthdata.com/)**
  `ne_10m_admin_0_disputed_areas` (public domain), unioning *Jammu and
  Kashmir*, *Aksai Chin*, *Gilgit-Baltistan*, *Azad Kashmir*, *Siachen
  Glacier* and *Arunachal Pradesh*, committed as `data/india-claim.geojson`.
- Boundaries before 1945 are untouched. They show the British Raj, the Sikh
  Empire, the Mughals and so on, and applying a modern national convention to
  them would be inventing history rather than following one.
- Two test suites hold it: `src/boundaries/indiaClaim.test.ts` against the
  table, and `src/tiles/jammuKashmir.test.ts` against the built archive.
  The second exists because tippecanoe simplifies between the two, and a
  simplification that moves this particular line has shipped once before.

This is a **depiction choice, recorded rather than hidden**. The territories
concerned are genuinely disputed: Aksai Chin is administered by China,
Gilgit-Baltistan and Azad Kashmir by Pakistan, and Arunachal Pradesh — shown
as Indian by upstream and by us — is claimed by China. Anyone redistributing
this data should know that the modern boundaries here are not upstream's, and
that no map of this region is neutral.

## Deploying

Production is Vercel (Hobby) for pages, Neon (Free) for Postgres and PostGIS,
and Cloudflare R2 for artifacts and tile archives on `assets.<domain>`.

- **Vercel only reads.** It connects to Neon's pooler as `chronotope_app`,
  which can select and nothing else (`scripts/create-app-role.ts`). It holds no
  R2 credential.
- **Publishing happens from one machine.** `make deploy-data` migrates, imports,
  builds and uploads tiles, publishes to R2 and triggers a redeploy, reading
  `.env.deploy` through `ENV_FILE`. `make deploy-role` creates or rotates the
  read-only role. `.env.example` lists every variable and where it lives.
- **Pages are cached.** The landing, atlas and tour pages revalidate every five
  minutes; entity pages refresh on redeploy. This is what keeps Neon's free
  compute from being spent by traffic.
- **Headers.** `next.config.ts` sends a CSP and hardening headers on every
  response, and refuses to build on Vercel with a production variable missing.

## Licence

GPL-3.0-or-later, per `package.json`; the full text is in `LICENSE`. The
border data above is GPL-3.0 as well, which is what fixes the choice. Content
credits (images, their licences and their sources) travel with each entity
row rather than living here, because most depictions are not public domain.

## Working notes that aren't part of the shipped project

`docs/superpowers/`, `.superpowers/` and `HANDOVER.md` are gitignored paths
for planning and handover notes. They are working scaffolding from building
this milestone, not documentation for using Chronotope, and a fresh clone
will not have them.

## Development

```bash
npm run dev          # dev server (also copies MapLibre's worker first)
npm run check         # typecheck + lint + unit tests + build, in one gate
npm run test:e2e      # Playwright; starts its own dev server
```

`npm run check` runs four checks in one gate: typecheck, lint, unit tests,
build. `npm run test:e2e` is separate and covers what `check` cannot — the
browser-driven checks, including the one that proves the map's border data
genuinely parsed rather than merely that a canvas exists. There is no CI
configured in this repository yet; `check` is what a CI job would run.

A pre-commit hook (husky) lints staged files, scans them for secrets with
secretlint, and typechecks; `npm install` sets it up.

Both need more than the source tree:

- **`npm test` needs the legacy content.** Several test files import real
  packs rather than fixtures (through `src/db/testSeed.ts`, or directly in
  `scripts/import-legacy.test.ts`, `src/publish/renderPack.test.ts` and
  `src/read/currentArtifact.test.ts`), so they read the directory named by
  `LEGACY_CONTENT_DIR` — see `.env.example`. They also need the
  `chronotope_test` database from docker-compose to be up. Packs are imported
  before regions there, the same order the cold start uses and for the same
  reason: a region file names the packs laid over it.
- **`npm run test:e2e` needs published artifacts**, i.e. the cold-start
  sequence above at least as far as `publish-all.ts`. It starts its own dev
  server, but it will reuse one already on port 3000 if it finds it.
