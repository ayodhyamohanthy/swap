import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import appCss from '../styles.css?url'
import { AppShell } from '@/components/app-shell'
import { JobRunner } from '@/components/job-runner'
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
      // --color-primary (head meta cannot use var()); keep in step with styles.css
      { name: 'theme-color', content: '#1F6B45' },
      { name: 'description', content: translate(DEFAULT_LANG, 'meta.description') },
      { title: translate(DEFAULT_LANG, 'meta.title') },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: 'SeatSwap' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      { property: 'og:title', content: translate(DEFAULT_LANG, 'meta.title') },
      { property: 'og:description', content: translate(DEFAULT_LANG, 'meta.description') },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: 'https://seatswap.ayodhya-711.workers.dev/' },
      { property: 'og:image', content: 'https://seatswap.ayodhya-711.workers.dev/og-image.png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'SeatSwap — swap your berth with someone on your train.' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: translate(DEFAULT_LANG, 'meta.title') },
      { name: 'twitter:description', content: translate(DEFAULT_LANG, 'meta.description') },
      { name: 'twitter:image', content: 'https://seatswap.ayodhya-711.workers.dev/og-image.png' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', type: 'image/png', href: '/icons/icon-192.png' },
      { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
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
    /* `lang` is prerendered in the default language because the server cannot
       read the stored choice, and BOOT_SCRIPT corrects it before first paint so
       the document is marked Hindi from the very first frame. The two therefore
       legitimately disagree for a Hindi reader — which is what
       `suppressHydrationWarning` is for. Without it React logs a mismatch on
       every load for every Hindi user. Derived from DEFAULT_LANG for the same
       reason the meta tags above are: one source for "what the shell
       prerenders in". */
    <html lang={DEFAULT_LANG} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nProvider>
          <ToastProvider>
            <AppShell>{children}</AppShell>
            <JobRunner />
          </ToastProvider>
        </I18nProvider>
        <Scripts />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  )
}
