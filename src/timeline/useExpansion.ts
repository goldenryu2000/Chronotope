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
 * inside it, holds it open past the clock. `pinned` holds it open regardless,
 * for a reader who wants the precise controls all the time.
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

  const togglePinned = useCallback(() => {
    // Unpinning starts the idle clock rather than snapping shut under the
    // pointer that just clicked.
    if (pinned) schedule()
    setPinned(!pinned)
    setActive(true)
  }, [pinned, schedule])

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

  return { expanded: active || pinned, pinned, touch, togglePinned, handlers }
}
