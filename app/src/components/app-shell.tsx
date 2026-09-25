import { Link, useMatches } from '@tanstack/react-router'
import { ArrowLeftRight, ChevronLeft, House, Settings, User } from 'lucide-react'
import type { ReactNode } from 'react'
import { useI18n } from '@/lib/i18n'
import { useOnline } from '@/lib/use-online'
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
      {tabs.map(({ id, to, label, Icon }) => (
        <Link
          key={id}
          to={to}
          aria-current={active === id ? 'page' : undefined}
          className={cn(
            'tap flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-caption font-semibold',
            active === id ? 'text-primary' : 'text-muted',
          )}
        >
          <Icon aria-hidden className="size-6" />
          {label}
        </Link>
      ))}
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

  return (
    <div className="app-column flex min-h-dvh flex-col">
      {mode !== 'setup' ? <TopBar back={mode === 'plain'} showSettings={chrome.showSettings} /> : null}
      <OfflineBanner />
      <main className={cn('flex-1 px-4 pt-4', mode === 'setup' && 'pt-10', 'pb-8')}>{children}</main>
      {mode === 'tabs' ? <span className="h-24" aria-hidden /> : null}
      {mode === 'tabs' ? <TabBar active={chrome.tab ?? 'home'} /> : null}
    </div>
  )
}
