# SF Restaurant Week Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a site that helps a person pick where to eat during SF Restaurant Week 2026 by location, budget, meal, cuisine and mood, with a ranked natural language shortlist on top of a filterable board.

**Architecture:** Six numbered build-time scripts collect, geocode, extract and tag 174 restaurants into static JSON. A Preact app reads that JSON and does all filtering, sorting and distance work in the browser. A Cloudflare Worker serves the assets and brokers one live Claude call for natural language ranking, with a local fallback so the site works when that call fails.

**Tech Stack:** TypeScript, Preact, `@preact/signals`, Vite, MapLibre GL, Cloudflare Workers, vitest (node and `@cloudflare/vitest-pool-workers` projects), Playwright, `tsx` for scripts.

**Spec:** `sfrestaurantweek/docs/superpowers/specs/2026-10-08-sf-restaurant-week-design.md`

## Global Constraints

- Project root for every path in this plan is `sfrestaurantweek/` inside the worktree.
- Node `>=26`. `"type": "module"`. TypeScript `strict: true`.
- **Preact, not React.** The spec says React; that was imprecise. Its stated reason is matching `yelp-map-lizzies-reviews`, which uses `preact` with `@preact/signals` and `@preact/preset-vite`. Follow the real precedent.
- Runtime dependencies are limited to `preact`, `@preact/signals`, `maplibre-gl`. Everything else is a dev dependency.
- PDF text extraction uses `node:zlib` only. Do not add a PDF library.
- From Google Places, persist only `placeId`, `formattedAddress`, `lat`, `lng`. Never persist ratings, review text, photos or price levels.
- Mood vocabulary is exactly these 10 strings: `date-night`, `big-group`, `solo-friendly`, `business-dinner`, `celebration`, `comfort-food`, `light-and-fresh`, `adventurous`, `vegetarian-friendly`, `pre-theater`.
- `MIN_TIER_SAMPLE = 5`. Tiers with fewer offers show a course count and no comparison.
- Event dates are 2026-10-16 to 2026-10-25. They live in `meta.json`, never in a component.
- Every user-visible count is read from `public/data/meta.json`.
- No em dashes in any prose, code comment, commit message or user-facing string.
- Comments default to none. Add one only for a non-obvious why, per `AGENTS.md`.
- Text contrast meets WCAG AA. Layout works at 320px.
- The Anthropic API key exists only in Worker environment configuration. It must never reach the client bundle.
- `Pick` is declared twice on purpose, once in `worker/shortlist.ts` and once in `src/lib/local-rank.ts`. The Worker does not import browser code, and the two shapes are a wire contract rather than a shared type. Do not merge them. Every other type has exactly one definition.

## Review Focus

Five conditions the spec implies that no happy-path test would catch. Each has a test assigned to the task that owns the code.

1. **Accented restaurant names must slugify to unique readable ASCII.** Real data contains `Caché`, `Côte Ouest Bistro`, `Café Melange`, and both `La Méditerranée (Castro)` and `La Méditerranée (Fillmore)`. A naive slug yields `la-m-diterran-e-castro`. Test in Task 2.
2. **A PDF that yields no text must not become a zero-course restaurant.** Encrypted, image-only or non-Flate menus must set `menuCoverage: "none"` and produce no deal score, rather than scoring 0 courses and sorting to the bottom as a bad value. Test in Task 3 and Task 7.
3. **The model returning an out-of-vocabulary mood tag must be rejected, not rendered.** A tag outside the closed 10, or a record missing its evidence string, must fail validation rather than reach the interface. Test in Task 6.
4. **Denied or unavailable geolocation must degrade, not break.** Pressing "near me" and declining the permission prompt must leave the board usable and say what happened. Test in Task 10.
5. **A shortlist response with unknown or duplicate ids must be filtered before it reaches the client.** The model can hallucinate an id or repeat one. Test in Task 8.

---

### Task 1: Project scaffold and test harness

**Files:**
- Create: `sfrestaurantweek/package.json`
- Create: `sfrestaurantweek/tsconfig.json`
- Create: `sfrestaurantweek/vite.config.ts`
- Create: `sfrestaurantweek/vitest.config.ts`
- Create: `sfrestaurantweek/wrangler.jsonc`
- Create: `sfrestaurantweek/.gitignore`
- Create: `sfrestaurantweek/worker/index.ts`
- Create: `sfrestaurantweek/index.html`
- Create: `sfrestaurantweek/src/main.tsx`
- Test: `sfrestaurantweek/test/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test`, `npm run typecheck`, `npm run build`. Later tasks assume `tsx scripts/NN-*.ts` runs and that `test/fixtures/` exists.

- [ ] **Step 1: Write the failing test**

```ts
// test/scaffold.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('project scaffold', () => {
  it('pins node 26 and declares an ES module package', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.engines.node).toBe('>=26')
    expect(pkg.type).toBe('module')
  })

  it('keeps runtime dependencies to the three the plan allows', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@preact/signals',
      'maplibre-gl',
      'preact',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sfrestaurantweek && npx vitest run test/scaffold.test.ts`
Expected: FAIL, `package.json` does not exist.

- [ ] **Step 3: Write the scaffold**

```json
// package.json
{
  "name": "sf-restaurant-week-finder",
  "private": true,
  "type": "module",
  "engines": { "node": ">=26" },
  "scripts": {
    "scrape": "tsx --env-file-if-exists=.env scripts/01-scrape-list.ts",
    "menus": "tsx --env-file-if-exists=.env scripts/02-fetch-menus.ts",
    "places": "tsx --env-file-if-exists=.env scripts/03-resolve-places.ts",
    "reviews": "tsx --env-file-if-exists=.env scripts/04-link-reviews.ts",
    "tag": "tsx --env-file-if-exists=.env scripts/05-extract-and-tag.ts",
    "emit": "tsx --env-file-if-exists=.env scripts/06-build-index.ts",
    "data": "npm run scrape && npm run menus && npm run places && npm run reviews && npm run tag && npm run emit",
    "dev": "vite",
    "build": "vite build",
    "preview": "npm run build && wrangler dev",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit",
    "deploy": "npm test && npm run build && wrangler deploy"
  },
  "dependencies": {
    "@preact/signals": "^2.0.1",
    "maplibre-gl": "^6.13.0",
    "preact": "^10.27.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.12.0",
    "@playwright/test": "^1.55.0",
    "@preact/preset-vite": "^2.10.1",
    "@testing-library/preact": "^3.2.4",
    "@types/node": "^26.0.0",
    "jsdom": "^30.0.1",
    "node-html-parser": "^7.0.1",
    "tsx": "^4.20.0",
    "typescript": "^5.9.2",
    "vite": "^7.1.3",
    "vitest": "^3.2.4",
    "wrangler": "^4.127.1"
  }
}
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "types": ["node", "vitest/globals"],
    "skipLibCheck": true
  },
  "include": ["src", "worker", "scripts", "test", "e2e", "*.config.ts"]
}
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  build: { outDir: 'dist', sourcemap: true },
})
```

```ts
// vitest.config.ts
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
          exclude: ['test/worker/**'],
          environment: 'node',
          environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
        },
      },
      defineWorkersProject({
        test: {
          name: 'worker',
          include: ['test/worker/**/*.test.ts'],
          poolOptions: { workers: { wrangler: { configPath: './wrangler.jsonc' } } },
        },
      }),
    ],
  },
})
```

```jsonc
// wrangler.jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "sf-restaurant-week-finder",
  "main": "worker/index.ts",
  "compatibility_date": "2026-10-08",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "kv_namespaces": [{ "binding": "KV", "id": "44813a22bdb444dab11a2159a08cab58" }],
  "observability": { "enabled": true }
}
```

```
# .gitignore
node_modules/
dist/
# Anchored to the project root on purpose. A bare `data/` would also match
# public/data, and git cannot re-include a path whose parent directory is
# excluded, so the shipped index would silently never be committed.
/data/
.env
.wrangler/
test-results/
playwright-report/
```

```ts
// worker/index.ts
export interface Env {
  ASSETS: Fetcher
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
```

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SF Restaurant Week</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// src/main.tsx
import { render } from 'preact'

function App() {
  return <main>SF Restaurant Week</main>
}

render(<App />, document.getElementById('app')!)
```

Note on `wrangler.jsonc`: the KV namespace already exists and its real id is in place. The binding is `KV`, which is what Task 8's rate limiter reads. A namespace id is not a secret and belongs in the committed config; the two API keys do not, and live in `.env`.

`preview_id` is deliberately omitted. Without it, `wrangler dev` uses a local simulated KV store, which is what we want for development. Add a preview namespace only if you later need `wrangler dev --remote` to share real state.

- [ ] **Step 4: Install and run the tests**

Run: `cd sfrestaurantweek && npm install && npx vitest run test/scaffold.test.ts && npm run typecheck && npm run build`
Expected: tests PASS, typecheck clean, build writes `dist/`.

- [ ] **Step 5: Commit**

```bash
git add sfrestaurantweek/
git commit -m "Scaffold the SF Restaurant Week finder project"
```

---

### Task 2: Listing parser and script 01

**Files:**
- Create: `sfrestaurantweek/src/lib/types.ts`
- Create: `sfrestaurantweek/src/lib/slug.ts`
- Create: `sfrestaurantweek/scripts/lib/listing.ts`
- Create: `sfrestaurantweek/scripts/01-scrape-list.ts`
- Create: `sfrestaurantweek/test/fixtures/listing.html`
- Test: `sfrestaurantweek/test/listing.test.ts`
- Test: `sfrestaurantweek/test/slug.test.ts`

**Interfaces:**
- Consumes: Task 1's harness.
- Produces: `Restaurant`, `Offer`, `Meal` types; `slugify(name: string): string`; `parseListing(html: string): Restaurant[]`; `data/01-restaurants.json`.

- [ ] **Step 1: Save the fixture**

Run from the project root:

```bash
mkdir -p test/fixtures
curl -sL -A "Mozilla/5.0" https://www.sfrestaurantweek.com/restaurants/ -o test/fixtures/listing.html
```

The fixture is committed. Tests must never hit the network.

- [ ] **Step 2: Write the failing tests**

```ts
// test/slug.test.ts
import { describe, expect, it } from 'vitest'
import { slugify } from '../src/lib/slug.js'

describe('slugify', () => {
  it('folds accents to ascii instead of dropping them', () => {
    expect(slugify('Côte Ouest Bistro')).toBe('cote-ouest-bistro')
    expect(slugify('Caché')).toBe('cache')
  })

  it('keeps the two Mediterranee locations distinct and readable', () => {
    expect(slugify('La Méditerranée (Castro)')).toBe('la-mediterranee-castro')
    expect(slugify('La Méditerranée (Fillmore)')).toBe('la-mediterranee-fillmore')
  })

  it('does not leave leading or trailing separators', () => {
    expect(slugify('  54 Mint!  ')).toBe('54-mint')
  })
})
```

```ts
// test/listing.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseListing } from '../scripts/lib/listing.js'

const html = readFileSync('test/fixtures/listing.html', 'utf8')

describe('parseListing', () => {
  const rows = parseListing(html)

  it('reads every participating restaurant', () => {
    expect(rows).toHaveLength(174)
  })

  it('reads the fields of a known restaurant', () => {
    const mint = rows.find((r) => r.name === '54 Mint')!
    expect(mint.slug).toBe('54-mint')
    expect(mint.neighborhood).toBe('Mid Market')
    expect(mint.cuisine).toBe('Italian')
    expect(mint.diningOptions).toEqual(['Takeout', 'Delivery', 'Outdoor Dining', 'Indoor Dining'])
    expect(mint.offers).toEqual([
      { meal: 'Lunch', price: 45 },
      { meal: 'Dinner', price: 75 },
    ])
    expect(mint.menuId).toBe('17051')
    expect(mint.openTableUrl).toContain('opentable.com')
  })

  it('records a null menuId when no menu is published', () => {
    const noMenu = rows.filter((r) => r.menuId === null)
    expect(noMenu.length).toBe(51)
  })

  it('treats an empty data-restaurant-id as no menu, not as an id', () => {
    const lobbyBar = rows.find((r) => r.name === 'Lobby Bar')!
    expect(lobbyBar.menuId).toBeNull()
  })

  it('gives every restaurant at least one prix-fixe offer', () => {
    expect(rows.filter((r) => r.offers.length === 0)).toEqual([])
    expect(rows.reduce((n, r) => n + r.offers.length, 0)).toBe(272)
  })

  it('refuses a page whose prices no longer parse rather than emptying every row', () => {
    const noPrices = html.replace(/(Dinner|Lunch|Brunch) \$\d+/g, 'price on request')
    // Names the price guard specifically: both floors are 150, so a generic
    // match would also pass if the row guard fired instead.
    expect(() => parseListing(noPrices)).toThrow(/price format has probably changed/i)
  })

  it('produces a unique slug for every restaurant', () => {
    expect(new Set(rows.map((r) => r.slug)).size).toBe(rows.length)
  })

  it('refuses a truncated page rather than shipping a short list', () => {
    const truncated = html.slice(0, html.indexOf('data-item-20'))
    expect(() => parseListing(truncated)).toThrow(/expected at least 150/i)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/slug.test.ts test/listing.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/types.ts
export type Meal = 'Brunch' | 'Lunch' | 'Dinner'

export interface Offer {
  meal: Meal
  price: number
}

export interface Restaurant {
  slug: string
  name: string
  neighborhood: string
  cuisine: string
  diningOptions: string[]
  offers: Offer[]
  menuId: string | null
  openTableUrl: string | null
  websiteUrl: string | null
}
```

```ts
// src/lib/slug.ts
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
```

```ts
// scripts/lib/listing.ts
import { parse } from 'node-html-parser'
import { slugify } from '../../src/lib/slug.js'
import type { Meal, Offer, Restaurant } from '../../src/lib/types.js'

const MIN_ROWS = 150
// Offers are dropped individually when they do not parse, so a change to the
// price format would empty every row while the row count stayed healthy. This
// floor turns that silent loss into a failed run. The live page yields 272.
const MIN_OFFERS = 150
const OFFER = /^(Brunch|Lunch|Dinner)\s*\$(\d+)$/

function parseOffer(text: string): Offer | null {
  const m = OFFER.exec(text.trim())
  if (!m) return null
  return { meal: m[1] as Meal, price: Number(m[2]) }
}

// One row (Lobby Bar) carries data-restaurant-id="", a menu link with no menu
// behind it. Treat it as absent, or the fetcher spends a request discovering
// the id is unusable and the restaurant looks menu-bearing in the index.
function parseMenuId(raw: string | undefined): string | null {
  const id = raw?.trim()
  return id ? id : null
}

export function parseListing(html: string): Restaurant[] {
  const root = parse(html)
  const rows = root.querySelectorAll('div[id^="data-item-"]')

  const out: Restaurant[] = []
  for (const row of rows) {
    const name = row.querySelector('.restaurant-list-name')?.text.trim()
    if (!name) continue

    const offers = row
      .querySelectorAll('.restaurant-list-price li')
      .map((li) => parseOffer(li.text))
      .filter((o): o is Offer => o !== null)

    const links = row.querySelectorAll('.restaurant-list-menu a')
    const openTable = links.find((a) => a.getAttribute('href')?.includes('opentable.com'))
    const website = links.find((a) => {
      const href = a.getAttribute('href')
      return href && !href.includes('opentable.com') && href.startsWith('http')
    })

    out.push({
      slug: slugify(name),
      name,
      neighborhood: row.querySelector('.restaurant-list-address')?.text.trim() ?? '',
      cuisine: row.querySelector('.restaurant-list-cuisine')?.text.trim() ?? '',
      diningOptions: row
        .querySelectorAll('.restaurant-list-dining-options li')
        .map((li) => li.text.trim())
        .filter(Boolean),
      offers,
      menuId: parseMenuId(row.querySelector('.openMenuLink')?.getAttribute('data-restaurant-id')),
      openTableUrl: openTable?.getAttribute('href') ?? null,
      websiteUrl: website?.getAttribute('href') ?? null,
    })
  }

  if (out.length < MIN_ROWS) {
    throw new Error(
      `listing parse produced ${out.length} rows, expected at least ${MIN_ROWS}. ` +
        'The page markup has probably changed; re-check the row selectors.',
    )
  }

  const offers = out.reduce((n, r) => n + r.offers.length, 0)
  if (offers < MIN_OFFERS) {
    throw new Error(
      `listing parse produced ${offers} offers, expected at least ${MIN_OFFERS}. ` +
        'The price format has probably changed; re-check the OFFER pattern.',
    )
  }
  return out
}
```

```ts
// scripts/01-scrape-list.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { parseListing } from './lib/listing.js'

const URL_LISTING = 'https://www.sfrestaurantweek.com/restaurants/'

const res = await fetch(URL_LISTING, { headers: { 'User-Agent': 'Mozilla/5.0' } })
if (!res.ok) throw new Error(`listing fetch failed: ${res.status} ${res.statusText}`)

const restaurants = parseListing(await res.text())

mkdirSync('data', { recursive: true })
writeFileSync('data/01-restaurants.json', JSON.stringify(restaurants, null, 1))
console.log(`wrote ${restaurants.length} restaurants, ${restaurants.filter((r) => r.menuId).length} with menus`)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/slug.test.ts test/listing.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Run the script against the live site**

Run: `npm run scrape`
Expected: `wrote 174 restaurants, 123 with menus`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/slug.ts scripts/lib/listing.ts scripts/01-scrape-list.ts test/
git commit -m "Parse the Restaurant Week listing into structured records"
```

---

### Task 3: PDF text extraction and menu fetching

**Files:**
- Create: `sfrestaurantweek/scripts/lib/pdf-text.ts`
- Create: `sfrestaurantweek/scripts/lib/menumodo.ts`
- Create: `sfrestaurantweek/scripts/02-fetch-menus.ts`
- Create: `sfrestaurantweek/test/fixtures/menu-54mint.pdf`
- Test: `sfrestaurantweek/test/pdf-text.test.ts`
- Test: `sfrestaurantweek/test/menumodo.test.ts`

**Interfaces:**
- Consumes: `data/01-restaurants.json` from Task 2.
- Produces: `extractPdfText(pdf: Buffer): string`; `parseMenuIdFromViewer(html: string): string | null`; `viewerUrl(podId: string): string`; `printUrl(menuId: string): string`; `data/02-menus.json` shaped `Record<string, { menuId: string; text: string }>` keyed by the menumodo pod id.

- [ ] **Step 1: Save the fixture**

```bash
curl -sL -A "Mozilla/5.0" \
  https://www.menumodo.com/app.php/menu/html_print/291490/SF_RESTAURANT_WEEK \
  -o test/fixtures/menu-54mint.pdf
```

- [ ] **Step 2: Write the failing tests**

```ts
// test/pdf-text.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { extractPdfText } from '../scripts/lib/pdf-text.js'

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

  it('returns an empty string for a buffer with no inflatable streams', () => {
    expect(extractPdfText(Buffer.from('%PDF-1.3 not really a pdf'))).toBe('')
  })

  it('skips a stream that fails to inflate instead of throwing', () => {
    const junk = Buffer.from('%PDF-1.3\nstream\nnot-deflate-data\nendstream\n')
    expect(() => extractPdfText(junk)).not.toThrow()
    expect(extractPdfText(junk)).toBe('')
  })
})
```

```ts
// test/menumodo.test.ts
import { describe, expect, it } from 'vitest'
import { parseMenuIdFromViewer, printUrl } from '../scripts/lib/menumodo.js'

describe('menumodo', () => {
  it('reads menu_id out of the viewer page config block', () => {
    const html = `<script>var config = {
            menu_id: '291490',
            menupod_id: '17051',
            is_preview: 0
        };</script>`
    expect(parseMenuIdFromViewer(html)).toBe('291490')
  })

  it('returns null when the config block is absent', () => {
    expect(parseMenuIdFromViewer('<html><body>nothing here</body></html>')).toBeNull()
  })

  it('builds the print url for a menu id', () => {
    expect(printUrl('291490')).toBe(
      'https://www.menumodo.com/app.php/menu/html_print/291490/SF_RESTAURANT_WEEK',
    )
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/pdf-text.test.ts test/menumodo.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write the implementation**

```ts
// scripts/lib/pdf-text.ts
import { inflateSync } from 'node:zlib'

const TEXT_OPERAND = /\((?:\\[\s\S]|[^\\()])*\)/g

const ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  '(': '(',
  ')': ')',
  '\\': '\\',
}

function unescapePdfString(raw: string): string {
  return raw.replace(/\\([\s\S])/g, (_, ch: string) => ESCAPES[ch] ?? ch)
}

// Menu PDFs position each glyph individually, so the extracted text carries
// spaces inside words. Callers compare against whitespace-stripped forms.
export function extractPdfText(pdf: Buffer): string {
  const pieces: string[] = []
  let cursor = 0

  while (true) {
    const start = pdf.indexOf('stream', cursor)
    if (start === -1) break

    let from = start + 'stream'.length
    if (pdf[from] === 0x0d) from += 1
    if (pdf[from] === 0x0a) from += 1

    const end = pdf.indexOf('endstream', from)
    if (end === -1) break
    cursor = end + 'endstream'.length

    let inflated: Buffer
    try {
      inflated = inflateSync(pdf.subarray(from, end))
    } catch {
      continue
    }

    for (const operand of inflated.toString('latin1').match(TEXT_OPERAND) ?? []) {
      pieces.push(unescapePdfString(operand.slice(1, -1)))
    }
  }

  return pieces.join(' ').replace(/\s+/g, ' ').trim()
}
```

```ts
// scripts/lib/menumodo.ts
const MENU_ID = /menu_id:\s*'(\d+)'/
const ACCOUNT = 'SF_RESTAURANT_WEEK'

export function parseMenuIdFromViewer(html: string): string | null {
  return MENU_ID.exec(html)?.[1] ?? null
}

export function viewerUrl(podId: string): string {
  return `https://www.menumodo.com/app.php/viewer/index/${podId}`
}

export function printUrl(menuId: string): string {
  return `https://www.menumodo.com/app.php/menu/html_print/${menuId}/${ACCOUNT}`
}
```

```ts
// scripts/02-fetch-menus.ts
import { readFileSync, writeFileSync } from 'node:fs'
import type { Restaurant } from '../src/lib/types.js'
import { extractPdfText } from './lib/pdf-text.js'
import { parseMenuIdFromViewer, printUrl, viewerUrl } from './lib/menumodo.js'

const DELAY_MS = 400
const UA = { 'User-Agent': 'Mozilla/5.0' }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const restaurants: Restaurant[] = JSON.parse(readFileSync('data/01-restaurants.json', 'utf8'))

// Pod ids are not one to one with restaurants: Delarosa Marina and Delarosa
// Yerba Buena share pod 13371. Fetch each distinct pod once.
const podIds = [...new Set(restaurants.map((r) => r.menuId).filter((id): id is string => id !== null))]

const menus: Record<string, { menuId: string; text: string }> = {}
const errors: string[] = ['podId,reason']

for (const podId of podIds) {
  try {
    const viewer = await fetch(viewerUrl(podId), { headers: UA })
    if (!viewer.ok) throw new Error(`viewer ${viewer.status}`)

    const menuId = parseMenuIdFromViewer(await viewer.text())
    if (!menuId) throw new Error('no menu_id in viewer config')

    await sleep(DELAY_MS)

    const pdf = await fetch(printUrl(menuId), { headers: UA })
    if (!pdf.ok) throw new Error(`print ${pdf.status}`)

    const text = extractPdfText(Buffer.from(await pdf.arrayBuffer()))
    if (!text) throw new Error('pdf yielded no text')

    menus[podId] = { menuId, text }
  } catch (err) {
    errors.push(`${podId},"${(err as Error).message}"`)
    console.warn(`pod ${podId}: ${(err as Error).message}`)
  }
  await sleep(DELAY_MS)
}

writeFileSync('data/02-menus.json', JSON.stringify(menus, null, 1))
writeFileSync('data/02-menus.errors.csv', errors.join('\n'))
console.log(`fetched ${Object.keys(menus).length} of ${podIds.length} menus, ${errors.length - 1} failed`)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/pdf-text.test.ts test/menumodo.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Run the script**

Run: `npm run menus`
Expected: roughly `fetched 122 of 122 menus`. Any failures are listed in `data/02-menus.errors.csv`. A handful of failures is acceptable; those restaurants carry `menuCoverage: "none"` from Task 7.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pdf-text.ts scripts/lib/menumodo.ts scripts/02-fetch-menus.ts test/
git commit -m "Extract prix-fixe menu text from the published menu PDFs"
```

---

### Task 4: Google Places resolution

**Files:**
- Create: `sfrestaurantweek/scripts/lib/places.ts`
- Create: `sfrestaurantweek/scripts/03-resolve-places.ts`
- Create: `sfrestaurantweek/.env.example`
- Test: `sfrestaurantweek/test/places.test.ts`

**Interfaces:**
- Consumes: `data/01-restaurants.json`.
- Produces: `inBayArea(lat, lng): boolean`; `resolvePlace(name, neighborhood, fetchImpl?, apiKey?): Promise<Place | null>` where `Place = { placeId: string; formattedAddress: string; lat: number; lng: number }`; `data/03-resolved.json` keyed by slug.

- [ ] **Step 1: Write the failing test**

```ts
// test/places.test.ts
import { describe, expect, it } from 'vitest'
import { inBayArea, resolvePlace } from '../scripts/lib/places.js'

function stubFetch(body: unknown) {
  return async () => new Response(JSON.stringify(body), { status: 200 })
}

describe('inBayArea', () => {
  it('accepts a San Francisco coordinate', () => {
    expect(inBayArea(37.7749, -122.4194)).toBe(true)
  })

  it('rejects a same-named restaurant in another state', () => {
    expect(inBayArea(40.7128, -74.006)).toBe(false)
  })
})

describe('resolvePlace', () => {
  it('keeps only place id, address and coordinates', async () => {
    const place = await resolvePlace('54 Mint', 'Mid Market', stubFetch({
      places: [{
        id: 'ChIJtest',
        formattedAddress: '16 Mint Plaza, San Francisco, CA 94103, USA',
        location: { latitude: 37.7825, longitude: -122.4094 },
        rating: 4.4,
        priceLevel: 'PRICE_LEVEL_MODERATE',
      }],
    }))

    expect(place).toEqual({
      placeId: 'ChIJtest',
      formattedAddress: '16 Mint Plaza, San Francisco, CA 94103, USA',
      lat: 37.7825,
      lng: -122.4094,
    })
    expect(JSON.stringify(place)).not.toContain('rating')
    expect(JSON.stringify(place)).not.toContain('priceLevel')
  })

  it('returns null rather than a wrong pin when the match is outside the Bay Area', async () => {
    const place = await resolvePlace('Amelie', 'Russian Hill', stubFetch({
      places: [{
        id: 'ChIJparis',
        formattedAddress: '24 Rue Example, Paris, France',
        location: { latitude: 48.8566, longitude: 2.3522 },
      }],
    }))
    expect(place).toBeNull()
  })

  it('returns null when the search finds nothing', async () => {
    expect(await resolvePlace('Nowhere', 'Nowhere', stubFetch({ places: [] }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/places.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// scripts/lib/places.ts
export interface Place {
  placeId: string
  formattedAddress: string
  lat: number
  lng: number
}

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
const FIELD_MASK = 'places.id,places.formattedAddress,places.location'

const BOUNDS = { minLat: 37.2, maxLat: 38.1, minLng: -122.8, maxLng: -121.8 }

export function inBayArea(lat: number, lng: number): boolean {
  return lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export async function resolvePlace(
  name: string,
  neighborhood: string,
  fetchImpl: FetchLike = fetch,
  apiKey = process.env.GOOGLE_MAPS_API_KEY ?? '',
): Promise<Place | null> {
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: `${name}, ${neighborhood}, San Francisco, CA` }),
  })

  if (!res.ok) throw new Error(`places search failed: ${res.status}`)

  const hit = ((await res.json()) as { places?: Array<Record<string, any>> }).places?.[0]
  if (!hit) return null

  const lat = hit.location?.latitude
  const lng = hit.location?.longitude
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!inBayArea(lat, lng)) return null

  return { placeId: hit.id, formattedAddress: hit.formattedAddress, lat, lng }
}
```

```ts
// scripts/03-resolve-places.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Restaurant } from '../src/lib/types.js'
import { resolvePlace, type Place } from './lib/places.js'

if (!process.env.GOOGLE_MAPS_API_KEY) {
  throw new Error('GOOGLE_MAPS_API_KEY is not set. See .env.example.')
}

const CACHE_DIR = 'data/cache/places'
mkdirSync(CACHE_DIR, { recursive: true })

const restaurants: Restaurant[] = JSON.parse(readFileSync('data/01-restaurants.json', 'utf8'))
const resolved: Record<string, Place> = {}
const errors: string[] = ['slug,name,neighborhood,reason']

for (const r of restaurants) {
  const cachePath = `${CACHE_DIR}/${r.slug}.json`
  if (existsSync(cachePath)) {
    resolved[r.slug] = JSON.parse(readFileSync(cachePath, 'utf8'))
    continue
  }

  try {
    const place = await resolvePlace(r.name, r.neighborhood)
    if (!place) {
      errors.push(`${r.slug},"${r.name}","${r.neighborhood}",no acceptable match`)
      continue
    }
    writeFileSync(cachePath, JSON.stringify(place, null, 1))
    resolved[r.slug] = place
  } catch (err) {
    errors.push(`${r.slug},"${r.name}","${r.neighborhood}","${(err as Error).message}"`)
  }
}

writeFileSync('data/03-resolved.json', JSON.stringify(resolved, null, 1))
writeFileSync('data/03-unresolved.csv', errors.join('\n'))
console.log(`resolved ${Object.keys(resolved).length} of ${restaurants.length}, ${errors.length - 1} unresolved`)
```

```
# .env.example
# Google Places Text Search. Used only by scripts/03-resolve-places.ts to turn a
# restaurant name into a place id, address and coordinate. Never shipped to the
# browser. Only place id, address and coordinates are persisted; ratings, reviews,
# photos and price levels are not stored, because the Places policy forbids it.
GOOGLE_MAPS_API_KEY=

# Anthropic API key. Used by scripts/05-extract-and-tag.ts at build time and by
# the Worker at runtime for the shortlist endpoint. Set the Worker copy with
# `npx wrangler secret put ANTHROPIC_API_KEY`. Never shipped to the browser.
ANTHROPIC_API_KEY=

# Protomaps hosted vector tile key for the map basemap. Baked into the client
# bundle by Vite, so restrict it to this site's origins.
VITE_PROTOMAPS_API_KEY=
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/places.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the script**

Run: `npm run places` (reads `GOOGLE_MAPS_API_KEY` from `.env`)
Expected: `resolved 170+ of 174`. Inspect `data/03-unresolved.csv` and accept the remainder; Task 7 marks them as unmapped.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/places.ts scripts/03-resolve-places.ts .env.example test/places.test.ts
git commit -m "Resolve restaurants to coordinates with Places Text Search"
```

---

### Task 5: Link Lizzie's own reviews

**Files:**
- Create: `sfrestaurantweek/scripts/lib/match-name.ts`
- Create: `sfrestaurantweek/scripts/04-link-reviews.ts`
- Test: `sfrestaurantweek/test/match-name.test.ts`

**Interfaces:**
- Consumes: `data/01-restaurants.json`, and the yelp-map export at `YELP_EXPORT_PATH`.
- Produces: `matchKey(name: string): string`; `data/04-personal.json` keyed by slug, shaped `{ rating: number | null; yelpUrl: string | null; visits: Array<{ date: string; rating: number; text: string }> }`.

- [ ] **Step 1: Write the failing test**

```ts
// test/match-name.test.ts
import { describe, expect, it } from 'vitest'
import { matchKey } from '../scripts/lib/match-name.js'

describe('matchKey', () => {
  it('matches across punctuation and case', () => {
    expect(matchKey("Scoma's Restaurant")).toBe(matchKey('Scomas'))
  })

  it('matches across accents', () => {
    expect(matchKey('Côte Ouest Bistro')).toBe(matchKey('Cote Ouest Bistro'))
  })

  it('ignores filler words that differ between sources', () => {
    expect(matchKey('The Cavalier')).toBe(matchKey('Cavalier'))
    expect(matchKey('Gyu-Kaku Japanese BBQ (SF)')).toBe(matchKey('Gyu-Kaku Japanese BBQ'))
  })

  it('keeps genuinely different restaurants apart', () => {
    expect(matchKey('Fiorella Polk')).not.toBe(matchKey('Fiorella Clement'))
    expect(matchKey('La Mediterranee (Castro)')).not.toBe(matchKey('La Mediterranee (Fillmore)'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/match-name.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// scripts/lib/match-name.ts
const FILLER = /\b(the|restaurant|sf|san francisco|cafe|bar|grill|kitchen)\b/g

export function matchKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(FILLER, '')
    .replace(/[^a-z0-9]/g, '')
}
```

```ts
// scripts/04-link-reviews.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Restaurant } from '../src/lib/types.js'
import { matchKey } from './lib/match-name.js'

const EXPORT_PATH =
  process.env.YELP_EXPORT_PATH ?? '../yelp-map-lizzies-reviews/data/02-resolved.json'

interface Visit {
  date: string
  rating: number
  text: string
}
interface Business {
  name: string
  visits?: Visit[]
  meanRating?: number
  yelpUrl?: string
}

const restaurants: Restaurant[] = JSON.parse(readFileSync('data/01-restaurants.json', 'utf8'))

if (!existsSync(EXPORT_PATH)) {
  writeFileSync('data/04-personal.json', '{}')
  console.log(`no export at ${EXPORT_PATH}; wrote an empty personal layer`)
  process.exit(0)
}

const raw = JSON.parse(readFileSync(EXPORT_PATH, 'utf8'))
const businesses: Business[] = Array.isArray(raw) ? raw : (Object.values(raw)[0] as Business[])

const byKey = new Map<string, Business>()
for (const b of businesses) {
  if (b.name) byKey.set(matchKey(b.name), b)
}

const personal: Record<string, unknown> = {}
const matches: string[] = ['slug,restaurantWeekName,exportName,visits,meanRating']

for (const r of restaurants) {
  const b = byKey.get(matchKey(r.name))
  if (!b?.visits?.length) continue

  personal[r.slug] = {
    rating: b.meanRating ?? null,
    yelpUrl: b.yelpUrl ?? null,
    visits: b.visits.map((v) => ({ date: v.date, rating: v.rating, text: v.text })),
  }
  matches.push(`${r.slug},"${r.name}","${b.name}",${b.visits.length},${b.meanRating ?? ''}`)
}

writeFileSync('data/04-personal.json', JSON.stringify(personal, null, 1))
writeFileSync('data/04-matches.csv', matches.join('\n'))
console.log(`linked ${Object.keys(personal).length} restaurants; review data/04-matches.csv by eye`)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/match-name.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the script and eyeball the matches**

Run: `npm run reviews && cat data/04-matches.csv`
Expected: `linked 23 restaurants`. Read every row. Name matching is the one step here that can be confidently wrong, so a wrong pairing must be caught now by a human reading the CSV.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/match-name.ts scripts/04-link-reviews.ts test/match-name.test.ts
git commit -m "Link Restaurant Week entries to Lizzie's own Yelp reviews"
```

---

### Task 6: Menu extraction and mood tagging

**Files:**
- Create: `sfrestaurantweek/src/lib/moods.ts`
- Create: `sfrestaurantweek/scripts/lib/tagging.ts`
- Create: `sfrestaurantweek/scripts/05-extract-and-tag.ts`
- Test: `sfrestaurantweek/test/tagging.test.ts`

**Interfaces:**
- Consumes: `data/02-menus.json`; `Course` and `Dish` from `src/lib/entry.ts` (Task 7 defines them; if Task 6 runs first, declare them in `src/lib/entry.ts` here and let Task 7 extend that file).
- Produces: `MOOD_TAGS` (readonly tuple of 10); `MoodTag`; `MOOD_LABELS`; `validateTagging(raw: unknown): MenuTagging` which throws on invalid input; `TAGGING_SYSTEM_PROMPT`; `data/05-tagged.json` keyed by pod id.

- [ ] **Step 1: Write the failing test**

```ts
// test/tagging.test.ts
import { describe, expect, it } from 'vitest'
import { MOOD_TAGS } from '../src/lib/moods.js'
import { validateTagging } from '../scripts/lib/tagging.js'

const valid = {
  courses: [
    { name: 'Antipasti', dishes: [{ name: 'Insalata di Indivia', description: 'endive, radicchio, pear' }] },
    { name: 'Dolce', dishes: [{ name: 'Tiramisu', description: 'espresso soaked ladyfingers' }] },
  ],
  moods: [{ tag: 'date-night', evidence: 'shared antipasti and a whole-fish secondo' }],
  dietary: { vegetarianFriendly: { value: true, evidence: 'endive salad and a squash risotto' } },
  blurb: 'A four course Italian dinner built around autumn vegetables.',
}

describe('validateTagging', () => {
  it('accepts a well formed record', () => {
    expect(validateTagging(valid).courses).toHaveLength(2)
  })

  it('exposes exactly the ten agreed mood tags', () => {
    expect(MOOD_TAGS).toHaveLength(10)
    expect(MOOD_TAGS).toContain('pre-theater')
  })

  it('rejects a mood tag outside the closed vocabulary', () => {
    const invented = { ...valid, moods: [{ tag: 'cozy-vibes', evidence: 'candles' }] }
    expect(() => validateTagging(invented)).toThrow(/unknown mood tag: cozy-vibes/)
  })

  it('rejects a mood tag with no evidence', () => {
    const bare = { ...valid, moods: [{ tag: 'date-night', evidence: '' }] }
    expect(() => validateTagging(bare)).toThrow(/evidence/)
  })

  it('rejects a record with no courses', () => {
    expect(() => validateTagging({ ...valid, courses: [] })).toThrow(/at least one course/)
  })

  it('accepts a record with no mood tags at all', () => {
    expect(validateTagging({ ...valid, moods: [] }).moods).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tagging.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/moods.ts
export const MOOD_TAGS = [
  'date-night',
  'big-group',
  'solo-friendly',
  'business-dinner',
  'celebration',
  'comfort-food',
  'light-and-fresh',
  'adventurous',
  'vegetarian-friendly',
  'pre-theater',
] as const

export type MoodTag = (typeof MOOD_TAGS)[number]

export const MOOD_LABELS: Record<MoodTag, string> = {
  'date-night': 'Date night',
  'big-group': 'Big group',
  'solo-friendly': 'Solo friendly',
  'business-dinner': 'Business dinner',
  celebration: 'Celebration',
  'comfort-food': 'Comfort food',
  'light-and-fresh': 'Light and fresh',
  adventurous: 'Adventurous',
  'vegetarian-friendly': 'Vegetarian friendly',
  'pre-theater': 'Pre-theater',
}
```

```ts
// src/lib/entry.ts  (first half; Task 7 appends the rest)
import type { MoodTag } from './moods.js'

export interface Dish {
  name: string
  description: string
}

export interface Course {
  name: string
  dishes: Dish[]
}

// Defined here, not in scripts/lib/tagging.ts, so the build-time tagger and the
// browser share one definition of a mood claim.
export interface MoodClaim {
  tag: MoodTag
  evidence: string
}
```

```ts
// scripts/lib/tagging.ts
import type { Course, MoodClaim } from '../../src/lib/entry.js'
import { MOOD_TAGS } from '../../src/lib/moods.js'

export interface DietaryClaim {
  value: boolean
  evidence: string
}

export interface MenuTagging {
  courses: Course[]
  moods: MoodClaim[]
  dietary: Partial<Record<'vegetarianFriendly' | 'veganFriendly' | 'glutenFreeFriendly', DietaryClaim>>
  blurb: string
}

const KNOWN = new Set<string>(MOOD_TAGS)

export function validateTagging(raw: unknown): MenuTagging {
  if (typeof raw !== 'object' || raw === null) throw new Error('tagging must be an object')
  const r = raw as Record<string, unknown>

  const courses = r.courses
  if (!Array.isArray(courses) || courses.length === 0) {
    throw new Error('tagging must contain at least one course')
  }
  for (const c of courses) {
    const course = c as Record<string, unknown>
    if (typeof course.name !== 'string' || !course.name.trim()) {
      throw new Error('every course needs a name')
    }
    if (!Array.isArray(course.dishes)) throw new Error(`course ${course.name} needs a dishes array`)
  }

  const moods = r.moods
  if (!Array.isArray(moods)) throw new Error('tagging must contain a moods array')
  for (const m of moods) {
    const mood = m as Record<string, unknown>
    if (typeof mood.tag !== 'string' || !KNOWN.has(mood.tag)) {
      throw new Error(`unknown mood tag: ${String(mood.tag)}`)
    }
    if (typeof mood.evidence !== 'string' || mood.evidence.trim().length < 3) {
      throw new Error(`mood ${mood.tag} is missing its evidence`)
    }
  }

  if (typeof r.blurb !== 'string' || !r.blurb.trim()) throw new Error('tagging needs a blurb')

  return {
    courses: courses as Course[],
    moods: moods as MoodClaim[],
    dietary: (r.dietary ?? {}) as MenuTagging['dietary'],
    blurb: r.blurb,
  }
}

export const TAGGING_SYSTEM_PROMPT = `You read a prix-fixe menu and return structured JSON.

The menu text comes from a PDF that positions each glyph separately, so words
often contain stray spaces. Read through that spacing.

Return only JSON matching this shape:
{
  "courses": [{ "name": string, "dishes": [{ "name": string, "description": string }] }],
  "moods": [{ "tag": string, "evidence": string }],
  "dietary": {
    "vegetarianFriendly": { "value": boolean, "evidence": string },
    "veganFriendly": { "value": boolean, "evidence": string },
    "glutenFreeFriendly": { "value": boolean, "evidence": string }
  },
  "blurb": string
}

"tag" must be one of exactly these values:
${MOOD_TAGS.join(', ')}

Rules:
- Every mood tag must be supported by the menu. Quote the supporting dishes in
  "evidence", in under 12 words.
- Returning few tags is correct. Returning no tags is correct when the menu
  supports none. Do not pad the list.
- Do not invent a tag that is not in the list above.
- "blurb" is one sentence describing the meal, under 20 words.
- A course is a section of the menu a diner picks from, such as Antipasti or
  Dolce. Count a prix-fixe section once even when it offers a choice.`
```

```ts
// scripts/05-extract-and-tag.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { validateTagging, TAGGING_SYSTEM_PROMPT, type MenuTagging } from './lib/tagging.js'

const MODEL = 'claude-sonnet-5-5'
const CACHE_DIR = 'data/cache/tagging'

if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
mkdirSync(CACHE_DIR, { recursive: true })

const menus: Record<string, { menuId: string; text: string }> = JSON.parse(
  readFileSync('data/02-menus.json', 'utf8'),
)

async function tagOnce(text: string): Promise<unknown> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: TAGGING_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text.slice(0, 20000) }],
    }),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`)

  const body = (await res.json()) as { content: Array<{ type: string; text?: string }> }
  const raw = body.content.find((c) => c.type === 'text')?.text ?? ''
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  return JSON.parse(json)
}

const tagged: Record<string, MenuTagging> = {}
const errors: string[] = ['podId,reason']

for (const [podId, menu] of Object.entries(menus)) {
  const cachePath = `${CACHE_DIR}/${podId}.json`
  if (existsSync(cachePath)) {
    tagged[podId] = JSON.parse(readFileSync(cachePath, 'utf8'))
    continue
  }

  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = validateTagging(await tagOnce(menu.text))
      writeFileSync(cachePath, JSON.stringify(result, null, 1))
      tagged[podId] = result
      lastError = ''
      break
    } catch (err) {
      lastError = (err as Error).message
    }
  }
  if (lastError) {
    errors.push(`${podId},"${lastError}"`)
    console.warn(`pod ${podId}: ${lastError}`)
  }
}

writeFileSync('data/05-tagged.json', JSON.stringify(tagged, null, 1))
writeFileSync('data/05-tagged.errors.csv', errors.join('\n'))
console.log(`tagged ${Object.keys(tagged).length} menus, ${errors.length - 1} failed`)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/tagging.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the script**

Run: `npm run tag` (reads `ANTHROPIC_API_KEY` from `.env`)
Expected: roughly `tagged 122 menus, 0 failed`. Spot-check five entries in `data/05-tagged.json` and confirm each mood evidence string genuinely appears in that restaurant's menu.

- [ ] **Step 6: Commit**

```bash
git add src/lib/moods.ts src/lib/entry.ts scripts/lib/tagging.ts scripts/05-extract-and-tag.ts test/tagging.test.ts
git commit -m "Extract menu courses and evidence-backed mood tags with Claude"
```

---

### Task 7: Deal score and index build

**Files:**
- Create: `sfrestaurantweek/src/lib/deal-score.ts`
- Modify: `sfrestaurantweek/src/lib/entry.ts`
- Create: `sfrestaurantweek/scripts/06-build-index.ts`
- Test: `sfrestaurantweek/test/deal-score.test.ts`

**Interfaces:**
- Consumes: all `data/0*.json`.
- Produces: `MIN_TIER_SAMPLE`; `median(ns: number[]): number`; `tierKey(meal, price): string`; `buildTierStats(offers: ScoredOffer[]): Map<string, TierStat>`; `dealDelta(courses, stat): number | null`; `Entry`, `EntryOffer`, `Meta` types; `public/data/index.json`, `meta.json`, `menus/{slug}.json`.

- [ ] **Step 1: Write the failing test**

```ts
// test/deal-score.test.ts
import { describe, expect, it } from 'vitest'
import { buildTierStats, dealDelta, median, MIN_TIER_SAMPLE, tierKey } from '../src/lib/deal-score.js'

const offer = (price: number, courses: number | null) => ({ meal: 'Lunch' as const, price, courses })

describe('median', () => {
  it('returns the middle value for an odd count', () => {
    expect(median([3, 1, 2])).toBe(2)
  })

  it('averages the two middles for an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('buildTierStats', () => {
  it('reports a median once the tier has enough offers', () => {
    const stats = buildTierStats([
      offer(45, 3), offer(45, 3), offer(45, 3), offer(45, 4), offer(45, 4),
    ])
    const tier = stats.get(tierKey('Lunch', 45))!
    expect(tier.sampleSize).toBe(5)
    expect(tier.medianCourses).toBe(3)
  })

  it('withholds the median when the tier is too thin to compare', () => {
    const stats = buildTierStats([offer(15, 2), offer(15, 3)])
    const tier = stats.get(tierKey('Lunch', 15))!
    expect(tier.sampleSize).toBe(2)
    expect(tier.medianCourses).toBeNull()
  })

  it('ignores offers with no course count when computing the median', () => {
    const stats = buildTierStats([
      offer(45, 3), offer(45, 3), offer(45, 3), offer(45, 9), offer(45, 9), offer(45, null),
    ])
    expect(stats.get(tierKey('Lunch', 45))!.sampleSize).toBe(5)
  })
})

describe('dealDelta', () => {
  const stat = { meal: 'Lunch' as const, price: 45, medianCourses: 3, sampleSize: 8 }

  it('scores an extra course above the median as positive', () => {
    expect(dealDelta(4, stat)).toBe(1)
  })

  it('returns null for a restaurant with no menu rather than scoring it zero', () => {
    expect(dealDelta(null, stat)).toBeNull()
  })

  it('returns null when the tier withheld its median', () => {
    expect(dealDelta(4, { ...stat, medianCourses: null, sampleSize: 2 })).toBeNull()
  })

  it('exposes the agreed minimum sample size', () => {
    expect(MIN_TIER_SAMPLE).toBe(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/deal-score.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/deal-score.ts
import type { Meal } from './types.js'

export const MIN_TIER_SAMPLE = 5

export interface ScoredOffer {
  meal: Meal
  price: number
  courses: number | null
}

export interface TierStat {
  meal: Meal
  price: number
  medianCourses: number | null
  sampleSize: number
}

export function median(ns: number[]): number {
  const sorted = [...ns].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export function tierKey(meal: Meal, price: number): string {
  return `${meal}:${price}`
}

export function buildTierStats(offers: ScoredOffer[]): Map<string, TierStat> {
  const buckets = new Map<string, { meal: Meal; price: number; courses: number[] }>()

  for (const o of offers) {
    const key = tierKey(o.meal, o.price)
    const bucket = buckets.get(key) ?? { meal: o.meal, price: o.price, courses: [] }
    if (o.courses !== null) bucket.courses.push(o.courses)
    buckets.set(key, bucket)
  }

  const stats = new Map<string, TierStat>()
  for (const [key, b] of buckets) {
    stats.set(key, {
      meal: b.meal,
      price: b.price,
      sampleSize: b.courses.length,
      medianCourses: b.courses.length >= MIN_TIER_SAMPLE ? median(b.courses) : null,
    })
  }
  return stats
}

export function dealDelta(courses: number | null, stat: TierStat | undefined): number | null {
  if (courses === null || !stat || stat.medianCourses === null) return null
  return courses - stat.medianCourses
}
```

```ts
// src/lib/entry.ts  (append below the Dish, Course and MoodClaim interfaces from Task 6)
import type { Meal, Restaurant } from './types.js'

export interface EntryOffer {
  meal: Meal
  price: number
  courses: number | null
  dealDelta: number | null
  medianCourses: number | null
}

export interface Entry extends Omit<Restaurant, 'offers' | 'menuId'> {
  offers: EntryOffer[]
  menuCoverage: 'full' | 'none'
  moods: MoodClaim[]
  blurb: string | null
  vegetarianFriendly: boolean
  lat: number | null
  lng: number | null
  address: string | null
  personal: { rating: number | null; yelpUrl: string | null; excerpt: string; visitDate: string } | null
}

export interface Meta {
  eventStart: string
  eventEnd: string
  builtAt: string
  restaurants: number
  withMenus: number
  mapped: number
  personal: number
  neighborhoods: number
  cuisines: number
}
```

```ts
// scripts/06-build-index.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { buildTierStats, dealDelta, tierKey, type ScoredOffer } from '../src/lib/deal-score.js'
import type { Entry, Meta } from '../src/lib/entry.js'
import type { Restaurant } from '../src/lib/types.js'
import type { MenuTagging } from './lib/tagging.js'

const EVENT_START = '2026-10-16'
const EVENT_END = '2026-10-25'

function read<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

const restaurants = read<Restaurant[]>('data/01-restaurants.json', [])
const places = read<Record<string, { placeId: string; formattedAddress: string; lat: number; lng: number }>>(
  'data/03-resolved.json', {},
)
const personal = read<Record<string, { rating: number | null; yelpUrl: string | null; visits: Array<{ date: string; rating: number; text: string }> }>>(
  'data/04-personal.json', {},
)
const tagged = read<Record<string, MenuTagging>>('data/05-tagged.json', {})

const taggingFor = (r: Restaurant) => (r.menuId ? tagged[r.menuId] : undefined)
const courseCount = (r: Restaurant) => taggingFor(r)?.courses.length ?? null

const allOffers: ScoredOffer[] = restaurants.flatMap((r) =>
  r.offers.map((o) => ({ meal: o.meal, price: o.price, courses: courseCount(r) })),
)
const stats = buildTierStats(allOffers)

mkdirSync('public/data/menus', { recursive: true })

const entries: Entry[] = restaurants.map((r) => {
  const tagging = taggingFor(r)
  const courses = courseCount(r)
  const place = places[r.slug]
  const mine = personal[r.slug]
  const firstVisit = mine?.visits[0]

  return {
    slug: r.slug,
    name: r.name,
    neighborhood: r.neighborhood,
    cuisine: r.cuisine,
    diningOptions: r.diningOptions,
    openTableUrl: r.openTableUrl,
    websiteUrl: r.websiteUrl,
    offers: r.offers.map((o) => {
      const stat = stats.get(tierKey(o.meal, o.price))
      return {
        meal: o.meal,
        price: o.price,
        courses,
        dealDelta: dealDelta(courses, stat),
        medianCourses: stat?.medianCourses ?? null,
      }
    }),
    menuCoverage: tagging ? 'full' : 'none',
    moods: tagging?.moods ?? [],
    blurb: tagging?.blurb ?? null,
    vegetarianFriendly:
      tagging?.dietary.vegetarianFriendly?.value ?? r.diningOptions.includes('Vegetarian Options'),
    lat: place?.lat ?? null,
    lng: place?.lng ?? null,
    address: place?.formattedAddress ?? null,
    personal: firstVisit
      ? {
          rating: mine?.rating ?? null,
          yelpUrl: mine?.yelpUrl ?? null,
          excerpt: firstVisit.text.slice(0, 280),
          visitDate: firstVisit.date,
        }
      : null,
  }
})

for (const r of restaurants) {
  const tagging = taggingFor(r)
  if (tagging) writeFileSync(`public/data/menus/${r.slug}.json`, JSON.stringify(tagging))
}

const meta: Meta = {
  eventStart: EVENT_START,
  eventEnd: EVENT_END,
  builtAt: new Date().toISOString(),
  restaurants: entries.length,
  withMenus: entries.filter((e) => e.menuCoverage === 'full').length,
  mapped: entries.filter((e) => e.lat !== null).length,
  personal: entries.filter((e) => e.personal !== null).length,
  neighborhoods: new Set(entries.map((e) => e.neighborhood)).size,
  cuisines: new Set(entries.map((e) => e.cuisine)).size,
}

writeFileSync('public/data/index.json', JSON.stringify(entries))
writeFileSync('public/data/meta.json', JSON.stringify(meta, null, 1))
console.log(`wrote ${entries.length} entries, ${meta.withMenus} with menus, ${meta.mapped} mapped`)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/deal-score.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the script**

Run: `npm run emit`
Expected: `wrote 174 entries, ~122 with menus, ~170 mapped`. Confirm `git status` shows `public/data/` as tracked, not ignored.

- [ ] **Step 6: Commit**

```bash
git add src/lib/deal-score.ts src/lib/entry.ts scripts/06-build-index.ts test/deal-score.test.ts public/data
git commit -m "Score prix-fixe value by course count and build the shipped index"
```

---

### Task 8: Worker shortlist endpoint

**Files:**
- Create: `sfrestaurantweek/worker/shortlist.ts`
- Modify: `sfrestaurantweek/worker/index.ts`
- Test: `sfrestaurantweek/test/worker/shortlist.test.ts`

**Interfaces:**
- Consumes: `public/data/index.json`, `Entry` from Task 7.
- Produces: `MAX_PICKS`, `MAX_QUERY_LENGTH`, `DAILY_LIMIT`; `buildCatalog(entries: Entry[]): string`; `validateShortlist(raw: unknown, knownIds: Set<string>): Pick[]` where `Pick = { slug: string; reason: string }`; `POST /api/shortlist` returning `{ picks: Pick[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// test/worker/shortlist.test.ts
import { describe, expect, it } from 'vitest'
import { buildCatalog, MAX_PICKS, MAX_QUERY_LENGTH, validateShortlist } from '../../worker/shortlist.js'
import type { Entry } from '../../src/lib/entry.js'

const known = new Set(['54-mint', 'a-mano', 'abaca'])

const entry = (slug: string): Entry => ({
  slug, name: slug, neighborhood: 'Mission', cuisine: 'Italian', diningOptions: ['Indoor Dining'],
  openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }],
  menuCoverage: 'full', moods: [{ tag: 'date-night', evidence: 'shared plates' }],
  blurb: 'A three course Italian dinner.', vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null,
})

describe('validateShortlist', () => {
  it('keeps well formed picks in order', () => {
    const picks = validateShortlist(
      { picks: [{ slug: '54-mint', reason: 'Shared plates suit a date.' }] }, known,
    )
    expect(picks).toEqual([{ slug: '54-mint', reason: 'Shared plates suit a date.' }])
  })

  it('drops a hallucinated slug that is not in the catalog', () => {
    const picks = validateShortlist(
      { picks: [{ slug: 'not-a-restaurant', reason: 'invented' }, { slug: 'a-mano', reason: 'real' }] },
      known,
    )
    expect(picks).toEqual([{ slug: 'a-mano', reason: 'real' }])
  })

  it('drops a repeated slug, keeping the first mention', () => {
    const picks = validateShortlist(
      { picks: [{ slug: 'abaca', reason: 'first' }, { slug: 'abaca', reason: 'second' }] }, known,
    )
    expect(picks).toEqual([{ slug: 'abaca', reason: 'first' }])
  })

  it('caps the number of picks at MAX_PICKS', () => {
    const slugs = Array.from({ length: 30 }, (_, i) => `slug-${i}`)
    const manyKnown = new Set(slugs)
    const picks = slugs.map((slug) => ({ slug, reason: 'x' }))
    expect(validateShortlist({ picks }, manyKnown)).toHaveLength(MAX_PICKS)
  })

  it('returns an empty list for malformed input rather than throwing', () => {
    expect(validateShortlist('not json', known)).toEqual([])
    expect(validateShortlist({ picks: 'nope' }, known)).toEqual([])
    expect(validateShortlist({ picks: [{ slug: 54 }] }, known)).toEqual([])
  })
})

describe('buildCatalog', () => {
  it('includes the fields the model ranks on', () => {
    const catalog = buildCatalog([entry('54-mint')])
    expect(catalog).toContain('54-mint')
    expect(catalog).toContain('Mission')
    expect(catalog).toContain('date-night')
    expect(catalog).toContain('Dinner $75')
  })

  it('exposes the query length cap', () => {
    expect(MAX_QUERY_LENGTH).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project worker`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// worker/shortlist.ts
import type { Entry } from '../src/lib/entry.js'

export const MAX_PICKS = 8
export const MAX_QUERY_LENGTH = 400
export const DAILY_LIMIT = 60

export interface Pick {
  slug: string
  reason: string
}

export function buildCatalog(entries: Entry[]): string {
  return entries
    .map((e) => {
      const offers = e.offers.map((o) => `${o.meal} $${o.price}`).join(', ')
      const moods = e.moods.map((m) => m.tag).join(', ')
      return [
        e.slug,
        e.name,
        e.neighborhood,
        e.cuisine,
        offers,
        moods || 'no menu published',
        e.blurb ?? '',
      ]
        .filter(Boolean)
        .join(' | ')
    })
    .join('\n')
}

export function validateShortlist(raw: unknown, knownIds: Set<string>): Pick[] {
  if (typeof raw !== 'object' || raw === null) return []
  const picks = (raw as Record<string, unknown>).picks
  if (!Array.isArray(picks)) return []

  const seen = new Set<string>()
  const out: Pick[] = []

  for (const p of picks) {
    if (typeof p !== 'object' || p === null) continue
    const { slug, reason } = p as Record<string, unknown>
    if (typeof slug !== 'string' || typeof reason !== 'string') continue
    if (!knownIds.has(slug) || seen.has(slug)) continue
    seen.add(slug)
    out.push({ slug, reason })
    if (out.length === MAX_PICKS) break
  }
  return out
}

export const SHORTLIST_SYSTEM_PROMPT = `You pick restaurants for San Francisco Restaurant Week, 16 to 25 October 2026.

You receive a catalog, one restaurant per line, in this shape:
slug | name | neighborhood | cuisine | offers | mood tags | blurb

Return only JSON: { "picks": [{ "slug": string, "reason": string }] }

Rules:
- Use at most ${MAX_PICKS} picks. Fewer is better when fewer genuinely fit.
- "slug" must be copied exactly from the catalog. Never invent one.
- "reason" is one sentence, under 15 words, naming the concrete thing that
  matches the request. Do not restate the request.
- When nothing fits well, return fewer picks rather than padding the list.`
```

```ts
// worker/index.ts
import indexData from '../public/data/index.json' with { type: 'json' }
import type { Entry } from '../src/lib/entry.js'
import {
  buildCatalog,
  DAILY_LIMIT,
  MAX_QUERY_LENGTH,
  SHORTLIST_SYSTEM_PROMPT,
  validateShortlist,
} from './shortlist.js'

export interface Env {
  ASSETS: Fetcher
  KV: KVNamespace
  ANTHROPIC_API_KEY: string
}

const ENTRIES = indexData as unknown as Entry[]
const KNOWN = new Set(ENTRIES.map((e) => e.slug))
const CATALOG = buildCatalog(ENTRIES)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function overDailyLimit(env: Env, ip: string): Promise<boolean> {
  const key = `rate:${ip}:${new Date().toISOString().slice(0, 10)}`
  const used = Number((await env.KV.get(key)) ?? '0')
  if (used >= DAILY_LIMIT) return true
  await env.KV.put(key, String(used + 1), { expirationTtl: 60 * 60 * 25 })
  return false
}

async function shortlist(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let query = ''
  try {
    query = String(((await request.json()) as { query?: unknown }).query ?? '')
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  if (!query.trim()) return json({ error: 'bad_request' }, 400)
  if (query.length > MAX_QUERY_LENGTH) return json({ error: 'query_too_long' }, 400)

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (await overDailyLimit(env, ip)) return json({ error: 'rate_limited' }, 429)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 1000,
        system: [
          { type: 'text', text: SHORTLIST_SYSTEM_PROMPT },
          { type: 'text', text: CATALOG, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: query }],
      }),
    })
    if (!res.ok) return json({ error: 'upstream_failed' }, 502)

    const body = (await res.json()) as { content: Array<{ type: string; text?: string }> }
    const text = body.content.find((c) => c.type === 'text')?.text ?? ''
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    return json({ picks: validateShortlist(parsed, KNOWN) })
  } catch {
    return json({ error: 'upstream_failed' }, 502)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/shortlist') return shortlist(request, env)
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project worker && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/ test/worker/
git commit -m "Add the Claude-backed shortlist endpoint with id validation"
```

---

### Task 9: Board state, filtering and sorting

**Files:**
- Create: `sfrestaurantweek/src/lib/geo.ts` (the two pure functions only; Task 10 adds `requestOrigin`)
- Create: `sfrestaurantweek/src/lib/filter.ts`
- Create: `sfrestaurantweek/src/state/board.ts`
- Test: `sfrestaurantweek/test/filter.test.ts`

**Interfaces:**
- Consumes: `Entry` from Task 7.
- Produces: `Origin = { lat: number; lng: number }`, `distanceMeters(a, b): number`, `walkMinutes(meters): number`; `FilterState`, `EMPTY_FILTERS`, `applyFilters(entries, filters): Entry[]`, `sortEntries(entries, sort, origin): Entry[]`, `SortKey = 'value' | 'price' | 'name' | 'distance'`; signals `entries`, `meta`, `filters`, `sort`, `origin`, `shortlistReasons`, computed `visible`, and `setFilters`, `loadBoard`.

Sorting by distance needs `distanceMeters`, so this task creates `src/lib/geo.ts` with the two pure functions below. Task 10 adds `requestOrigin` to the same file and owns the tests for all three.

- [ ] **Step 1: Write the failing test**

```ts
// test/filter.test.ts
import { describe, expect, it } from 'vitest'
import { applyFilters, EMPTY_FILTERS, sortEntries } from '../src/lib/filter.js'
import type { Entry } from '../src/lib/entry.js'

const make = (over: Partial<Entry>): Entry => ({
  slug: 'x', name: 'X', neighborhood: 'Mission', cuisine: 'Italian',
  diningOptions: ['Indoor Dining'], openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }],
  menuCoverage: 'full', moods: [], blurb: null, vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null, ...over,
})

describe('applyFilters', () => {
  const entries = [
    make({ slug: 'a', neighborhood: 'Mission', offers: [{ meal: 'Lunch', price: 25, courses: 3, dealDelta: 0, medianCourses: 3 }] }),
    make({ slug: 'b', neighborhood: 'Marina', cuisine: 'Japanese', moods: [{ tag: 'date-night', evidence: 'shared plates' }] }),
    make({ slug: 'c', vegetarianFriendly: true }),
  ]

  it('returns everything when nothing is selected', () => {
    expect(applyFilters(entries, EMPTY_FILTERS)).toHaveLength(3)
  })

  it('filters by neighborhood', () => {
    expect(applyFilters(entries, { ...EMPTY_FILTERS, neighborhoods: ['Marina'] }).map((e) => e.slug)).toEqual(['b'])
  })

  it('filters by meal', () => {
    expect(applyFilters(entries, { ...EMPTY_FILTERS, meals: ['Lunch'] }).map((e) => e.slug)).toEqual(['a'])
  })

  it('filters by maximum price across any offer', () => {
    expect(applyFilters(entries, { ...EMPTY_FILTERS, maxPrice: 30 }).map((e) => e.slug)).toEqual(['a'])
  })

  it('filters by mood tag', () => {
    expect(applyFilters(entries, { ...EMPTY_FILTERS, moods: ['date-night'] }).map((e) => e.slug)).toEqual(['b'])
  })

  it('filters by vegetarian friendliness', () => {
    expect(applyFilters(entries, { ...EMPTY_FILTERS, vegetarianOnly: true }).map((e) => e.slug)).toEqual(['c'])
  })

  it('combines filters with AND and can return nothing', () => {
    expect(applyFilters(entries, { ...EMPTY_FILTERS, neighborhoods: ['Marina'], meals: ['Lunch'] })).toEqual([])
  })
})

describe('sortEntries', () => {
  it('ranks a better value above the tier median first', () => {
    const entries = [
      make({ slug: 'par', offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }] }),
      make({ slug: 'good', offers: [{ meal: 'Dinner', price: 75, courses: 5, dealDelta: 2, medianCourses: 3 }] }),
    ]
    expect(sortEntries(entries, 'value', null).map((e) => e.slug)).toEqual(['good', 'par'])
  })

  it('sorts unscored restaurants last rather than treating them as poor value', () => {
    const entries = [
      make({ slug: 'unscored', menuCoverage: 'none', offers: [{ meal: 'Dinner', price: 75, courses: null, dealDelta: null, medianCourses: null }] }),
      make({ slug: 'par', offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }] }),
    ]
    expect(sortEntries(entries, 'value', null).map((e) => e.slug)).toEqual(['par', 'unscored'])
  })

  it('sorts by distance when an origin is known, putting unmapped last', () => {
    const entries = [
      make({ slug: 'far', lat: 37.81, lng: -122.41 }),
      make({ slug: 'unmapped' }),
      make({ slug: 'near', lat: 37.7751, lng: -122.4194 }),
    ]
    const sorted = sortEntries(entries, 'distance', { lat: 37.7749, lng: -122.4194 })
    expect(sorted.map((e) => e.slug)).toEqual(['near', 'far', 'unmapped'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/filter.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/geo.ts  (Task 10 appends requestOrigin to this file)
export interface Origin {
  lat: number
  lng: number
}

const EARTH_RADIUS_M = 6_371_000
const WALK_METRES_PER_SECOND = 1.4

const toRad = (deg: number) => (deg * Math.PI) / 180

export function distanceMeters(a: Origin, b: Origin): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

export function walkMinutes(meters: number): number {
  if (meters <= 0) return 0
  return Math.max(1, Math.round(meters / WALK_METRES_PER_SECOND / 60))
}
```

```ts
// src/lib/filter.ts
import type { Entry } from './entry.js'
import type { MoodTag } from './moods.js'
import type { Meal } from './types.js'
import { distanceMeters, type Origin } from './geo.js'

export type SortKey = 'value' | 'price' | 'name' | 'distance'

export interface FilterState {
  meals: Meal[]
  neighborhoods: string[]
  cuisines: string[]
  diningOptions: string[]
  moods: MoodTag[]
  maxPrice: number | null
  vegetarianOnly: boolean
  shortlist: string[] | null
}

export const EMPTY_FILTERS: FilterState = {
  meals: [],
  neighborhoods: [],
  cuisines: [],
  diningOptions: [],
  moods: [],
  maxPrice: null,
  vegetarianOnly: false,
  shortlist: null,
}

export function applyFilters(entries: Entry[], f: FilterState): Entry[] {
  return entries.filter((e) => {
    if (f.shortlist && !f.shortlist.includes(e.slug)) return false
    if (f.neighborhoods.length && !f.neighborhoods.includes(e.neighborhood)) return false
    if (f.cuisines.length && !f.cuisines.includes(e.cuisine)) return false
    if (f.vegetarianOnly && !e.vegetarianFriendly) return false
    if (f.diningOptions.length && !f.diningOptions.every((d) => e.diningOptions.includes(d))) return false
    if (f.moods.length && !f.moods.every((m) => e.moods.some((claim) => claim.tag === m))) return false
    if (f.meals.length && !e.offers.some((o) => f.meals.includes(o.meal))) return false
    if (f.maxPrice !== null && !e.offers.some((o) => o.price <= f.maxPrice!)) return false
    return true
  })
}

function bestDelta(e: Entry): number | null {
  const deltas = e.offers.map((o) => o.dealDelta).filter((d): d is number => d !== null)
  return deltas.length ? Math.max(...deltas) : null
}

function lowestPrice(e: Entry): number {
  return e.offers.length ? Math.min(...e.offers.map((o) => o.price)) : Number.POSITIVE_INFINITY
}

export function sortEntries(entries: Entry[], sort: SortKey, origin: Origin | null): Entry[] {
  const out = [...entries]

  if (sort === 'name') return out.sort((a, b) => a.name.localeCompare(b.name))
  if (sort === 'price') return out.sort((a, b) => lowestPrice(a) - lowestPrice(b))

  if (sort === 'distance') {
    return out.sort((a, b) => {
      const da = origin && a.lat !== null ? distanceMeters(origin, { lat: a.lat, lng: a.lng! }) : null
      const db = origin && b.lat !== null ? distanceMeters(origin, { lat: b.lat, lng: b.lng! }) : null
      if (da === null && db === null) return a.name.localeCompare(b.name)
      if (da === null) return 1
      if (db === null) return -1
      return da - db
    })
  }

  return out.sort((a, b) => {
    const va = bestDelta(a)
    const vb = bestDelta(b)
    if (va === null && vb === null) return a.name.localeCompare(b.name)
    if (va === null) return 1
    if (vb === null) return -1
    return vb - va
  })
}
```

```ts
// src/state/board.ts
import { computed, signal } from '@preact/signals'
import type { Entry, Meta } from '../lib/entry.js'
import { applyFilters, EMPTY_FILTERS, sortEntries, type FilterState, type SortKey } from '../lib/filter.js'
import type { Origin } from '../lib/geo.js'

export const entries = signal<Entry[]>([])
export const meta = signal<Meta | null>(null)
export const filters = signal<FilterState>(EMPTY_FILTERS)
export const sort = signal<SortKey>('value')
export const origin = signal<Origin | null>(null)
export const shortlistReasons = signal<Map<string, string>>(new Map())

export const visible = computed(() =>
  sortEntries(applyFilters(entries.value, filters.value), sort.value, origin.value),
)

export function setFilters(next: Partial<FilterState>): void {
  filters.value = { ...filters.value, ...next }
}

export async function loadBoard(): Promise<void> {
  const [index, metaJson] = await Promise.all([
    fetch('/data/index.json').then((r) => r.json()),
    fetch('/data/meta.json').then((r) => r.json()),
  ])
  entries.value = index as Entry[]
  meta.value = metaJson as Meta
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/filter.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo.ts src/lib/filter.ts src/state/board.ts test/filter.test.ts
git commit -m "Add board filtering and sorting over the restaurant index"
```

---

### Task 10: Distance, walk time and the near-me control

**Files:**
- Modify: `sfrestaurantweek/src/lib/geo.ts`
- Create: `sfrestaurantweek/src/components/NearMe.tsx`
- Test: `sfrestaurantweek/test/geo.test.ts`

**Interfaces:**
- Consumes: `origin` and `sort` signals from Task 9.
- Produces: `Origin = { lat: number; lng: number }`; `distanceMeters(a, b): number`; `walkMinutes(meters): number`; `requestOrigin(geo: Geolocation | undefined): Promise<Origin>` which rejects with a readable reason.

- [ ] **Step 1: Write the failing test**

```ts
// test/geo.test.ts
import { describe, expect, it } from 'vitest'
import { distanceMeters, requestOrigin, walkMinutes } from '../src/lib/geo.js'

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters({ lat: 37.7749, lng: -122.4194 }, { lat: 37.7749, lng: -122.4194 })).toBe(0)
  })

  it('measures a known short hop within a few percent', () => {
    const d = distanceMeters({ lat: 37.7749, lng: -122.4194 }, { lat: 37.7849, lng: -122.4194 })
    expect(d).toBeGreaterThan(1050)
    expect(d).toBeLessThan(1170)
  })
})

describe('walkMinutes', () => {
  it('converts metres to whole minutes at walking pace', () => {
    expect(walkMinutes(84)).toBe(1)
    expect(walkMinutes(1400)).toBe(17)
  })

  it('never reports zero minutes for a nonzero distance', () => {
    expect(walkMinutes(10)).toBe(1)
  })
})

describe('requestOrigin', () => {
  it('resolves with the browser coordinates', async () => {
    const geo = {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: 37.77, longitude: -122.42 } } as GeolocationPosition),
    } as Geolocation
    await expect(requestOrigin(geo)).resolves.toEqual({ lat: 37.77, lng: -122.42 })
  })

  it('rejects with a readable reason when the person declines', async () => {
    const geo = {
      getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback) =>
        fail?.({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError),
    } as Geolocation
    await expect(requestOrigin(geo)).rejects.toThrow(/location permission was declined/i)
  })

  it('rejects when the browser has no geolocation at all', async () => {
    await expect(requestOrigin(undefined)).rejects.toThrow(/does not support location/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/geo.test.ts`
Expected: FAIL until `requestOrigin` exists.

- [ ] **Step 3: Write the implementation**

Append to the existing `src/lib/geo.ts` created in Task 9. Leave `Origin`, `distanceMeters` and `walkMinutes` exactly as they are.

```ts
// appended to src/lib/geo.ts
export function requestOrigin(geo: Geolocation | undefined): Promise<Origin> {
  if (!geo) return Promise.reject(new Error('This browser does not support location.'))

  return new Promise((resolve, reject) => {
    geo.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        reject(
          new Error(
            err.code === 1
              ? 'Location permission was declined, so distances are hidden.'
              : 'Location is unavailable right now, so distances are hidden.',
          ),
        )
      },
      { timeout: 10_000 },
    )
  })
}
```

```tsx
// src/components/NearMe.tsx
import { signal } from '@preact/signals'
import { origin, sort } from '../state/board.js'
import { requestOrigin } from '../lib/geo.js'

const problem = signal<string | null>(null)
const busy = signal(false)

export function NearMe() {
  async function locate() {
    busy.value = true
    problem.value = null
    try {
      origin.value = await requestOrigin(navigator.geolocation)
      sort.value = 'distance'
    } catch (err) {
      problem.value = (err as Error).message
    } finally {
      busy.value = false
    }
  }

  return (
    <div class="near-me">
      <button type="button" onClick={locate} disabled={busy.value}>
        {busy.value ? 'Finding you' : 'Near me'}
      </button>
      {problem.value && (
        <p class="near-me__problem" role="status">
          {problem.value}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/geo.test.ts test/filter.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo.ts src/components/NearMe.tsx test/geo.test.ts
git commit -m "Add walking distance and a near-me control that degrades when declined"
```

---

### Task 11: Shortlist search with local fallback

**Files:**
- Create: `sfrestaurantweek/src/lib/local-rank.ts`
- Create: `sfrestaurantweek/src/lib/shortlist-client.ts`
- Create: `sfrestaurantweek/src/components/SearchBar.tsx`
- Test: `sfrestaurantweek/test/local-rank.test.ts`
- Test: `sfrestaurantweek/test/shortlist-client.test.ts`

**Interfaces:**
- Consumes: `Entry`, board signals `entries`, `setFilters`, `shortlistReasons`.
- Produces: `localRank(entries, query, limit): Pick[]`; `fetchShortlist(query, entries, fetchImpl?): Promise<ShortlistResult>` where `ShortlistResult = { picks: Pick[]; offline: boolean; notice: string | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/local-rank.test.ts
import { describe, expect, it } from 'vitest'
import { localRank } from '../src/lib/local-rank.js'
import type { Entry } from '../src/lib/entry.js'

const make = (over: Partial<Entry>): Entry => ({
  slug: 'x', name: 'X', neighborhood: 'Mission', cuisine: 'Italian',
  diningOptions: ['Indoor Dining'], openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }],
  menuCoverage: 'full', moods: [], blurb: null, vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null, ...over,
})

describe('localRank', () => {
  const entries = [
    make({ slug: 'sushi', name: 'Sushi Place', cuisine: 'Japanese' }),
    make({ slug: 'pasta', name: 'Pasta Place', cuisine: 'Italian', neighborhood: 'Marina' }),
    make({ slug: 'date', name: 'Candle Room', moods: [{ tag: 'date-night', evidence: 'shared plates' }] }),
  ]

  it('matches on cuisine', () => {
    expect(localRank(entries, 'japanese', 5)[0]!.slug).toBe('sushi')
  })

  it('matches on neighborhood', () => {
    expect(localRank(entries, 'marina', 5)[0]!.slug).toBe('pasta')
  })

  it('matches a mood phrase against the tag', () => {
    expect(localRank(entries, 'date night', 5)[0]!.slug).toBe('date')
  })

  it('returns nothing when no term matches', () => {
    expect(localRank(entries, 'zzzzz', 5)).toEqual([])
  })

  it('respects the limit', () => {
    expect(localRank(entries, 'place', 1)).toHaveLength(1)
  })

  it('gives every pick a reason naming what matched', () => {
    expect(localRank(entries, 'japanese', 5)[0]!.reason).toMatch(/japanese/i)
  })
})
```

```ts
// test/shortlist-client.test.ts
import { describe, expect, it } from 'vitest'
import { fetchShortlist } from '../src/lib/shortlist-client.js'
import type { Entry } from '../src/lib/entry.js'

const entries: Entry[] = [{
  slug: 'pasta', name: 'Pasta Place', neighborhood: 'Marina', cuisine: 'Italian',
  diningOptions: [], openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }],
  menuCoverage: 'full', moods: [], blurb: null, vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null,
}]

describe('fetchShortlist', () => {
  it('returns the server picks when the call succeeds', async () => {
    const ok = async () =>
      new Response(JSON.stringify({ picks: [{ slug: 'pasta', reason: 'Italian in the Marina.' }] }), { status: 200 })
    const result = await fetchShortlist('italian', entries, ok)
    expect(result.offline).toBe(false)
    expect(result.picks).toHaveLength(1)
    expect(result.notice).toBeNull()
  })

  it('falls back to local matching and says so when the server fails', async () => {
    const boom = async () => new Response(JSON.stringify({ error: 'upstream_failed' }), { status: 502 })
    const result = await fetchShortlist('italian', entries, boom)
    expect(result.offline).toBe(true)
    expect(result.picks[0]!.slug).toBe('pasta')
    expect(result.notice).toMatch(/offline matching/i)
  })

  it('names rate limiting specifically so the person knows to wait', async () => {
    const limited = async () => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 })
    const result = await fetchShortlist('italian', entries, limited)
    expect(result.offline).toBe(true)
    expect(result.notice).toMatch(/daily limit/i)
  })

  it('falls back when the network throws outright', async () => {
    const dead = async () => { throw new Error('network down') }
    const result = await fetchShortlist('italian', entries, dead)
    expect(result.offline).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/local-rank.test.ts test/shortlist-client.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/local-rank.ts
import type { Entry } from './entry.js'

export interface Pick {
  slug: string
  reason: string
}

const STOP = new Set(['a', 'an', 'the', 'for', 'with', 'and', 'in', 'on', 'near', 'me', 'to', 'at'])

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
}

export function localRank(entries: Entry[], query: string, limit: number): Pick[] {
  const wanted = terms(query)
  if (!wanted.length) return []

  const scored = entries
    .map((e) => {
      const haystacks: Array<[string, string]> = [
        ['cuisine', e.cuisine],
        ['neighborhood', e.neighborhood],
        ['name', e.name],
        ['mood', e.moods.map((m) => `${m.tag} ${m.evidence}`).join(' ')],
        ['menu', e.blurb ?? ''],
      ]

      const hits: string[] = []
      let score = 0
      for (const [label, text] of haystacks) {
        const lower = text.toLowerCase().replace(/-/g, ' ')
        for (const term of wanted) {
          if (lower.includes(term)) {
            score += 1
            hits.push(`${label}: ${term}`)
          }
        }
      }
      return { entry: e, score, hits }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))

  return scored.slice(0, limit).map((s) => ({
    slug: s.entry.slug,
    reason: `Matched ${s.hits.slice(0, 2).join(' and ')}.`,
  }))
}
```

```ts
// src/lib/shortlist-client.ts
import type { Entry } from './entry.js'
import { localRank, type Pick } from './local-rank.js'

const LIMIT = 8

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface ShortlistResult {
  picks: Pick[]
  offline: boolean
  notice: string | null
}

function fallback(entries: Entry[], query: string, notice: string): ShortlistResult {
  return { picks: localRank(entries, query, LIMIT), offline: true, notice }
}

export async function fetchShortlist(
  query: string,
  entries: Entry[],
  fetchImpl: FetchLike = fetch,
): Promise<ShortlistResult> {
  try {
    const res = await fetchImpl('/api/shortlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })

    if (res.status === 429) {
      return fallback(entries, query, 'The daily limit for smart search is used up, so this is offline matching.')
    }
    if (!res.ok) {
      return fallback(entries, query, 'Smart search is unavailable, so this is offline matching.')
    }

    const body = (await res.json()) as { picks?: Pick[] }
    if (!Array.isArray(body.picks)) {
      return fallback(entries, query, 'Smart search returned nothing usable, so this is offline matching.')
    }
    return { picks: body.picks, offline: false, notice: null }
  } catch {
    return fallback(entries, query, 'Smart search could not be reached, so this is offline matching.')
  }
}
```

```tsx
// src/components/SearchBar.tsx
import { signal } from '@preact/signals'
import { entries, setFilters, shortlistReasons } from '../state/board.js'
import { fetchShortlist } from '../lib/shortlist-client.js'

const MAX_QUERY_LENGTH = 400

const query = signal('')
const notice = signal<string | null>(null)
const busy = signal(false)

export function SearchBar() {
  async function run(event: Event) {
    event.preventDefault()
    if (!query.value.trim()) return

    busy.value = true
    const result = await fetchShortlist(query.value, entries.value)
    busy.value = false

    notice.value = result.picks.length ? result.notice : 'Nothing matched that. Showing everything again.'
    shortlistReasons.value = new Map(result.picks.map((p) => [p.slug, p.reason]))
    setFilters({ shortlist: result.picks.length ? result.picks.map((p) => p.slug) : null })
  }

  function clear() {
    query.value = ''
    notice.value = null
    shortlistReasons.value = new Map()
    setFilters({ shortlist: null })
  }

  return (
    <form class="search" onSubmit={run}>
      <label class="search__label" for="search-input">
        What are you in the mood for?
      </label>
      <input
        id="search-input"
        class="search__input"
        maxLength={MAX_QUERY_LENGTH}
        placeholder="somewhere warm for four people under $50"
        value={query.value}
        onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
      />
      <button type="submit" disabled={busy.value}>
        {busy.value ? 'Thinking' : 'Find me a table'}
      </button>
      <button type="button" onClick={clear}>
        Clear
      </button>
      {notice.value && (
        <p class="search__notice" role="status">
          {notice.value}
        </p>
      )}
    </form>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/local-rank.test.ts test/shortlist-client.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-rank.ts src/lib/shortlist-client.ts src/components/SearchBar.tsx test/
git commit -m "Add shortlist search with offline fallback matching"
```

---

### Task 12: Listing, detail card and the personal layer

**Files:**
- Create: `sfrestaurantweek/src/components/Listing.tsx`
- Create: `sfrestaurantweek/src/components/DetailCard.tsx`
- Create: `sfrestaurantweek/src/components/FilterChips.tsx`
- Modify: `sfrestaurantweek/src/main.tsx`
- Test: `sfrestaurantweek/test/listing-render.test.tsx`

**Interfaces:**
- Consumes: board signals, `MOOD_LABELS`, `distanceMeters`, `walkMinutes`.
- Produces: `Listing`, `DetailCard`, `openDetail(slug: string): Promise<void>`, `FilterChips`. Menu detail loads lazily from `/data/menus/{slug}.json`.

- [ ] **Step 1: Write the failing test**

```tsx
// test/listing-render.test.tsx
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/preact'
import { Listing } from '../src/components/Listing.js'
import { entries, filters, origin, shortlistReasons } from '../src/state/board.js'
import { EMPTY_FILTERS } from '../src/lib/filter.js'
import type { Entry } from '../src/lib/entry.js'

const make = (over: Partial<Entry>): Entry => ({
  slug: 'x', name: 'X', neighborhood: 'Mission', cuisine: 'Italian',
  diningOptions: [], openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }],
  menuCoverage: 'full', moods: [], blurb: null, vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null, ...over,
})

beforeEach(() => {
  filters.value = EMPTY_FILTERS
  origin.value = null
  shortlistReasons.value = new Map()
})

describe('Listing', () => {
  it('states the value comparison in plain words', () => {
    entries.value = [make({ name: 'Four Course', offers: [{ meal: 'Lunch', price: 45, courses: 4, dealDelta: 1, medianCourses: 3 }] })]
    render(<Listing />)
    expect(screen.getByText(/4 courses at \$45/i)).toBeTruthy()
    expect(screen.getByText(/most \$45 lunches are 3/i)).toBeTruthy()
  })

  it('pluralises every meal correctly, including dinner', () => {
    entries.value = [
      make({ slug: 'd', name: 'Dinner Spot', offers: [{ meal: 'Dinner', price: 75, courses: 4, dealDelta: 1, medianCourses: 3 }] }),
      make({ slug: 'b', name: 'Brunch Spot', offers: [{ meal: 'Brunch', price: 35, courses: 3, dealDelta: 0, medianCourses: 3 }] }),
    ]
    render(<Listing />)
    expect(screen.getByText(/most \$75 dinners are 3/i)).toBeTruthy()
    expect(screen.getByText(/most \$35 brunches are 3/i)).toBeTruthy()
    expect(screen.queryByText(/dinneres|brunchs/i)).toBeNull()
  })

  it('says a menu is missing rather than showing invented tags', () => {
    entries.value = [make({ name: 'No Menu', menuCoverage: 'none', offers: [{ meal: 'Dinner', price: 60, courses: null, dealDelta: null, medianCourses: null }] })]
    render(<Listing />)
    expect(screen.getByText(/no menu published/i)).toBeTruthy()
  })

  it('shows mood evidence, not just the tag', () => {
    entries.value = [make({ moods: [{ tag: 'date-night', evidence: 'shared antipasti and a whole-fish secondo' }] })]
    render(<Listing />)
    expect(screen.getByTitle(/shared antipasti and a whole-fish secondo/i)).toBeTruthy()
  })

  it('surfaces a personal review when there is one', () => {
    entries.value = [make({ personal: { rating: 4, yelpUrl: null, excerpt: 'One of my favorites.', visitDate: '2018-11-19T03:17:48+00:00' } })]
    render(<Listing />)
    expect(screen.getByText(/one of my favorites/i)).toBeTruthy()
    expect(screen.getByText(/2018/)).toBeTruthy()
  })

  it('renders a bespoke empty state when filters match nothing', () => {
    entries.value = [make({ neighborhood: 'Mission' })]
    filters.value = { ...EMPTY_FILTERS, neighborhoods: ['Nowhere'] }
    render(<Listing />)
    expect(screen.getByText(/no dishes match that order yet/i)).toBeTruthy()
  })

  it('says why a restaurant has no walk time once a location is known', () => {
    entries.value = [make({ name: 'Unmapped', lat: null, lng: null })]
    origin.value = { lat: 37.7749, lng: -122.4194 }
    render(<Listing />)
    expect(screen.getByText(/address could not be found/i)).toBeTruthy()
  })

  it('does not nag about a missing address before a location is known', () => {
    entries.value = [make({ name: 'Unmapped', lat: null, lng: null })]
    origin.value = null
    render(<Listing />)
    expect(screen.queryByText(/address could not be found/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/listing-render.test.tsx`
Expected: FAIL, module not found. The jsdom environment is already configured by `environmentMatchGlobs` in Task 1.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/Listing.tsx
import { origin, shortlistReasons, visible } from '../state/board.js'
import { distanceMeters, walkMinutes } from '../lib/geo.js'
import { MOOD_LABELS } from '../lib/moods.js'
import { openDetail } from './DetailCard.js'
import type { Entry, EntryOffer } from '../lib/entry.js'
import type { Meal } from '../lib/types.js'

const MEAL_PLURAL: Record<Meal, string> = {
  Brunch: 'brunches',
  Lunch: 'lunches',
  Dinner: 'dinners',
}

function OfferLine({ offer }: { offer: EntryOffer }) {
  if (offer.courses === null) {
    return (
      <span class="offer">
        {offer.meal} ${offer.price}
      </span>
    )
  }
  return (
    <span class="offer">
      {offer.courses} courses at ${offer.price}
      {offer.medianCourses !== null && (
        <em class="offer__median">
          {' '}
          Most ${offer.price} {MEAL_PLURAL[offer.meal]} are {offer.medianCourses}.
        </em>
      )}
    </span>
  )
}

function Row({ entry }: { entry: Entry }) {
  const reason = shortlistReasons.value.get(entry.slug)
  const walk =
    origin.value && entry.lat !== null
      ? walkMinutes(distanceMeters(origin.value, { lat: entry.lat, lng: entry.lng! }))
      : null

  return (
    <article class="row">
      <h2 class="row__name">{entry.name}</h2>
      <p class="row__where">
        {entry.neighborhood} · {entry.cuisine}
        {walk !== null && <span class="row__walk"> · {walk} min walk</span>}
        {origin.value && entry.lat === null && (
          <span class="row__unmapped"> · address could not be found, so no walk time</span>
        )}
      </p>

      {reason && <p class="row__reason">{reason}</p>}

      <div class="row__offers">
        {entry.offers.map((o) => (
          <OfferLine key={`${o.meal}-${o.price}`} offer={o} />
        ))}
      </div>

      {entry.menuCoverage === 'none' ? (
        <p class="row__nomenu">No menu published, so there are no mood tags for this one.</p>
      ) : (
        <ul class="row__moods">
          {entry.moods.map((m) => (
            <li key={m.tag} class="chip" title={m.evidence}>
              {MOOD_LABELS[m.tag]}
            </li>
          ))}
        </ul>
      )}

      {entry.personal && (
        <blockquote class="row__personal">
          <p>{entry.personal.excerpt}</p>
          <footer>
            Lizzie, {new Date(entry.personal.visitDate).getFullYear()}
            {entry.personal.rating !== null && ` · ${entry.personal.rating} stars`}
          </footer>
        </blockquote>
      )}

      <p class="row__links">
        {entry.menuCoverage === 'full' && (
          <button type="button" onClick={() => void openDetail(entry.slug)}>
            See the menu
          </button>
        )}
        {entry.openTableUrl && (
          <a href={entry.openTableUrl} target="_blank" rel="noreferrer">
            Book a table
          </a>
        )}
        {entry.websiteUrl && (
          <a href={entry.websiteUrl} target="_blank" rel="noreferrer">
            Website
          </a>
        )}
      </p>
    </article>
  )
}

export function Listing() {
  if (!visible.value.length) {
    return (
      <div class="empty">
        <p class="empty__headline">No dishes match that order yet.</p>
        <p>Loosen a filter and the kitchen will try again.</p>
      </div>
    )
  }

  return (
    <section class="listing">
      {visible.value.map((e) => (
        <Row key={e.slug} entry={e} />
      ))}
    </section>
  )
}
```

```tsx
// src/components/DetailCard.tsx
import { signal } from '@preact/signals'
import type { Course } from '../lib/entry.js'

const cache = new Map<string, Course[]>()
const openSlug = signal<string | null>(null)
const courses = signal<Course[] | null>(null)

export async function openDetail(slug: string): Promise<void> {
  openSlug.value = slug
  if (cache.has(slug)) {
    courses.value = cache.get(slug)!
    return
  }
  courses.value = null
  try {
    const data = (await fetch(`/data/menus/${slug}.json`).then((r) => r.json())) as { courses: Course[] }
    cache.set(slug, data.courses)
    courses.value = data.courses
  } catch {
    courses.value = []
  }
}

export function DetailCard() {
  if (!openSlug.value) return null

  return (
    <aside class="detail" role="dialog" aria-label="Menu">
      <button type="button" class="detail__close" onClick={() => (openSlug.value = null)}>
        Close
      </button>
      {courses.value === null && <p>Reading the menu</p>}
      {courses.value?.length === 0 && <p>No menu published for this one.</p>}
      {courses.value?.map((course) => (
        <section key={course.name} class="course">
          <h3 class="course__name">{course.name}</h3>
          <ul>
            {course.dishes.map((d) => (
              <li key={d.name}>
                <strong>{d.name}</strong>
                {d.description && <span> {d.description}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  )
}
```

```tsx
// src/components/FilterChips.tsx
import { entries, filters, setFilters, sort } from '../state/board.js'
import { MOOD_LABELS, MOOD_TAGS } from '../lib/moods.js'
import type { SortKey } from '../lib/filter.js'

const SORTS: Array<[SortKey, string]> = [
  ['value', 'Best value'],
  ['distance', 'Nearest'],
  ['price', 'Cheapest'],
  ['name', 'A to Z'],
]

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

export function FilterChips() {
  const neighborhoods = [...new Set(entries.value.map((e) => e.neighborhood))].sort()

  return (
    <div class="filters">
      <fieldset class="filters__group">
        <legend>Mood</legend>
        {MOOD_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            class={filters.value.moods.includes(tag) ? 'chip chip--on' : 'chip'}
            aria-pressed={filters.value.moods.includes(tag)}
            onClick={() => setFilters({ moods: toggle(filters.value.moods, tag) })}
          >
            {MOOD_LABELS[tag]}
          </button>
        ))}
      </fieldset>

      <fieldset class="filters__group">
        <legend>Neighborhood</legend>
        <select
          multiple
          onChange={(e) =>
            setFilters({
              neighborhoods: [...(e.target as HTMLSelectElement).selectedOptions].map((o) => o.value),
            })
          }
        >
          {neighborhoods.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </fieldset>

      <fieldset class="filters__group">
        <legend>Sort</legend>
        {SORTS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            class={sort.value === key ? 'chip chip--on' : 'chip'}
            aria-pressed={sort.value === key}
            onClick={() => (sort.value = key)}
          >
            {label}
          </button>
        ))}
      </fieldset>
    </div>
  )
}
```

```tsx
// src/main.tsx
import { render } from 'preact'
import { loadBoard, meta } from './state/board.js'
import { SearchBar } from './components/SearchBar.js'
import { FilterChips } from './components/FilterChips.js'
import { Listing } from './components/Listing.js'
import { DetailCard } from './components/DetailCard.js'
import { NearMe } from './components/NearMe.js'
import './styles/app.css'

function App() {
  const m = meta.value
  return (
    <>
      <header class="masthead">
        <h1>San Francisco Restaurant Week</h1>
        {m && (
          <p class="masthead__stamp">
            Oct {new Date(m.eventStart).getUTCDate()} to {new Date(m.eventEnd).getUTCDate()}
          </p>
        )}
        {m && (
          <p class="masthead__counts">
            {m.restaurants} restaurants · {m.withMenus} with published menus · {m.mapped} mapped
          </p>
        )}
      </header>
      <SearchBar />
      <NearMe />
      <FilterChips />
      <Listing />
      <DetailCard />
    </>
  )
}

await loadBoard()
render(<App />, document.getElementById('app')!)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/listing-render.test.tsx && npm run typecheck`
Expected: PASS. `src/styles/app.css` does not exist until Task 14; create it empty now so the import resolves, and Task 14 fills it in.

- [ ] **Step 5: Commit**

```bash
git add src/ test/listing-render.test.tsx
git commit -m "Render the listing, menu detail and personal review layer"
```

---

### Task 13: Map view

**Files:**
- Create: `sfrestaurantweek/src/lib/markers.ts`
- Create: `sfrestaurantweek/src/components/MapView.tsx`
- Modify: `sfrestaurantweek/src/main.tsx`
- Test: `sfrestaurantweek/test/map-markers.test.ts`

**Interfaces:**
- Consumes: `visible` computed signal, `openDetail` from Task 12.
- Produces: `toFeatureCollection(entries: Entry[]): FeatureCollection`, `MapView`.

- [ ] **Step 1: Write the failing test**

```ts
// test/map-markers.test.ts
import { describe, expect, it } from 'vitest'
import { toFeatureCollection } from '../src/lib/markers.js'
import type { Entry } from '../src/lib/entry.js'

const make = (over: Partial<Entry>): Entry => ({
  slug: 'x', name: 'X', neighborhood: 'Mission', cuisine: 'Italian',
  diningOptions: [], openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }],
  menuCoverage: 'full', moods: [], blurb: null, vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null, ...over,
})

describe('toFeatureCollection', () => {
  it('maps a located restaurant to a point in lng,lat order', () => {
    const fc = toFeatureCollection([make({ slug: 'a', lat: 37.78, lng: -122.41 })])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [-122.41, 37.78] })
  })

  it('omits restaurants that failed geocoding rather than placing them at zero', () => {
    const fc = toFeatureCollection([make({ slug: 'a' }), make({ slug: 'b', lat: 37.78, lng: -122.41 })])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0]!.properties.slug).toBe('b')
  })

  it('carries the name and lowest price for the popup', () => {
    const fc = toFeatureCollection([
      make({ name: 'Two Offers', lat: 37.78, lng: -122.41, offers: [
        { meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 },
        { meal: 'Lunch', price: 25, courses: 3, dealDelta: 0, medianCourses: 3 },
      ] }),
    ])
    expect(fc.features[0]!.properties).toMatchObject({ name: 'Two Offers', lowestPrice: 25 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/map-markers.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/markers.ts
import type { Entry } from './entry.js'

export interface MarkerProperties {
  slug: string
  name: string
  neighborhood: string
  lowestPrice: number
}

export interface FeatureCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: MarkerProperties
  }>
}

export function toFeatureCollection(entries: Entry[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: entries
      .filter((e): e is Entry & { lat: number; lng: number } => e.lat !== null && e.lng !== null)
      .map((e) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [e.lng, e.lat] as [number, number] },
        properties: {
          slug: e.slug,
          name: e.name,
          neighborhood: e.neighborhood,
          lowestPrice: Math.min(...e.offers.map((o) => o.price)),
        },
      })),
  }
}
```

MapLibre GL v6 is ESM only and has **no default export**, so `import maplibregl from 'maplibre-gl'` does not work. Use named imports. `Map` is exported under its own name and also as `MapLibreMap`; `GeoJSONSource` is exported as a class; `setData` returns a `Promise<void>` rather than the source, so never chain off it.

If the map fails to start in the Playwright test because its web worker cannot load under Vite, import `setWorkerUrl` from the same package and call it once with the worker URL before constructing the map. Consult `https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/` and prove the fix with the e2e test rather than guessing.

```tsx
// src/components/MapView.tsx
import { useEffect, useRef } from 'preact/hooks'
import { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { visible } from '../state/board.js'
import { toFeatureCollection } from '../lib/markers.js'
import { openDetail } from './DetailCard.js'
import 'maplibre-gl/dist/maplibre-gl.css'

const SOURCE = 'restaurants'
const KEY = import.meta.env.VITE_PROTOMAPS_API_KEY as string | undefined

export function MapView() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    if (!container.current || map.current) return

    map.current = new MapLibreMap({
      container: container.current,
      style: KEY
        ? `https://api.protomaps.com/styles/v5/light/en.json?key=${KEY}`
        : {
            version: 8,
            sources: {},
            layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f4efe4' } }],
          },
      center: [-122.4194, 37.7749],
      zoom: 12,
    })

    map.current.on('load', () => {
      map.current!.addSource(SOURCE, { type: 'geojson', data: toFeatureCollection(visible.value) as never })
      map.current!.addLayer({
        id: 'pins',
        type: 'circle',
        source: SOURCE,
        paint: {
          'circle-radius': 6,
          'circle-color': '#b3202c',
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fdfaf2',
        },
      })
      map.current!.on('click', 'pins', (e) => {
        const slug = e.features?.[0]?.properties?.slug
        if (typeof slug === 'string') void openDetail(slug)
      })
    })

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const source = map.current?.getSource(SOURCE) as GeoJSONSource | undefined
    // setData returns a promise in v6. Nothing awaits it, so swallow a rejection
    // rather than leave an unhandled one when the map is torn down mid-update.
    void source?.setData(toFeatureCollection(visible.value) as never).catch(() => {})
  }, [visible.value])

  return <div ref={container} class="map" aria-label="Map of participating restaurants" />
}
```

In `src/main.tsx`, add the toggle:

```tsx
// add to the imports in src/main.tsx
import { signal } from '@preact/signals'
import { MapView } from './components/MapView.js'

const showMap = signal(false)

// inside App(), replace <Listing /> with:
<div class="board">
  <button type="button" class="board__toggle" onClick={() => (showMap.value = !showMap.value)}>
    {showMap.value ? 'Show the list' : 'Show the map'}
  </button>
  {showMap.value ? <MapView /> : <Listing />}
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/map-markers.test.ts && npm run typecheck && npm run build`
Expected: PASS and a clean build.

- [ ] **Step 5: Commit**

```bash
git add src/lib/markers.ts src/components/MapView.tsx src/main.tsx test/map-markers.test.ts
git commit -m "Add a map view over the filtered restaurants"
```

---

### Task 14: Letterpress visual pass

**Files:**
- Create: `sfrestaurantweek/src/styles/tokens.css`
- Modify: `sfrestaurantweek/src/styles/app.css`
- Test: `sfrestaurantweek/test/tokens.test.ts`

**Interfaces:**
- Consumes: the class names used in Tasks 10 to 13.
- Produces: the visual system. No new TypeScript interfaces.

Direction, from the spec: a letterpress prix-fixe menu card. Warm cream stock, near-black ink, one letterpress red used only for prices, active filter state and the date stamp. A display serif against a workhorse sans with real size jumps. Small-caps letter-spaced course headings. Hairline rules between dense listing rows, with air around the detail card. A rotated date stamp sitting off grid. Explicitly avoided: gradients, glassmorphism, emoji icons, evenly sized feature cards, uniform radius and padding, centered symmetry.

- [ ] **Step 1: Write the failing test**

```ts
// test/tokens.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const tokens = readFileSync('src/styles/tokens.css', 'utf8')
const app = readFileSync('src/styles/app.css', 'utf8')

describe('visual tokens', () => {
  it('defines the paper, ink and single accent', () => {
    expect(tokens).toMatch(/--paper:/)
    expect(tokens).toMatch(/--ink:/)
    expect(tokens).toMatch(/--letterpress-red:/)
  })

  it('uses a type scale with real jumps rather than four pixel steps', () => {
    const sizes = [...tokens.matchAll(/--size-[a-z0-9]+:\s*([\d.]+)rem/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThanOrEqual(4)
    const sorted = [...sizes].sort((a, b) => a - b)
    expect(sorted.at(-1)! / sorted[0]!).toBeGreaterThan(3)
  })

  it('pairs a display face with a separate text face', () => {
    expect(tokens).toMatch(/--font-display:/)
    expect(tokens).toMatch(/--font-text:/)
  })

  it('ships none of the generated-looking tells', () => {
    const css = tokens + app
    expect(css).not.toMatch(/linear-gradient|backdrop-filter/)
    expect(css).not.toMatch(/\uD83D[\uDE00-\uDE4F]/)
  })

  it('gives the date stamp a rotation so it sits off grid', () => {
    expect(app).toMatch(/\.masthead__stamp[\s\S]*?rotate\(/)
  })

  it('declares a visible focus style for keyboard users', () => {
    expect(app).toMatch(/:focus-visible/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tokens.test.ts`
Expected: FAIL, `tokens.css` not found.

- [ ] **Step 3: Write the styles**

```css
/* src/styles/tokens.css */
:root {
  --paper: #fdfaf2;
  --paper-shade: #f4efe4;
  --ink: #171310;
  --ink-soft: #5a5149;
  --rule: #d8cfbd;
  --letterpress-red: #b3202c;

  --font-display: 'Playfair Display', 'Hoefler Text', Georgia, serif;
  --font-text: 'Inter', -apple-system, 'Segoe UI', system-ui, sans-serif;

  --size-xs: 0.75rem;
  --size-s: 0.875rem;
  --size-m: 1rem;
  --size-l: 1.5rem;
  --size-xl: 2.5rem;
  --size-display: 4rem;

  --gutter: 1rem;
  --row-pad: 0.6rem;
  --card-pad: 2.25rem;
}
```

```css
/* src/styles/app.css */
@import './tokens.css';

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-text);
  font-size: var(--size-m);
  line-height: 1.45;
}

/* Paper grain, kept behind text at low opacity so contrast is untouched. */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.035;
  background-image: radial-gradient(var(--ink) 0.5px, transparent 0.5px);
  background-size: 3px 3px;
}

:focus-visible {
  outline: 2px solid var(--letterpress-red);
  outline-offset: 2px;
}

.masthead {
  position: relative;
  padding: 3rem var(--gutter) 1.25rem;
  border-bottom: 2px solid var(--ink);
}

.masthead h1 {
  margin: 0;
  max-width: 14ch;
  font-family: var(--font-display);
  font-size: var(--size-display);
  font-weight: 700;
  line-height: 0.95;
  letter-spacing: -0.02em;
}

.masthead__stamp {
  position: absolute;
  top: 2.25rem;
  right: var(--gutter);
  transform: rotate(-7deg);
  padding: 0.3rem 0.7rem;
  border: 2px solid var(--letterpress-red);
  color: var(--letterpress-red);
  font-size: var(--size-s);
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.masthead__counts {
  margin: 0.75rem 0 0;
  color: var(--ink-soft);
  font-size: var(--size-s);
}

.search {
  padding: 1.25rem var(--gutter);
  border-bottom: 1px solid var(--rule);
}
.search__label {
  display: block;
  font-size: var(--size-s);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.search__input {
  width: min(100%, 36rem);
  margin: 0.5rem 0;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--ink);
  border-radius: 0;
  background: var(--paper);
  font: inherit;
}
.search__notice {
  color: var(--letterpress-red);
  font-size: var(--size-s);
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  padding: 1rem var(--gutter);
  border-bottom: 1px solid var(--rule);
}
.filters__group {
  margin: 0;
  padding: 0;
  border: 0;
}
.filters__group legend {
  color: var(--ink-soft);
  font-size: var(--size-xs);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.chip {
  margin: 0.25rem 0.25rem 0 0;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--rule);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: var(--size-s);
  cursor: pointer;
}
.chip--on {
  border-color: var(--letterpress-red);
  color: var(--letterpress-red);
  font-weight: 600;
}

/* The listing is deliberately dense; the detail card gets the air. */
.row {
  padding: var(--row-pad) var(--gutter);
  border-bottom: 1px solid var(--rule);
}
.row__name {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--size-l);
  font-weight: 600;
}
.row__where {
  margin: 0.1rem 0;
  color: var(--ink-soft);
  font-size: var(--size-s);
}
.row__unmapped {
  font-style: italic;
}
.row__reason {
  margin: 0.3rem 0;
  font-style: italic;
}
.row__offers {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  font-variant-numeric: tabular-nums;
}
.offer {
  color: var(--letterpress-red);
  font-weight: 600;
}
.offer__median {
  color: var(--ink-soft);
  font-style: normal;
  font-weight: 400;
}
.row__nomenu {
  margin: 0.3rem 0;
  color: var(--ink-soft);
  font-size: var(--size-s);
}
.row__moods {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0.4rem 0 0;
  padding: 0;
  list-style: none;
}
.row__personal {
  margin: 0.6rem 0 0;
  padding-left: 0.9rem;
  border-left: 3px solid var(--letterpress-red);
  font-size: var(--size-s);
}
.row__links {
  display: flex;
  gap: 1rem;
  margin: 0.5rem 0 0;
  font-size: var(--size-s);
}

.detail {
  padding: var(--card-pad);
  border-top: 2px solid var(--ink);
  background: var(--paper-shade);
}
.course__name {
  margin: 1.25rem 0 0.4rem;
  font-size: var(--size-s);
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.empty {
  max-width: 32ch;
  padding: 4rem var(--gutter);
}
.empty__headline {
  margin: 0 0 0.5rem;
  font-family: var(--font-display);
  font-size: var(--size-xl);
}

.map {
  height: 70vh;
}

@media (max-width: 420px) {
  :root {
    --gutter: 1rem;
    --size-display: 2.5rem;
  }
  .masthead__stamp {
    position: static;
    display: inline-block;
    margin-top: 0.75rem;
  }
}
```

- [ ] **Step 4: Run tests and check the real page**

Run: `npx vitest run test/tokens.test.ts && npm run build && npm run dev`
Expected: PASS and a clean build. Open the dev server, check at 1440px and 320px, and confirm no horizontal scroll at 320px.

- [ ] **Step 5: Commit**

```bash
git add src/styles/ test/tokens.test.ts
git commit -m "Apply the letterpress prix-fixe visual system"
```

---

### Task 15: End to end tests and release verification

**Files:**
- Create: `sfrestaurantweek/playwright.config.ts`
- Create: `sfrestaurantweek/e2e/board.spec.ts`
- Create: `sfrestaurantweek/README.md`

**Interfaces:**
- Consumes: the built site.
- Produces: `npm run test:e2e`.

- [ ] **Step 1: Write the config and the failing specs**

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
})
```

```ts
// e2e/board.spec.ts
import { expect, test } from '@playwright/test'

test('lists every participating restaurant on load', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.row')).toHaveCount(174)
})

test('filtering by mood narrows the board', async ({ page }) => {
  await page.goto('/')
  const before = await page.locator('.row').count()
  await page.getByRole('button', { name: 'Date night' }).click()
  const after = await page.locator('.row').count()
  expect(after).toBeLessThan(before)
  expect(after).toBeGreaterThan(0)
})

test('a shortlist query returns ranked picks with reasons', async ({ page }) => {
  await page.route('**/api/shortlist', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ picks: [{ slug: '54-mint', reason: 'Italian near the theater district.' }] }),
    }),
  )
  await page.goto('/')
  await page.getByLabel('What are you in the mood for?').fill('italian before a show')
  await page.getByRole('button', { name: 'Find me a table' }).click()
  await expect(page.locator('.row')).toHaveCount(1)
  await expect(page.getByText('Italian near the theater district.')).toBeVisible()
})

test('a failed shortlist falls back to local matching and says so', async ({ page }) => {
  await page.route('**/api/shortlist', (route) => route.fulfill({ status: 502, body: '{}' }))
  await page.goto('/')
  await page.getByLabel('What are you in the mood for?').fill('japanese')
  await page.getByRole('button', { name: 'Find me a table' }).click()
  await expect(page.getByText(/offline matching/i)).toBeVisible()
  await expect(page.locator('.row').first()).toBeVisible()
})

test('the map view renders', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Show the map' }).click()
  await expect(page.locator('.map canvas')).toBeVisible()
})

test('the page does not scroll sideways on a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})
```

- [ ] **Step 2: Run the specs**

Run: `npx playwright install --with-deps chromium && npm run test:e2e`
Expected: failures only where behavior is genuinely missing. Fix those, then re-run until green.

- [ ] **Step 3: Write the README**

````markdown
# SF Restaurant Week finder

A site for picking where to eat during San Francisco Restaurant Week,
16 to 25 October 2026. It takes the 174 participating restaurants and adds the
three things the official listing cannot answer: what is near you, what is a
good deal, and what suits the evening you have in mind.

## Running it

```bash
npm install
npm run dev          # Vite dev server
npm test             # unit and component tests
npm run test:e2e     # Playwright, against a built preview
npm run typecheck    # tsc --noEmit
npm run preview      # build, then serve through the real Worker
npm run deploy       # test, build, wrangler deploy
```

## The data pipeline

`public/data/` is generated, committed, and never edited by hand. Rebuild it with
`npm run data`, which chains six scripts:

| Script | Does |
|---|---|
| `01-scrape-list` | Parses the official listing into 174 records |
| `02-fetch-menus` | Pulls each published menu as a PDF and extracts its text |
| `03-resolve-places` | Resolves coordinates with Google Places Text Search |
| `04-link-reviews` | Matches entries against Lizzie's own Yelp export |
| `05-extract-and-tag` | Has Claude read each menu for courses and mood tags |
| `06-build-index` | Merges everything into the shipped JSON |

Each writes an errors CSV listing what it could not process. Read
`data/04-matches.csv` by eye: name matching is the one step that can be
confidently wrong.

## Keys

Copy `.env.example` to `.env` and fill it in. The build scripts read `.env`
automatically, so no command needs an inline key.

The Worker cannot read `.env`, so it needs its own copy of the Anthropic key:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

The KV namespace used for rate limiting already exists and its id is in
`wrangler.jsonc` under the `KV` binding. A namespace id is not a secret. API
keys are, and never belong in that file.

## Data policy

Only place ids, addresses and coordinates are kept from Google Places. Ratings,
reviews, photos and price levels are never stored, because the Places policy does
not allow it. Google's terms cap coordinate caching at 30 days, so the pipeline is
re-run per event.

Review prose comes from Lizzie's own Yelp export, which carries no such
restriction. No Yelp or Google review text is scraped or stored.
````

- [ ] **Step 4: Run the full verification**

Run: `npm test && npm run typecheck && npm run build && npm run test:e2e`
Expected: all green. Report any suite that cannot run rather than calling the work done.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e/ README.md
git commit -m "Add end to end tests and the project README"
```

---

## Verification before calling this done

Run all of these from `sfrestaurantweek/` and paste the real output:

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Then confirm by hand:

- `public/data/meta.json` reports 174 restaurants and roughly 122 with menus.
- Five random mood evidence strings genuinely appear in that restaurant's menu.
- `data/04-matches.csv` contains no wrong pairing.
- The site has no horizontal scroll at 320px.
- `grep -rl "sk-ant" dist/` returns nothing.
