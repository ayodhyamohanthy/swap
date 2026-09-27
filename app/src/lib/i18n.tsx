/* SeatSwap i18n — Build Plan step 1 (Foundation).
   Every visible string lives in /locales/{lang}.json (AGENTS.md coding rules).
   English + Hindi ship at launch; the registry below already carries all 22
   scheduled languages so translators can drop in a file and flip `ready`.

   React part: <I18nProvider> + useI18n(). The chosen language and easy mode are
   kept in localStorage (instant, works offline) and mirrored into the store so
   step 3 can sync them with the account. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import en from '../../locales/en.json'
import hi from '../../locales/hi.json'
import type { BerthType, Quota, TicketStatus } from './pnr'
import { logActivity, settings as readSettings, updateSettings } from './store'

export const CATALOGS = { en, hi } as const
export type LangCode = keyof typeof CATALOGS
export const SHIPPED_LANGS: readonly LangCode[] = ['en', 'hi']
export const DEFAULT_LANG: LangCode = 'en'

type Catalog = typeof en

type Leaves<T> = T extends string
  ? ''
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`
    }[keyof T & string]

/** Every translatable key, checked by TypeScript. */
export type MessageKey = Leaves<Catalog>

export interface LanguageOption {
  code: string
  english: string
  native: string
  /** true = catalog ships today; false = translation opens later. */
  ready: boolean
}

/** English + the 22 scheduled languages (docs/01: "i18n ready for all 22"). */
export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'en', english: 'English', native: 'English', ready: true },
  { code: 'hi', english: 'Hindi', native: 'हिन्दी', ready: true },
  { code: 'as', english: 'Assamese', native: 'অসমীয়া', ready: false },
  { code: 'bn', english: 'Bengali', native: 'বাংলা', ready: false },
  { code: 'brx', english: 'Bodo', native: 'बड़ो', ready: false },
  { code: 'doi', english: 'Dogri', native: 'डोगरी', ready: false },
  { code: 'gu', english: 'Gujarati', native: 'ગુજરાતી', ready: false },
  { code: 'kn', english: 'Kannada', native: 'ಕನ್ನಡ', ready: false },
  { code: 'ks', english: 'Kashmiri', native: 'کٲشُر', ready: false },
  { code: 'kok', english: 'Konkani', native: 'कोंकणी', ready: false },
  { code: 'mai', english: 'Maithili', native: 'मैथिली', ready: false },
  { code: 'ml', english: 'Malayalam', native: 'മലയാളം', ready: false },
  { code: 'mni', english: 'Manipuri', native: 'মৈতৈলোন্', ready: false },
  { code: 'mr', english: 'Marathi', native: 'मराठी', ready: false },
  { code: 'ne', english: 'Nepali', native: 'नेपाली', ready: false },
  { code: 'or', english: 'Odia', native: 'ଓଡ଼ିଆ', ready: false },
  { code: 'pa', english: 'Punjabi', native: 'ਪੰਜਾਬੀ', ready: false },
  { code: 'sa', english: 'Sanskrit', native: 'संस्कृतम्', ready: false },
  { code: 'sat', english: 'Santali', native: 'ᱥᱟᱱᱛᱟᱲᱤ', ready: false },
  { code: 'sd', english: 'Sindhi', native: 'سنڌي', ready: false },
  { code: 'ta', english: 'Tamil', native: 'தமிழ்', ready: false },
  { code: 'te', english: 'Telugu', native: 'తెలుగు', ready: false },
  { code: 'ur', english: 'Urdu', native: 'اردو', ready: false },
]

export const LANG_KEY = 'seatswap.lang.v1'
export const EASY_KEY = 'seatswap.easy.v1'

export function isLangCode(value: unknown): value is LangCode {
  return typeof value === 'string' && (SHIPPED_LANGS as readonly string[]).includes(value)
}

function lookup(catalog: Catalog, key: string): string | undefined {
  let current: unknown = catalog
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : undefined
}

export function fill(template: string, vars?: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    vars && vars[name] != null ? String(vars[name]) : '',
  )
}

/** Non-React translate, for head tags and tests. */
export function translate(
  lang: LangCode,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const value = lookup(CATALOGS[lang], key) ?? lookup(CATALOGS[DEFAULT_LANG], key)
  return value ? fill(value, vars) : key
}

export function typeLabel(lang: LangCode, value: BerthType): string {
  return (CATALOGS[lang].trip.types as Record<string, string>)[value] ?? value
}

export function statusLabel(lang: LangCode, value: TicketStatus): string {
  return (CATALOGS[lang].trip.statuses as Record<string, string>)[value] ?? value
}

/** Swap-request status words — screens never render the raw enum (rule: all copy in i18n). */
export function requestStatusLabel(lang: LangCode, value: string): string {
  return (CATALOGS[lang].request.statuses as Record<string, string>)[value] ?? value
}

export function quotaLabel(lang: LangCode, value: Quota): string {
  return (CATALOGS[lang].trip.quotas as Record<string, string>)[value] ?? value
}

/** "Fri 12 Jun" — locale-aware, no extra copy to translate. */
export function formatTripDate(iso: string | null | undefined, lang: LangCode): string {
  if (!iso) return ''
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(date)
  } catch {
    return iso
  }
}

export function readStoredLang(): LangCode {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(LANG_KEY)
    return isLangCode(raw) ? raw : DEFAULT_LANG
  } catch {
    return DEFAULT_LANG
  }
}

export function readStoredEasy(): boolean {
  try {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(EASY_KEY) === '1'
  } catch {
    return false
  }
}

export interface I18nValue {
  lang: LangCode
  setLang: (next: LangCode) => void
  easy: boolean
  setEasy: (next: boolean) => void
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
  type: (value: BerthType) => string
  status: (value: TicketStatus) => string
  quota: (value: Quota) => string
  date: (iso: string | null | undefined) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(DEFAULT_LANG)
  const [easy, setEasyState] = useState(false)

  /* The prerendered shell cannot read localStorage, so the stored choice is
     applied right after hydration instead (no mismatch, no visible flash:
     route content renders after hydration in SPA mode). */
  useEffect(() => {
    const storedLang = readStoredLang()
    const storedEasy = readStoredEasy()
    if (storedLang !== DEFAULT_LANG) setLangState(storedLang)
    if (storedEasy) setEasyState(true)
    const mirrored = readSettings()
    if (mirrored.language !== storedLang || mirrored.easy_mode !== storedEasy) {
      updateSettings({ language: storedLang, easy_mode: storedEasy })
    }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.lang = lang
    document.documentElement.dataset.easy = easy ? 'true' : 'false'
    document.title = translate(lang, 'meta.title')
  }, [lang, easy])

  const setLang = useCallback((next: LangCode) => {
    setLangState(next)
    try {
      window.localStorage.setItem(LANG_KEY, next)
    } catch {
      /* private mode */
    }
    updateSettings({ language: next })
    logActivity('language_changed', { lang: next })
  }, [])

  const setEasy = useCallback((next: boolean) => {
    setEasyState(next)
    try {
      window.localStorage.setItem(EASY_KEY, next ? '1' : '0')
    } catch {
      /* private mode */
    }
    updateSettings({ easy_mode: next })
    logActivity('easy_mode_changed', { on: next })
  }, [])

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      easy,
      setEasy,
      t: (key, vars) => translate(lang, key, vars),
      type: (v) => typeLabel(lang, v),
      status: (v) => statusLabel(lang, v),
      quota: (v) => quotaLabel(lang, v),
      date: (iso) => formatTripDate(iso, lang),
    }),
    [lang, easy, setLang, setEasy],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>')
  return value
}

/** Inline boot script: applies easy mode + language before first paint. */
export const BOOT_SCRIPT = `(function(){try{var d=document.documentElement;if(localStorage.getItem('${EASY_KEY}')==='1'){d.dataset.easy='true'}var l=localStorage.getItem('${LANG_KEY}');if(l==='hi'){d.lang='hi'}}catch(e){}})();`
