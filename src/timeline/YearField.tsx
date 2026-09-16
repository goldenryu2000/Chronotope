'use client'

import { useEffect, useRef, useState } from 'react'
import { formatYear, parseYear } from '../lib/year'

interface Props {
  year: number
  /** A parsed year. The caller clamps it to the scale. */
  onCommit: (year: number) => void
  /** Editing counts as using the timeline, so it stays expanded. */
  onEdit: () => void
}

/**
 * The year readout, which turns into a text field when clicked.
 *
 * Typing is the only way to land on an exact year in one step, whatever the
 * scale, so the readout itself is the control: no separate "go to" box to find.
 * Enter commits, Escape cancels, and leaving the field keeps a valid year and
 * quietly drops an invalid one.
 */
export default function YearField({ year, onCommit, onEdit }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const editing = draft !== null

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  const stop = () => {
    setDraft(null)
    setInvalid(false)
  }

  const commit = (text: string) => {
    const parsed = parseYear(text)
    if (parsed === null) return false
    onCommit(parsed)
    stop()
    return true
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="timeline__year"
        title="Type a year"
        aria-label={`${formatYear(year)}. Type a year to go there`}
        onClick={() => {
          setDraft(formatYear(year))
          onEdit()
        }}
      >
        <output data-testid="year-readout">{formatYear(year)}</output>
      </button>
    )
  }

  return (
    <span className="timeline__year-edit">
      <input
        ref={input}
        className="timeline__year-input"
        data-testid="year-input"
        aria-label="Go to year"
        aria-invalid={invalid}
        placeholder="1492 or 350 BCE"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setInvalid(false)
          onEdit()
        }}
        onKeyDown={(event) => {
          // The tracks' arrow and bracket keys must not fire while typing.
          event.stopPropagation()
          if (event.key === 'Enter') {
            event.preventDefault()
            if (!commit(draft)) setInvalid(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            stop()
          }
        }}
        onBlur={() => {
          if (!commit(draft)) stop()
        }}
      />
      {invalid && (
        <span className="timeline__year-hint" role="alert">
          Try 1492 or 350 BCE
        </span>
      )}
    </span>
  )
}
