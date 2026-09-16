import { setWorkerUrl } from "maplibre-gl";

/**
 * Points maplibre-gl at a worker script we serve ourselves.
 *
 * maplibre-gl's `defaultWorkerUrl()` builds the worker's location from
 * `import.meta.url` at runtime. Turbopack (Next.js 16's bundler for both
 * `next dev` and `next build`) doesn't rewrite that expression, so inside the
 * bundle it never resolves to an http(s) URL — maplibre-gl detects that and
 * returns "" rather than guessing. The failure is silent: `new Worker("")`
 * loads the current document as a worker, nothing errors, and every source
 * stays stuck unloaded (`map.isSourceLoaded()` never becomes true). A raster
 * basemap hides this completely, since it never touches the worker.
 *
 * `scripts/copy-maplibre-worker.mjs` (run via the "predev"/"prebuild" npm
 * hooks) copies `maplibre-gl-worker.mjs` and the `maplibre-gl-shared.mjs`
 * chunk it imports by exact relative filename into `public/maplibre/`,
 * unhashed and together, so this URL is stable and the worker's own import
 * resolves. Call this once before constructing any `maplibregl.Map`.
 */
export function configureMaplibreWorker(): void {
  setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
}
