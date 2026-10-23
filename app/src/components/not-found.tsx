import { Link } from '@tanstack/react-router'
import { useI18n } from '@/lib/i18n'

/* Shown for any URL that matches no route. Replaces the router's bare
   English "Not Found" so Hindi readers get a way back home. */
export function NotFoundScreen() {
  const { t } = useI18n()
  return (
    <main className="flex flex-col gap-3 p-6" data-testid="not-found">
      <h1 className="text-xl font-semibold">{t('notFound.title')}</h1>
      <p>{t('notFound.body')}</p>
      <Link to="/" className="inline-flex min-h-11 items-center font-medium underline">
        {t('notFound.home')}
      </Link>
    </main>
  )
}
