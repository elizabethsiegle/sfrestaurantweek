# SF Restaurant Week finder

A site for picking where to eat during San Francisco Restaurant Week,
16 to 25 October 2026. It takes the 174 participating restaurants and adds the
three things the official listing cannot answer: what is near you, what is a
good deal, and what suits the evening you have in mind.

## Current state

The shipped data is incomplete until two API keys are set up.

- **Coordinates** need `GOOGLE_MAPS_API_KEY`.
- **Mood tags** need `ANTHROPIC_API_KEY`.

Without them the site shows all 174 restaurants with their prices, and nothing
more. There are no map pins and no mood chips. The map says so. The Mood filter
group is hidden because no restaurant could match it. Menus are also missing
until the tagging step has read them.

Smart search needs the Anthropic key in the Worker. Without it, search falls back
to offline matching and tells the visitor so.

## Running it

```bash
npm install
npm run dev          # Vite dev server
npm test             # unit, component and Worker tests
npm run test:e2e     # Playwright, against a built preview
npm run typecheck    # tsc --noEmit
npm run preview      # build, then serve through the real Worker
npm run deploy       # test, build, wrangler deploy
```

## Populating coordinates and mood tags

Copy `.env.example` to `.env` and fill in both keys. Then run these four
commands in this order:

```bash
npm run places    # coordinates, needs GOOGLE_MAPS_API_KEY
npm run reviews   # run AGAIN, now that coordinates exist
npm run tag       # menu courses and mood tags, needs ANTHROPIC_API_KEY
npm run emit      # writes public/data
```

The order matters. `reviews` runs once before `places` in `npm run data`, but
the review-to-restaurant matching can only be verified by location once
coordinates exist. One known bad match is held back by that gate today. Run
`reviews` again after `places` so the gate can release or reject it.

## The data pipeline

`public/data/` is generated, committed, and never edited by hand. `npm run data`
runs the whole chain, but the four commands above are the right way to fill in
the missing pieces.

| Command | Script | Does |
|---|---|---|
| `npm run scrape` | `01-scrape-list` | Parses the official listing into 174 records |
| `npm run menus` | `02-fetch-menus` | Pulls each published menu as a PDF and extracts its text |
| `npm run places` | `03-resolve-places` | Resolves coordinates with Google Places Text Search |
| `npm run reviews` | `04-link-reviews` | Matches entries against Lizzie's own Yelp export |
| `npm run tag` | `05-extract-and-tag` | Has Claude read each menu for courses and mood tags |
| `npm run emit` | `06-build-index` | Merges everything into the shipped JSON |

Each script writes an errors CSV listing what it could not process. Read
`data/04-matches.csv` by eye: name matching is the one step that can be
confidently wrong.

## Keys

The build scripts read `.env` automatically, so no command needs an inline key.

The Worker cannot read `.env`, so it needs its own copy of the Anthropic key:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

If a request fails with "This API key is not scoped to a workspace", the key
belongs to an organisation rather than to one workspace, so every request must
name the workspace. Set `ANTHROPIC_WORKSPACE_ID` in `.env` for the build
scripts, and give the Worker its own copy:

```bash
npx wrangler secret put ANTHROPIC_WORKSPACE_ID
```

The id starts with `wrkspc_` and appears in the Anthropic console URL while the
workspace is open. Leave it unset for a key that is already bound to a
workspace, because sending the header then is itself an error.

`VITE_PROTOMAPS_API_KEY` is optional. Without it the map draws pins on a plain
background.

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
