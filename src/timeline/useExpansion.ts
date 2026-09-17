'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** How long the timeline stays expanded after the last interaction. */
export const IDLE_MS = 3000

/**
 * Whether focus arrived the way a keyboard user's does.
 *
 * A mouse click on a track focuses it too, and counting that would hold the
 * timeline open until the reader clicked somewhere else, which for a mouse
 * user is never. `:focus-visible` is the browser's own answer to "was this
 * keyboard-like"; environments that cannot evaluate it are treated as mouse.
 */
function isKeyboardFocus(element: EventTarget | null): boolean {
  if (!(element instanceof Element)) return false
  try {
    return element.matches(':focus-visible')
  } catch {
    return false
  }
}

/**
 * The compact timeline expands while it is being used and folds back once it
 * is left alone.
 *
 * An interaction (a press on a track, typing a year, a landmark jump) opens it
 * and restarts the idle clock. The pointer resting over it, or keyboard focus
 * inside it, holds it open past the clock. Opening it with the expand button
 * pins it open until the reader collapses it.
 */
export function useExpansion(idleMs = IDLE_MS) {
  const [active, setActive] = useState(false)
  const [pinned, setPinned] = useState(false)
  const pointerInside = useRef(false)
  const keyboardInside = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    const check = () => {
      if (pointerInside.current || keyboardInside.current) {
        timer.current = setTimeout(check, idleMs)
        return
      }
      timer.current = null
      setActive(false)
    }
    timer.current = setTimeout(check, idleMs)
  }, [idleMs])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const touch = useCallback(() => {
    setActive(true)
    schedule()
  }, [schedule])

  /**
   * Restart the idle clock if the timeline is open because of an interaction,
   * without opening it. For small actions (a one-year step, an era pick) that
   * should not unfold the precise controls but should not fold them away
   * mid-use either.
   */
  const keepAlive = useCallback(() => {
    if (timer.current) schedule()
  }, [schedule])

  /**
   * The expand/collapse button. It always does what its icon says: collapse
   * whenever the timeline is expanded, however it got that way, and expand
   * (and stay expanded) when it is not.
   *
   * Collapsing used to clear only the pin while leaving the interaction flag
   * set, so the timeline stayed open under the pointer that had just clicked
   * collapse. Both flags and the idle clock are cleared here, at once.
   */
  const toggle = useCallback(() => {
    if (active || pinned) {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      setPinned(false)
      setActive(false)
    } else {
      setPinned(true)
      setActive(true)
    }
  }, [active, pinned])

  const handlers = {
    onPointerEnter: () => {
      pointerInside.current = true
    },
    onPointerLeave: () => {
      pointerInside.current = false
    },
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      if (!isKeyboardFocus(event.target)) return
      keyboardInside.current = true
      touch()
    },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      keyboardInside.current = false
    },
  }

  return { expanded: active || pinned, touch, keepAlive, toggle, handlers }
}
