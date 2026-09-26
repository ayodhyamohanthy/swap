import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AppFooter, type RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/lib/i18n'
import { QUICK_REPLIES, guardMessage, isRateLimited } from '@/lib/chat-guard'
import { enqueue, flush, pending } from '@/lib/outbox'
import { useOnline } from '@/lib/use-online'
import { demoRequest } from '@/lib/demo-swap'

interface Msg { id: number; mine: boolean; text: string; hidden: boolean; queued?: boolean }
/* Locked-swap chat (docs/04 A12): bubbles + quick replies + guard + report. */
export const Route = createFileRoute('/chat/$id')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  component: ChatScreen,
})
const QUICK_FALLBACK: Record<string, string> = {
  'chat.quickAtBerth': "I'm at my berth now",
  'chat.quickDoor': 'Meet me near the coach door',
  'chat.quickMet': "I've met them",
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
    if (flush(id).length === 0) return
    setMsgs((m) => (m.some((msg) => msg.queued)
      ? m.map((msg) => (msg.queued ? { ...msg, queued: false } : msg))
      : m))
  }, [online, id])
  function send(text: string) {
    const clean = text.trim()
    if (!clean) return
    if (isRateLimited(sentAt)) { setWarn(t('chat.slowDown')); return }
    const g = guardMessage(clean)
    setSentAt((s) => [...s, Date.now()])
    if (!online) {
      enqueue(id, clean)
      setMsgs((m) => [...m, { id: m.length + 1, mine: true, text: clean, hidden: false, queued: true }])
      setWarn(t('chat.queued'))
      setDraft('')
      return
    }
    setMsgs((m) => [...m, { id: m.length + 1, mine: true, text: clean, hidden: g.flagged }])
    setWarn(g.flagged ? t('chat.cashWarning') : null)
    setDraft('')
  }
  return (
    <div>
      <h1 className="text-title text-ink">{t('chat.title', { name: req.acceptorName })}</h1>
      <div className="mt-3 flex flex-col gap-2" aria-live="polite">
        {msgs.map((m) => (
          <p key={m.id} className={m.mine
            ? 'max-w-[85%] self-end rounded-card rounded-br-sm bg-primary px-3 py-2 text-body text-primary-ink'
            : 'max-w-[85%] self-start rounded-card rounded-bl-sm border border-line bg-card px-3 py-2 text-body text-ink'}>
            {m.hidden ? t('chat.hidden') : m.text}
            {m.queued ? <span className="mt-1 block text-caption opacity-80">✓ {t('chat.queuedShort')}</span> : null}
          </p>
        ))}
      </div>
      {warn ? <Card className="mt-3 border-accent/50 bg-accent-soft"><CardBody>{warn}</CardBody></Card> : null}
      <div className="chip-row mt-3">
        {QUICK_REPLIES.map((k) => (
          <button key={k} type="button" onClick={() => send(t(k as never) || QUICK_FALLBACK[k])}
            className="min-h-12 shrink-0 rounded-full border border-primary px-3 font-semibold text-primary">{t(k as never) || QUICK_FALLBACK[k]}</button>
        ))}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(draft) }}>
        <Input value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={t('chat.placeholder')} aria-label={t('chat.placeholder')} />
        <Button type="submit" size="sm">{t('chat.send')}</Button>
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
      <Button variant="ghost" className="mt-2" type="button" onClick={() => setReported(true)}>
        {reported ? t('chat.reported') : t('chat.report')}
      </Button>
      <AppFooter />
    </div>
  )
}
