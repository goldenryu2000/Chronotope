'use client'

import { midSpan, nearestInTime, type ActiveEntity } from '../data/entitySpan'
import { formatYear } from '../lib/year'
import './EmptyState.css'

interface Props {
  entities: readonly ActiveEntity[]
  year: number
  onGoTo: (year: number) => void
}

/**
 * Shown when nobody is on the map.
 *
 * A pack covers a handful of people across thousands of years, so most of the
 * timeline is genuinely empty. A blank world is indistinguishable from a broken
 * one, and it quietly implies nothing was happening — which for this project is
 * exactly the wrong impression. Naming the gap and offering somewhere to go is
 * honest, and it turns a dead end into an invitation.
 *
 * The ported build paired the jump with a "Suggest someone" link to its own
 * GitHub issue template. That link is cut here: this build has no remote and no
 * issue templates, so it would have pointed at a different project.
 */
export default function EmptyState({ entities, year, onGoTo }: Props) {
  const nearest = nearestInTime(entities, year)

  return (
    <div className="empty" role="status">
      <p className="empty__lead">
        No one in this atlas for <strong>{formatYear(year)}</strong> yet.
      </p>

      <p className="empty__actions">
        {nearest && (
          <button type="button" className="empty__jump" onClick={() => onGoTo(midSpan(nearest))}>
            Go to {nearest.name}, {formatYear(midSpan(nearest))}
          </button>
        )}
      </p>
    </div>
  )
}
