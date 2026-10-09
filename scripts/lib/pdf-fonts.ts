import { Lexer, PdfDocument, PdfName } from './pdf-objects.js'
import type { PdfDict, PdfValue, Token } from './pdf-objects.js'

// One entry per glyph code. null means the code has no known text. Callers
// must surface it, not drop it.
export interface Font {
  decodeCodes(bytes: string): Array<string | null>
}

const MAX_BFRANGE_SPAN = 0x10000

interface CodeMap {
  width: number
  map: Map<number, string>
  skippedRanges: number
}

type ByteTable = Array<string | undefined>

function singleByteTable(label: string): ByteTable {
  const decoder = new TextDecoder(label)
  return Array.from({ length: 256 }, (_, code) => (code < 32 ? undefined : decoder.decode(Uint8Array.of(code))))
}

const WIN_ANSI = singleByteTable('windows-1252')
const MAC_ROMAN = singleByteTable('macintosh')
const ASCII: ByteTable = Array.from({ length: 256 }, (_, code) =>
  code >= 32 && code < 127 ? String.fromCharCode(code) : undefined,
)

const GLYPH_NAMES: ReadonlyMap<string, string> = new Map(Object.entries({
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%',
  ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')', asterisk: '*',
  plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/', zero: '0', one: '1',
  two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8',
  nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>',
  question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']',
  asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|',
  braceright: '}', asciitilde: '~', quoteleft: '‘', quoteright: '’',
  quotedblleft: '“', quotedblright: '”', endash: '\u2013', emdash: '\u2014',
  bullet: '•', ellipsis: '…',
  fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl',
  eacute: 'é', egrave: 'è', ecircumflex: 'ê', agrave: 'à', acircumflex: 'â',
  ucircumflex: 'û', uuml: 'ü', ouml: 'ö', ntilde: 'ñ', ccedilla: 'ç',
}))

function glyphChar(name: string): string | undefined {
  if (/^[A-Za-z]$/.test(name)) return name
  const unicode = /^uni([0-9A-Fa-f]{4})$/.exec(name) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(name)
  if (unicode) return String.fromCodePoint(parseInt(unicode[1]!, 16))
  return GLYPH_NAMES.get(name)
}

function tokenize(src: string): Token[] {
  const lx = new Lexer(src)
  const tokens: Token[] = []
  for (let tok = lx.next(); tok.kind !== 'eof'; tok = lx.next()) tokens.push(tok)
  return tokens
}

function isPunct(tok: Token | undefined, value: string): boolean {
  return tok?.kind === 'punct' && tok.value === value
}

function strOf(tok: Token | undefined): string | null {
  return tok?.kind === 'str' ? tok.value : null
}

function bytesToCode(bytes: string): number {
  let code = 0
  for (let i = 0; i < bytes.length; i++) code = code * 256 + bytes.charCodeAt(i)
  return code
}

// UTF-16BE bytes to code units. A trailing odd byte is dropped.
function utf16Units(bytes: string): number[] {
  const units: number[] = []
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    units.push((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1))
  }
  return units
}

function unitsToString(units: number[]): string {
  return String.fromCharCode(...units)
}

// A bfrange with one destination counts up from it. Each code step adds one to
// the last UTF-16 code unit of that destination.
export function parseToUnicode(cmap: string): CodeMap {
  const toks = tokenize(cmap)
  const map = new Map<number, string>()
  let width = 0
  let skippedRanges = 0

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]!
    if (tok.kind !== 'kw') continue

    if (tok.value === 'begincodespacerange') {
      width = strOf(toks[i + 1])?.length ?? width
    } else if (tok.value === 'beginbfchar') {
      for (let j = i + 1; strOf(toks[j]) !== null && strOf(toks[j + 1]) !== null; j += 2) {
        const src = strOf(toks[j])!
        width ||= src.length
        map.set(bytesToCode(src), unitsToString(utf16Units(strOf(toks[j + 1])!)))
      }
    } else if (tok.value === 'beginbfrange') {
      let j = i + 1
      while (strOf(toks[j]) !== null && strOf(toks[j + 1]) !== null) {
        const loBytes = strOf(toks[j])!
        const lo = bytesToCode(loBytes)
        const hi = bytesToCode(strOf(toks[j + 1])!)
        width ||= loBytes.length
        const target = toks[j + 2]
        const single = strOf(target)
        if (single !== null) {
          const units = utf16Units(single)
          // Larger ranges come from a corrupt or hostile file, and would loop billions of times.
          if (hi - lo + 1 <= MAX_BFRANGE_SPAN) {
            for (let code = lo; code <= hi; code++) {
              const shifted = units.slice()
              shifted[shifted.length - 1] = (shifted[shifted.length - 1] ?? 0) + (code - lo)
              map.set(code, unitsToString(shifted))
            }
          } else {
            skippedRanges += 1
          }
          j += 3
        } else if (isPunct(target, '[')) {
          let code = lo
          let k = j + 3
          for (; k < toks.length && !isPunct(toks[k], ']'); k++, code++) {
            const item = strOf(toks[k])
            if (item !== null && code <= hi) map.set(code, unitsToString(utf16Units(item)))
          }
          j = k + 1
        } else {
          break
        }
      }
    }
  }

  return { width: width || 2, map, skippedRanges }
}

function decodeWithCodeMap(bytes: string, codes: CodeMap): Array<string | null> {
  const out: Array<string | null> = []
  for (let i = 0; i < bytes.length; i += codes.width) {
    if (i + codes.width > bytes.length) {
      out.push(null)
      break
    }
    out.push(codes.map.get(bytesToCode(bytes.slice(i, i + codes.width))) ?? null)
  }
  return out
}

// Codes not listed in /Differences fall back to the base encoding. A font
// without a stated base is treated as ASCII, which covers the characters that
// matter in menus under the Standard Encoding.
function simpleEncoding(doc: PdfDocument, value: PdfValue | undefined): (code: number) => string | undefined {
  const resolved = doc.resolve(value ?? null)
  const differences = new Map<number, string>()
  let base: string | null = null

  if (resolved instanceof PdfName) {
    base = resolved.value
  } else if (resolved instanceof Map) {
    base = doc.name(resolved.get('BaseEncoding') ?? null)
    const items = doc.resolve(resolved.get('Differences') ?? null)
    if (Array.isArray(items)) {
      let code = 0
      for (const item of items) {
        if (typeof item === 'number') code = item
        else if (item instanceof PdfName) differences.set(code++, item.value)
      }
    }
  } else {
    return () => undefined
  }

  const baseTable = base === 'WinAnsiEncoding' ? WIN_ANSI : base === 'MacRomanEncoding' ? MAC_ROMAN : ASCII
  return (code) => {
    const name = differences.get(code)
    if (name !== undefined) return glyphChar(name)
    return baseTable?.[code]
  }
}

// A composite (Type0) font decodes only through its ToUnicode map. Without
// one, its glyph ids cannot be turned into text, so buildFont returns null.
export function buildFont(doc: PdfDocument, value: PdfValue, skips: { skippedRanges: number }): Font | null {
  const dict: PdfDict | null = doc.dict(value)
  if (!dict) return null

  const toUnicodeBytes = doc.streamBytes(dict.get('ToUnicode') ?? null)
  const toUnicode = toUnicodeBytes ? parseToUnicode(toUnicodeBytes.toString('latin1')) : null
  if (toUnicode) skips.skippedRanges += toUnicode.skippedRanges

  if (doc.name(dict.get('Subtype') ?? null) === 'Type0') {
    if (!toUnicode) return null
    return { decodeCodes: (bytes) => decodeWithCodeMap(bytes, toUnicode) }
  }

  const encoding = simpleEncoding(doc, dict.get('Encoding'))
  return {
    decodeCodes: (bytes) =>
      Array.from(bytes, (ch) => {
        const code = ch.charCodeAt(0)
        return toUnicode?.map.get(code) ?? encoding(code) ?? null
      }),
  }
}
