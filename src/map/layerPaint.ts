import type { LineLayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import type { LayerKind } from '../data/schemas'
import { layerSlotToken } from '../theme/layerSlots'
import { token } from '../theme/themes'

export const LAYER_SOURCE_PREFIX = 'layer-source-'
export const LAYER_LINE_PREFIX = 'layer-line-'

export const layerSourceId = (slug: string) => `${LAYER_SOURCE_PREFIX}${slug}`
export const layerLineId = (slug: string) => `${LAYER_LINE_PREFIX}${slug}`

/**
 * The dash pattern per kind.
 *
 * Not decoration: two lit layers can land on adjacent palette slots, and a
 * reader looking at a crowded Mediterranean needs the trade route and the
 * spread of an alphabet to be separable without consulting the menu. It is
 * also the honest distinction, per the design: the Silk Road moved goods, the
 * alphabet did not.
 */
export const KIND_DASH: Record<LayerKind, [number, number]> = {
  trade: [3, 2],
  idea: [1.5, 2],
  migration: [6, 2],
}

/**
 * Every colour here comes from `token()`. Rule 1, and the reason a layer
 * carries a palette slot rather than a colour: a hex literal is
 * unrepresentable in this path rather than merely discouraged, which is the
 * only version of the rule that survives content a reader authors.
 */
export function layerLinePaint(
  slot: number,
  kind: LayerKind,
): NonNullable<LineLayerSpecification['paint']> {
  return {
    'line-color': token(layerSlotToken(slot)),
    'line-width': 2,
    'line-opacity': 0.85,
    'line-dasharray': KIND_DASH[kind],
  }
}

export interface PaintedLayer {
  slug: string
  kind: LayerKind
  paletteSlot: number
}

/**
 * Adds a layer's geometry to the map, hidden.
 *
 * Created on first use rather than at style load. The build this is ported
 * from added all nine at once, which it could afford because every geometry
 * was bundled into the JavaScript; here a layer's geometry arrives over the
 * wire when the reader first asks for it, and adding nine sources up front
 * would be nine fetches nobody asked for.
 *
 * The palette slot rides along in the layer's `metadata` so `repaintLayerLines`
 * can restyle on a theme change without being handed the list again.
 */
export function addLayerLine(
  map: MapLibreMap,
  layer: PaintedLayer,
  data: FeatureCollection,
): void {
  const sourceId = layerSourceId(layer.slug)
  if (!map.getSource(sourceId)) map.addSource(sourceId, { type: 'geojson', data })
  if (map.getLayer(layerLineId(layer.slug))) return

  map.addLayer({
    id: layerLineId(layer.slug),
    type: 'line',
    source: sourceId,
    metadata: { paletteSlot: layer.paletteSlot, kind: layer.kind },
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: layerLinePaint(layer.paletteSlot, layer.kind),
  })
}

/**
 * Re-read every layer line's colour from the current theme.
 *
 * Walks the map's own style rather than taking a list, so it cannot fall out
 * of step with what was actually added. The build this is ported from drew its
 * overlays in static colours and did not restyle on a theme flip, which its
 * own design called out as a defect; here the colour was never a literal, so
 * this is the whole fix.
 */
export function repaintLayerLines(map: MapLibreMap): void {
  for (const layer of map.getStyle().layers) {
    if (!layer.id.startsWith(LAYER_LINE_PREFIX)) continue
    const slot = (layer.metadata as { paletteSlot?: number } | undefined)?.paletteSlot
    if (typeof slot !== 'number') continue
    map.setPaintProperty(layer.id, 'line-color', token(layerSlotToken(slot)))
  }
}
