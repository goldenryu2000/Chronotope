/**
 * How many colours the layer palette holds.
 *
 * A layer picks a slot, never a colour and never a token name: Rule 1 says
 * every colour the map draws comes from a CSS custom property, and a
 * user-authored layer cannot ship CSS. Nine because nine is what both themes
 * define; raising it means adding `--map-layer-10` to `rustic.css` and
 * `slate.css` first, which `layerSlots.test.ts` will insist on.
 */
export const LAYER_SLOTS = 9

/** The theme token a slot resolves to. The only place this string is built. */
export function layerSlotToken(slot: number): string {
  return `--map-layer-${slot}`
}
