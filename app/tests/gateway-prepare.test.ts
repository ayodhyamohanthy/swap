/* `prepareGatewayPayment` is the one place that decides what a gateway charges
   and which credit covers it (rule 1: ₹99 = ₹49 fee + ₹50 credit, credit only
   ever LOWERS what is due). It is shared by Razorpay and PayPal precisely so the
   two can never disagree — when they did, PayPal took the full ₹99 while the
   client also spent ₹50 of credit, billing ₹149 for a ₹99 swap. */
import { describe, expect, it } from 'vitest'
import type { SupaClient } from '@/server/functions'
import { prepareGatewayPayment as prepareGatewayPaymentImpl } from '@/server/payments'

type GatewayInput = Parameters<typeof prepareGatewayPaymentImpl>[2]
const prepareGatewayPayment = (
  client: SupaClient,
  callerId: string,
  input: Omit<GatewayInput, 'provider'> & { provider?: GatewayInput['provider'] },
) => prepareGatewayPaymentImpl(client, callerId, { ...input, provider: input.provider ?? 'razorpay' })

interface Row { id: string; [k: string]: unknown }
interface WalletRow { id: string; amount_paise: number; expires_at: string | null }

interface Options {
  request?: Row | null
  group?: Row | null
  wallet?: WalletRow[]
  prior?: Row[]
  /** Errors, so the fail-closed guards can be exercised. */
  priorError?: unknown
  walletError?: unknown
  holdError?: unknown
  rpcError?: unknown
}

interface Recorded { table: string; ops: Array<[string, unknown]> }

/** Minimal stand-in for the Supabase query builder used by this function. */
function fakeClient(opts: Options) {
  const calls: Recorded[] = []
  const rpcs: Array<[string, Record<string, unknown>]> = []
  const state = { calls, rpcs, nextId: 1 }

  function from(table: string) {
    const ops: Array<[string, unknown]> = []
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'or', 'limit', 'order', 'single']) {
      chain[m] = (arg?: unknown) => {
        ops.push([m, arg])
        return chain
      }
    }
    const has = (op: string) => ops.some(([name]) => name === op)
    chain.then = (res: (v: unknown) => void, rej: (e: unknown) => void) => {
      calls.push({ table, ops })
      let out: { data?: unknown; error?: unknown } = { data: null, error: null }
      if (table === 'swap_requests') out = { data: opts.request ?? null, error: null }
      else if (table === 'group_trips') out = { data: opts.group ?? null, error: null }
      else if (table === 'payments' && has('insert')) {
        const row = ops.find(([m]) => m === 'insert')?.[1] as Row | undefined
        out = opts.holdError
          ? { data: null, error: opts.holdError }
          : { data: { id: `pay_${state.nextId++}`, ...row }, error: null }
      } else if (table === 'payments') out = { data: opts.prior ?? [], error: opts.priorError ?? null }
      else if (table === 'wallet_tx' && has('insert')) {
        out = opts.holdError
          ? { data: null, error: opts.holdError }
          : { data: { id: `hold_${state.nextId++}` }, error: null }
      } else if (table === 'wallet_tx') out = { data: opts.wallet ?? [], error: opts.walletError ?? null }
      return Promise.resolve(out).then(res, rej)
    }
    return chain
  }

  const client = {
    from,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push([fn, args])
      return { error: opts.rpcError ?? null }
    },
  }
  return { client: client as unknown as SupaClient, state }
}

const REQUESTER = 'u_req'
const request = (over: Partial<Row> = {}): Row =>
  ({ id: 'req_1', requester_id: REQUESTER, status: 'accepted_awaiting_payment', ...over })
const inserted = (state: { calls: Recorded[] }, table: string) =>
  state.calls
    .filter((c) => c.table === table && c.ops.some(([m]) => m === 'insert'))
    .map((c) => c.ops.find(([m]) => m === 'insert')?.[1] as Row)
describe('prepareGatewayPayment — the amount charged', () => {
  it('charges the full price with no credit', async () => {
    const { client } = fakeClient({ request: request() })
    const p = await prepareGatewayPayment(client, REQUESTER, { requestId: 'req_1', isGroup: false, useCredit: true })
    expect(p.total).toBe(9900)
    expect(p.due).toBe(9900)
    expect(p.creditUsed).toBe(0)
    expect(p.holdId).toBeNull()
  })

  it('charges price MINUS credit when credit is used (rule 1)', async () => {
    const { client, state } = fakeClient({
      request: request(), wallet: [{ id: 'w1', amount_paise: 5000, expires_at: null }],
    })
    const p = await prepareGatewayPayment(client, REQUESTER, { requestId: 'req_1', isGroup: false, useCredit: true })
    /* The exact bug: due must be 4900, never 9900, or the payer is charged the
       full price AND the ₹50 credit is spent. */
    expect(p.total).toBe(9900)
    expect(p.creditUsed).toBe(5000)
    expect(p.due).toBe(4900)
    expect(inserted(state, 'wallet_tx')).toMatchObject([{ amount_paise: -5000, kind: 'used' }])
    expect(inserted(state, 'payments')).toMatchObject([{ amount_paise: 9900, credit_used_paise: 5000 }])
  })

  it('persists PayPal as the provider for a PayPal order', async () => {
    const { client, state } = fakeClient({ request: request() })
    await prepareGatewayPayment(client, REQUESTER, {
      requestId: 'req_1', isGroup: false, useCredit: false, provider: 'paypal',
    })
    expect(inserted(state, 'payments')).toMatchObject([{ provider: 'paypal', status: 'created' }])
  })

  it('credit is only ever spent in whole paise off the total, never over', async () => {
    const { client } = fakeClient({
      request: request(), wallet: [{ id: 'w1', amount_paise: 9900, expires_at: null }],
    })
    const p = await prepareGatewayPayment(client, REQUESTER, { requestId: 'req_1', isGroup: false, useCredit: true })
    expect(p.creditUsed).toBe(9900)
    expect(p.due).toBe(0)
  })

  it('an already-SPENT credit row does not lower the price again', async () => {
    /* wallet_tx is signed: +9900 earned, -9900 already spent. The balance is 0,
       so this swap must cost the full ₹99. */
    const { client } = fakeClient({
      request: request(),
      wallet: [
        { id: 'c1', amount_paise: 9900, expires_at: null },
        { id: 'u1', amount_paise: -9900, expires_at: null },
      ],
    })
    const p = await prepareGatewayPayment(client, REQUESTER, { requestId: 'req_1', isGroup: false, useCredit: true })
    expect(p.creditUsed).toBe(0)
    expect(p.due).toBe(9900)
  })

  it('useCredit:false ignores the balance entirely', async () => {
    const { client } = fakeClient({
      request: request(), wallet: [{ id: 'w1', amount_paise: 5000, expires_at: null }],
    })
    const p = await prepareGatewayPayment(client, REQUESTER, { requestId: 'req_1', isGroup: false, useCredit: false })
    expect(p.creditUsed).toBe(0)
    expect(p.due).toBe(9900)
  })

  it('prices a group trip at ₹199, not ₹99', async () => {
    const { client } = fakeClient({ group: { id: 'g1', organiser_id: REQUESTER, name: 'Family' } })
    const p = await prepareGatewayPayment(client, REQUESTER, { requestId: 'g1', isGroup: true, useCredit: true })
    expect(p.total).toBe(19900)
    expect(p.due).toBe(19900)
  })
})

describe('prepareGatewayPayment — who may pay', () => {
  it('refuses anyone who is not the requester', async () => {
    const { client } = fakeClient({ request: request() })
    await expect(
      prepareGatewayPayment(client, 'u_stranger', { requestId: 'req_1', isGroup: false, useCredit: true }),
    ).rejects.toThrow('not_requester')
  })

  it('refuses a request that is not awaiting payment (rule 2)', async () => {
    for (const status of ['draft', 'searching', 'locked', 'confirmed', 'withdrawn']) {
      const { client } = fakeClient({ request: request({ status }) })
      await expect(
        prepareGatewayPayment(client, REQUESTER, { requestId: 'req_1', isGroup: false, useCredit: true }),
      ).rejects.toThrow(status === 'locked' ? 'not_awaiting_payment' : 'not_awaiting_payment')
    }
  })

  it('refuses a missing request', async () => {
    const { client } = fakeClient({ request: null })
    await expect(
      prepareGatewayPayment(client, REQUESTER, { requestId: 'req_x', isGroup: false, useCredit: true }),
    ).rejects.toThrow('request_not_found')
  })

  it('refuses a group the caller does not organise', async () => {
    const { client } = fakeClient({ group: { id: 'g1', organiser_id: 'u_other' } })
    await expect(
      prepareGatewayPayment(client, REQUESTER, { requestId: 'g1', isGroup: true, useCredit: true }),
    ).rejects.toThrow('not_requester')
  })
})

describe('prepareGatewayPayment — money guards fail closed', () => {
  it('refuses a group that already has a paid or pending payment', async () => {
    const { client } = fakeClient({
      group: { id: 'g1', organiser_id: REQUESTER }, prior: [{ id: 'pay_old' }],
    })
    await expect(
      prepareGatewayPayment(client, REQUESTER, { requestId: 'g1', isGroup: true, useCredit: true }),
    ).rejects.toThrow('already_paid')
  })

  it('refuses to charge when the already-paid check itself fails', async () => {
    /* Fail OPEN here would take a second ₹199 from a family that already paid. */
    const { client } = fakeClient({
      group: { id: 'g1', organiser_id: REQUESTER }, priorError: new Error('network'),
    })
    await expect(
      prepareGatewayPayment(client, REQUESTER, { requestId: 'g1', isGroup: true, useCredit: true }),
    ).rejects.toThrow('payment_state_unreadable')
  })

  it('refuses to price anything if the wallet cannot be read', async () => {
    const { client } = fakeClient({ request: request(), walletError: new Error('rls') })
    await expect(
      prepareGatewayPayment(client, REQUESTER, { requestId: 'req_1', isGroup: false, useCredit: true }),
    ).rejects.toThrow('wallet_unreadable')
  })
})

describe('prepareGatewayPayment — credit-only settlement', () => {
  it('locks the swap when credit covers the whole price', async () => {
    /* Without the lock the request stays payable next to a paid row and can be
       charged a second time. */
    const { client, state } = fakeClient({
      request: request(), wallet: [{ id: 'w1', amount_paise: 9900, expires_at: null }],
    })
    const p = await prepareGatewayPayment(client, REQUESTER, { requestId: 'req_1', isGroup: false, useCredit: true })
    expect(p.due).toBe(0)
    expect(p.creditUsed).toBe(9900)
    expect(inserted(state, 'payments')).toMatchObject([{ provider: 'credit', status: 'paid', credit_used_paise: 9900 }])
    expect(state.rpcs).toEqual([['apply_request_transition', { p_req: 'req_1', p_status: 'locked', p_locked_offer: null }]])
  })

  it('does not lock a group payment through the swap RPC', async () => {
    const { client, state } = fakeClient({
      group: { id: 'g1', organiser_id: REQUESTER }, wallet: [{ id: 'w1', amount_paise: 19900, expires_at: null }],
    })
    const p = await prepareGatewayPayment(client, REQUESTER, { requestId: 'g1', isGroup: true, useCredit: true })
    expect(p.due).toBe(0)
    expect(state.rpcs).toEqual([])
  })

  it('surfaces a failed lock instead of reporting success', async () => {
    const { client } = fakeClient({
      request: request(), wallet: [{ id: 'w1', amount_paise: 9900, expires_at: null }],
      rpcError: new Error('bad_request_transition'),
    })
    await expect(
      prepareGatewayPayment(client, REQUESTER, { requestId: 'req_1', isGroup: false, useCredit: true }),
    ).rejects.toThrow('lock_failed')
  })
})
