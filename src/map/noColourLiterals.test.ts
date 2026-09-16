import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Read as text rather than by inspecting the objects these modules build.
 * `layerPaint.test.ts` already proves `layerLinePaint` sources its colour
 * from `token()`, but that only proves the claim for the one function that
 * happens to build paint objects today. Rule 1 is "no colour literals in map
 * code", not "no colour literals in the functions we remembered to unit
 * test" -- and per the milestone handover this rule has already leaked into
 * the codebase twice and been repaired both times. A text scan across every
 * file, run every time the suite runs, is the version of the guard that
 * still catches a hex string dropped straight into a new `map.addLayer` call
 * or a `setPaintProperty`, and does not depend on anyone updating a test
 * alongside the code that could break it.
 */
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i

/*
 * The directories that paint. `src/map` was the whole of it until the timeline
 * grew a row of layer bands, which builds `--map-layer-n` colours exactly as
 * the map does: the guard's basis had been outgrown by the feature, which is
 * the failure its own comment above warns about, one directory up.
 */
const PAINTING_DIRS = [
  join(process.cwd(), 'src', 'map'),
  join(process.cwd(), 'src', 'timeline'),
]

/**
 * Every production source file directly under src/map, discovered rather
 * than named one by one. A hand-maintained list is exactly the kind of guard
 * that stops covering a file the moment someone forgets to add it; reading
 * the directory means a new file under src/map is scanned automatically, no
 * update to this test required.
 *
 * Test files are excluded, not because Rule 1 doesn't apply to them, but
 * because `layerPaint.test.ts` legitimately contains the substring
 * `#[0-9a-f]{3}` inside a regular expression literal that asserts the
 * *absence* of a colour -- that is not a colour, and flagging it would be
 * exactly the kind of false positive that gets a real guard turned off.
 */
const paintingSourceFiles = PAINTING_DIRS.flatMap((dir) =>
  // Recursive, so a file in a subdirectory someone adds later is scanned too.
  // A guard that stopped one level down would stop covering the code the
  // moment it was organised into folders, which is not a moment anyone would
  // think to update a test.
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))
    .map((name) => join(dir, name)),
)

describe('Rule 1: no colour literals in map code', () => {
  it('found at least one file to scan', () => {
    // Guards the guard: if this list were ever empty -- a directory rename,
    // say -- every `it.each` below would report a vacuous pass instead of
    // catching anything.
    expect(paintingSourceFiles.length).toBeGreaterThan(0)
  })

  it.each(paintingSourceFiles)('%s has no colour literal', (path) => {
    expect(readFileSync(path, 'utf8')).not.toMatch(COLOUR_LITERAL)
  })
})
