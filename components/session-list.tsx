import { Globe, Loader2, MessagesSquare, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { isNaming, type StoredSessionMeta } from '@/lib/bridge/session-store';
import { cn } from '@/lib/utils';

export function SessionList({
  sessions,
  currentId,
  busy,
  onOpen,
  onRemove,
}: {
  sessions: StoredSessionMeta[];
  currentId?: string;
  busy?: boolean;
  onOpen: (sessionId: string) => void;
  onRemove: (sessionId: string) => void;
}) {
  if (sessions.length === 0) {
    return (
      <div className="p-3">
        <div className="dot-grid fade-bottom rounded-xl border border-line px-3 py-6 text-center">
          <MessagesSquare className="mx-auto size-5 text-ink-faint" />
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            Every conversation lands here on its own. Start one in Chat, and “New chat” in the header closes it out.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5 p-3">
      {busy && (
        <p className="px-1 pb-1 text-[11px] text-ink-faint">
          Waiting on the current run — stop it to reopen another conversation.
        </p>
      )}
      {sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          current={session.id === currentId}
          busy={busy === true}
          onOpen={onOpen}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function SessionRow({
  session,
  current,
  busy,
  onOpen,
  onRemove,
}: {
  session: StoredSessionMeta;
  current: boolean;
  busy: boolean;
  onOpen: (sessionId: string) => void;
  onRemove: (sessionId: string) => void;
}) {
  const label = session.title ?? (session.host ? `Conversation on ${session.host}` : 'Untitled conversation');
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl border px-2.5 py-2 text-xs transition-colors',
        current ? 'border-brand/35 bg-brand/8' : 'border-line bg-ground/40 hover:border-line-strong',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(session.id)}
        disabled={busy}
        className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:opacity-50"
        title={session.url}
      >
        <MessagesSquare className={cn('mt-0.5 size-3.5 shrink-0', current ? 'text-brand' : 'text-ink-faint')} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium text-ink">{label}</span>
            {current && <Badge>open</Badge>}
          </span>
          {session.host && (
            <span className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-ink-faint">
              <Globe className="size-2.5 shrink-0" />
              <span className="truncate">{session.host}</span>
            </span>
          )}
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-faint">
            {isNaming(session) && !session.title ? (
              <>
                <Loader2 className="size-3 animate-spin" /> Naming…
              </>
            ) : (
              <>
                {session.turns} {session.turns === 1 ? 'message' : 'messages'} · {formatWhen(session.updatedAt)}
              </>
            )}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onRemove(session.id)}
        aria-label={`Delete ${label}`}
        className="mt-0.5 shrink-0 rounded-full p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatWhen(at: number): string {
  const ago = Date.now() - at;
  if (ago < MINUTE) return 'just now';
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h ago`;
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
