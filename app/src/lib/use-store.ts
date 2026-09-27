import { useSyncExternalStore } from 'react'
import {
  getServerSnapshot,
  getSnapshot,
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
  unreadUpdates,
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

/** The payment that decides what the pay screens may show (docs/06). */
export function usePaymentFor(requestId: string): PaymentRow | undefined {
  const payments = useAppState().payments
  const rows = payments.filter((row) => row.request_id === requestId)
  return rows.find((row) => row.status === 'paid')
    ?? rows.find((row) => row.status === 'pending')
    ?? rows.find((row) => row.status === 'created')
    ?? rows[rows.length - 1]
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
    when requests, trips, wallet or seen-flags change. */
export function useUnreadUpdates(): UpdateRow[] {
  useAppState()
  useRequestsState()
  return unreadUpdates()
}
