import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Code2, FileText, FileUp, Loader2, Mic, MicOff, Paperclip, ScanEye, Send, Sparkles, Square, X } from 'lucide-react';

import { SkillMenu, skillMenuItems, type SkillMenuItem } from '@/extension/components/skill-menu';
import { Button } from '@/extension/components/ui/button';
import { Textarea } from '@/extension/components/ui/textarea';
import type { FocusedElement, SkillCatalog } from '@/lib/actions/protocol';
import { focusName } from '@/lib/bridge/aeye';
import type { StoredFileMeta } from '@/lib/bridge/file-store';
import type { useVoiceComposer } from '@/lib/bridge/use-voice-composer';
import { cn } from '@/lib/utils';

type Voice = ReturnType<typeof useVoiceComposer>;

export interface AttachedSkill {
  id: string;
  name: string;
}

export function Composer({
  voice,
  voiceEnabled,
  connected,
  running,
  files,
  attachError,
  catalog,
  tabUrl,
  attachedSkill,
  focus,
  picking,
  liveTools,
  onToggleLiveTools,
  onAttachSkill,
  onCommand,
  onSend,
  onStop,
  onToggleVoice,
  onPick,
  onClearFocus,
  onAttachPage,
  onAttachFile,
  onRemoveFile,
}: {
  voice: Voice;
  voiceEnabled: boolean;
  connected: boolean;
  running: boolean;
  files: StoredFileMeta[];
  attachError: string | null;
  catalog: SkillCatalog | undefined;
  tabUrl: string;
  attachedSkill: AttachedSkill | null;
  focus: FocusedElement | null;
  picking: boolean;
  liveTools: boolean;
  onToggleLiveTools: () => void;
  onAttachSkill: (skill: AttachedSkill | null) => void;
  onCommand: (command: string) => void;
  onSend: () => void;
  onStop: () => void;
  onToggleVoice: () => void;
  onPick: () => void;
  onClearFocus: () => void;
  onAttachPage: () => void;
  onAttachFile: (file: File) => void;
  onRemoveFile: (fileId: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const slash = voice.input.startsWith('/') ? voice.input.slice(1) : null;
  const menuOpen = slash !== null && connected;
  const [highlight, setHighlight] = useState(0);
  const menuItems = useMemo(
    () => (menuOpen ? skillMenuItems(catalog, tabUrl, slash ?? '') : []),
    [menuOpen, catalog, tabUrl, slash],
  );

  useEffect(() => setHighlight(0), [slash]);

  const { cancelPending } = voice;
  useEffect(() => {
    if (menuOpen) cancelPending();
  }, [menuOpen, cancelPending]);

  function choose(item: SkillMenuItem) {
    if (item.command) {
      voice.setInput('');
      onCommand(item.command);
    } else if (item.agentSkillId) {
      onAttachSkill({ id: item.agentSkillId, name: item.name });
      voice.setInput('');
    } else {
      voice.setInput(`@${item.name} `);
    }
    composerRef.current?.focus();
  }

  function focusComposer(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button, textarea')) return;
    composerRef.current?.focus();
  }

  return (
    <>
      {attachError && (
        <p className="mb-2 rounded-lg border border-amber/40 bg-amber/10 px-2.5 py-1.5 text-[11px] text-amber">
          {attachError}
        </p>
      )}

      <FocusChip focus={focus} picking={picking} onClear={onClearFocus} />

      {attachedSkill && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-brand/35 bg-brand/8 px-2.5 py-1.5 text-xs">
          <Sparkles className="size-3.5 shrink-0 text-brand" />
          <span className="min-w-0 flex-1 truncate text-ink">
            Skill attached: <span className="font-medium">{attachedSkill.name}</span>
          </span>
          <button
            type="button"
            onClick={() => onAttachSkill(null)}
            aria-label={`Detach ${attachedSkill.name}`}
            className="shrink-0 rounded-full p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {liveTools && (
        <div className="enters mb-2 flex items-center gap-2 rounded-xl border border-ember/40 bg-ember/8 px-2.5 py-1.5 text-xs">
          <Code2 className="size-3.5 shrink-0 text-ember" />
          <span className="min-w-0 flex-1 text-ink-dim">
            <span className="font-medium text-ink">Live tool on</span> — the agent may write a script for this page.
            You approve the code first.
          </span>
          <button
            type="button"
            onClick={onToggleLiveTools}
            aria-label="Turn live tools off"
            className="shrink-0 rounded-full p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      <FileChips files={files} onRemove={onRemoveFile} />
      <VoiceStatus voice={voice} voiceEnabled={voiceEnabled} />

      <div
        onClick={focusComposer}
        className={cn(
          'panel-card relative flex flex-col rounded-2xl transition-colors has-[textarea:focus]:border-brand/50',
          connected && 'cursor-text',
        )}
      >
        {menuOpen && (
          <SkillMenu
            items={menuItems}
            agent={catalog?.agent}
            highlight={highlight}
            onHover={setHighlight}
            onSelect={choose}
          />
        )}
        <Textarea
          ref={composerRef}
          value={voice.input}
          onChange={(event) => voice.setInput(event.target.value)}
          onKeyDown={(event) => {
            if (menuOpen) {
              if (event.key === 'Escape') {
                event.preventDefault();
                voice.setInput('');
                return;
              }
              if (menuItems.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setHighlight((current) => (current + 1) % menuItems.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setHighlight((current) => (current - 1 + menuItems.length) % menuItems.length);
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  choose(menuItems[Math.min(highlight, menuItems.length - 1)]);
                  return;
                }
              }
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder={connected ? 'Tell me what to do on this page…' : 'Pair the browser to get started'}
          disabled={!connected}
          rows={2}
          className="max-h-48 min-h-14 resize-none rounded-none border-0 bg-transparent px-3 pt-2.5 pb-0 focus-visible:border-0"
        />

        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          <Button
            variant={focus || picking ? 'subtle' : 'ghost'}
            size="icon-sm"
            title="A-Eye — point at an element on the page and send it with your next message"
            aria-label="Point at an element with A-Eye"
            onClick={onPick}
            disabled={!connected || picking}
            className={cn(focus || picking ? 'text-ember' : undefined)}
          >
            <ScanEye className={cn('size-3.5', picking && 'animate-pulse')} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Add this page’s title, URL and selection to the message"
            aria-label="Attach page context"
            onClick={onAttachPage}
            disabled={!connected}
          >
            <Paperclip className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Attach a file for the agent to read"
            aria-label="Attach a file"
            onClick={() => fileInputRef.current?.click()}
            disabled={!connected}
          >
            <FileUp className="size-3.5" />
          </Button>
          <Button
            variant={liveTools ? 'subtle' : 'ghost'}
            size="icon-sm"
            role="switch"
            aria-checked={liveTools}
            aria-label={liveTools ? 'Turn live tools off' : 'Turn live tools on'}
            title={
              liveTools
                ? 'Live tool is on — the agent may write a small script for this page and ask you to approve it. Turn it off to keep to the built-in tools.'
                : 'Live tool — let the agent write a small script for repetitive work or for something no tool covers. You review and approve the code before it runs.'
            }
            onClick={onToggleLiveTools}
            disabled={!connected}
            className={cn(liveTools ? 'text-ember' : undefined)}
          >
            <Code2 className="size-3.5" />
          </Button>
          <Button
            variant={voiceEnabled && !voice.error ? 'subtle' : 'ghost'}
            size="icon-sm"
            aria-label={voiceEnabled ? 'Turn voice off' : 'Turn voice on'}
            title={voice.supported ? 'Speak instead of typing' : 'Voice input is not available in this browser'}
            onClick={onToggleVoice}
            disabled={!voice.supported}
            className="relative"
          >
            {voiceEnabled && voice.listening && (
              <span className="absolute inset-0 animate-ping rounded-full bg-magenta/30" />
            )}
            {voiceEnabled && !voice.error ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />}
          </Button>

          {running ? (
            <Button size="icon-sm" variant="destructive" className="ml-auto" aria-label="Stop the agent" onClick={onStop}>
              <Square className="size-3 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              className="ml-auto"
              aria-label="Send message"
              onClick={onSend}
              disabled={!voice.input.trim() || !connected}
            >
              <Send className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onAttachFile(file);
        }}
      />

      <p className="mt-2 text-center font-mono text-[10px] text-ink-faint">
        {voiceEnabled && voice.supported
          ? 'Speak and pause to send · Enter sends now'
          : 'Enter to send · Shift + Enter for a new line · / for skills and commands'}
      </p>
    </>
  );
}

function FocusChip({
  focus,
  picking,
  onClear,
}: {
  focus: FocusedElement | null;
  picking: boolean;
  onClear: () => void;
}) {
  if (!picking && !focus) return null;
  return (
    <div className="enters mb-2 flex items-center gap-2 rounded-xl border border-ember/40 bg-ember/8 px-2.5 py-1.5 text-xs">
      <ScanEye className={cn('size-3.5 shrink-0 text-ember', picking && 'animate-pulse')} />
      {picking || !focus ? (
        <span className="min-w-0 flex-1 truncate text-ink-dim">
          Point at anything on the page — <span className="text-ink-faint">Esc cancels</span>
        </span>
      ) : (
        <>
          {focus.shot && (
            <img
              src={focus.shot}
              alt="The element you picked"
              className="max-h-7 max-w-14 shrink-0 rounded border border-ember/40 object-cover"
            />
          )}
          <span className="min-w-0 flex-1 truncate text-ink">
            A-Eye: <span className="font-medium">{focusName(focus)}</span>
          </span>
          <span className="shrink-0 font-mono text-[10px] text-ink-faint">{focus.tag}</span>
          <button
            type="button"
            onClick={onClear}
            aria-label="Drop the A-Eye selection"
            className="shrink-0 rounded-full p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
          >
            <X className="size-3" />
          </button>
        </>
      )}
    </div>
  );
}

function VoiceStatus({ voice, voiceEnabled }: { voice: Voice; voiceEnabled: boolean }) {
  if (voiceEnabled && voice.error) {
    return (
      <p className="mb-2 rounded-lg border border-amber/40 bg-amber/10 px-2.5 py-1.5 text-[11px] text-amber">
        {voice.error}
      </p>
    );
  }

  if (voice.pendingSend) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-lg bg-brand/10 px-2.5 py-1.5 text-[11px] text-brand">
        <span className="relative flex-1 overflow-hidden rounded-full bg-brand/20">
          <span
            className="block h-1 rounded-full bg-brand"
            style={{ animation: `browsentic-countdown ${voice.autoSendMs}ms linear forwards` }}
          />
        </span>
        <span className="shrink-0">Sending…</span>
        <button
          type="button"
          onClick={voice.cancelPending}
          className="flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 transition-colors hover:bg-brand/15"
          aria-label="Cancel sending"
        >
          <X className="size-3" /> Edit
        </button>
      </div>
    );
  }

  if (voiceEnabled && voice.listening) {
    return (
      <p className="mb-2 flex items-center gap-1.5 px-1 text-[11px] text-ink-dim">
        <span className="glow-dot inline-flex size-1.5 shrink-0 animate-pulse rounded-full bg-magenta text-magenta" />
        {voice.interim ? <span className="truncate italic">{voice.interim}</span> : <span>Listening…</span>}
      </p>
    );
  }

  if (voiceEnabled && !voice.supported) {
    return <p className="mb-2 px-1 text-[11px] text-ink-faint">Voice input isn’t available in this browser.</p>;
  }

  return null;
}

function FileChips({ files, onRemove }: { files: StoredFileMeta[]; onRemove: (fileId: string) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="mb-2 flex max-h-40 flex-col gap-1.5 overflow-y-auto">
      {files.map((file) => (
        <div
          key={file.id}
          className="flex items-start gap-2 rounded-xl border border-line bg-ground/40 px-2.5 py-1.5 text-xs"
        >
          <FileText className="mt-0.5 size-3.5 shrink-0 text-ink-faint" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-ink">{file.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-ink-faint">{formatBytes(file.size)}</span>
            </div>
            {file.status === 'pending' && (
              <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-faint">
                <Loader2 className="size-3 animate-spin" /> Analyzing…
              </span>
            )}
            {file.status === 'ready' && file.summary && (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-dim">{file.summary}</p>
            )}
            {file.status === 'error' && (
              <span className="mt-0.5 block text-[11px] text-destructive">{file.error ?? 'Analysis failed'}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onRemove(file.id)}
            aria-label={`Remove ${file.name}`}
            className="mt-0.5 shrink-0 rounded-full p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
