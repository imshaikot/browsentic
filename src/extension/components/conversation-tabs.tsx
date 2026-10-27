import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { browser, type Browser } from 'wxt/browser';
import { Check, ChevronLeft, Globe, PanelsTopLeft, Plus, X } from 'lucide-react';

import { Popover } from '@/extension/components/popover';
import { Button } from '@/extension/components/ui/button';
import { Input } from '@/extension/components/ui/input';
import { hostOf, type TabSession } from '@/lib/bridge/tab-sessions';
import { faviconOf } from '@/lib/bridge/top-sites';
import { useBlockedCheck } from '@/lib/bridge/use-extension-settings';
import { useWindowTabs } from '@/lib/bridge/use-window-tabs';
import { cn } from '@/lib/utils';

type Tab = Browser.tabs.Tab & { id: number };

const MAX_FACES = 3;

/**
 * The conversation's tabs, behind one composer button: an icon while it has one tab, its tabs'
 * faces once it has more. The card lists them and adds more, with the tabs selected in the tab
 * strip already ticked.
 */
export function ConversationTabs({
  session,
  sessions,
  open,
  onOpenChange,
  onAdd,
  onRemove,
}: {
  session: TabSession | null;
  sessions: TabSession[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (tabIds: number[]) => void;
  onRemove: (tabId: number) => void;
}) {
  const windowTabs = useWindowTabs().filter((tab): tab is Tab => tab.id != null);
  const frontTabId = windowTabs.find((tab) => tab.active)?.id;
  const members = windowTabs.filter((tab) => session?.tabIds.includes(tab.id));
  const elsewhere = (session?.tabIds.length ?? 0) - members.length;
  const spread = members.length > 1;
  const [picking, setPicking] = useState(false);
  const showPicker = picking || !spread;

  const close = () => {
    setPicking(false);
    onOpenChange(false);
  };

  const names = members.map((tab) => tab.title || hostOf(tab.url) || 'Untitled').join(', ');

  return (
    <span>
      <Button
        variant={open ? 'subtle' : 'ghost'}
        size={spread ? 'sm' : 'icon-sm'}
        aria-expanded={open}
        aria-label={spread ? `This conversation’s ${members.length} tabs` : 'Add other open tabs to this conversation'}
        title={spread ? `Tabs in this conversation: ${names}` : 'Tabs: add other open tabs to this conversation'}
        onClick={() => (open ? close() : onOpenChange(true))}
        className={cn(spread && 'h-7 gap-1 px-1.5 has-[>svg]:px-1.5')}
      >
        {spread ? (
          <>
            <span className="flex -space-x-1.5">
              {members.slice(0, MAX_FACES).map((tab) => (
                <TabFace key={tab.id} tab={tab} className="rounded-full ring-2 ring-ground-2" />
              ))}
            </span>
            <span className="font-mono text-[10px] tabular-nums">{session!.tabIds.length}</span>
          </>
        ) : (
          <PanelsTopLeft className="size-3.5" />
        )}
      </Button>

      <Popover
        open={open}
        label="Tabs in this conversation"
        onClose={close}
        side="top"
        align="start"
        className="inset-x-0 w-auto max-w-none p-0"
      >
        {showPicker ? (
          <TabPicker
            candidates={windowTabs.filter((tab) => tab.id !== frontTabId && !session?.tabIds.includes(tab.id) && hostOf(tab.url))}
            sessions={sessions}
            onBack={spread ? () => setPicking(false) : undefined}
            onAdd={(tabIds) => {
              onAdd(tabIds);
              if (spread) setPicking(false);
              else close();
            }}
          />
        ) : (
          <TabList
            session={session!}
            members={members}
            elsewhere={elsewhere}
            frontTabId={frontTabId}
            onRemove={onRemove}
            onPick={() => setPicking(true)}
          />
        )}
      </Popover>
    </span>
  );
}

function TabList({
  session,
  members,
  elsewhere,
  frontTabId,
  onRemove,
  onPick,
}: {
  session: TabSession;
  members: Tab[];
  elsewhere: number;
  frontTabId?: number;
  onRemove: (tabId: number) => void;
  onPick: () => void;
}) {
  const running = session.runId !== null;
  const removable = session.tabIds.length > 1;

  return (
    <div>
      <CardHeading>Tabs in this conversation</CardHeading>
      <ul className="max-h-64 overflow-y-auto px-1.5 pb-1" onKeyDown={moveFocus}>
        {members.map((tab) => {
          const here = tab.id === frontTabId;
          const agentHere = running && tab.id === session.currentTabId && !here;
          const opened = session.openedTabIds.includes(tab.id);
          return (
            <li key={tab.id} className="group flex items-center gap-1 rounded-lg hover:bg-surface/60 focus-within:bg-surface/60">
              <button
                type="button"
                data-row
                onClick={() => void browser.tabs.update(tab.id, { active: true })}
                onKeyDown={(event) => {
                  if ((event.key === 'Delete' || event.key === 'Backspace') && removable && !running) onRemove(tab.id);
                }}
                title={tab.url}
                className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left outline-none"
              >
                <TabFace tab={tab} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {here && <span className="glow-dot size-1.5 shrink-0 rounded-full bg-brand text-brand" aria-label="You’re on this tab" />}
                    <span className="truncate text-xs text-ink">{tab.title || hostOf(tab.url) || 'Untitled'}</span>
                  </span>
                  <span className="block truncate font-mono text-[10px] text-ink-faint">
                    {hostOf(tab.url) ?? 'no site'}
                    {opened && ' · opened by the agent'}
                  </span>
                </span>
                {agentHere && (
                  <span className="shrink-0 rounded-full border border-brand/35 px-1.5 font-mono text-[9px] tracking-[0.1em] text-brand uppercase">
                    Agent
                  </span>
                )}
              </button>
              {removable && (
                <button
                  type="button"
                  onClick={() => onRemove(tab.id)}
                  disabled={running}
                  aria-label={`Take ${tab.title || 'this tab'} out of the conversation`}
                  title={running ? 'Stop the run before taking a tab out' : 'Take it out of the conversation. The tab stays open.'}
                  className="mr-1 shrink-0 rounded-full p-1 text-ink-faint opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-surface hover:text-ink focus-visible:opacity-100 disabled:opacity-30"
                >
                  <X className="size-3" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {elsewhere > 0 && (
        <p className="px-4 pb-1 text-[11px] text-ink-faint">
          {elsewhere === 1 ? 'One more is in another window.' : `${elsewhere} more are in other windows.`}
        </p>
      )}
      <div className="border-t border-line p-1.5">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onPick}>
          <Plus className="size-3.5" /> Add tabs
        </Button>
      </div>
    </div>
  );
}

function TabPicker({
  candidates,
  sessions,
  onBack,
  onAdd,
}: {
  candidates: Tab[];
  sessions: TabSession[];
  onBack?: () => void;
  onAdd: (tabIds: number[]) => void;
}) {
  const blocked = useBlockedCheck();
  const [filter, setFilter] = useState('');
  const [chosen, setChosen] = useState<Set<number>>(() => new Set());
  const seeded = useRef(false);

  const rows = useMemo(
    () =>
      candidates.map((tab) => {
        const holder = sessions.find((session) => session.tabIds.includes(tab.id));
        const why = blocked(tab.url)
          ? 'Blocked site'
          : holder?.runId
            ? `“${holder.title}” is working here`
            : holder?.phone || holder?.task
              ? `In “${holder.title}”`
              : null;
        return { tab, holder, why };
      }),
    [candidates, sessions, blocked],
  );
  const selectable = rows.filter((row) => !row.why);
  const selected = selectable.filter((row) => row.tab.highlighted);

  useEffect(() => {
    if (seeded.current || !candidates.length) return;
    seeded.current = true;
    setChosen(new Set(selected.map((row) => row.tab.id)));
  }, [candidates.length, selected]);

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? rows.filter(({ tab }) => `${tab.title ?? ''} ${tab.url ?? ''}`.toLowerCase().includes(needle))
    : rows;
  const picked = selectable.filter((row) => chosen.has(row.tab.id)).map((row) => row.tab.id);

  const toggle = (tabId: number) =>
    setChosen((previous) => {
      const next = new Set(previous);
      if (!next.delete(tabId)) next.add(tabId);
      return next;
    });

  return (
    <div>
      <CardHeading>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to this conversation’s tabs"
            className="-ml-1 rounded-full p-0.5 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
          >
            <ChevronLeft className="size-3.5" />
          </button>
        )}
        Add tabs to this conversation
      </CardHeading>
      {rows.length ? (
        <>
          <div className="px-3 pb-2">
            <Input
              autoFocus
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter open tabs"
              aria-label="Filter open tabs"
              className="h-8 text-xs"
            />
            {selected.length > 0 && (
              <p className="mt-1.5 text-[11px] text-ink-faint">
                {selected.length === 1 ? 'One tab is' : `${selected.length} tabs are`} selected in the tab strip.
              </p>
            )}
          </div>
          <ul className="max-h-64 overflow-y-auto px-1.5 pb-1" onKeyDown={moveFocus}>
            {shown.map(({ tab, holder, why }) => {
              const on = !why && chosen.has(tab.id);
              return (
                <li key={tab.id}>
                  <button
                    type="button"
                    data-row
                    role="checkbox"
                    aria-checked={on}
                    disabled={!!why}
                    onClick={() => toggle(tab.id)}
                    title={why ?? (holder ? `Moves here from “${holder.title}”` : tab.url)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-surface/60 focus-visible:bg-surface/60 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span
                      className={cn(
                        'grid size-3.5 shrink-0 place-items-center rounded border transition-colors',
                        on ? 'border-brand bg-brand text-ground' : 'border-line-strong',
                      )}
                    >
                      {on && <Check className="size-2.5" strokeWidth={3} />}
                    </span>
                    <TabFace tab={tab} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-ink">{tab.title || hostOf(tab.url)}</span>
                      <span className="block truncate font-mono text-[10px] text-ink-faint">
                        {why ?? (holder ? `in “${holder.title}” · moves here` : hostOf(tab.url))}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="px-2 py-3 text-center text-[11px] text-ink-faint">No open tab matches.</li>}
          </ul>
          <div className="flex justify-end border-t border-line p-2">
            <Button size="sm" disabled={!picked.length} onClick={() => onAdd(picked)}>
              {picked.length > 1 ? `Add ${picked.length} tabs` : 'Add tab'}
            </Button>
          </div>
        </>
      ) : (
        <p className="px-4 pb-4 text-[11px] leading-relaxed text-ink-dim">
          No other web pages are open in this window. Open the pages this work needs, then add them here, or select them in
          the tab strip first.
        </p>
      )}
    </div>
  );
}

function CardHeading({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-4 pt-3 pb-2 font-mono text-[10px] tracking-[0.12em] text-ink-faint uppercase">
      {children}
    </p>
  );
}

function TabFace({ tab, className }: { tab: Browser.tabs.Tab; className?: string }) {
  const [broken, setBroken] = useState(false);
  const icon = faviconOf(tab.url, 32) ?? tab.favIconUrl;
  if (!icon || broken) {
    return (
      <span className={cn('grid size-3.5 shrink-0 place-items-center bg-surface text-ink-faint', className)}>
        <Globe className="size-2.5" />
      </span>
    );
  }
  return <img src={icon} alt="" className={cn('size-3.5 shrink-0 rounded-sm', className)} onError={() => setBroken(true)} />;
}

/** Up and down move between rows, the way a menu reads. */
function moveFocus(event: KeyboardEvent<HTMLUListElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-row]:not(:disabled)')];
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next = rows[(at + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
  if (!next) return;
  event.preventDefault();
  next.focus();
}
