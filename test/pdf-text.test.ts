import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { extractPdfText, extractWithStats } from '../scripts/lib/pdf-text.js'

// Builds a PDF from numbered object bodies. Object 1 must be the catalog.
function pdfFrom(objects: Array<[number, string]>): Buffer {
  const body = objects.map(([num, text]) => `${num} 0 obj\n${text}\nendobj\n`).join('')
  return Buffer.from(`%PDF-1.4\n${body}trailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1')
}

function stream(dict: string, data: string): string {
  return `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`
}

// One page whose content stream is `content` and whose fonts are `fonts`.
function onePagePdf(content: string, fonts: string, extra: Array<[number, string]> = []): Buffer {
  return pdfFrom([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, `<< /Type /Page /Parent 2 0 R /Resources << /Font ${fonts} >> /Contents 4 0 R >>`],
    [4, stream('', content)],
    ...extra,
  ])
}

describe('extractPdfText', () => {
  const text = extractPdfText(readFileSync('test/fixtures/menu-54mint.pdf'))

  it('recovers dish names despite the per-glyph letter spacing', () => {
    const squashed = text.replace(/\s+/g, '').toUpperCase()
    expect(squashed).toContain('SALTIMBOCCA')
    expect(squashed).toContain('PANNACOTTA')
  })

  it('recovers the price tiers printed on the menu', () => {
    const squashed = text.replace(/\s+/g, '').toUpperCase()
    expect(squashed).toContain('LUNCHMENU$45')
    expect(squashed).toContain('DINNERMENU$75')
  })

  it('collapses whitespace runs to single spaces', () => {
    expect(text).not.toMatch(/\s{2,}/)
  })

  it('returns an empty string for a buffer with no pages', () => {
    expect(extractPdfText(Buffer.from('%PDF-1.3 not really a pdf'))).toBe('')
  })

  it('skips a page whose content stream fails to inflate and counts the skip', () => {
    const pdf = pdfFrom([
      [1, '<< /Type /Catalog /Pages 2 0 R >>'],
      [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
      [3, '<< /Type /Page /Parent 2 0 R /Resources << >> /Contents 4 0 R >>'],
      [4, '<< /Length 17 /Filter /FlateDecode >>\nstream\nnot-deflate-data\nendstream'],
    ])
    expect(() => extractPdfText(pdf)).not.toThrow()
    const stats = extractWithStats(pdf)
    expect(stats.text).toBe('')
    expect(stats.skippedStreams).toBe(1)
    expect(stats.pagesWithoutText).toBe(1)
  })

  it('reads a glyph through /Differences when the font has no ToUnicode', () => {
    const pdf = onePagePdf('BT /F1 12 Tf (A) Tj ET', '<< /F1 5 0 R >>', [
      [5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Differences [65 /fi] >> >>'],
    ])
    expect(extractPdfText(pdf)).toBe('fi')
  })

  it('switches font per Tf, so the same code decodes differently on each run', () => {
    const pdf = onePagePdf('BT /F1 12 Tf (A) Tj /F2 12 Tf (A) Tj ET', '<< /F1 5 0 R /F2 6 0 R >>', [
      [5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Differences [65 /fi] >> >>'],
      [6, '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>'],
    ])
    expect(extractPdfText(pdf)).toBe('fi A')
  })

  it('keeps an unmapped glyph as U+FFFD and counts it as dropped', () => {
    const pdf = onePagePdf('BT /F1 12 Tf (A\\001B) Tj ET', '<< /F1 5 0 R >>', [
      [5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],
    ])
    const stats = extractWithStats(pdf)
    expect(stats.text).toBe('A�B')
    expect(stats.dropped).toBe(1)
    expect(stats.glyphs).toBe(3)
  })

  it('counts a page once when its Kids array lists it twice', () => {
    const pdf = pdfFrom([
      [1, '<< /Type /Catalog /Pages 2 0 R >>'],
      [2, '<< /Type /Pages /Kids [3 0 R 3 0 R] /Count 2 >>'],
      [3, '<< /Type /Page /Parent 2 0 R /Resources << >> /Contents 4 0 R >>'],
      [4, stream('', 'BT ET')],
    ])
    expect(extractWithStats(pdf).pageCount).toBe(1)
  })

  it('records a page tree deeper than the depth cap as skipped, not silently dropped', () => {
    const depth = 40
    const objects: Array<[number, string]> = [[1, '<< /Type /Catalog /Pages 2 0 R >>']]
    for (let i = 0; i < depth; i++) objects.push([2 + i, `<< /Type /Pages /Kids [${3 + i} 0 R] /Count 1 >>`])
    objects.push([2 + depth, '<< /Type /Page /Resources << >> >>'])
    const stats = extractWithStats(pdfFrom(objects))
    expect(stats.pageCount).toBe(0)
    expect(stats.unreachableNodes).toBeGreaterThan(0)
  })
})
