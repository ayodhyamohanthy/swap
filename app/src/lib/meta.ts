/* Canonical origin (docs/16 Cloudflare zone): the workers.dev mirror and any
   staging host serve the same documents, so search engines otherwise index
   every mirror as its own site. Every page self-canonicalizes onto this
   origin, keeping its path. A string assembled in JSX and rendered is not
   assertable; a string returned by a function is (the rule that moved
   invite-link parsing into lib/share.ts). */
export const SITE_CANONICAL_ORIGIN = 'https://toyoufromme.website'

/* The query and the fragment are per-link, not identity: an invite link's
   ?date= names one journey, not a different page, so the canonical must not
   carry them. */
export function canonicalUrl(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || '/'
  return path.startsWith('/') ? SITE_CANONICAL_ORIGIN + path : `${SITE_CANONICAL_ORIGIN}/${path}`
}
