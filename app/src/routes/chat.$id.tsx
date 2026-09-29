import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { CheckCheck, ChevronLeft, Send, ShieldCheck } from 'lucide-react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/lib/i18n'
import { QUICK_REPLIES, guardMessage, isRateLimited } from '@/lib/chat-guard'
import { enqueue, flush, pending } from '@/lib/outbox'
import { trackEvent } from '@/lib/analytics'
import { useOnline } from '@/lib/use-online'
import { demoRequest } from '@/lib/demo-swap'
import { acceptedOffer, getRequest, offersFor, revealedBerths } from '@/lib/requests'
import { getSupabase } from '@/lib/supabase'
import { fileReport, blockUser, tripHandle } from '@/lib/safety'
import { getOrCreateChat, fetchMessages, sendMessage, isValidUuid } from '@/lib/chat-sync'

interface Msg {
  id: number | string
  mine: boolean
  text: string
  hidden: boolean
  queued?: boolean
  /** Send time (epoch ms) — design 4b stamps every bubble. */
  at?: number
}
/* Locked-swap chat (docs/04 A12): bubbles + quick replies + guard + report. */
export const Route = createFileRoute('/chat/$id')({
  staticData: { chrome: 'tabs', tab: 'swaps', header: ChatHeader } satisfies RouteChrome,
  component: ChatScreen,
})
const QUICK_FALLBACK: Record<string, string> = {
  'chat.quickAtBerth': "I'm at my berth now",
  'chat.quickDoor': 'Meet me near the coach door',
  'chat.quickMet': "I've met them",
}
/** Design 4b stamps every bubble: "9:40 AM" style, viewer's locale. */
function stamp(at?: number): string {
  if (!at) return ''
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
/* Design 4b draws the chat's chrome *in* the green bar — back chevron, the
   person, and where to find them — above the tab bar docs/05 pins for /chat.
   AppShell renders this through RouteChrome.header in place of the wordmark
   bar. The coach · berth line keeps rule 13's gate: revealedBerths is null
   until payment, so nothing shows before then. */
function ChatHeader() {
  /* Route-bound hook, not generic useParams — it reads router state, so it
     works up here in AppShell's tree too (the /chat/$id match is in state by
     the time the shell renders its chrome). */
  const { id } = Route.useParams()
  const { t } = useI18n()
  const req = demoRequest(id)
  const berths = revealedBerths(id)
  return (
    <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 bg-primary px-2 text-white">
      <Link
        to="/"
        aria-label={t('common.back')}
        className="tap flex items-center justify-center rounded-full text-white"
        onClick={(event) => {
          /* Prefer real history so "back" lands where the user came from. */
          if (window.history.length > 1) {
            event.preventDefault()
            window.history.back()
          }
        }}
      >
        <ChevronLeft aria-hidden className="size-6" />
      </Link>
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/20 font-head text-body font-bold"
      >
        {req.acceptorName.charAt(0)}
      </span>
      <span className="flex min-w-0 flex-col px-1">
        <span className="truncate font-head text-body font-bold">{req.acceptorName}</span>
        {berths?.coach && berths.theirsNo ? (
          <span className="truncate text-caption text-white/85">
            {t('trip.coach', { coach: berths.coach })} · {t('trip.berth', { no: berths.theirsNo })}
          </span>
        ) : null}
      </span>
    </header>
  )
}
function ChatScreen() {
  const { id } = Route.useParams()
  const { t } = useI18n()
  const req = demoRequest(id)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [warn, setWarn] = useState<string | null>(null)
  const [reported, setReported] = useState(false)
  const [sentAt, setSentAt] = useState<number[]>([])
  const online = useOnline()

  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function initChat() {
      const client = await getSupabase()
      if (!client || !active) return
      try {
        const { data } = await client.auth.getUser()
        if (!active) return
        const uid = data?.user?.id ?? null
        setCurrentUserId(uid)

        if (isValidUuid(id) && uid) {
          const { chatId } = await getOrCreateChat(id, client)
          if (!active) return
          if (chatId) {
            setActiveChatId(chatId)
            const { messages } = await fetchMessages(chatId, uid, client)
            if (!active) return
            if (messages.length > 0) {
              setMsgs(
                messages.map((m) => ({
                  id: m.id,
                  mine: m.mine,
                  text: m.text,
                  hidden: m.hidden,
                  queued: false,
                  at: m.createdAt ? (Date.parse(m.createdAt) || undefined) : undefined,
                })),
              )
            }
          }
        }
      } catch {
        /* Fallback to local-first */
      }
    }
    void initChat()
    return () => {
      active = false
    }
  }, [id])

  /* A reload while offline must not lose queued text: show it as queued. */
  useEffect(() => {
    const texts = pending(id)
    if (texts.length === 0) return
    setMsgs((m) => (m.length === 0
      ? texts.map((text, i) => ({ id: i + 1, mine: true, text, hidden: false, queued: true }))
      : m))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  /* Docs/08: queued messages send themselves when the connection returns. */
  useEffect(() => {
    if (!online) return
    const flushedTexts = flush(id)
    if (flushedTexts.length === 0) return
    setMsgs((m) => (m.some((msg) => msg.queued)
      ? m.map((msg) => (msg.queued ? { ...msg, queued: false } : msg))
      : m))
    if (activeChatId && currentUserId) {
      for (const text of flushedTexts) {
        void sendMessage(activeChatId, currentUserId, text).catch(() => {})
      }
    }
  }, [online, id, activeChatId, currentUserId])
  function send(text: string) {
    const clean = text.trim()
    if (!clean) return
    if (isRateLimited(sentAt)) { setWarn(t('chat.slowDown')); return }
    const g = guardMessage(clean)
    setSentAt((s) => [...s, Date.now()])
    if (!online) {
      enqueue(id, clean)
      setMsgs((m) => [
        ...m,
        { id: m.length + 1, mine: true, text: clean, hidden: false, queued: true, at: Date.now() },
      ])
      setWarn(t('chat.queued'))
      setDraft('')
      return
    }
    const localId = Date.now()
    setMsgs((m) => [...m, { id: localId, mine: true, text: clean, hidden: g.flagged, at: localId }])
    setWarn(g.flagged ? t('chat.cashWarning') : null)
    if (g.flagged) trackEvent('message_flagged', { reasons: g.reasons.join(',') })
    setDraft('')
    if (activeChatId && currentUserId) {
      sendMessage(activeChatId, currentUserId, clean).catch(() => {})
    }
  }
  return (
    <div>
      {/* The name and coach line live in ChatHeader now — design 4b draws them
          in the green bar, not as a title under it. The messages start at the
          top of the body, exactly as the design does. */}
      <div className="flex flex-col gap-2" aria-live="polite">
        {msgs.map((m) => (
          <p key={m.id} className={m.mine
            /* Design 4b: the sent bubble is the soft green (bg-wash) with ink
               text and green ticks — the app's dark green is for solid CTAs. */
            ? 'max-w-[85%] self-end rounded-card rounded-br-sm bg-wash px-3 py-2 text-body text-ink'
            : 'max-w-[85%] self-start rounded-card rounded-bl-sm border border-line bg-card px-3 py-2 text-body text-ink'}>
            <span className="block">{m.hidden ? t('chat.hidden') : m.text}</span>
            {m.queued || m.at ? (
              /* Design 4b stamps each bubble and ticks the ones that went out. */
              <span className={`mt-1 flex items-center gap-1 text-caption ${m.mine ? 'justify-end text-muted' : 'text-muted'}`}>
                {m.queued ? (
                  t('chat.queuedShort')
                ) : (
                  <>
                    {m.mine ? <CheckCheck aria-hidden className="size-3.5 text-primary" /> : null}
                    {stamp(m.at)}
                  </>
                )}
              </span>
            ) : null}
          </p>
        ))}
      </div>
      {warn ? <Card className="mt-3 border-accent/50 bg-accent-soft"><CardBody>{warn}</CardBody></Card> : null}
      {/* Design 4b draws the quick replies as two white pills above the field;
          the row wraps to a second line when all three do not fit a 360px
          phone (12a: no clipped text; off-edge scroll is not a substitute).
          Route-local flex-wrap keeps this inside L5 — no styles.css change. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK_REPLIES.map((k) => (
          <button key={k} type="button" onClick={() => send(t(k as never) || QUICK_FALLBACK[k])}
            /* Design 4b draws the quick replies as white pills, not green. */
            className="min-h-12 shrink-0 rounded-full border border-line bg-card px-3 text-ink">{t(k as never) || QUICK_FALLBACK[k]}</button>
        ))}
      </div>
      <form className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(draft) }}>
        <Input value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={t('chat.placeholder')} aria-label={t('chat.placeholder')} />
        {/* Design 4b's round send control at the right of the field. */}
        <Button type="submit" size="icon" className="shrink-0 rounded-full" aria-label={t('chat.send')}>
          <Send aria-hidden className="size-5" />
        </Button>
      </form>
      <Card className="mt-4">
        <p className="font-head font-bold text-ink">{t('chat.found')}</p>
        <div className="mt-2 flex gap-2">
          <Button variant="outline" size="sm" type="button" asChild>
            <Link to="/swaps/$id/meet" params={{ id }}>
              {t('chat.foundYes', { name: req.acceptorName })}
            </Link>
          </Button>
          <Button variant="outline" size="sm" type="button" asChild>
            <Link to="/swaps/$id/summary" params={{ id }}>{t('chat.foundNo')}</Link>
          </Button>
        </div>
      </Card>
      <Button
        variant="outline"
        className="mt-2"
        type="button"
        onClick={() => {
          setReported(true)
          trackEvent('report_created', {})
          /* Real parties where known: the signed-in user (or the request's
             requester as fallback) reports the locked/accepted offer's
             acceptor trip. A bare 'counterparty' can never join to a user
             row, so the trip reference keeps the report actionable without
             masquerading as one. Server user ids on offers are a step-3
             L3 item (see lanes board request). */
          const req = getRequest(id)
          const offer = req
            ? (offersFor(req.id).find((o) => o.id === req.locked_offer_id) ?? acceptedOffer(req.id))
            : undefined
          const reporterId = currentUserId ?? req?.requester_id ?? 'local_user'
          const reportedId = offer?.acceptor_trip_id
            ? tripHandle(offer.acceptor_trip_id)
            : 'counterparty'
          void fileReport({
            reporterId,
            reportedId: reportedId !== reporterId ? reportedId : `${reportedId}_other`,
            requestId: isValidUuid(id) ? id : null,
            reason: 'User reported from chat',
          })
          void blockUser({
            blockerId: reporterId,
            blockedId: reportedId !== reporterId ? reportedId : `${reportedId}_other`,
          })
        }}
      >
        <ShieldCheck aria-hidden className="size-4" />
        {reported ? t('chat.reported') : t('chat.report')}
      </Button>
      <AppFooter />
    </div>
  )
}
