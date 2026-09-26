import { useSyncExternalStore } from 'react'
import {
  getServerSnapshot,
  getSnapshot,
  subscribe,
  type AppState,
  type Trip,
} from './store'
import {
  getRequestsServerSnapshot,
  getRequestsSnapshot,
  subscribe as subscribeRequests,
  type RequestsState,
  type SwapOffer,
  type SwapRequest,
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
