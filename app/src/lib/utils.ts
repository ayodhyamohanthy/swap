import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** shadcn/ui class helper. */
/* The theme's custom font sizes (--text-title, --text-section, ...) must be
   registered as font-size classes. Without that, tailwind-merge reads
   `text-section` as a text COLOUR and silently drops the button's
   `text-primary-ink`, leaving dark ink on the dark-green fill (~2.3:1). */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['title', 'section', 'body', 'note', 'caption'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
