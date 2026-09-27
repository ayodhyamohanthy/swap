import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/input'
import { formatTripDate, useI18n } from '@/lib/i18n'
import { isChairCar, maskPnr, parseBookingSms, type ParsedBookingSms } from '@/lib/pnr'

/* Growth loop 8 (docs/01): free berth check by PNR — paste the IRCTC booking
   SMS and see the berth. No sign-in, nothing saved, nothing sent: the parse
   runs on this device only (docs/08), matching growth.berthCheckBody. */
export const Route = createFileRoute('/check')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: BerthCheckScreen,
})

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <dt className="text-body text-muted">{label}</dt>
      <dd className="text-body font-semibold text-ink">{value}</dd>
    </div>
  )
}

function BerthCheckScreen() {
  const { t, status, type, lang } = useI18n()
  const [sms, setSms] = useState('')
  const [result, setResult] = useState<ParsedBookingSms | null>(null)
  const [attempted, setAttempted] = useState(false)

  function read() {
    setResult(parseBookingSms(sms))
    setAttempted(true)
  }

  const found = result !== null && (Boolean(result.berth_no) || Boolean(result.status))
  return (
    <div>
      <h1 className="text-title text-ink">{t('growth.berthCheck')}</h1>
      <p className="mt-1 text-body text-muted">{t('growth.berthCheckBody')}</p>

      <Card className="mt-4">
        <CardTitle>{t('add.pasteTitle')}</CardTitle>
        <CardBody className="mt-1">{t('add.pasteBody')}</CardBody>
        <Textarea
          aria-label={t('add.pasteTitle')}
          className="mt-2"
          rows={4}
          value={sms}
          placeholder={t('add.smsPlaceholder')}
          onChange={(event) => setSms(event.target.value)}
        />
        <Button type="button" className="mt-2" onClick={read}>
          {t('add.submit')}
        </Button>
      </Card>

      {attempted ? (
        <Card className="mt-4">
          {found && result ? (
            <>
              <CardTitle>{t('check.resultTitle')}</CardTitle>
              <dl className="mt-1">
                {result.pnr ? <Row label={t('add.pnrLabel')} value={maskPnr(result.pnr)} /> : null}
                {result.train_no ? <Row label={t('add.trainNo')} value={result.train_no} /> : null}
                {result.journey_date ? (
                  <Row label={t('add.date')} value={formatTripDate(result.journey_date, lang)} />
                ) : null}
                {result.class ? <Row label={t('add.class')} value={result.class} /> : null}
                {result.coach ? <Row label={t('add.coach')} value={result.coach} /> : null}
                {result.berth_no ? (
                  <Row
                    label={isChairCar(result.class) ? t('add.seatNo') : t('add.berthNo')}
                    value={
                      result.berth_type
                        ? `${result.berth_no} · ${type(result.berth_type)}`
                        : result.berth_no
                    }
                  />
                ) : null}
                {result.status ? (
                  <Row label={t('add.status')} value={status(result.status)} />
                ) : null}
              </dl>
            </>
          ) : (
            <CardBody>{t('check.needSms')}</CardBody>
          )}
        </Card>
      ) : null}

      <Button variant="outline" className="mt-4" asChild>
        <Link to="/trips/add" search={{ paste: 'sms' }}>
          {t('trainPage.cta')}
        </Link>
      </Button>
      <AppFooter />
    </div>
  )
}