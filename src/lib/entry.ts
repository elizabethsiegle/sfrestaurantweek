import type { Meal, Restaurant } from './types.js'
import type { MoodTag } from './moods.js'

export interface Dish {
  name: string
  description: string
}

// One menu document covers every Restaurant Week offer a restaurant makes, so each
// section names the meal it belongs to. null means the document never says.
export interface Course {
  name: string
  meal: Meal | null
  dishes: Dish[]
}

// Shared by the build-time tagger and the browser, so a mood claim has one definition.
export interface MoodClaim {
  tag: MoodTag
  evidence: string
}

export interface EntryOffer {
  meal: Meal
  price: number
  courses: number | null
  dealDelta: number | null
  medianCourses: number | null
}

export interface EntryPhoto {
  src: string
  caption: string
}

export interface Entry extends Omit<Restaurant, 'offers' | 'menuId'> {
  offers: EntryOffer[]
  menuCoverage: 'full' | 'none'
  moods: MoodClaim[]
  blurb: string | null
  vegetarianFriendly: boolean
  lat: number | null
  lng: number | null
  address: string | null
  personal: {
    rating: number | null
    yelpUrl: string | null
    excerpt: string
    text: string
    visitDate: string
    photos: EntryPhoto[]
  } | null
}

export interface Meta {
  eventStart: string
  eventEnd: string
  builtAt: string
  restaurants: number
  withMenus: number
  mapped: number
  personal: number
  neighborhoods: number
  cuisines: number
}
