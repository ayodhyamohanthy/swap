/* Azure burn-down eval: translator-lib helpers + guard proposal.
 * Never touches app/locales/ or src/lib/chat-guard.ts. */
import { describe, expect, it } from 'vitest'
// @ts-expect-error translator-lib is an untyped .mjs helper (tests only)
import { flatLeaves, placeholdersOf, scanDraft } from '../azure/translator-lib.mjs'
import { candidateGuardExtra } from '../azure/guard-proposal'
import en from '../locales/en.json'

describe('azure translator draft pipeline', () => {
  it('flattens en without losing keys', () => {
    const leaves = flatLeaves(en as Record<string, unknown>)
    expect(Object.keys(leaves).length).toBeGreaterThan(600)
  })
  it('keeps {placeholders} intact', () => {
    expect(placeholdersOf('Pay {amount} to {name}')).toEqual(['{amount}', '{name}'])
  })
  it('flags banned words in drafts', () => {
    const { banned } = scanDraft({ a: 'show your pass please', 'footer.line2': 'SeatSwap is not an official railway service.' })
    expect(banned.length).toBe(1)
  })
})

describe('azure guard proposal (eval only)', () => {
  it('catches the h04 Hinglish FN', () => {
    expect(candidateGuardExtra('meri seat khareed lo')).toContain('khareed')
  })
  it('stays quiet on clean chat', () => {
    expect(candidateGuardExtra("I'm at my berth now")).toEqual([])
  })
})
