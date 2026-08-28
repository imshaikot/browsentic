import * as React from 'react';

import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'field-sizing-content flex min-h-16 w-full rounded-lg border border-line-strong bg-ground/60 px-3 py-2 text-sm text-ink outline-none transition-colors',
        'placeholder:text-ink-faint selection:bg-brand/30 selection:text-ink',
        'focus-visible:border-brand/55',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
