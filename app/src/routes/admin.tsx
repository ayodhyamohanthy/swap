import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { RouteChrome } from '@/components/app-shell'
import { ADMIN_ROUTES } from '@/lib/admin'
import { useI18n } from '@/lib/i18n'

/* Admin console shell (docs/05 screens A1-A6).
   chrome: 'setup' is deliberate — the passenger tab bar must never appear here
   (AGENTS.md rule 12: exactly three tabs, on the passenger app only). This is a
   desktop tool, so it draws its own sidebar and header.

   The server guard lives in `@/server/admin` and runs `is_staff()` in Postgres.
   Nothing here decides who is an admin: this file is chrome and navigation
   only, exactly as `lib/admin.ts` documents. */

export const Route = createFileRoute('/admin')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: AdminLayout,
})

/** ADMIN_ROUTES labels -> i18n keys, typed so `t()` stays strict. */
const LABEL_KEYS: Record<(typeof ADMIN_ROUTES)[number]['label'], 'admin.overview' | 'admin.log' | 'admin.users' | 'admin.swaps' | 'admin.payments' | 'admin.credits' | 'admin.reports'> = {
  Overview: 'admin.overview',
  'Activity log': 'admin.log',
  Users: 'admin.users',
  Swaps: 'admin.swaps',
  Payments: 'admin.payments',
  Credits: 'admin.credits',
  Reports: 'admin.reports',
}

function AdminLayout() {
  const { t } = useI18n()

  return (
    <div className="lg:flex lg:gap-6">
      <aside className="lg:w-56 lg:shrink-0">
        <p className="font-head text-title font-bold text-primary">{t('admin.title')}</p>
        <nav className="mt-3 flex flex-wrap gap-2 lg:flex-col">
          {ADMIN_ROUTES.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className="rounded-btn border border-line bg-card px-3 py-2 text-body font-semibold text-ink hover:border-primary active:border-primary"
            >
              {t(LABEL_KEYS[item.label])}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="mt-6 min-w-0 flex-1 lg:mt-0">
        <Outlet />
        <p className="mt-6">
          <Link to="/" className="inline-flex min-h-12 items-center gap-1.5 text-body text-primary">
            <ArrowLeft aria-hidden className="size-5" />
            {t('admin.backToApp')}
          </Link>
        </p>
      </div>
    </div>
  )
}
