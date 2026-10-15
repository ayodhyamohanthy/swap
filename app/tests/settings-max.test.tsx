/* Settings' daily-cap row is a number (docs/04 B2; docs/03 sets the default
   at 3), and it shipped as an on/off switch: the copy asked "How many new
   requests you can get each day", and the control answered with a hidden
   3-or-10 the traveller never saw. A toggle cannot render a quantity, so the
   row is now a stepper — and this renders the real screen to guard the
   contract: the value is visible, minus/plus move it by one and save each
   step, and both ends disable at the documented bounds instead of stepping
   past them. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/lib/i18n'
import {
  clampMaxRequestsPerDay,
  MAX_REQUESTS_PER_DAY_MAX,
  MAX_REQUESTS_PER_DAY_MIN,
  resetStore,
  settings as readSettings,
  updateSettings,
} from '@/lib/store'
import { Route as SettingsRoute } from '@/routes/profile.settings'

/* The suite runs without the TanStack Start plugin (vitest.config), so the
   route object still carries the raw screen component. */
const SettingsScreen = SettingsRoute.options.component!

function renderSettings() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <SettingsScreen />
      </ToastProvider>
    </I18nProvider>,
  )
}

beforeEach(() => resetStore())
afterEach(() => cleanup())

describe('settings daily-cap stepper', () => {
  it('shows the cap as a number with fewer/more controls, not a switch', () => {
    renderSettings()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByLabelText('Fewer requests a day')).toBeTruthy()
    expect(screen.getByLabelText('More requests a day')).toBeTruthy()
    /* Only the six genuinely boolean rows (women, families, coach, pause,
       alerts, analytics) may carry a switch; the cap row adds none. */
    expect(screen.getAllByRole('switch')).toHaveLength(6)
  })

  it('steps by one and saves each step', () => {
    renderSettings()
    fireEvent.click(screen.getByLabelText('More requests a day'))
    expect(readSettings().max_requests_per_day).toBe(4)
    fireEvent.click(screen.getByLabelText('Fewer requests a day'))
    fireEvent.click(screen.getByLabelText('Fewer requests a day'))
    expect(readSettings().max_requests_per_day).toBe(2)
  })

  it('disables more at the top end instead of stepping past it', () => {
    updateSettings({ max_requests_per_day: MAX_REQUESTS_PER_DAY_MAX })
    renderSettings()
    const more = screen.getByLabelText('More requests a day') as HTMLButtonElement
    expect(more.disabled).toBe(true)
    expect(screen.getByText(String(MAX_REQUESTS_PER_DAY_MAX))).toBeTruthy()
  })

  it('disables fewer at the bottom end instead of stepping past it', () => {
    updateSettings({ max_requests_per_day: MAX_REQUESTS_PER_DAY_MIN })
    renderSettings()
    const fewer = screen.getByLabelText('Fewer requests a day') as HTMLButtonElement
    expect(fewer.disabled).toBe(true)
    expect(screen.getByText(String(MAX_REQUESTS_PER_DAY_MIN))).toBeTruthy()
  })
})

describe('clampMaxRequestsPerDay', () => {
  it('holds every writer inside the bounds', () => {
    expect(clampMaxRequestsPerDay(0)).toBe(MAX_REQUESTS_PER_DAY_MIN)
    expect(clampMaxRequestsPerDay(MAX_REQUESTS_PER_DAY_MAX + 1)).toBe(MAX_REQUESTS_PER_DAY_MAX)
    expect(clampMaxRequestsPerDay(2.6)).toBe(3)
    expect(clampMaxRequestsPerDay(Number.NaN)).toBe(3)
  })
})
