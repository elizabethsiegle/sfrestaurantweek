import { describe, expect, it } from 'vitest'
import { eventStamp } from '../src/lib/stamp.js'
import { EVENT_END, EVENT_START } from '../scripts/lib/build-entries.js'

describe('eventStamp', () => {
  it('names the month once for an event inside one month', () => {
    expect(eventStamp('2026-10-16', '2026-10-25')).toBe('Oct 16 to 25')
  })

  it('names both months for an event that spans two', () => {
    expect(eventStamp('2026-10-30', '2026-11-02')).toBe('Oct 30 to Nov 2')
  })

  it('reads the month from the dates rather than assuming October', () => {
    expect(eventStamp('2027-03-05', '2027-03-14')).toBe('Mar 5 to 14')
  })

  it('crosses a year end without losing the second month', () => {
    expect(eventStamp('2026-12-28', '2027-01-03')).toBe('Dec 28 to Jan 3')
  })

  it('matches the event the build stamps into meta', () => {
    expect(eventStamp(EVENT_START, EVENT_END)).toBe('Oct 16 to 25')
  })
})
