'use client'

import { useEffect, useRef, useState } from 'react'
import { LAYER_KINDS, type LayerKind } from '../data/schemas'
import { formatYear } from '../lib/year'
import type { RegionLayer } from '../read/regionLayers'
import { useAtlas } from '../state/store'
import { layerSlotToken } from '../theme/layerSlots'
import './LayerMenu.css'

/** What each kind is called in the menu. Grouping, and the honest distinction. */
const KIND_LABEL: Record<LayerKind, string> = {
  trade: 'Trade routes',
  idea: 'Ideas and scripts',
  migration: 'Migrations',
}

interface Props {
  /** Every layer this region offers, resolved on the server. */
  layers: readonly RegionLayer[]
}

export default function LayerMenu({ layers }: Props) {
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)

  const activeLayers = useAtlas((state) => state.activeLayers)
  const toggleLayer = useAtlas((state) => state.toggleLayer)
  const clearLayers = useAtlas((state) => state.clearLayers)
  const year = useAtlas((state) => state.year)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // A region with no layers gets no control at all, for the reason the pack
  // switcher stands down before its artifacts land: an empty menu is a promise
  // the map cannot keep.
  if (layers.length === 0) return null

  return (
    <div className="layers" ref={menu}>
      <button
        type="button"
        className="layers__toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Layers
        {activeLayers.length > 0 && (
          <span className="layers__badge" data-testid="layer-count">{activeLayers.length}</span>
        )}
      </button>

      {open && (
        <div className="layers__popover">
          <div className="layers__heading">
            <h2 className="layers__title">Historical layers</h2>
            {activeLayers.length > 0 && (
              <button type="button" className="layers__clear" onClick={clearLayers}>
                Clear all
              </button>
            )}
          </div>

          <p className="layers__help">
            A route draws only in the years it was in use. The timeline marks each lit
            layer, so you can see where to scrub.
          </p>

          {LAYER_KINDS.map((kind) => {
            const group = layers.filter((layer) => layer.kind === kind)
            if (group.length === 0) return null

            return (
              <section
                key={kind}
                className="layers__group"
                role="group"
                aria-label={KIND_LABEL[kind]}
              >
                <h3 className="layers__group-title">{KIND_LABEL[kind]}</h3>

                {group.map((layer) => {
                  const lit = activeLayers.includes(layer.slug)
                  const drawing = year >= layer.valid.start && year <= layer.valid.end

                  return (
                    <label key={layer.slug} className="layers__item" data-drawing={drawing}>
                      <input
                        type="checkbox"
                        checked={lit}
                        onChange={() => toggleLayer(layer.slug)}
                      />
                      <span
                        className="layers__swatch"
                        // `var(--map-layer-n)` in the DOM rather than a
                        // resolved colour, so a swatch follows a theme switch
                        // with no JavaScript at all.
                        style={{ background: `var(${layerSlotToken(layer.paletteSlot)})` }}
                        aria-hidden="true"
                      />
                      <span className="layers__text">
                        <span className="layers__name">{layer.name}</span>
                        <span className="layers__note">{layer.note}</span>
                        <span className="layers__period">
                          {formatYear(layer.valid.start)} to {formatYear(layer.valid.end)}
                          {lit && !drawing && (year < layer.valid.start ? ' · not yet' : ' · long gone')}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
