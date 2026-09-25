import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { LANGUAGES, useI18n } from '@/lib/i18n'
import { isSeen, markSeen } from '@/lib/store'

/* Screen 2 "Choose language" (design 10a) — first open only, no tab bar.
   English + Hindi ship today; the other 22 scheduled languages are listed and
   open as translations land (docs/01). */

export const Route = createFileRoute('/welcome/language')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: LanguageScreen,
})

function LanguageScreen() {
  const { t, lang, setLang } = useI18n()
  const navigate = useNavigate()
  const [showAll, setShowAll] = useState(false)

  const shipped = LANGUAGES.filter((option) => option.ready)
  const upcoming = LANGUAGES.filter((option) => !option.ready)

  function continueOn() {
    markSeen('language')
    navigate({ to: isSeen('note') ? '/' : '/welcome/note' })
  }

  return (
    <div className="app-column">
      <p className="text-center font-head text-title font-bold text-primary">{t('brand.wordmark')}</p>
      <h1 className="mt-6 text-title text-ink">{t('language.title')}</h1>

      <div className="mt-4 flex flex-col gap-2">
        {shipped.map((option) => (
          <button
            key={option.code}
            type="button"
            onClick={() => setLang(option.code as typeof lang)}
            aria-pressed={lang === option.code}
            className={
              'flex min-h-14 items-center gap-3 rounded-card border bg-card px-4 text-left font-head text-section text-ink ' +
              (lang === option.code ? 'border-primary outline-2 outline-primary' : 'border-line')
            }
          >
            <span className="flex-1">{option.native}</span>
            {lang === option.code ? <Check aria-hidden className="size-5 text-primary" /> : null}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setShowAll((open) => !open)}
        className="mt-4 flex min-h-12 w-full items-center justify-center font-semibold text-primary"
      >
        {t('language.more')}
      </button>

      {showAll ? (
        <div className="flex flex-col gap-2">
          {upcoming.map((option) => (
            <div
              key={option.code}
              className="flex min-h-14 items-center gap-3 rounded-card border border-line bg-card px-4"
            >
              <span className="flex-1 font-head text-section text-ink">{option.native}</span>
              <Pill>{t('common.comingSoon')}</Pill>
            </div>
          ))}
        </div>
      ) : null}

      <p className="mt-4 text-caption text-muted">{t('language.note')}</p>

      <Button className="mt-6" onClick={continueOn}>
        {t('language.continue')}
      </Button>
    </div>
  )
}
