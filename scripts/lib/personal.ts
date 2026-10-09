import type { Verification } from './match-guard.js'

export interface Visit {
  date: string
  rating: number
  text: string
}

export interface PersonalEntry {
  rating: number | null
  yelpUrl: string | null
  verification: Verification
  visits: Visit[]
}

export type PersonalLayer = Record<string, PersonalEntry>
