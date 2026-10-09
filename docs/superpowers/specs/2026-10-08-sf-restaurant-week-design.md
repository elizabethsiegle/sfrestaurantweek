# SF Restaurant Week finder: design spec

Date: 2026-10-08
Status: approved for planning

## 1. What this is

A public website on Cloudflare Workers that helps a person decide where to eat
during San Francisco Restaurant Week, 16 to 25 October 2026.

The official listing at `https://www.sfrestaurantweek.com/restaurants/` publishes
174 participating restaurants behind four dropdown filters. It cannot answer the
questions people actually ask: what is near me, what is a good deal, and what
suits the evening I have in mind.

This site answers those three. A visitor types what they want in plain language,
gets a short ranked list with a reason for each pick, and can then keep
tightening the result with ordinary filters, or ignore the text box entirely and
browse.

All restaurant data is collected once at build time and shipped as static JSON.
The only runtime network call is the natural language ranking request.

### The data, measured

Counted from the live listing page on 2026-10-08.

| Quantity | Count |
|---|---|
| Participating restaurants | 174 |
| Restaurants with a published menu | 123, across 122 distinct menus |
| Restaurants with an OpenTable link | 121 |
| Restaurants with a website link | 172 |
| Distinct neighborhoods used | 42 (of 68 offered) |
| Distinct cuisines used | 34 (of 54 offered) |
| Prix-fixe offers | 272 across 174 restaurants (1 to 5 each) |
| Restaurants Lizzie has reviewed | 23, covering 25 visits |

Offers by meal: 164 dinner, 80 lunch, 28 brunch.

Price tiers in use: brunch $15 to $45, lunch $15 to $45, dinner $30 to $90. The
largest single tier is dinner $75 with 48 offers; the smallest is brunch $15 with
one.

Dining options as the site tags them: Indoor Dining 170, Outdoor Dining 82,
Takeout 31, Delivery 15, **Vegetarian Options 3**.

### The three gaps this design exists to close

1. **No coordinates.** The listing gives a neighborhood name and no address. The
   site's own map endpoint rejects requests from outside its pages. Without
   coordinates there is no distance, no walk time, and no map.

2. **No way to judge a deal.** The listing shows "Dinner $75" with nothing to
   compare it against. A three-course $75 and a five-course $75 look identical.

3. **No sense of occasion, and a broken dietary filter.** Nothing in the data
   describes atmosphere or who a place suits. The one dietary field that exists,
   Vegetarian Options, is set on 3 of 174 restaurants, so filtering by it hides
   98% of the list and tells the visitor nothing true.

All three are resolved once, at build time, by the pipeline in section 5.

## 2. Decisions already taken

| Decision | Choice | Why |
|---|---|---|
| Product shape | Ranked shortlist living inside a filterable board | Opens with the natural language moment, stays browsable on repeat visits, and remains fully usable if the ranking call fails. |
| Coordinates | Google Places Text Search at build time | Real geocoding. Inferred coordinates are routinely blocks off, which is fatal for walk time. Reuses the working pattern and key from `yelp-map-lizzies-reviews`. |
| Menu text | menumodo print endpoint, parsed from PDF | The only machine-readable source of the actual dishes. No new dependency needed to read it. |
| Review prose | Lizzie's own Yelp export | Yelp's API has no free tier and caps caching at 24 hours; Google's Places policy forbids storing review content. Lizzie's own writing carries neither restriction and covers 23 of the 174. |
| Mood and course structure | One Claude pass over each menu at build time | Mangled PDF text defeats regular expressions. A structured extraction returns courses, dishes and tags together, in one pass. |
| Natural language ranking | Claude Sonnet 5.5 in a Worker, catalog as a cached prompt prefix | Keeps the API key off the client, makes repeat queries cheap, and keeps the ranking quality that makes the feature worth having. |
| Stack | Vite, React, TypeScript, Cloudflare Worker | Matches `yelp-map-lizzies-reviews`, which already works and is already understood. |
| Visual direction | Letterpress prix-fixe card | On subject, and deliberately distinct from the diner placemat used by `yelp-map-lizzies-reviews`. Detailed in section 10. |
| Built data | Committed to the repository | The event runs 10 days. Committing `public/data` lets the site build and deploy without API keys or the sibling project present. |

## 3. Scope

In scope for v1:

- Natural language shortlist with a one-line reason per pick
- Filters: meal, price tier, neighborhood, cuisine, dining option, mood tag,
  dietary
- Sort: best value, nearest, price, name
- Map view with walk time from the visitor's position
- Restaurant detail showing the full prix-fixe menu, course by course
- Lizzie's own review shown on the 23 restaurants she has written about
- Booking handoff to OpenTable where a link exists

Out of scope for v1:

- Accounts, saved lists that persist across devices, notifications
- Live availability or reservation booking inside the site
- Any data source that forbids storage, including Yelp and Google review text
- Years other than 2026

## 4. Architecture

```
sfrestaurantweek/
  scripts/        build-time pipeline, numbered, each runnable alone
  data/           raw and intermediate artifacts (gitignored)
  public/data/    shipped JSON (committed)
  src/            React application
  worker/         Cloudflare Worker: static assets plus POST /api/shortlist
  test/           vitest unit tests and fixtures
  e2e/            Playwright tests
```

Build time does all collection, geocoding, extraction and tagging. Runtime serves
static JSON and brokers exactly one live model call. A visitor who never uses the
text box causes no model calls at all.

## 5. Build pipeline

Each script reads the previous stage's file and writes its own. Each is
independently re-runnable. Each writes a `.errors.csv` naming every record it
could not process, following the `02-unresolved.csv` precedent in
`yelp-map-lizzies-reviews`.

### 01-scrape-list

Input: the listing page HTML.
Output: `data/01-restaurants.json`, 174 records.

Parses each `restaurant-list-data-row` into name, neighborhood, cuisine, dining
options, offers, menu id, OpenTable URL and website URL. Offers parse from
strings like `Dinner $75` into `{ meal, price }`.

Fails the run if the count drops below 150 or the row markup no longer matches,
rather than silently shipping a short list.

### 02-fetch-menus

Input: `data/01-restaurants.json`.
Output: `data/02-menus.json`, raw text per restaurant.

For each of the 123 restaurants with a menu id, fetch
`menumodo.com/app.php/viewer/index/{menuId}`, read `config.menu_id` from the page,
then fetch `app.php/menu/html_print/{menu_id}/SF_RESTAURANT_WEEK`, which returns a
PDF.

Text comes out of the PDF by inflating its Flate streams and reading the text
showing operators. This needs only `zlib` from the standard library. No PDF
dependency is added.

The extracted text has irregular inter-letter spacing, a property of how the PDF
positions glyphs. It is not normalized here. The 05 extraction pass reads it as
is.

Menus are keyed by menu id, not by restaurant, because the two are not
one-to-one: Delarosa Marina and Delarosa Yerba Buena share menu id 13371. 123
restaurants carry a menu id across 122 distinct menus. Each menu is fetched and
extracted once and referenced by every restaurant that points at it.

Requests are serialized with a delay between them. Restaurants without a menu id
are recorded with `menuCoverage: "none"` and carried forward unchanged.

### 03-resolve-places

Input: `data/01-restaurants.json`.
Output: `data/03-resolved.json`, plus `03-unresolved.csv`.

Google Places Text Search on `"{name}, {neighborhood}, San Francisco"` returns a
place id, a formatted address and coordinates. Results outside a bounding box
around the Bay Area are rejected rather than accepted, because a wrong pin is
worse than a missing one.

Only place id, address and coordinates are kept. No ratings, review text, photos
or price levels are stored, because Google's Places policy does not permit it.

Responses are cached to `data/cache/places/` so re-runs cost nothing.

### 04-link-reviews

Input: `data/01-restaurants.json` and the yelp-map export.
Output: `data/04-personal.json`, 23 records.

Matches on a normalized name, dropping punctuation, accents and the filler words
`the`, `restaurant`, `sf`, `san francisco`, `cafe`, `bar`, `grill`, `kitchen`.

The source path is read from `YELP_EXPORT_PATH`, defaulting to the sibling
project. When the file is absent the script writes an empty result and the site
builds without the personal layer.

Every match is written to `04-matches.csv` for eyeball review. Name matching is
the one step in this pipeline that can be confidently wrong, so its output is
made easy to check.

### 05-extract-and-tag

Input: `data/02-menus.json`.
Output: `data/05-tagged.json`.

One Claude call per restaurant with a menu, returning structured JSON:

- `courses`: ordered course names with their dish choices and descriptions
- `moods`: tags from the closed vocabulary in section 6, each with a short
  evidence string quoting the menu
- `dietary`: `vegetarianFriendly`, `veganFriendly`, `glutenFreeFriendly`, each
  with evidence
- `blurb`: one sentence describing the meal

The prompt states that tags must be supported by the menu, and that returning
fewer tags is correct when the menu does not support more. Responses are
validated against a schema; a response that fails validation is retried once,
then recorded as an error rather than guessed at.

Results cache by menu id so re-runs are free.

Restaurants without a menu receive no mood tags and no deal score. They are not
given inferred tags.

### 06-build-index

Input: all of the above.
Output: `public/data/index.json`, `public/data/meta.json`,
`public/data/menus/{slug}.json`.

`index.json` carries everything the list, filters and map need. Full course
detail lives in per-restaurant files loaded when a card is opened, so the first
paint stays small.

`meta.json` carries counts, the event dates, the build timestamp and the menu
coverage figure. Every number shown in the interface is read from this file. None
is written into a component.

## 6. Mood vocabulary

A closed set, so tags can be filter chips:

`date-night`, `big-group`, `solo-friendly`, `business-dinner`, `celebration`,
`comfort-food`, `light-and-fresh`, `adventurous`, `vegetarian-friendly`,
`pre-theater`.

**Every tag carries evidence.** Not `date-night`, but `date-night` with
"three shared antipasti and a whole-fish secondo for two". The interface shows the
evidence on hover and in the detail view.

This is the rule that makes the feature defensible. A tag nobody can justify
collapses the moment someone asks why it is there. Where the menu does not support
a tag, the tag is absent, and a restaurant with no menu shows "no menu published"
rather than a guess.

## 7. Deal score

For each offer, the extraction pass gives a course count. The score compares that
count against the median course count across all offers in the same meal and
price tier.

```
value = courses - median(courses for all offers at this meal and price)
```

Displayed as plain fact: "4 courses at $45. Most $45 lunches are 3." Sorting by
best value orders on this difference.

Tiers with fewer than five offers show the course count without a comparison,
because a median over three samples is not a claim worth making. No assertion is
made about a restaurant's ordinary prices, because that data belongs to Google and
may not be stored.

## 8. Runtime: the shortlist API

`POST /api/shortlist` with `{ query, filters }`.

The Worker builds a prompt whose prefix is a compact catalog of all 174
restaurants, roughly 120 tokens each, marked for prompt caching. The query and any
active filters follow. Claude Sonnet 5.5 returns up to 8 restaurant ids, each with
a one-line reason.

The cached prefix means the catalog is paid for once and reused, which keeps
repeat queries fast and cheap.

Guards:

- Query capped at 400 characters
- Per-IP daily cap in Workers KV, 60 queries
- Only POST, only JSON, ids validated against the known set before returning

Returned ids that do not exist are dropped rather than passed to the client.

**Fallback.** If the call fails or the cap is reached, the client ranks locally by
matching query terms against mood tags, cuisine, neighborhood and menu text, and
shows a visible notice that it is using offline matching. The board stays fully
usable: the shortlist is an accelerator, never a gate.

## 9. Location

Geolocation is requested only when the visitor presses "near me", never on load.

Distance is haversine against the geocoded coordinates, presented as walk time at
1.4 metres per second, rounded to the nearest minute. Walk time is shown rather
than raw distance because it is the form the decision actually takes.

The map is MapLibre with Protomaps tiles, matching the existing setup, offered as
a toggle beside the list rather than as the centerpiece. Restaurants that failed
geocoding appear in the list, are excluded from distance sorting, and say why.

## 10. Visual direction

A letterpress prix-fixe menu card.

- Warm cream stock with a faint paper grain, ink near-black rather than pure black
- One accent: letterpress red, used for prices, the active filter state and the
  date stamp. Nothing else is colored.
- A display serif for restaurant names and course headings against a workhorse
  sans for data and controls. Real size jumps, not a flat ramp.
- Course headings in small caps with letter spacing, following the printed menus
  the data comes from
- Hairline rules between listing rows; the listing is dense and tabular while the
  detail card is given air. The density contrast carries the layout.
- A rotated date stamp reading "OCT 16 to 25" sitting slightly off grid
- Empty state is a blank menu card reading "no dishes match that order yet"

Explicitly avoided: gradient fills, glassmorphism, emoji in place of icons, evenly
sized feature cards, uniform radius and padding throughout, centered symmetry.

Accessibility is not traded away for the aesthetic: text contrast meets WCAG AA,
focus states are visible, the paper grain sits behind text at low opacity, and the
layout works at 320px with a real mobile treatment rather than a squeezed desktop.

## 11. Testing

Unit tests, vitest, against fixtures saved in `test/fixtures` so that no test
touches the network:

- Listing row parser, including a truncated page and a changed class name
- PDF text extraction against a saved menu PDF
- Offer string parsing, including unexpected formats
- Deal score, including a tier with too few offers to compare
- Haversine and walk time
- Filter reducer, including combinations that match nothing
- Shortlist response validation, including unknown ids and malformed JSON

Playwright, against the built site with the API mocked:

- Loads and lists restaurants
- Filtering by price tier narrows the list
- A shortlist query returns ranked results with reasons
- Shortlist failure falls back to local matching and says so
- Opening a card loads and shows the menu
- Map toggle renders pins

Also run: `tsc --noEmit` and lint. All of these must pass before the work is
called done.

## 12. Error handling

- Pipeline scripts fail loudly on structural change, such as the listing markup
  no longer matching, rather than writing a short file.
- Every script writes an errors CSV naming the records it could not process.
- Missing menu, failed geocode and absent personal review are first class states
  in the data model, each rendered as an explicit statement in the interface.
- The Worker returns a typed error body; the client distinguishes rate limiting
  from upstream failure and says which happened.
- No secret is ever sent to the browser. The Anthropic key lives only in Worker
  environment configuration.

## 13. Risks

| Risk | Handling |
|---|---|
| The listing page changes shape mid-event | 01 fails loudly on a count drop or markup mismatch. Re-scraping is one command. |
| menumodo blocks automated fetching | 51 restaurants already lack menus and the site works for them. Coverage degrades, the product does not break. |
| Google's terms cap coordinate caching at 30 days | The event runs 10 days. The pipeline is re-run per event, which is required anyway. Noted in the README. |
| Name matching to the Yelp export is wrong | Matches are written to a CSV for review. The personal layer is additive, so an error is visible and harmless. |
| Mood tags read as arbitrary | Every tag carries menu evidence, shown in the interface. Tags without support are not emitted. |
| Model call cost or abuse | Cached prompt prefix, 400 character cap, 60 per IP per day, and a local fallback that keeps the site working. |
