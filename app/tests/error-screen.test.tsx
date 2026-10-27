import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n'
import { ErrorScreen } from '@/components/error-screen'
import { Route } from '@/routes/__root'

afterEach(cleanup)

describe('ErrorScreen', () => {
  it('renders the calm, translated copy with a retry that resets', () => {
    const reset = vi.fn()
    render(
      <I18nProvider>
        <ErrorScreen error={new Error('boom')} reset={reset} />
      </I18nProvider>,
    )
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(screen.getByText('Nothing was changed. Try again to reload this screen.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('never prints the error details to the screen in prod builds', () => {
    vi.stubEnv('DEV', false)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        <I18nProvider>
          <ErrorScreen error={new Error('secret detail')} reset={() => {}} />
        </I18nProvider>,
      )
      expect(document.body.textContent).not.toContain('secret detail')
      expect(consoleSpy).not.toHaveBeenCalled()
    } finally {
      consoleSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })
})

describe('root route wiring', () => {
  it('wires the branded screens as the router error and not-found fallbacks', () => {
    expect(Route.options.errorComponent).toBeTruthy()
    expect(Route.options.notFoundComponent).toBeTruthy()
  })
})
