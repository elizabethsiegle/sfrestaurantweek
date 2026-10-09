import type { Meal } from './types.js'

export const MIN_TIER_SAMPLE = 5

export interface ScoredOffer {
  meal: Meal
  price: number
  courses: number | null
}

export interface TierStat {
  meal: Meal
  price: number
  medianCourses: number | null
  sampleSize: number
}

export function median(ns: number[]): number {
  const sorted = [...ns].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export function tierKey(meal: Meal, price: number): string {
  return `${meal}:${price}`
}

export function buildTierStats(offers: ScoredOffer[]): Map<string, TierStat> {
  const buckets = new Map<string, { meal: Meal; price: number; courses: number[] }>()

  for (const o of offers) {
    const key = tierKey(o.meal, o.price)
    const bucket = buckets.get(key) ?? { meal: o.meal, price: o.price, courses: [] }
    if (o.courses !== null) bucket.courses.push(o.courses)
    buckets.set(key, bucket)
  }

  const stats = new Map<string, TierStat>()
  for (const [key, b] of buckets) {
    stats.set(key, {
      meal: b.meal,
      price: b.price,
      sampleSize: b.courses.length,
      medianCourses: b.courses.length >= MIN_TIER_SAMPLE ? median(b.courses) : null,
    })
  }
  return stats
}

export function dealDelta(courses: number | null, stat: TierStat | undefined): number | null {
  if (courses === null || !stat || stat.medianCourses === null) return null
  return courses - stat.medianCourses
}
