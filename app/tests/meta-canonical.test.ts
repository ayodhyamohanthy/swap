import { describe, expect, it } from 'vitest'

import { canonicalUrl, SITE_CANONICAL_ORIGIN } from '../src/lib/meta'

describe('canonicalUrl', () => {
  it('self-canonicalizes the root path', () => {
    expect(canonicalUrl('/')).toBe(`${SITE_CANONICAL_ORIGIN}/`)
  })

  it('keeps each path on the canonical origin instead of collapsing deep routes to /', () => {
    expect(canonicalUrl('/swaps')).toBe(`${SITE_CANONICAL_ORIGIN}/swaps`)
    expect(canonicalUrl('/train/12752')).toBe(`${SITE_CANONICAL_ORIGIN}/train/12752`)
  })

  it('drops the query and the fragment: per-link params are not identity', () => {
    expect(canonicalUrl('/train/12752?date=2026-11-12')).toBe(`${SITE_CANONICAL_ORIGIN}/train/12752`)
    expect(canonicalUrl('/swaps#section')).toBe(`${SITE_CANONICAL_ORIGIN}/swaps`)
  })

  it('falls back to the root path when no pathname is known', () => {
    expect(canonicalUrl('')).toBe(`${SITE_CANONICAL_ORIGIN}/`)
  })
})
