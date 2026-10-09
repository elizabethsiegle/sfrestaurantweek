import { signal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Course } from '../lib/entry.js'

type MenuState = { kind: 'loading' } | { kind: 'ready'; courses: Course[] } | { kind: 'failed' }

const cache = new Map<string, Course[]>()
const openSlug = signal<string | null>(null)
const openName = signal('')
const state = signal<MenuState>({ kind: 'loading' })
let trigger: HTMLElement | null = null

function closeDetail(): void {
  openSlug.value = null
  trigger?.focus()
  trigger = null
}

export async function openDetail(slug: string, name: string, opener?: HTMLElement | null): Promise<void> {
  trigger = opener ?? (document.activeElement as HTMLElement | null)
  openSlug.value = slug
  openName.value = name
  const cached = cache.get(slug)
  if (cached) {
    state.value = { kind: 'ready', courses: cached }
    return
  }
  state.value = { kind: 'loading' }
  let next: MenuState
  try {
    const response = await fetch(`/data/menus/${slug}.json`)
    if (!response.ok) throw new Error(`Menu request failed with status ${response.status}`)
    const body = (await response.json()) as { courses?: unknown }
    if (!Array.isArray(body.courses)) throw new Error('Menu file has no courses list')
    cache.set(slug, body.courses as Course[])
    next = { kind: 'ready', courses: body.courses as Course[] }
  } catch {
    next = { kind: 'failed' }
  }
  // A slower earlier request must not overwrite the menu the visitor opened last.
  if (openSlug.value === slug) state.value = next
}

export function DetailCard() {
  const card = useRef<HTMLElement>(null)
  const slug = openSlug.value

  useEffect(() => {
    if (slug) card.current?.focus()
  }, [slug])

  if (!slug) return null
  const current = state.value

  return (
    <aside
      ref={card}
      class="detail"
      role="dialog"
      aria-label={`${openName.value} menu`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') closeDetail()
      }}
    >
      <button type="button" class="detail__close" onClick={closeDetail}>
        Close
      </button>
      {current.kind === 'loading' && <p role="status">Reading the menu</p>}
      {current.kind === 'failed' && <p>Could not load this menu. Close it and try again.</p>}
      {current.kind === 'ready' && current.courses.length === 0 && <p>Menu not available yet.</p>}
      {current.kind === 'ready' &&
        current.courses.map((course, i) => (
          <section key={`${i}-${course.name}`} class="course">
            <h3 class="course__name">{course.name}</h3>
            <ul>
              {course.dishes.map((d, j) => (
                <li key={`${j}-${d.name}`}>
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
