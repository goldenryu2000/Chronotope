/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ImageCredit from './ImageCredit'

afterEach(cleanup)

const source = 'https://commons.wikimedia.org/wiki/File:Statue_of_Yi_Hwang.jpg'

describe('ImageCredit', () => {
  it('links the author to the file page and the licence to its deed', () => {
    render(<ImageCredit block="panel" image={{ credit: 'Jane Doe', licence: 'CC BY-SA 4.0', source }} />)
    expect(screen.getByRole('link', { name: 'Jane Doe' })).toHaveProperty('href', source)
    const licence = screen.getByRole('link', { name: 'CC BY-SA 4.0' })
    expect(licence).toHaveProperty('href', 'https://creativecommons.org/licenses/by-sa/4.0/')
    expect(licence.getAttribute('rel')).toContain('license')
  })

  it('names public domain without inventing a link', () => {
    render(<ImageCredit block="entity" image={{ credit: 'Unknown author', licence: 'Public domain', source }} />)
    expect(screen.queryByRole('link', { name: 'Public domain' })).toBeNull()
    expect(screen.getByText('Public domain').className).toBe('entity__licence')
  })

  it('opens links in a new tab without handing that tab a reference back', () => {
    render(<ImageCredit block="panel" image={{ credit: 'Jane Doe', licence: 'CC BY 4.0', source }} />)
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
    }
  })
})
