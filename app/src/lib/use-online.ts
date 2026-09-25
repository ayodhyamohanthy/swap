import { useEffect, useState } from 'react'

/** Network state for the offline banner (docs/08: offline Trips stay readable). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setOnline(window.navigator.onLine !== false)
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}
