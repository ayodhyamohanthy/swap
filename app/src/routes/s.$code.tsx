import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftRight, ShieldCheck, Users } from 'lucide-react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { resolveInvite } from '@/lib/invites'

/* Screen "WhatsApp link landing" (docs/04, setup screens in AGENTS.md rule 12):
   a shared `/s/$code` link opened outside the app. No tab bar, nothing about
   the sharer beyond "a traveller on a train" — the code holds no PNR, name or
   berth number (rule 13). Unknown or expired codes simply say so. */

export const Route = createFileRoute('/s/$code')({
  staticData: { chrome: 'setup' } satisfies RouteChrome,
  component: InviteLanding,
})

function InviteLanding() {
  const { code } = Route.useParams()
  const { t } = useI18n()
  const invite = resolveInvite(code)

  /* A board link is a real destination — send the visitor straight there. */
  if (invite?.kind === 'board') {
    return (
      <div className="app-column text-center">
        <p className="font-head text-title font-bold text-primary">{t('brand.wordmark')}</p>
        <span className="mx-auto mt-8 flex size-20 items-center justify-center rounded-full bg-wash text-primary">
          <Users aria-hidden className="size-10" />
        </span>
        <h1 className="mt-4 text-title text-ink">{t('invite.boardTitle')}</h1>
        <p className="mt-1 text-body text-muted">{t('invite.boardBody')}</p>
        <Button className="mt-6" asChild>
          <Link to="/onboard/$tripId" params={{ tripId: invite.ref_id }}>
            {t('invite.boardCta')}
          </Link>
        </Button>
        <Button className="mt-2" variant="outline" asChild>
          <Link to="/">{t('invite.openApp')}</Link>
        </Button>
      </div>
    )
  }

  /* A request link needs sign-in before it can be accepted (rule 8) and never
     costs the acceptor anything (rule 3). */
  if (invite?.kind === 'request') {
    const redirect = `/incoming/${invite.ref_id}`
    return (
      <div className="app-column text-center">
        <p className="font-head text-title font-bold text-primary">{t('invite.title')}</p>
        <span className="mx-auto mt-8 flex size-20 items-center justify-center rounded-full bg-wash text-primary">
          <ArrowLeftRight aria-hidden className="size-10" />
        </span>
        <h1 className="mt-4 text-title text-ink">{t('invite.askTitle')}</h1>
        <p className="mt-1 text-body text-muted">{t('invite.askBody')}</p>
        <Card className="mt-6 text-left">
          <CardTitle>{t('incoming.earn')}</CardTitle>
          <CardBody className="mt-1 flex gap-2">
            <ShieldCheck aria-hidden className="size-4 shrink-0" />
            {t('invite.privacy')}
          </CardBody>
        </Card>
        <Button
          className="mt-6"
          onClick={() => {
            window.location.assign(`/signin?redirect=${encodeURIComponent(redirect)}`)
          }}
        >
          {t('invite.askCta')}
        </Button>
        <Button className="mt-2" variant="outline" asChild>
          <Link to="/">{t('invite.openApp')}</Link>
        </Button>
        <p className="mt-4 text-caption text-muted">{t('footer.line2')}</p>
      </div>
    )
  }

  return (
    <div className="app-column text-center">
      <p className="font-head text-title font-bold text-primary">{t('brand.wordmark')}</p>
      <h1 className="mt-8 text-title text-ink">{t('invite.bad')}</h1>
      <Button className="mt-6" asChild>
        <Link to="/">{t('invite.openApp')}</Link>
      </Button>
      <p className="mt-4 text-caption text-muted">{t('footer.line2')}</p>
    </div>
  )
}
