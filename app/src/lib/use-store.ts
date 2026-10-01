import { useSyncExternalStore } from 'react'
import {
  getServerSnapshot,
  getSnapshot,
  pickPaymentFor,
  subscribe,
  type AppState,
  type ConfirmationRow,
  type PaymentRow,
  type Trip,
} from './store'
import {
  getRequestsServerSnapshot,
  getRequestsSnapshot,
  subscribe as subscribeRequests,
  unreadUpdatesFor,
  type RequestsState,
  type SwapOffer,
  type SwapRequest,
  type UpdateRow,
} from './requests'

/** Subscribe a component to the local-first store. */
export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function useTrips(): Trip[] {
  return useAppState().trips
}

export function useTrip(id: string | undefined): Trip | undefined {
  const trips = useTrips()
  return id ? trips.find((trip) => trip.id === id) : undefined
}

export function useCreditPaise(): number {
  const wallet = useAppState().wallet
  const now = Date.now()
  return wallet.reduce((total, tx) => {
    if (tx.expires_at && Date.parse(tx.expires_at) < now) return total
    return total + tx.amount_paise
  }, 0)
}

export function useSeenFlag(key: string): boolean {
  return useAppState().seen[key] === true
}

/** The payment that decides what the pay screens may show (docs/06).
 *
 *  Delegates to `pickPaymentFor` rather than repeating the filter: this hook and
 *  the imperative `paymentFor()` are one question asked of one store, and when
 *  they were two copies this one matched `request_id` only — so it could not see
 *  a group's ₹199 at all, while the pay screen it backs was showing "already
 *  paid". A group id is a legitimate payment target (`payments_target`). */
export function usePaymentFor(targetId: string): PaymentRow | undefined {
  return pickPaymentFor(useAppState().payments, targetId)
}

export function usePayments(): PaymentRow[] {
  return useAppState().payments
}

export function useConfirmations(requestId: string): ConfirmationRow[] {
  return useAppState().confirmations.filter((row) => row.request_id === requestId)
}

export function useSettings() {
  return useAppState().settings
}

function requestsSnapshot(): RequestsState {
  return getRequestsSnapshot()
}

function requestsServerSnapshot(): RequestsState {
  return getRequestsServerSnapshot()
}

export function useRequestsState(): RequestsState {
  return useSyncExternalStore(subscribeRequests, requestsSnapshot, requestsServerSnapshot)
}

export function useSwapRequest(id: string | undefined): SwapRequest | undefined {
  const { requests } = useRequestsState()
  return id ? requests.find((request) => request.id === id) : undefined
}

export function useRequestOffers(requestId: string): SwapOffer[] {
  const { offers } = useRequestsState()
  return offers.filter((offer) => offer.request_id === requestId)
}

/** Unread updates for the Swaps-tab badge and the Updates list. Re-renders
    when requests, trips, wallet or seen-flags change.

    Both snapshots are used, not just subscribed to. Calling `unreadUpdates()`
    here instead would read the live stores — which the client populates from
    `localStorage` before React hydrates — while the server rendered from an
    empty state, so the badge appeared on the client only and React regenerated
    the entire tree on every page load. See `unreadUpdatesFor`. */
export function useUnreadUpdates(): UpdateRow[] {
  const app = useAppState()
  const requests = useRequestsState()
  return unreadUpdatesFor(app, requests, Date.now())
}
