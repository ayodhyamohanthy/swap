import { createFileRoute } from '@tanstack/react-router'
import { Copy, QrCode, Share2 } from 'lucide-react'
import { useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { useOnline } from '@/lib/use-online'

/* Screen 18 "Invite / share anywhere" (design 14b): WhatsApp, Instagram,
   Facebook, Telegram, SMS, Copy link, QR — the growth loop from docs/01.
   The link itself never contains a PNR or name (privacy rule 13). */

export const Route = createFileRoute('/share/$trainDate')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: ShareScreen,
})

type Platform = 'whatsapp' | 'instagram' | 'facebook' | 'telegram' | 'sms'

function ShareScreen() {
  const { trainDate } = Route.useParams()
  const { t } = useI18n()
  const toast = useToast()
  const online = useOnline()
  const [showQr, setShowQr] = useState(false)

  const [trainNo, journeyDate] = trainDate.split('-')
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const link = `${origin}/train/${trainNo}?date=${encodeURIComponent(journeyDate ?? '')}`
  const text = t('share.body')

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      toast.show(t('share.copied'))
    } catch {
      toast.show(t('share.link'))
    }
  }

  async function nativeShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: t('share.title', { train: trainNo }), text, url: link })
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
      /* Instagram/Facebook have no universal text-share URL — open the app
         and let the user paste the copied link. */
      instagram: `instagram://`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
    }
    window.open(urls[platform], '_blank', 'noopener')
  }

  return (
    <div>
      <h1 className="text-title text-ink">{t('share.title', { train: trainNo })}</h1>
      <p className="mt-1 text-body text-muted">{t('share.body')}</p>

      <Button className="mt-4" onClick={nativeShare}>
        <Share2 aria-hidden className="size-5" />
        {t('share.native')}
      </Button>

      <Card className="mt-4">
        <CardTitle>{t('share.link')}</CardTitle>
        <CardBody className="break-all text-muted">{link}</CardBody>
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
      </Card>

      <Button
        variant="outline"
        className="mt-3"
        onClick={() => setShowQr((shown) => !shown)}
        disabled={!online}
      >
        <QrCode aria-hidden className="size-5" />
        {t('share.qr')}
      </Button>

      {showQr && online ? (
        <Card className="mt-3 items-center text-center">
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
      {!online ? <p className="mt-2 text-caption text-muted">{t('offline.bar')}</p> : null}
    </div>
  )
}