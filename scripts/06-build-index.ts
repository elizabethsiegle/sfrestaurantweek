import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { buildEntries, buildMeta, type ResolvedPlace } from './lib/build-entries.js'
import type { PersonalLayer } from './lib/personal.js'
import type { MenuTagging } from './lib/tagging.js'
import type { Restaurant } from '../src/lib/types.js'

function read<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

const restaurants = read<Restaurant[]>('data/01-restaurants.json', [])
const places = read<Record<string, ResolvedPlace>>('data/03-resolved.json', {})
const personal = read<PersonalLayer>('data/04-personal.json', {})
const tagged = read<Record<string, MenuTagging>>('data/05-tagged.json', {})

const { entries, excludedPersonal, personalWithoutVisits } = buildEntries({ restaurants, places, personal, tagged })
const meta = buildMeta(entries, new Date())

mkdirSync('public/data/menus', { recursive: true })

for (const r of restaurants) {
  const tagging = r.menuId ? tagged[r.menuId] : undefined
  if (tagging) writeFileSync(`public/data/menus/${r.slug}.json`, JSON.stringify(tagging))
}

writeFileSync('public/data/index.json', JSON.stringify(entries))
writeFileSync('public/data/meta.json', JSON.stringify(meta, null, 1))
console.log(
  `wrote ${meta.restaurants} entries, ${meta.withMenus} with menus, ${meta.mapped} mapped, ` +
    `${meta.personal} personal (${excludedPersonal} excluded by the publication gate, ` +
    `${personalWithoutVisits} verified but without visits)`,
)
