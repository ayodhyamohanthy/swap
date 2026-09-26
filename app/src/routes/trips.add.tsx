import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import type { RouteChrome } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Chip, ChipRow } from '@/components/ui/chip'
import { Field, Input, Label, Select, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import {
  CLASSES,
  QUOTAS,
  TICKET_STATUSES,
  berthTypesFor,
  isChairCar,
  isValidPnr,
  parseBookingSms,
  type BerthType,
  type Quota,
  type TicketStatus,
  type TravelClass,
} from '@/lib/pnr'
import { StoreError, addTrip, logActivity } from '@/lib/store'

/* Screen 5 "Add PNR" (design 1b) + chair car seat words (design 8b).
   Type 10 digits or paste the booking SMS — both are read on this device only.
   Several passengers per PNR are supported; a child without berth is counted in
   the group and never offered (docs/04 A4). */

export interface TripsAddSearch {
  pnr?: string
  paste?: 'sms'
}

export const Route = createFileRoute('/trips/add')({
  staticData: { chrome: 'plain' } satisfies RouteChrome,
  validateSearch: (search: Record<string, unknown>): TripsAddSearch => ({
    pnr: typeof search.pnr === 'string' ? search.pnr.replace(/\D/g, '').slice(0, 10) : undefined,
    paste: search.paste === 'sms' ? ('sms' as const) : undefined,
  }),
  component: AddTripScreen,
})

interface PassengerDraft {
  coach: string
  berthNo: string
  berthType: BerthType
  status: TicketStatus
  quota: Quota
  child: boolean
}

const SEAT_TYPES: readonly BerthType[] = ['WINDOW', 'AISLE', 'MIDDLE_SEAT']

function newPassenger(chair: boolean): PassengerDraft {
  return {
    coach: '',
    berthNo: '',
    berthType: chair ? 'WINDOW' : 'LB',
    status: 'CNF',
    quota: 'GN',
    child: false,
  }
}

function keepBerthType(row: BerthType, chair: boolean): BerthType {
  const isSeat = SEAT_TYPES.includes(row)
  if (chair) return isSeat ? row : 'WINDOW'
  return isSeat ? 'LB' : row
}

function AddTripScreen() {
  const { t, type, status, quota } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const search = Route.useSearch()

  const [sms, setSms] = useState('')
  const [pnr, setPnr] = useState(search.pnr ?? '')
  const [trainNo, setTrainNo] = useState('')
  const [travelDate, setTravelDate] = useState('')
  const [fromCode, setFromCode] = useState('')
  const [toCode, setToCode] = useState('')
  const [travelClass, setTravelClass] = useState<TravelClass>('SL')
  const [source, setSource] = useState<'typed' | 'sms_paste'>('typed')
  const [passengers, setPassengers] = useState<PassengerDraft[]>([newPassenger(false)])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [showPaste, setShowPaste] = useState(search.paste === 'sms')

  const chair = isChairCar(travelClass)
  const berthOptions = useMemo(() => berthTypesFor(travelClass), [travelClass])

  function changeClass(next: TravelClass) {
    const nextChair = isChairCar(next)
    setTravelClass(next)
    setPassengers((rows) =>
      rows.map((row) => ({ ...row, berthType: keepBerthType(row.berthType, nextChair) })),
    )
  }

  function patchPassenger(index: number, patch: Partial<PassengerDraft>) {
    setPassengers((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function readSms() {
    const parsed = parseBookingSms(sms)
    if (parsed.pnr) setPnr(parsed.pnr)
    if (parsed.train_no) setTrainNo(parsed.train_no)
    if (parsed.journey_date) setTravelDate(parsed.journey_date)
    if (parsed.from_code) setFromCode(parsed.from_code)
    if (parsed.to_code) setToCode(parsed.to_code)
    if (parsed.class) setTravelClass(parsed.class)
    setPassengers((rows) => {
      const base = rows.length ? rows : [newPassenger(parsed.class ? isChairCar(parsed.class) : false)]
      return base.map((row, index) =>
        index === 0
          ? {
              ...row,
              coach: parsed.coach ?? row.coach,
              berthNo: parsed.berth_no ?? row.berthNo,
              berthType: parsed.berth_type ?? row.berthType,
              status: parsed.status ?? row.status,
              quota: parsed.quota ?? row.quota,
            }
          : row,
      )
    })
    setSource('sms_paste')
    logActivity('sms_paste_parsed', { filled: parsed.filled, class: parsed.class ?? null })
    toast.show(parsed.filled >= 5 ? t('add.readOk') : t('add.readPartial'))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const digits = pnr.replace(/\D/g, '')
    const nextErrors: Record<string, string> = {}
    if (!isValidPnr(digits)) nextErrors.pnr = t('add.errPnr')
    if (!trainNo.trim()) nextErrors.train = t('add.errTrain')
    if (!travelDate) nextErrors.date = t('add.errDate')
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSaving(true)
    try {
      const trip = await addTrip({
        pnr: digits,
        train_no: trainNo,
        journey_date: travelDate,
        from_code: fromCode,
        to_code: toCode,
        class: travelClass,
        source,
        passengers: passengers.map((row) => ({
          coach: row.coach,
          berth_no: row.berthNo,
          berth_type: row.berthType,
          status: row.status,
          quota: row.quota,
          is_child_no_berth: row.child,
        })),
      })
      toast.show(t('add.saved'))
      navigate({ to: '/trips/$tripId', params: { tripId: trip.id } })
    } catch (error) {
      if (error instanceof StoreError && error.code === 'pnr_duplicate') {
        setErrors({ pnr: t('add.errPnrDupe') })
      } else {
        setErrors({ pnr: t('add.errPnr') })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="text-title text-ink">{t('add.title')}</h1>
      <p className="mt-1 text-body text-muted">{t('add.sub')}</p>

      <Card className="mt-4">
        <button
          type="button"
          onClick={() => setShowPaste((open) => !open)}
          aria-expanded={showPaste}
          className="flex min-h-12 w-full items-center justify-between gap-2 text-left"
        >
          <CardTitle>{t('add.pasteTitle')}</CardTitle>
          <span aria-hidden className="text-title text-muted">
            {showPaste ? '−' : '+'}
          </span>
        </button>
        {showPaste ? (
          <div className="mt-1">
            <CardBody>{t('add.pasteBody')}</CardBody>
            <Textarea
              aria-label={t('add.pasteTitle')}
              className="mt-2"
              rows={3}
              value={sms}
              placeholder={t('add.smsPlaceholder')}
              onChange={(event) => setSms(event.target.value)}
            />
            <Button type="button" variant="outline" className="mt-2" onClick={readSms}>
              {t('add.usePasted')}
            </Button>
          </div>
        ) : null}
      </Card>

      <div className="mt-4">
        <Field label={t('add.pnrLabel')} htmlFor="pnr" hint={t('add.pnrHint')} error={errors.pnr}>
          <Input
            id="pnr"
            inputMode="numeric"
            autoComplete="off"
            maxLength={10}
            value={pnr}
            onChange={(event) => {
              setPnr(event.target.value.replace(/\D/g, '').slice(0, 10))
              setErrors((prev) => ({ ...prev, pnr: '' }))
            }}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('add.trainNo')} htmlFor="train" error={errors.train}>
            <Input
              id="train"
              inputMode="numeric"
              maxLength={5}
              value={trainNo}
              onChange={(event) => setTrainNo(event.target.value.replace(/\D/g, '').slice(0, 5))}
            />
          </Field>
          <Field label={t('add.date')} htmlFor="date" error={errors.date}>
            <Input
              id="date"
              type="date"
              value={travelDate}
              onChange={(event) => setTravelDate(event.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('add.from')} htmlFor="from">
            <Input
              id="from"
              maxLength={4}
              value={fromCode}
              onChange={(event) => setFromCode(event.target.value.toUpperCase().slice(0, 4))}
            />
          </Field>
          <Field label={t('add.to')} htmlFor="to">
            <Input
              id="to"
              maxLength={4}
              value={toCode}
              onChange={(event) => setToCode(event.target.value.toUpperCase().slice(0, 4))}
            />
          </Field>
        </div>

        <div className="mb-3">
          <Label>{t('add.class')}</Label>
          <ChipRow>
            {CLASSES.map((option) => (
              <Chip key={option} selected={travelClass === option} onClick={() => changeClass(option)}>
                {option}
              </Chip>
            ))}
          </ChipRow>
          {chair ? <p className="mt-2 text-caption text-muted">{t('add.chairCarNote')}</p> : null}
        </div>
      </div>

      <h2 className="mt-5 text-section text-ink">{t('add.passengers')}</h2>
      {passengers.map((row, index) => (
        <Card key={index} className="mt-2">
          <div className="flex items-center justify-between">
            <CardTitle>{t('add.passenger', { n: index + 1 })}</CardTitle>
            {passengers.length > 1 ? (
              <button
                type="button"
                aria-label={t('add.removePassenger')}
                className="tap flex items-center justify-center text-danger"
                onClick={() => setPassengers((rows) => rows.filter((_, i) => i !== index))}
              >
                <Trash2 aria-hidden className="size-5" />
              </button>
            ) : null}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label={t('add.coach')} htmlFor={`coach-${index}`}>
              <Input
                id={`coach-${index}`}
                maxLength={4}
                value={row.coach}
                onChange={(event) =>
                  patchPassenger(index, { coach: event.target.value.toUpperCase().slice(0, 4) })
                }
              />
            </Field>
            <Field label={chair ? t('add.seatNo') : t('add.berthNo')} htmlFor={`berth-${index}`}>
              <Input
                id={`berth-${index}`}
                inputMode="numeric"
                maxLength={3}
                value={row.berthNo}
                onChange={(event) =>
                  patchPassenger(index, {
                    berthNo: event.target.value.replace(/\D/g, '').slice(0, 3),
                  })
                }
              />
            </Field>
          </div>

          <div className="mb-3">
            <Label>{chair ? t('add.seatType') : t('add.berthType')}</Label>
            <ChipRow>
              {berthOptions.map((option) => (
                <Chip
                  key={option}
                  selected={row.berthType === option}
                  onClick={() => patchPassenger(index, { berthType: option })}
                >
                  {type(option)}
                </Chip>
              ))}
            </ChipRow>
          </div>

          <div className="mb-3">
            <Label>{t('add.status')}</Label>
            <ChipRow>
              {TICKET_STATUSES.map((option) => (
                <Chip
                  key={option}
                  selected={row.status === option}
                  onClick={() => patchPassenger(index, { status: option })}
                >
                  {status(option)}
                </Chip>
              ))}
            </ChipRow>
          </div>

          <Field label={t('add.quota')} htmlFor={`quota-${index}`}>
            <Select
              id={`quota-${index}`}
              value={row.quota}
              onChange={(event) => patchPassenger(index, { quota: event.target.value as Quota })}
            >
              {QUOTAS.map((option) => (
                <option key={option} value={option}>
                  {quota(option)}
                </option>
              ))}
            </Select>
          </Field>

          <label className="flex min-h-12 items-center gap-3">
            <input
              type="checkbox"
              className="size-6 accent-[var(--color-primary)]"
              checked={row.child}
              onChange={(event) => patchPassenger(index, { child: event.target.checked })}
            />
            <span>
              <b className="block font-head text-body text-ink">{t('add.childNoBerth')}</b>
              <span className="block text-caption text-muted">{t('add.childNote')}</span>
            </span>
          </label>
        </Card>
      ))}

      <Button
        type="button"
        variant="ghost"
        className="mt-2 justify-start"
        onClick={() => setPassengers((rows) => [...rows, newPassenger(chair)])}
      >
        <Plus aria-hidden className="size-5" />
        {t('add.addPassenger')}
      </Button>

      <Button type="submit" className="mt-5" disabled={saving}>
        {t('add.submit')}
      </Button>
      <p className="mt-2 flex items-center justify-center gap-1.5 text-caption text-muted">
        <Lock aria-hidden className="size-4" />
        {t('add.noSignin')}
      </p>
    </form>
  )
}
