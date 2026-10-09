export const MEALS = ['Brunch', 'Lunch', 'Dinner'] as const

export type Meal = (typeof MEALS)[number]

export interface Offer {
  meal: Meal
  price: number
}

export interface Restaurant {
  slug: string
  name: string
  neighborhood: string
  cuisine: string
  diningOptions: string[]
  offers: Offer[]
  menuId: string | null
  openTableUrl: string | null
  websiteUrl: string | null
}
