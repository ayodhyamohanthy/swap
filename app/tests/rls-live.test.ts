/* Live RLS + RPC execution suite (docs/17 W1.5). Runs ONLY when staging keys
 * are present; keyless it skips and the suite stays green.
 *
 * WHY THIS SHAPE. The 43 RLS policies and the get_matches/create_offer RPCs
 * have static shape guards in schema.test.ts but have never RUN — both
 * Supabase projects are uncreated. Static pins prove the SQL says the right
 * thing; only execution proves Postgres agrees. This file is the execution
 * half, written now so the day staging keys land (`SUPABASE_TEST_URL` et al)
 * it runs unmodified in CI. Until then it is 0 tests, not pending tests.
 *
 * NEEDS (Ayu): a staging project + these three env vars. Nothing here creates
 * them, and nothing here runs without all three — a partial key set is the
 * same as none, because half-credentials produce misleading half-results.
 *
 * HYGIENE. One run-scoped train number + throwaway users, all deleted in
 * afterAll (user delete cascades bookings via ON DELETE CASCADE). Never point
 * this at prod: the guard is that TEST_URL must not contain 'prod' — a cheap
 * tripwire, not a proof, and it fails closed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const TEST_URL = process.env.SUPABASE_TEST_URL ?? ''
const TEST_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY ?? ''
const TEST_SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY ?? ''
const HAS_KEYS = Boolean(TEST_URL && TEST_ANON_KEY && TEST_SERVICE_KEY)

const RUN = Date.now().toString(36)
const TRAIN = '19019'
const JOURNEY = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)

/** Fail-closed tripwire: the live suite must never execute against prod. */
export function isProdUrl(url: string): boolean {
  return /prod/i.test(url);
}

interface LiveCtx {
  admin: SupabaseClient
  userA: string
  userB: string
  bookingA: string
  bookingB: string
  passengerB: string
  requestA: string
}

const ctx = {} as LiveCtx

async function makeUser(
  admin: SupabaseClient,
  tag: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `rls-${tag}-${RUN}@seatswap.invalid`,
    password: `test-${RUN}-${tag}`,
    email_confirm: true,
    /* Google supplies this as `full_name`; passing it here exercises the
       migration #4 derivation end to end on a real database rather than
       asserting only that some row appeared. */
    user_metadata: { full_name: `Rls ${tag.toUpperCase()}` },
  })
  if (error || !data.user) throw new Error(`createUser ${tag}: ${error?.message}`)
  return data.user.id
}

async function userClient(tag: 'a' | 'b'): Promise<SupabaseClient> {
  const client = createClient(TEST_URL, TEST_ANON_KEY)
  const { data, error } = await client.auth.signInWithPassword({
    email: `rls-${tag}-${RUN}@seatswap.invalid`,
    password: `test-${RUN}-${tag}`,
  })
  if (error || !data.session) throw new Error(`signIn ${tag}: ${error?.message}`)
  return client
}

describe.skipIf(!HAS_KEYS)(
  'live RLS + RPC execution (staging only)',
  () => {
    beforeAll(async () => {
      if (isProdUrl(TEST_URL)) {
        throw new Error('refusing to run the live suite against a prod-looking URL')
      }
      const admin = createClient(TEST_URL, TEST_SERVICE_KEY, {
        auth: { persistSession: false },
      })
      ctx.admin = admin
      ctx.userA = await makeUser(admin, 'a')
      ctx.userB = await makeUser(admin, 'b')

      const booking = (user_id: string) => ({
        user_id,
        pnr_hash: `hash-${RUN}-${user_id.slice(0, 4)}`,
        pnr_last4: '1234',
        train_no: TRAIN,
        journey_date: JOURNEY,
        from_code: 'BCT',
        to_code: 'NDLS',
        class: '3A',
        open_to_swap: true,
      })
      const { data: bA, error: eA } = await admin
        .from('bookings')
        .insert(booking(ctx.userA))
        .select('id')
        .single()
      if (eA || !bA) throw new Error(`bookingA: ${eA?.message}`)
      const { data: bB, error: eB } = await admin
        .from('bookings')
        .insert(booking(ctx.userB))
        .select('id')
        .single()
      if (eB || !bB) throw new Error(`bookingB: ${eB?.message}`)
      ctx.bookingA = bA.id
      ctx.bookingB = bB.id

      const passenger = (booking_id: string) => ({
        booking_id,
        label: 'Passenger 1',
        coach: 'B1',
        berth_type: 'LB',
        status: 'CNF',
        quota: 'GN',
      })
      await admin.from('passengers').insert(passenger(ctx.bookingA))
      const { data: pB, error: eP } = await admin
        .from('passengers')
        .insert(passenger(ctx.bookingB))
        .select('id')
        .single()
      if (eP || !pB) throw new Error(`passengerB: ${eP?.message}`)
      ctx.passengerB = pB.id

      const { data: rA, error: eR } = await admin
        .from('swap_requests')
        .insert({
          requester_id: ctx.userA,
          booking_id: ctx.bookingA,
          choices: ['LB'],
          status: 'searching',
        })
        .select('id')
        .single()
      if (eR || !rA) throw new Error(`requestA: ${eR?.message}`)
      ctx.requestA = rA.id
    }, 120_000)

    afterAll(async () => {
      if (!ctx.admin) return
      for (const uid of [ctx.userA, ctx.userB]) {
        if (uid) await ctx.admin.auth.admin.deleteUser(uid).catch(() => {})
      }
    })

    it('a sign-up gets its own per-user rows (migration #4)', async () => {
      /* WHY THIS IS FIRST. `match_cards` INNER JOINs `profiles`, so if the
         sign-up trigger did not take, the get_matches test below returns 0 rows
         and fails for a reason that looks like an RLS problem. Naming the
         precondition first turns that into one clear failure.

         Before migration #4 nothing created either row: zero triggers on
         auth.users, zero function bodies writing to profiles or settings, and
         seed.sql writing both for two hardcoded demo uuids only. Demo data never
         showed it, and every real traveller was invisible to matching — proven
         by execution 2026-10-06 (get_matches returned 0 rows without these rows
         and 2 with them; a second fixture showed the exclusion is per row). */
      const { data, error } = await ctx.admin
        .from('profiles')
        .select('id, first_name, last_initial')
        .in('id', [ctx.userA, ctx.userB])
      expect(error).toBeNull()
      expect((data ?? []).map((row) => row.id).sort()).toEqual(
        [ctx.userA, ctx.userB].sort(),
      )
      /* The row must carry a name, not just exist: rule 13 puts "first name +
         initial" on a match card, so an empty row would leave the card
         unusable. `Rls A` -> first_name "Rls", last_initial "A". */
      const byId = new Map((data ?? []).map((row) => [row.id, row]))
      expect(byId.get(ctx.userA)?.first_name).toBe('Rls')
      expect(byId.get(ctx.userA)?.last_initial).toBe('A')
      expect(byId.get(ctx.userB)?.first_name).toBe('Rls')
      expect(byId.get(ctx.userB)?.last_initial).toBe('B')

      /* The second row of the same root cause. `server/admin.ts:155` pauses an
         acceptor with an UPDATE on `settings`, and an UPDATE matching no row
         affects 0 rows and returns NO ERROR — so without this row the operator
         action reported success and did nothing. Asserted with the defaults the
         table owns rather than values this trigger chose. */
      const { data: rows, error: sErr } = await ctx.admin
        .from('settings')
        .select('user_id, paused, max_requests_per_day')
        .in('user_id', [ctx.userA, ctx.userB])
      expect(sErr).toBeNull()
      expect((rows ?? []).map((row) => row.user_id).sort()).toEqual(
        [ctx.userA, ctx.userB].sort(),
      )
      for (const row of rows ?? []) {
        expect(row.paused).toBe(false)
        expect(row.max_requests_per_day).toBe(3)
      }
    })

    it('user A reads only their own booking rows', async () => {
      const client = await userClient('a')
      const { data, error } = await client.from('bookings').select('id')
      expect(error).toBeNull()
      expect((data ?? []).map((row) => row.id)).toEqual([ctx.bookingA])
    })

    it("user A cannot read user B's booking by id", async () => {
      const client = await userClient('a')
      const { data, error } = await client
        .from('bookings')
        .select('id')
        .eq('id', ctx.bookingB)
      expect(error).toBeNull()
      expect(data ?? []).toEqual([])
    })

    it('anon reads no bookings at all', async () => {
      const anon = createClient(TEST_URL, TEST_ANON_KEY)
      const { data, error } = await anon.from('bookings').select('id').limit(1)
      expect(error).toBeNull()
      expect(data ?? []).toEqual([])
    })

    it('get_matches returns the peer row with match-safe columns only', async () => {
      const client = await userClient('a')
      const { data, error } = await client.rpc('get_matches', {
        p_train: TRAIN,
        p_date: JOURNEY,
        p_class: '3A',
      })
      expect(error).toBeNull()
      const rows = data ?? []
      expect(rows.length).toBeGreaterThanOrEqual(1)
      const peer = rows.find(
        (row: { passenger_id: string }) => row.passenger_id === ctx.passengerB,
      )
      expect(peer, 'own open trip must be matchable by the RPC').toBeTruthy()
      for (const row of rows) {
        for (const forbidden of ['berth_no', 'pnr_hash', 'email', 'phone']) {
          expect(row, `${forbidden} leaked through get_matches`).not.toHaveProperty(
            forbidden,
          )
        }
      }
    })

    it('create_offer writes once and returns the same id on retry', async () => {
      const client = await userClient('a')
      const first = await client.rpc('create_offer', {
        p_request: ctx.requestA,
        p_passenger: ctx.passengerB,
        p_rank: 1,
      })
      expect(first.error).toBeNull()
      expect(typeof first.data).toBe('string')
      const second = await client.rpc('create_offer', {
        p_request: ctx.requestA,
        p_passenger: ctx.passengerB,
        p_rank: 1,
      })
      expect(second.error).toBeNull()
      expect(second.data).toBe(first.data)
    })

    it("create_offer refuses another user's request", async () => {
      const admin = ctx.admin
      const { data: rB } = await admin
        .from('swap_requests')
        .insert({
          requester_id: ctx.userB,
          booking_id: ctx.bookingB,
          choices: ['LB'],
          status: 'searching',
        })
        .select('id')
        .single()
      const client = await userClient('a')
      expect(rB?.id, 'setup: requestB must exist').toBeTruthy()
      const { error } = await client.rpc('create_offer', {
        p_request: rB?.id ?? '',
        p_passenger: ctx.passengerB,
        p_rank: 1,
      })
      expect(error, 'cross-user offer must fail').toBeTruthy()
    })

    it('has_role answers false for a plain traveller', async () => {
      const client = await userClient('a')
      const { data, error } = await client.rpc('has_role', {
        uid: ctx.userA,
        wanted: 'admin',
      })
      expect(error).toBeNull()
      expect(data).toBe(false)
    })
  },
  180_000,
)

describe('the keyless contract holds without keys', () => {
  it('the suite skips when staging keys are absent', () => {
    /* This is the assertion the whole file stands on: without all three keys
       nothing executes. If this fails, someone wired credentials into the
       environment — which is exactly when the live suite should wake up, so a
       failure here is information, not breakage. */
    expect(HAS_KEYS).toBe(false)
  })

  it('the prod tripwire fires on prod-looking URLs and nothing else', () => {
    expect(isProdUrl('https://xyzcompany.supabase.co')).toBe(false)
    expect(isProdUrl('https://seatswap-prod.supabase.co')).toBe(true)
    expect(isProdUrl('')).toBe(false)
  })
})
