import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

import { cn } from '@/lib/utils';

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'flex items-center justify-between gap-1.5 rounded-md border border-line bg-surface/60 px-2 py-1 text-xs text-ink-dim transition-colors',
        'enabled:hover:border-line-strong enabled:hover:text-ink',
        'focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        '[&>span]:min-w-0 [&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        sideOffset={4}
        className={cn(
          'relative z-50 min-w-[8rem] overflow-hidden rounded-lg border border-line-strong bg-surface text-xs text-ink-dim shadow-xl shadow-black/50',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
          position === 'popper' &&
            'max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)]',
          className,
        )}
        {...props}
      >
        <SelectScrollButton direction="up" />
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        <SelectScrollButton direction="down" />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex cursor-pointer items-center rounded-md py-1 pr-6 pl-2 outline-none select-none',
        'focus:bg-brand/15 focus:text-brand data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute right-1.5 flex size-3 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectScrollButton({ direction }: { direction: 'up' | 'down' }) {
  const Base = direction === 'up' ? SelectPrimitive.ScrollUpButton : SelectPrimitive.ScrollDownButton;
  const Chevron = direction === 'up' ? ChevronUp : ChevronDown;
  return (
    <Base
      data-slot={`select-scroll-${direction}`}
      className="flex cursor-default items-center justify-center py-1 text-ink-faint"
    >
      <Chevron className="size-3" />
    </Base>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
