import { signal } from '@preact/signals'
import { entries, filters, setFilters, showShortlistOrder, sort } from '../state/board.js'
import { MOOD_LABELS, MOOD_TAGS } from '../lib/moods.js'
import { MEALS } from '../lib/types.js'
import type { SortKey } from '../lib/filter.js'

const SORTS: Array<[SortKey, string]> = [
  ['value', 'Best value'],
  ['distance', 'Nearest'],
  ['price', 'Cheapest'],
  ['name', 'A to Z'],
]

// This listing flag reaches the board as vegetarianFriendly, which the Dietary group
// filters on, so it is not offered a second time as a dining option.
const VEGETARIAN_OPTION = 'Vegetarian Options'

const filtersOpen = signal(false)

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function Chip({ label, on, onPick }: { label: string; on: boolean; onPick: () => void }) {
  return (
    <button type="button" class={on ? 'chip chip--on' : 'chip'} aria-pressed={on} onClick={onPick}>
      {label}
    </button>
  )
}

function MultiSelect({
  label,
  options,
  chosen,
  onPick,
}: {
  label: string
  options: string[]
  chosen: string[]
  onPick: (picked: string[]) => void
}) {
  return (
    <select
      multiple
      aria-label={label}
      onChange={(e) => onPick([...(e.target as HTMLSelectElement).selectedOptions].map((o) => o.value))}
    >
      {options.map((option) => (
        <option key={option} value={option} selected={chosen.includes(option)}>
          {option}
        </option>
      ))}
    </select>
  )
}

export function FilterChips() {
  const board = entries.value
  const active = filters.value

  const meals = MEALS.filter((meal) => board.some((e) => e.offers.some((o) => o.meal === meal)))
  const prices = [...new Set(board.flatMap((e) => e.offers.map((o) => o.price)))].sort((a, b) => a - b)
  // The top price caps nothing, so it is not offered as a tier.
  const tiers = prices.slice(0, -1)
  const neighborhoods = [...new Set(board.map((e) => e.neighborhood))].sort()
  const cuisines = [...new Set(board.map((e) => e.cuisine))].filter(Boolean).sort()
  const diningOptions = [...new Set(board.flatMap((e) => e.diningOptions))]
    .filter((option) => option !== VEGETARIAN_OPTION)
    .sort()

  const anyMoods = board.some((e) => e.moods.length > 0)
  const anyVegetarian = board.some((e) => e.vegetarianFriendly)
  const ranked = active.shortlist !== null

  return (
    <>
    <button
      type="button"
      class="filters-toggle"
      aria-expanded={filtersOpen.value}
      aria-controls="filters-panel"
      onClick={() => (filtersOpen.value = !filtersOpen.value)}
    >
      {filtersOpen.value ? 'Hide filters' : 'Filters and sorting'}
    </button>
    <div id="filters-panel" class={filtersOpen.value ? 'filters filters--open' : 'filters'}>
      {anyMoods && (
      <fieldset class="filters__group">
        <legend>Mood</legend>
        {MOOD_TAGS.map((tag) => (
          <Chip
            key={tag}
            label={MOOD_LABELS[tag]}
            on={active.moods.includes(tag)}
            onPick={() => setFilters({ moods: toggle(active.moods, tag) })}
          />
        ))}
      </fieldset>
      )}

      {meals.length > 0 && (
      <fieldset class="filters__group">
        <legend>Meal</legend>
        {meals.map((meal) => (
          <Chip
            key={meal}
            label={meal}
            on={active.meals.includes(meal)}
            onPick={() => setFilters({ meals: toggle(active.meals, meal) })}
          />
        ))}
      </fieldset>
      )}

      {tiers.length > 0 && (
      <fieldset class="filters__group">
        <legend>Price</legend>
        {tiers.map((price) => (
          <Chip
            key={price}
            label={`$${price} or less`}
            on={active.maxPrice === price}
            onPick={() => setFilters({ maxPrice: active.maxPrice === price ? null : price })}
          />
        ))}
      </fieldset>
      )}

      {neighborhoods.length > 0 && (
      <fieldset class="filters__group">
        <legend>Neighborhood</legend>
        <MultiSelect
          label="Neighborhood"
          options={neighborhoods}
          chosen={active.neighborhoods}
          onPick={(neighborhoods) => setFilters({ neighborhoods })}
        />
      </fieldset>
      )}

      {cuisines.length > 0 && (
      <fieldset class="filters__group">
        <legend>Cuisine</legend>
        <MultiSelect
          label="Cuisine"
          options={cuisines}
          chosen={active.cuisines}
          onPick={(cuisines) => setFilters({ cuisines })}
        />
      </fieldset>
      )}

      {diningOptions.length > 0 && (
      <fieldset class="filters__group">
        <legend>Dining</legend>
        {diningOptions.map((option) => (
          <Chip
            key={option}
            label={option}
            on={active.diningOptions.includes(option)}
            onPick={() => setFilters({ diningOptions: toggle(active.diningOptions, option) })}
          />
        ))}
      </fieldset>
      )}

      {anyVegetarian && (
      <fieldset class="filters__group">
        <legend>Dietary</legend>
        <Chip
          label="Vegetarian friendly"
          on={active.vegetarianOnly}
          onPick={() => setFilters({ vegetarianOnly: !active.vegetarianOnly })}
        />
      </fieldset>
      )}

      <fieldset class="filters__group">
        <legend>Sort</legend>
        {ranked && (
          <Chip label="Top picks" on={sort.value === 'shortlist'} onPick={showShortlistOrder} />
        )}
        {SORTS.map(([key, label]) => (
          <Chip key={key} label={label} on={sort.value === key} onPick={() => (sort.value = key)} />
        ))}
      </fieldset>
    </div>
    </>
  )
}
