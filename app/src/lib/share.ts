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
