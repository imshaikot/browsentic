import {
  Camera,
  Check,
  Clapperboard,
  Compass,
  CornerDownLeft,
  ExternalLink,
  Eye,
  Highlighter,
  Hourglass,
  Info,
  Keyboard,
  ListChecks,
  MousePointerClick,
  MoveVertical,
  Paperclip,
  Radar,
  ScanEye,
  Terminal,
  TextCursorInput,
  TriangleAlert,
  Type,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { Markdown } from '@/extension/components/markdown';
import { Button } from '@/extension/components/ui/button';
import { openScreenshot } from '@/lib/bridge/screenshot-preview';
import type { RunItem } from '@/lib/bridge/run-items';
import { cn } from '@/lib/utils';

interface RunTimelineProps {
  items: RunItem[];
  running: boolean;
  onDecide: (toolId: string, allow: boolean, remember?: boolean) => void;
}

export function RunTimeline({ items, running, onDecide }: RunTimelineProps) {
  const last = items.at(-1);
  const streaming = running && last?.kind === 'assistant';
  const awaiting = running && !streaming;

  return (
    <div className="flex min-w-0 flex-col gap-2.5 p-3">
      {items.map((item, index) =>
        item.kind === 'tool' ? (
          <ToolRow key={item.id} item={item} onDecide={onDecide} />
        ) : item.kind === 'notice' ? (
          <Notice key={item.id} item={item} />
        ) : item.kind === 'user' ? (
          <UserBubble key={item.id} text={item.text} focus={item.focus} />
        ) : (
          <Reply key={item.id} text={item.text} streaming={streaming && index === items.length - 1} />
        ),
      )}
      {awaiting && <Thinking />}
    </div>
  );
}

function UserBubble({ text, focus }: { text: string; focus?: string }) {
  return (
    <div className="enters flex min-w-0 flex-col items-end gap-1">
      <div className="min-w-0 max-w-[88%] rounded-2xl rounded-br-md border border-brand/30 bg-brand/10 px-3 py-2 text-sm whitespace-pre-wrap wrap-anywhere text-ink">
        {text}
      </div>
      {focus && (
        <span className="flex min-w-0 max-w-[88%] items-center gap-1 rounded-full bg-ember/12 px-2 py-0.5 text-[10px] text-ember">
          <ScanEye className="size-2.5 shrink-0" />
          <span className="truncate">{focus}</span>
        </span>
      )}
    </div>
  );
}

function Reply({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className="enters min-w-0">
      <Markdown
        text={text}
        streaming={streaming}
        className="panel-card rounded-2xl rounded-tl-md px-3 py-2.5 text-sm leading-relaxed text-ink"
      />
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="flex items-center gap-1">
        {[0, 1, 2].map((dot) => (
          <span key={dot} className="think-dot size-1.5 rounded-full bg-brand" />
        ))}
      </span>
      <span className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">Working</span>
    </div>
  );
}

function ToolRow({
  item,
  onDecide,
}: {
  item: Extract<RunItem, { kind: 'tool' }>;
  onDecide: (toolId: string, allow: boolean, remember?: boolean) => void;
}) {
  const name = item.action.replace(/^page\./, '');
  const Icon = ICONS[name] ?? Wrench;
  const pending = item.ok === undefined && !item.awaiting;

  return (
    <div className="enters flex min-w-0 flex-col gap-1.5">
      <div
        className={cn(
          'relative flex min-w-0 items-start gap-2 overflow-hidden rounded-lg border px-2 py-1.5 transition-colors',
          item.awaiting
            ? 'border-ember/45 bg-ember/10'
            : item.ok === false
              ? 'border-destructive/40 bg-destructive/8'
              : 'border-line bg-ground/40',
          pending && 'sweep',
        )}
      >
        <Icon
          className={cn(
            'mt-0.5 size-3 shrink-0',
            item.awaiting
              ? 'text-ember'
              : item.ok === false
                ? 'text-destructive'
                : item.source === 'local'
                  ? 'text-amber'
                  : item.source === 'external'
                    ? 'text-magenta'
                    : 'text-brand',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-[10px] text-ink">{name}</span>
            {item.source === 'local' && <Tag tone="amber" icon={Zap} label="local" />}
            {item.source === 'external' && <Tag tone="magenta" icon={Terminal} label="mcp" />}
          </div>
          {item.summary && (
            <p
              className={cn(
                'mt-0.5 truncate text-[10px]',
                item.ok === false ? 'text-destructive' : 'text-ink-faint',
              )}
            >
              {item.summary}
            </p>
          )}
        </div>
        {item.ok === true && <Check className="mt-0.5 size-3 shrink-0 text-lime/80" />}
        {item.ok === false && <X className="mt-0.5 size-3 shrink-0 text-destructive" />}
      </div>

      {item.preview && (
        <button
          type="button"
          onClick={() => void openScreenshot(item.preview!)}
          title={`Open the ${item.preview.full ? 'full-size' : 'captured'} screenshot in a new tab`}
          className="group max-w-[88%] overflow-hidden rounded-xl border border-line bg-ground/60 transition-colors hover:border-brand/50"
        >
          <img
            src={item.preview.thumbnail}
            alt={`Screenshot, ${item.preview.width}×${item.preview.height}`}
            width={item.preview.width}
            height={item.preview.height}
            className="block h-auto w-full transition-opacity group-hover:opacity-85"
          />
        </button>
      )}

      {item.awaiting && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-ember/45 bg-ember/10 px-2.5 py-2">
          <p className="flex-1 text-xs text-ink">Allow this action?</p>
          <Button size="sm" variant="ghost" onClick={() => onDecide(item.id, false)}>
            Deny
          </Button>
          {item.site && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDecide(item.id, true, true)}
              title={`Stop asking for ${name} on ${item.site}. Undo with “browsentic approvals clear”.`}
            >
              Always on {item.site}
            </Button>
          )}
          <Button size="sm" onClick={() => onDecide(item.id, true)}>
            Allow
          </Button>
        </div>
      )}
    </div>
  );
}

function Tag({ tone, icon: Icon, label }: { tone: 'amber' | 'magenta'; icon: LucideIcon; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px font-mono text-[8px] tracking-[0.1em] uppercase',
        tone === 'amber' ? 'bg-amber/15 text-amber' : 'bg-magenta/15 text-magenta',
      )}
    >
      <Icon className="size-2" />
      {label}
    </span>
  );
}

function Notice({ item }: { item: Extract<RunItem, { kind: 'notice' }> }) {
  const isError = item.tone === 'error';
  return (
    <div
      className={cn(
        'enters flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed',
        isError ? 'border border-destructive/35 bg-destructive/8 text-destructive' : 'text-ink-faint',
      )}
    >
      {isError ? (
        <TriangleAlert className="mt-px size-3 shrink-0" />
      ) : (
        <Info className="mt-px size-3 shrink-0" />
      )}
      <span className="min-w-0 break-words">{item.text}</span>
    </div>
  );
}

const ICONS: Record<string, LucideIcon> = {
  getPageInfo: Eye,
  extractText: Eye,
  pickElement: ScanEye,
  findProgress: Eye,
  clickElement: MousePointerClick,
  trustedClick: MousePointerClick,
  hoverElement: MousePointerClick,
  fillInput: Type,
  typeText: Type,
  focusInput: TextCursorInput,
  selectText: TextCursorInput,
  pressKey: Keyboard,
  submitForm: CornerDownLeft,
  selectOption: ListChecks,
  navigate: Compass,
  openTab: ExternalLink,
  switchTab: ExternalLink,
  closeTab: X,
  screenshot: Camera,
  scrollTo: MoveVertical,
  highlightElement: Highlighter,
  waitForElement: Hourglass,
  attachFile: Paperclip,
  listFiles: Paperclip,
  startMonitor: Radar,
  stopMonitor: Radar,
  monitorStatus: Radar,
  awaitMonitor: Radar,
  listRecordings: Clapperboard,
  readRecording: Clapperboard,
};
