import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Handshake, Smartphone, Ticket } from 'lucide-react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { CardRow } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { logActivity, markSeen, updateSettings } from '@/lib/store'

/* Screen 3 "Before you start" (design 12a) — shown once, no tab bar.
   Copy comes from docs/09: convenience app · swap only if both agree · keep your
   original ticket and ID. */

export const Route = createFileRoute('/welcome/note')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: NoteScreen,
})

function NoteScreen() {
  const { t } = useI18n()
  const navigate = useNavigate()

  function gotIt() {
    markSeen('note')
    updateSettings({ note_acknowledged_at: new Date().toISOString() })
    logActivity('note_acknowledged')
    navigate({ to: '/' })
  }

  const rows = [
    { icon: <Smartphone aria-hidden className="size-6" />, text: t('note.convenience') },
    { icon: <Handshake aria-hidden className="size-6" />, text: t('note.agree') },
    { icon: <Ticket aria-hidden className="size-6" />, text: t('note.ticketId') },
  ]

  return (
    <div className="app-column">
      <p className="text-center font-head text-title font-bold text-primary">{t('brand.wordmark')}</p>
      <h1 className="mt-6 text-center text-title text-ink">{t('note.title')}</h1>

      <div className="mt-6 flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.text} className="rounded-card border border-line bg-card p-3 shadow-soft">
            <CardRow icon={row.icon} title={row.text} />
          </div>
        ))}
      </div>

      <Button className="mt-6" onClick={gotIt}>
        {t('note.gotIt')}
      </Button>
      <p className="mt-4 text-center text-caption text-muted">{t('footer.line2')}</p>
    </div>
  )
}
