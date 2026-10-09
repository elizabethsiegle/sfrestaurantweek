import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('project scaffold', () => {
  it('pins node 26 and declares an ES module package', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.engines.node).toBe('>=26')
    expect(pkg.type).toBe('module')
  })

  it('keeps runtime dependencies to the three the plan allows', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@preact/signals',
      'maplibre-gl',
      'preact',
    ])
  })
})
