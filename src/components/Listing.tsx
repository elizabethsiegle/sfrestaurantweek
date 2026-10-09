import { entries, filters, origin, shortlistReasons, visible } from '../state/board.js'
import { EMPTY_FILTERS } from '../lib/filter.js'
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

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function hasActiveFilter(): boolean {
  const { shortlist, ...rest } = filters.value
  const { shortlist: _none, ...restEmpty } = EMPTY_FILTERS
  return (
    shortlist !== null ||
    (Object.keys(restEmpty) as Array<keyof typeof restEmpty>).some((key) => {
      const value = rest[key]
      return Array.isArray(value) ? value.length > 0 : value !== restEmpty[key]
    })
  )
}

function OfferLine({ offer }: { offer: EntryOffer }) {
  if (offer.courses === null) {
    return (
      <li class="offer">
        {offer.meal} ${offer.price}
      </li>
    )
  }
  return (
    <li class="offer">
      {plural(offer.courses, 'course', 'courses')} at ${offer.price}.
      {offer.medianCourses !== null && (
        <em class="offer__median">
          {' '}
          Most ${offer.price} {MEAL_PLURAL[offer.meal]} are {offer.medianCourses}.
        </em>
      )}
    </li>
  )
}

function Row({ entry, noMenusAnywhere }: { entry: Entry; noMenusAnywhere: boolean }) {
  const reason = shortlistReasons.value.get(entry.slug)
  const walk =
    origin.value && entry.lat !== null && entry.lng !== null
      ? walkMinutes(distanceMeters(origin.value, { lat: entry.lat, lng: entry.lng }))
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

      <ul class="row__offers">
        {entry.offers.map((o) => (
          <OfferLine key={`${o.meal}-${o.price}`} offer={o} />
        ))}
      </ul>

      {entry.menuCoverage === 'none' && !noMenusAnywhere && (
        <p class="row__nomenu">Menu not available yet.</p>
      )}
      {entry.menuCoverage !== 'none' && entry.moods.length > 0 && (
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
            Lizzie, {new Date(entry.personal.visitDate).getUTCFullYear()}
            {entry.personal.rating !== null && ` · ${plural(entry.personal.rating, 'star', 'stars')}`}
          </footer>
        </blockquote>
      )}

      {(entry.menuCoverage === 'full' || entry.openTableUrl || entry.websiteUrl) && (
        <p class="row__links">
          {entry.menuCoverage === 'full' && (
            <button type="button" onClick={(e) => void openDetail(entry.slug, entry.name, e.currentTarget)}>
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
      )}
    </article>
  )
}

export function Listing() {
  if (!visible.value.length) {
    if (!hasActiveFilter()) {
      return (
        <div class="empty" role="status">
          <p class="empty__headline">No restaurants are listed yet.</p>
          <p>Reload the page to try again.</p>
        </div>
      )
    }
    return (
      <div class="empty" role="status">
        <p class="empty__headline">No dishes match that order yet.</p>
        <p>Loosen a filter and the kitchen will try again.</p>
      </div>
    )
  }

  const noMenusAnywhere = entries.value.every((e) => e.menuCoverage === 'none')

  return (
    <section class="listing">
      {noMenusAnywhere && <p class="listing__notice">Menus are not available yet.</p>}
      {visible.value.map((e) => (
        <Row key={e.slug} entry={e} noMenusAnywhere={noMenusAnywhere} />
      ))}
    </section>
  )
}
