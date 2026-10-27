import { useI18n } from '@/lib/i18n'

/* Shown when a route render throws. Replaces the router's bare English
   default (a stack trace in dev, an unbranded English overlay in prod) with
   the app's own calm copy in the reader's language, and a retry that
   re-renders the failed route. Error details stay out of the screen: they can
   carry data the reader must not see; dev logs them to the console instead. */
export function ErrorScreen({
  error,
  reset,
}: {
  error: unknown
  reset: () => void
}) {
  const { t } = useI18n()
  if (import.meta.env.DEV) console.error('[error-screen]', error)
  return (
    <main className="flex flex-col gap-3 p-6" data-testid="error-screen">
      <h1 className="text-xl font-semibold">{t('error.title')}</h1>
      <p>{t('error.body')}</p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex min-h-11 items-center font-medium underline"
      >
        {t('error.retry')}
      </button>
    </main>
  )
}
