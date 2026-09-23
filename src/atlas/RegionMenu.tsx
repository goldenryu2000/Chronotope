'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { flattenPlates, plateHref, type Plate } from '../read/kin'
import './RegionMenu.css'

interface Props {
  /** Every atlas that would open, nested. */
  plates: readonly Plate[]
  /** Which one is on screen. */
  current: string
  /** The reader's pack, so a link keeps it where the destination offers it. */
  activePack: string
  /** What to show before the region artifact lands. */
  title: string
}

/**
 * The region's name, and the way to another one.
 *
 * On the title rather than in a control of its own, because the title is
 * already the answer to "which map am I looking at" and this is the same
 * question asked in the other direction. It is the pack switcher's logic one
 * level up, and the pack switcher sits directly beneath it.
 *
 * Deliberately **not** a region selector in the chrome. A dropdown labelled
 * "Region" would make a plate feel like a setting; the title makes it feel
 * like a place, which is what it is. It also costs the map nothing, which the
 * dashed rectangle it replaces could not say.
 *
 * With one atlas published there is no menu at all, just the heading: a
 * control whose list would hold only the thing you are already looking at is a
 * promise the product cannot keep. `LayerMenu` stands down the same way, and
 * so does `PackSwitcher`.
 */
export default function RegionMenu({ plates, current, activePack, title }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const listed = flattenPlates(plates)

  if (listed.length < 2) {
    return <h1 className="atlas__title">{title}</h1>
  }

  return (
    <div className="regions" ref={root}>
      <h1 className="atlas__title">
        <button
          type="button"
          className="regions__toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          {title}
          <span className="regions__caret" aria-hidden="true" />
        </button>
      </h1>

      {open && (
        <div className="regions__popover" role="menu">
          <p className="regions__help">
            The same figures and the same years, drawn at different scales.
          </p>

          <ul className="regions__list">
            {listed.map(({ plate, depth }) => {
              const here = plate.slug === current
              return (
                <li key={plate.slug} data-depth={depth}>
                  <Link
                    className="regions__item"
                    href={plateHref(plate, activePack)}
                    role="menuitem"
                    aria-current={here ? 'page' : undefined}
                    data-here={here}
                    onClick={() => setOpen(false)}
                  >
                    <span className="regions__name">{plate.title}</span>
                    <span className="regions__subtitle">{plate.subtitle}</span>
                    {here && <span className="regions__here">You are here</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
