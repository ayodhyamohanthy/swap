import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { getSessionUser, signInWithGoogle } from '@/lib/session'
import { attachToAccount, isSeen, markSeen } from '@/lib/store'

/* Screen 12 "Google sign-in" (design 3b, no tab bar).
   Google is the only sign-in SeatSwap will ever offer (rule 8). It is asked
   on the FIRST send/accept; "Not now" returns without unlocking the send.
   With Supabase keys present this starts real Google OAuth; without them it
   records the local-first consent so offline builds keep working. */

export interface SigninSearch {
  redirect?: string
}

export const Route = createFileRoute('/signin')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  validateSearch: (search: Record<string, unknown>): SigninSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: SignInScreen,
})

function SignInScreen() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const search = Route.useSearch()
  const [busy, setBusy] = useState(false)

  const back = search.redirect && search.redirect.startsWith('/') ? search.redirect : '/'
  const REDIRECT_KEY = 'seatswap.signin.redirect'

  /* OAuth return: the session lands on /signin without the original query —
     restore it (and the asked flag) from sessionStorage. */
  useEffect(() => {
    let cancelled = false
    void getSessionUser().then((user) => {
      if (cancelled || !user) return
      const saved = typeof window === 'undefined' ? null : window.localStorage.getItem(REDIRECT_KEY)
      if (!isSeen('signin_asked')) markSeen('signin_asked')
      attachToAccount(user.id)
      const target = saved && saved.startsWith('/') ? saved : back
      navigate({ to: target as '/', replace: true })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function continueWithGoogle() {
    setBusy(true)
    try {
      const { url } = await signInWithGoogle()
      if (url) {
        try {
          window.localStorage.setItem(REDIRECT_KEY, back)
        } catch {
          /* private mode */
        }
        window.location.assign(url)
        return
      }
      /* No backend keys yet: record the asked+accepted sign-in locally. The
         real Google round-trip replaces this the moment env keys exist. */
      if (!isSeen('signin_asked')) markSeen('signin_asked')
      attachToAccount('device')
      navigate({ to: back as '/', replace: true })
    } catch {
      toast.show(t('signin.notReady'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-column">
      <p className="text-center font-head text-title font-bold text-primary">{t('brand.wordmark')}</p>
      <h1 className="mt-6 text-title text-ink">{t('signin.title')}</h1>
      <p className="mt-1 text-body text-muted">{t('signin.body')}</p>

      <Button className="mt-6" onClick={continueWithGoogle} disabled={busy}>
        {t('signin.google')}
      </Button>
      <p className="mt-2 text-center text-caption text-muted">{t('signin.note')}</p>
      <p className="mt-4 text-body text-muted">{t('first.signedOutNote')}</p>

      <Button
        variant="ghost"
        className="mt-2"
        onClick={() => navigate({ to: back as '/', replace: true })}
      >
        {t('signin.later')}
      </Button>
    </div>
  )
}
