import { inflateSync } from 'node:zlib'

export class PdfName {
  constructor(readonly value: string) {}
}

export class PdfRef {
  constructor(readonly num: number) {}
}

export type PdfDict = Map<string, PdfValue>
export type PdfValue = number | boolean | null | string | PdfName | PdfRef | PdfValue[] | PdfDict

export type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str' | 'name' | 'kw' | 'punct'; value: string }
  | { kind: 'eof' }

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)/y
const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }
const LITERAL_KEYWORDS = new Set(['true', 'false', 'null'])

function isSpace(c: string): boolean {
  return ' \0\t\n\f\r'.includes(c)
}

function isDelimiter(c: string): boolean {
  return isSpace(c) || '()<>[]{}/%'.includes(c)
}

export class Lexer {
  constructor(
    private readonly src: string,
    public pos = 0,
  ) {}

  next(): Token {
    this.skipSpaceAndComments()
    const { src } = this
    if (this.pos >= src.length) return { kind: 'eof' }

    const c = src[this.pos]!
    if (c === '(') return { kind: 'str', value: this.literal() }
    if (c === '<' && src[this.pos + 1] === '<') {
      this.pos += 2
      return { kind: 'punct', value: '<<' }
    }
    if (c === '<') return { kind: 'str', value: this.hex() }
    if (c === '>' && src[this.pos + 1] === '>') {
      this.pos += 2
      return { kind: 'punct', value: '>>' }
    }
    if (c === '>') {
      this.pos += 1
      return this.next()
    }
    if ('[]{}'.includes(c)) {
      this.pos += 1
      return { kind: 'punct', value: c }
    }
    if (c === '/') return { kind: 'name', value: this.name() }

    NUMBER.lastIndex = this.pos
    const number = NUMBER.exec(src)
    if (number) {
      this.pos += number[0].length
      return { kind: 'num', value: Number(number[0]) }
    }

    const start = this.pos
    while (this.pos < src.length && !isDelimiter(src[this.pos]!)) this.pos += 1
    if (this.pos === start) this.pos += 1
    return { kind: 'kw', value: src.slice(start, this.pos) }
  }

  private skipSpaceAndComments(): void {
    const { src } = this
    while (this.pos < src.length) {
      const c = src[this.pos]!
      if (c === '%') {
        while (this.pos < src.length && src[this.pos] !== '\n' && src[this.pos] !== '\r') this.pos += 1
      } else if (isSpace(c)) {
        this.pos += 1
      } else {
        return
      }
    }
  }

  private literal(): string {
    const { src } = this
    let depth = 1
    let out = ''
    this.pos += 1
    while (this.pos < src.length) {
      const c = src[this.pos++]!
      if (c === '\\') {
        const e = src[this.pos++] ?? ''
        if (/[0-7]/.test(e)) {
          let octal = e
          while (octal.length < 3 && /[0-7]/.test(src[this.pos] ?? '')) octal += src[this.pos++]
          out += String.fromCharCode(parseInt(octal, 8) & 0xff)
        } else if (e === '\r') {
          if (src[this.pos] === '\n') this.pos += 1
        } else if (e !== '\n') {
          out += ESCAPES[e] ?? e
        }
      } else if (c === '(') {
        depth += 1
        out += c
      } else if (c === ')') {
        depth -= 1
        if (depth === 0) return out
        out += c
      } else {
        out += c
      }
    }
    return out
  }

  private hex(): string {
    const { src } = this
    let digits = ''
    this.pos += 1
    while (this.pos < src.length && src[this.pos] !== '>') {
      const c = src[this.pos++]!
      if (/[0-9A-Fa-f]/.test(c)) digits += c
    }
    this.pos += 1
    if (digits.length % 2 === 1) digits += '0'
    let out = ''
    for (let i = 0; i < digits.length; i += 2) {
      out += String.fromCharCode(parseInt(digits.slice(i, i + 2), 16))
    }
    return out
  }

  private name(): string {
    const { src } = this
    this.pos += 1
    const start = this.pos
    while (this.pos < src.length && !isDelimiter(src[this.pos]!)) this.pos += 1
    return src
      .slice(start, this.pos)
      .replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  }
}

export function readValue(lx: Lexer, tok: Token): PdfValue {
  switch (tok.kind) {
    case 'num': {
      const save = lx.pos
      const second = lx.next()
      if (second.kind === 'num') {
        const third = lx.next()
        if (third.kind === 'kw' && third.value === 'R') return new PdfRef(tok.value)
      }
      lx.pos = save
      return tok.value
    }
    case 'str':
      return tok.value
    case 'name':
      return new PdfName(tok.value)
    case 'kw':
      if (tok.value === 'true') return true
      if (tok.value === 'false') return false
      return null
    case 'punct':
      if (tok.value === '[') return readArray(lx)
      if (tok.value === '<<') return readDict(lx)
      return null
    case 'eof':
      return null
  }
}

function readArray(lx: Lexer): PdfValue[] {
  const items: PdfValue[] = []
  for (let tok = lx.next(); tok.kind !== 'eof' && !(tok.kind === 'punct' && tok.value === ']'); tok = lx.next()) {
    items.push(readValue(lx, tok))
  }
  return items
}

function readDict(lx: Lexer): PdfDict {
  const dict: PdfDict = new Map()
  for (let tok = lx.next(); tok.kind !== 'eof' && !(tok.kind === 'punct' && tok.value === '>>'); tok = lx.next()) {
    if (tok.kind !== 'name') continue
    dict.set(tok.value, readValue(lx, lx.next()))
  }
  return dict
}

interface StoredObject {
  value: PdfValue
  stream: Buffer | null
}

const OBJECT_HEADER = /(\d+)\s+\d+\s+obj\b/g
const ROOT_REF = /\/Root\s+(\d+)\s+\d+\s+R/g
const MAX_REF_CHAIN = 32

export class PdfDocument {
  private readonly objects = new Map<number, StoredObject>()
  private readonly decoded = new Map<number, Buffer | null>()
  private readonly rootNum: number | null
  private undecodedCount = 0

  constructor(private readonly file: Buffer) {
    // latin1 maps each byte to one char, so string offsets are byte offsets.
    const raw = file.toString('latin1')
    for (const m of raw.matchAll(OBJECT_HEADER)) {
      const start = m.index + m[0].length
      const endobj = raw.indexOf('endobj', start)
      this.readObject(Number(m[1]), raw, start, endobj === -1 ? raw.length : endobj)
    }
    this.loadObjectStreams()

    // Incremental updates append a new trailer, and the last one names the current root.
    const roots = [...raw.matchAll(ROOT_REF)]
    this.rootNum = roots.length > 0 ? Number(roots[roots.length - 1]![1]) : null
  }

  root(): PdfDict | null {
    return this.rootNum === null ? null : this.dict(new PdfRef(this.rootNum))
  }

  resolve(value: PdfValue): PdfValue {
    let current = value
    for (let i = 0; i < MAX_REF_CHAIN && current instanceof PdfRef; i++) {
      current = this.objects.get(current.num)?.value ?? null
    }
    return current
  }

  dict(value: PdfValue): PdfDict | null {
    const resolved = this.resolve(value)
    return resolved instanceof Map ? resolved : null
  }

  name(value: PdfValue): string | null {
    const resolved = this.resolve(value)
    return resolved instanceof PdfName ? resolved.value : null
  }

  // Streams with a filter this reader does not support, or that fail to inflate.
  get skippedStreams(): number {
    return this.undecodedCount
  }

  streamBytes(value: PdfValue): Buffer | null {
    if (!(value instanceof PdfRef)) return null
    if (!this.decoded.has(value.num)) {
      const stored = this.objects.get(value.num)
      const bytes = stored?.stream && stored.value instanceof Map ? this.decode(stored.value, stored.stream) : null
      if (stored?.stream && bytes === null) this.undecodedCount += 1
      this.decoded.set(value.num, bytes)
    }
    return this.decoded.get(value.num) ?? null
  }

  private readObject(num: number, raw: string, start: number, stop: number): void {
    const body = raw.slice(start, stop)
    const lx = new Lexer(body)
    const value = readValue(lx, lx.next())

    let stream: Buffer | null = null
    if (value instanceof Map) {
      const keyword = body.indexOf('stream', lx.pos)
      if (keyword !== -1 && body.slice(lx.pos, keyword).trim() === '') {
        let dataStart = start + keyword + 'stream'.length
        if (this.file[dataStart] === 0x0d) dataStart += 1
        if (this.file[dataStart] === 0x0a) dataStart += 1
        // /Length may be an unresolved reference, and a wrong value would cut the data short.
        const endstream = raw.indexOf('endstream', dataStart)
        stream = this.file.subarray(dataStart, endstream === -1 ? stop : endstream)
      }
    }
    // Incremental updates append newer definitions, so a later object replaces an earlier one.
    this.objects.set(num, { value, stream })
  }

  private loadObjectStreams(): void {
    const streamNums = [...this.objects.entries()]
      .filter(([, obj]) => obj.value instanceof Map && obj.value.get('Type') instanceof PdfName && (obj.value.get('Type') as PdfName).value === 'ObjStm')
      .map(([num]) => num)

    for (const num of streamNums) {
      const dict = this.objects.get(num)!.value as PdfDict
      const data = this.streamBytes(new PdfRef(num))
      const count = Number(dict.get('N'))
      const first = Number(dict.get('First'))
      if (!data || !Number.isInteger(count) || !Number.isInteger(first)) continue

      const text = data.toString('latin1')
      const headerLexer = new Lexer(text.slice(0, first))
      for (let i = 0; i < count; i++) {
        const objNum = headerLexer.next()
        const offset = headerLexer.next()
        if (objNum.kind !== 'num' || offset.kind !== 'num') break
        // A directly defined object, read earlier, takes precedence over a copy in an object stream.
        if (this.objects.has(objNum.value)) continue
        const memberLexer = new Lexer(text, first + offset.value)
        this.objects.set(objNum.value, { value: readValue(memberLexer, memberLexer.next()), stream: null })
      }
    }
  }

  private decode(dict: PdfDict, raw: Buffer): Buffer | null {
    const filter = dict.get('Filter')
    const filters = Array.isArray(filter) ? filter : filter === undefined ? [] : [filter]
    if (filters.length === 0) return raw

    const only = filters[0]
    if (filters.length === 1 && only instanceof PdfName && (only.value === 'FlateDecode' || only.value === 'Fl') && !hasPredictor(dict)) {
      try {
        return inflateSync(raw)
      } catch {
        return null
      }
    }
    return null
  }
}

function hasPredictor(dict: PdfDict): boolean {
  const parms = dict.get('DecodeParms')
  const first = Array.isArray(parms) ? parms[0] : parms
  if (!(first instanceof Map)) return false
  const predictor = first.get('Predictor')
  return typeof predictor === 'number' && predictor > 1
}
