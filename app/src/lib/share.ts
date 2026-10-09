/* The invite link (design 14b, screen 18) — the one artefact that leaves the
   device and is read by someone who is not the user.

   It lives here, as pure functions, because the two defects it shipped with
   were both unprovable from the screen: the URL was built inline inside the
   route component, so nothing could call it and assert what it produced. A
   string assembled in JSX and rendered is not testable; a string returned by a
   function is. */

/** Split the route param `<train_no>-<journey_date>` into its two parts.
 *
 *  The date carries hyphens of its own — `12752-2026-11-12` — so splitting on
 *  EVERY hyphen made `journeyDate` the year alone. Every invite link therefore
 *  went out as `?date=2026`: a link that identifies a train but no journey.
 *  Split on the first hyphen only.
 *
 *  A missing date yields `''`, not the last token of the train number. */
export function splitTrainDate(trainDate: string): { trainNo: string; journeyDate: string } {
  const cut = trainDate.indexOf('-')
  if (cut === -1) return { trainNo: trainDate, journeyDate: '' }
  return { trainNo: trainDate.slice(0, cut), journeyDate: trainDate.slice(cut + 1) }
}

/** The public train-page link, with the journey date when there is one.
 *
 *  `?date=` with nothing after it is worse than no query at all: it claims a
 *  date and supplies none, and a reader cannot tell it from a date that failed
 *  to parse. Omit the query entirely when the date is unknown.
 *
 *  No PNR, no name, no berth number — rule 13. The train number and the date
 *  are public facts about a journey, not about a person. */
export function inviteLink(origin: string, trainDate: string): string {
  const { trainNo, journeyDate } = splitTrainDate(trainDate)
  const base = `${origin}/train/${trainNo}`
  return journeyDate ? `${base}?date=${encodeURIComponent(journeyDate)}` : base
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-11-12" -> "12 Nov 2026". Anything that is not a plain ISO date comes
 *  back as '' so callers can fall back to the date-less wording instead of
 *  printing a broken date to a stranger. The date is a public fact about the
 *  journey, not about a person (rule 13). */
export function shareDateLabel(journeyDate: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(journeyDate ?? '')
  if (!m) return ''
  const month = MONTHS[Number(m[2]) - 1]
  const day = Number(m[3])
  if (!month || day < 1 || day > 31) return ''
  return `${day} ${month} ${m[1]}`
}

/** Instagram has no web URL that takes text, so the share button copies the
 *  whole message (text + link) first and then opens Instagram's inbox, which is
 *  a universal link: the app on a phone, the web inbox on a desktop. The old
 *  `instagram://` scheme opened nothing on desktop and carried nothing anywhere. */
export const INSTAGRAM_INBOX_URL = 'https://www.instagram.com/direct/inbox/'

export function instagramClipboardText(text: string, link: string): string {
  return `${text} ${link}`
}
