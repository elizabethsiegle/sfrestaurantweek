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
  sortEntries(applyFilters(entries.value, filters.value), sort.value, origin.value, filters.value.shortlist),
)

// The model's ranking is the answer, so a fresh shortlist takes over the sort. A sort
// the visitor picks afterwards wins, and clearing the search then leaves it alone.
let sortBeforeShortlist: SortKey = 'value'

export function showShortlistOrder(): void {
  if (sort.value !== 'shortlist') sortBeforeShortlist = sort.value
  sort.value = 'shortlist'
}

export function restoreSortAfterShortlist(): void {
  if (sort.value === 'shortlist') sort.value = sortBeforeShortlist
}

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
