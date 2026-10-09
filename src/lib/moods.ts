export const MOOD_TAGS = [
  'date-night',
  'big-group',
  'solo-friendly',
  'business-dinner',
  'celebration',
  'comfort-food',
  'light-and-fresh',
  'adventurous',
  'vegetarian-friendly',
  'pre-theater',
] as const

export type MoodTag = (typeof MOOD_TAGS)[number]

export const MOOD_LABELS: Record<MoodTag, string> = {
  'date-night': 'Date night',
  'big-group': 'Big group',
  'solo-friendly': 'Solo friendly',
  'business-dinner': 'Business dinner',
  celebration: 'Celebration',
  'comfort-food': 'Comfort food',
  'light-and-fresh': 'Light and fresh',
  adventurous: 'Adventurous',
  'vegetarian-friendly': 'Vegetarian friendly',
  'pre-theater': 'Pre-theater',
}
