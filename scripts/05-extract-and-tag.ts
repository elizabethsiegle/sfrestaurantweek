import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { csvRow } from './lib/csv.js'
import { MAX_ERROR_BODY, redact } from './lib/places.js'
import {
  TAGGING_MODEL,
  TAGGING_SYSTEM_PROMPT,
  evidenceAppearsIn,
  taggingCacheKey,
  validateTagging,
  type MenuTagging,
} from './lib/tagging.js'

const CACHE_DIR = 'data/cache/tagging'
const MAX_ATTEMPTS = 2
const MAX_MENU_CHARS = 20000

if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
mkdirSync(CACHE_DIR, { recursive: true })

const menus: Record<string, { menuId: string; text: string }> = JSON.parse(
  readFileSync('data/02-menus.json', 'utf8'),
)

async function requestTagging(menuText: string): Promise<unknown> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: TAGGING_MODEL,
      max_tokens: 2000,
      system: TAGGING_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: menuText }],
    }),
  })
  if (!res.ok) {
    const detail = redact(await res.text(), process.env.ANTHROPIC_API_KEY!).slice(0, MAX_ERROR_BODY)
    throw new Error(`anthropic ${res.status}: ${detail}`)
  }

  const body = (await res.json()) as { content: Array<{ type: string; text?: string }> }
  const text = body.content.find((block) => block.type === 'text')?.text ?? ''
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
}

function acceptTagging(raw: unknown, menuText: string): MenuTagging {
  const tagging = validateTagging(raw)
  const unsupported = evidenceAppearsIn(menuText, tagging)
  if (unsupported.length > 0) {
    throw new Error(`evidence not found in menu: ${unsupported.join(' | ')}`)
  }
  return tagging
}

async function tagMenu(podId: string, fullMenuText: string): Promise<MenuTagging> {
  const menuText = fullMenuText.slice(0, MAX_MENU_CHARS)
  const cachePath = `${CACHE_DIR}/${podId}.${taggingCacheKey(menuText)}.json`
  if (existsSync(cachePath)) {
    try {
      return acceptTagging(JSON.parse(readFileSync(cachePath, 'utf8')), menuText)
    } catch (err) {
      console.warn(`pod ${podId}: cache entry rejected, requesting again: ${(err as Error).message}`)
    }
  }

  let lastError = 'no attempts made'
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const tagging = acceptTagging(await requestTagging(menuText), menuText)
      writeFileSync(cachePath, JSON.stringify(tagging, null, 1))
      return tagging
    } catch (err) {
      lastError = (err as Error).message
      console.warn(`pod ${podId} attempt ${attempt}: ${lastError}`)
    }
  }
  throw new Error(lastError)
}

const tagged: Record<string, MenuTagging> = {}
const errorRows: string[] = [csvRow(['podId', 'reason'])]

for (const [podId, menu] of Object.entries(menus)) {
  try {
    tagged[podId] = await tagMenu(podId, menu.text)
  } catch (err) {
    errorRows.push(csvRow([podId, (err as Error).message]))
  }
}

writeFileSync('data/05-tagged.json', JSON.stringify(tagged, null, 1))
writeFileSync('data/05-tagged.errors.csv', errorRows.join('\n') + '\n')
console.log(`tagged ${Object.keys(tagged).length} menus, ${errorRows.length - 1} failed`)
