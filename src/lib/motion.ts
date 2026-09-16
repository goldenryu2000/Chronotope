/**
 * The user's motion preference, read fresh each time.
 *
 * `src/atlas/Atlas.css` already flattens CSS transitions under
 * `prefers-reduced-motion: reduce`, but the map camera is not CSS — MapLibre
 * animates `flyTo` and `fitBounds` in JavaScript, and those are by far the
 * largest movements in the app. Leaving them out meant the one setting that
 * exists to prevent this kind of motion had no effect on the thing most likely
 * to cause it.
 *
 * Queried per call rather than cached: the preference can change mid-session,
 * and matchMedia is cheap next to a camera animation.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * A camera duration, or zero when the user would rather not be moved.
 *
 * Zero cuts to the destination instead of travelling to it. The frame still
 * changes — nothing is hidden — but the journey between the two is skipped.
 */
export function cameraDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms
}
