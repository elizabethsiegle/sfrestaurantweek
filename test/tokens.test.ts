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
