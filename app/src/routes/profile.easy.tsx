import { createFileRoute } from '@tanstack/react-router'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/lib/i18n'
import { useTrips } from '@/lib/use-store'

/* Screen 54 "Swapping for my parents · easy mode" (design 10b). Easy mode is
   bigger text across the whole app and nothing else — it never changes what is
   shown to other travellers, so privacy rules are untouched. */

export const Route = createFileRoute('/profile/easy')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: EasyModeScreen,
})

function EasyModeScreen() {
  const { t, easy, setEasy } = useI18n()
  const trips = useTrips()

  return (
    <div>
      <h1 className="text-title text-ink">{t('easy.title')}</h1>
      <p className="mt-1 text-body text-muted">{t('easy.body')}</p>

      <Card className="mt-4 flex items-center gap-3">
        <span className="flex-1">
          <b className="block font-head text-body text-ink">{t('profile.easy')}</b>
          <span className="block text-caption text-muted">
            {easy ? t('easy.on') : t('easy.off')}
          </span>
        </span>
        <Switch checked={easy} aria-label={t('easy.title')} onCheckedChange={setEasy} />
      </Card>

      <Card className="mt-4">
        <CardTitle>{t('groups.parents')}</CardTitle>
        <CardBody className="mt-1">{t('groups.parentsBody')}</CardBody>
        <CardBody className="mt-2">{t('profile.myTrips')}: {trips.length}</CardBody>
      </Card>

      <AppFooter />
    </div>
  )
}
