// MapLibre locates its worker with `new URL('./maplibre-gl-worker.mjs',
// import.meta.url)` evaluated at runtime. Turbopack (both `next dev` and
// `next build`) does not rewrite that call, so `import.meta.url` inside the
// bundled module never resolves to an http(s) URL and maplibre-gl's
// `defaultWorkerUrl()` gives up and returns "" — silently. No console error,
// no network request: `new Worker("")` just loads the current document as a
// worker script and the map's sources never leave the "loading" state.
//
// The fix is to serve the worker file (and the sibling chunk it imports by
// exact relative filename) ourselves from a stable, unhashed path in
// `public/`, then point maplibre-gl at it explicitly with
// `maplibregl.setWorkerUrl()` (see src/lib/maplibre-worker.ts). This script
// copies those two files out of the installed package on every dev/build run
// (see the "predev"/"prebuild" hooks in package.json) so they always match
// whatever maplibre-gl version is actually installed.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const destDir = join(repoRoot, "public", "maplibre");

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(destDir, { recursive: true });

for (const file of FILES) {
  const src = require.resolve(`maplibre-gl/dist/${file}`);
  copyFileSync(src, join(destDir, file));
}

console.log(`copy-maplibre-worker: copied ${FILES.join(", ")} to public/maplibre/`);
