import { useSyncExternalStore } from 'react'
import {
  getServerSnapshot,
  getSnapshot,
  subscribe,
  type AppState,
  type Trip,
} from './store'

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
