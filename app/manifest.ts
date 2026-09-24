import type { MetadataRoute } from 'next'

/**
 * Enough for a saved shortcut to look like the site. The colours are the
 * rustic theme's paper, the default a first visitor sees.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Chronotope',
    short_name: 'Chronotope',
    description: 'A historical atlas that redraws the map to match the year.',
    start_url: '/',
    display: 'browser',
    background_color: '#faf4e6',
    theme_color: '#faf4e6',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
