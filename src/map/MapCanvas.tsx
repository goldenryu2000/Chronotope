'use client'

import {
  addProtocol,
  AttributionControl,
  Map as MapLibre,
  type MapGeoJSONFeature,
  type MapLibreMap,
  NavigationControl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import { useEffect, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { activeAt, type ActiveEntity } from '../data/entitySpan'
import { CAMERA_PAD, cameraBounds, hasEdges, type BBox, type Viewport } from '../lib/bbox'
import { LayerSchema } from '../data/schemas'
import { configureMaplibreWorker } from '../lib/maplibre-worker'
import { cameraDuration } from '../lib/motion'
import { measureInsets } from '../layout/measure'
import { extentOf, fitPlate, frame, GAP, type Insets } from '../layout/safeArea'
import { Invitations, type Invite } from './invitation'
import { addNeatline, repaintNeatline } from './neatline'
import { EntityMarkers } from './entityMarkers'
import { addLayerLine, layerLineId } from './layerPaint'
import type { RegionLayer } from '../read/regionLayers'
import type { ThemeId } from '../theme/themes'
import { useAtlas } from '../state/store'
import './MapCanvas.css'
import { borderFilter, mappedYear, type BorderYears } from './borderFilter'
import {
  applyThemePaint,
  BORDER_LAYER_IDS,
  buildStyle,
  FILL_LAYER_ID,
  SOURCE_ID,
  SOURCE_LAYER,
} from './mapStyle'

// Turbopack does not rewrite `import.meta.url`, so maplibre-gl's own worker
// resolution returns "" and `new Worker("")` silently loads the page itself —
// no error, no request, every source stuck unloaded. See
// src/lib/maplibre-worker.ts for the whole story. This has to run before any
// Map is constructed, so it sits at module scope rather than in an effect.
configureMaplibreWorker()

/**
 * Teach MapLibre the `pmtiles://` scheme.
 *
 * A PMTiles archive is one file read with HTTP range requests, not a directory
 * of tiles, so there is no URL template MapLibre could fetch on its own. The
 * protocol handler turns a z/x/y request into the byte range holding that
 * tile. Registered here at module scope for the same reason the worker is:
 * both have to be in place before any Map is constructed, and a Map built
 * without this reports an unknown scheme and draws nothing but sea.
 *
 * `addProtocol` is global to maplibre-gl, so registering it twice would leak a
 * second cache; module scope runs once per page.
 */
addProtocol('pmtiles', new Protocol().tile)

/**
 * Whether a layer belongs on the map right now.
 *
 * One rule, asked from two places: the effect that reacts to a toggle, and the
 * fetch that resolves some time after it. Written once because the two must
 * never disagree — a layer added by a fetch that answered the older question
 * would light itself back up after the reader had put it out.
 */
function isDrawn(layer: RegionLayer, year: number, lit: readonly string[]): boolean {
  return lit.includes(layer.slug) && year >= layer.valid.start && year <= layer.valid.end
}

/** How far inside the clear area a framed pin sits, so its label fits too. */
const PIN_CLEARANCE = GAP * 2

/** The container's size, with a sane fallback before layout has happened. */
function sizeOf(element: HTMLElement | null): Viewport {
  const width = element?.clientWidth ?? 0
  const height = element?.clientHeight ?? 0
  return {
    width: width > 0 ? width : window.innerWidth,
    height: height > 0 ? height : window.innerHeight,
  }
}

/**
 * Where a plate opens, and how far its camera may travel from there.
 *
 * A plate with edges is shown whole, fitted between the top bar and the dock,
 * and the travel is widened to take in that fit: MapLibre keeps the viewport
 * inside `maxBounds`, so bounds sized for the plate alone would zoom back in
 * past it and put the south under the timeline again. A plate that reaches all
 * the way round has no edges to fit, so it opens where its region says.
 */
function plateCamera(
  camera: Camera, viewport: Viewport, insets: Insets,
): { center: [number, number]; zoom: number; maxBounds?: [[number, number], [number, number]] } {
  const bounds = cameraBounds(camera.bounds, viewport)
  if (!hasEdges(camera.bounds) || !bounds) {
    return { center: camera.center, zoom: camera.zoom, maxBounds: bounds }
  }

  const fit = fitPlate(camera.bounds, viewport, insets, { min: camera.minZoom, max: camera.maxZoom })
  const [[west, south], [east, north]] = extentOf(fit.center, fit.zoom, viewport)
  // Grown by the same share `cameraBounds` allows, so a fitted plate can still
  // be nudged a little in every direction.
  const padX = (east - west) * CAMERA_PAD
  const padY = (north - south) * CAMERA_PAD
  const low: [number, number] = [
    Math.max(-180, Math.min(bounds[0][0], west - padX)),
    Math.max(-85.051129, Math.min(bounds[0][1], south - padY)),
  ]
  const high: [number, number] = [
    Math.min(180, Math.max(bounds[1][0], east + padX)),
    Math.min(85.051129, Math.max(bounds[1][1], north + padY)),
  ]
  // MapLibre refuses a box the whole way round; see `cameraBounds`.
  return { ...fit, maxBounds: high[0] - low[0] >= 360 ? undefined : [low, high] }
}

interface Hovered {
  name: string
  subjectTo: string
}

/**
 * Where the camera starts and how far it may travel.
 *
 * Supplied by the region artifact rather than hardcoded. The ported build
 * carried literal world bounds in this file, which is region vocabulary living
 * in engine code — `world` is a row like any other and gets no privileges.
 */
export interface Camera {
  center: [number, number]
  zoom: number
  minZoom: number
  maxZoom: number
  /**
   * The plate's edges, which is as far as the camera may travel.
   *
   * From the region artifact, like everything else here. The world's bbox is
   * the world, so this only removes the grey nothing beyond ±85°; a plate the
   * size of a subcontinent is clipped to its bbox at tile-build time, so
   * without this a reader could pan off the edge of their own atlas into
   * empty sea and have no way of knowing the map had not broken.
   */
  bounds: BBox
}

interface Props {
  theme: ThemeId
  camera: Camera
  entities: readonly ActiveEntity[]
  /** Where the region's PMTiles archive is served from. */
  tilesetUrl: string
  /**
   * Called once the map has finished its first render, tiles and all.
   *
   * `load` is too early to reveal on — it fires when the style is parsed,
   * before a single tile has arrived, so a curtain lifted there uncovers an
   * empty sea. `idle` is MapLibre saying it has drawn everything it currently
   * has and is not expecting more.
   */
  onReady?: () => void
  /** The years the archive draws, so years outside it clamp instead of blanking. */
  borderYears?: BorderYears
  /** Every layer this region offers, with the artifact to fetch on first use. */
  layers?: readonly RegionLayer[]
  /**
   * Plates drawn inside this one, offered as a way in.
   *
   * Rectangles, names and destinations. The engine is told nothing about what
   * a region is or which one this is (Rule 3). Nothing is drawn for them until
   * one of them is most of what the reader is looking at; see `invitation.ts`.
   */
  invitations?: readonly Invite[]
  /** Where accepting one goes. The router's push, handed in. */
  onEnterPlate?: (href: string) => void
}

export default function MapCanvas({
  theme, camera, entities, tilesetUrl, borderYears, onReady, layers = [],
  invitations = [], onEnterPlate,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const markers = useRef<EntityMarkers | null>(null)
  const invites = useRef<Invitations | null>(null)

  const hoveredFeature = useRef<string | number | null>(null)
  /** Whether the camera is still where the plate opened, untouched by reader or view. */
  const untouched = useRef(true)
  /** Whether the map has drawn once, which is when the curtain lifts. */
  const painted = useRef(false)

  // Read once, at construction: MapLibre takes these as initial options, and
  // re-creating the map because a prop object changed identity would throw the
  // loaded tiles away for nothing.
  const initialCamera = useRef(camera)
  const initialTileset = useRef(tilesetUrl)
  // Through a ref so a caller passing an inline function does not re-create
  // the map, which is the one thing that effect must never do. Written in an
  // effect rather than during render: a ref assignment in the render body is
  // not safe under concurrent rendering, and ESLint says so.
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])
  const initialYears = useRef(borderYears)

  const year = useAtlas((state) => state.year)
  /** The year the style is built with. Later changes go through `setFilter`. */
  const openingYear = useRef(year)
  const selectedId = useAtlas((state) => state.selectedId)
  const select = useAtlas((state) => state.select)
  const focusPair = useAtlas((state) => state.focusPair)
  const focusOn = useAtlas((state) => state.focusOn)
  const [hovered, setHovered] = useState<Hovered | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * A layer that failed to load, kept apart from `error`.
   *
   * They used to share one slot, which rendered a missing route as "Could not
   * load borders", naming the wrong thing: the borders were fine.
   */
  const [layerError, setLayerError] = useState<string | null>(null)

  // Create the map once. Everything after this mutates it in place.
  useEffect(() => {
    if (!container.current) return

    const start = initialCamera.current
    // The dock may not have rendered yet; the fit is taken again once it has.
    const { insets } = measureInsets()
    const opening = plateCamera(start, sizeOf(container.current), insets)

    const instance = new MapLibre({
      container: container.current,
      // The opening year is baked into the style's filter so the first paint
      // is already one era. Building it unfiltered and correcting it in the
      // year effect below would flash every border of six thousand years.
      style: buildStyle(initialTileset.current, mappedYear(openingYear.current, initialYears.current)),
      center: opening.center,
      zoom: opening.zoom,
      // 0 is as far out as MapLibre goes — the world is 512px there. A phone
      // viewport is narrower than that, so it can never show the full 360°;
      // a region asking for less than 0 gets 0 anyway.
      minZoom: start.minZoom,
      maxZoom: start.maxZoom,
      // The data is a world atlas; letting it tilt buys nothing and makes
      // polygon labels harder to place later.
      pitchWithRotate: false,
      dragRotate: false,
      // One world, not a repeating strip. A printed atlas has edges.
      renderWorldCopies: false,
      // And so does a plate of one: a reader inside India must not be able to
      // pan into an ocean their own archive was never cut for. Sized against
      // the container rather than the plate alone, because MapLibre keeps the
      // whole viewport inside these bounds and would otherwise zoom in until
      // only a slice of the plate showed. Undefined for a plate that is the
      // whole world -- see `cameraBounds` -- and widened to hold the fit.
      maxBounds: opening.maxBounds,
      attributionControl: false,
    })

    instance.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    instance.addControl(
      new AttributionControl({
        compact: true,
        customAttribution:
          'Borders: <a href="https://github.com/aourednik/historical-basemaps">historical-basemaps</a> (GPL-3.0) · <a href="/credits">Credits</a>',
      }),
      'bottom-left',
    )

    map.current = instance

    // A reader's own move ends the opening fit; see the refit below.
    instance.on('movestart', (event) => {
      if (event.originalEvent) untouched.current = false
    })
    instance.on('load', () => setReady(true))
    instance.once('idle', () => {
      painted.current = true
      onReadyRef.current?.()
    })

    // MapLibre reports style and source failures through this event rather than
    // by throwing, so without a handler a broken style is silently a blank map.
    instance.on('error', (event) => setError(event.error?.message ?? 'map error'))

    // A handle for poking at the map from the devtools console, and the only
    // way `e2e/atlas.spec.ts` can ask whether the border data genuinely
    // parsed — `querySourceFeatures` has no DOM equivalent, and a dead
    // MapLibre worker is otherwise indistinguishable from an empty map.
    //
    // Deliberately not dev-gated. Playwright's webServer is `reuseExistingServer`,
    // so the app under test is whichever server is already on :3000 — often
    // `npm start`, a production build. A dev-only handle turns the one test
    // that proves the worker is alive into a test that passes by never
    // running its assertion. The handle is a read-only reference to a map
    // instance the page already owns; it exposes no data the client did not
    // fetch itself, and no credentials.
    Object.assign(window, { __map: instance })

    return () => {
      instance.remove()
      map.current = null
      setReady(false)
    }
  }, [])

  /*
   * The plate's bounds follow the shape of the window.
   *
   * `cameraBounds` grows the box to the viewport's aspect, so a window dragged
   * from square to wide would otherwise leave MapLibre zooming in to satisfy a
   * box computed for a shape the screen no longer has -- the same over-zoom
   * the aspect fit exists to prevent, arriving a resize later. Recomputed from
   * the same function, so the two can never disagree.
   */
  useEffect(() => {
    const instance = map.current
    if (!instance) return

    const apply = () => {
      const { insets } = measureInsets()
      const bounds = plateCamera(initialCamera.current, sizeOf(container.current), insets).maxBounds
      instance.setMaxBounds(bounds ?? null)
    }
    instance.on('resize', apply)
    return () => {
      instance.off('resize', apply)
    }
  }, [ready])

  // Hover highlight. Bound once the style exists.
  useEffect(() => {
    const instance = map.current
    if (!instance || !ready) return

    // Vector-tile feature state is addressed by source *and* source layer;
    // omitting `sourceLayer` throws rather than silently missing, but only
    // when a feature is actually hovered.
    const featureRef = (id: string | number) =>
      ({ source: SOURCE_ID, sourceLayer: SOURCE_LAYER, id })

    const clear = () => {
      const previous = hoveredFeature.current
      if (previous !== null) {
        instance.setFeatureState(featureRef(previous), { hover: false })
        hoveredFeature.current = null
      }
      setHovered(null)
      instance.getCanvas().style.cursor = ''
    }

    const onMove = (event: { features?: MapGeoJSONFeature[] }) => {
      const feature = event.features?.[0]
      // Feature ids come from tippecanoe's `--use-attribute-for-id=fid`, which
      // carries the boundary row's ordinal into the tiles. Without an id there
      // is nothing to hang feature state on and the fill could not highlight.
      if (!feature || feature.id === undefined) return

      // Roughly 38% of upstream polygons carry no attributes at all — every
      // field null, not just the name. There is nothing to say about them, so
      // they neither highlight nor open a chip. Empty string, not null: MVT
      // has no null, and the build writes `coalesce(..., '')`.
      const props = feature.properties as { name?: string | null; subject_to?: string | null }
      if (!props.name) {
        clear()
        return
      }

      const previous = hoveredFeature.current
      if (previous === feature.id) return
      if (previous !== null) instance.setFeatureState(featureRef(previous), { hover: false })

      instance.setFeatureState(featureRef(feature.id), { hover: true })
      hoveredFeature.current = feature.id

      setHovered({ name: props.name, subjectTo: props.subject_to ?? '' })
      instance.getCanvas().style.cursor = 'pointer'
    }

    instance.on('mousemove', FILL_LAYER_ID, onMove)
    instance.on('mouseleave', FILL_LAYER_ID, clear)

    // Leaving the map for a UI overlay never fires the per-layer mouseleave,
    // which would otherwise strand the chip on screen.
    instance.on('mouseout', clear)

    return () => {
      instance.off('mousemove', FILL_LAYER_ID, onMove)
      instance.off('mouseleave', FILL_LAYER_ID, clear)
      instance.off('mouseout', clear)
    }
  }, [ready])

  /**
   * A year change is a repaint.
   *
   * Every era is already in the archive, tagged with the interval it is valid
   * for, so choosing a year is choosing a filter. No fetch, no debounce, no
   * pair of slots cross-fading while the next file arrives — all of which this
   * effect used to do, and all of which existed only because a year used to be
   * a file. `e2e/atlas.spec.ts` holds the falsifiable form of that claim: it
   * scrubs and asserts no request goes out.
   */
  useEffect(() => {
    const instance = map.current
    if (!instance || !ready) return

    const filter = borderFilter(mappedYear(year, borderYears))
    for (const id of BORDER_LAYER_IDS) instance.setFilter(id, filter)
  }, [year, borderYears, ready])

  const activeLayers = useAtlas((state) => state.activeLayers)
  /** Which layers have had their geometry fetched and added, by slug. */
  const addedLayers = useRef(new Set<string>())

  /*
   * A layer is drawn when the reader has lit it and the cursor is inside its
   * years.
   *
   * Two conditions, not one, and the second is why a lit layer can be invisible:
   * the Silk Road in 1900 is a claim nobody should be able to make by leaving a
   * checkbox on. The menu says which it is rather than silently unchecking.
   *
   * Geometry is fetched the first time a layer is actually needed and kept
   * afterwards. Removing the source on the way down would re-fetch on the next
   * toggle, and a route already in memory is a few kilobytes.
   */
  useEffect(() => {
    const instance = map.current
    if (!instance || !ready) return

    for (const layer of layers) {
      const wanted = isDrawn(layer, year, activeLayers)

      if (wanted && !addedLayers.current.has(layer.slug)) {
        // Marked before the fetch resolves, so a second render while it is in
        // flight does not start a second one.
        addedLayers.current.add(layer.slug)
        void (async () => {
          try {
            const response = await fetch(layer.artifactUrl)
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const artifact = LayerSchema.parse(await response.json())
            // The map, not the one this run captured: the effect that started
            // the fetch may be several years out of date by now, and on unmount
            // there is nothing left to add to.
            const live = map.current
            if (!live) return
            addLayerLine(live, layer, artifact.features as FeatureCollection)
            // Asked again rather than assumed. The reader can scrub the year or
            // unlight the layer while its geometry is in flight, and the effect
            // run that would have corrected it saw no layer to correct.
            const state = useAtlas.getState()
            live.setLayoutProperty(
              layerLineId(layer.slug),
              'visibility',
              isDrawn(layer, state.year, state.activeLayers) ? 'visible' : 'none',
            )
            // A retry that worked clears the complaint the failure left.
            setLayerError(null)
          } catch (cause) {
            // Forgotten, so lighting it again retries rather than doing nothing.
            addedLayers.current.delete(layer.slug)
            setLayerError(`${layer.name} (${(cause as Error).message})`)
          }
        })()
        continue
      }

      if (instance.getLayer(layerLineId(layer.slug))) {
        instance.setLayoutProperty(
          layerLineId(layer.slug), 'visibility', wanted ? 'visible' : 'none',
        )
      }
    }
  }, [layers, activeLayers, year, ready])

  // Restyle in place on theme change rather than reloading the style, which
  // would drop the source and re-fetch every tile on screen.
  useEffect(() => {
    const instance = map.current
    if (!instance || !ready) return
    applyThemePaint(instance)
    repaintNeatline(instance)
  }, [theme, ready])

  /*
   * The ways into the plates inside this one.
   *
   * Through a ref so that a caller passing an inline handler does not tear the
   * frames down and rebuild them, exactly as `onReady` is handled above.
   */
  const onEnterRef = useRef(onEnterPlate)
  useEffect(() => {
    onEnterRef.current = onEnterPlate
  }, [onEnterPlate])

  // The plate's own edge, added once the style exists. A plate that reaches
  // all the way round draws none; see `addNeatline`.
  useEffect(() => {
    const instance = map.current
    if (!instance || !ready) return
    addNeatline(instance, initialCamera.current.bounds)
  }, [ready])

  // The manager outlives what it offers. Recreating it whenever the list
  // changed identity -- which it does on every pack switch, since a
  // destination carries the reader's pack -- would tear the captions off the
  // map and fade them back in for a change of one href.
  useEffect(() => {
    const instance = map.current
    if (!instance || !ready) return

    const offers = new Invitations(instance, (href) => onEnterRef.current?.(href))
    invites.current = offers

    return () => {
      offers.destroy()
      invites.current = null
    }
  }, [ready])

  useEffect(() => {
    if (!ready) return
    invites.current?.update(invitations)
  }, [invitations, ready])

  useEffect(() => {
    const instance = map.current
    if (!instance || !ready) return

    const entityMarkers = new EntityMarkers(instance, select)
    markers.current = entityMarkers

    // Clicking bare map dismisses the panel; marker clicks stop propagation.
    const onClick = () => {
      select(null)
      entityMarkers.collapse()
    }
    instance.on('click', onClick)

    return () => {
      instance.off('click', onClick)
      entityMarkers.destroy()
      markers.current = null
    }
  }, [ready, select])

  /**
   * Frame two entities together when a contemporary is chosen.
   *
   * fitBounds rather than flyTo: "meanwhile, elsewhere" is a claim about
   * distance, so showing both ends is the payoff. A pair in the same city
   * still zooms right in, because the bounds are tiny; a pair on opposite
   * sides of Eurasia zooms out to hold both.
   */
  useEffect(() => {
    const instance = map.current
    if (!instance || !ready || !focusPair) return

    const [a, b] = focusPair
    // The panel stays open on the contemporary, so its column is reserved.
    // This was a hard-coded guess of every overlay's size, which the tour card
    // and a taller timeline had both outgrown.
    untouched.current = false
    const { insets } = measureInsets({ right: true })
    instance.fitBounds(
      [
        [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
        [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
      ],
      {
        padding: {
          top: insets.top + PIN_CLEARANCE,
          bottom: insets.bottom + PIN_CLEARANCE,
          left: insets.left + PIN_CLEARANCE,
          right: insets.right + PIN_CLEARANCE,
        },
        maxZoom: 5,
        duration: cameraDuration(900),
      },
    )

    // One-shot: clearing it means re-selecting the same pair fires again.
    focusOn(null)
  }, [focusPair, ready, focusOn])

  /*
   * The opening fit, taken again once the pack is in.
   *
   * The map is usually built before the pack lands, and the timeline is built
   * from the pack, so the first fit measured a screen with no dock and put the
   * south of the plate under it. Once, behind the curtain, and only if nothing
   * has moved the camera since: a tour stop's view or the reader's own drag
   * always wins.
   */
  const hasEntities = entities.length > 0
  const refitted = useRef(false)
  useEffect(() => {
    const instance = map.current
    if (!instance || !ready || !hasEntities || refitted.current) return
    refitted.current = true
    if (!untouched.current) return

    const { insets } = measureInsets()
    const next = plateCamera(initialCamera.current, sizeOf(container.current), insets)
    instance.setMaxBounds(next.maxBounds ?? null)
    instance.jumpTo({ center: next.center, zoom: next.zoom })
  }, [ready, hasEntities])

  const cameraTarget = useAtlas((state) => state.cameraTarget)
  const flyToTarget = useAtlas((state) => state.flyToTarget)

  useEffect(() => {
    const instance = map.current
    if (!instance || !ready || !cameraTarget) return

    untouched.current = false
    // A view that selects someone opens the panel, which has not rendered yet.
    const { viewport, insets } = measureInsets({ right: Boolean(cameraTarget.subject) })
    const center = frame(
      cameraTarget.center,
      cameraTarget.zoom,
      cameraTarget.subject ?? null,
      viewport,
      insets,
      PIN_CLEARANCE,
    )

    if (!painted.current) {
      // Behind the curtain nobody sees a flight, and it only delays the lift:
      // `idle` waits for the camera to stop. A link to a stop opens on it.
      instance.jumpTo({ center, zoom: cameraTarget.zoom })
    } else {
      instance.flyTo({
        center,
        zoom: cameraTarget.zoom,
        duration: cameraDuration(1100),
        // essential: this move carries meaning — it is how a tour stop, a search
        // result or a contemporary arrives — so it happens either way. The
        // preference shortens the journey rather than cancelling the destination.
        essential: true,
      })
    }

    flyToTarget(null)
  }, [cameraTarget, ready, flyToTarget])

  // `ready` belongs in these deps: when it flips true the manager above is
  // created, and without it this would not run again to populate the map.
  useEffect(() => {
    markers.current?.update(activeAt(entities, year), year, selectedId)
  }, [entities, year, selectedId, ready])

  return (
    <div className="map">
      <div className="map__canvas" ref={container} />

      {hovered && (
        <div className="map__polity" role="status">
          <span className="map__polity-name">{hovered.name}</span>
          {hovered.subjectTo && hovered.subjectTo !== hovered.name && (
            <span className="map__polity-subject">subject to {hovered.subjectTo}</span>
          )}
        </div>
      )}

      {error && <div className="map__error">Could not load borders: {error}</div>}
      {layerError && !error && (
        <div className="map__error">Could not load a layer: {layerError}</div>
      )}
    </div>
  )
}
