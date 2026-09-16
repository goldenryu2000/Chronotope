'use client'

import { create } from 'zustand'
import type { AtlasView } from '../data/schemas'

interface AtlasState {
  /**
   * Cursor position on the timeline.
   *
   * A plain signed year: -384 is 384 BCE, 1650 is 1650 CE, and there is no
   * year 0. (The ported build's comment here called these "astronomical
   * years", which is wrong and contradicts the rule the rest of the codebase
   * is built on — see src/lib/year.ts.)
   */
  year: number
  setYear: (year: number) => void

  /**
   * Which region is on screen, as a slug.
   *
   * A slug and nothing more: `world` is a row in the regions table like any
   * other, and no code in src/ may treat it specially.
   */
  regionId: string | null
  setRegionId: (id: string | null) => void

  /** Currently opened entity, or null when nothing is selected. */
  selectedId: string | null
  select: (id: string | null) => void

  /**
   * A pair the map should bring into view together.
   *
   * Set when a contemporary is chosen from the panel. Both are framed rather
   * than flying to the target alone, because the whole point of "meanwhile,
   * elsewhere" is the distance between them — Ibn Rushd to Zhu Xi should
   * visibly span Eurasia, not teleport. Nearby pairs simply zoom in.
   */
  focusPair: [[number, number], [number, number]] | null
  focusOn: (pair: [[number, number], [number, number]] | null) => void

  cameraTarget: { center: [number, number]; zoom: number } | null
  flyToTarget: (target: { center: [number, number]; zoom: number } | null) => void

  /**
   * A view waiting for its pack to arrive.
   *
   * Applying a view is four writes in order — pack, year, selection, camera —
   * and the first is asynchronous when the view crosses packs. Worse, `Atlas`'s
   * pack effect deselects on every switch, because whoever was open belonged to
   * the pack being left, so a selection written before the pack lands is undone
   * the moment it does.
   *
   * So a view is parked here and consumed by the effect that already knows when
   * a pack has landed. Same one-shot shape as `focusPair` and `cameraTarget`:
   * set it, consume it, clear it.
   */
  pendingView: AtlasView | null
  applyView: (view: AtlasView | null) => void

  /**
   * Which layers are lit, as slugs.
   *
   * A view describes the atlas completely, so a tour stop naming two layers
   * means those two and no others: `setLayers` replaces, it does not merge.
   * The reader may still toggle by hand mid-tour, and the next stop overwrites
   * what they did, exactly as it overwrites the year and the selection they
   * may also have changed.
   */
  activeLayers: string[]
  toggleLayer: (slug: string) => void
  setLayers: (slugs: string[]) => void
  clearLayers: () => void
}

/**
 * Where the cursor sits before a pack has landed.
 *
 * Only a placeholder: `Atlas` overwrites this with the pack's own `startYear`
 * (clamped into the resolved era range) as soon as the artifact arrives, so no
 * pack's opening year is baked into the engine.
 */
export const INITIAL_YEAR = -350

export const useAtlas = create<AtlasState>((set) => ({
  year: INITIAL_YEAR,
  setYear: (year) => set({ year }),

  regionId: null,
  setRegionId: (regionId) => set({ regionId }),

  selectedId: null,
  select: (selectedId) => set({ selectedId }),

  focusPair: null,
  focusOn: (focusPair) => set({ focusPair }),

  cameraTarget: null,
  flyToTarget: (cameraTarget) => set({ cameraTarget }),

  pendingView: null,
  applyView: (pendingView) => set({ pendingView }),

  activeLayers: [],
  toggleLayer: (slug) =>
    set((state) => ({
      activeLayers: state.activeLayers.includes(slug)
        ? state.activeLayers.filter((entry) => entry !== slug)
        : [...state.activeLayers, slug],
    })),
  setLayers: (activeLayers) => set({ activeLayers }),
  clearLayers: () => set({ activeLayers: [] }),
}))
