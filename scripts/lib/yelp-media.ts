// The Yelp data export ships photos as an HTML table plus a media directory. Each
// row names the business in free text, so photos are matched to a restaurant the
// same way reviews are, through matchKey.
export interface ExportPhoto {
  business: string
  file: string
  caption: string
  date: string
}

const ROW = /<tr>[\s\S]*?<\/tr>/g
const CELL = /<td>([\s\S]*?)<\/td>/g
const MEDIA_HREF = /href="\.\.\/media\/([^"]+)"/

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

// Only photos Yelp still displays are returned. A removed photo is withheld
// everywhere else on the site, so it must not reappear here.
export function parseBizPhotos(html: string): ExportPhoto[] {
  const out: ExportPhoto[] = []
  for (const row of html.match(ROW) ?? []) {
    const cells = [...row.matchAll(CELL)].map((m) => m[1]!)
    if (cells.length < 5) continue
    if (text(cells[4]!) !== 'Displayed') continue
    const file = MEDIA_HREF.exec(cells[2]!)?.[1]
    if (!file) continue
    out.push({
      business: text(cells[1]!),
      file,
      caption: text(cells[3]!),
      date: text(cells[0]!),
    })
  }
  return out
}
