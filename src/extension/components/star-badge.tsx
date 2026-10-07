import { Star, X } from 'lucide-react';

import { STAR_ASK } from '@/lib/about';
import { cn } from '@/lib/utils';

const GITHUB_MARK =
  'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z';

const PART = 'flex h-full cursor-pointer items-center outline-none transition-colors hover:bg-brand/15 focus-visible:bg-brand/15';

export function StarBadge({ onStar, onClose }: { onStar: () => void; onClose: () => void }) {
  return (
    <div className="enters glow-brand absolute bottom-3 left-1/2 h-8 -translate-x-1/2 overflow-hidden rounded-full border border-brand/45 bg-ground/85 backdrop-blur">
      <div className="flex h-full items-center bg-brand/10">
        <button
          type="button"
          onClick={onStar}
          title={STAR_ASK}
          className={cn(PART, 'gap-2 pr-2.5 pl-3 text-xs font-medium whitespace-nowrap text-brand')}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0 fill-current">
            <path d={GITHUB_MARK} />
          </svg>
          <span className="neon-text">Star us on GitHub</span>
          <Star className="size-3.5 shrink-0 fill-amber text-amber" />
        </button>
        <span aria-hidden="true" className="h-4 w-px bg-brand/30" />
        <button
          type="button"
          onClick={onClose}
          title="Not now"
          aria-label="Not now — close the star request"
          className={cn(PART, 'pr-3 pl-2 text-ink-dim hover:text-ink focus-visible:text-ink')}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
