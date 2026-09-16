import './register.css'

export const THEMES = ['slate', 'rustic'] as const

export type ThemeId = (typeof THEMES)[number]

/**
 * What a reader who has never chosen sees.
 *
 * Rustic, which is what `rustic.css` has always called itself and what every
 * page that hardcoded a theme picked. This constant said `slate`, but nothing
 * observed it: its only use is `loadTheme`'s default parameter and every
 * caller passed a fallback of its own. Now that the root layout renders it
 * into `<html>`, it decides the first paint, so it has to agree with the rest.
 */
export const DEFAULT_THEME: ThemeId = 'rustic'

const STORAGE_KEY = 'chronotope:theme'

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

/**
 * The theme the user last chose, falling back to the region's own.
 *
 * A region declares a `theme` in its artifact; an explicit choice by the
 * reader outranks it, which is why the stored value is consulted first.
 */
export function loadTheme(fallback: ThemeId = DEFAULT_THEME): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isThemeId(stored)) return stored
  } catch {
    // Private browsing or blocked storage — the default is fine.
  }
  return fallback
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Persistence is a nicety, not a requirement.
  }
}

/**
 * Read a theme token off the document root.
 *
 * This is the one sanctioned bridge between CSS themes and imperative code
 * (notably the MapLibre style). Map layers must source every colour through
 * here so that a theme swap restyles the map and not just the DOM.
 */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
