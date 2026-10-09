import { buildFont } from './pdf-fonts.js'
import type { Font } from './pdf-fonts.js'
import { Lexer, PdfDocument, PdfName, readValue } from './pdf-objects.js'
import type { PdfDict, PdfValue, Token } from './pdf-objects.js'

const UNDECODABLE = 'pdf text not decodable'
// Unmapped glyphs stay visible as U+FFFD. A deleted glyph would silently change
// a word (fish to sh), and that word could later be quoted as evidence.
const REPLACEMENT_CHARACTER = '\uFFFD'
// Decorative symbol fonts can leave a few ornament glyphs unmapped. Above this
// share of unmapped glyphs, the dropped text is too large to ignore.
const MAX_DROPPED_SHARE = 0.05
const MAX_FORM_DEPTH = 4
// Depth alone does not bound form work, since a form can call several others.
// The budget is in content bytes, not calls: a form reused for every dish must not be cut off.
const MAX_FORM_BYTES = 32 * 1024 * 1024
const MAX_PAGE_DEPTH = 32
const LITERAL_KEYWORDS = new Set(['true', 'false', 'null'])

export interface ExtractionStats {
  text: string
  glyphs: number
  dropped: number
  pageCount: number
  pagesWithoutText: number
  skippedStreams: number
  unreachableNodes: number
  skippedRanges: number
}

interface Page {
  node: PdfDict
  resources: PdfDict | null
}

interface RunStats {
  glyphs: number
  dropped: number
  formBytes: number
  skippedForms: number
  skippedRanges: number
}

// Menu PDFs position each glyph individually, so the extracted text carries
// spaces inside words. Callers compare against whitespace-stripped forms.
export function extractPdfText(pdf: Buffer): string {
  const stats = extractWithStats(pdf)
  assertDecodable(stats)
  return stats.text
}

export function assertDecodable(stats: Pick<ExtractionStats, 'glyphs' | 'dropped'>): void {
  if (stats.glyphs > 0 && stats.dropped / stats.glyphs > MAX_DROPPED_SHARE) throw new Error(UNDECODABLE)
}

export function extractWithStats(pdf: Buffer): ExtractionStats {
  const doc = new PdfDocument(pdf)
  const stats: RunStats = { glyphs: 0, dropped: 0, formBytes: 0, skippedForms: 0, skippedRanges: 0 }
  const pieces: string[] = []
  const { pages, unreachableNodes } = pagesOf(doc)
  let pagesWithoutText = 0
  for (const page of pages) {
    const before = stats.glyphs
    runContent(doc, pageContent(doc, page.node.get('Contents') ?? null), page.resources, pieces, stats, 0)
    if (stats.glyphs === before) pagesWithoutText += 1
  }
  return {
    text: pieces.join(' ').replace(/\s+/g, ' ').trim(),
    glyphs: stats.glyphs,
    dropped: stats.dropped,
    pageCount: pages.length,
    pagesWithoutText,
    skippedStreams: doc.skippedStreams + stats.skippedForms,
    unreachableNodes,
    skippedRanges: stats.skippedRanges,
  }
}

function pagesOf(doc: PdfDocument): { pages: Page[]; unreachableNodes: number } {
  const pages: Page[] = []
  let unreachableNodes = 0
  // Without this, a Kids array that repeats a node multiplies the walk at each level.
  const seen = new Set<PdfDict>()
  const walk = (value: PdfValue, inherited: PdfDict | null, depth: number): void => {
    const node = doc.dict(value)
    if (!node || seen.has(node)) return
    if (depth > MAX_PAGE_DEPTH) {
      unreachableNodes += 1
      return
    }
    seen.add(node)
    const resources = doc.dict(node.get('Resources') ?? null) ?? inherited
    if (doc.name(node.get('Type') ?? null) === 'Page') {
      pages.push({ node, resources })
      return
    }
    const kids = doc.resolve(node.get('Kids') ?? null)
    if (Array.isArray(kids)) for (const kid of kids) walk(kid, resources, depth + 1)
  }
  walk(doc.root()?.get('Pages') ?? null, null, 0)
  return { pages, unreachableNodes }
}

function pageContent(doc: PdfDocument, contents: PdfValue): string {
  const resolved = doc.resolve(contents)
  const parts = Array.isArray(resolved) ? resolved : [contents]
  return parts.map((part) => doc.streamBytes(part)?.toString('latin1') ?? '').join('\n')
}

function resourceMap(doc: PdfDocument, resources: PdfDict | null, key: string): PdfDict {
  return (resources && doc.dict(resources.get(key) ?? null)) || new Map()
}

function runContent(
  doc: PdfDocument,
  content: string,
  resources: PdfDict | null,
  out: string[],
  stats: RunStats,
  depth: number,
): void {
  const fonts = resourceMap(doc, resources, 'Font')
  const xobjects = resourceMap(doc, resources, 'XObject')
  const fontCache = new Map<string, Font | null>()
  let current: Font | null = null

  const fontNamed = (name: string): Font | null => {
    if (!fontCache.has(name)) {
      const value = fonts.get(name)
      fontCache.set(name, value === undefined ? null : buildFont(doc, value, stats))
    }
    return fontCache.get(name) ?? null
  }

  const show = (bytes: string): void => {
    const glyphs = current ? current.decodeCodes(bytes) : Array.from(bytes, () => null)
    let run = ''
    for (const glyph of glyphs) {
      stats.glyphs += 1
      if (glyph === null) {
        stats.dropped += 1
        run += REPLACEMENT_CHARACTER
      } else {
        run += glyph
      }
    }
    if (run) out.push(run)
  }

  const showForm = (name: string): void => {
    const form = xobjects.get(name)
    if (form === undefined || doc.name(doc.dict(form)?.get('Subtype') ?? null) !== 'Form') return
    const body = doc.streamBytes(form)
    if (body === null) return
    if (depth >= MAX_FORM_DEPTH || stats.formBytes + body.length > MAX_FORM_BYTES) {
      stats.skippedForms += 1
      return
    }
    stats.formBytes += body.length
    const formResources = doc.dict(doc.dict(form)?.get('Resources') ?? null) ?? resources
    runContent(doc, body.toString('latin1'), formResources, out, stats, depth + 1)
  }

  // Only strings shown by a text operator are text. Font and image bytes are
  // never shown, so they cannot leak into the output (one menu grew to 2.1
  // million characters when every parenthesised string was read).
  const apply = (op: string, operands: PdfValue[]): void => {
    const last = operands[operands.length - 1]
    switch (op) {
      case 'Tf': {
        const name = operands[0]
        current = name instanceof PdfName ? fontNamed(name.value) : null
        break
      }
      case 'Tj':
      case "'":
      case '"':
        if (typeof last === 'string') show(last)
        break
      case 'TJ':
        if (Array.isArray(last)) {
          for (const item of last) if (typeof item === 'string') show(item)
        }
        break
      case 'Do':
        if (last instanceof PdfName) showForm(last.value)
        break
    }
  }

  const lx = new Lexer(content)
  const operands: PdfValue[] = []
  for (let tok: Token = lx.next(); tok.kind !== 'eof'; tok = lx.next()) {
    if (tok.kind === 'kw' && !LITERAL_KEYWORDS.has(tok.value)) {
      apply(tok.value, operands)
      operands.length = 0
    } else {
      operands.push(readValue(lx, tok))
    }
  }
}
