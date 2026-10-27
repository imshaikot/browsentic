import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** A select inside the card drops its list into a portal at the end of the body, so presses and Escape there belong to the card. */
const OPEN_LAYER = '[data-radix-popper-content-wrapper]';

/**
 * A card that drops from whatever it sits beside, or rises above it with `side="top"`. Put both in one
 * box, positioned to anchor the card: a press anywhere outside that box, or Escape, closes it.
 */
export function Popover({
  open,
  label,
  onClose,
  align = 'end',
  side = 'bottom',
  className,
  children,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
  className?: string;
  children: ReactNode;
}) {
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const anchor = card.current?.parentElement;
    const pressed = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!anchor?.contains(target) && !target.closest(OPEN_LAYER)) onClose();
    };
    const keyed = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector(OPEN_LAYER)) onClose();
    };
    document.addEventListener('pointerdown', pressed);
    document.addEventListener('keydown', keyed);
    return () => {
      document.removeEventListener('pointerdown', pressed);
      document.removeEventListener('keydown', keyed);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={card}
      role="dialog"
      aria-label={label}
      className={cn(
        'enters absolute z-40 w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-line-strong bg-ground-2/95 p-4 shadow-2xl shadow-black/40 backdrop-blur',
        side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        align === 'end' ? 'right-0' : 'left-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
