import Curtain from '@/src/atlas/Curtain'
import '@/src/theme/register.css'

/**
 * Shown the moment a link to an atlas is clicked, while the server renders it.
 *
 * Next prefetches this fallback, so it appears immediately rather than after
 * the round trip it is covering. `Atlas` then mounts the same curtain and
 * holds it until the map has actually drawn something, which makes the two
 * halves of the wait — server render, then artifacts and tiles — one
 * uninterrupted screen instead of a blank page between them.
 *
 * The theme comes from <html>, set by the root layout before first paint, so
 * this is drawn in whatever the reader last chose rather than in a hardcoded
 * one. It used to pin rustic here, which meant a reader on the dark theme
 * watched a light screen while their dark map loaded.
 */
export default function Loading() {
  return <Curtain />
}
