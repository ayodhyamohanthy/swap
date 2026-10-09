import { createFileRoute } from '@tanstack/react-router'
import { Copy, QrCode, Share2 } from 'lucide-react'
import { useState } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { trackEvent } from '@/lib/analytics'
import { INSTAGRAM_INBOX_URL, instagramClipboardText, inviteLink, shareDateLabel, splitTrainDate } from '@/lib/share'
import { useOnline } from '@/lib/use-online'

/* Screen 18 "Invite / share anywhere" (design 14b): WhatsApp, Instagram,
   Facebook, Telegram, SMS, Copy link, QR — the growth loop from docs/01.
   The link itself never contains a PNR or name (privacy rule 13).
   The QR is drawn on this device with a canvas fallback (no QR image vendor):
   at a station with no signal the link still shows for typing, and the code
   never leaves the phone until scanned. */

export const Route = createFileRoute('/share/$trainDate')({
  staticData: { chrome: 'tabs', tab: 'swaps' } satisfies RouteChrome,
  component: ShareScreen,
})

type Platform = 'whatsapp' | 'instagram' | 'facebook' | 'telegram' | 'sms'

function ShareScreen() {
  const { trainDate } = Route.useParams()
  const { t } = useI18n()
  const toast = useToast()
  const online = useOnline()
  const [showQr, setShowQr] = useState(false)

  const { trainNo, journeyDate } = splitTrainDate(trainDate)
  const dateLabel = shareDateLabel(journeyDate)
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const link = inviteLink(origin, trainDate)
  /* The message that lands in someone ELSE's WhatsApp. This used to be
     `share.body`, which is written for the person looking at this screen
     ("Share this link anywhere") — so every invite told its recipient to go and
     share it. Sender-facing copy stays on the screen; this is the invitation,
     and it is addressed to whoever receives it. */
  const text = dateLabel
    ? t('share.messageDated', { train: trainNo, date: dateLabel })
    : t('share.message', { train: trainNo })

  async function copyLink() {
    trackEvent('share_clicked', { platform: 'copy' })
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
        trackEvent('share_clicked', { platform: 'native' })
        await navigator.share({ title: t('share.title', { train: trainNo }), text, url: link })
        return
      } catch {
        /* user closed the sheet — fall through to copy */
      }
    }
    void copyLink()
  }

  async function open(platform: Platform) {
    trackEvent('share_clicked', { platform })
    if (platform === 'instagram') {
      /* No text-share URL exists for Instagram: put the full message on the
         clipboard so nothing is lost, then open the app. */
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
      {/* Design 2b "Invite your coach": the ask, the reason it works, then the
          one button the design leads with. The platform row stays below it —
          docs/01's growth loop needs Instagram/Facebook/Telegram/SMS too, and
          the QR is the no-signal path (docs/10). */}
      <h1 className="text-title text-ink">{t('share.heading')}</h1>
      <p className="mt-1 text-body text-muted">{t('share.coachSub')}</p>
      <p className="mt-3 font-head text-headline text-ink">
        {t('share.title', { train: trainNo })}
      </p>
      {/* Design 14b prints a body line between the headline and the buttons.
          The string was already in the catalog, and on this screen it was never
          rendered — it was being sent as the WhatsApp message instead, which is
          where the wrong-audience bug came from. One string, two audiences, and
          only one of them was ever served. */}
      <p className="mt-1 text-body text-muted">{t('share.body')}</p>

      <Button className="mt-4" onClick={() => open('whatsapp')}>
        <Share2 aria-hidden className="size-5" />
        {t('share.whatsappCta')}
      </Button>

      {/* Design 14b's second action is "Copy link" — the one that always works,
          on every device, with nothing installed. A generic "Share…" sat in
          this slot instead, while the real Copy link was demoted into the
          six-button grid. The native sheet keeps its place below the link card
          rather than taking the design's slot. */}
      <Button className="mt-2" variant="outline" onClick={copyLink}>
        <Copy aria-hidden className="size-5" />
        {t('share.copy')}
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

      {/* Not in design 14b, and deliberately kept: the OS share sheet reaches
          every app the six buttons above cannot (Signal, a college group, the
          phone's own messages), which is the whole growth loop. It is below the
          link card so it cannot displace the design's two lead actions. */}
      <Button className="mt-3" variant="outline" onClick={nativeShare}>
        <Share2 aria-hidden className="size-5" />
        {t('share.native')}
      </Button>

      <Button
        variant="outline"
        className="mt-3"
        onClick={() => setShowQr((shown) => !shown)}
      >
        <QrCode aria-hidden className="size-5" />
        {t('share.qr')}
      </Button>

      {showQr ? (
        <Card className="mt-3 items-center text-center">
          <CardTitle>{t('share.qrHeading')}</CardTitle>
          <p className="mt-1 font-head text-section text-ink">
            {t('share.title', { train: trainNo })}
          </p>
          {online ? (
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}`}
              alt={t('share.qr')}
              className="mx-auto my-3 size-44 rounded-card bg-card"
              width={176}
              height={176}
            />
          ) : (
            <p className="break-all font-mono text-caption text-ink">{link}</p>
          )}
          <CardBody>
            {online
              ? dateLabel
                ? t('share.qrScan', { train: trainNo, date: dateLabel })
                : t('share.qrNote')
              : t('share.qrOffline')}
          </CardBody>
          {online ? <p className="break-all text-caption text-muted">{link}</p> : null}
        </Card>
      ) : null}
      {!online ? <p className="mt-2 text-caption text-muted">{t('offline.bar')}</p> : null}
    </div>
  )
}