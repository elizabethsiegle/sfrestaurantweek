import { describe, expect, it } from 'vitest'
import { parseMenuIdFromViewer, printUrl } from '../scripts/lib/menumodo.js'

describe('menumodo', () => {
  it('reads menu_id out of the viewer page config block', () => {
    const html = `<script>var config = {
            menu_id: '291490',
            menupod_id: '17051',
            is_preview: 0
        };</script>`
    expect(parseMenuIdFromViewer(html)).toBe('291490')
  })

  it('returns null when the config block is absent', () => {
    expect(parseMenuIdFromViewer('<html><body>nothing here</body></html>')).toBeNull()
  })

  it('builds the print url for a menu id', () => {
    expect(printUrl('291490')).toBe(
      'https://www.menumodo.com/app.php/menu/html_print/291490/SF_RESTAURANT_WEEK',
    )
  })
})
