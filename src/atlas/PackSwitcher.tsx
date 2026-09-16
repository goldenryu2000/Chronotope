'use client'

import { useRef } from 'react'
import type { RegionPack } from '../read/regionPacks'
import './PackSwitcher.css'

interface Props {
  /** Every pack laid over this region, resolved on the server. */
  packs: readonly RegionPack[]
  /** The slug of the pack currently on the map. */
  active: string
  onSelect: (slug: string) => void
}

/**
 * Choosing what the map is showing, from the line that already says what it is.
 *
 * The alternatives are on screen, not behind a click. The first version of
 * this was a menu: the current pack's name with a caret, opening a list. It
 * scaled beautifully and nobody would ever have found it — at rest it looked
 * exactly like the subtitle it replaced, and a reader had no way to learn that
 * two other packs existed without clicking a word that did not look clickable.
 *
 * Showing every option instead fixes both halves of that at once. The control
 * is legible as a control because it is a bordered group of choices, and the
 * choices *are* the discovery: you cannot miss that mythology exists when its
 * name is sitting next to the one you are reading. It also halves the work of
 * the single most exploratory action here — switching is one click, not open-
 * then-pick — and this is a thing people are meant to do idly, comparing who
 * else was around in a year they are already looking at.
 *
 * It stays honest when there are more: the row scrolls rather than wrapping or
 * squeezing, so a region with a dozen packs degrades into something still
 * usable instead of reflowing the header. If community packs ever make that
 * the normal case, the answer is a browse surface, not a longer row — but
 * designing this one around that hypothetical would have cost every reader
 * today the thing that makes it discoverable.
 *
 * Nothing here knows what a "philosopher" is; every string is server-supplied
 * (Rule 2).
 */
export default function PackSwitcher({ packs, active, onSelect }: Props) {
  const row = useRef<HTMLDivElement>(null)

  const current = packs.find((pack) => pack.slug === active)
  if (!current) return null

  // A region with one pack has nothing to switch to. A group of one choice is
  // not a control, it is a label, so it is rendered as one.
  if (packs.length < 2) {
    return (
      <div className="pack-switcher">
        <p className="pack-switcher__solo">{current.title}</p>
        <p className="pack-switcher__caption">{current.subtitle}</p>
      </div>
    )
  }

  /*
   * Arrow keys move *and* choose, which is how a radio group behaves and what
   * a reader who has just tabbed onto it will expect. Roving tabindex, so the
   * group is one tab stop rather than one per pack.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
        : 0
    if (step === 0) return

    event.preventDefault()
    const index = packs.findIndex((pack) => pack.slug === active)
    const next = packs[(index + step + packs.length) % packs.length]
    onSelect(next.slug)
    row.current?.querySelector<HTMLButtonElement>(`[data-slug="${next.slug}"]`)?.focus()
  }

  return (
    <div className="pack-switcher">
      <div
        className="pack-switcher__row"
        ref={row}
        role="radiogroup"
        aria-label="What the map is showing"
        onKeyDown={onKeyDown}
      >
        {packs.map((pack) => {
          const isActive = pack.slug === active
          return (
            <button
              key={pack.slug}
              type="button"
              role="radio"
              aria-checked={isActive}
              // One tab stop for the group; the arrows move within it.
              tabIndex={isActive ? 0 : -1}
              data-slug={pack.slug}
              data-active={isActive}
              className="pack-switcher__option"
              onClick={() => onSelect(pack.slug)}
            >
              {pack.title}
            </button>
          )
        })}
      </div>

      {/*
        * The subtitle the header used to carry, kept and put to work: it now
        * says what the *chosen* pack is, right under the choice, so the row of
        * bare names is never the only thing explaining itself.
        */}
      <p className="pack-switcher__caption">{current.subtitle}</p>
    </div>
  )
}
