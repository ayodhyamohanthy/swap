import { createFileRoute } from '@tanstack/react-router'
import { Copy, PartyPopper, Share2 } from 'lucide-react'
import { useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { trackEvent } from '@/lib/analytics'
import { getRequest } from '@/lib/requests'
import { getTrip } from '@/lib/store'
import { INSTAGRAM_INBOX_URL, instagramClipboardText, inviteLink, shareDateLabel } from '@/lib/share'

/* Screens 42/44 "Share your trip card / Share good deed" (design 6c, 26b):
   a card with no private details plus the same anywhere-share sheet as the
   coach invite. The link never contains a PNR or name (privacy rule 13). */
export const Route = createFileRoute('/swaps/$id/share')({
  staticData: { chrome: 'tabs', tab: 'swaps' } satisfies RouteChrome,
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
  /* inviteLink drops the query when the date is unknown; the inline version
     printed a dangling `?date=` that claimed a date and supplied none. */
  const link = trip
    ? inviteLink(origin, trip.journey_date ? `${trip.train_no}-${trip.journey_date}` : trip.train_no)
    : origin
  const dateLabel = shareDateLabel(trip?.journey_date)
  const text = dateLabel
    ? t('shareCard.bodyDated', { train, date: dateLabel })
    : t('shareCard.body', { train })

  async function copyLink() {
    trackEvent('share_clicked', { platform: 'copy', context: 'swap' })
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
        trackEvent('share_clicked', { platform: 'native', context: 'swap' })
        await navigator.share({ title: 'SeatSwap', text, url: link })
        return
      } catch {
        /* user closed the sheet — fall through to copy */
      }
    }
    void copyLink()
  }
  async function open(platform: Platform) {
    trackEvent('share_clicked', { platform, context: 'swap' })
    if (platform === 'instagram') {
      /* No Instagram text-share URL exists: copy the whole message first. */
      try {
        await navigator.clipboard.writeText(instagramClipboardText(text, link))
        toast.show(t('share.instagramCopied'))
      } catch {
        toast.show(link)
      }
      window.open(INSTAGRAM_INBOX_URL, '_blank', 'noopener')
      return
    }
    const encoded = encodeURIComponent(link)
    const body = encodeURIComponent(`${text} ${link}`)
    const urls: Record<Platform, string> = {
      whatsapp: `https://wa.me/?text=${body}`,
      telegram: `https://t.me/share/url?url=${encoded}&text=${encodeURIComponent(text)}`,
      sms: `sms:?&body=${body}`,
      instagram: INSTAGRAM_INBOX_URL,
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
          <CardTitle>{t('share.qrHeading')}</CardTitle>
          <p className="mt-1 font-head text-section text-ink">{train}</p>
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}`}
            alt={t('share.qr')}
            className="mx-auto my-3 size-44 rounded-card bg-card"
            width={176}
            height={176}
          />
          <CardBody>
            {dateLabel ? t('share.qrScan', { train, date: dateLabel }) : t('share.qrNote')}
          </CardBody>
          <p className="break-all text-caption text-muted">{link}</p>
        </Card>
      ) : null}
      <AppFooter />
    </div>
  )
}
