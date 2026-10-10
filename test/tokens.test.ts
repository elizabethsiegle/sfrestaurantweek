import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const tokens = readFileSync('src/styles/tokens.css', 'utf8')
const app = readFileSync('src/styles/app.css', 'utf8')

describe('visual tokens', () => {
  it('defines the two materials and the single accent', () => {
    expect(tokens).toMatch(/--card:/)
    expect(tokens).toMatch(/--board:/)
    expect(tokens).toMatch(/--ink:/)
    expect(tokens).toMatch(/--brass:/)
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
    // Tracked-out capitalised labels are the commonest template tell.
    expect(css).not.toMatch(/text-transform:\s*uppercase/)
    // Rounded corners belong to the card kit, not to a painted board.
    expect(css).not.toMatch(/border-radius:\s*[^0\s]/)
  })

  it('reserves the accent for money and the active control', () => {
    // Brass on the listing may only colour prices. Anything else competes with them.
    const brassRules = [...app.matchAll(/([^{}]+)\{([^}]*--brass\b[^}]*)\}/g)].map((m) => m[1]!.trim())
    for (const selector of brassRules) {
      expect(selector).toMatch(/offer|bands|chip--on|focus-visible|stamp|option:checked/)
    }
  })

  it('gives the date stamp a rotation so it sits off grid', () => {
    expect(app).toMatch(/\.masthead__stamp[\s\S]*?rotate\(/)
  })

  it('declares a visible focus style for keyboard users', () => {
    expect(app).toMatch(/:focus-visible/)
  })

  it('respects a reduced-motion preference', () => {
    expect(app).toMatch(/prefers-reduced-motion/)
  })
})
