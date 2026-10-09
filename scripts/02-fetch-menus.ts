import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Restaurant } from '../src/lib/types.js'
import { assertDecodable, extractWithStats } from './lib/pdf-text.js'
import { isReadableMenuText } from './lib/readable.js'
import { parseMenuIdFromViewer, printUrl, viewerUrl } from './lib/menumodo.js'
import { csvRow } from './lib/csv.js'

const DELAY_MS = 400
const UA = { 'User-Agent': 'Mozilla/5.0' }
const CACHE_DIR = 'data/pdf'
const CACHED_PDF = /^(\d+)-(\d+)\.pdf$/

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const restaurants: Restaurant[] = JSON.parse(readFileSync('data/01-restaurants.json', 'utf8'))

// Pod ids are not one to one with restaurants: Delarosa Marina and Delarosa
// Yerba Buena share pod 13371. Fetch each distinct pod once.
const podIds = [...new Set(restaurants.map((r) => r.menuId).filter((id): id is string => id !== null))]

// Cached PDFs are named <podId>-<menuId>.pdf. Re-running the decoder reads them
// from disk, so menumodo is only contacted for pods without a cache entry.
mkdirSync(CACHE_DIR, { recursive: true })
const cached = new Map<string, { menuId: string; file: string }>()
for (const name of readdirSync(CACHE_DIR)) {
  const m = CACHED_PDF.exec(name)
  if (m) cached.set(m[1]!, { menuId: m[2]!, file: `${CACHE_DIR}/${name}` })
}

async function loadPdf(podId: string): Promise<{ menuId: string; pdf: Buffer }> {
  const hit = cached.get(podId)
  if (hit) return { menuId: hit.menuId, pdf: readFileSync(hit.file) }

  const viewer = await fetch(viewerUrl(podId), { headers: UA })
  if (!viewer.ok) throw new Error(`viewer ${viewer.status}`)
  const menuId = parseMenuIdFromViewer(await viewer.text())
  if (!menuId) throw new Error('no menu_id in viewer config')

  await sleep(DELAY_MS)

  const response = await fetch(printUrl(menuId), { headers: UA })
  if (!response.ok) throw new Error(`print ${response.status}`)
  const pdf = Buffer.from(await response.arrayBuffer())
  writeFileSync(`${CACHE_DIR}/${podId}-${menuId}.pdf`, pdf)
  await sleep(DELAY_MS)
  return { menuId, pdf }
}

interface Skipped {
  pages: number
  streams: number
  ranges: number
  nodes: number
}

const menus: Record<string, { menuId: string; text: string; skipped: Skipped }> = {}
const errors: string[] = [csvRow(['podId', 'reason'])]

for (const podId of podIds) {
  try {
    const { menuId, pdf } = await loadPdf(podId)

    const stats = extractWithStats(pdf)
    assertDecodable(stats)
    if (!stats.text) throw new Error('pdf yielded no text')
    if (!isReadableMenuText(stats.text)) throw new Error('pdf text not decodable')

    const skipped: Skipped = {
      pages: stats.pagesWithoutText,
      streams: stats.skippedStreams,
      ranges: stats.skippedRanges,
      nodes: stats.unreachableNodes,
    }
    menus[podId] = { menuId, text: stats.text, skipped }

    const notes: string[] = []
    if (skipped.pages > 0) notes.push(`${skipped.pages} page(s) without text`)
    if (skipped.streams > 0) notes.push(`${skipped.streams} stream(s) skipped`)
    if (skipped.ranges > 0) notes.push(`${skipped.ranges} ToUnicode range(s) skipped`)
    if (skipped.nodes > 0) notes.push(`${skipped.nodes} page-tree node(s) beyond depth limit`)
    if (notes.length > 0) errors.push(csvRow([podId, `accepted, ${notes.join(', ')}`]))
  } catch (err) {
    errors.push(csvRow([podId, (err as Error).message]))
    console.warn(`pod ${podId}: ${(err as Error).message}`)
  }
}

writeFileSync('data/02-menus.json', JSON.stringify(menus, null, 1))
writeFileSync('data/02-menus.errors.csv', errors.join('\n') + '\n')
const failed = errors.filter((line) => !line.includes('accepted,')).length - 1
console.log(`fetched ${Object.keys(menus).length} of ${podIds.length} menus, ${failed} failed`)
