import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ElementType } from 'react'
import { cn } from '@/lib/utils'

/* One clear primary button per screen; every target is at least 48px. */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-btn border font-head font-bold transition-colors disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
  {
    variants: {
      variant: {
        primary: 'border-primary bg-primary text-primary-ink',
        outline: 'border-primary bg-card text-primary',
        neutral: 'border-line bg-card text-ink',
        danger: 'border-danger bg-danger text-primary-ink',
        ghost: 'border-transparent bg-transparent text-primary',
      },
      size: {
        default: 'w-full min-h-12 px-4 text-section',
        sm: 'w-auto min-h-12 px-3 text-body',
        icon: 'min-h-12 w-12 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = (asChild ? Slot : 'button') as ElementType
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
