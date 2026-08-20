import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap outline-none transition-all duration-200 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ground aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'glow-brand bg-brand text-ground hover:bg-brand/90',
        destructive: 'glow-destructive bg-destructive text-ink hover:bg-destructive/90',
        outline:
          'border border-line-strong bg-surface/40 text-ink hover:border-brand/45 hover:bg-surface/70',
        secondary: 'bg-surface text-ink hover:bg-surface-2',
        ghost: 'text-ink-dim hover:bg-surface/70 hover:text-ink',
        subtle: 'bg-brand/12 text-brand hover:bg-brand/20',
        link: 'text-brand underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 text-sm has-[>svg]:px-3.5',
        sm: 'h-7 gap-1.5 px-3 text-xs has-[>svg]:px-2.5',
        lg: 'h-10 px-6 text-sm has-[>svg]:px-5',
        icon: 'size-9',
        'icon-sm': 'size-7',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
