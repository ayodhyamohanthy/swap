import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

/* Used for easy mode and later for the acceptor's filters. */
export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-line bg-card transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-5 translate-x-1 rounded-full bg-primary transition-transform data-[state=checked]:translate-x-6 data-[state=checked]:bg-card" />
    </SwitchPrimitive.Root>
  )
}
