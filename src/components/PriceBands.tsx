import { entries, filters, setFilters } from '../state/board.js'
import { applyFilters } from '../lib/filter.js'

// Restaurant Week is sold by denomination, so the denominations are the first
// control on the page. A band names one price exactly: picking $90 shows the
// restaurants serving a $90 menu, not everything that costs $90 or less. The
// running budget cap lives with the other filters, where it is labelled as one.
export function PriceBands() {
  const board = entries.value
  if (!board.length) return null

  const tiers = [...new Set(board.flatMap((e) => e.offers.map((o) => o.price)))].sort((a, b) => a - b)
  if (tiers.length < 2) return null

  const active = filters.value.priceTier

  return (
    <ul class="bands">
      {tiers.map((price) => {
        const on = active === price
        const count = applyFilters(board, { ...filters.value, priceTier: price }).length
        return (
          <li key={price} class="bands__item">
            <button
              type="button"
              class="bands__btn"
              aria-pressed={on}
              aria-label={`Show restaurants serving a $${price} menu`}
              onClick={() => setFilters({ priceTier: on ? null : price })}
            >
              <span class="bands__price">${price}</span>
              <span class="bands__count">
                {count} {count === 1 ? 'place' : 'places'}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
