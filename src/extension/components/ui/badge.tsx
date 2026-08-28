import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.08em] whitespace-nowrap uppercase [&>svg]:pointer-events-none [&>svg]:size-2.5',
  {
    variants: {
      variant: {
        default: 'border-brand/35 bg-brand/12 text-brand',
        secondary: 'border-line-strong bg-surface/70 text-ink-dim',
        destructive: 'border-destructive/40 bg-destructive/12 text-destructive',
        warning: 'border-amber/40 bg-amber/12 text-amber',
        outline: 'border-line text-ink-faint',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span';

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
