import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-lg border border-line-strong bg-ground/60 px-3 py-1 text-sm text-ink outline-none transition-colors',
        'placeholder:text-ink-faint selection:bg-brand/30 selection:text-ink',
        'focus-visible:border-brand/55 focus-visible:bg-ground/80',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
        'aria-invalid:border-destructive/60',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
