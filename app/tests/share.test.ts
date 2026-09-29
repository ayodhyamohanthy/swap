/* The invite link and its message — the two things on screen 18 that leave the
   device and are read by someone who is not the user.

   Both shipped wrong, and neither was visible from the screen:

     1. The route param is `<train_no>-<journey_date>`, and the date carries
        hyphens of its own. `trainDate.split('-')` destructured into
        `[trainNo, journeyDate]` therefore produced `journeyDate === '2026'`, so
        every invite link went out as `?date=2026` — a link that names a train
        and no journey. Found by capturing the built screen and reading the URL
        out of it, not by reading the JSX; the JSX looks like a correct split.

     2. The WhatsApp/SMS payload was `share.body`, which is copy written for the
        person LOOKING at the screen ("Share this link anywhere"). Every invite
        therefore told its recipient to go and share it. One string, two
        audiences, and only one of them was served.

   Both landed in commit `086f364`, whose message is `0` — one of the blanket
   `git add -A` sweeps docs/11 forbids. Neither had a test. These are the tests.
*/

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import hi from '../locales/hi.json'
import { inviteLink, splitTrainDate } from '@/lib/share'

function read(rel: string): string {
  return readFileSync(join(import.meta.dirname, '..', rel), 'utf8')
}

const ROUTE = 'src/routes/share.$trainDate.tsx'
const ORIGIN = 'https://skipwait.me'

describe('splitTrainDate', () => {
  it('keeps the whole journey date, which contains hyphens of its own', () => {
    expect(splitTrainDate('12752-2026-11-12')).toEqual({
      trainNo: '12752',
      journeyDate: '2026-11-12',
    })
  })

  it('does not reduce the date to its year — the bug that shipped', () => {
    /* The exact value the old `split('-')` produced. Asserted by name so a
       future refactor that reintroduces a greedy split fails here rather than
       in someone's WhatsApp. */
    expect(splitTrainDate('12752-2026-11-12').journeyDate).not.toBe('2026')
  })

  it('reports no date when there is none, rather than guessing one', () => {
    expect(splitTrainDate('12752')).toEqual({ trainNo: '12752', journeyDate: '' })
    expect(splitTrainDate('12752-')).toEqual({ trainNo: '12752', journeyDate: '' })
  })
})

describe('inviteLink', () => {
  it('carries the full journey date', () => {
    expect(inviteLink(ORIGIN, '12752-2026-11-12')).toBe(
      'https://skipwait.me/train/12752?date=2026-11-12',
    )
  })

  it('omits the query entirely when the date is unknown', () => {
    /* `?date=` with nothing after it claims a date and supplies none — a reader
       cannot tell it from a date that failed to parse. */
    expect(inviteLink(ORIGIN, '12752')).toBe('https://skipwait.me/train/12752')
    expect(inviteLink(ORIGIN, '12752')).not.toContain('?')
  })

  it('carries no PNR, name or berth number (rule 13)', () => {
    const link = inviteLink(ORIGIN, '12752-2026-11-12')
    expect(link).not.toMatch(/pnr/i)
    expect(link).not.toMatch(/berth/i)
    /* A full PNR is 10 digits; the train number and a date are all that may
       appear. Any 10-digit run would be a leaked booking reference. */
    expect(link).not.toMatch(/\d{10}/)
  })
})

describe('the share screen uses them, and does not re-derive them', () => {
  const src = read(ROUTE)

  it('builds the link through inviteLink, not inline', () => {
    expect(src).toContain('inviteLink(')
    /* The regression in one line: the old inline assembly is what made the URL
       unassertable, and the split it relied on is the bug. */
    expect(src).not.toContain('trainDate.split(')
    expect(src).not.toContain('?date=')
  })

  it('sends the invitation, not the on-screen copy, to the recipient', () => {
    expect(src).toContain("t('share.message'")
    /* `share.body` is sender-facing and belongs on the screen. If it is ever
       wired back into the payload, the recipient is told to share the link. */
    const payload = src.slice(src.indexOf('const text ='), src.indexOf('\n', src.indexOf('const text =')))
    expect(payload).not.toContain('share.body')
  })

  it('renders the body line the design prints', () => {
    expect(src).toContain("t('share.body')")
  })
})

describe('the two share strings are distinct and complete in both languages', () => {
  it('has both keys in en and hi', () => {
    for (const [name, catalog] of [
      ['en', en],
      ['hi', hi],
    ] as const) {
      const share = (catalog as { share: Record<string, string> }).share
      expect(share.body, `${name}.share.body`).toBeTruthy()
      expect(share.message, `${name}.share.message`).toBeTruthy()
      /* The message names the train, so it needs the placeholder. */
      expect(share.message, `${name}.share.message`).toContain('{train}')
    }
  })

  it('keeps them different strings — the whole point of the split', () => {
    const share = (en as { share: Record<string, string> }).share
    expect(share.body).not.toBe(share.message)
  })

  it('does not address the recipient as if they were the sender', () => {
    /* The old payload opened with "Share this link anywhere", an instruction to
       whoever was holding the phone. The replacement must not. */
    const share = (en as { share: Record<string, string> }).share
    expect(share.message.toLowerCase()).not.toContain('share this link')
    expect(share.message).toMatch(/join/i)
  })
})
