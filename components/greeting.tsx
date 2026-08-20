import { BookOpen, Clapperboard, History, Settings2, type LucideIcon } from 'lucide-react';

import { Logo } from '@/components/brand';
import type { PanelTab } from '@/components/panel-nav';
import type { StatusBlocker } from '@/components/status-pill';

const SUGGESTIONS = [
  'Summarise what this page says',
  'Fill this form in with my details',
  'Find the unpaid invoices and open the newest',
];

const BLOCKED: Record<StatusBlocker, string> = {
  unpaired: 'This browser isn’t paired yet, so nothing can drive it. Pairing takes one command and one code.',
  offline: 'Paired, but the daemon isn’t answering. Start browsentic-mcp and this reconnects on its own.',
  agent: 'The chosen agent can’t run on this machine. Pick another one, or let Browsentic fix it.',
};

export function Greeting({
  blocker,
  voiceOn,
  onGo,
  onFix,
  onUse,
}: {
  blocker?: StatusBlocker;
  voiceOn: boolean;
  onGo: (tab: PanelTab) => void;
  onFix: () => void;
  onUse: (text: string) => void;
}) {
  return (
    <div className="dot-grid fade-bottom flex flex-col gap-4 p-4">
      <div className="flex items-start gap-2.5">
        <Logo className="mt-0.5 size-7 shrink-0 text-brand" />
        <div className="panel-card min-w-0 rounded-2xl rounded-tl-md px-3 py-2.5 text-sm leading-relaxed text-ink">
          {blocker ? (
            BLOCKED[blocker]
          ) : (
            <>
              {voiceOn ? 'Just talk' : 'Tell me'} what to do on this page — read it, fill something in, click through a
              flow — and every action shows up here as I take it.
            </>
          )}
        </div>
      </div>

      {blocker ? (
        <div className="flex flex-wrap gap-1.5">
          <Quick
            icon={Settings2}
            label={blocker === 'agent' ? 'Choose an agent' : 'Set up the link'}
            onClick={onFix}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {SUGGESTIONS.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => onUse(text)}
                className="rounded-xl border border-line bg-ground/40 px-3 py-2 text-left text-xs text-ink-dim transition-colors hover:border-brand/40 hover:bg-surface/60 hover:text-ink"
              >
                {text}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Quick icon={BookOpen} label="Teach it this site" onClick={() => onGo('skills')} />
            <Quick icon={Clapperboard} label="Record a flow" onClick={() => onGo('recordings')} />
            <Quick icon={History} label="Past chats" onClick={() => onGo('history')} />
          </div>
        </>
      )}
    </div>
  );
}

function Quick({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-ground-2/70 px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:border-brand/40 hover:text-ink"
    >
      <Icon className="size-3" />
      {label}
    </button>
  );
}
