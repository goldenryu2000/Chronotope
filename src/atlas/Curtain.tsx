import './Curtain.css'

interface Props {
  /**
   * True once the atlas behind it is ready. The curtain then fades rather than
   * vanishing, so the map is revealed instead of appearing.
   */
  done?: boolean
}

/**
 * What stands between the landing page and the map.
 *
 * Opening an atlas is not instant and cannot be: the route renders on the
 * server, then the browser fetches two artifacts, then MapLibre fetches the
 * tiles for wherever the camera starts. Without this, that is a bare page,
 * then a page with an empty timeline, then borders — three states, none of
 * which say "this is coming".
 *
 * Deliberately markup and CSS only, no state and no client directive, because
 * its first user is `loading.tsx`: a route-level fallback that renders before
 * any of this route's JavaScript exists has to be something the server can
 * hand over whole. `Atlas` mounts the same component and drives `done`.
 *
 * The moving part is a hairline with a travelling segment — the timeline being
 * scrubbed, which is the one gesture this whole site is about.
 */
export default function Curtain({ done = false }: Props) {
  return (
    // Hidden from assistive tech once lifted: a faded status still read out
    // "Opening the atlas" over a map that had long since opened.
    <div className="curtain" data-done={done} role="status" aria-live="polite" aria-hidden={done || undefined}>
      <div className="curtain__inner">
        <p className="curtain__title">Chronotope</p>
        <div className="curtain__track" aria-hidden="true">
          <span className="curtain__runner" />
        </div>
        <p className="curtain__caption">Opening the atlas</p>
      </div>
    </div>
  )
}
