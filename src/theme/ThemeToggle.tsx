'use client'

import { useSyncExternalStore } from 'react'
import { applyTheme, DEFAULT_THEME, isThemeId, THEMES, type ThemeId } from './themes'
import './ThemeToggle.css'

interface Props {
  /**
   * Told when the reader picks one, for anything that cannot follow CSS on its
   * own. The map is the case: MapLibre holds its colours as parsed style
   * values, so it has to be restyled imperatively.
   */
  onChange?: (theme: ThemeId) => void
}

/**
 * The theme switch, shared by the landing page and the atlas.
 *
 * It holds no state. `<html data-theme>` is already the one true answer: the
 * bootstrap script in the root layout sets it before first paint and
 * `applyTheme` maintains it, so this subscribes to that attribute instead of
 * keeping a copy that would be a second thing to hold in step. Anything else
 * that changes the theme, such as the Atlas applying a region's default when
 * its artifact lands, moves these dots without being told to.
 *
 * The server snapshot is the default, which is exactly what the server
 * rendered into `<html>`, so hydration has nothing to disagree about.
 */
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  return () => observer.disconnect()
}

const readTheme = (): string => document.documentElement.dataset.theme ?? DEFAULT_THEME
export default function ThemeToggle({ onChange }: Props) {
  const current = useSyncExternalStore(subscribe, readTheme, () => DEFAULT_THEME)
  const theme: ThemeId = isThemeId(current) ? current : DEFAULT_THEME

  const change = (next: ThemeId) => {
    applyTheme(next)
    onChange?.(next)
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={() => change(theme === 'slate' ? 'rustic' : 'slate')}
      aria-label={`Switch theme (currently ${theme})`}
    >
      {THEMES.map((id) => (
        <span
          key={id}
          className="theme-toggle__dot"
          data-active={id === theme}
          data-theme-id={id}
        />
      ))}
    </button>
  )
}
