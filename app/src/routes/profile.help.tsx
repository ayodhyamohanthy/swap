import { Link, createFileRoute } from '@tanstack/react-router'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'

/* Screen 61 "Help" (design 22a). Plain questions, plain answers, and the one
   mandated dispute line (rule 7): no promised reply time, and the traveller is
   told their money is held safely. No lawyer-style wording anywhere. */

export const Route = createFileRoute('/profile/help')({
  staticData: { chrome: 'tabs', tab: 'profile' } satisfies RouteChrome,
  component: HelpScreen,
})

function HelpScreen() {
  const { t } = useI18n()

  const faqs: Array<[Parameters<typeof t>[0], Parameters<typeof t>[0]]> = [
    ['help.allowed', 'help.allowedBody'],
    ['help.payQ', 'help.payABody'],
    ['help.creditQ', 'help.creditABody'],
    ['help.pnrQ', 'help.pnrABody'],
  ]

  return (
    <div>
      <h1 className="text-title text-ink">{t('help.title')}</h1>

      <div className="mt-4 space-y-3">
        {faqs.map(([question, answer]) => (
          <Card key={question}>
            <CardTitle>{t(question)}</CardTitle>
            <CardBody className="mt-1">{t(answer)}</CardBody>
          </Card>
        ))}
      </div>

      <Card className="mt-4 border-primary/30 bg-wash">
        <CardTitle>{t('dispute.title')}</CardTitle>
        <CardBody className="mt-1 text-ink">{t('dispute.body')}</CardBody>
      </Card>

      <p className="mt-4 text-body text-muted">{t('help.contact')}</p>

      <Button className="mt-4" variant="outline" asChild>
        <Link to="/swaps">{t('nav.swaps')}</Link>
      </Button>

      <AppFooter />
    </div>
  )
}
