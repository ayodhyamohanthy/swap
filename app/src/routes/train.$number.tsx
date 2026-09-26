import { Link, createFileRoute } from '@tanstack/react-router'
import { Armchair, BedDouble } from 'lucide-react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { useI18n } from '@/lib/i18n'
import { BERTH_BERTH_TYPES, SEAT_TYPES, isChairCar, type TravelClass } from '@/lib/pnr'
import { useTrips } from '@/lib/use-store'

/* Screen 65 "Public train page" (docs/05): a berth-layout guide for search
   traffic. It is a public page, so it shows NO passenger data at all — no name,
   no PNR, no berth number (rule 13). Just the coach layout words and a CTA. */

export const Route = createFileRoute('/train/$number')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: TrainPage,
})

/** Classes whose coaches use the 3/2-tier berth words. */
const BERTH_CLASSES: readonly TravelClass[] = ['1A', '2A', '3A', 'SL']
const CHAIR_CLASSES: readonly TravelClass[] = ['CC', 'EC', '2S', '3E']

function TrainPage() {
  const { number } = Route.useParams()
  const { t, type } = useI18n()
  const trips = useTrips()

  const trainNo = number.trim()
  /* If the traveller already added this train we can mark it; otherwise the
     page stays generic. Either way no trip details are rendered. */
  const onThisTrain = trips.some((trip) => trip.train_no === trainNo)

  return (
    <div>
      <h1 className="text-title text-ink">{t('trainPage.title', { n: trainNo })}</h1>
      <p className="mt-1 text-body text-muted">{t('trainPage.body', { n: trainNo })}</p>

      <Card className="mt-4">
        <CardTitle>{t('trainPage.layout')}</CardTitle>
        <CardBody className="mt-1">{t('trainPage.coaches')}</CardBody>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {BERTH_BERTH_TYPES.map((berth) => (
            <Pill key={berth} tone="primary">
              {type(berth)}
            </Pill>
          ))}
        </div>
        <CardBody className="mt-2 flex gap-2">
          <BedDouble aria-hidden className="size-4 shrink-0" />
          {t('trainPage.slNote')}
        </CardBody>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {SEAT_TYPES.map((seat) => (
            <Pill key={seat} tone="accent">
              {type(seat)}
            </Pill>
          ))}
        </div>
        <CardBody className="mt-2 flex gap-2">
          <Armchair aria-hidden className="size-4 shrink-0" />
          {t('trainPage.ccNote')}
        </CardBody>
      </Card>

      <Card className="mt-3">
        <CardBody className="flex flex-wrap gap-1.5">
          {[...BERTH_CLASSES, ...CHAIR_CLASSES].map((travelClass) => (
            <Pill key={travelClass} tone={isChairCar(travelClass) ? 'accent' : 'primary'}>
              {travelClass}
            </Pill>
          ))}
        </CardBody>
      </Card>

      {onThisTrain ? (
        <p className="mt-4 text-body font-semibold text-ink">{t('growth.berthCheck')}</p>
      ) : null}

      <Button className="mt-4" asChild>
        <Link to="/trips/add">{t('trainPage.cta')}</Link>
      </Button>

      <AppFooter />
    </div>
  )
}
