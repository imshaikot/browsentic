import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** A select inside the card drops its list into a portal at the end of the body, so presses and Escape there belong to the card. */
const OPEN_LAYER = '[data-radix-popper-content-wrapper]';

/** A card that drops from whatever it sits beside. Put both in a `relative` box: a press anywhere outside that box, or Escape, closes it. */
export function Popover({
  open,
  label,
  onClose,
  align = 'end',
  className,
  children,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  align?: 'start' | 'end';
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
        'enters absolute top-full z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-line-strong bg-ground-2/95 p-4 shadow-2xl shadow-black/40 backdrop-blur',
        align === 'end' ? 'right-0' : 'left-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
