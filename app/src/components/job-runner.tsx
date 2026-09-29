import { useEffect } from 'react'
import { runDueJobs } from '@/lib/job-sweep'
import { subscribe as subscribeRequests } from '@/lib/requests'
import { subscribe } from '@/lib/store'

/* Runs the scheduled jobs of docs/03 on this device (docs/08: the device is the
   system of record until a backend exists). Three ticks:

   - when the app starts, so a journey that ended overnight is settled;
   - when it comes back to the foreground, because an on-board traveller leaves
     SeatSwap open all day and the chart flip has to land while nobody is
     pressing anything;
   - after the device's own state changes, so a PNR added for today is on the
     chart board in the same session rather than after a reload.

   The state tick is coalesced into a timer: a sweep that commits (a chart flip
   writes an activity row) would otherwise re-enter its own listener. */
export function JobRunner() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    let timer = 0
    const schedule = () => {
      if (timer) return
      timer = window.setTimeout(() => {
        timer = 0
        runDueJobs()
      }, 0)
    }

    runDueJobs()
    const stopStore = subscribe(schedule)
    const stopRequests = subscribeRequests(schedule)
    const onVisible = () => {
      if (document.visibilityState === 'visible') runDueJobs()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearTimeout(timer)
      stopStore()
      stopRequests()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return null
}
