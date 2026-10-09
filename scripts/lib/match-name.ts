const FILLER = /\b(the|restaurant|sf|san francisco|cafe|bar|grill|kitchen)\b/g
const COMBINING_MARKS = /[̀-ͯ]/g

export function matchKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(FILLER, '')
    .replace(/[^a-z0-9]/g, '')
}
