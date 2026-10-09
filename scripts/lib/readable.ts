const MIN_ALPHA_RATIO = 0.5
// Short menus carry few menu words, so the bar is low. Shifted-letter garbage
// matches none of the words below, so a low bar still rejects it.
const MIN_DISTINCT_WORDS = 3

// Four or more letters each. Shorter words such as "and" occur by chance in
// shifted-letter garbage, which would let it pass. The English list covers
// menu headers and dishes. The other entries cover the languages of menus in
// this dataset: Japanese, Italian, and Spanish.
const MENU_WORDS = [
  'menu', 'with', 'served', 'course', 'choice', 'dinner', 'lunch', 'sauce',
  'cheese', 'chicken', 'salad', 'pasta', 'wine', 'butter', 'dessert', 'fish',
  'beef', 'pork', 'rice', 'soup', 'bread', 'cream', 'fresh', 'roasted',
  'grilled', 'seasonal', 'optional', 'gratuity', 'prix', 'fixe', 'shared',
  'chocolate', 'vanilla', 'salmon', 'mushroom', 'potato', 'tomato', 'lamb',
  'duck', 'starter', 'entree', 'appetizer', 'sushi', 'omakase', 'nigiri',
  'sashimi', 'tasting', 'antipasti', 'primi', 'secondi', 'dolce', 'postre',
  'tapas', 'mezze',
]

// Menu PDFs position each glyph separately, so letters are spaced apart.
// Matching against the whitespace-free form finds words in that text.
export function isReadableMenuText(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  if (compact.length === 0) return false

  const letters = compact.match(/\p{L}/gu)?.length ?? 0
  if (letters / compact.length < MIN_ALPHA_RATIO) return false

  const lower = compact.toLowerCase()
  const found = MENU_WORDS.filter((word) => lower.includes(word))
  return found.length >= MIN_DISTINCT_WORDS
}
