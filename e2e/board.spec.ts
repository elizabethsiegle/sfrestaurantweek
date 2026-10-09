import { expect, test, type Page } from '@playwright/test'

type Seed = Record<string, unknown>

const MENU = { courses: [{ name: 'First', dishes: [{ name: 'Burrata', description: 'with peaches' }] }] }

// Serves the real index with its first rows patched, so the fixture keeps the shipped shape.
async function seedIndex(page: Page, patch: (row: Seed, i: number) => Seed): Promise<void> {
  await page.route('**/data/index.json', async (route) => {
    const response = await route.fetch()
    const rows = ((await response.json()) as Seed[]).slice(0, 12).map(patch)
    await route.fulfill({ response, json: rows })
  })
}

const withMoodsAndPins = (row: Seed, i: number): Seed => ({
  ...row,
  menuCoverage: 'full',
  lat: 37.77 + i * 0.001,
  lng: -122.42,
  moods: i < 3 ? [{ tag: 'date-night', evidence: 'Burrata' }] : [],
})

const search = async (page: Page, text: string) => {
  await page.getByLabel('What are you in the mood for?').fill(text)
  await page.getByRole('button', { name: 'Find me a table' }).click()
}

test('lists every participating restaurant on load', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.row')).toHaveCount(174)
})

test('hides the Mood group while no restaurant has a mood tag', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.row')).toHaveCount(174)
  await expect(page.getByText('Mood', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Date night' })).toHaveCount(0)
})

test('filtering by mood narrows the board when moods exist', async ({ page }) => {
  await seedIndex(page, withMoodsAndPins)
  await page.goto('/')
  await expect(page.locator('.row')).toHaveCount(12)
  await page.getByRole('button', { name: 'Date night' }).click()
  await expect(page.locator('.row')).toHaveCount(3)
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
  await search(page, 'italian before a show')
  await expect(page.locator('.row')).toHaveCount(1)
  await expect(page.getByText('Italian near the theater district.')).toBeVisible()
})

test('the board keeps the order the picks came back in', async ({ page }) => {
  const picks = [
    { slug: 'abaca', reason: 'Filipino tasting plates, open late.' },
    { slug: '54-mint', reason: 'Italian near the theater district.' },
    { slug: 'a-mano', reason: 'Pasta made in the window.' },
  ]
  await page.route('**/api/shortlist', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ picks }) }),
  )
  await page.goto('/')
  await search(page, 'somewhere for three')
  await expect(page.locator('.row__name')).toHaveText(['Abaca', '54 Mint', 'a Mano'])

  await expect(page.getByRole('button', { name: 'Top picks' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'A to Z' }).click()
  await expect(page.locator('.row__name')).toHaveText(['54 Mint', 'a Mano', 'Abaca'])
})

test('a failed shortlist falls back to local matching and says so', async ({ page }) => {
  await page.route('**/api/shortlist', (route) => route.fulfill({ status: 502, body: '{}' }))
  await page.goto('/')
  await search(page, 'japanese')
  await expect(page.getByText(/offline matching/i)).toBeVisible()
  await expect(page.locator('.row').first()).toBeVisible()
})

test('with the real endpoint and no key, search gives the offline notice and a usable board', async ({ page }) => {
  await page.goto('/')
  await search(page, 'japanese')
  await expect(page.getByRole('status').filter({ hasText: /offline matching/i })).toBeVisible()
  const rows = await page.locator('.row').count()
  expect(rows).toBeGreaterThan(0)
  expect(rows).toBeLessThan(174)
})

test('the search placeholder is a query the site can answer', async ({ page }) => {
  await page.goto('/')
  const placeholder = await page.locator('#search-input').getAttribute('placeholder')
  expect(placeholder).toBeTruthy()
  await search(page, placeholder as string)
  await expect(page.getByRole('status').filter({ hasText: /restaurants? shown/i })).toBeVisible()
  await expect(page.getByText(/nothing matched/i)).toHaveCount(0)
  expect(await page.locator('.row').count()).toBeGreaterThan(0)
})

test('the map renders and says why it has no pins', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await expect(page.locator('.map canvas')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/locations are not available yet/i)).toBeVisible()
})

test('the map drops the no-pins note once restaurants have coordinates', async ({ page }) => {
  await seedIndex(page, withMoodsAndPins)
  await page.goto('/')
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await expect(page.locator('.map canvas')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/locations are not available yet/i)).toHaveCount(0)
  await expect(page.getByText(/none of these restaurants have a location/i)).toHaveCount(0)
})

test('the menu card opens by keyboard, closes on Escape and returns focus', async ({ page }) => {
  await seedIndex(page, withMoodsAndPins)
  await page.route('**/data/menus/*.json', (route) => route.fulfill({ json: MENU }))
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'See the menu' }).first()
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toBeFocused()
  await expect(dialog.getByText('Burrata')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

for (const width of [1280, 320]) {
  test(`no console errors on load at ${width}px`, async ({ page }) => {
    const problems: string[] = []
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
    page.on('pageerror', (e) => problems.push(e.message))
    await page.setViewportSize({ width, height: 720 })
    await page.goto('/')
    await expect(page.locator('.row')).toHaveCount(174)
    expect(problems).toEqual([])
  })
}

test('every filter group opens behind the phone disclosure at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/')
  await expect(page.locator('.row').first()).toBeVisible()
  await expect(page.locator('#filters-panel')).not.toBeVisible()

  await page.getByRole('button', { name: 'Filters and sorting' }).click()
  await expect(page.locator('.filters__group legend')).toHaveText([
    'Meal', 'Price', 'Neighborhood', 'Cuisine', 'Dining', 'Dietary', 'Sort',
  ])
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})

test('the page does not scroll sideways on a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/')
  await expect(page.locator('.row').first()).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})
