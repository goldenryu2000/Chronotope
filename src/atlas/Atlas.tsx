'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { activeAt, isActive, openingYear, withActiveSpan } from '../data/entitySpan'
import { assetUrl } from '../lib/assetUrl'
import { contains } from '../lib/bbox'
import { PackSchema, RegionSchema, type AtlasView, type Pack, type Region } from '../data/schemas'
import LayerMenu from '../map/LayerMenu'
import MapCanvas, { type Camera } from '../map/MapCanvas'
import Curtain from './Curtain'
import type { Invite } from '../map/invitation'
import { childrenOfPlate, parentOfPlate, plateHref, type Plate } from '../read/kin'
import type { RegionLayer } from '../read/regionLayers'
import type { RegionPack } from '../read/regionPacks'
import PackSwitcher from './PackSwitcher'
import RegionMenu from './RegionMenu'
import DetailPanel from '../panel/DetailPanel'
import EmptyState from '../panel/EmptyState'
import { useAtlas } from '../state/store'
import { applyTheme, isThemeId, loadTheme, type ThemeId } from '../theme/themes'
import ThemeToggle from '../theme/ThemeToggle'
import { resolveEras, resolveRange } from '../timeline/resolveEras'
import { buildScale } from '../timeline/scale'
import Timeline from '../timeline/Timeline'
import { useLayoutVars } from '../layout/useLayoutVars'
import './Atlas.css'

interface Props {
  /** Resolved on the server, so the browser asks once instead of twice. */
  packUrl: string
  regionUrl: string
  /**
   * Every published pack on this region, for the switcher. Resolved on the
   * server for the same reason the urls are: the browser never asks the
   * database anything, it only fetches artifacts it was handed the address of.
   */
  packs: readonly RegionPack[]
  /** Which of `packs` the route was opened on. */
  activePack: string
  regionSlug: string
  /**
   * Every layer this region offers, resolved on the server for the reason the
   * pack list is: the browser never asks the database anything, it only
   * fetches artifacts it was handed the address of.
   */
  layers?: readonly RegionLayer[]
  /**
   * Every atlas that would open, nested inside the one it is drawn in.
   *
   * One tree rather than three props, because the three questions asked of it
   * — what can I go into, what am I inside, and what else is there — are the
   * same eight rows read three ways, and answering them separately meant three
   * round trips for one question.
   *
   * Resolved on the server, for the reason the pack list and the layers are:
   * the browser never asks the database anything, and which plate is worth
   * offering depends on what has been published.
   */
  plates?: readonly Plate[]
  /**
   * Where to open, when something other than the pack decides.
   *
   * A tour route knows its stop's pack and year on the server, so the first
   * paint can already be the stop instead of the pack's own `startYear`
   * followed by a visible jump.
   */
  initialView?: AtlasView
  /** Rendered into the left column. A tour player goes here. */
  children?: React.ReactNode
  /**
   * Whether switching packs rewrites the address.
   *
   * True on the atlas route, where `/<region>/<pack>` *is* the address. False
   * on the tour route, where the address is the stop and the pack is one of the
   * things the stop decides: a cross-pack stop switches packs, and letting that
   * push `/world/philosophy` would overwrite `/world/tours/x/5` and lose the
   * tour on the next reload or share.
   */
  writesPackUrl?: boolean
}

async function fetchArtifact(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value))

/**
 * The client island: one map, one region, one pack at a time.
 *
 * The build this is ported from fetched a manifest and then, once that landed,
 * the entities it named — two round trips in series before anything could be
 * drawn. Both documents now arrive as published artifacts whose URLs the server
 * already resolved, so they are fetched together and the waterfall is gone.
 *
 * The pack is a choice made inside the region rather than a page of its own.
 * Switching one refetches a single artifact and leaves everything else
 * standing: the map, its loaded tiles, the camera, and the year.
 */
export function Atlas({
  packUrl, regionUrl, packs, activePack, regionSlug, layers = [], plates = [],
  initialView, children, writesPackUrl = true,
}: Props) {
  const router = useRouter()
  // Region and pack land separately because they change separately: the
  // region is the route, the pack is a choice made inside it. `Loaded` is
  // derived from the pair rather than fetched as one.
  const [region, setRegion] = useState<Region | null>(null)
  const [pack, setPack] = useState<Pack | null>(null)
  /**
   * Which slug `pack` was fetched for.
   *
   * `active` changes the moment a switch is asked for and `pack` only when the
   * artifact lands, so for one fetch the two disagree. A parked view that
   * checked `active` alone landed on the pack being left: its figure was not in
   * it, so the panel closed, and when the right pack arrived the switch
   * deselected them for good. Every cross-pack tour stop opened with no panel.
   */
  const [packSlug, setPackSlug] = useState<string | null>(null)
  const [active, setActive] = useState(activePack)
  const [theme, setTheme] = useState<ThemeId>('rustic')
  /** Set once the map has drawn its first frame, tiles and all. */
  const [painted, setPainted] = useState(false)
  /** Or once waiting for that has gone on too long. See below. */
  const [waited, setWaited] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const year = useAtlas((state) => state.year)
  const setYear = useAtlas((state) => state.setYear)
  const setRegionId = useAtlas((state) => state.setRegionId)
  const selectedId = useAtlas((state) => state.selectedId)
  const select = useAtlas((state) => state.select)
  const focusOn = useAtlas((state) => state.focusOn)
  const pendingView = useAtlas((state) => state.pendingView)
  const applyView = useAtlas((state) => state.applyView)
  const flyToTarget = useAtlas((state) => state.flyToTarget)
  const activeLayers = useAtlas((state) => state.activeLayers)
  const setLayers = useAtlas((state) => state.setLayers)

  const packUrls = useMemo(
    () => new Map(packs.map((entry) => [entry.slug, entry.artifactUrl])),
    [packs],
  )

  /** Whether a pack has already opened, which decides what year the next one lands on. */
  const opened = useRef(false)

  // The region: fetched once for the route. Its theme and its id are settled
  // here, not on every pack switch — a switch must not re-apply a theme the
  // reader may have changed since.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const parsed = RegionSchema.parse(await fetchArtifact(regionUrl))
        if (cancelled) return

        /*
         * The theme is written to `data-theme` here, in the async callback,
         * rather than from an effect further down the tree. React runs child
         * effects before parent ones, so an effect-based write would land
         * after MapCanvas had already read its tokens through getComputedStyle
         * and built a style out of empty strings.
         */
        const initial = loadTheme(isThemeId(parsed.theme) ? parsed.theme : undefined)
        applyTheme(initial)
        setTheme(initial)

        setRegionId(parsed.id)
        setRegion(parsed)
        setError(null)
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [regionUrl, setRegionId])

  // The pack: re-fetched whenever the switcher changes `active`. Artifacts are
  // immutable and content-hashed, so the browser cache makes switching back to
  // one already seen free — there is nothing to cache here ourselves.
  useEffect(() => {
    const url = packUrls.get(active) ?? packUrl
    let cancelled = false

    void (async () => {
      try {
        const parsed = PackSchema.parse(await fetchArtifact(url))
        if (cancelled) return

        // Whoever was open belonged to the pack being left, unless a parked
        // view is what asked for this pack in the first place, in which case
        // deselecting would undo the thing the switch was for.
        if (useAtlas.getState().pendingView?.pack !== active) select(null)
        setPack(parsed)
        setPackSlug(active)
        setError(null)
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [active, packUrl, packUrls, select])

  /**
   * The pack's spans, offset into the years the map actually shows them, and
   * narrowed to the figures who stand on this plate.
   *
   * The narrowing is the one rule a regional atlas adds to the engine, and it
   * is here rather than anywhere further down so that every reader of this
   * list agrees: the pins, the timeline's lanes, the empty-state count and the
   * panel's list of contemporaries are all answering "who was here, then", and
   * three of them answering it about the whole world would be three different
   * maps on one screen.
   *
   * A pack artifact is still the canonical, undivided pack. Nothing is
   * duplicated per region and nothing is republished to add a plate: the
   * region says where its edges are and the same artifact is read through
   * them. On `world` the edges are the world's, so this is the identity.
   */
  const entities = useMemo(
    () => {
      if (!pack || !region) return []
      return pack.entities
        .filter((entity) => contains(region.bbox, entity.lng, entity.lat))
        .map((entity) => withActiveSpan(entity, pack.activeOffset))
    },
    [pack, region],
  )

  /*
   * Where the cursor lands once both documents are in.
   *
   * On the first pack, the pack's own opening year. On a switch, the year
   * already on screen — that is the whole point of switching in place: the
   * question is "who else was here, *then*", and moving the reader in time
   * would answer a different one. Either way it is clamped, because the region
   * sets the outer bound and a pack narrows within it, so a pack's opening
   * year can fall outside the region it is being read in.
   */
  useEffect(() => {
    if (!region || !pack) return
    // A parked view names the year; the effect below applies it.
    if (useAtlas.getState().pendingView) return

    // Read straight off the store rather than from the `year` binding: the
    // year this effect wants is whatever is on screen when a pack lands, and
    // depending on it would re-run this on every scrub and pin the cursor.
    const asked = opened.current ? useAtlas.getState().year : pack.startYear
    const range = resolveRange(region, pack)
    // Only on the first pack. A switch is a question about the year already on
    // screen ("who else was here, *then*"), and moving the cursor to rescue an
    // empty answer would answer a different one — the empty state is the right
    // response there, and it says so in words.
    const wanted = opened.current ? asked : openingYear(entities, asked)
    setYear(clamp(wanted, range.start, range.end))
    opened.current = true
  }, [region, pack, entities, setYear])

  /*
   * The route's opening view, parked before anything is fetched.
   *
   * A ref, not an effect dependency: this runs once. Re-parking on every render
   * would fight the reader, who is allowed to scrub away from the stop the link
   * opened on.
   */
  const parked = useRef(false)
  useEffect(() => {
    if (parked.current) return
    parked.current = true
    if (initialView) {
      applyView(initialView)
      return
    }
    /*
     * An atlas opened without a view starts with nothing lit.
     *
     * The store outlives a client-side navigation, and the lit layers live in
     * it. Year and selection already reset when an atlas opens; without this
     * the layers were the one piece of a tour that followed the reader home
     * and into the next atlas they picked, still ticked.
     *
     * The design says leaving a tour hands the map over with the last stop's
     * year and layers intact. "Leave the tour" is a full page load, so neither
     * survives it today, the year included, and this does not change that.
     * What it removes is the half-kept state in between, where one piece of a
     * tour leaked and the others did not.
     */
    setLayers([])
  }, [initialView, applyView, setLayers])

  /*
   * A parked view for another pack switches to it first.
   *
   * `applyView` names a pack, and a view cannot land until that pack is the one
   * on screen. This is the whole mechanism behind a cross-pack tour: the stop
   * asks for philosophy, this hands the request to the switcher's own machinery,
   * that fetches the one artifact, and the effect below consumes the view once
   * it arrives. Without this the view parks forever and the reader gets the next
   * stop's narration over the previous stop's map. `e2e/tour.spec.ts` is what
   * holds that, by walking the flagship across its mythology-to-philosophy seam.
   *
   * Written during render rather than from an effect. This is React's own
   * answer to "a change in one piece of state implies a change in another", and
   * it is here because the effect version is precisely the shape ESLint's
   * `set-state-in-effect` rule rejects — the same rule this file already cites
   * further down, where the ported build corrected a stale selection a frame
   * late. It terminates on the next render, when `active` equals the pack that
   * was asked for, and it re-fires correctly if the reader switches away by hand
   * and then returns to the same stop.
   *
   * A pack not published on this region is not switched to, which leaves the
   * view parked and the map honest rather than showing the wrong one.
   */
  if (pendingView && pendingView.pack !== active && packUrls.has(pendingView.pack)) {
    setActive(pendingView.pack)
  }

  /*
   * A parked view lands once its pack is on screen.
   *
   * Ordered deliberately: the year first, so `selected` (which clamps to the
   * year) does not reject the entity the same tick it is chosen; then the
   * selection; then the camera, which is one-shot in MapCanvas already.
   *
   * Cleared at the end, which is what makes re-applying the same stop work: a
   * reader clicking the current stop's dot expects the camera to return.
   */
  useEffect(() => {
    if (!region || !pack || !pendingView) return
    if (pendingView.pack !== active || packSlug !== active) return

    const range = resolveRange(region, pack)
    setYear(clamp(pendingView.year, range.start, range.end))
    select(pendingView.entityId)
    if (pendingView.camera) {
      // The figure rides along so the camera can keep it clear of the panel
      // and the tour card, not just point at the authored centre.
      const subject = entities.find((entity) => entity.id === pendingView.entityId)
      flyToTarget({
        ...pendingView.camera,
        subject: subject ? [subject.lng, subject.lat] : undefined,
      })
    }
    // A view describes the atlas completely, so this replaces rather than
    // merges: a stop naming two layers means those two and no others. A reader
    // who lit a third by hand loses it at the next stop, exactly as they lose
    // a year they scrubbed to.
    setLayers(pendingView.layers)
    applyView(null)
    opened.current = true
  }, [region, pack, packSlug, active, entities, pendingView, setYear, select, flyToTarget, setLayers, applyView])

  /*
   * The url follows the switch, without a navigation.
   *
   * `router.push` would re-run the server component and remount the whole
   * island, throwing away the camera and the loaded tiles — the two things the
   * switch exists to keep. `pushState` writes the address that a reload or a
   * shared link resolves to anyway, since `/<region>/<pack>` is a real route,
   * and leaves the running page alone.
   */
  useEffect(() => {
    if (!writesPackUrl) return
    const path = `/${regionSlug}/${active}`
    if (window.location.pathname === path) return
    window.history.pushState({ pack: active }, '', path)
  }, [regionSlug, active, writesPackUrl])

  /*
   * The curtain lifts on a timer as well as on the map.
   *
   * `onReady` fires on MapLibre's first `idle`, which is the right signal and
   * not a guaranteed one: a tile request that never settles, or a WebGL
   * context that never comes back, would leave the reader looking at a
   * loading screen over a working page forever. A curtain that can hang is
   * worse than no curtain, so after eight seconds it goes up regardless and
   * whatever has loaded is on screen.
   */
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), 8_000)
    return () => clearTimeout(timer)
  }, [])

  // Back and forward are then just another way of switching.
  useEffect(() => {
    const onPopState = () => {
      const slug = window.location.pathname.split('/')[2]
      if (slug && packUrls.has(slug)) setActive(slug)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [packUrls])

  /*
   * Exactly one era set drives the timeline, and it comes from the cascade —
   * the region's periodization unless this pack has an editorial view of that
   * region's shape of time. Built once per artifact pair, not per year.
   */
  const scale = useMemo(
    () => (region && pack ? buildScale(resolveEras(region, pack)) : null),
    [region, pack],
  )

  /**
   * The open entity, or null — and null the moment the year leaves their span.
   *
   * The ported build kept a `useEffect` that watched for exactly that and
   * called `select(null)`, which is the shape ESLint's `set-state-in-effect`
   * flags and which was a real bug twice in the old build: the panel rendered
   * once with someone who was no longer on the map before the effect caught
   * up. Clamping where the value is read makes the invalid state
   * unrepresentable instead of correcting it a frame late. Scrubbing back into
   * the span reopens the panel, which is the behaviour the pin already has.
   */
  const selected = useMemo(
    () => entities.find((entity) => entity.id === selectedId && isActive(entity, year)) ?? null,
    [entities, selectedId, year],
  )

  /**
   * The lit layers, with the years each covers, for the timeline.
   *
   * The menu says a layer's years in words; the track says where they are.
   * Without this a reader who lights the Silk Road at 1900 gets an unchanged
   * map and no hint of which way to scrub.
   */
  const layerSpans = useMemo(
    () =>
      layers
        .filter((layer) => activeLayers.includes(layer.slug))
        .map((layer) => ({
          slug: layer.slug,
          name: layer.name,
          from: layer.valid.start,
          to: layer.valid.end,
          paletteSlot: layer.paletteSlot,
        })),
    [layers, activeLayers],
  )

  /** Whether the map is showing anyone at all, which the dock has to answer. */
  const anyoneHere = useMemo(() => activeAt(entities, year).length > 0, [entities, year])

  /**
   * Where this region's border archive is served from.
   *
   * `tilesetKey` is the key `scripts/build-tiles.ts` records, `tiles/world.pmtiles`.
   * Locally that file sits in `public/` and no base is set. In production
   * `scripts/upload-tiles.ts` puts it in R2 under the same key, and
   * `NEXT_PUBLIC_TILES_BASE_URL` names the bucket's domain. The variable is
   * written out in full because Next inlines `NEXT_PUBLIC_` values only where
   * it can see the literal name.
   *
   * A region with no archive published yet has no borders to draw, so the map
   * is not built at all rather than built empty — an empty map and a broken
   * map look identical, which is the distinction the dock already makes.
   */
  const tilesetUrl = region?.tilesetKey
    ? assetUrl(process.env.NEXT_PUBLIC_TILES_BASE_URL, region.tilesetKey)
    : null

  const camera = useMemo<Camera | null>(
    () =>
      region
        ? {
            center: region.defaultCamera.center,
            zoom: region.defaultCamera.zoom,
            minZoom: region.minZoom,
            maxZoom: region.maxZoom,
            bounds: region.bbox,
          }
        : null,
    [region],
  )

  /*
   * Going into a plate is a navigation, not a pack switch.
   *
   * `router.push` rather than the `pushState` a pack switch uses: this is a
   * different region, so the artifacts, the tiles, the periodization and the
   * layer menu all change. Remounting the island is exactly right, and the
   * curtain covers the wait the way it does on any other arrival.
   */
  const enterPlate = useCallback((href: string) => router.push(href), [router])

  /*
   * The ways in and the way out, addressed to the pack the reader is actually
   * reading.
   *
   * Built here rather than on the server, because `active` changes without a
   * navigation: a reader who opens India and switches to the gods should leave
   * India among the gods, and go deeper among them too. The server's own pack
   * is only the opening one. `plateHref` falls back to the destination's first
   * pack when it does not offer this one, which is the honest answer rather
   * than a link to a 404.
   */
  const invitations = useMemo<Invite[]>(
    // Nothing is offered during a tour. A way *out* is never an interruption,
    // which is why the title and the trail stay, but an offer to leave in the
    // middle of somebody's narration is exactly one.
    () => (children ? [] : childrenOfPlate(plates, regionSlug)).map((child) => ({
      id: child.slug,
      title: child.title,
      subtitle: child.subtitle,
      bbox: child.bbox,
      href: plateHref(child, active),
    })),
    [plates, regionSlug, active, children],
  )

  const up = useMemo(() => {
    const parent = parentOfPlate(plates, regionSlug)
    return parent ? { title: parent.title, href: plateHref(parent, active) } : null
  }, [plates, regionSlug, active])

  const root = useRef<HTMLDivElement>(null)
  useLayoutVars(root)

  return (
    <div className="atlas" ref={root}>
      {region && camera && tilesetUrl && (
        <MapCanvas
          theme={theme}
          camera={camera}
          entities={entities}
          tilesetUrl={tilesetUrl}
          borderYears={region.borderYears}
          layers={layers}
          invitations={invitations}
          onEnterPlate={enterPlate}
          onReady={() => setPainted(true)}
        />
      )}

      <div className="atlas__grain" aria-hidden="true" />
      <div className="atlas__vignette" aria-hidden="true" />

      {/*
        * Every overlay below is tagged with the region of the screen it owns.
        * `src/layout` reads the tags twice: once to size the columns between
        * the top bar and the dock, and once per camera move, so whatever the
        * map is showing lands in the part of it nothing covers.
        */}
      <header className="atlas__header" data-layout="top">
        {/* The title, and the way to another map. It is a plain heading until
            there is somewhere else to go; see RegionMenu. */}
        <RegionMenu
          plates={plates}
          current={regionSlug}
          activePack={active}
          title={region?.title ?? 'Chronotope'}
        />

        {/* The packs on this region, and which one is showing. Until the
            artifacts land there is nothing to choose between, so the line
            holds the atlas's own subtitle rather than collapsing and shifting
            the title upward as the page settles. */}
        {pack ? (
          <PackSwitcher packs={packs} active={active} onSelect={setActive} />
        ) : (
          <p className="atlas__subtitle">an atlas of time and place</p>
        )}
        {/* 9a put a year-and-era line here because the scale had nothing else
            to feed. The timeline's own readout says the same thing next to the
            track it belongs to, so this is now one readout, not two. */}
      </header>

      {/*
        * The way out.
        *
        * Switching packs is a `pushState`, so the browser's back button walks
        * back through pack switches before it ever leaves the atlas. Someone
        * three switches deep needs something that goes home in one move, and
        * the map fills the screen, so there is nowhere else to put it.
        *
        * It doubles as the only place this screen says what it is: the header
        * names the region and the pack, and never the atlas they belong to.
        */}
      <nav className="atlas__trail" aria-label="Where you are" data-layout="top" data-layout-corner="">
        <Link className="atlas__home" href="/">
          <span className="atlas__home-arrow" aria-hidden="true" />
          <span className="atlas__home-label">Chronotope</span>
        </Link>
        {/*
          * The plate this one is drawn inside, when there is one.
          *
          * Beside the way home rather than anywhere else on the screen,
          * because it is the same kind of move: out. A reader three switches
          * deep into India's packs needs one step back to the world map and
          * one more to the front door, and the browser's own back button walks
          * through every pack switch before it does either.
          *
          * It keeps the pack where the plate above offers it, so leaving India
          * in the middle of the gods puts you back among the gods.
          */}
        {up && (
          <Link className="atlas__home atlas__home--up" href={up.href}>
            <span className="atlas__home-arrow" aria-hidden="true" />
            <span className="atlas__home-label">{up.title}</span>
          </Link>
        )}
      </nav>

      <div className="atlas__chrome" data-layout="top" data-layout-corner="">
        <LayerMenu layers={layers} />

        {/*
          * The way into a tour, offered only when one is not already running.
          *
          * This is the moment a reader most wants one: they are on the map,
          * six thousand years wide, with no reason to prefer any year in it.
          * During a tour it would be offering what they already have, and the
          * player carries its own way out.
          */}
        {!children && (
          <Link className="atlas__tours" href={`/${regionSlug}/tours`}>
            Guided tours
          </Link>
        )}

        {/* `setTheme` rather than a handler of its own: the toggle writes the
            document and storage itself, and all this needs is to know, so the
            effect below can restyle MapLibre. */}
        <ThemeToggle onChange={setTheme} />
      </div>

      {/*
        * The two columns. Fixed slots rather than free-floating cards, so the
        * tour card and the panel can never grow into each other or into the
        * dock, and a camera move can reserve a column before its content has
        * rendered. Each holds one thing: the left the tour, the right the
        * figure (or the layer menu, which the panel steps aside for).
        */}
      <div className="atlas__column atlas__column--left" data-layout="left">
        {children}
      </div>

      <div className="atlas__column atlas__column--right" data-layout="right">
        {selected && pack && (
          <DetailPanel
            entity={selected}
            pack={pack.id}
            entities={entities}
            traditions={pack.traditions}
            spanLabel={pack.spanLabel}
            year={year}
            onSelect={select}
            onFocusPair={focusOn}
            onClose={() => select(null)}
          />
        )}
      </div>

      <div className="atlas__dock" data-layout="bottom">

        {/* An empty map and a broken map look identical, so say which it is —
            but only once there is a pack to be empty of. A tour is already
            answering the question this asks, so it stands down for one. */}
        {pack && entities.length > 0 && !anyoneHere && !children && (
          <EmptyState entities={entities} year={year} onGoTo={setYear} />
        )}

        {scale && (
          <Timeline
            scale={scale}
            entities={entities}
            spans={layerSpans}
            borderChanges={region?.borderChanges}
          />
        )}

        {error && <p className="atlas__error">Could not open the atlas: {error}</p>}
      </div>

      {/*
        * The same curtain `loading.tsx` puts up while the server renders this
        * route, held until the map has actually drawn — artifacts fetched,
        * parsed, and the first tiles on screen. The two together make one
        * uninterrupted wait rather than a blank page, then an empty timeline,
        * then borders.
        *
        * It lifts on an error too. A curtain over a failure is a hang; the
        * dock says what went wrong, and it has to be visible to say it.
        */}
      <Curtain done={((painted || waited) && Boolean(region && pack)) || waited || Boolean(error)} />
    </div>
  )
}
