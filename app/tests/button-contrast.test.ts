import { describe, expect, it } from 'vitest'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/* Regression: tailwind-merge treated the custom `text-section` size as a
   colour class and removed `text-primary-ink` from filled buttons. */
describe('button text colour survives class merging', () => {
  it('primary keeps text-primary-ink next to its text-section size', () => {
    const cls = cn(buttonVariants({ variant: 'primary' }))
    expect(cls).toContain('text-primary-ink')
    expect(cls).toContain('text-section')
  })
  it('danger keeps text-primary-ink', () => {
    expect(cn(buttonVariants({ variant: 'danger', size: 'sm' }))).toContain('text-primary-ink')
  })
  it('a caller colour class still overrides the variant colour', () => {
    const cls = cn(buttonVariants({ variant: 'primary' }), 'text-ink')
    expect(cls).toContain('text-ink')
    expect(cls).not.toContain('text-primary-ink')
  })
  it('size and colour classes coexist for every custom size', () => {
    for (const size of ['title', 'section', 'body', 'note', 'caption'])
      expect(cn('text-primary-ink', `text-${size}`)).toBe(`text-primary-ink text-${size}`)
  })
})
