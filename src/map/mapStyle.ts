import type { ExpressionSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import { token } from '../theme/themes'
import { borderFilter } from './borderFilter'
import { repaintLayerLines } from './layerPaint'

/**
 * One source, one pair of layers.
 *
 * There used to be two interchangeable slots here, cross-fading as each year's
 * TopoJSON snapshot arrived. They existed only because a year change was a
 * fetch. Every era now lives in the one archive tagged with the interval it is
 * valid for, so a year change is `setFilter` — nothing loads, nothing has to
 * be held on screen while something else arrives, and there is no second slot
 * to keep in step.
 */
export const SOURCE_ID = 'borders'

/** The layer inside the vector tiles, named by `--layer=borders` in the build. */
export const SOURCE_LAYER = 'borders'

export const FILL_LAYER_ID = 'borders-fill'
export const LINE_LAYER_ID = 'borders-line'

/**
 * A style with no tile basemap at all — modern coastlines and roads under a
 * 350 BCE map would be absurd. Everything drawn is our own vector data on a
 * flat background, so there is no external tile request and nothing to attribute.
 *
 * @param tilesetUrl where the region's `.pmtiles` archive is served from. The
 *   `pmtiles://` scheme is handled by the protocol MapCanvas registers; without
 *   that registration MapLibre reports an unknown scheme and draws sea only.
 * @param year the year to open on, so the first paint is already filtered
 *   rather than briefly showing six thousand years of borders at once.
 */
export function buildStyle(tilesetUrl: string, year: number): StyleSpecification {
  return {
    version: 8,
    name: 'chronotope',
    sources: {
      [SOURCE_ID]: {
        type: 'vector',
        url: `pmtiles://${tilesetUrl}`,
      },
    },
    layers: [
      { id: 'sea', type: 'background', paint: { 'background-color': token('--map-sea') } },
      {
        id: FILL_LAYER_ID,
        type: 'fill',
        source: SOURCE_ID,
        'source-layer': SOURCE_LAYER,
        filter: borderFilter(year),
        paint: { 'fill-color': landColour() },
      },
      {
        id: LINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        'source-layer': SOURCE_LAYER,
        filter: borderFilter(year),
        paint: {
          'line-color': token('--map-land-stroke'),
          // Borders upstream records as approximate are drawn lighter — most
          // pre-modern frontiers were zones, not lines, and the data says so.
          //
          // Compared against a *string*. The snapshots this replaced carried a
          // numeric `BORDERPRECISION` (1 approximate, 2 moderate, 3 fixed) and
          // the importer maps it to `confidence`, an enum of low/medium/high.
          // Carrying the old `['<=', ..., 1]` across the rename type-checked,
          // validated, and then failed against every feature at paint time —
          // MapLibre warns and falls back, so all three widths silently became
          // one. `e2e/atlas.spec.ts` now fails on that warning.
          //
          // A plain `case`, deliberately: MapLibre rejects `['zoom']` anywhere
          // but the top level of an `interpolate`, and blanks the entire map
          // rather than the one layer when it finds one.
          'line-width': ['case', ['==', ['get', 'confidence'], 'low'], 0.4, 0.8],
        },
      },
    ],
  }
}

/** Every border layer, in paint order. The year filter applies to all of them. */
export const BORDER_LAYER_IDS = [FILL_LAYER_ID, LINE_LAYER_ID] as const

/** Parchment, or the accent colour where the pointer is. */
function landColour(): ExpressionSpecification {
  return [
    'case',
    ['boolean', ['feature-state', 'hover'], false],
    token('--map-polity-fill'),
    token('--map-land'),
  ]
}

/**
 * Re-read every colour from the current theme.
 *
 * Called on theme change instead of reloading the style, which would drop the
 * source and re-fetch every tile on screen.
 */
export function applyThemePaint(map: MapLibreMap): void {
  map.setPaintProperty('sea', 'background-color', token('--map-sea'))
  map.setPaintProperty(FILL_LAYER_ID, 'fill-color', landColour())
  map.setPaintProperty(LINE_LAYER_ID, 'line-color', token('--map-land-stroke'))
  // Whatever layers the reader has lit, restyled from the same tokens. A
  // no-op when none are.
  repaintLayerLines(map)
}
