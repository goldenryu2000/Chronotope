import { insetsFor, type Insets, type Rect, type Viewport } from './safeArea'

/**
 * The DOM half of the layout system: reads the regions `Atlas.tsx` tags with
 * `data-layout` and hands `safeArea.ts` their rectangles.
 *
 * - `top`: the home link, the title and switcher, the chrome cluster.
 * - `left` / `right`: the columns. Each is a fixed-size slot that is only
 *   counted while it holds something, so an empty column gives the map back.
 * - `bottom`: the dock. Its children, not the dock, since the dock is a
 *   full-width rail and its flanks are map.
 */

export interface Occupancy {
  /**
   * Whether to count a column regardless of what it holds right now.
   *
   * A camera move that selects someone starts before the panel it opens has
   * rendered; measured naively it would frame for a map with no panel.
   */
  left?: boolean
  right?: boolean
}

function box(element: Element): Rect | null {
  const r = element.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null
}

function column(side: 'left' | 'right', forced: boolean | undefined): Rect | null {
  const slot = document.querySelector(`[data-layout="${side}"]`)
  if (!slot) return null
  const held = slot.childElementCount > 0 && getComputedStyle(slot).visibility !== 'hidden'
  return (forced ?? held) ? box(slot) : null
}

export function measureInsets(occupancy: Occupancy = {}): { viewport: Viewport; insets: Insets } {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const present = (rects: (Rect | null)[]) => rects.filter((r): r is Rect => r !== null)

  const insets = insetsFor(viewport, {
    top: present([...document.querySelectorAll('[data-layout="top"]')].map(box)),
    left: column('left', occupancy.left),
    right: column('right', occupancy.right),
    bottom: present(
      [...document.querySelectorAll('[data-layout="bottom"] > *')].map(box),
    ),
  })

  return { viewport, insets }
}
