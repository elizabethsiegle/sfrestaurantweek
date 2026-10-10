import { describe, expect, it } from 'vitest'
import { parseBizPhotos } from '../scripts/lib/yelp-media.js'

const row = (biz: string, file: string, caption: string, status: string) => `
  <tr>
    <td> 2017-06-04T23:24:59+00:00 </td>
    <td> ${biz} </td>
    <td> <p> <a target="_blank" href="../media/${file}"> <img src="../media/${file}"/> </a> </p> </td>
    <td> ${caption} </td>
    <td> ${status} </td>
  </tr>`

const header = '<tr> <th>Date</th> <th>Business Name</th> <th>Media</th> <th>Caption</th> <th>Status</th> </tr>'

describe('parseBizPhotos', () => {
  it('reads the business, file and caption from a displayed row', () => {
    const html = header + row('Burma Superstar', 'biz_photo/abc.jpg', 'Tea leaf salad.', 'Displayed')
    expect(parseBizPhotos(html)).toEqual([
      {
        business: 'Burma Superstar',
        file: 'biz_photo/abc.jpg',
        caption: 'Tea leaf salad.',
        date: '2017-06-04T23:24:59+00:00',
      },
    ])
  })

  it('withholds a photo Yelp has removed', () => {
    const html = header + row('Burma Superstar', 'biz_photo/gone.jpg', 'Gone.', 'Removed')
    expect(parseBizPhotos(html)).toEqual([])
  })

  it('skips the header row and any row with no media link', () => {
    const html = `${header}<tr><td>d</td><td>b</td><td>no link</td><td>c</td><td>Displayed</td></tr>`
    expect(parseBizPhotos(html)).toEqual([])
  })

  it('decodes entities and collapses whitespace in the caption and business', () => {
    const html = header + row('Ben &amp; Jerry&#39;s', 'biz_photo/x.jpg', 'A  &quot;big&quot;\n scoop', 'Displayed')
    const [photo] = parseBizPhotos(html)
    expect(photo!.business).toBe("Ben & Jerry's")
    expect(photo!.caption).toBe('A "big" scoop')
  })

  it('accepts an empty caption', () => {
    const html = header + row('Burma Superstar', 'biz_photo/y.jpg', '', 'Displayed')
    expect(parseBizPhotos(html)[0]!.caption).toBe('')
  })
})
