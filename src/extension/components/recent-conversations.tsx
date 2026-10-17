import { useState, type ReactNode } from 'react';
import { MessagesSquare } from 'lucide-react';

import type { StoredSessionMeta } from '@/lib/bridge/session-store';
import type { TabSession } from '@/lib/bridge/tab-sessions';
import { faviconOf } from '@/lib/bridge/top-sites';
import { formatWhen } from '@/lib/format-when';

export function RecentConversations({
  running,
  recent,
  onWatch,
  onOpen,
  onShowAll,
}: {
  /** Runs going on in other tabs right now. */
  running: TabSession[];
  recent: StoredSessionMeta[];
  onWatch: (sessionId: string) => void;
  onOpen: (sessionId: string) => void;
  /** Absent in a browser with no side panel to list them in. */
  onShowAll?: () => void;
}) {
  if (!running.length && !recent.length) return null;
  return (
    <section aria-labelledby="recent-conversations" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id="recent-conversations" className="text-sm font-medium text-ink-dim">
          Recent conversations
        </h2>
        {onShowAll && (
          <button type="button" onClick={onShowAll} className="text-xs text-ink-faint transition-colors hover:text-brand">
            All conversations
          </button>
        )}
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-ground/40">
        {running.map((session) => (
          <Row
            key={session.sessionId}
            onClick={() => onWatch(session.sessionId)}
            icon={<span className="glow-dot size-2 animate-pulse rounded-full bg-brand text-brand" />}
            title={session.title}
            detail={session.host ? `Running on ${session.host}` : 'Running'}
            action="Watch"
          />
        ))}
        {recent.map((session) => (
          <Row
            key={session.id}
            onClick={() => onOpen(session.id)}
            icon={<SiteIcon url={session.url} />}
            title={session.title ?? (session.host ? `Conversation on ${session.host}` : 'Untitled conversation')}
            detail={[session.host, formatWhen(session.updatedAt)].filter(Boolean).join(' · ')}
          />
        ))}
      </ul>
    </section>
  );
}

function Row({
  onClick,
  icon,
  title,
  detail,
  action,
}: {
  onClick: () => void;
  icon: ReactNode;
  title: string;
  detail: string;
  action?: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors outline-none hover:bg-surface/50 focus-visible:bg-surface/60"
      >
        <span className="grid size-6 shrink-0 place-items-center">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{title}</span>
        <span className="shrink-0 text-xs text-ink-faint">{detail}</span>
        {action && <span className="shrink-0 text-xs font-medium text-brand">{action}</span>}
      </button>
    </li>
  );
}

function SiteIcon({ url }: { url?: string }) {
  const [broken, setBroken] = useState(false);
  const icon = faviconOf(url);
  if (!icon || broken) return <MessagesSquare className="size-4 text-ink-faint" />;
  return <img src={icon} alt="" className="size-4 rounded-sm" onError={() => setBroken(true)} />;
}
