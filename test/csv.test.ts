import { describe, expect, it } from 'vitest'
import { csvRow } from '../scripts/lib/csv.js'

describe('csvRow', () => {
  it('doubles embedded double quotes', () => {
    expect(csvRow(['say "hi"'])).toBe('"say ""hi"""')
  })

  it('keeps a comma inside one quoted cell', () => {
    expect(csvRow(['Cafe, Bar', 'Mission'])).toBe('"Cafe, Bar","Mission"')
  })

  it('replaces line breaks so each row stays on one line', () => {
    const row = csvRow(['line one\nline two\r\nline three'])
    expect(row).toBe('"line one line two line three"')
    expect(row).not.toMatch(/\r|\n/)
  })
})
