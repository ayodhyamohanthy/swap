import { Link, useLocation, useMatches } from '@tanstack/react-router'
import { ArrowLeftRight, ChevronLeft, House, Settings, User } from 'lucide-react'
import type { ReactNode } from 'react'
import { isAdminRoute } from '@/lib/admin'
import { useI18n } from '@/lib/i18n'
import { useOnline } from '@/lib/use-online'
import { useUnreadUpdates } from '@/lib/use-store'
import { cn } from '@/lib/utils'

/* Navigation rules (AGENTS.md 12): exactly three bottom tabs — Home / Swaps /
   Profile. Setup screens (language, note, privacy, alerts, sign-in) show no tab
   bar. */

export type TabId = 'home' | 'swaps' | 'profile'

export interface RouteChrome {
  /** tabs = top bar + bottom tabs · plain = back button, no tabs · setup = bare */
  chrome?: 'tabs' | 'plain' | 'setup'
  tab?: TabId
  /** Gear icon on the right of the top bar (Home and Profile designs). */
  showSettings?: boolean
}

function Wordmark({ className }: { className?: string }) {
  const { t } = useI18n()
  return (
    <span className={cn('font-head text-title font-bold text-primary', className)}>
      {t('brand.wordmark')}
    </span>
  )
}

function TopBar({ back, showSettings }: { back?: boolean; showSettings?: boolean }) {
  const { t } = useI18n()
  return (
    <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-line bg-card px-2">
      {back ? (
        <Link
          to="/"
          aria-label={t('common.back')}
          className="tap flex items-center justify-center rounded-full text-primary"
          onClick={(event) => {
            /* Prefer real history so "back" lands where the user came from. */
            if (window.history.length > 1) {
              event.preventDefault()
              window.history.back()
            }
          }}
        >
          <ChevronLeft aria-hidden className="size-6" />
        </Link>
      ) : null}
      <Wordmark className={cn('px-2', back && 'mx-auto')} />
      <span className="flex-1" />
      {showSettings && !back ? (
        <Link
          to="/profile"
          aria-label={t('profile.title')}
          className="tap flex items-center justify-center rounded-full text-primary"
        >
          <Settings aria-hidden className="size-6" />
        </Link>
      ) : null}
    </header>
  )
}

function TabBar({ active }: { active: TabId }) {
  const { t } = useI18n()
  const unread = useUnreadUpdates()
  const tabs = [
    { id: 'home' as const, to: '/', label: t('nav.home'), Icon: House },
    { id: 'swaps' as const, to: '/swaps', label: t('nav.swaps'), Icon: ArrowLeftRight },
    { id: 'profile' as const, to: '/profile', label: t('nav.profile'), Icon: User },
  ]
  return (
    <nav
      aria-label={t('brand.wordmark')}
      className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[34rem] border-t border-line bg-card pb-[env(safe-area-inset-bottom)]"
    >
      {tabs.map(({ id, to, label, Icon }) => {
        const badge = id === 'swaps' ? unread.length : 0
        return (
          <Link
            key={id}
            to={to}
            aria-current={active === id ? 'page' : undefined}
            aria-label={badge > 0 ? `${label}, ${badge} new` : label}
            className={cn(
              'tap relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-caption font-semibold',
              active === id ? 'text-primary' : 'text-muted',
            )}
          >
            <Icon aria-hidden className="size-6" />
            {label}
            {badge > 0 ? (
              <span
                aria-hidden
                className="absolute top-0.5 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-caption font-bold text-ink"
              >
                {badge > 9 ? '9+' : badge}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}

function OfflineBanner() {
  const { t } = useI18n()
  const online = useOnline()
  if (online) return null
  return (
    <p className="bg-accent px-3 py-2 text-center text-caption font-semibold text-ink">
      {t('offline.bar')}
    </p>
  )
}

export function AppFooter() {
  const { t } = useI18n()
  return (
    <footer className="px-4 pt-6 pb-2 text-center text-caption text-muted">
      <p>{t('footer.line1')}</p>
      <p>{t('footer.line2')}</p>
    </footer>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const matches = useMatches()
  const leaf = matches[matches.length - 1]
  const chrome = (leaf?.staticData ?? {}) as RouteChrome
  const mode = chrome.chrome ?? 'tabs'
  /* The admin console is a desktop tool (design 23: sidebar + six tiles + chart
     at ~1080px) and lays itself out with `lg:` rules — but `.app-column` clamps
     every screen to 34rem, so at a 1180px window the sidebar ate 224px of a
     544px column and the content got ~300px (L7 → L1 request). Admin opts out
     of the column; every passenger screen keeps it, because phone-first is the
     product design, not an accident.

     `useLocation` is the router's own state, so on `/` — the route the SPA
     shell is prerendered at — server and client agree exactly and nothing
     changes for any route except /admin. On a direct /admin load the client
     drops the class the '/'-prerendered HTML carries; that deep link already
     fails hydration once today on its chrome (TopBar/Tabs vs bare), and React
     reports one #418 per hydration attempt, so this adds no new error. */
  const location = useLocation()
  const inColumn = !isAdminRoute(location.pathname)

  return (
    <div className={cn('flex min-h-dvh flex-col', inColumn && 'app-column')}>
      {mode !== 'setup' ? <TopBar back={mode === 'plain'} showSettings={chrome.showSettings} /> : null}
      <OfflineBanner />
      <main className={cn('flex-1 px-4 pt-4', mode === 'setup' && 'pt-10', 'pb-8')}>{children}</main>
      {mode === 'tabs' ? <span className="h-24" aria-hidden /> : null}
      {mode === 'tabs' ? <TabBar active={chrome.tab ?? 'home'} /> : null}
    </div>
  )
}
