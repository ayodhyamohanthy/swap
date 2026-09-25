import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import appCss from '../styles.css?url'
import { AppShell } from '@/components/app-shell'
import { ServiceWorkerRegistrar } from '@/components/service-worker'
import { ToastProvider } from '@/components/ui/toast'
import { BOOT_SCRIPT, DEFAULT_LANG, I18nProvider, translate } from '@/lib/i18n'

/* Shell rules: manifest + theme colour (docs/08), one wordmark, and the tab
   bar that the setup screens hide. */
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { name: 'theme-color', content: '#1F6B45' },
      { name: 'description', content: translate(DEFAULT_LANG, 'meta.description') },
      { title: translate(DEFAULT_LANG, 'meta.title') },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: 'SeatSwap' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', type: 'image/png', href: '/icons/icon-192.png' },
      { rel: 'apple-touch-icon', href: '/icons/icon-192.png' },
    ],
    scripts: [{ children: BOOT_SCRIPT }],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nProvider>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </I18nProvider>
        <Scripts />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  )
}
