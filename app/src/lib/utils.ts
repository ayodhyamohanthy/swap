import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** The `--text-*` scale in `styles.css`, as the utility names it generates.
 *
 * WHY THIS EXISTS. tailwind-merge decides whether `text-foo` is a font SIZE or a
 * text COLOUR from its built-in validators, which know `text-sm`/`text-base` and
 * the default palette and nothing else. Every name in this theme's type scale is
 * custom, so `text-section` landed in the colour group, and merging put
 * `text-primary-ink text-section` down to one class — the size. So every primary
 * Button shipped with no colour class at all and inherited `--color-ink`:
 * ink on `--color-primary` measures 2.3:1 against the 4.5:1 docs/16-BEST-PRACTICES §3 requires, and
 * `outline`/`ghost` lost their green. Nothing in the JSX looked wrong.
 *
 * A token added to `@theme` and not listed here silently re-opens the hole, which
 * is what `tests/ui-contrast.test.ts` reads the stylesheet for. */
export const TEXT_SIZE_TOKENS = ['title', 'section', 'body', 'note', 'caption'] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...TEXT_SIZE_TOKENS] }],
    },
  },
})

/** shadcn/ui class helper. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
