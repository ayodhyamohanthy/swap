import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/lib/i18n'
import { createGroup } from '@/lib/groups'
import { listTrips } from '@/lib/store'

/* "Make a family trip" entry (docs/04 C): links up to 3 local PNRs under one
   organiser. Empty state points at the Add-PNR flow instead of dead-ending. */
export function NewGroupCard() {
  const { t } = useI18n()
  const toast = useToast()
  const [name, setName] = useState('')
  const trips = listTrips()

  if (trips.length === 0) {
    return (
      <Card>
        <CardBody>{t('groups.addFirst')}</CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardTitle>{t('groups.create')}</CardTitle>
      <Field label={t('groups.title')} htmlFor="group-name">
        <Input
          id="group-name"
          value={name}
          placeholder={t('groups.title')}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Button
        className="mt-2"
        disabled={!name.trim()}
        onClick={() => {
          const group = createGroup(
            name,
            trips.slice(0, 3).map((trip) => trip.id),
          )
          setName('')
          toast.show(t('groups.created'))
          window.location.assign(`/groups/${group.id}`)
        }}
      >
        {t('groups.create')}
      </Button>
    </Card>
  )
}