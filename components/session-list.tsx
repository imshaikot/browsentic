import { Globe, Loader2, MessageSquare, X } from 'lucide-react';
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
      <p className="p-4 text-xs leading-relaxed text-muted-foreground">
        No saved conversations yet. Every conversation is kept here automatically — the button beside this one closes
        the current conversation out and starts a fresh one.
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5 p-3">
      {busy && (
        <p className="px-1 pb-1 text-[11px] text-muted-foreground">
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
        'flex items-start gap-2 rounded-md border bg-background/60 px-2.5 py-1.5 text-xs',
        current && 'border-primary/40 bg-primary/5',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(session.id)}
        disabled={busy}
        className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:opacity-50"
        title={session.url}
      >
        <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium">{label}</span>
            {current && (
              <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
                open
              </Badge>
            )}
          </span>
          {session.host && (
            <span className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              <Globe className="size-2.5 shrink-0" />
              <span className="truncate">{session.host}</span>
            </span>
          )}
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
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
        className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
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
