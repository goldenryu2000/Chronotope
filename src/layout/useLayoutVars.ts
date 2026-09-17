'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Writes where the fixed chrome ends as CSS variables on the atlas root.
 *
 * The columns hang between the chrome and the dock, and the dock's height is
 * not a constant: the timeline expands upward, the empty state appears above
 * it. Measuring once per resize, instead of every overlay guessing the others'
 * heights in rem, is what keeps the columns from growing into the dock.
 *
 * - `--chrome-bottom`: the lowest edge of the top-corner controls.
 * - `--top-inset`: the lowest edge of anything in the top bar, title included.
 * - `--dock-inset`: the distance from the dock's top edge to the bottom of the screen.
 */
export function useLayoutVars(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = root.current
    if (!element) return

    let frame = 0
    const write = () => {
      frame = 0
      const tops = [...element.querySelectorAll('[data-layout="top"]')]
      const corners = tops.filter((node) => node.getAttribute('data-layout-corner') !== null)
      const lowest = (nodes: Element[]) =>
        Math.max(0, ...nodes.map((node) => node.getBoundingClientRect().bottom))

      const dockChildren = [...element.querySelectorAll('[data-layout="bottom"] > *')]
        .map((node) => node.getBoundingClientRect())
        .filter((r) => r.height > 0)
      const dockTop = dockChildren.length
        ? Math.min(...dockChildren.map((r) => r.top))
        : window.innerHeight

      element.style.setProperty('--chrome-bottom', `${Math.round(lowest(corners))}px`)
      element.style.setProperty('--top-inset', `${Math.round(lowest(tops))}px`)
      element.style.setProperty('--dock-inset', `${Math.round(window.innerHeight - dockTop)}px`)
    }
    // Coalesced to a frame: an expanding timeline reports several sizes in a
    // row, and each write restyles both columns.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(write)
    }

    const observer = new ResizeObserver(schedule)
    const watch = () => {
      observer.disconnect()
      for (const node of element.querySelectorAll('[data-layout="top"], [data-layout="bottom"], [data-layout="bottom"] > *')) {
        observer.observe(node)
      }
    }
    watch()
    write()

    // The dock's children come and go (the empty state, a late timeline), and
    // a ResizeObserver only reports on nodes it was given.
    const mutations = new MutationObserver(() => {
      watch()
      schedule()
    })
    for (const node of element.querySelectorAll('[data-layout="bottom"], [data-layout="top"]')) {
      mutations.observe(node, { childList: true })
    }
    window.addEventListener('resize', schedule)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [root])
}
