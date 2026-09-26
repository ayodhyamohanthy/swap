import { createFileRoute } from '@tanstack/react-router'
import { Copy, PartyPopper, Share2 } from 'lucide-react'
import { useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { getRequest } from '@/lib/requests'
import { getTrip } from '@/lib/store'

/* Screens 42/44 "Share your trip card / Share good deed" (design 6c, 26b):
   a card with no private details plus the same anywhere-share sheet as the
   coach invite. The link never contains a PNR or name (privacy rule 13). */
export const Route = createFileRoute('/swaps/$id/share')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: ShareCardScreen,
})
type Platform = 'whatsapp' | 'instagram' | 'facebook' | 'telegram' | 'sms'
function ShareCardScreen() {
  const { id } = Route.useParams()
  const { t } = useI18n()
  const toast = useToast()
  const [showQr, setShowQr] = useState(false)
  const request = getRequest(id)
  const trip = request ? getTrip(request.trip_id) : undefined
  const train = trip?.train_name
    ? `${trip.train_name} ${trip.train_no}`
    : (trip?.train_no ?? t('shareCard.title'))
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const link = trip ? `${origin}/train/${trip.train_no}?date=${encodeURIComponent(trip.journey_date ?? '')}` : origin
  const text = t('shareCard.body', { train })

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${text} ${link}`)
      toast.show(t('common.copied'))
    } catch {
      toast.show(link)
    }
  }
  async function nativeShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'SeatSwap', text, url: link })
        return
      } catch {
        /* user closed the sheet — fall through to copy */
      }
    }
    void copyLink()
  }
  function open(platform: Platform) {
    const encoded = encodeURIComponent(link)
    const body = encodeURIComponent(`${text} ${link}`)
    const urls: Record<Platform, string> = {
      whatsapp: `https://wa.me/?text=${body}`,
      telegram: `https://t.me/share/url?url=${encoded}&text=${encodeURIComponent(text)}`,
      sms: `sms:?&body=${body}`,
      instagram: `instagram://`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
    }
    window.open(urls[platform], '_blank', 'noopener')
  }
  return (
    <div>
      <h1 className="text-title text-ink">{t('shareCard.title')}</h1>
      <Card className="mt-4 border-accent/40 bg-accent-soft">
        <span className="flex size-11 items-center justify-center rounded-xl bg-card text-accent">
          <PartyPopper aria-hidden className="size-6" />
        </span>
        <CardTitle className="mt-2">{text}</CardTitle>
        <CardBody>{t('shareCard.note')}</CardBody>
      </Card>
      <Button className="mt-4" onClick={nativeShare}>
        <Share2 aria-hidden className="size-5" />
        {t('share.native')}
      </Button>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => open('whatsapp')}>
          {t('share.whatsapp')}
        </Button>
        <Button variant="outline" onClick={() => open('telegram')}>
          {t('share.telegram')}
        </Button>
        <Button variant="outline" onClick={() => open('facebook')}>
          {t('share.facebook')}
        </Button>
        <Button variant="outline" onClick={() => open('instagram')}>
          {t('share.instagram')}
        </Button>
        <Button variant="outline" onClick={() => open('sms')}>
          {t('share.sms')}
        </Button>
        <Button variant="outline" onClick={copyLink}>
          <Copy aria-hidden className="size-4" />
          {t('share.copy')}
        </Button>
      </div>
      <Button variant="ghost" className="mt-2" onClick={() => setShowQr((shown) => !shown)}>
        {t('share.qr')}
      </Button>
      {showQr ? (
        <Card className="mt-2 items-center text-center">
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}`}
            alt={t('share.qr')}
            className="mx-auto size-44 rounded-card bg-card"
            width={176}
            height={176}
          />
          <CardBody>{t('share.qrNote')}</CardBody>
        </Card>
      ) : null}
      <AppFooter />
    </div>
  )
}
